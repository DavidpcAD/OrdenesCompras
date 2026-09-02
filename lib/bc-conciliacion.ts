// ════════════════════════════════════════════════════════════════════════════════
// COTEJO SQL ↔ BUSINESS CENTRAL: ¿el pedido de allá tiene las mismas líneas que la
// orden de acá?
//
// Por qué existe este archivo (caso real, 2 sep 2026):
//   CP-005172 tenía 7 líneas en la app y 6 en Business Central. Faltaba
//   "M06-0116 TORNILLO 1-1/4 P/F, 7.000 UND × ₡3,26 = ₡22.820". El proveedor
//   facturó ₡171.169,27 y en BC quedaron registrados ₡145.382,67. La app decía
//   "recibido 100%" porque la app solo se mira a sí misma: el registro en BC se
//   daba por bueno con que la llamada devolviera HTTP 200, y el codeunit se salta
//   en silencio la línea que no encuentra en el pedido. Nadie se enteró hasta que
//   alguien comparó una factura de papel con una pantalla.
//
// La regla que impone este módulo: lo que la app dice que compró tiene que estar
// en BC, línea por línea. Si no está, no es un aviso que se desvanece — es un
// estado de la orden.
//
// Todo acá es PURO (sin red, sin SQL) para poder probarlo: ver bc-conciliacion.test.ts.
// ════════════════════════════════════════════════════════════════════════════════

import { codigoDeItem } from "./unidad.ts";

// Una línea del pedido tal como está en Business Central (la lee bcLineasPedido).
export type LineaBc = {
  documentNo: string;
  lineNo: number;
  tipo: "articulo" | "cargo" | "otro";
  itemNo: string;
  variantCode: string;
  descripcion: string;
  unidad: string;
  almacen: string;
  cantidad: number;
  recibida: number;
  facturada: number;
  pendiente: number;      // Outstanding Quantity: lo que todavía se puede recibir
  precioUnitario: number;
};

// Una línea de la orden de la app, reducida a lo que se puede cotejar contra BC.
export type LineaApp = {
  id: string;
  tipo: "articulo" | "cargo";
  itemNo: string;         // artículo o N.º de cargo
  variantCode: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  unidad?: string;        // unidad de COMPRA: en ella están cantidad y precio
};

export type ClaseDiferencia =
  | "falta_en_bc"     // la app la tiene y BC no: ESTE es el caso CP-005172
  | "sobra_en_bc"     // BC tiene una línea que la app no conoce (la tocaron allá)
  | "cantidad"        // están las dos, con distinta cantidad
  | "precio"          // están las dos, con distinto precio unitario
  | "unidad";         // el mismo número en otra unidad: 1 EST no es 1 GR

export type Diferencia = {
  clase: ClaseDiferencia;
  itemNo: string;
  variantCode: string;
  descripcion: string;
  cantidadApp: number;
  cantidadBc: number;
  precioApp: number;
  precioBc: number;
  unidadApp: string;
  unidadBc: string;
  // Plata en juego, en la moneda de la orden. Es lo que se descuadra contra la
  // factura del proveedor si nadie lo corrige: por eso va en el aviso.
  importe: number;
  texto: string;        // una línea lista para mostrarle a una persona
};

export type Cotejo = {
  ok: boolean;
  diferencias: Diferencia[];
  // Cuántas líneas se compararon de cada lado (para el "6 de 7" del mensaje).
  lineasApp: number;
  lineasBc: number;
  // Plata total en juego (suma de |importe| de las diferencias).
  importeEnJuego: number;
  resumen: string;      // "" cuando ok
};

// Tolerancias. La cantidad se compara con 1e-6 porque BC guarda decimales y la app
// también; el precio con medio céntimo, que es lo que redondea BC al mostrar.
const EPS_CANT = 1e-6;
const EPS_PRECIO = 0.005;

// Clave de cotejo: artículo + variante. Es lo único que las dos partes comparten —
// el N.º de línea de BC (10000, 20000…) no viaja a la app y el idOrdenCompraDet no
// viaja a BC, así que no hay una llave real. Se normaliza fuerte a propósito:
//   · codigoDeItem pela la variante pegada ("M11-0081 -VAR 12" → "M11-0081"), que es
//     como llegan algunos códigos desde las solicitudes de Producción;
//   · mayúsculas y sin espacios, porque BC devuelve los códigos como los guardó.
export function claveLinea(itemNo: string, variantCode?: string): string {
  const item = codigoDeItem(String(itemNo ?? "")).toUpperCase();
  const v = String(variantCode ?? "").trim().toUpperCase();
  return v ? `${item}|${v}` : item;
}

type Acumulado = { cantidad: number; importe: number; lineas: number; descripcion: string; itemNo: string; variantCode: string; unidad: string };

// Agrupa por clave sumando cantidades. Se agrupa (en vez de comparar línea a línea)
// porque una orden PUEDE repetir el mismo material en dos líneas —distinto almacén,
// distinta obra— y BC las guarda como dos líneas separadas: comparar de a una haría
// saltar un falso positivo en cada orden así. Lo que interesa es que la suma de lo
// que se compró de un material sea la misma de los dos lados.
function agrupar(
  lineas: { itemNo: string; variantCode?: string; descripcion?: string; cantidad: number; precioUnitario: number; unidad?: string }[],
  ignorarVariante = false,
): Map<string, Acumulado> {
  const m = new Map<string, Acumulado>();
  for (const l of lineas ?? []) {
    const itemNo = codigoDeItem(String(l.itemNo ?? "")).toUpperCase();
    if (!itemNo) continue;
    const variantCode = ignorarVariante ? "" : String(l.variantCode ?? "").trim().toUpperCase();
    const k = claveLinea(itemNo, variantCode);
    const prev = m.get(k);
    const cantidad = Number(l.cantidad) || 0;
    const importe = cantidad * (Number(l.precioUnitario) || 0);
    const unidad = String(l.unidad ?? "").trim().toUpperCase();
    if (prev) {
      prev.cantidad += cantidad;
      prev.importe += importe;
      prev.lineas += 1;
      if (!prev.unidad) prev.unidad = unidad;
    } else {
      m.set(k, { cantidad, importe, lineas: 1, descripcion: String(l.descripcion ?? itemNo), itemNo, variantCode, unidad });
    }
  }
  return m;
}

const money = (n: number) => n.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cant = (n: number) => n.toLocaleString("es-CR", { maximumFractionDigits: 5 });

// El precio unitario promedio del acumulado (la comparación de precio se hace sobre
// esto, no sobre la primera línea: si el material se repite a dos precios, lo que
// importa es que la plata total coincida).
const precioDe = (a: Acumulado) => (a.cantidad > EPS_CANT ? a.importe / a.cantidad : 0);

// Junta varias variantes del mismo artículo en un solo acumulado, para poder
// compararlas contra una línea de la app que no dice qué variante es.
function fundir(xs: Acumulado[]): Acumulado {
  const base = xs[0];
  return {
    itemNo: base.itemNo,
    variantCode: xs.length === 1 ? base.variantCode : "",
    descripcion: base.descripcion,
    unidad: xs.find((x) => x.unidad)?.unidad ?? "",
    cantidad: xs.reduce((s, x) => s + x.cantidad, 0),
    importe: xs.reduce((s, x) => s + x.importe, 0),
    lineas: xs.reduce((s, x) => s + x.lineas, 0),
  };
}

// ¿La orden de la app y el pedido de BC dicen lo mismo?
//
// `soloArticulos` (default true): las líneas de CARGO no se cotejan por cantidad ni
// precio porque BC las reparte y les recalcula el importe al lanzar/registrar (el
// flete se prorratea entre las líneas de artículo). Sí se coteja su EXISTENCIA.
// `ignorarVariante`: cuando las líneas de BC vienen de la API ESTÁNDAR, que no
// devuelve el código de variante. Sin esto, una línea con variante daría siempre
// "falta en BC" (la clave de un lado lleva variante y la del otro no) — un falso
// positivo en cada orden con variantes, que es la forma más rápida de que la gente
// deje de creerle a esta pantalla.
export function cotejarLineas(
  app: LineaApp[],
  bc: LineaBc[],
  opts: { soloArticulos?: boolean; ignorarVariante?: boolean } = {},
): Cotejo {
  const soloArticulos = opts.soloArticulos ?? true;
  const sinVar = opts.ignorarVariante ?? false;
  const artApp = (app ?? []).filter((l) => l.tipo === "articulo");
  const artBc = (bc ?? []).filter((l) => l.tipo === "articulo");
  const gApp = agrupar(artApp, sinVar);
  const gBc = agrupar(artBc, sinVar);

  const diferencias: Diferencia[] = [];

  // BC indexado por artículo → variante. Hace falta porque una línea de la app SIN
  // variante no contradice a una de BC CON variante: la app simplemente no dijo cuál,
  // y de hecho hay un paso que la resuelve en vuelo (resolverVariantesRequeridas) y
  // no la guarda en SQL. Compararlas como cosas distintas generaba, en órdenes sanas,
  // un "falta en BC" + un "sobra en BC" por la misma línea — el tipo de falso positivo
  // que hace que la gente deje de mirar el aviso.
  const bcPorItem = new Map<string, Map<string, Acumulado>>();
  for (const [k, b] of gBc) {
    const item = k.split("|")[0];
    const porVar = bcPorItem.get(item) ?? new Map<string, Acumulado>();
    porVar.set(b.variantCode, b);
    bcPorItem.set(item, porVar);
  }
  const usadas = new Set<string>();

  for (const [k, a] of gApp) {
    // Sin variante en la app: se compara contra TODAS las variantes de ese artículo
    // en BC, sumadas. Con variante: contra esa y solo esa.
    const candidatas = bcPorItem.get(a.itemNo);
    let b: Acumulado | undefined;
    if (a.variantCode) {
      b = gBc.get(k);
      if (b) usadas.add(k);
    } else if (candidatas && candidatas.size) {
      b = fundir([...candidatas.values()]);
      for (const v of candidatas.keys()) usadas.add(claveLinea(a.itemNo, v));
    }
    const nombre = a.descripcion || a.itemNo;
    const conVariante = a.variantCode ? `${a.itemNo} · variante ${a.variantCode}` : a.itemNo;
    if (!b) {
      diferencias.push({
        clase: "falta_en_bc",
        itemNo: a.itemNo, variantCode: a.variantCode, descripcion: nombre,
        cantidadApp: a.cantidad, cantidadBc: 0,
        precioApp: precioDe(a), precioBc: 0,
        unidadApp: a.unidad, unidadBc: "",
        importe: a.importe,
        texto: `${nombre} (${conVariante}): la orden tiene ${cant(a.cantidad)} y en BC no hay ninguna línea de ese material — ₡${money(a.importe)} que BC no conoce.`,
      });
      continue;
    }
    // La unidad va PRIMERO: con distinta unidad, la cantidad es el mismo número
    // queriendo decir otra cosa (1 EST son 255.000 GR) y compararla no significa
    // nada. Pasa cuando BC no le pudo aplicar a la línea la unidad que mandó la app
    // — el codeunit la ignora sin avisar si el ítem no la tiene registrada.
    // Solo se compara si los dos lados la traen: la API estándar no la devuelve
    // siempre y "vacío" no es una acusación.
    if (a.unidad && b.unidad && a.unidad !== b.unidad) {
      diferencias.push({
        clase: "unidad",
        itemNo: a.itemNo, variantCode: a.variantCode, descripcion: nombre,
        cantidadApp: a.cantidad, cantidadBc: b.cantidad,
        precioApp: precioDe(a), precioBc: precioDe(b),
        unidadApp: a.unidad, unidadBc: b.unidad,
        importe: a.importe - b.importe,
        texto: `${nombre} (${conVariante}): la orden compra en ${a.unidad} y en BC la línea quedó en ${b.unidad}. Es el mismo número en otra unidad: BC va a recibir y facturar ${cant(b.cantidad)} ${b.unidad}.`,
      });
      continue;
    }
    if (Math.abs(a.cantidad - b.cantidad) > EPS_CANT) {
      diferencias.push({
        clase: "cantidad",
        itemNo: a.itemNo, variantCode: a.variantCode, descripcion: nombre,
        cantidadApp: a.cantidad, cantidadBc: b.cantidad,
        precioApp: precioDe(a), precioBc: precioDe(b),
        unidadApp: a.unidad, unidadBc: b.unidad,
        importe: a.importe - b.importe,
        texto: `${nombre} (${conVariante}): la orden dice ${cant(a.cantidad)} y BC tiene ${cant(b.cantidad)} — diferencia de ₡${money(Math.abs(a.importe - b.importe))}.`,
      });
      continue;   // con la cantidad distinta, el precio promedio ya no dice nada útil
    }
    const pa = precioDe(a), pb = precioDe(b);
    if (Math.abs(pa - pb) > EPS_PRECIO) {
      diferencias.push({
        clase: "precio",
        itemNo: a.itemNo, variantCode: a.variantCode, descripcion: nombre,
        cantidadApp: a.cantidad, cantidadBc: b.cantidad,
        precioApp: pa, precioBc: pb,
        unidadApp: a.unidad, unidadBc: b.unidad,
        importe: a.importe - b.importe,
        texto: `${nombre} (${conVariante}): la orden lo compra a ₡${money(pa)} y en BC está a ₡${money(pb)} — ₡${money(Math.abs(a.importe - b.importe))} de diferencia en la línea.`,
      });
    }
  }

  for (const [k, b] of gBc) {
    if (usadas.has(k)) continue;
    const nombre = b.descripcion || b.itemNo;
    const conVariante = b.variantCode ? `${b.itemNo} · variante ${b.variantCode}` : b.itemNo;
    diferencias.push({
      clase: "sobra_en_bc",
      itemNo: b.itemNo, variantCode: b.variantCode, descripcion: nombre,
      cantidadApp: 0, cantidadBc: b.cantidad,
      precioApp: 0, precioBc: precioDe(b),
      unidadApp: "", unidadBc: b.unidad,
      importe: b.importe,
      texto: `${nombre} (${conVariante}): BC tiene ${cant(b.cantidad)} y la orden no lo lleva — ₡${money(b.importe)} que alguien agregó en BC.`,
    });
  }

  // Cargos: solo se verifica que estén. Cantidad y precio los reescribe BC al
  // repartir el cargo entre las líneas, así que compararlos daría falsos positivos.
  if (!soloArticulos) {
    const cargosApp = agrupar((app ?? []).filter((l) => l.tipo === "cargo"));
    const cargosBc = agrupar((bc ?? []).filter((l) => l.tipo === "cargo"));
    for (const [k, a] of cargosApp) {
      if (cargosBc.has(k)) continue;
      diferencias.push({
        clase: "falta_en_bc",
        itemNo: a.itemNo, variantCode: "", descripcion: a.descripcion,
        cantidadApp: a.cantidad, cantidadBc: 0, precioApp: precioDe(a), precioBc: 0,
        unidadApp: a.unidad, unidadBc: "",
        importe: a.importe,
        texto: `Cargo ${a.descripcion} (${a.itemNo}): está en la orden y no en BC — ₡${money(a.importe)}.`,
      });
    }
  }

  // Orden del reporte: primero lo que falta en BC (es lo que descuadra la factura),
  // después lo que sobra, después los números que no coinciden. Dentro de cada
  // grupo, la plata más grande arriba.
  const peso: Record<ClaseDiferencia, number> = { falta_en_bc: 0, unidad: 1, sobra_en_bc: 2, cantidad: 3, precio: 4 };
  diferencias.sort((x, y) => peso[x.clase] - peso[y.clase] || Math.abs(y.importe) - Math.abs(x.importe));

  const importeEnJuego = diferencias.reduce((s, d) => s + Math.abs(d.importe), 0);
  const faltan = diferencias.filter((d) => d.clase === "falta_en_bc").length;
  const resumen = diferencias.length === 0
    ? ""
    : faltan
      ? `Business Central NO tiene ${faltan} línea(s) de esta orden (₡${money(importeEnJuego)} en juego). Si se recibe así, BC va a registrar de menos y el material no va a entrar al inventario.`
      : `La orden y el pedido en Business Central no coinciden en ${diferencias.length} línea(s) — ₡${money(importeEnJuego)} de diferencia.`;

  return {
    ok: diferencias.length === 0,
    diferencias,
    lineasApp: artApp.length,
    lineasBc: artBc.length,
    importeEnJuego,
    resumen,
  };
}

// ── Cotejo contra lo que BC REGISTRÓ (no contra el pedido) ────────────────────
// Cuando la orden ya se completó, BC borra el pedido de compra: no queda contra qué
// comparar. Lo que sí queda son los documentos registrados (factura de compra,
// recepción). Esta variante compara lo que la app dice que recibió/facturó contra
// las líneas del documento registrado en BC.
//
// Se compara con la MISMA función: lo registrado tiene la misma forma (artículo,
// variante, cantidad, precio). La diferencia es qué se le pasa como "app": no la
// orden entera, sino lo efectivamente recibido.
export function lineasRecibidasDeOrden(lineas: (LineaApp & { cantidadRecibida?: number })[]): LineaApp[] {
  return (lineas ?? [])
    .filter((l) => l.tipo === "articulo" && (Number(l.cantidadRecibida) || 0) > 0)
    .map((l) => ({ ...l, cantidad: Number(l.cantidadRecibida) || 0 }));
}
