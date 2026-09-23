// EL CRUCE: los comprobantes que llegaron al correo contra las facturas de BC.
//
// Esta es la pregunta que originó todo: de lo que entra al buzón de facturación, ¿qué
// se registró en Business Central y qué no? Y al revés: ¿qué se registró en BC sin que
// llegara comprobante?
//
// La llave buena es la CÉDULA DEL EMISOR, y viaja gratis: la clave de 50 dígitos de
// todo comprobante electrónico costarricense la lleva adentro. Cruzar por el número de
// factura pelado NO sirve — probado: el 81239 de Multisuministros calza con una factura
// de EASYBOX, y el 173 de Frederick Vega con una de Estefanny Barrantes. Por eso acá
// nada calza sin que el PROVEEDOR coincida.
//
// El monto no se usa para descartar sino para avisar: si el número y el proveedor
// calzan pero el total difiere, eso no es "no está", es "está mal", y son dos problemas
// distintos con dos dueños distintos.

import type { FacturaBc, ProveedorBc } from "./vigilancia-facturas.ts";
import { normalizarNumero, soloDigitos } from "./vigilancia-facturas.ts";

// La cédula jurídica de Adelante Desarrollos S.A. Sirve para botar lo que llega al
// buzón a nombre de las empresas hermanas (Nogal, ARNA BR, GTI, LLB…), que es bastante:
// el mismo correo recibe comprobantes de todo el grupo y sin este filtro la lista de
// "no está en BC" se llenaría de facturas que NUNCA debieron estar en esta compañía.
export const CEDULA_ADELANTE = "3101621790";

export type Comprobante = {
  clave: string;            // los 50 dígitos
  consecutivo: string;      // los 20 del medio
  tipo: string;             // "01" factura · "02" nota de débito · "03" nota de crédito · "08" FEC
  cedulaEmisor: string;
  nombreEmisor: string;
  cedulaReceptor: string;
  fecha: string;            // YYYY-MM-DD
  total: number;
  moneda: string;
  // De dónde salió, para poder volver al correo desde la pantalla.
  archivo?: string;
};

export const TIPOS: Record<string, string> = {
  "01": "Factura electrónica",
  "02": "Nota de débito",
  "03": "Nota de crédito",
  "04": "Tiquete electrónico",
  "08": "Factura de compra",
  "09": "Factura de exportación",
};

// ---------------------------------------------------------------------------
// La clave de 50 dígitos
// ---------------------------------------------------------------------------

/**
 * Parte la clave numérica de Hacienda:
 *
 *   506 | 220926 | 003101299788 | 00100001010000590464 | 1 | 34288884
 *   país  ddmmaa   cédula emisor  consecutivo (20)       sit  seguridad
 *
 * Sale gratis del nombre del adjunto, que por convención de Hacienda ES la clave. O sea
 * que para saber quién emitió y con qué número no hace falta ni abrir el XML.
 */
export function partirClave(clave: string): { cedulaEmisor: string; consecutivo: string; tipo: string; fecha: string } | null {
  const d = soloDigitos(clave);
  if (d.length !== 50) return null;
  const dd = d.slice(3, 5), mm = d.slice(5, 7), aa = d.slice(7, 9);
  const consecutivo = d.slice(21, 41);
  return {
    // La cédula viene rellena con ceros a 12 posiciones; la de verdad son 9 o 10.
    cedulaEmisor: d.slice(9, 21).replace(/^0+/, ""),
    consecutivo,
    tipo: consecutivo.slice(8, 10),
    fecha: `20${aa}-${mm}-${dd}`,
  };
}

// ---------------------------------------------------------------------------
// Leer el XML
// ---------------------------------------------------------------------------

// En XML, `&` `<` `>` `"` y `'` viajan escapados. Sin deshacerlo, "PIMMSA PINTURAS
// MACA & MONTENEGRO" se mostraba en pantalla como "MACA &amp; MONTENEGRO" — es el
// precio de leer con expresiones regulares en vez de un parser, y se paga acá.
const desescapar = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
   // `&amp;` va de ÚLTIMO a propósito: si se deshiciera primero, un `&amp;lt;` del
   // origen se convertiría en `<` y cambiaría el texto.
   .replace(/&amp;/g, "&");

// Saca el contenido de una etiqueta TAL CUAL, sin tocar las entidades. Los XML de
// Hacienda vienen con y sin prefijo de espacio de nombres según el proveedor de
// facturación que los emita, así que se tolera cualquier prefijo.
const crudo = (xml: string, nombre: string): string => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nombre}>([\\s\\S]*?)</(?:\\w+:)?${nombre}>`, "i"));
  return m ? m[1].trim() : "";
};

// Un BLOQUE (Emisor, Receptor, ResumenFactura) se saca crudo porque adentro todavía
// hay etiquetas que leer. Desescaparlo acá haría que el texto de adentro se
// desescapara DOS veces, y un `&amp;lt;` del origen terminaría convertido en `<`.
const bloque = crudo;

// Un VALOR de texto sí se desescapa, una sola vez, al leerlo.
const etiqueta = (xml: string, nombre: string): string => desescapar(crudo(xml, nombre));

/**
 * Saca de un XML de comprobante electrónico lo que hace falta para cruzar.
 *
 * Se lee con expresiones regulares y no con un parser de verdad a propósito: son seis
 * campos de un formato que define Hacienda y que no cambia, y meter una dependencia de
 * XML para eso sería cargar el proyecto con algo que hay que mantener. Si algún día se
 * necesitan las LÍNEAS del comprobante, ahí sí toca un parser.
 *
 * Devuelve null si no es un comprobante (los correos también traen el XML de respuesta
 * de Hacienda, que es otro documento y no lleva clave de emisor propia).
 */
export function leerComprobanteXml(xml: string, archivo?: string): Comprobante | null {
  if (!xml || !/Clave/i.test(xml)) return null;
  // El mensaje de respuesta de Hacienda (MensajeReceptor / MensajeHacienda) trae una
  // Clave pero NO es un comprobante: es el acuse. Si se cuela, cada factura aparecería
  // dos veces.
  if (/<(?:\w+:)?Mensaje(?:Receptor|Hacienda)/i.test(xml)) return null;

  const clave = soloDigitos(etiqueta(xml, "Clave"));
  const partes = partirClave(clave);
  if (!partes) return null;

  const emisor = bloque(xml, "Emisor");
  const receptor = bloque(xml, "Receptor");
  const resumen = bloque(xml, "ResumenFactura");

  const total = Number(etiqueta(resumen || xml, "TotalComprobante") || 0) || 0;
  const moneda = etiqueta(resumen || xml, "CodigoMoneda") || "CRC";

  return {
    clave,
    consecutivo: soloDigitos(etiqueta(xml, "NumeroConsecutivo")) || partes.consecutivo,
    tipo: partes.tipo,
    cedulaEmisor: partes.cedulaEmisor,
    nombreEmisor: etiqueta(emisor, "Nombre"),
    cedulaReceptor: soloDigitos(etiqueta(bloque(receptor, "Identificacion"), "Numero")),
    fecha: (etiqueta(xml, "FechaEmision") || "").slice(0, 10) || partes.fecha,
    total,
    // En los XML la moneda viene en ISO (CRC, USD, EUR) pero BC usa su propio código y
    // al euro le dice EURO. Se normaliza acá para que los montos se comparen.
    moneda: moneda === "EUR" ? "EURO" : moneda,
    archivo,
  };
}

// ---------------------------------------------------------------------------
// El cruce
// ---------------------------------------------------------------------------

export type Calzada = {
  comprobante: Comprobante;
  factura: FacturaBc;
  /** Cuánto difiere el total de BC contra el del comprobante. 0 = cuadra. */
  diferencia: number;
  /** Cómo se encontró: por cédula (fuerte) o por nombre del proveedor (flojo). */
  por: "cedula" | "nombre";
};

export type Cruce = {
  calzadas: Calzada[];
  descuadradas: Calzada[];
  soloEnCorreo: Comprobante[];
  soloEnBc: FacturaBc[];
  otrasEmpresas: Comprobante[];
  /** El tramo de fechas que de verdad se puede comparar (ver la nota de abajo). */
  ventana: { desde: string; hasta: string } | null;
};

const limpiaNombre = (s: string) =>
  String(s ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\b(S A|SA|SRL|S R L|LTDA|SOCIEDAD|ANONIMA|LIMITADA|DE|DEL|LA|EL|Y|CR|COSTA|RICA)\b/g, " ")
    .replace(/\s+/g, " ").trim();

function seParecen(a: string, b: string): boolean {
  const A = new Set(limpiaNombre(a).split(" ").filter((w) => w.length > 3));
  const B = new Set(limpiaNombre(b).split(" ").filter((w) => w.length > 3));
  if (!A.size || !B.size) return false;
  let comunes = 0;
  for (const w of A) if (B.has(w)) comunes++;
  return comunes / Math.min(A.size, B.size) >= 0.5;
}

// Un céntimo de diferencia es redondeo; cuatro colones ya es otra cosa. El caso real:
// el comprobante de Consultoría e Inversiones Esmeralda decía ₡140.698,44 y en BC quedó
// ₡140.702,38 — ₡3,94 que alguien tecleó distinto.
const CUADRA = (a: number, b: number) => Math.abs(a - b) <= 0.5;

/**
 * Cruza los comprobantes del correo contra las facturas de BC.
 *
 * VENTANA: solo se comparan las facturas de BC que caen dentro del tramo de fechas que
 * cubren los comprobantes. Sin esto, cargar una semana de correo haría aparecer un año
 * entero de facturas de BC como "no llegó comprobante", que es mentira — simplemente no
 * se cargó ese correo. Un detector que acusa en falso deja de leerse.
 */
export function cruzar(
  comprobantes: Comprobante[],
  facturas: FacturaBc[],
  proveedores: ProveedorBc[],
  opts: { cedulaEmpresa?: string; margenDias?: number } = {},
): Cruce {
  const cedulaEmpresa = soloDigitos(opts.cedulaEmpresa ?? CEDULA_ADELANTE);
  // BC suele registrar con la fecha del documento, pero a veces la digitación cae días
  // después y el contador usa la fecha de registro. El margen evita que eso saque una
  // factura de la ventana.
  const margen = opts.margenDias ?? 5;

  // Lo que no viene a nombre de esta compañía se aparta antes de cualquier cosa.
  const mios: Comprobante[] = [], otrasEmpresas: Comprobante[] = [];
  for (const c of comprobantes) {
    // Un comprobante sin cédula de receptor legible no se puede descartar con certeza,
    // así que se deja pasar: es preferible revisarlo de más que perderlo.
    if (c.cedulaReceptor && soloDigitos(c.cedulaReceptor) !== cedulaEmpresa) otrasEmpresas.push(c);
    else mios.push(c);
  }

  const fechas = mios.map((c) => c.fecha).filter(Boolean).sort();
  const ventana = fechas.length
    ? { desde: corre(fechas[0], -margen), hasta: corre(fechas[fechas.length - 1], margen) }
    : null;

  const cedulaDeProveedor = new Map<string, string>();   // PROV-xxx -> cédula
  const proveedorDeCedula = new Map<string, string>();   // cédula -> PROV-xxx
  for (const p of proveedores) {
    const ced = soloDigitos(p.cedula);
    if (ced.length >= 9) { cedulaDeProveedor.set(p.codigo, ced); proveedorDeCedula.set(ced, p.codigo); }
  }

  const enVentana = (f: FacturaBc) =>
    !ventana || (f.fecha >= ventana.desde && f.fecha <= ventana.hasta);

  // Índice por número normalizado, solo de lo que cae en la ventana.
  const porNumero = new Map<string, FacturaBc[]>();
  for (const f of facturas) {
    if (!enVentana(f)) continue;
    const k = normalizarNumero(f.numeroProveedor);
    if (!k) continue;
    const g = porNumero.get(k);
    if (g) g.push(f); else porNumero.set(k, [f]);
  }

  const usadas = new Set<string>();
  const calzadas: Calzada[] = [], descuadradas: Calzada[] = [], soloEnCorreo: Comprobante[] = [];

  for (const c of mios) {
    const candidatas = colasDelConsecutivo(c.consecutivo)
      .flatMap((k) => porNumero.get(k) ?? [])
      .filter((f) => !usadas.has(f.numero));

    const provEsperado = proveedorDeCedula.get(c.cedulaEmisor);
    // Primero por cédula, que es la llave que no miente. Solo si el proveedor de BC no
    // tiene cédula registrada se cae al nombre, y eso queda marcado en el resultado.
    let elegida = candidatas.find((f) => provEsperado && f.proveedorCodigo === provEsperado);
    let por: "cedula" | "nombre" = "cedula";
    if (!elegida) {
      elegida = candidatas.find((f) => !cedulaDeProveedor.has(f.proveedorCodigo) && seParecen(c.nombreEmisor, f.proveedorNombre));
      por = "nombre";
    }

    if (!elegida) { soloEnCorreo.push(c); continue; }
    usadas.add(elegida.numero);
    const mismaMoneda = elegida.moneda === c.moneda;
    const diferencia = mismaMoneda ? redondear(elegida.total - c.total) : 0;
    const fila: Calzada = { comprobante: c, factura: elegida, diferencia, por };
    if (mismaMoneda && !CUADRA(elegida.total, c.total)) descuadradas.push(fila);
    else calzadas.push(fila);
  }

  const soloEnBc = facturas.filter((f) => enVentana(f) && !usadas.has(f.numero));

  return { calzadas, descuadradas, soloEnCorreo, soloEnBc, otrasEmpresas, ventana };
}

/**
 * Las colas del consecutivo con las que el digitador pudo haber tecleado la factura.
 *
 * Nadie escribe los 20 dígitos: del `00100001010000590464` se teclea `590464`. Pero
 * algunos proveedores numeran con más cifras, así que se prueban varias colas, de la
 * más específica a la menos, y SIEMPRE amarrado al proveedor — una cola corta sola
 * calza con cualquier cosa.
 */
export function colasDelConsecutivo(consecutivo: string): string[] {
  const d = soloDigitos(consecutivo);
  if (!d) return [];
  const out = new Set<string>([normalizarNumero(d)]);
  for (let n = 12; n >= 5; n--) if (d.length >= n) out.add(normalizarNumero(d.slice(-n)));
  return [...out].filter(Boolean);
}

const redondear = (n: number) => Math.round(n * 100) / 100;

function corre(iso: string, dias: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + dias * 86_400_000).toISOString().slice(0, 10);
}
