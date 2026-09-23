// "ESTA FACTURA SÍ ESTÁ EN BC, PERO CON OTRO NÚMERO" — el segundo intento.
//
// El cruce de `cruce-correo-bc.ts` amarra por el NÚMERO del proveedor, y por eso
// falla justo donde más duele: cuando el digitador tecleó mal ese número. Kattya
// lleva un Excel con esos casos y la columna de comentarios los nombra uno por uno:
// "REGISTRADA CON EL # 319869" para el comprobante ...319868, "# 9749" para el
// ...129749, "# 91239" para el ...081239. En esa lista la mitad de los números no se
// parecen en nada al del comprobante: el 00700001010000040045 de Expocerámica quedó
// como "46309".
//
// Lo que SÍ sobrevive al error de digitación es todo lo demás: el proveedor, el
// monto, la fecha y los renglones. Con eso se arma una lista de CANDIDATOS.
//
// PROPONE, NO ENLAZA. Medido contra las 769 facturas de BC del 20 ago al 20 sep de
// 2026: hay 118 pares del mismo proveedor con el monto idéntico dentro de ±3 días
// —servicios y materiales que se repiten—, y en uno de los casos de Kattya las dos
// facturas candidatas tienen hasta los MISMOS renglones (2 discos de sierra a ₡3.735,
// comprados dos veces con doce días de diferencia). Ninguna regla automática puede
// separar eso sin inventar. Lo único honesto es poner los candidatos en orden, decir
// por qué cada uno está ahí, y que la persona escoja.
//
// Contra los 20 casos del Excel, el candidato correcto sale en los 20; en 14 es el
// único con monto exacto y en el resto queda de primero por fecha y monto.

import type { FacturaBc, ProveedorBc } from "./vigilancia-facturas.ts";
import { estaRegistrada, normalizarNumero, soloDigitos } from "./vigilancia-facturas.ts";

export type ComprobanteBuscado = {
  consecutivo: string;
  cedulaEmisor: string;
  nombreEmisor: string;
  fecha: string;      // YYYY-MM-DD
  total: number;
  moneda: string;
};

export type Candidato = {
  factura: FacturaBc;
  /** Qué tan bien calza. Solo sirve para ORDENAR: no es una probabilidad. */
  puntaje: number;
  /** Lo que tiene BC menos lo que cobró el proveedor. 0 = igual. */
  difMonto: number;
  /** Días entre la factura de BC y el comprobante. Negativo = BC es anterior. */
  dias: number;
  /** En cristiano, por qué este candidato está en la lista. Se muestra tal cual. */
  razones: string[];
  /** El proveedor se reconoció por la cédula (firme) o por el nombre (flojo). */
  por: "cedula" | "nombre";
};

// Cuánto se pueden separar dos montos y seguir siendo la misma factura. Medido sobre
// los casos reales: las diferencias de redondeo entre el XML y BC van de ₡0,06 a
// ₡1,06, y el error de tecleo más grande fue de ₡23,17 (0,063%). La banda cubre
// ambos con aire; lo que queda afuera se lo tiene que ganar el número.
const IGUAL = 0.5;
const BANDA = (total: number) => Math.max(Math.abs(total) * 0.01, 100);

// Cuántos días alrededor del comprobante se mira. En los 20 casos resueltos la
// factura de BC cae entre 1 día antes y 2 después, así que 15 es holgura de sobra —
// y como la lista va ORDENADA por cercanía, ampliarla no ensucia el primer puesto.
const VENTANA = 15;
const MAX = 6;

const dias = (a: string, b: string): number => {
  const x = Date.parse(a), y = Date.parse(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return 999;
  return Math.round((y - x) / 86_400_000);
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

/** Distancia de edición, cortada en 2: más allá de eso ya no es un dedazo. */
function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const nueva = [i];
    for (let j = 1; j <= b.length; j++) {
      nueva[j] = Math.min(
        fila[j] + 1,
        nueva[j - 1] + 1,
        fila[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    fila = nueva;
  }
  return Math.min(fila[b.length], 3);
}

/**
 * Qué tanto se parece el número que tecleó el digitador al consecutivo real.
 *
 * Las formas que aparecen en los casos reales, todas con el mismo proveedor:
 *   · ...129749 → "9749"      el digitador escribió menos dígitos de la cola
 *   · ...000567 → "5671"      escribió la cola y le pegó algo atrás
 *   · ...129841 → "70129841"  le puso un prefijo de su propia numeración
 *   · ...081239 → "91239"     un solo dedazo (8 por 9)
 */
export function parecidoDeNumero(consecutivo: string, numeroBc: string): { puntos: number; razon: string } | null {
  const c = soloDigitos(consecutivo), n = normalizarNumero(numeroBc);
  if (!c || !n || n.length < 3) return null;

  if (c.endsWith(n)) return { puntos: 22, razon: `el consecutivo termina en ${n}` };
  // La cola con la que se suele teclear: los últimos dígitos sin los ceros de relleno.
  const cola = normalizarNumero(c.slice(-8));
  if (cola && cola.length >= 3) {
    if (n.includes(cola)) return { puntos: 20, razon: `el N.º de BC lleva adentro el ${cola} del consecutivo` };
    if (n.startsWith(cola.slice(-4)) && cola.length >= 4) {
      return { puntos: 14, razon: `el N.º de BC empieza con el ${cola.slice(-4)} del consecutivo` };
    }
    if (cola.length === n.length && distancia(cola, n) === 1) {
      return { puntos: 24, razon: `un dígito de diferencia con el ${cola} del consecutivo` };
    }
  }
  return null;
}

/**
 * Las facturas de BC que PODRÍAN ser este comprobante, de la más probable a la menos.
 *
 * `yaEnlazadas` son las que ya están amarradas a otro comprobante: proponerlas otra
 * vez sería mandar a alguien a enlazar dos veces la misma factura.
 */
export function candidatosDeFactura(
  comprobante: ComprobanteBuscado,
  facturas: FacturaBc[],
  proveedores: ProveedorBc[],
  opts: { yaEnlazadas?: Set<string>; ventanaDias?: number; max?: number } = {},
): Candidato[] {
  const ventana = opts.ventanaDias ?? VENTANA;
  const tope = opts.max ?? MAX;
  const usadas = opts.yaEnlazadas ?? new Set<string>();

  const cedula = soloDigitos(comprobante.cedulaEmisor);
  const conCedula = new Set<string>();      // códigos de proveedor cuya cédula es ésta
  const sinCedula = new Set<string>();      // los que no tienen cédula en BC
  for (const p of proveedores) {
    const c = soloDigitos(p.cedula);
    if (c.length >= 9 && c === cedula) conCedula.add(p.codigo);
    else if (c.length < 9) sinCedula.add(p.codigo);
  }

  const out: Candidato[] = [];
  for (const f of facturas) {
    if (usadas.has(f.numero)) continue;
    if ((f.moneda || "CRC") !== (comprobante.moneda || "CRC")) continue;

    // El proveedor no se negocia: sin él, un monto igual no dice nada. Primero por
    // cédula; si esa ficha de BC no tiene cédula, se cae al nombre y queda marcado.
    let por: "cedula" | "nombre";
    if (conCedula.has(f.proveedorCodigo)) por = "cedula";
    else if (sinCedula.has(f.proveedorCodigo) && seParecen(comprobante.nombreEmisor, f.proveedorNombre)) por = "nombre";
    else continue;

    const d = dias(comprobante.fecha, f.fecha);
    if (Math.abs(d) > ventana) continue;

    const difMonto = Math.round((f.total - comprobante.total) * 100) / 100;
    const abs = Math.abs(difMonto);
    const numero = parecidoDeNumero(comprobante.consecutivo, f.numeroProveedor);

    const razones: string[] = [];
    let puntaje = 0;

    if (abs <= IGUAL) { puntaje += 50; razones.push("el monto es idéntico"); }
    else if (abs <= BANDA(comprobante.total)) {
      puntaje += 30;
      razones.push(`el monto difiere en ${difMonto > 0 ? "" : "−"}${abs.toFixed(2)}`);
    } else if (!numero) {
      // Monto lejos y número que no se parece: no hay nada que lo ponga en la lista.
      continue;
    }

    if (numero) { puntaje += numero.puntos; razones.push(numero.razon); }

    if (d === 0) { puntaje += 20; razones.push("es del mismo día"); }
    else if (Math.abs(d) <= 2) { puntaje += 15; razones.push(`${Math.abs(d)} ${Math.abs(d) === 1 ? "día" : "días"} de diferencia`); }
    else if (Math.abs(d) <= 5) { puntaje += 8; razones.push(`${Math.abs(d)} días de diferencia`); }
    else { puntaje += 2; razones.push(`${Math.abs(d)} días de diferencia`); }

    if (por === "nombre") { puntaje -= 10; razones.push("el proveedor calzó por nombre, no por cédula"); }
    // Un borrador también es una respuesta —"sí está, pero nunca se registró"— y hay
    // que decirlo, porque enlazar contra un borrador no cierra el caso.
    if (!estaRegistrada(f)) { puntaje -= 5; razones.push("todavía está en borrador"); }

    out.push({ factura: f, puntaje, difMonto, dias: d, razones, por });
  }

  // Empates: manda la fecha y después el monto. En el caso de los discos de sierra de
  // Industrias Brenes —dos facturas idénticas con doce días de diferencia— eso es lo
  // ÚNICO que separa la buena de la otra.
  out.sort((a, b) =>
    b.puntaje - a.puntaje ||
    Math.abs(a.dias) - Math.abs(b.dias) ||
    Math.abs(a.difMonto) - Math.abs(b.difMonto));
  return out.slice(0, tope);
}

/**
 * Lo que la TABLA necesita saber de los candidatos de una fila: que hay, cuántos, y
 * cuál es el mejor. No viaja la lista entera: son cientos de filas y en la tabla solo
 * hay campo para una pista.
 */
export type MarcaCandidato = {
  n: number;
  numero: string;
  numeroProveedor: string;
  fecha: string;
  difMonto: number;
  dias: number;
  puntaje: number;
};

// ---------------------------------------------------------------------------
// Renglón contra renglón
// ---------------------------------------------------------------------------

export type RenglonCotejo = { total: number; cantidad: number; precioUnitario: number };

export type CotejoRenglones = {
  calzan: number;
  enCorreo: number;
  enBc: number;
  /** Los índices del lado del correo que NO encontraron pareja, y al revés. */
  sueltasCorreo: number[];
  sueltasBc: number[];
};

/**
 * Cuántos renglones del comprobante aparecen igualitos en la factura de BC.
 *
 * Se aparea por el IMPORTE de la línea y no por la descripción: el proveedor escribe
 * "MORTERO REPEMAX MURO SECO" y en BC quedó el nombre del artículo del catálogo, así
 * que los textos casi nunca coinciden. El importe sí, y cuando la unidad de compra no
 * es la misma que la de la factura —un estañón contra 255.000 gramos— la cantidad y
 * el precio cambian pero el importe de la línea se mantiene.
 *
 * Es CONFIRMACIÓN, no prueba: dos compras iguales del mismo material dan el mismo
 * cotejo. Sirve para descartar rápido, no para decidir solo.
 */
export function cotejarRenglones(correo: RenglonCotejo[], bc: RenglonCotejo[]): CotejoRenglones {
  const libres = bc.map((_, i) => i);
  const sueltasCorreo: number[] = [];
  let calzan = 0;

  correo.forEach((l, i) => {
    const tol = Math.max(Math.abs(l.total) * 0.005, 1);
    // Primero el que calza en importe Y en cantidad; si no, con el importe basta.
    let k = libres.findIndex((j) =>
      Math.abs(bc[j].total - l.total) <= tol && Math.abs(bc[j].cantidad - l.cantidad) < 0.001);
    if (k < 0) k = libres.findIndex((j) => Math.abs(bc[j].total - l.total) <= tol);
    if (k < 0) { sueltasCorreo.push(i); return; }
    libres.splice(k, 1);
    calzan++;
  });

  return { calzan, enCorreo: correo.length, enBc: bc.length, sueltasCorreo, sueltasBc: libres };
}
