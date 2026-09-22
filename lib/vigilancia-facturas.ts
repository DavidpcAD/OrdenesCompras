// VIGILANCIA DE FACTURAS — las señales que se pueden sacar de Business Central solo.
//
// Para qué existe: al buzón de facturación entran ~1.300 correos al mes y a BC se
// registran ~1.000 facturas, y hoy nadie sabe cuál de las dos cifras le falta a la
// otra. La vigilancia completa necesita leer los XML del correo (y eso necesita un
// registro de app en Entra que todavía no existe), pero hay tres preguntas que se
// contestan con lo que BC ya nos da y que no esperan ese trámite:
//
//   1. ¿Qué factura quedó en borrador y nunca se registró?
//   2. ¿Qué factura parece haberse registrado dos veces?
//   3. ¿Qué proveedor venía facturando seguido y se calló?
//
// Las tres salieron de una revisión del año completo (1 oct 2025 → 22 sep 2026) que
// encontró 31 borradores por ₡7,5 millones y 13 pares con pinta de doble registro.
//
// Todo acá es función pura sobre listas ya traídas de BC: se prueba con `npm test`
// sin tocar la red, y quien llama decide de dónde vienen los datos.

export type FacturaBc = {
  numero: string;           // CFR-010077 (registrada) o CF-005124 / un consecutivo (borrador)
  numeroProveedor: string;  // el que teclea el digitador: "81028", "8415-1", "029644"
  proveedorCodigo: string;  // PROV-001717
  proveedorNombre: string;
  fecha: string;            // invoiceDate, YYYY-MM-DD
  total: number;            // con impuestos
  moneda: string;           // CRC, USD…
};

export type ProveedorBc = {
  codigo: string;
  nombre: string;
  cedula: string;           // taxRegistrationNumber, como venga: puede traer guiones o venir vacío
};

// Una factura REGISTRADA en BC lleva la serie CFR-. Cualquier otra cosa (CF-, o un
// consecutivo de Hacienda que alguien tecleó como número de documento) es un borrador
// que nunca se posteó. Es la regla que usa BC, no una convención nuestra.
export const estaRegistrada = (f: Pick<FacturaBc, "numero">) => /^CFR/i.test(f.numero ?? "");

// El número del proveedor lo teclea una persona, así que "029644", "29644" y "29.644"
// son el mismo documento. Para comparar se deja solo dígitos y se le quitan los ceros
// de adelante. Ojo: esto NO sirve como llave por sí solo — ver `posiblesDobles`.
export const normalizarNumero = (s: string) =>
  String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");

export const soloDigitos = (s: string) => String(s ?? "").replace(/\D/g, "");

// ---------------------------------------------------------------------------
// 1. Borradores que nunca se registraron
// ---------------------------------------------------------------------------

/**
 * Las facturas que quedaron a medio camino: existen en BC pero nunca se postearon,
 * así que no están en la contabilidad ni le deben nada a nadie todavía.
 *
 * Se devuelven de la más VIEJA a la más nueva a propósito: una de ayer puede estar
 * en trámite, una de noviembre del año pasado se le olvidó a alguien.
 */
export function borradoresSinRegistrar(facturas: FacturaBc[]): FacturaBc[] {
  return facturas
    .filter((f) => !estaRegistrada(f))
    .slice()
    .sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? ""));
}

// ---------------------------------------------------------------------------
// 2. Posibles dobles registros
// ---------------------------------------------------------------------------

export type ParDoble = { a: FacturaBc; b: FacturaBc; dias: number };

/**
 * Facturas que parecen la misma cobrada dos veces.
 *
 * La regla es deliberadamente ESTRECHA: mismo proveedor, misma moneda, monto idéntico
 * y un número donde uno es prefijo del otro ("8415" y "8415-1"). Ese sufijo es lo que
 * teclea el digitador cuando BC se niega a repetir el número del proveedor, y es la
 * única pista que aguanta.
 *
 * Se probó primero con la regla suelta —mismo proveedor, mismo monto, hasta 21 días de
 * distancia— y dio 811 pares sobre el año, casi todos compras repetidas de verdad: el
 * ₡15.000 semanal de Zavillana, los ₡207.468 de Imporlanca, el cemento al mismo precio.
 * Con la regla estrecha quedan 13, y esos sí valen una revisada. Preferimos perder
 * algún doble real antes que entregar una lista que nadie va a leer.
 *
 * Aun así NO afirma que sean dobles: un proveedor puede facturar dos entregas contra el
 * mismo documento. Por eso el nombre dice "posibles".
 */
export function posiblesDobles(facturas: FacturaBc[]): ParDoble[] {
  // Agrupar por proveedor + moneda + monto deja los candidatos juntos y evita comparar
  // cada factura contra todas (un proveedor solo ya tiene 469 en el año).
  const grupos = new Map<string, FacturaBc[]>();
  for (const f of facturas) {
    if (!estaRegistrada(f)) continue;       // un borrador no está cobrado dos veces
    if (!f.total) continue;                 // los de ₡0 son documentos vacíos, no dobles
    const k = `${f.proveedorCodigo}|${f.moneda}|${f.total}`;
    const g = grupos.get(k);
    if (g) g.push(f); else grupos.set(k, [f]);
  }

  const pares: ParDoble[] = [];
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        const a = grupo[i], b = grupo[j];
        const na = normalizarNumero(a.numeroProveedor), nb = normalizarNumero(b.numeroProveedor);
        if (!na || !nb || na === nb) continue;               // el mismo número no es un par
        if (na.length < 4 || nb.length < 4) continue;        // "7" es prefijo de medio mundo
        if (!na.startsWith(nb) && !nb.startsWith(na)) continue;
        pares.push({ a, b, dias: diasEntre(a.fecha, b.fecha) });
      }
    }
  }
  // Por monto, de mayor a menor: lo que más plata pone en juego se revisa primero.
  return pares.sort((x, y) => y.a.total - x.a.total);
}

function diasEntre(a: string, b: string): number {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round(Math.abs(ta - tb) / 86_400_000);
}

// ---------------------------------------------------------------------------
// 3. Proveedores que se callaron
// ---------------------------------------------------------------------------

export type ProveedorCallado = {
  codigo: string;
  nombre: string;
  facturas: number;
  ritmoDias: number;        // cada cuántos días facturaba, en promedio
  ultima: string;
  diasCallado: number;
};

/**
 * El proveedor que venía facturando cada dos días y lleva cuarenta sin aparecer.
 *
 * Esta es la señal más útil que se puede dar HOY, porque no necesita el correo: si
 * Vidralsa emite 161 facturas al año y lleva 40 días sin una sola en BC, o dejaron de
 * comprarle o hay facturas suyas sin registrar. Las dos respuestas interesan.
 *
 * Los umbrales: al menos 8 facturas en el período (con menos no hay "ritmo" que medir)
 * y un silencio de más de 4 veces su ritmo normal, con piso de 30 días para que los
 * proveedores de todos los días no llenen la lista cada fin de semana.
 */
export function proveedoresCallados(
  facturas: FacturaBc[],
  hoy: string,
  opts: { minFacturas?: number; vecesElRitmo?: number; pisoDias?: number } = {},
): ProveedorCallado[] {
  const minFacturas = opts.minFacturas ?? 8;
  const veces = opts.vecesElRitmo ?? 4;
  const piso = opts.pisoDias ?? 30;

  const porProveedor = new Map<string, { nombre: string; fechas: string[] }>();
  for (const f of facturas) {
    if (!f.proveedorCodigo || !f.fecha) continue;
    const p = porProveedor.get(f.proveedorCodigo);
    if (p) { p.fechas.push(f.fecha); if (!p.nombre) p.nombre = f.proveedorNombre; }
    else porProveedor.set(f.proveedorCodigo, { nombre: f.proveedorNombre, fechas: [f.fecha] });
  }

  const out: ProveedorCallado[] = [];
  for (const [codigo, p] of porProveedor) {
    if (p.fechas.length < minFacturas) continue;
    const fechas = p.fechas.slice().sort();
    const ultima = fechas[fechas.length - 1];
    const diasCallado = diasEntre(ultima, hoy);
    // El ritmo se mide sobre el tramo que el proveedor realmente estuvo activo, no
    // sobre el período pedido: uno que arrancó en julio no factura "cada 45 días"
    // solo porque la consulta empieza en octubre.
    const span = Math.max(1, diasEntre(fechas[0], ultima));
    const ritmoDias = Math.round(span / fechas.length);
    if (diasCallado <= Math.max(piso, ritmoDias * veces)) continue;
    out.push({ codigo, nombre: p.nombre, facturas: fechas.length, ritmoDias, ultima, diasCallado });
  }
  // Por volumen: el que más factura es el que más duele que esté callado.
  return out.sort((a, b) => b.facturas - a.facturas);
}

// ---------------------------------------------------------------------------
// 4. Proveedores sin cédula — el dato que traba el cruce con el correo
// ---------------------------------------------------------------------------

export type ProveedorSinCedula = { codigo: string; nombre: string; facturas: number };

/**
 * Los proveedores sin cédula en BC, ordenados por cuántas facturas mueven.
 *
 * Importa porque la cédula del emisor viaja dentro de la clave de 50 dígitos de todo
 * comprobante electrónico, así que es la ÚNICA llave que cruza el correo con BC sin
 * adivinar. Medido en fichas el hueco parece mediano (456 de 790 la tienen), pero
 * medido en facturas es grave: 7.312 de 10.440 del año son de proveedores sin cédula.
 *
 * Por eso se ordena por volumen y no alfabéticamente: arreglando 20 fichas se cubre el
 * 36% de las facturas del año. La lista es una cola de trabajo, no un censo.
 */
export function proveedoresSinCedula(
  facturas: FacturaBc[],
  proveedores: ProveedorBc[],
): ProveedorSinCedula[] {
  // Una cédula jurídica de Costa Rica tiene 10 dígitos y una física 9; cualquier cosa
  // más corta es un campo a medio llenar, no una cédula.
  const tieneCedula = new Set(
    proveedores.filter((p) => soloDigitos(p.cedula).length >= 9).map((p) => p.codigo),
  );
  const nombres = new Map(proveedores.map((p) => [p.codigo, p.nombre]));

  const cuenta = new Map<string, { nombre: string; n: number }>();
  for (const f of facturas) {
    if (!f.proveedorCodigo || tieneCedula.has(f.proveedorCodigo)) continue;
    const c = cuenta.get(f.proveedorCodigo);
    if (c) c.n++;
    else cuenta.set(f.proveedorCodigo, { nombre: nombres.get(f.proveedorCodigo) ?? f.proveedorNombre, n: 1 });
  }
  return [...cuenta]
    .map(([codigo, v]) => ({ codigo, nombre: v.nombre, facturas: v.n }))
    .sort((a, b) => b.facturas - a.facturas);
}

// ---------------------------------------------------------------------------
// 5. Fichas de proveedor duplicadas
// ---------------------------------------------------------------------------

export type FichaDuplicada = {
  cedula: string;
  fichas: { codigo: string; nombre: string; facturas: number }[];
};

/**
 * Dos fichas de proveedor con la misma cédula. Rompen el cruce por cédula (¿a cuál de
 * las dos apunta la factura?) y además parten el historial de compras en dos.
 *
 * Se devuelve con el conteo de facturas de cada ficha porque eso dice cómo juntarlas:
 * si una está en cero, es borrarla; si las dos tienen facturas, hay que mover
 * movimientos y eso ya es trabajo de contabilidad.
 */
export function fichasDuplicadas(proveedores: ProveedorBc[], facturas: FacturaBc[]): FichaDuplicada[] {
  const cuenta = new Map<string, number>();
  for (const f of facturas) {
    if (f.proveedorCodigo) cuenta.set(f.proveedorCodigo, (cuenta.get(f.proveedorCodigo) ?? 0) + 1);
  }
  const porCedula = new Map<string, ProveedorBc[]>();
  for (const p of proveedores) {
    const c = soloDigitos(p.cedula);
    if (c.length < 9) continue;
    const g = porCedula.get(c);
    if (g) g.push(p); else porCedula.set(c, [p]);
  }
  return [...porCedula]
    .filter(([, v]) => v.length > 1)
    .map(([cedula, v]) => ({
      cedula,
      fichas: v
        .map((p) => ({ codigo: p.codigo, nombre: p.nombre, facturas: cuenta.get(p.codigo) ?? 0 }))
        .sort((a, b) => b.facturas - a.facturas),
    }))
    // Primero las que tienen facturas en las DOS fichas: esas son las que de verdad
    // están partidas, las otras son una ficha viva y una vacía.
    .sort((a, b) => partidasDeVerdad(b) - partidasDeVerdad(a));
}

const partidasDeVerdad = (d: FichaDuplicada) => d.fichas.filter((f) => f.facturas > 0).length;

// ---------------------------------------------------------------------------
// Totales: los colones aparte
// ---------------------------------------------------------------------------

/**
 * Suma en colones y lista lo que quedó fuera por ser de otra moneda.
 *
 * Los recuadros de la pantalla dan un total en colones, porque sumar ₡, US$ y € en un
 * mismo número da algo que no significa nada. Pero un total que se come una factura en
 * silencio es peor que no darlo: en los 31 borradores hay uno en dólares, y sin esto la
 * pantalla decía ₡7.575.525,99 como si eso fuera todo.
 */
export function totalPorMoneda(filas: { total: number; moneda: string }[]): {
  colones: number;
  otras: { moneda: string; total: number; n: number }[];
} {
  let colones = 0;
  const otras = new Map<string, { total: number; n: number }>();
  for (const f of filas) {
    if (f.moneda === "CRC") { colones += f.total; continue; }
    const o = otras.get(f.moneda);
    if (o) { o.total += f.total; o.n++; } else otras.set(f.moneda, { total: f.total, n: 1 });
  }
  return {
    colones,
    // Por código de moneda y no por monto: ordenar 517 USD contra 100 EURO sería
    // comparar peras con manzanas, que es justo lo que esta función evita.
    otras: [...otras].map(([moneda, v]) => ({ moneda, ...v })).sort((a, b) => a.moneda.localeCompare(b.moneda)),
  };
}
