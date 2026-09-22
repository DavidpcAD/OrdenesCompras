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
  fechaRegistro: iso(r.fechaRegistro),
  ultimoCotejo: iso(r.ultimoCotejo),
  revisadoPor: r.revisadoPor ?? null,
  nota: r.nota ?? null,
});

/**
 * Mete los comprobantes que trajo el buzón. Devuelve cuántos eran nuevos.
 *
 * El `IF NOT EXISTS` hace el trabajo: la clave de Hacienda es la llave primaria, así
 * que un proveedor que reenvía el mismo correo tres veces —que pasa seguido— no
 * duplica nada, y una sincronización que relee con traslape tampoco. Lo ya guardado
 * NO se pisa: si alguien ya lo marcó como "no aplica", el reenvío no lo revive.
 */
export async function guardarComprobantes(
  entradas: { comprobante: Comprobante; fechaCorreo?: string; webLink?: string; remitente?: string }[],
): Promise<number> {
  if (!entradas.length) return 0;
  if (!(await tablaCorreoExiste())) throw new Error(FALTA_TABLA);
  const pool = await getPool();
  let nuevos = 0;
  for (const e of entradas) {
    const c = e.comprobante;
    if (!c.clave || c.clave.length !== 50) continue;
    const r = await pool.request()
      .input("clave", sql.Char(50), c.clave)
      .input("consecutivo", sql.Char(20), c.consecutivo.padStart(20, "0").slice(0, 20))
      .input("tipoDoc", sql.Char(2), c.tipo || "01")
      .input("cedulaEmisor", sql.VarChar(12), c.cedulaEmisor || "")
      .input("nombreEmisor", sql.NVarChar(200), (c.nombreEmisor || "").slice(0, 200))
      .input("cedulaReceptor", sql.VarChar(12), c.cedulaReceptor || null)
      .input("fechaEmision", sql.Date, c.fecha || null)
      .input("moneda", sql.VarChar(10), c.moneda || "CRC")
      .input("total", sql.Decimal(19, 4), c.total || 0)
      .input("fechaCorreo", sql.DateTime, e.fechaCorreo ? new Date(e.fechaCorreo) : null)
      .input("webLink", sql.NVarChar(1000), (e.webLink || "").slice(0, 1000) || null)
      .input("remitente", sql.NVarChar(200), (e.remitente || "").slice(0, 200) || null)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.FacturaCorreo WHERE clave = @clave)
        BEGIN
          INSERT dbo.FacturaCorreo
            (clave, consecutivo, tipoDoc, cedulaEmisor, nombreEmisor, cedulaReceptor,
             fechaEmision, moneda, total, fechaCorreo, webLink, remitente)
          VALUES
            (@clave, @consecutivo, @tipoDoc, @cedulaEmisor, @nombreEmisor, @cedulaReceptor,
             @fechaEmision, @moneda, @total, @fechaCorreo, @webLink, @remitente);
          SELECT 1 AS nuevo;
        END
        ELSE SELECT 0 AS nuevo;`);
    if (r.recordset[0]?.nuevo === 1) nuevos++;
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

export async function listarFacturasCorreo(opts: { desde?: string; estado?: string } = {}): Promise<FacturaCorreo[]> {
  if (!(await tablaCorreoExiste())) return [];
  const pool = await getPool();
  const req = pool.request();
  const donde: string[] = [];
  if (opts.desde) { req.input("desde", sql.Date, opts.desde); donde.push("fechaEmision >= @desde"); }
  if (opts.estado) { req.input("estado", sql.VarChar(20), opts.estado); donde.push("estado = @estado"); }
  const r = await req.query(`
    SELECT * FROM dbo.FacturaCorreo
    ${donde.length ? "WHERE " + donde.join(" AND ") : ""}
    ORDER BY fechaEmision DESC, fechaCorreo DESC`);
  return r.recordset.map(fila);
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
 * `fechaRegistro` se pone UNA sola vez, la primera vez que se ve registrada, y no se
 * vuelve a tocar: es el momento en que la factura apareció en BC, y de ahí sale
 * "cuánto tardó en digitarse". Si se reescribiera en cada corrida diría siempre "hoy".
 */
export async function guardarCotejo(resultados: ResultadoCotejo[]): Promise<void> {
  if (!resultados.length) return;
  if (!(await tablaCorreoExiste())) throw new Error(FALTA_TABLA);
  const pool = await getPool();
  for (const x of resultados) {
    await pool.request()
      .input("clave", sql.Char(50), x.clave)
      .input("estado", sql.VarChar(20), x.estado)
      .input("bcNumero", sql.VarChar(40), x.bcNumero ?? null)
      .input("bcProveedor", sql.VarChar(40), x.bcProveedor ?? null)
      .input("bcTotal", sql.Decimal(19, 4), x.bcTotal ?? null)
      .input("bcCalzePor", sql.VarChar(10), x.bcCalzePor ?? null)
      .query(`
        UPDATE dbo.FacturaCorreo SET
          estado        = @estado,
          bcNumero      = @bcNumero,
          bcProveedor   = @bcProveedor,
          bcTotal       = @bcTotal,
          bcCalzePor    = @bcCalzePor,
          ultimoCotejo  = getdate(),
          fechaRegistro = CASE
                            WHEN @estado IN ('registrada','descuadrada') AND fechaRegistro IS NULL
                              THEN getdate()
                            WHEN @estado NOT IN ('registrada','descuadrada')
                              THEN NULL
                            ELSE fechaRegistro
                          END
        WHERE clave = @clave`);
  }
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
