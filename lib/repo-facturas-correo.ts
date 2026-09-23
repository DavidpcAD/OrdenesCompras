// LA MEMORIA DE LA VIGILANCIA — dbo.FacturaCorreo (ver sql/factura_correo.sql).
//
// Guarda cada comprobante que llegó al buzón de facturación y en qué quedó: si ya se
// registró en Business Central, con qué número y CUÁNDO se detectó registrado.
//
// Existe porque ni el correo ni BC saben la respuesta solos. El buzón no marca nada
// —8.741 correos sin leer de 31.932— y BC solo sabe lo que se digitó. Sin esta tabla
// no se puede decir "esta lleva nueve días sin registrarse".
//
// Todo acá tolera que la tabla NO exista todavía: la app no se puede caer por una
// migración pendiente. Sin tabla, la vigilancia por correo se apaga con un aviso y el
// resto de la pantalla —las señales que salen de BC solo— sigue funcionando.

import { getPool, sql } from "./db.ts";
import { bcDeepLinkFacturaPorNo } from "./bc.ts";
import type { Comprobante } from "./cruce-correo-bc.ts";

export type EstadoFactura = "pendiente" | "registrada" | "descuadrada" | "no_aplica" | "otra_empresa";

export type FacturaCorreo = {
  clave: string;
  consecutivo: string;
  tipoDoc: string;
  cedulaEmisor: string;
  nombreEmisor: string;
  cedulaReceptor: string;
  fechaEmision: string;
  moneda: string;
  total: number;
  fechaCorreo: string | null;
  webLink: string | null;
  remitente: string | null;
  estado: EstadoFactura;
  bcNumero: string | null;
  bcProveedor: string | null;
  bcTotal: number | null;
  bcCalzePor: string | null;
  /** Lo palomeó una persona. Es un eje APARTE del estado: una factura puede estar sin
   *  registrar y ya revisada (alguien la vio y sabe por qué falta). */
  revisada: boolean;
  /** Deep link a ESA factura en BC. Se arma en el servidor porque lleva tenant,
   *  entorno y empresa, que el navegador no conoce. Sin N.º de BC no hay link: un
   *  enlace que abre una lista vacía es peor que no ponerlo. */
  bcUrl: string | null;
  fechaRegistro: string | null;
  ultimoCotejo: string | null;
  revisadoPor: string | null;
  nota: string | null;
};

let hayTabla: boolean | null = null;

export async function tablaCorreoExiste(): Promise<boolean> {
  if (hayTabla !== null) return hayTabla;
  try {
    const pool = await getPool();
    const r = await pool.request().query("SELECT OBJECT_ID('dbo.FacturaCorreo') AS id");
    hayTabla = r.recordset[0]?.id != null;
  } catch {
    hayTabla = false;
  }
  return hayTabla;
}

export const FALTA_TABLA =
  "Falta la tabla dbo.FacturaCorreo: hay que correr sql/factura_correo.sql en la base de la app (AdelantePRO).";

const iso = (v: any): string | null => (v instanceof Date ? v.toISOString() : v ?? null);
const fila = (r: any): FacturaCorreo => ({
  clave: (r.clave ?? "").trim(),
  consecutivo: (r.consecutivo ?? "").trim(),
  tipoDoc: (r.tipoDoc ?? "").trim(),
  cedulaEmisor: r.cedulaEmisor ?? "",
  nombreEmisor: r.nombreEmisor ?? "",
  cedulaReceptor: r.cedulaReceptor ?? "",
  fechaEmision: (iso(r.fechaEmision) ?? "").slice(0, 10),
  moneda: r.moneda ?? "CRC",
  total: Number(r.total ?? 0) || 0,
  fechaCorreo: iso(r.fechaCorreo),
  webLink: r.webLink ?? null,
  remitente: r.remitente ?? null,
  estado: (r.estado ?? "pendiente") as EstadoFactura,
  bcNumero: r.bcNumero ?? null,
  bcProveedor: r.bcProveedor ?? null,
  bcTotal: r.bcTotal == null ? null : Number(r.bcTotal),
  bcCalzePor: r.bcCalzePor ?? null,
  revisada: !!r.revisadoEn,
  bcUrl: r.bcNumero ? (bcDeepLinkFacturaPorNo(String(r.bcNumero)) || null) : null,
  fechaRegistro: iso(r.fechaRegistro),
  ultimoCotejo: iso(r.ultimoCotejo),
  revisadoPor: r.revisadoPor ?? null,
  nota: r.nota ?? null,
});

// Cuántas filas viajan por sentencia. SQL Server aguanta 2.100 parámetros; el INSERT
// usa 12 por fila y el UPDATE 6, así que 100 y 200 caben con aire.
const POR_TANDA = 100;
const POR_TANDA_UPD = 200;

/**
 * Mete los comprobantes que trajo el buzón. Devuelve cuántos eran nuevos.
 *
 * VA POR TANDAS, no de a uno. Era un INSERT por comprobante y una corrida de 455
 * eran 455 idas y vueltas a Azure SQL: la pantalla se quedaba minutos en "Guardando
 * lo que llegó… 0 de 455". Ahora son cinco sentencias.
 *
 * El `WHERE NOT EXISTS` hace el trabajo que hacía el `IF NOT EXISTS`: la clave de
 * Hacienda es la llave primaria, así que un proveedor que reenvía el mismo correo
 * tres veces —que pasa seguido— no duplica nada, y una sincronización que relee con
 * traslape tampoco. Lo ya guardado NO se pisa: si alguien lo marcó "no aplica" o lo
 * palomeó como revisado, el reenvío no lo revive.
 */
export async function guardarComprobantes(
  entradas: { comprobante: Comprobante; fechaCorreo?: string; webLink?: string; remitente?: string }[],
  onProgreso?: (hechos: number, total: number) => void,
): Promise<number> {
  if (!entradas.length) return 0;
  if (!(await tablaCorreoExiste())) throw new Error(FALTA_TABLA);
  const pool = await getPool();

  const buenas = entradas.filter((e) => e.comprobante.clave?.length === 50);
  let nuevos = 0, hechos = 0;

  for (let i = 0; i < buenas.length; i += POR_TANDA) {
    const tanda = buenas.slice(i, i + POR_TANDA);
    const req = pool.request();
    const filas = tanda.map((e, j) => {
      const c = e.comprobante;
      req.input(`c${j}`, sql.Char(50), c.clave)
         .input(`n${j}`, sql.Char(20), c.consecutivo.padStart(20, "0").slice(0, 20))
         .input(`t${j}`, sql.Char(2), c.tipo || "01")
         .input(`e${j}`, sql.VarChar(12), c.cedulaEmisor || "")
         .input(`m${j}`, sql.NVarChar(200), (c.nombreEmisor || "").slice(0, 200))
         .input(`r${j}`, sql.VarChar(12), c.cedulaReceptor || null)
         .input(`f${j}`, sql.Date, c.fecha || null)
         .input(`d${j}`, sql.VarChar(10), c.moneda || "CRC")
         .input(`o${j}`, sql.Decimal(19, 4), c.total || 0)
         .input(`k${j}`, sql.DateTime, e.fechaCorreo ? new Date(e.fechaCorreo) : null)
         .input(`w${j}`, sql.NVarChar(1000), (e.webLink || "").slice(0, 1000) || null)
         .input(`s${j}`, sql.NVarChar(200), (e.remitente || "").slice(0, 200) || null);
      return `(@c${j},@n${j},@t${j},@e${j},@m${j},@r${j},@f${j},@d${j},@o${j},@k${j},@w${j},@s${j})`;
    }).join(",");

    const res = await req.query(`
      INSERT dbo.FacturaCorreo
        (clave, consecutivo, tipoDoc, cedulaEmisor, nombreEmisor, cedulaReceptor,
         fechaEmision, moneda, total, fechaCorreo, webLink, remitente)
      SELECT v.clave, v.consecutivo, v.tipoDoc, v.cedulaEmisor, v.nombreEmisor, v.cedulaReceptor,
             v.fechaEmision, v.moneda, v.total, v.fechaCorreo, v.webLink, v.remitente
      FROM (VALUES ${filas}) AS v(clave, consecutivo, tipoDoc, cedulaEmisor, nombreEmisor, cedulaReceptor,
                                  fechaEmision, moneda, total, fechaCorreo, webLink, remitente)
      WHERE NOT EXISTS (SELECT 1 FROM dbo.FacturaCorreo f WHERE f.clave = v.clave);
      SELECT @@ROWCOUNT AS nuevos;`);
    nuevos += Number(res.recordset?.[0]?.nuevos ?? 0) || 0;
    hechos += tanda.length;
    onProgreso?.(hechos, buenas.length);
  }
  return nuevos;
}

/** Los comprobantes que todavía no se han encontrado en BC. */
export async function pendientesDeCotejo(): Promise<FacturaCorreo[]> {
  if (!(await tablaCorreoExiste())) return [];
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT * FROM dbo.FacturaCorreo
    WHERE estado IN ('pendiente','descuadrada')
    ORDER BY fechaEmision ASC`);
  return r.recordset.map(fila);
}

export async function listarFacturasCorreo(opts: { desde?: string; hasta?: string; estado?: string } = {}): Promise<FacturaCorreo[]> {
  if (!(await tablaCorreoExiste())) return [];
  const pool = await getPool();
  const req = pool.request();
  const donde: string[] = [];
  if (opts.desde) { req.input("desde", sql.Date, opts.desde); donde.push("fechaEmision >= @desde"); }
  if (opts.hasta) { req.input("hasta", sql.Date, opts.hasta); donde.push("fechaEmision <= @hasta"); }
  if (opts.estado) { req.input("estado", sql.VarChar(20), opts.estado); donde.push("estado = @estado"); }
  const r = await req.query(`
    SELECT * FROM dbo.FacturaCorreo
    ${donde.length ? "WHERE " + donde.join(" AND ") : ""}
    ORDER BY fechaEmision DESC, fechaCorreo DESC`);
  return r.recordset.map(fila);
}

/** UN comprobante, el que se abrió para ver sus líneas. */
export async function leerFacturaCorreo(clave: string): Promise<FacturaCorreo | null> {
  if (!(await tablaCorreoExiste())) return null;
  const pool = await getPool();
  const r = await pool.request()
    .input("clave", sql.Char(50), clave)
    .query("SELECT TOP 1 * FROM dbo.FacturaCorreo WHERE clave = @clave");
  const x = r.recordset[0];
  return x ? fila(x) : null;
}

export type ResultadoCotejo = {
  clave: string;
  estado: EstadoFactura;
  bcNumero?: string | null;
  bcProveedor?: string | null;
  bcTotal?: number | null;
  bcCalzePor?: string | null;
};

/**
 * Escribe lo que encontró el cotejo contra BC.
 *
 * TAMBIÉN POR TANDAS: era un UPDATE por comprobante, y con 395 pendientes eso son 395
 * idas y vueltas a Azure SQL en cada corrida — el otro motivo de que la
 * sincronización se sintiera eterna.
 *
 * `fechaRegistro` se pone UNA sola vez, la primera vez que se ve registrada, y no se
 * vuelve a tocar: es el momento en que la factura apareció en BC, y de ahí sale
 * "cuánto tardó en digitarse". Si se reescribiera en cada corrida diría siempre "hoy".
 */
export async function guardarCotejo(
  resultados: ResultadoCotejo[],
  onProgreso?: (hechos: number, total: number) => void,
): Promise<void> {
  if (!resultados.length) return;
  if (!(await tablaCorreoExiste())) throw new Error(FALTA_TABLA);
  const pool = await getPool();
  let hechos = 0;

  for (let i = 0; i < resultados.length; i += POR_TANDA_UPD) {
    const tanda = resultados.slice(i, i + POR_TANDA_UPD);
    const req = pool.request();
    const filas = tanda.map((x, j) => {
      req.input(`c${j}`, sql.Char(50), x.clave)
         .input(`e${j}`, sql.VarChar(20), x.estado)
         .input(`n${j}`, sql.VarChar(40), x.bcNumero ?? null)
         .input(`p${j}`, sql.VarChar(40), x.bcProveedor ?? null)
         .input(`t${j}`, sql.Decimal(19, 4), x.bcTotal ?? null)
         .input(`z${j}`, sql.VarChar(10), x.bcCalzePor ?? null);
      return `(@c${j},@e${j},@n${j},@p${j},@t${j},@z${j})`;
    }).join(",");

    await req.query(`
      UPDATE f SET
        estado        = v.estado,
        bcNumero      = v.bcNumero,
        bcProveedor   = v.bcProveedor,
        bcTotal       = v.bcTotal,
        bcCalzePor    = v.bcCalzePor,
        ultimoCotejo  = getdate(),
        fechaRegistro = CASE
                          WHEN v.estado IN ('registrada','descuadrada') AND f.fechaRegistro IS NULL
                            THEN getdate()
                          WHEN v.estado NOT IN ('registrada','descuadrada')
                            THEN NULL
                          ELSE f.fechaRegistro
                        END
      FROM dbo.FacturaCorreo f
      JOIN (VALUES ${filas}) AS v(clave, estado, bcNumero, bcProveedor, bcTotal, bcCalzePor)
        ON f.clave = v.clave;`);
    hechos += tanda.length;
    onProgreso?.(hechos, resultados.length);
  }
}

/**
 * La palomita de "ya la revisé", que es lo que permite ir bajando la lista una por una.
 *
 * Se guarda en `revisadoPor` / `revisadoEn`, que ya existían en la tabla, así que no
 * hace falta otra migración. Y NO toca el estado: revisar no es resolver. Una factura
 * puede quedar "sin registrar" y revisada a la vez —alguien la miró y ya sabe por qué
 * falta— y el cotejo automático la puede seguir moviendo sin borrar esa marca.
 */
export async function marcarRevisada(clave: string, revisada: boolean, usuario: string): Promise<void> {
  if (!(await tablaCorreoExiste())) throw new Error(FALTA_TABLA);
  const pool = await getPool();
  await pool.request()
    .input("clave", sql.Char(50), clave)
    .input("usuario", sql.NVarChar(100), revisada ? usuario : null)
    .query(`
      UPDATE dbo.FacturaCorreo
      SET revisadoPor = @usuario,
          revisadoEn  = CASE WHEN @usuario IS NULL THEN NULL ELSE getdate() END
      WHERE clave = @clave`);
}

/** Cierre a mano: "no aplica", "es de otra empresa". */
export async function marcarFacturaCorreo(
  clave: string, estado: EstadoFactura, usuario: string, nota?: string,
): Promise<void> {
  if (!(await tablaCorreoExiste())) throw new Error(FALTA_TABLA);
  const pool = await getPool();
  await pool.request()
    .input("clave", sql.Char(50), clave)
    .input("estado", sql.VarChar(20), estado)
    .input("usuario", sql.NVarChar(100), usuario)
    .input("nota", sql.NVarChar(500), (nota ?? "").slice(0, 500) || null)
    .query(`
      UPDATE dbo.FacturaCorreo
      SET estado = @estado, revisadoPor = @usuario, revisadoEn = getdate(), nota = @nota
      WHERE clave = @clave`);
}

// --------------------------------------------------------------- marcador

export type Sincronizacion = {
  marcador: string | null;
  ultimaCorrida: string | null;
  ultimoError: string | null;
  leidos: number | null;
  nuevos: number | null;
};

export async function leerSincronizacion(): Promise<Sincronizacion | null> {
  if (!(await tablaCorreoExiste())) return null;
  const pool = await getPool();
  const r = await pool.request().query("SELECT TOP 1 * FROM dbo.FacturaCorreoSync WHERE id = 1");
  const x = r.recordset[0];
  if (!x) return null;
  return {
    marcador: x.marcador ?? null,
    ultimaCorrida: iso(x.ultimaCorrida),
    ultimoError: x.ultimoError ?? null,
    leidos: x.leidos ?? null,
    nuevos: x.nuevos ?? null,
  };
}

export async function guardarSincronizacion(s: {
  marcador?: string | null; error?: string | null; leidos?: number; nuevos?: number;
}): Promise<void> {
  if (!(await tablaCorreoExiste())) return;
  const pool = await getPool();
  await pool.request()
    .input("marcador", sql.NVarChar(40), s.marcador ?? null)
    .input("error", sql.NVarChar(500), (s.error ?? "").slice(0, 500) || null)
    .input("leidos", sql.Int, s.leidos ?? null)
    .input("nuevos", sql.Int, s.nuevos ?? null)
    .query(`
      UPDATE dbo.FacturaCorreoSync SET
        -- El marcador solo avanza: si una corrida falla a media lectura, no se puede
        -- perder el punto donde iba ni retroceder a releer el buzón entero.
        marcador      = CASE WHEN @marcador IS NOT NULL AND (marcador IS NULL OR @marcador > marcador)
                              THEN @marcador ELSE marcador END,
        ultimaCorrida = getdate(),
        ultimoError   = @error,
        leidos        = ISNULL(@leidos, leidos),
        nuevos        = ISNULL(@nuevos, nuevos)
      WHERE id = 1`);
}
