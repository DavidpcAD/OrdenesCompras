// ════════════════════════════════════════════════════════════════════════════════
// CORREGIR EL PRECIO de una orden que ya tiene material recibido.
//
// Por qué existe: Bodega recibe material sin factura, la factura llega con otro
// precio y la orden ya no se puede tocar. "Volver a abrir" está bloqueado con
// recepciones porque el editor BORRA y reinserta las líneas —en la base y en BC, con
// AdelantePO_ReplaceOrderLines—, y eso dejaría las recepciones apuntando a líneas que
// ya no existen (BC, además, lo rechaza). Corregir solo en BC tampoco sirve: el freno
// de precio para a Contabilidad porque la orden y el pedido ya no dicen lo mismo.
//
// Lo que sí sirve, y es lo que hace este camino: cambiar el precio EN SU LUGAR, de
// los dos lados, antes de que se registre la factura. En BC lo hace
// AdelantePO_UpdateLinePrices (AdelanteAPI 1.2.31.0); BC lleva la diferencia a lo que
// ya salió a las obras con su ajuste de costo. Corregir DESPUÉS de facturar, con una
// nota de crédito, es lo que deja una obra cargando el precio viejo: la nota baja el
// costo de la compra, pero el consumo de la casa no se entera hasta que alguien
// corre el ajuste de costo y la actualización del costo del proyecto.
//
// Todo acá es PURO (sin red, sin SQL): ver corregir-precio.test.ts.
// ════════════════════════════════════════════════════════════════════════════════

import { claveLinea, type LineaBc } from "./bc-conciliacion.ts";
import { codigoDeItem } from "./unidad.ts";
import { num, precioUnit } from "./helpers.ts";
import type { Orden, OrdenLinea } from "./types.ts";

// Lo que la pantalla pide: el precio nuevo de cada línea, en la moneda de la orden.
export type CambioPrecio = { ordenLineaId: string; precio: number };
// Ya validado: la línea, el precio de antes y el nuevo.
export type CambioValidado = { linea: OrdenLinea; antes: number; nuevo: number };
// Lo que viaja al codeunit: la línea EXACTA del pedido y el precio que se leyó allá.
export type LineaPrecioBc = { lineNo: number; itemNo: string; directUnitCost: number; expectedCost: number };

// Hasta 4 decimales: es lo que guarda la base (OrdenCompraDet.directUnitCost es
// DECIMAL(18,4)) y BC acepta eso y más. Con un quinto decimal BC quedaría con un precio
// y la base con otro, y el freno de precio pararía a Contabilidad por la diferencia.
// Un precio "todo incluido" (material + flete + impuestos, repartido entre las
// unidades) suele necesitar 4 para que el total cuadre al céntimo con la factura.
export const DECIMALES_PRECIO = 4;
const MOTIVO_MINIMO = 5;
const IGUAL = 1e-6;

// Los estados en los que tiene sentido: la orden ya existe en BC. Un borrador o una
// orden abierta sin recepciones se corrige con Editar, como siempre.
const ESTADOS_CORREGIBLES: Orden["estado"][] = ["lanzado", "pendiente_aprobacion", "abierto"];

// Por qué una línea NO se puede corregir por acá, o null si sí se puede.
export function motivoNoCorregible(l: OrdenLinea): string | null {
  if (l.tipo === "cargo") return "es un cargo de producto: su precio se maneja aparte";
  const cant = Number(l.cantidad) || 0;
  if (cant > 0 && (Number(l.cantidadFacturada) || 0) >= cant - IGUAL) {
    return "ya está facturada completa: su precio quedó en la factura";
  }
  return null;
}

export function lineasCorregibles(o: Pick<Orden, "lineas">): OrdenLinea[] {
  return (o.lineas ?? []).filter((l) => motivoNoCorregible(l) === null);
}

// ¿Se muestra el botón? Con material recibido (que es cuando Editar no sirve), con
// pedido en BC y con al menos una línea que todavía se pueda corregir.
export function puedeCorregirPrecio(o: Pick<Orden, "estado" | "bcNumber" | "lineas">, tieneRecepciones: boolean): boolean {
  return tieneRecepciones && !!String(o.bcNumber ?? "").trim()
    && ESTADOS_CORREGIBLES.includes(o.estado) && lineasCorregibles(o).length > 0;
}

function decimales(n: number): number {
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1]) || 99;
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

// Valida lo que mandó la pantalla contra la orden. El servidor lo vuelve a correr
// con la orden recién leída: la pantalla puede tener datos de hace un rato.
export function validarCorreccionPrecio(
  orden: Pick<Orden, "estado" | "bcNumber" | "lineas">,
  cambios: CambioPrecio[] | null | undefined,
  motivo: string | null | undefined,
): { error?: string; cambios: CambioValidado[] } {
  const no = (error: string) => ({ error, cambios: [] as CambioValidado[] });
  if (!String(orden.bcNumber ?? "").trim()) {
    return no("Esta orden no tiene pedido en Business Central: el precio se corrige con Editar, como siempre.");
  }
  if (!ESTADOS_CORREGIBLES.includes(orden.estado)) {
    return no(`La orden está "${orden.estado}": el precio solo se corrige en una orden enviada, lanzada o abierta con material recibido.`);
  }
  if (String(motivo ?? "").trim().length < MOTIVO_MINIMO) {
    return no("Escribí por qué cambia el precio (por ejemplo, el N.º de la factura del proveedor): queda en la bitácora de la orden.");
  }
  const vistos = new Set<string>();
  const salida: CambioValidado[] = [];
  for (const c of cambios ?? []) {
    const id = String(c?.ordenLineaId ?? "");
    if (vistos.has(id)) return no("La misma línea vino dos veces. Recargá la página y volvé a intentarlo.");
    vistos.add(id);
    const linea = (orden.lineas ?? []).find((l) => String(l.id) === id);
    if (!linea) return no("Una de las líneas ya no está en la orden. Recargá la página y volvé a intentarlo.");
    const porQue = motivoNoCorregible(linea);
    if (porQue) return no(`«${linea.descripcion}»: ${porQue}.`);
    const nuevo = Number(c?.precio);
    if (!Number.isFinite(nuevo) || nuevo <= 0) return no(`«${linea.descripcion}»: el precio nuevo tiene que ser mayor que cero.`);
    if (decimales(nuevo) > DECIMALES_PRECIO) return no(`«${linea.descripcion}»: el precio lleva más de ${DECIMALES_PRECIO} decimales y Business Central no los guarda.`);
    const antes = Number(linea.precioUnitario) || 0;
    if (Math.abs(nuevo - antes) <= IGUAL) continue;   // sin cambio: no viaja
    salida.push({ linea, antes, nuevo });
  }
  if (!salida.length) return no("No cambió ningún precio: escribí el precio nuevo en la línea que hay que corregir.");
  return { cambios: salida };
}

// Cada línea que se corrige, apareada con SU línea del pedido en BC. Mismo artículo,
// variante, tipo y cantidad; entre varias iguales manda la que tiene el precio que la
// orden decía (así dos líneas con los precios cruzados no se pisan), y cada línea
// de BC se usa una sola vez. Lo que se leyó allá viaja como `expectedCost`: si alguien
// lo cambia en el medio, el codeunit no toca nada.
export function emparejarConBc(
  cambios: CambioValidado[],
  lineasBc: LineaBc[],
  orderNo: string,
): { error?: string; lineas: LineaPrecioBc[]; avisos: string[] } {
  const usadas = new Set<number>();
  const lineas: LineaPrecioBc[] = [];
  const avisos: string[] = [];
  for (const c of cambios) {
    const l = c.linea;
    const itemNo = String(l.articuloId ?? "");
    const clave = claveLinea(itemNo, l.variantCode);
    const cant = Number(l.cantidad) || 0;
    const candidatas = lineasBc.filter((b) => !usadas.has(b.lineNo)
      && b.tipo === l.tipo
      && claveLinea(b.itemNo, b.variantCode) === clave
      && Math.abs((Number(b.cantidad) || 0) - cant) <= 1e-4);
    if (!candidatas.length) {
      return {
        error: `«${l.descripcion}» (${codigoDeItem(itemNo)}) no está en el pedido ${orderNo} de Business Central con ${num.format(cant)} ${l.unidad ?? ""}. `
          + "Usá «Verificar contra BC» para ver qué tiene el pedido allá.",
        lineas: [], avisos: [],
      };
    }
    const elegida = candidatas.find((b) => Math.abs(b.precioUnitario - c.antes) < 0.005)
      ?? candidatas.find((b) => Math.abs(b.precioUnitario - c.nuevo) < 0.005)
      ?? candidatas[0];
    if ((Number(elegida.facturada) || 0) >= (Number(elegida.cantidad) || 0) - IGUAL && (Number(elegida.cantidad) || 0) > 0) {
      return { error: `«${l.descripcion}»: en Business Central ya está facturada completa, así que su precio ya quedó en la factura.`, lineas: [], avisos: [] };
    }
    if (Math.abs(elegida.precioUnitario - c.antes) >= 0.005) {
      avisos.push(`«${l.descripcion}» en BC estaba a ${num.format(elegida.precioUnitario)} (la orden decía ${num.format(c.antes)})`);
    }
    usadas.add(elegida.lineNo);
    lineas.push({ lineNo: elegida.lineNo, itemNo: codigoDeItem(String(elegida.itemNo || itemNo)), directUnitCost: c.nuevo, expectedCost: elegida.precioUnitario });
  }
  return { lineas, avisos };
}

// El precio con todos sus decimales (ver precioUnit en helpers).
export function precioTxt(n: number, currencyCode?: string): string {
  return precioUnit(n, currencyCode);
}

// El renglón de la bitácora: qué línea, de cuánto a cuánto y por qué. El MOTIVO va
// siempre al final (lo que escribió la persona puede traer cualquier cosa): `extras`
// —avisos, si se relanzó— van antes. El formato es fijo porque las VERSIONES de una
// recepción se arman releyéndolo (leerCorreccionPrecio, lib/versiones-recepcion.ts).
export const PREFIJO_CORRECCION = "Precio corregido · ";
// El tipo del movimiento en la bitácora de la ORDEN (lo escribe corregirPreciosOrden).
export const MOV_PRECIO_CORREGIDO = "precio_corregido";
const SEP = " · ";
const MOTIVO = "Motivo: ";
export function detalleCorreccion(cambios: CambioValidado[], motivo: string, currencyCode?: string, extras: string[] = []): string {
  const lineas = cambios.map((c) => {
    const cod = codigoDeItem(String(c.linea.articuloId ?? ""));
    const desc = String(c.linea.descripcion ?? "").replace(/\s*·\s*/g, " - ");
    return `${desc}${cod ? ` (${cod})` : ""}: ${precioTxt(c.antes, currencyCode)} → ${precioTxt(c.nuevo, currencyCode)}`;
  });
  const m = String(motivo ?? "").replace(/\s+/g, " ").trim();
  return [PREFIJO_CORRECCION + lineas.join(SEP), ...extras.filter(Boolean), MOTIVO + m].join(SEP).slice(0, 1000);
}

// "₡1 234,5678" → 1234.5678. Es el formato que escribe precioTxt (es-CR: coma decimal y
// espacio de miles); cualquier otro símbolo de moneda se descarta.
export function leerMonto(txt: string): number {
  const t = String(txt ?? "").replace(/[^0-9,\-]/g, "").replace(",", ".");
  return t ? Number(t) : Number.NaN;
}

// Lo contrario de detalleCorreccion. También entiende el formato del primer día
// (10 nov 2026), cuando el "relanzada…" iba DESPUÉS del motivo. Null si el detalle no
// es de una corrección de precio.
export type CorreccionLeida = {
  cambios: { descripcion: string; codigo: string; antesTxt: string; nuevoTxt: string; antes: number; nuevo: number }[];
  motivo: string;
};
const COLAS_VIEJAS = [/^relanzada en Business Central/, /^el pedido quedó Abierto/];
export function leerCorreccionPrecio(detalle: string | null | undefined): CorreccionLeida | null {
  const t = String(detalle ?? "");
  if (!t.startsWith(PREFIJO_CORRECCION)) return null;
  const partes = t.slice(PREFIJO_CORRECCION.length).split(SEP);
  const cambios: CorreccionLeida["cambios"] = [];
  let motivo = "";
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i];
    if (p.startsWith(MOTIVO)) {
      const resto: string[] = [p.slice(MOTIVO.length)];
      for (let j = i + 1; j < partes.length && !COLAS_VIEJAS.some((re) => re.test(partes[j])); j++) resto.push(partes[j]);
      motivo = resto.join(SEP).trim();
      break;
    }
    const m = /^(.*) \(([^()]+)\): (.+?) → (.+)$/.exec(p);
    if (m) {
      const antes = leerMonto(m[3]); const nuevo = leerMonto(m[4]);
      if (Number.isFinite(antes) && Number.isFinite(nuevo)) {
        cambios.push({ descripcion: m[1], codigo: m[2], antesTxt: m[3], nuevoTxt: m[4], antes, nuevo });
      }
    }
  }
  return cambios.length ? { cambios, motivo } : null;
}

// La orden como quedaría con los precios nuevos (para recalcular totales y decidir
// si vuelve a lanzarse sola o pasa por aprobación).
export function ordenConPrecios<T extends Pick<Orden, "lineas">>(o: T, cambios: { ordenLineaId: string; precio: number }[]): T {
  const p = new Map(cambios.map((c) => [String(c.ordenLineaId), Number(c.precio)]));
  return { ...o, lineas: o.lineas.map((l) => (p.has(String(l.id)) ? { ...l, precioUnitario: p.get(String(l.id))! } : l)) };
}
