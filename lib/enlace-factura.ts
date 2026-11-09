// DE QUIÉN ES UNA FACTURA DE BC, Y CUÁL ES EL COMPROBANTE DE UNA FACTURA QUE SE DIGITA.
//
// Las dos preguntas salieron el mismo día (9 nov 2026, Kattya) y tienen la misma raíz:
// la app ya sabía algo que a la persona le tocaba ir a averiguar a mano.
//
// 1. "Dice que ya está enlazada, y solo este registro existe como pareja". En la
//    Auditoría una factura de BC respalda UN comprobante. Cuando se quiere enlazar a
//    otro, lo que hay que saber ANTES de tocar el botón —no en un aviso rojo después—
//    es a cuál está amarrada y si ese amarre tiene fundamento. El fundamento es el N.º
//    del proveedor que se digitó en BC: si es el de aquel comprobante, lo más seguro es
//    que el amarre esté bien y que este sea OTRO documento (una segunda compra, o la
//    misma factura reemitida). Los tres casos reales de ese día:
//
//      · Toyman: CFR-011784 se digitó con el N.º 102944 y está con la 102944. La 103229
//        es otro comprobante por lo mismo, sin recepción en BC. El amarre está bien.
//      · Tecni Gypsum: CFR-012135 se digitó con "704181", que no es ni la 370159 ni la
//        370418 (es un pedazo de la clave de la segunda). Ahí decide la persona.
//      · Construplaza: CFR-012042 (₡421 376,01) se digitó con el N.º 179529, que es un
//        comprobante de ₡6 912. El cotejo automático le creyó al número; la factura es
//        la 309100 y había que poder pasarla.
//
// 2. "Si le pongo otra fecha se mantiene la frase". En Registrar factura, la fecha de la
//    factura la teclea una persona y el "coincide ✓" solo comparaba dos campos que ella
//    misma llenó. El comprobante que mandó el proveedor está en el correo, con su fecha
//    de emisión: con eso se verifica en vez de confiar.
import { colasDelConsecutivo, seParecen } from "./cruce-correo-bc.ts";
import { normalizarNumero, soloDigitos } from "./vigilancia-facturas.ts";

/**
 * ¿El N.º del proveedor que se digitó en BC es el de este comprobante?
 *
 * Usa las mismas colas que el cotejo automático (`colasDelConsecutivo`), así que
 * contesta exactamente "¿esto calzaría solo por número?". Sirve para explicar un
 * amarre, no para hacerlo: el proveedor ya viene dado por el comprobante.
 */
export function numeroDigitadoEs(consecutivo: string, numeroProveedor: string | null | undefined): boolean {
  const n = normalizarNumero(numeroProveedor ?? "");
  if (!n) return false;
  return colasDelConsecutivo(consecutivo).includes(n);
}

/** "TORNILLOS TOYMAN S. A." + "." daba "S. A.." en el aviso. */
export const sinPuntoFinal = (s: string | null | undefined): string =>
  String(s ?? "").replace(/[\s.]+$/, "");

/** Lo que el diálogo necesita saber del comprobante que hoy tiene la factura de BC. */
export type DuennoEnlace = {
  clave: string;
  consecutivo: string;
  nombreEmisor: string;
  fechaEmision: string;
  total: number;
  moneda: string;
  /** cedula | nombre = lo amarró el cotejo automático; manual = una persona. */
  bcCalzePor: string | null;
  revisadoPor: string | null;
  /** En BC se digitó el N.º de ESE comprobante: el amarre tiene fundamento. */
  numeroEsDeEl: boolean;
};

/** Un comprobante al que se le podría pasar la factura de BC (mismo emisor, sin enlazar). */
export type OtroComprobante = {
  clave: string;
  consecutivo: string;
  tipoDoc: string;
  fechaEmision: string;
  total: number;
  moneda: string;
  nota: string | null;
  /** En BC se digitó el N.º de ESTE: si aparece, es casi seguro el bueno. */
  numeroEsDeEl: boolean;
};

// Los tipos que pueden ser una factura de compra en BC: factura (01), nota de débito
// (02), tiquete (04), factura de compra (08) y de exportación (09). La nota de crédito
// (03) NO — lo mismo que en lib/candidatos-bc.ts.
export const TIPOS_FACTURA = ["01", "02", "04", "08", "09"] as const;
const ES_FACTURA = new Set<string>(TIPOS_FACTURA);

export type ComprobanteBuscable = {
  clave: string;
  consecutivo: string;
  tipoDoc: string;
  cedulaEmisor: string;
  nombreEmisor: string;
};

/** Lo que Registrar factura necesita del comprobante del correo. */
export type ComprobanteDeFactura = {
  consecutivo: string;
  fechaEmision: string;
  total: number;
  moneda: string;
  nombreEmisor: string;
};

/**
 * El comprobante del correo que corresponde al N.º de factura que se está digitando.
 *
 * Se acepta lo que la gente teclea de verdad: la cola ("731655"), con letras o ceros
 * adelante ("F-0731655"), el consecutivo de 20 o la clave de 50. SIEMPRE amarrado al
 * proveedor —por cédula si se tiene, si no por nombre—, porque una cola corta sola
 * calza con cualquier cosa (el 81239 de Multisuministros calzaba con EASYBOX).
 *
 * Si hay más de uno que calce, devuelve null: no adivina. Una fecha equivocada
 * sugerida con seguridad es peor que no sugerir nada.
 */
export function comprobanteDeNumero<T extends ComprobanteBuscable>(
  filas: T[],
  numero: string,
  proveedor: { nombre?: string | null; cedula?: string | null },
): T | null {
  const d = soloDigitos(numero);
  const n = normalizarNumero(numero);
  if (n.length < 4) return null;
  const ced = soloDigitos(proveedor.cedula ?? "");
  const nombre = String(proveedor.nombre ?? "").trim();
  if (ced.length < 9 && !nombre) return null;

  const delProveedor = (f: T) =>
    (ced.length >= 9 && soloDigitos(f.cedulaEmisor) === ced) ||
    (!!nombre && seParecen(f.nombreEmisor, nombre));

  const calzan = filas.filter((f) =>
    ES_FACTURA.has(f.tipoDoc) &&
    delProveedor(f) &&
    (f.clave === d || soloDigitos(f.consecutivo) === d || colasDelConsecutivo(f.consecutivo).includes(n)));

  return calzan.length === 1 ? calzan[0] : null;
}

// ---------------------------------------------------------------------------
// FACTURAS ANULADAS EN BC
//
// Una factura de compra anulada con nota de crédito por el total sigue apareciendo en
// BC como "registrada", y el cotejo del correo la tomaba como el registro del
// comprobante. Medido el 9 nov 2026: 268 facturas de BC están en cero por una NC, y 6
// comprobantes de la Auditoría estaban "descuadrados" contra una de ellas — entre
// ellos la 179529 de Construplaza contra CFR-012042, que Contabilidad había anulado
// con "NCI-179529" porque se registró con el número equivocado.

export type NotaQueAnula = { numero: string; numeroProveedor: string; fecha: string; total: number; aplicaA: string };

/**
 * Las facturas de BC que las notas de crédito registradas dejan en cero, cada una
 * con las notas que la anulan. Una nota parcial (un descuento, una línea devuelta)
 * no anula: la factura sigue siendo el registro del comprobante.
 */
export function facturasAnuladas(
  facturas: { numero: string; total: number }[],
  notas: NotaQueAnula[],
): Map<string, NotaQueAnula[]> {
  const porFactura = new Map<string, NotaQueAnula[]>();
  for (const n of notas) {
    if (!n.aplicaA) continue;
    const g = porFactura.get(n.aplicaA);
    if (g) g.push(n); else porFactura.set(n.aplicaA, [n]);
  }
  const out = new Map<string, NotaQueAnula[]>();
  for (const f of facturas) {
    const ns = porFactura.get(f.numero);
    if (!ns || f.total <= 0) continue;
    const credito = ns.reduce((s, n) => s + n.total, 0);
    if (credito >= f.total - 0.5) out.set(f.numero, ns);
  }
  return out;
}
