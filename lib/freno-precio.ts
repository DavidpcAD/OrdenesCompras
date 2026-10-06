// ════════════════════════════════════════════════════════════════════════════════
// FRENO DE PRECIO — lo que Business Central va a FACTURAR tiene que ser lo que la
// orden dice. Si no, no se registra.
//
// Por qué existe (caso real, orden 516 / pedido CP-005652, Multisuministros,
// factura 82605 del 22 sep 2026):
//   El proveedor facturó ₡241.454,10. En BC quedó registrada (CFR-010970) por
//   ₡260.318,08. El neto coincidía al céntimo —₡230.369,98— y aun así entraron
//   ₡18.864,00 de más a la cuenta por pagar: el papel higiénico (M17-0300,
//   ₡157.200) va al 1% de IVA y la línea de BC lo calculó al 13%.
//
// La app NO le manda precios a BC al registrar: el codeunit recibe N.º de artículo
// y cantidad, y BC factura con lo que tenga la línea del pedido. O sea que cualquier
// diferencia entre la orden y el pedido de allá —precio, IVA o unidad— se convierte
// en plata mal puesta SIN que nadie lo note, porque la app después muestra sus
// propios números y no los de BC. Eso ya pasó por los tres caminos:
//
//   · PRECIO   — CP-005579 (dos precios cruzados por una edición) y CP-005712
//                (precio heredado de la ficha del artículo, nunca cotizado).
//   · IVA      — CP-005814 y este CP-005652 (el % de la orden no llegó a la línea).
//   · UNIDAD   — el mismo número en otra unidad (1 EST son 255.000 GR).
//
// La regla: antes de mover un peso se compara la orden contra el pedido de BC, y si
// no dicen lo mismo NO se postea. Es el mismo criterio del freno de líneas (lo que
// BC no puede calzar no se registra) aplicado al monto en vez de a la cantidad.
//
// Frena en los TRES caminos, también en la recepción sin factura —donde el IVA
// todavía no mueve plata— por una razón de orden: apenas hay una recepción
// registrada, el codeunit se niega a reescribir las líneas del pedido
// (`AdelantePO_ReplaceOrderLines`), así que la app pierde la forma de corregirlo y
// el arreglo pasa a ser a mano en BC. Después de recibir ya es tarde.
//
// Dos cosas que este freno NO hace, a propósito:
//   · NO mira las líneas que no se están registrando ahora. Una diferencia en una
//     línea que no entra en esta factura no manda a nadie a parar un camión; para
//     eso está el cotejo completo del detalle de la orden ("Verificar contra BC").
//   · NO empuja el precio de la app a BC. Cuál de los dos lados tiene razón no se
//     puede saber desde acá —en CP-005579 el bueno era el de BC— así que se para y
//     lo decide una persona.
//
// Lo puro vive acá y se prueba en freno-precio.test.ts; lo que habla con BC es
// `frenarPorPrecio`, al final.
// ════════════════════════════════════════════════════════════════════════════════
import { codigoDeItem } from "./unidad.ts";
import { money } from "./helpers.ts";
import { bcLineasPedido, frenoPrecioActivo, lineasOrdenParaCotejo, type BcLineasPedido } from "./bc.ts";
import { COMO_EMPIEZA, type AccionRegistro } from "./freno-encabezado.ts";
import type { LineaApp, LineaBc } from "./bc-conciliacion.ts";
import type { Orden } from "./types.ts";

// Tolerancias, las mismas que usa el cotejo de la orden: medio céntimo para el
// precio (es lo que redondea BC al mostrar) y un epsilon para el IVA, que es un
// porcentaje exacto de los dos lados.
const EPS_PRECIO = 0.005;
const EPS_IVA = 1e-9;

export type ClaseDifPrecio = "precio" | "iva" | "unidad";

export type DifPrecio = {
  clase: ClaseDifPrecio;
  itemNo: string;
  descripcion: string;
  cantidad: number;     // lo que se está registrando AHORA (no lo que tiene la orden)
  app: number;          // precio unitario o IVA%, según la clase
  bc: number;
  // La plata de ESTA factura que queda mal si se registra así. Positiva = BC va a
  // facturar de más. Es el número que decide si vale la pena frenar, así que se
  // calcula sobre la cantidad que entra ahora y no sobre la línea entera.
  importe: number;
  texto: string;        // una línea lista para mostrarle a una persona
};

// Lo que se le pide a BC que registre: lo mismo que recibe el freno de líneas.
export type LineaPedida = { itemNo: string; qty: number; variantCode?: string; tipo?: string };

// Los tipos que se comparan: los que se registran por cantidad. El CARGO queda
// afuera porque BC le reescribe cantidad y precio al repartirlo entre las líneas de
// artículo — compararlo daría un falso positivo en cada orden con flete.
const COTEJABLES = new Set(["articulo", "recurso", "activo_fijo"]);
const esCotejable = (t: unknown) => COTEJABLES.has(String(t ?? "articulo").trim().toLowerCase());

const cant = (n: number) => n.toLocaleString("es-CR", { maximumFractionDigits: 5 });
const pct = (n: number) => `${n.toLocaleString("es-CR", { maximumFractionDigits: 2 })}%`;

type Junta = {
  cantidad: number; importe: number; descripcion: string;
  unidades: Set<string>;
  // Los IVA% distintos que tiene ese código. Más de uno = ambiguo: los dos lados se
  // casan por CÓDIGO (es lo único que comparten después de que el codeunit reescribe
  // las líneas), así que con el mismo artículo en dos líneas a distinto IVA no hay
  // forma de saber cuál es cuál. Mismo criterio que `ivaOrdenPorCodigo` en lib/bc.ts.
  ivas: Set<number>;
};

type Comparable = {
  tipo: string; itemNo: string; descripcion?: string;
  cantidad: number; precioUnitario: number; unidad?: string; ivaPct?: number;
};

// Junta las líneas por código de artículo. Se AGRUPA (en vez de comparar de a una)
// por lo mismo que lo hace el cotejo de la orden: un material puede repetirse en dos
// líneas —otro almacén, otra obra— y BC las guarda separadas; lo que importa es que
// la plata por unidad sea la misma de los dos lados.
function juntar(lineas: Comparable[] | undefined): Map<string, Junta> {
  const m = new Map<string, Junta>();
  for (const l of lineas ?? []) {
    if (!esCotejable(l?.tipo)) continue;
    const code = codigoDeItem(String(l?.itemNo ?? "")).trim().toUpperCase();
    if (!code) continue;
    const cantidad = Number(l?.cantidad) || 0;
    const precio = Number(l?.precioUnitario) || 0;
    const j = m.get(code) ?? {
      cantidad: 0, importe: 0, descripcion: String(l?.descripcion ?? "").trim() || code,
      unidades: new Set<string>(), ivas: new Set<number>(),
    };
    j.cantidad += cantidad;
    j.importe += cantidad * precio;
    const u = String(l?.unidad ?? "").trim().toUpperCase();
    if (u) j.unidades.add(u);
    const iva = Number(l?.ivaPct);
    if (l?.ivaPct !== undefined && l?.ivaPct !== null && Number.isFinite(iva) && iva >= 0) j.ivas.add(iva);
    m.set(code, j);
  }
  return m;
}

const precioDe = (j: Junta) => (j.cantidad > 1e-9 ? j.importe / j.cantidad : 0);
// El único valor cuando no hay ambigüedad; `undefined` cuando nadie lo dijo o cuando
// el código aparece con dos valores distintos. "No lo sé" nunca frena.
const unico = (s: Set<number> | Set<string>) => (s.size === 1 ? [...s][0] : undefined);

// ¿Lo que BC va a facturar es lo que dice la orden, para las líneas que se registran
// AHORA? Devuelve las diferencias, de la más cara a la más barata.
export function diferenciasAlPostear(
  app: LineaApp[],
  bc: LineaBc[],
  pedidas: LineaPedida[],
  moneda?: string,
): DifPrecio[] {
  const gApp = juntar(app as unknown as Comparable[]);
  const gBc = juntar(bc as unknown as Comparable[]);
  const plata = (n: number) => money(n, moneda);

  // Cuánto entra AHORA por código (un mismo artículo puede venir en dos líneas de
  // la factura: se suma, y la diferencia se reporta una sola vez).
  const ahora = new Map<string, number>();
  for (const p of pedidas ?? []) {
    const code = codigoDeItem(String(p?.itemNo ?? "")).trim().toUpperCase();
    const q = Number(p?.qty) || 0;
    if (!code || q <= 0 || !esCotejable(p?.tipo)) continue;
    ahora.set(code, (ahora.get(code) ?? 0) + q);
  }

  const out: DifPrecio[] = [];
  for (const [code, qty] of ahora) {
    const a = gApp.get(code);
    const b = gBc.get(code);
    // Que la línea no esté de un lado no es asunto de este freno: lo dice —mejor y
    // con el saldo en la mano— `verificarLineasPosteables`. Acá solo se comparan
    // montos, y para eso hacen falta los dos.
    if (!a || !b) continue;
    const nombre = a.descripcion || b.descripcion || code;
    const pa = precioDe(a), pb = precioDe(b);

    // LA UNIDAD VA PRIMERO: con distinta unidad el precio de cada lado está en otra
    // cosa y compararlo no significa nada (1 EST son 255.000 GR). Solo se compara si
    // los dos lados la dijeron sin ambigüedad: "vacío" no es una acusación.
    const ua = unico(a.unidades) as string | undefined;
    const ub = unico(b.unidades) as string | undefined;
    if (ua && ub && ua !== ub) {
      out.push({
        clase: "unidad", itemNo: code, descripcion: nombre, cantidad: qty,
        app: pa, bc: pb, importe: qty * pa,
        texto: `${nombre} (${code}): la orden compra en ${ua} y en BC la línea quedó en ${ub}. `
          + `Es el mismo número en otra unidad, así que el precio de los dos lados no se puede comparar — `
          + `y lo que BC va a facturar son ${cant(qty)} ${ub} a ${plata(pb)}.`,
      });
      continue;
    }

    // PRECIO. El de la app es el de la orden; el de BC es con el que va a facturar.
    if (Math.abs(pa - pb) > EPS_PRECIO) {
      const importe = qty * (pb - pa);
      out.push({
        clase: "precio", itemNo: code, descripcion: nombre, cantidad: qty,
        app: pa, bc: pb, importe,
        texto: `${nombre} (${code}): la orden lo compra a ${plata(pa)} y en BC la línea está a ${plata(pb)}. `
          + `Registrando ${cant(qty)}, BC va a facturar ${plata(qty * pb)} donde la orden dice ${plata(qty * pa)} — `
          + `${plata(Math.abs(importe))} de ${importe > 0 ? "más" : "menos"}.`,
      });
    }

    // IVA. No es un detalle del estimado: es el monto que entra a la cuenta por
    // pagar. El % de la orden MANDA y viaja a BC al crear o reescribir las líneas
    // (ver `ivaOrdenPorCodigo`), así que si acá no coincide es que ese empuje no
    // llegó — justo lo que pasó en CP-005652.
    const ia = unico(a.ivas) as number | undefined;
    const ib = unico(b.ivas) as number | undefined;
    if (ia !== undefined && ib !== undefined && Math.abs(ia - ib) > EPS_IVA) {
      const importe = qty * pb * (ib - ia) / 100;
      out.push({
        clase: "iva", itemNo: code, descripcion: nombre, cantidad: qty,
        app: ia, bc: ib, importe,
        texto: `${nombre} (${code}): la orden le puso ${pct(ia)} de IVA y en BC la línea calcula ${pct(ib)}. `
          + `Registrando ${cant(qty)}, son ${plata(Math.abs(importe))} de IVA de ${importe > 0 ? "más" : "menos"} `
          + `en la factura de compra.`,
      });
    }
  }

  return out.sort((x, y) => Math.abs(y.importe) - Math.abs(x.importe));
}

// El título del aviso según lo que apareció: decir "precio" cuando lo que no cuadra
// es el IVA manda a buscar donde no es.
export function tituloDeDiferencias(difs: DifPrecio[]): string {
  const clases = new Set(difs.map((d) => d.clase));
  if (clases.size === 1 && clases.has("iva")) return "el IVA que Business Central le calcula a las líneas no es el de la orden";
  if (clases.has("iva")) return "lo que Business Central va a facturar no es lo que dice la orden";
  if (clases.size === 1 && clases.has("unidad")) return "Business Central tiene las líneas en otra unidad que la orden";
  return "el precio que tiene Business Central no es el de la orden";
}

export type Freno409Precio = {
  ok: false; error: string; frenoPrecio: true;
  problemas: string[];
  diferencias: DifPrecio[];
  importeEnJuego: number;
};

// El freno, ya contra BC. Devuelve null cuando se puede seguir.
//
// `bcYaLeido` es lo que el freno de líneas acaba de leer: se reusa para no pedirle a
// BC dos veces lo mismo. Si viene `undefined` (ese freno está apagado) se lee acá.
export async function frenarPorPrecio(opts: {
  orden: Orden | null | undefined;
  orderNo: string;
  pedidas: LineaPedida[];
  accion: AccionRegistro;
  bcYaLeido?: BcLineasPedido | null;
}): Promise<Freno409Precio | null> {
  if (!frenoPrecioActivo()) return null;
  const { orden, orderNo, pedidas, accion } = opts;
  // Sin la orden no hay contra qué comparar. Pasa con los llamados viejos que no
  // mandan `ordenId`: ahí este freno no existe, como no existía antes.
  if (!orden?.lineas?.length) return null;
  if (!(pedidas ?? []).length) return null;

  const bc = opts.bcYaLeido !== undefined
    ? opts.bcYaLeido
    : await bcLineasPedido(String(orderNo ?? "")).catch(() => null);
  // Si BC no contestó no se frena: eso es un hecho sobre la red, no sobre el pedido,
  // y trabar a Bodega por eso sería el peor de los dos errores. El posteo va a fallar
  // por su propio camino si el problema es de verdad.
  if (!bc?.lineas?.length) return null;

  const difs = diferenciasAlPostear(lineasOrdenParaCotejo(orden.lineas), bc.lineas, pedidas, orden.currencyCode);
  if (!difs.length) return null;

  const importeEnJuego = difs.reduce((s, d) => s + Math.abs(d.importe), 0);
  const problemas = difs.map((d) => d.texto);
  const error = `${COMO_EMPIEZA[accion]}: ${tituloDeDiferencias(difs)} en ${difs.length} línea(s).\n\n`
    + problemas.map((p) => `• ${p}`).join("\n")
    + `\n\nSon ${money(importeEnJuego, orden.currencyCode)} que no cuadran contra la orden. `
    + `La app no le manda precios a BC al registrar: BC factura con lo que tenga la línea del pedido ${orderNo}, `
    + `así que registrarlo así deja esa plata en la cuenta por pagar del proveedor. `
    + `Corregilo en Business Central (o la orden acá, con Proveeduría) y volvé a intentar.`;
  return { ok: false, error, frenoPrecio: true, problemas, diferencias: difs, importeEnJuego };
}
