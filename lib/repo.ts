import { getAuthPool, getPool, sql } from "./db";
import { bcDeepLinkPedido, bcDeepLinkFacturaRegistrada, bcUnidadesDeCompra, sanearObrasDeLineas } from "./bc";
import { unidadCorregida } from "./unidad";
import { etiquetaInterna, esTipoDevolucion, esTipoEdicion } from "./helpers";
import type { UnidadCompraItem } from "./bc";
import type { DevolucionSolicitud, Orden, OrdenLinea, Pedido, PedidoLinea, Recepcion, RecepcionFoto, RecepcionLinea, Role, NotaCreditoLinea } from "./types";

/* ============================================================================
   Capa de acceso a datos (SQL Server) para Compras Adelante.
   Mapea las tablas PedidoCompra/Det, OrdenCompra/Det, RecepcionCompra/Det y
   Movimiento a los tipos de la app.
   Nota: `estado` en la app es un código; en SQL es idEstado (FK a Estado.nombre).
   Se mantiene un diccionario código <-> nombre y se resuelve idEstado contra
   el catálogo Estado (creando los que falten).
   ============================================================================ */

const NOMBRE_POR_CODIGO: Record<string, string> = {
  // pedido
  borrador: "Borrador", aprobado: "Aprobado", en_orden: "En orden", cerrado: "Cerrado", devuelto: "Devuelto",
  // orden
  abierto: "Abierto", pendiente_aprobacion: "Pendiente de aprobación", rechazado: "Rechazado", lanzado: "Lanzado", completado: "Completado",
};
const CODIGO_POR_NOMBRE: Record<string, string> = Object.fromEntries(
  Object.entries(NOMBRE_POR_CODIGO).map(([c, n]) => [n, c])
);
// Normaliza un nombre de estado (sin acentos, sin espacios extra, minúsculas) para
// tolerar cómo lo escriba otra app en la MISMA dbo.Estado (p. ej. Producción):
// "Aprobado" / "aprobado" / "APROBADO" / "En Orden" / "En orden" → mismo código.
const DIACRITICOS = new RegExp("[\u0300-\u036f]", "g");
const norm = (s: string) => (s ?? "").normalize("NFD").replace(DIACRITICOS, "").trim().toLowerCase();
const CODIGO_POR_NOMBRE_NORM: Record<string, string> = Object.fromEntries(
  Object.entries(NOMBRE_POR_CODIGO).map(([c, n]) => [norm(n), c])
);

let estadoNombreToId: Map<string, number> | null = null;
let estadoIdToNombre: Map<number, string> | null = null;

async function ensureEstados() {
  if (estadoNombreToId) return;
  const pool = await getPool();
  // crear los nombres que falten.
  // OJO: la tabla dbo.Estado es compartida con boletas: la columna del nombre
  // se llama `estado` (no `nombre`), y `creadoPor`/`fechaCreacion` son NOT NULL.
  for (const nombre of new Set(Object.values(NOMBRE_POR_CODIGO))) {
    await pool.request().input("n", sql.NVarChar(50), nombre).query(
      "IF NOT EXISTS (SELECT 1 FROM dbo.Estado WHERE estado=@n AND modulo='Compras') " +
      "INSERT dbo.Estado(estado,modulo,fechaCreacion,creadoPor) VALUES(@n,'Compras',SYSUTCDATETIME(),'sistema')"
    );
  }
  // ESCRITURA (nombre→id): solo módulo Compras, para no agarrar un id de boletas.
  const rC = await pool.request().query("SELECT idEstado, estado FROM dbo.Estado WHERE modulo='Compras'");
  estadoNombreToId = new Map();
  for (const row of rC.recordset) estadoNombreToId.set(row.estado, row.idEstado);
  // LECTURA (id→nombre): TODOS los módulos. Así un pedido cuyo idEstado lo escribió
  // otra app (p. ej. Producción, aunque el estado viva en otro módulo) igual resuelve
  // su nombre real y NO cae por defecto a "borrador" (que lo escondería).
  const rAll = await pool.request().query("SELECT idEstado, estado FROM dbo.Estado");
  estadoIdToNombre = new Map();
  for (const row of rAll.recordset) estadoIdToNombre.set(row.idEstado, row.estado);
}

async function idDeEstado(codigo?: string): Promise<number | null> {
  if (!codigo) return null;
  await ensureEstados();
  const nombre = NOMBRE_POR_CODIGO[codigo] ?? codigo;
  return estadoNombreToId!.get(nombre) ?? null;
}
// Agrupa las filas de detalle por su FK de cabecera en un solo pase. Antes cada
// cabecera hacía un .filter() sobre TODAS las líneas (cabeceras × líneas): con
// cientos de órdenes eso escala mal, y esto se ejecuta en cada bootstrap.
function porCabecera<T extends Record<string, any>>(filas: T[], fk: string): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const f of filas) {
    const k = f[fk] as number;
    const arr = m.get(k);
    if (arr) arr.push(f); else m.set(k, [f]);
  }
  return m;
}

function codigoDeId(id: number | null): string | undefined {
  if (id == null || !estadoIdToNombre) return undefined;
  const nombre = estadoIdToNombre.get(id);
  if (!nombre) return undefined;
  // Exacto → normalizado (tolera mayúsculas/acentos de otra app) → nombre crudo.
  return CODIGO_POR_NOMBRE[nombre] ?? CODIGO_POR_NOMBRE_NORM[norm(nombre)] ?? nombre;
}

// ----------------------------------------------------------------- health
export async function health() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.PedidoCompra)     AS pedidos,
      (SELECT COUNT(*) FROM dbo.OrdenCompra)      AS ordenes,
      (SELECT COUNT(*) FROM dbo.RecepcionCompra)  AS recepciones,
      (SELECT COUNT(*) FROM dbo.Movimiento)       AS movimientos`);
  return { ok: true, ...r.recordset[0] };
}

// ----------------------------------------------------------------- PEDIDOS

// DEVOLUCIONES de solicitudes, reconstruidas del log de movimientos.
//
// `dbo.PedidoCompraDet.idEstado` dice si una línea está devuelta AHORA, pero se borra
// cuando el ingeniero la corrige: después de eso no queda rastro de que hubo una
// devolución y la solicitud simplemente DESAPARECÍA de la bandeja de Devoluciones —
// la única forma de enterarse de que ya la habían arreglado era acordarse de ella.
//
// El log sí lo guarda: el movimiento "devuelto" (con el motivo y las líneas, lo
// escribe esta app) y la EDICIÓN posterior del ingeniero, que la app de Producción
// escribe en la misma bitácora. Comparando las dos fechas se sabe si ya la corrigió.
//
// Son dos consultas chicas: las devoluciones son pocas en toda la vida de la base, y
// las ediciones se piden SOLO de esas solicitudes.
const isoFecha = (f: any): string => (typeof f?.toISOString === "function" ? f.toISOString() : String(f ?? ""));

async function devolucionesDeSolicitudes(): Promise<Map<string, DevolucionSolicitud>> {
  const out = new Map<string, DevolucionSolicitud>();
  try {
    const pool = await getPool();
    // 1) La devolución más reciente de cada solicitud. El LIKE va ANCHO ('%dev%') y
    //    quién es devolución lo decide `esTipoDevolucion`: filtrar por '%devol%' no
    //    encuentra "devuelto" —el tipo que escribe esta app— y la bandeja salía
    //    vacía con la devolución sentada en la tabla.
    const dev = await pool.request().query(
      `SELECT idEntidad, tipoMovimiento, fecha, detalle, usuario FROM dbo.Movimiento
        WHERE entidad='pedido' AND tipoMovimiento LIKE '%dev%'
        ORDER BY fecha DESC, idMovimiento DESC`
    );
    for (const m of dev.recordset) {
      if (!esTipoDevolucion(m.tipoMovimiento)) continue;
      const key = String(m.idEntidad);
      if (out.has(key)) continue;              // la primera es la más reciente
      const detalle = String(m.detalle ?? "");
      const motivo = (detalle.split(/·\s*Motivo:\s*/i)[1] ?? "").trim();
      const lineas = (detalle.match(/l[íi]nea\(s\):\s*([^·]*)/i)?.[1] ?? "").trim();
      out.set(key, {
        fecha: isoFecha(m.fecha),
        motivo: motivo || undefined,
        lineas: lineas || undefined,
        usuario: m.usuario ?? undefined,
      });
    }
    if (!out.size) return out;

    // 2) ¿La editaron DESPUÉS? Esa es la señal de que el ingeniero ya la corrigió.
    //    Mismo criterio que arriba: SQL ancho, decisión en `esTipoEdicion`.
    const ids = [...out.keys()].map(Number).filter(Number.isFinite);
    const req = pool.request();
    let filtroIds = "";
    if (ids.length <= 500) {
      const params = ids.map((id, i) => { req.input(`p${i}`, sql.Int, id); return `@p${i}`; });
      filtroIds = ` AND idEntidad IN (${params.join(",")})`;
    }
    const ed = await req.query(
      `SELECT idEntidad, tipoMovimiento, fecha, usuario, rol FROM dbo.Movimiento
        WHERE entidad='pedido'${filtroIds}
          AND (tipoMovimiento LIKE '%edit%' OR tipoMovimiento LIKE '%edic%' OR tipoMovimiento LIKE '%modific%')
        ORDER BY fecha DESC, idMovimiento DESC`
    );
    const vistos = new Set<string>();
    for (const m of ed.recordset) {
      if (!esTipoEdicion(m.tipoMovimiento)) continue;
      const key = String(m.idEntidad);
      if (vistos.has(key)) continue;           // la primera es la edición más reciente
      vistos.add(key);
      const d = out.get(key);
      if (!d) continue;
      const fecha = isoFecha(m.fecha);
      // Solo cuenta si es POSTERIOR a la devolución: las ediciones de antes son de
      // cuando la solicitud se estaba armando.
      if (fecha > d.fecha) d.corregida = { fecha, usuario: m.usuario ?? undefined, rol: m.rol ?? undefined };
    }
  } catch (e) {
    // Sin bitácora las solicitudes quedan sin dato de devolución (la pantalla no se
    // cae). Pero se LOGUEA: este catch en silencio fue lo que hizo que un filtro mal
    // escrito pasara por "no hay devoluciones" en vez de por un error.
    console.warn("devoluciones de solicitudes (bitácora)", e);
  }
  return out;
}

export async function listPedidos(): Promise<Pedido[]> {
  await ensureEstados();
  const pool = await getPool();
  const h = await pool.request().query("SELECT * FROM dbo.PedidoCompra WHERE esEliminada = 0 ORDER BY idPedidoCompra DESC");
  const d = await pool.request().query("SELECT * FROM dbo.PedidoCompraDet ORDER BY idPedidoCompraDet");
  const porPedido = porCabecera(d.recordset, "idPedidoCompra");
  const [unidades, devoluciones] = await Promise.all([mapaUnidades(), devolucionesDeSolicitudes()]);
  return h.recordset.map((p) => mapPedido(p, porPedido.get(p.idPedidoCompra) ?? [], unidades, devoluciones));
}

export async function getPedido(id: number): Promise<Pedido | null> {
  await ensureEstados();
  const pool = await getPool();
  const h = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.PedidoCompra WHERE idPedidoCompra=@id");
  if (!h.recordset.length) return null;
  const d = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.PedidoCompraDet WHERE idPedidoCompra=@id ORDER BY idPedidoCompraDet");
  const [unidades, devoluciones] = await Promise.all([mapaUnidades(), devolucionesDeSolicitudes()]);
  return mapPedido(h.recordset[0], d.recordset, unidades, devoluciones);
}

// Unidades de compra de BC, una sola vez por request. Si BC no responde devuelve
// {} y cada línea se queda con la unidad que tiene guardada.
//
// Por qué se corrige al LEER y no solo al escribir: las solicitudes las crea la app
// de Producción, que copia la unidad BASE del catálogo. Cuando esa línea llega a
// Proveeduría ya viene con "GR" aunque el material se compre por ESTAÑON, y es acá
// donde se decide qué se le pide al proveedor. `unidadCorregida` solo cambia la
// unidad cuando la guardada es exactamente la base (o sea, la heredada por defecto).
async function mapaUnidades(): Promise<Record<string, UnidadCompraItem>> {
  try { return await bcUnidadesDeCompra(); } catch { return {}; }
}

function unidadLinea(itemNo: string, guardada: string, mapa: Record<string, UnidadCompraItem>) {
  const u = mapa[itemNo];
  const unidad = unidadCorregida(guardada, u);
  // El factor del catálogo dice cuántas unidades base trae la unidad de COMPRA
  // (1 EST = 255.000 GR). Desde que se puede elegir con qué unidad se compra, la
  // línea puede estar en otra (LT, TANQUETA…) y ese factor ya no la describe: se
  // manda solo cuando la unidad de la línea ES la de compra. Sin factor no se
  // muestra equivalencia, que es mejor que mostrar la de otra unidad.
  const norm = (x?: string) => (x ?? "").trim().toUpperCase();
  return {
    unidad,
    unidadBase: u?.base || undefined,
    factorCompra: norm(unidad) === norm(u?.compra) ? u?.factor : undefined,
  };
}

function mapPedido(
  p: any, lineas: any[],
  unidades: Record<string, UnidadCompraItem> = {},
  devoluciones: Map<string, DevolucionSolicitud> = new Map(),
): Pedido {
  return {
    id: String(p.idPedidoCompra), numero: p.pedidoNo ?? "",
    tipoSolicitud: (p.tipoSolicitud ?? "material") as Pedido["tipoSolicitud"],
    obraCodigo: p.obra ?? undefined, obraNombre: p.proyecto ?? undefined,
    maquinaNo: p.maquinaNo ?? undefined, maquinaNombre: undefined,
    solicitante: p.solicitante ?? "", fecha: (p.fechaCreacion?.toISOString?.() ?? "").slice(0, 10),
    estado: (codigoDeId(p.idEstado) ?? "borrador") as Pedido["estado"],
    prioridad: (p.prioridad ?? "normal") as Pedido["prioridad"], notas: p.notaCreador ?? undefined,
    idClasificacion: p.idClasificacion ?? null,
    // Devolución + si el ingeniero ya la corrigió (sale de la bitácora, ver
    // devolucionesDeSolicitudes). Sin esto, una solicitud corregida no se distingue
    // de una que nunca se devolvió.
    devolucion: devoluciones.get(String(p.idPedidoCompra)),
    lineas: lineas.map((l): PedidoLinea => ({
      id: String(l.idPedidoCompraDet), articuloId: l.itemNo ?? "", descripcion: l.descripcion ?? "",
      cantidad: Number(l.quantitySolicitado ?? 0),
      ...unidadLinea(l.itemNo ?? "", l.unitOfMeasureCode ?? "", unidades),
      almacen: l.locationCode ?? "", variantCode: l.variantCode ?? undefined,
      // Obra y tarea de la SOLICITUD. Las escribe Ingeniería desde la app de
      // Producción y acá solo se leen para arrastrarlas a la orden. Los nombres de
      // columna son los de ESA app (verificados en su repo): `obra`, no `jobNo`.
      // La tarea es la que marca el CONSUMO DIRECTO (ver esConsumoDirecto).
      proyecto: l.obra ?? undefined, taskNo: l.taskNo ?? undefined, taskDescr: l.taskDescr ?? undefined,
      cantidadOrdenada: Number(l.quantityOrdenado ?? 0), notas: l.notaCreador ?? undefined,
      // Devolución POR LÍNEA: vive en dbo.PedidoCompraDet.idEstado (la columna ya
      // existía sin usarse). Así Proveeduría devuelve una línea suelta sin tumbar
      // el pedido entero, que es lo único que se podía hacer antes.
      devuelta: codigoDeId(l.idEstado) === "devuelto" || undefined,
    })),
  };
}

export interface NewPedidoDB {
  tipoSolicitud: string; obra?: string; obraNombre?: string; maquinaNo?: string;
  idClasificacion?: number | null;
  solicitante: string; prioridad: string; notas?: string; usuario: string; rol: Role;
  lineas: { itemNo: string; descripcion: string; cantidad: number; unidad: string; almacen: string; variantCode?: string }[];
}

export async function createPedido(input: NewPedidoDB): Promise<number> {
  const pool = await getPool();
  const idBorrador = await idDeEstado("borrador");
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // número correlativo PED-000xxx
    const max = await new sql.Request(tx).query(
      "SELECT MAX(CAST(SUBSTRING(pedidoNo,5,20) AS INT)) AS m FROM dbo.PedidoCompra WHERE pedidoNo LIKE 'PED-%'"
    );
    const numero = "PED-" + String((max.recordset[0].m ?? 0) + 1).padStart(6, "0");
    const ins = await new sql.Request(tx)
      .input("idEstado", sql.Int, idBorrador)
      .input("pedidoNo", sql.NVarChar(50), numero)
      .input("tipoSolicitud", sql.NVarChar(15), input.tipoSolicitud)
      .input("obra", sql.NVarChar(50), input.obra ?? null)
      .input("maquinaNo", sql.NVarChar(20), input.maquinaNo ?? null)
      .input("proyecto", sql.NVarChar(150), input.obraNombre ?? null)
      .input("solicitante", sql.NVarChar(100), input.solicitante)
      .input("prioridad", sql.NVarChar(20), input.prioridad)
      .input("notaCreador", sql.NVarChar(500), input.notas ?? null)
      .input("idClasificacion", sql.Int, input.idClasificacion ?? null)
      .input("creadoPor", sql.NVarChar(100), input.usuario)
      .query(`INSERT dbo.PedidoCompra (idEstado,pedidoNo,tipoSolicitud,obra,maquinaNo,proyecto,solicitante,prioridad,notaCreador,idClasificacion,esEliminada,fechaCreacion,creadoPor)
              OUTPUT INSERTED.idPedidoCompra
              VALUES (@idEstado,@pedidoNo,@tipoSolicitud,@obra,@maquinaNo,@proyecto,@solicitante,@prioridad,@notaCreador,@idClasificacion,0,getdate(),@creadoPor)`);
    const idPedido = ins.recordset[0].idPedidoCompra as number;

    let line = 10000;
    for (const l of input.lineas) {
      await new sql.Request(tx)
        .input("idPedidoCompra", sql.Int, idPedido)
        .input("lineNum", sql.Int, line)
        .input("descripcion", sql.NVarChar(250), l.descripcion)
        .input("itemNo", sql.NVarChar(50), l.itemNo)
        .input("variantCode", sql.NVarChar(20), l.variantCode ?? null)
        .input("unitOfMeasureCode", sql.NVarChar(20), l.unidad)
        .input("locationCode", sql.NVarChar(20), l.almacen)
        .input("quantitySolicitado", sql.Decimal(18, 4), l.cantidad)
        .input("creadoPor", sql.NVarChar(100), input.usuario)
        .query(`INSERT dbo.PedidoCompraDet (idPedidoCompra,lineNum,descripcion,itemNo,variantCode,unitOfMeasureCode,locationCode,quantitySolicitado,quantityOrdenado,fechaCreacion,creadoPor)
                VALUES (@idPedidoCompra,@lineNum,@descripcion,@itemNo,@variantCode,@unitOfMeasureCode,@locationCode,@quantitySolicitado,0,getdate(),@creadoPor)`);
      line += 10000;
    }
    await logMov(tx, { entidad: "pedido", idEntidad: idPedido, documentoNo: numero, tipoMovimiento: "creado", estadoNuevo: "borrador", usuario: input.usuario, rol: input.rol });
    await tx.commit();
    return idPedido;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export interface EditPedidoDB extends NewPedidoDB { id: number; }

export async function updatePedido(input: EditPedidoDB): Promise<void> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Solo se puede editar si NO tiene nada ordenado por proveeduría.
    const chk = await new sql.Request(tx).input("id", sql.Int, input.id).query(
      `SELECT p.pedidoNo,
              (SELECT ISNULL(SUM(quantityOrdenado),0) FROM dbo.PedidoCompraDet WHERE idPedidoCompra=p.idPedidoCompra) AS ordenado
       FROM dbo.PedidoCompra p WHERE p.idPedidoCompra=@id AND p.esEliminada=0`
    );
    const row = chk.recordset[0];
    if (!row) throw new Error("Pedido no encontrado");
    if (Number(row.ordenado) > 0) throw new Error("El pedido ya tiene orden de compra; no se puede editar");

    await new sql.Request(tx)
      .input("id", sql.Int, input.id)
      .input("tipoSolicitud", sql.NVarChar(15), input.tipoSolicitud)
      .input("obra", sql.NVarChar(50), input.obra ?? null)
      .input("maquinaNo", sql.NVarChar(20), input.maquinaNo ?? null)
      .input("proyecto", sql.NVarChar(150), input.obraNombre ?? null)
      .input("prioridad", sql.NVarChar(20), input.prioridad)
      .input("notaCreador", sql.NVarChar(500), input.notas ?? null)
      .input("modificadoPor", sql.NVarChar(100), input.usuario)
      .query(`UPDATE dbo.PedidoCompra SET tipoSolicitud=@tipoSolicitud, obra=@obra, maquinaNo=@maquinaNo,
              proyecto=@proyecto, prioridad=@prioridad, notaCreador=@notaCreador,
              fechaModificacion=getdate(), modificadoPor=@modificadoPor WHERE idPedidoCompra=@id`);

    // Reemplazar líneas (seguro: no hay órdenes que las referencien).
    await new sql.Request(tx).input("id", sql.Int, input.id).query("DELETE FROM dbo.PedidoCompraDet WHERE idPedidoCompra=@id");
    let line = 10000;
    for (const l of input.lineas) {
      await new sql.Request(tx)
        .input("idPedidoCompra", sql.Int, input.id)
        .input("lineNum", sql.Int, line)
        .input("descripcion", sql.NVarChar(250), l.descripcion)
        .input("itemNo", sql.NVarChar(50), l.itemNo)
        .input("variantCode", sql.NVarChar(20), l.variantCode ?? null)
        .input("unitOfMeasureCode", sql.NVarChar(20), l.unidad)
        .input("locationCode", sql.NVarChar(20), l.almacen)
        .input("quantitySolicitado", sql.Decimal(18, 4), l.cantidad)
        .input("creadoPor", sql.NVarChar(100), input.usuario)
        .query(`INSERT dbo.PedidoCompraDet (idPedidoCompra,lineNum,descripcion,itemNo,variantCode,unitOfMeasureCode,locationCode,quantitySolicitado,quantityOrdenado,fechaCreacion,creadoPor)
                VALUES (@idPedidoCompra,@lineNum,@descripcion,@itemNo,@variantCode,@unitOfMeasureCode,@locationCode,@quantitySolicitado,0,getdate(),@creadoPor)`);
      line += 10000;
    }
    await logMov(tx, { entidad: "pedido", idEntidad: input.id, documentoNo: row.pedidoNo, tipoMovimiento: "editado", usuario: input.usuario, rol: input.rol });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export async function setPedidoEstado(id: number, estado: string, usuario: string, rol: Role, motivo?: string) {
  const pool = await getPool();
  const prev = await pool.request().input("id", sql.Int, id).query("SELECT idEstado, pedidoNo, notaCreador FROM dbo.PedidoCompra WHERE idPedidoCompra=@id");
  const idEstado = await idDeEstado(estado);
  const req = pool.request().input("id", sql.Int, id).input("e", sql.Int, idEstado).input("u", sql.NVarChar(100), usuario);
  // Al DEVOLVER a Ingeniería, guardamos el motivo en la nota del pedido (mismo
  // formato que el modo local) para que la bandeja de Devoluciones lo muestre en
  // ambas apps (Proveeduría e Ingeniería/Producción, que comparten esta tabla).
  let setNota = "";
  if (motivo && estado === "devuelto") {
    const prevNota = prev.recordset[0]?.notaCreador ?? "";
    req.input("nota", sql.NVarChar(sql.MAX), `↩ Devuelto: ${motivo}${prevNota ? ` · ${prevNota}` : ""}`);
    setNota = ", notaCreador=@nota";
  }
  await req.query(`UPDATE dbo.PedidoCompra SET idEstado=@e, fechaModificacion=getdate(), modificadoPor=@u${setNota} WHERE idPedidoCompra=@id`);
  const tx = new sql.Transaction(pool); await tx.begin();
  await logMov(tx, { entidad: "pedido", idEntidad: id, documentoNo: prev.recordset[0]?.pedidoNo ?? "", tipoMovimiento: estado, estadoAnterior: codigoDeId(prev.recordset[0]?.idEstado), estadoNuevo: estado, detalle: motivo ? `Motivo: ${motivo}` : undefined, usuario, rol });
  await tx.commit();
}

// ¿La línea de pedido puede llevar estado propio? La columna `idEstado` de
// dbo.PedidoCompraDet ya existe (la tabla la comparte la app de Producción y la
// trae desde su creación), pero se comprueba igual: si algún día no está, la
// devolución por línea avisa en vez de fallar con un error de SQL ilegible.
let lineaEstadoLista: boolean | null = null;
async function ensureLineaEstado(): Promise<boolean> {
  if (lineaEstadoLista !== null) return lineaEstadoLista;
  try {
    const pool = await getPool();
    const r = await pool.request().query("SELECT COL_LENGTH('dbo.PedidoCompraDet','idEstado') AS a");
    lineaEstadoLista = r.recordset[0]?.a != null;
  } catch { lineaEstadoLista = false; }
  return lineaEstadoLista;
}

export const MSG_LINEA_ORDENADA = "Esa línea ya tiene orden de compra: no se puede devolver.";

// Devuelve al ingeniero las LÍNEAS elegidas de una solicitud (no el pedido entero).
//
// Reglas, y el porqué:
//  · Solo se devuelve lo que Proveeduría todavía no comprometió. Con orden de compra
//    hecha el material ya se le pidió al proveedor; devolver esa línea dejaría a
//    Ingeniería creyendo que no se compró.
//  · La línea devuelta queda BLOQUEADA (idEstado = Devuelto): no se puede ordenar ni
//    devolver otra vez.
//  · El pedido ENTERO pasa a "Devuelto" solo si TODAS sus líneas quedaron devueltas.
//    Si alguna ya tiene orden, el pedido sigue su curso con las demás.
export async function devolverLineasPedido(
  idPedido: number, lineaIds: number[], motivo: string, usuario: string, rol: Role,
): Promise<{ devueltas: number; pedidoDevuelto: boolean; nombres: string[] }> {
  if (!lineaIds?.length) throw new Error("No se eligió ninguna línea para devolver.");
  if (!(await ensureLineaEstado())) throw new Error("La base todavía no tiene la columna dbo.PedidoCompraDet.idEstado, que es donde se marca la línea devuelta.");
  await ensureEstados();
  const pool = await getPool();
  const idDevuelto = await idDeEstado("devuelto");

  const cab = await pool.request().input("id", sql.Int, idPedido)
    .query("SELECT pedidoNo, idEstado, notaCreador FROM dbo.PedidoCompra WHERE idPedidoCompra=@id AND esEliminada=0");
  if (!cab.recordset.length) throw new Error("La solicitud no existe.");
  const pedidoNo = cab.recordset[0].pedidoNo ?? "";

  const det = await pool.request().input("id", sql.Int, idPedido)
    .query("SELECT idPedidoCompraDet, descripcion, itemNo, idEstado, quantitySolicitado, quantityOrdenado FROM dbo.PedidoCompraDet WHERE idPedidoCompra=@id");
  const porId = new Map<number, any>(det.recordset.map((l: any) => [l.idPedidoCompraDet as number, l]));

  const aDevolver: any[] = [];
  for (const lid of lineaIds) {
    const l = porId.get(Number(lid));
    if (!l) throw new Error(`La línea ${lid} no es de esta solicitud.`);
    if (Number(l.quantityOrdenado ?? 0) > 0) throw new Error(`${l.descripcion || l.itemNo || `Línea ${lid}`}: ${MSG_LINEA_ORDENADA}`);
    if (l.idEstado === idDevuelto) continue;   // ya devuelta: no se repite ni se duplica el movimiento
    aDevolver.push(l);
  }
  if (!aDevolver.length) {
    // Reintento sobre líneas que ya estaban devueltas (doble clic, pestaña vieja).
    // Hay que mirar igual si el pedido quedó entero devuelto: contestar `false` a
    // ciegas hacía que la pantalla dijera "sigue abierta con el resto" sobre una
    // solicitud que ya está Devuelta y desapareció de la lista.
    const yaTodo = det.recordset.every((l: any) => l.idEstado === idDevuelto);
    return { devueltas: 0, pedidoDevuelto: yaTodo, nombres: [] };
  }

  // Con TODAS las líneas devueltas, el pedido entero se va de vuelta: así aparece en
  // la bandeja de Devoluciones del ingeniero, igual que la devolución de siempre.
  const devueltasIds = new Set<number>([...det.recordset.filter((l: any) => l.idEstado === idDevuelto).map((l: any) => l.idPedidoCompraDet), ...aDevolver.map((l) => l.idPedidoCompraDet)]);
  const pedidoDevuelto = det.recordset.every((l: any) => devueltasIds.has(l.idPedidoCompraDet));
  const nombres = aDevolver.map((l) => String(l.descripcion || l.itemNo || `Línea ${l.idPedidoCompraDet}`));

  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    await marcarLineasDevueltasTx(tx, {
      idPedido, pedidoNo, idEstadoPedido: cab.recordset[0]?.idEstado,
      notaPrevia: cab.recordset[0]?.notaCreador ?? "",
      idsLinea: aDevolver.map((l) => Number(l.idPedidoCompraDet)),
      nombres, pedidoDevuelto, motivo, usuario, rol,
    });
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  return { devueltas: aDevolver.length, pedidoDevuelto, nombres };
}

// Marca líneas de una solicitud como DEVUELTAS, dentro de una transacción abierta.
//
// Vive aparte porque hay DOS caminos que devuelven al ingeniero y tienen que dejar el
// dato idéntico: la devolución desde la solicitud (líneas que nadie ordenó) y la
// devolución desde una ORDEN rechazada (la línea ya estaba comprometida y primero se
// le saca a la orden — ver devolverLineasDeOrden). Si el formato de la nota o el
// movimiento se escribieran dos veces, un día dirían cosas distintas y la app de
// Producción —que lee de ahí— mostraría una y no la otra.
async function marcarLineasDevueltasTx(tx: sql.Transaction, o: {
  idPedido: number; pedidoNo: string; idEstadoPedido: number | null; notaPrevia: string;
  idsLinea: number[]; nombres: string[]; pedidoDevuelto: boolean;
  motivo: string; usuario: string; rol: Role;
  // De dónde salió la devolución, para el historial ("desde la orden CP-005154").
  origen?: string;
}): Promise<void> {
  const idDevuelto = await idDeEstado("devuelto");
  for (const idLinea of o.idsLinea) {
    await new sql.Request(tx)
      .input("id", sql.Int, idLinea).input("e", sql.Int, idDevuelto).input("u", sql.NVarChar(100), o.usuario)
      .query("UPDATE dbo.PedidoCompraDet SET idEstado=@e, fechaModificacion=getdate(), modificadoPor=@u WHERE idPedidoCompraDet=@id");
  }
  // La nota del pedido se toca SIEMPRE, no solo cuando vuelve entero: es el único
  // canal que la app de Producción ya muestra hoy (la bandeja de Devoluciones y el
  // detalle del ingeniero la leen de ahí). Sin esto, una devolución parcial no la
  // ve nadie del otro lado hasta que esa app lea el estado por línea.
  const encabezado = o.pedidoDevuelto ? `↩ Devuelto: ${o.motivo}` : `↩ Devuelta(s): ${o.nombres.join("; ")} — ${o.motivo}`;
  const nota = `${encabezado}${o.notaPrevia ? ` · ${o.notaPrevia}` : ""}`.slice(0, 500);
  const reqCab = new sql.Request(tx)
    .input("id", sql.Int, o.idPedido).input("u", sql.NVarChar(100), o.usuario)
    .input("nota", sql.NVarChar(500), nota);
  let setEstado = "";
  if (o.pedidoDevuelto) { reqCab.input("e", sql.Int, idDevuelto); setEstado = "idEstado=@e, "; }
  await reqCab.query(`UPDATE dbo.PedidoCompra SET ${setEstado}notaCreador=@nota, fechaModificacion=getdate(), modificadoPor=@u WHERE idPedidoCompra=@id`);
  // Un solo movimiento con los nombres: el historial tiene que decir QUÉ se
  // devolvió, no solo que hubo una devolución.
  await logMov(tx, {
    entidad: "pedido", idEntidad: o.idPedido, documentoNo: o.pedidoNo,
    tipoMovimiento: "devuelto",
    estadoAnterior: codigoDeId(o.idEstadoPedido),
    estadoNuevo: o.pedidoDevuelto ? "devuelto" : codigoDeId(o.idEstadoPedido),
    detalle: `${o.pedidoDevuelto ? "Solicitud devuelta" : `Devuelta(s) ${o.nombres.length} línea(s): ${o.nombres.join("; ")}`}${o.origen ? ` · ${o.origen}` : ""}${o.motivo ? ` · Motivo: ${o.motivo}` : ""}`,
    usuario: o.usuario, rol: o.rol,
  });
}

// Obra de cada línea de SOLICITUD (dbo.PedidoCompraDet.obra), por id de línea.
//
// Es de dónde sale el centro de costo de una compra para STOCK: ahí la obra existe
// —el material entra a bodega y queda apartado para ella— pero no viaja como Job No.
// porque BC exige tarea con él y el pedido para stock no la tiene. La orden guarda el
// vínculo (`idPedidoCompraDet`), así que la obra se busca en la solicitud de origen y
// no hay que duplicarla en OrdenCompraDet.
export async function obrasDeLineasPedido(ids: number[]): Promise<Map<string, string>> {
  const limpios = [...new Set((ids ?? []).map((n) => Math.trunc(Number(n))).filter((n) => Number.isSafeInteger(n) && n > 0))];
  const out = new Map<string, string>();
  if (!limpios.length) return out;
  const pool = await getPool();
  const r = await pool.request().query(
    `SELECT idPedidoCompraDet, obra FROM dbo.PedidoCompraDet WHERE idPedidoCompraDet IN (${limpios.join(",")})`);
  for (const row of r.recordset) {
    const obra = String(row.obra ?? "").trim();
    if (obra) out.set(String(row.idPedidoCompraDet), obra);
  }
  return out;
}

export async function softDeletePedido(id: number, usuario: string, rol: Role) {
  const pool = await getPool();
  const prev = await pool.request().input("id", sql.Int, id).query("SELECT pedidoNo FROM dbo.PedidoCompra WHERE idPedidoCompra=@id");
  await pool.request().input("id", sql.Int, id).input("u", sql.NVarChar(100), usuario)
    .query("UPDATE dbo.PedidoCompra SET esEliminada=1, fechaModificacion=getdate(), modificadoPor=@u WHERE idPedidoCompra=@id");
  const tx = new sql.Transaction(pool); await tx.begin();
  await logMov(tx, { entidad: "pedido", idEntidad: id, documentoNo: prev.recordset[0]?.pedidoNo ?? "", tipoMovimiento: "eliminado", usuario, rol });
  await tx.commit();
}

// ----------------------------------------------------------------- ORDENES

// El tipo de Cargo de producto (Item Charge de BC) y su método de reparto se
// eligen en la app —y son OBLIGATORIOS para que BC acepte el flete— pero no
// tenían dónde guardarse: se perdían al primer viaje por SQL. Estas dos columnas
// nullable las agregan (idempotente). Si el usuario de la base no tiene permiso
// de ALTER, se sigue trabajando exactamente como antes: `cargoColsListas` queda
// en false y los INSERT no las mencionan.
// Igual que `ensureCargoCols`, pero para el comentario interno de la orden (el
// mensaje al aprobador, dbo.OrdenCompra.notaInterna). Mientras la columna no
// exista, la app funciona igual y ese comentario simplemente no se guarda: nombrar
// una columna inexistente en el INSERT rompería la creación de órdenes.
// La migración es sql/orden_nota_interna.sql (o automática con MIGRAR_ESQUEMA=1).
let notaInternaLista: boolean | null = null;
async function ensureNotaInterna(): Promise<boolean> {
  if (notaInternaLista !== null) return notaInternaLista;
  try {
    const pool = await getPool();
    if (process.env.MIGRAR_ESQUEMA === "1") {
      await pool.request().query(`
        IF COL_LENGTH('dbo.OrdenCompra','notaInterna') IS NULL
          ALTER TABLE dbo.OrdenCompra ADD notaInterna NVARCHAR(500) NULL;`);
    }
    const r = await pool.request().query("SELECT COL_LENGTH('dbo.OrdenCompra','notaInterna') AS a");
    notaInternaLista = r.recordset[0]?.a != null;
  } catch {
    notaInternaLista = false;
  }
  return notaInternaLista;
}

let cargoColsListas: boolean | null = null;
async function ensureCargoCols(): Promise<boolean> {
  if (cargoColsListas !== null) return cargoColsListas;
  try {
    const pool = await getPool();
    // dbo.OrdenCompraDet la COMPARTE la app de Producción, así que esta app NO le
    // hace ALTER por su cuenta: solo detecta si las columnas ya están. La migración
    // se corre a mano (db/migracion_cargo_cols.sql) o, si se quiere automática,
    // poniendo MIGRAR_ESQUEMA=1 en el App Setting. Mientras no existan, todo sigue
    // funcionando como antes (sin guardar el tipo de cargo).
    if (process.env.MIGRAR_ESQUEMA === "1") {
      await pool.request().query(`
        IF COL_LENGTH('dbo.OrdenCompraDet','chargeNo') IS NULL
          ALTER TABLE dbo.OrdenCompraDet ADD chargeNo NVARCHAR(40) NULL;
        IF COL_LENGTH('dbo.OrdenCompraDet','chargeMethod') IS NULL
          ALTER TABLE dbo.OrdenCompraDet ADD chargeMethod NVARCHAR(20) NULL;`);
    }
    const r = await pool.request().query(
      "SELECT COL_LENGTH('dbo.OrdenCompraDet','chargeNo') AS a, COL_LENGTH('dbo.OrdenCompraDet','chargeMethod') AS b"
    );
    cargoColsListas = r.recordset[0]?.a != null && r.recordset[0]?.b != null;
  } catch {
    cargoColsListas = false;
  }
  return cargoColsListas;
}

// El motivo del rechazo NO tiene columna en dbo.OrdenCompra: vive en el log de
// movimientos (`detalle` = "Motivo: …" del movimiento de rechazo, que escribe la
// app de Aprobación/Producción). Sin esto, Devoluciones mostraba el motivo "—".
// Se toma el movimiento de rechazo MÁS RECIENTE por orden y se tolera cómo lo
// escriba la otra app (rechazado/rechazo/rechazada/devuelto…).
// Se consulta SOLO para las órdenes que están rechazadas (lo normal es que no haya
// ninguna, y entonces no se toca dbo.Movimiento): esto corre en cada bootstrap.
async function motivosRechazo(idsOrden: number[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!idsOrden.length) return out;
  try {
    const pool = await getPool();
    const req = pool.request();
    // Con muchísimas rechazadas no vale la pena (y SQL Server topa en ~2100
    // parámetros): se cae a filtrar solo por tipo de movimiento.
    let filtroIds = "";
    if (idsOrden.length <= 500) {
      const params = idsOrden.map((id, i) => { req.input(`id${i}`, sql.Int, id); return `@id${i}`; });
      filtroIds = ` AND idEntidad IN (${params.join(",")})`;
    }
    const r = await req.query(
      `SELECT idEntidad, detalle FROM dbo.Movimiento
        WHERE entidad='orden' AND detalle IS NOT NULL AND LTRIM(detalle) <> ''${filtroIds}
          AND (tipoMovimiento LIKE '%rechaz%' OR tipoMovimiento LIKE '%devol%')
        ORDER BY fecha DESC, idMovimiento DESC`
    );
    for (const m of r.recordset) {
      const key = String(m.idEntidad);
      if (out.has(key)) continue;            // el primero es el más reciente
      const motivo = String(m.detalle).replace(/^\s*Motivo:\s*/i, "").trim();
      if (motivo) out.set(key, motivo);
    }
  } catch { /* si el log no está disponible, la orden queda sin motivo (no rompe) */ }
  return out;
}

export async function listOrdenes(): Promise<Orden[]> {
  await ensureEstados();
  const pool = await getPool();
  const h = await pool.request().query("SELECT * FROM dbo.OrdenCompra WHERE esEliminada = 0 ORDER BY idOrdenCompra DESC");
  // pedidoNumero se resuelve desde el vínculo idPedidoCompraDet → PedidoCompra.pedidoNo
  // (si no, la orden se veía siempre como "Directa" aunque naciera de un pedido).
  const d = await pool.request().query(`SELECT det.*, pc.pedidoNo AS pedidoNumero
      FROM dbo.OrdenCompraDet det
      LEFT JOIN dbo.PedidoCompraDet pcd ON pcd.idPedidoCompraDet = det.idPedidoCompraDet
      LEFT JOIN dbo.PedidoCompra pc ON pc.idPedidoCompra = pcd.idPedidoCompra
      ORDER BY det.idOrdenCompraDet`);
  const rechazadas = h.recordset.filter((o) => codigoDeId(o.idEstado) === "rechazado").map((o) => o.idOrdenCompra as number);
  const motivos = await motivosRechazo(rechazadas);
  const porOrden = porCabecera(d.recordset, "idOrdenCompra");
  const unidades = await mapaUnidades();
  return h.recordset.map((o) => mapOrden(
    o,
    porOrden.get(o.idOrdenCompra) ?? [],
    motivos.get(String(o.idOrdenCompra)),
    unidades,
  ));
}

export async function getOrden(id: number): Promise<Orden | null> {
  await ensureEstados();
  const pool = await getPool();
  const h = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.OrdenCompra WHERE idOrdenCompra=@id");
  if (!h.recordset.length) return null;
  const d = await pool.request().input("id", sql.Int, id).query(`SELECT det.*, pc.pedidoNo AS pedidoNumero
      FROM dbo.OrdenCompraDet det
      LEFT JOIN dbo.PedidoCompraDet pcd ON pcd.idPedidoCompraDet = det.idPedidoCompraDet
      LEFT JOIN dbo.PedidoCompra pc ON pc.idPedidoCompra = pcd.idPedidoCompra
      WHERE det.idOrdenCompra=@id ORDER BY det.idOrdenCompraDet`);
  const esRechazada = codigoDeId(h.recordset[0].idEstado) === "rechazado";
  const motivos = await motivosRechazo(esRechazada ? [id] : []);
  return mapOrden(h.recordset[0], d.recordset, motivos.get(String(id)), await mapaUnidades());
}

function mapOrden(o: any, lineas: any[], motivoRechazo?: string, unidades: Record<string, UnidadCompraItem> = {}): Orden {
  return {
    id: String(o.idOrdenCompra), numero: o.ordenNo ?? "", proveedorId: o.proveedorNo ?? "",
    proveedorNo: o.proveedorNo ?? undefined, proveedorNombre: o.proveedorNombre ?? undefined,
    fecha: (o.fechaEmision?.toISOString?.() ?? o.fechaCreacion?.toISOString?.() ?? "").slice(0, 10),
    currencyCode: o.currencyCode ?? "",
    estado: (codigoDeId(o.idEstado) ?? "abierto") as Orden["estado"],
    versionesArchivadas: Number(o.versionesArchivadas ?? 0),
    motivoRechazo: motivoRechazo || undefined,
    creadoPor: o.creadoPor || undefined,     // quién generó la OC (reportes)
    observaciones: o.notaCreador || undefined,   // se imprimen en el PDF del proveedor
    notaInterna: o.notaInterna || undefined,     // mensaje al aprobador; NUNCA sale en el PDF

    bcNumber: o.bcNo || undefined,           // Nº del Pedido en BC (para recibir/facturar)
    // Deep link al Pedido en BC. FALTABA en modo API: `bcDeepLink` solo se llenaba
    // en mock, así que en producción el botón "Abrir en BC" nunca aparecía y el
    // "Volver a abrir" no abría nada (hacía window.open(undefined)).
    bcDeepLink: (o.bcNo && bcDeepLinkPedido(String(o.bcNo))) || undefined,
    lineas: lineas.map((l): OrdenLinea => ({
      id: String(l.idOrdenCompraDet), tipo: (l.tipoLinea === "cargo" ? "cargo" : "articulo"),
      articuloId: l.itemNo ?? undefined, variantCode: l.variantCode ?? undefined, pedidoLineaId: l.idPedidoCompraDet ? String(l.idPedidoCompraDet) : undefined,
      pedidoNumero: l.pedidoNumero ?? undefined, descripcion: l.descripcion ?? "", cantidad: Number(l.quantity ?? 0),
      // Los cargos (flete) no son materiales: no tienen unidad de compra que corregir.
      ...(l.tipoLinea === "cargo"
        ? { unidad: l.unitOfMeasureCode ?? "" }
        : unidadLinea(l.itemNo ?? "", l.unitOfMeasureCode ?? "", unidades)),
      almacen: l.locationCode ?? "", precioUnitario: Number(l.directUnitCost ?? 0),
      ivaPct: Number(l.vatPct ?? 0), descuentoPct: Number(l.lineDiscountPct ?? 0) || undefined,
      proyecto: l.jobNo ?? undefined, taskNo: l.taskNo ?? undefined,
      chargeNo: l.chargeNo ?? undefined, chargeMethod: l.chargeMethod ?? undefined,
      cantidadRecibida: Number(l.quantityRecibida ?? 0), cantidadFacturada: Number(l.quantityFacturada ?? 0),
    })),
  };
}

export interface NewOrdenDB {
  proveedorNo: string; proveedorNombre?: string; currencyCode: string; usuario: string; rol: Role;
  observaciones?: string;   // -> OrdenCompra.notaCreador (sale en el PDF)
  notaInterna?: string;     // -> OrdenCompra.notaInterna (para el aprobador)
  lineas: {
    tipoLinea: string; itemNo?: string; variantCode?: string; idPedidoCompraDet?: number; descripcion: string; cantidad: number;
    unidad: string; almacen: string; precioUnitario: number; ivaPct: number; descuentoPct?: number; jobNo?: string; taskNo?: string;
    // Solo líneas tipo "cargo": tipo de Item Charge de BC y método de reparto.
    chargeNo?: string; chargeMethod?: string;
  }[];
}

// Valida las líneas antes de tocar la base: un campo vacío en la UI llega como NaN
// (JSON lo serializa como null) y el INSERT reventaba con un error de SQL ilegible,
// o peor, guardaba una cantidad que no es.
function validarLineasOrden(lineas: NewOrdenDB["lineas"]) {
  if (!Array.isArray(lineas) || !lineas.length) throw new Error("La orden no tiene líneas.");
  for (const l of lineas) {
    const q = Number(l.cantidad), p = Number(l.precioUnitario), iva = Number(l.ivaPct ?? 0);
    const desc = l.descripcion || l.itemNo || "(sin descripción)";
    if (!Number.isFinite(q) || q <= 0) throw new Error(`Cantidad inválida en "${desc}".`);
    if (!Number.isFinite(p) || p < 0) throw new Error(`Precio inválido en "${desc}".`);
    if (!Number.isFinite(iva) || iva < 0 || iva > 100) throw new Error(`IVA inválido en "${desc}".`);
    const d = Number(l.descuentoPct ?? 0);
    if (!Number.isFinite(d) || d < 0 || d > 100) throw new Error(`Descuento inválido en "${desc}".`);
  }
}

// Ninguna orden puede consumir una línea DEVUELTA al ingeniero. El filtro de la
// pantalla (pendiente = 0) no alcanza: el borrador de la orden vive en memoria, así
// que se puede armar antes de la devolución y guardarse después, o llegar por una
// pestaña vieja. Sin este corte, la línea quedaba devuelta Y ordenada a la vez.
async function cortarLineasDevueltas(lineas: { idPedidoCompraDet?: number }[]) {
  const ids = [...new Set(lineas.map((l) => Math.trunc(Number(l.idPedidoCompraDet)))
    .filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!ids.length || !(await ensureLineaEstado())) return;
  await ensureEstados();
  const idDevuelto = await idDeEstado("devuelto");
  const pool = await getPool();
  const r = await pool.request().input("e", sql.Int, idDevuelto)
    .query(`SELECT descripcion, itemNo FROM dbo.PedidoCompraDet
             WHERE idEstado=@e AND idPedidoCompraDet IN (${ids.join(",")})`);
  if (r.recordset.length) {
    const nombres = r.recordset.map((l: any) => l.descripcion || l.itemNo).join("; ");
    throw new Error(`No se puede ordenar material que se devolvió al ingeniero: ${nombres}. Quitá esa(s) línea(s) de la orden.`);
  }
}

export async function createOrden(input: NewOrdenDB): Promise<number> {
  validarLineasOrden(input.lineas);
  await cortarLineasDevueltas(input.lineas);
  const pool = await getPool();
  const idAbierto = await idDeEstado("abierto");
  const conCargo = await ensureCargoCols();
  const colsCargo = conCargo ? ",chargeNo,chargeMethod" : "";
  const valsCargo = conCargo ? ",@chargeNo,@chargeMethod" : "";
  // Si la columna del comentario interno todavía no está, la orden se crea igual.
  const conNotaInterna = await ensureNotaInterna();
  const colNotaInterna = conNotaInterna ? ",notaInterna" : "";
  const valNotaInterna = conNotaInterna ? ",@notaInterna" : "";
  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    // Consecutivo INTERNO de la app (no tiene nada que ver con la serie C PED de
    // Business Central; el N.º de BC llega después, al lanzarse).
    //
    // El applock serializa SOLO la generación del número, contra otras createOrden.
    // Se probó antes con WITH (UPDLOCK, HOLDLOCK) sobre el SELECT y estaba mal: el
    // único índice de `ordenNo` es filtrado (WHERE ordenNo IS NOT NULL AND
    // esEliminada = 0) y esta consulta no filtra por esEliminada, así que el motor
    // escanea el clustered y se queda con candados sobre TODA dbo.OrdenCompra hasta
    // el commit — que llega después de insertar el encabezado, todas las líneas y la
    // bitácora. Eso además invierte el orden de candados contra updateOrden y
    // cerrarOrden (que tocan PedidoCompraDet primero y OrdenCompra después) y abre
    // un deadlock que antes no existía. Si el applock no se consigue, devuelve < 0
    // sin tirar error y se sigue: queda el comportamiento histórico (el índice único
    // ux_OrdenCompra_ordenNo es la última red).
    //
    // TRY_CAST y no CAST: un ordenNo migrado con otro formato hacía fallar la
    // creación de CUALQUIER orden nueva, no solo la suya.
    await new sql.Request(tx).query(
      "EXEC sp_getapplock @Resource='OrdenCompra:consecutivo', @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000");
    const max = await new sql.Request(tx).query(
      "SELECT MAX(TRY_CAST(SUBSTRING(ordenNo,4,20) AS INT)) AS m FROM dbo.OrdenCompra WHERE ordenNo LIKE 'CP-%'");
    const numero = "CP-" + String((max.recordset[0].m ?? 0) + 1).padStart(6, "0");
    const ins = await new sql.Request(tx)
      .input("idEstado", sql.Int, idAbierto)
      .input("ordenNo", sql.NVarChar(50), numero)
      .input("proveedorNo", sql.NVarChar(20), input.proveedorNo)
      .input("proveedorNombre", sql.NVarChar(150), input.proveedorNombre ?? null)
      .input("currencyCode", sql.NVarChar(10), input.currencyCode || null)
      .input("creadoPor", sql.NVarChar(100), input.usuario)
      .input("notaCreador", sql.NVarChar(500), (input.observaciones ?? "").trim() || null)
      .input("notaInterna", sql.NVarChar(500), (input.notaInterna ?? "").trim() || null)
      .query(`INSERT dbo.OrdenCompra (idEstado,ordenNo,proveedorNo,proveedorNombre,currencyCode,fechaEmision,notaCreador${colNotaInterna},esEliminada,fechaCreacion,creadoPor)
              OUTPUT INSERTED.idOrdenCompra
              VALUES (@idEstado,@ordenNo,@proveedorNo,@proveedorNombre,@currencyCode,CAST(getdate() AS date),@notaCreador${valNotaInterna},0,getdate(),@creadoPor)`);
    const idOrden = ins.recordset[0].idOrdenCompra as number;

    let line = 10000;
    for (const l of input.lineas) {
      await new sql.Request(tx)
        .input("idOrdenCompra", sql.Int, idOrden)
        .input("idPedidoCompraDet", sql.Int, l.idPedidoCompraDet ?? null)
        .input("lineNum", sql.Int, line)
        .input("tipoLinea", sql.NVarChar(30), l.tipoLinea)
        .input("descripcion", sql.NVarChar(250), l.descripcion)
        .input("itemNo", sql.NVarChar(50), l.itemNo ?? null)
        .input("variantCode", sql.NVarChar(20), l.variantCode ?? null)
        .input("unitOfMeasureCode", sql.NVarChar(20), l.unidad)
        .input("locationCode", sql.NVarChar(20), l.almacen)
        .input("quantity", sql.Decimal(18, 4), l.cantidad)
        .input("directUnitCost", sql.Decimal(18, 4), l.precioUnitario)
        .input("vatPct", sql.Decimal(9, 4), l.ivaPct)
        .input("lineDiscountPct", sql.Decimal(9, 4), l.descuentoPct ?? 0)
        .input("jobNo", sql.NVarChar(20), l.jobNo ?? null)
        .input("taskNo", sql.NVarChar(15), l.taskNo ?? null)
        .input("creadoPor", sql.NVarChar(100), input.usuario)
        .input("chargeNo", sql.NVarChar(40), l.chargeNo ?? null)
        .input("chargeMethod", sql.NVarChar(20), l.chargeMethod ?? null)
        .query(`INSERT dbo.OrdenCompraDet (idOrdenCompra,idPedidoCompraDet,lineNum,tipoLinea,descripcion,itemNo,variantCode,unitOfMeasureCode,locationCode,quantity,quantityRecibida,quantityFacturada,directUnitCost,vatPct,lineDiscountPct,jobNo,taskNo,fechaCreacion,creadoPor${colsCargo})
                VALUES (@idOrdenCompra,@idPedidoCompraDet,@lineNum,@tipoLinea,@descripcion,@itemNo,@variantCode,@unitOfMeasureCode,@locationCode,@quantity,0,0,@directUnitCost,@vatPct,@lineDiscountPct,@jobNo,@taskNo,getdate(),@creadoPor${valsCargo})`);
      // descontar saldo del pedido origen
      if (l.idPedidoCompraDet) {
        await new sql.Request(tx).input("id", sql.Int, l.idPedidoCompraDet).input("q", sql.Decimal(18, 4), l.cantidad)
          .query("UPDATE dbo.PedidoCompraDet SET quantityOrdenado = ISNULL(quantityOrdenado,0) + @q WHERE idPedidoCompraDet=@id");
      }
      line += 10000;
    }
    await logMov(tx, { entidad: "orden", idEntidad: idOrden, documentoNo: numero, tipoMovimiento: "creado", estadoNuevo: "abierto", usuario: input.usuario, rol: input.rol });
    await tx.commit();
    return idOrden;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export interface UpdateOrdenDB {
  proveedorNo: string; proveedorNombre?: string; currencyCode: string; usuario: string; rol: Role;
  observaciones?: string;   // -> OrdenCompra.notaCreador (sale en el PDF)
  notaInterna?: string;     // -> OrdenCompra.notaInterna (para el aprobador)
  lineas: NewOrdenDB["lineas"];
}

// Reescribe una orden ABIERTA/RECHAZADA (encabezado + líneas) y reajusta el saldo
// (quantityOrdenado) de los pedidos de origen: revierte el consumo de las líneas
// viejas y aplica el de las nuevas. Se bloquea si la orden ya tiene recepciones.
export async function updateOrden(id: number, input: UpdateOrdenDB) {
  const pool = await getPool();
  const conCargo = await ensureCargoCols();
  const colsCargo = conCargo ? ",chargeNo,chargeMethod" : "";
  const valsCargo = conCargo ? ",@chargeNo,@chargeMethod" : "";
  const setNotaInterna = (await ensureNotaInterna()) ? ", notaInterna=@notaInterna" : "";
  const rec = await pool.request().input("id", sql.Int, id)
    .query("SELECT COUNT(*) AS n FROM dbo.RecepcionCompra WHERE idOrdenCompra=@id AND esEliminada=0");
  if ((rec.recordset[0]?.n ?? 0) > 0) throw new Error("La orden ya tiene recepciones registradas; no se puede editar.");
  const head = await pool.request().input("id", sql.Int, id)
    .query("SELECT ordenNo, idEstado FROM dbo.OrdenCompra WHERE idOrdenCompra=@id AND esEliminada=0");
  if (!head.recordset.length) throw new Error("Orden no encontrada.");
  // Misma regla que la pantalla de edición, pero del lado del server: solo se
  // reescribe una orden ABIERTA o RECHAZADA. Protege el caso de la pestaña vieja —
  // Angie abre el editor con la orden abierta, Aprobación la lanza a BC mientras
  // tanto, ella guarda: el SQL quedaría reescrito y BC con las líneas viejas.
  await ensureEstados();
  const estadoActual = codigoDeId(head.recordset[0].idEstado);
  if (estadoActual && estadoActual !== "abierto" && estadoActual !== "rechazado") {
    throw new Error(`La orden ya no está abierta (${NOMBRE_POR_CODIGO[estadoActual] ?? estadoActual}); recargá la pantalla antes de editarla.`);
  }
  const ordenNo = head.recordset[0].ordenNo ?? "";
  const lineas = (input.lineas ?? []).filter((l) => l.tipoLinea !== "articulo" || (l.itemNo && l.cantidad > 0) || l.cantidad > 0);
  validarLineasOrden(lineas);   // mismas reglas que al crear (cantidad/precio/IVA/descuento)
  await cortarLineasDevueltas(lineas);
  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    // 1) revertir el saldo consumido por las líneas ACTUALES.
    // Se agrupa por línea de pedido ANTES de restar: en un UPDATE ... FROM JOIN,
    // si dos líneas de la orden apuntan a la misma línea de pedido, SQL Server
    // toca la fila destino UNA sola vez (con una de las dos cantidades) y el saldo
    // quedaría inflado para siempre. Con el SUM el resultado no depende de eso.
    await new sql.Request(tx).input("id", sql.Int, id).query(`
      UPDATE pcd SET pcd.quantityOrdenado = ISNULL(pcd.quantityOrdenado,0) - x.q
      FROM dbo.PedidoCompraDet pcd
      JOIN (SELECT idPedidoCompraDet, SUM(quantity) AS q
              FROM dbo.OrdenCompraDet
             WHERE idOrdenCompra = @id AND idPedidoCompraDet IS NOT NULL
             GROUP BY idPedidoCompraDet) x ON x.idPedidoCompraDet = pcd.idPedidoCompraDet`);
    // 2) borrar líneas actuales
    await new sql.Request(tx).input("id", sql.Int, id).query("DELETE FROM dbo.OrdenCompraDet WHERE idOrdenCompra=@id");
    // 3) encabezado
    await new sql.Request(tx).input("id", sql.Int, id)
      .input("proveedorNo", sql.NVarChar(20), input.proveedorNo)
      .input("proveedorNombre", sql.NVarChar(150), input.proveedorNombre ?? null)
      .input("currencyCode", sql.NVarChar(10), input.currencyCode || null)
      .input("u", sql.NVarChar(100), input.usuario)
      .input("notaCreador", sql.NVarChar(500), (input.observaciones ?? "").trim() || null)
      .input("notaInterna", sql.NVarChar(500), (input.notaInterna ?? "").trim() || null)
      .query(`UPDATE dbo.OrdenCompra SET proveedorNo=@proveedorNo, proveedorNombre=@proveedorNombre, currencyCode=@currencyCode, notaCreador=@notaCreador${setNotaInterna}, fechaModificacion=getdate(), modificadoPor=@u WHERE idOrdenCompra=@id`);
    // 4) reinsertar líneas + reaplicar saldo
    let line = 10000;
    for (const l of lineas) {
      await new sql.Request(tx)
        .input("idOrdenCompra", sql.Int, id)
        .input("idPedidoCompraDet", sql.Int, l.idPedidoCompraDet ?? null)
        .input("lineNum", sql.Int, line)
        .input("tipoLinea", sql.NVarChar(30), l.tipoLinea)
        .input("descripcion", sql.NVarChar(250), l.descripcion)
        .input("itemNo", sql.NVarChar(50), l.itemNo ?? null)
        .input("variantCode", sql.NVarChar(20), l.variantCode ?? null)
        .input("unitOfMeasureCode", sql.NVarChar(20), l.unidad)
        .input("locationCode", sql.NVarChar(20), l.almacen)
        .input("quantity", sql.Decimal(18, 4), l.cantidad)
        .input("directUnitCost", sql.Decimal(18, 4), l.precioUnitario)
        .input("vatPct", sql.Decimal(9, 4), l.ivaPct)
        .input("lineDiscountPct", sql.Decimal(9, 4), l.descuentoPct ?? 0)
        .input("jobNo", sql.NVarChar(20), l.jobNo ?? null)
        .input("taskNo", sql.NVarChar(15), l.taskNo ?? null)
        .input("creadoPor", sql.NVarChar(100), input.usuario)
        .input("chargeNo", sql.NVarChar(40), l.chargeNo ?? null)
        .input("chargeMethod", sql.NVarChar(20), l.chargeMethod ?? null)
        .query(`INSERT dbo.OrdenCompraDet (idOrdenCompra,idPedidoCompraDet,lineNum,tipoLinea,descripcion,itemNo,variantCode,unitOfMeasureCode,locationCode,quantity,quantityRecibida,quantityFacturada,directUnitCost,vatPct,lineDiscountPct,jobNo,taskNo,fechaCreacion,creadoPor${colsCargo})
                VALUES (@idOrdenCompra,@idPedidoCompraDet,@lineNum,@tipoLinea,@descripcion,@itemNo,@variantCode,@unitOfMeasureCode,@locationCode,@quantity,0,0,@directUnitCost,@vatPct,@lineDiscountPct,@jobNo,@taskNo,getdate(),@creadoPor${valsCargo})`);
      if (l.idPedidoCompraDet) {
        await new sql.Request(tx).input("id", sql.Int, l.idPedidoCompraDet).input("q", sql.Decimal(18, 4), l.cantidad)
          .query("UPDATE dbo.PedidoCompraDet SET quantityOrdenado = ISNULL(quantityOrdenado,0) + @q WHERE idPedidoCompraDet=@id");
      }
      line += 10000;
    }
    await logMov(tx, { entidad: "orden", idEntidad: id, documentoNo: ordenNo, tipoMovimiento: "editado", detalle: `${lineas.filter((l) => l.tipoLinea === "articulo").length} línea(s)`, usuario: input.usuario, rol: input.rol });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export interface CierreOrden { pendienteDevuelto: number; lineasConPendiente: number }

// Cierra una orden LANZADA que ya no va a recibir el resto del material (el
// proveedor no lo trajo, se descontinuó, se compró en otro lado). Queda en
// "completado" con el motivo en la bitácora.
//
// Lo importante es `devolverSaldo`: el saldo NO RECIBIDO vuelve a las solicitudes
// de origen. Si no se devuelve, esas unidades quedan "ya ordenadas" para siempre
// (quantityOrdenado) y nadie puede volver a comprarlas sin abrir una solicitud
// nueva — el material simplemente se pierde del sistema.
export async function cerrarOrden(
  id: number, motivo: string, usuario: string, rol: Role, devolverSaldo = true,
): Promise<CierreOrden> {
  if (!String(motivo ?? "").trim()) throw new Error("Poné el motivo del cierre: queda en el historial de la orden.");
  await ensureEstados();
  const pool = await getPool();
  const head = await pool.request().input("id", sql.Int, id)
    .query("SELECT ordenNo, idEstado FROM dbo.OrdenCompra WHERE idOrdenCompra=@id AND esEliminada=0");
  if (!head.recordset.length) throw new Error("Orden no encontrada.");
  const estadoActual = codigoDeId(head.recordset[0].idEstado);
  // Solo tiene sentido cerrar lo que está en la calle. Una abierta se edita o se
  // deja; una completada ya está cerrada.
  if (estadoActual !== "lanzado") {
    throw new Error(`Solo se puede cerrar una orden lanzada (esta está ${NOMBRE_POR_CODIGO[estadoActual ?? ""] ?? estadoActual}).`);
  }
  const ordenNo = head.recordset[0].ordenNo ?? "";
  const idCompletado = await idDeEstado("completado");

  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    // Lo que quedó sin recibir. Solo artículos: un cargo (flete) no tiene saldo.
    const pend = await new sql.Request(tx).input("id", sql.Int, id).query(`
      SELECT ISNULL(SUM(quantity - ISNULL(quantityRecibida,0)),0) AS unidades, COUNT(*) AS lineas
        FROM dbo.OrdenCompraDet
       WHERE idOrdenCompra=@id AND tipoLinea='articulo' AND quantity - ISNULL(quantityRecibida,0) > 0`);
    const pendienteDevuelto = Number(pend.recordset[0]?.unidades ?? 0);
    const lineasConPendiente = Number(pend.recordset[0]?.lineas ?? 0);

    if (devolverSaldo && lineasConPendiente > 0) {
      // Se agrupa por línea de pedido ANTES de restar: en un UPDATE ... FROM JOIN,
      // dos líneas de la orden apuntando a la misma línea de pedido tocarían la
      // fila una sola vez y el saldo quedaría mal (mismo cuidado que updateOrden).
      // El CASE evita dejar quantityOrdenado negativo si los datos vienen sucios.
      await new sql.Request(tx).input("id", sql.Int, id).query(`
        UPDATE pcd SET pcd.quantityOrdenado =
          CASE WHEN ISNULL(pcd.quantityOrdenado,0) - x.q < 0 THEN 0 ELSE ISNULL(pcd.quantityOrdenado,0) - x.q END
        FROM dbo.PedidoCompraDet pcd
        JOIN (SELECT idPedidoCompraDet, SUM(quantity - ISNULL(quantityRecibida,0)) AS q
                FROM dbo.OrdenCompraDet
               WHERE idOrdenCompra=@id AND idPedidoCompraDet IS NOT NULL
                 AND tipoLinea='articulo' AND quantity - ISNULL(quantityRecibida,0) > 0
               GROUP BY idPedidoCompraDet) x ON x.idPedidoCompraDet = pcd.idPedidoCompraDet`);
    }

    await new sql.Request(tx).input("id", sql.Int, id).input("e", sql.Int, idCompletado).input("u", sql.NVarChar(100), usuario)
      .query("UPDATE dbo.OrdenCompra SET idEstado=@e, fechaModificacion=getdate(), modificadoPor=@u WHERE idOrdenCompra=@id");

    const detalle = pendienteDevuelto > 0
      ? `${motivo} · ${pendienteDevuelto} u. sin recibir ${devolverSaldo ? "devueltas a las solicitudes" : "NO devueltas (quedan consumidas)"}`
      : motivo;
    await logMov(tx, {
      entidad: "orden", idEntidad: id, documentoNo: ordenNo, tipoMovimiento: "cerrado",
      estadoAnterior: "lanzado", estadoNuevo: "completado", detalle, usuario, rol,
    });
    await tx.commit();
    return { pendienteDevuelto, lineasConPendiente };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

// Cierra la orden y arma una NUEVA (abierta) con lo que quedó pendiente: el caso
// de "el proveedor entregó la mitad y el resto se lo compro a otro".
// El orden importa: primero cerrar (devuelve el saldo) y después crear (lo vuelve
// a consumir). Al revés, si el cierre fallara, las dos órdenes estarían
// consumiendo el mismo saldo del pedido. Si falla la creación, el cierre ya quedó
// hecho y las líneas volvieron a Solicitudes: se rearma a mano, no se pierde nada.
export async function nuevaOrdenDesdePendiente(
  id: number, motivo: string, usuario: string, rol: Role,
): Promise<{ idOrden: number; numero: string; origen: string }> {
  const pool = await getPool();
  const head = await pool.request().input("id", sql.Int, id)
    .query("SELECT ordenNo, bcNo, proveedorNo, proveedorNombre, currencyCode FROM dbo.OrdenCompra WHERE idOrdenCompra=@id AND esEliminada=0");
  if (!head.recordset.length) throw new Error("Orden no encontrada.");
  const h = head.recordset[0];
  const det = await pool.request().input("id", sql.Int, id).query(`
    SELECT * FROM dbo.OrdenCompraDet
     WHERE idOrdenCompra=@id AND tipoLinea='articulo' AND quantity - ISNULL(quantityRecibida,0) > 0
     ORDER BY lineNum`);
  if (!det.recordset.length) throw new Error("Esta orden no tiene material pendiente: no hay nada que pasar a una orden nueva.");

  await cerrarOrden(id, motivo, usuario, rol, true);

  // Las líneas se copian tal cual de la orden vieja, así que arrastran su jobNo. Si
  // esa orden es de las viejas (con un almacén metido en el campo obra), la orden
  // nueva nacería envenenada igual que ella: acá no pasa por las rutas HTTP, así que
  // el saneo se hace en este punto.
  const lineasPendientes = await sanearObrasDeLineas(det.recordset.map((l: any) => ({
      tipoLinea: "articulo",
      itemNo: l.itemNo ?? undefined, variantCode: l.variantCode ?? undefined,
      idPedidoCompraDet: l.idPedidoCompraDet ?? undefined,
      descripcion: l.descripcion ?? "",
      cantidad: Number(l.quantity ?? 0) - Number(l.quantityRecibida ?? 0),
      unidad: l.unitOfMeasureCode ?? "", almacen: l.locationCode ?? "",
      precioUnitario: Number(l.directUnitCost ?? 0), ivaPct: Number(l.vatPct ?? 0),
      descuentoPct: Number(l.lineDiscountPct ?? 0) || undefined,
      jobNo: l.jobNo ?? undefined, taskNo: l.taskNo ?? undefined,
    })));
  const idOrden = await createOrden({
    proveedorNo: h.proveedorNo, proveedorNombre: h.proveedorNombre ?? undefined,
    currencyCode: h.currencyCode ?? "", usuario, rol,
    lineas: lineasPendientes.lineas,
  });

  const nueva = await pool.request().input("id", sql.Int, idOrden)
    .query("SELECT ordenNo FROM dbo.OrdenCompra WHERE idOrdenCompra=@id");
  const numero = nueva.recordset[0]?.ordenNo ?? "";
  // Deja la traza en las dos puntas: sin esto, en la orden nueva no se ve de dónde
  // salió y en la vieja no se ve a dónde se fue el pendiente.
  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    await logMov(tx, { entidad: "orden", idEntidad: idOrden, documentoNo: numero, tipoMovimiento: "creado",
      // Por su N.º de BC si ya lo tiene: la orden vieja está lanzada (solo esas se
      // cierran), así que en toda la app se la ve como CP-005156, y la bitácora
      // decía CP-000037 — un número que allá no existe.
      detalle: `Con el pendiente de ${h.bcNo || etiquetaInterna(h.ordenNo)}`, usuario, rol });
    await logMov(tx, { entidad: "orden", idEntidad: id, documentoNo: h.ordenNo, tipoMovimiento: "cerrado",
      // El rótulo y no el CP- interno: la orden nueva se muestra "Interno 46" en
      // toda la app, y dejar acá un "CP-000046" manda a buscarlo a BC, donde no
      // existe. (El `documentoNo` sí guarda el ordenNo crudo, que es la llave.)
      detalle: `El pendiente pasó a ${etiquetaInterna(numero)}`, usuario, rol });
    await tx.commit();
  } catch { await tx.rollback(); /* la traza es informativa: no tumbar la operación */ }

  return { idOrden, numero, origen: h.ordenNo };
}

// ¿La orden ya tiene facturas/recepciones registradas? Es la línea que separa
// "todavía se puede corregir" de "ya entró material y hay que ir por devolución".
export async function ordenTieneRecepciones(id: number): Promise<boolean> {
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, id)
    .query("SELECT COUNT(*) AS n FROM dbo.RecepcionCompra WHERE idOrdenCompra=@id AND esEliminada=0");
  return (r.recordset[0]?.n ?? 0) > 0;
}

export const MSG_NO_REABRIR = "La orden ya tiene facturas/recepciones registradas: no se puede volver a abrir.";

// Descartar una orden que quedó en BORRADOR (Abierta y sin N.º de BC).
//
// Por qué hacía falta: al crear la orden, sus líneas CONSUMEN el saldo de la
// solicitud (quantityOrdenado). Si esa orden se armó por error, hasta hoy no había
// forma de deshacerla: no se puede borrar, no se puede dejar sin líneas
// ("La orden no tiene líneas") y "Cerrar orden" es solo para las LANZADAS. El
// material quedaba secuestrado: la solicitud lo daba por ordenado para siempre y
// Proveeduría tampoco podía devolvérselo al ingeniero. Solo se salía por SQL.
//
// Condiciones (estrictas a propósito): sin N.º de BC —o sea, el pedido nunca se
// creó allá— y sin recepciones. Lo que ya existe en Business Central no se descarta
// desde acá: eso se reabre o se cierra, que es lo que deja rastro en los dos lados.
export async function descartarOrden(
  id: number, motivo: string, usuario: string, rol: Role,
): Promise<{ numero: string; saldoDevuelto: number }> {
  await ensureEstados();
  const pool = await getPool();
  const head = await pool.request().input("id", sql.Int, id)
    .query("SELECT ordenNo, idEstado, bcNo FROM dbo.OrdenCompra WHERE idOrdenCompra=@id AND esEliminada=0");
  if (!head.recordset.length) throw new Error("Orden no encontrada.");
  const estado = codigoDeId(head.recordset[0].idEstado);
  const bcNo = String(head.recordset[0].bcNo ?? "").trim();
  if (estado !== "abierto" && estado !== "rechazado") {
    throw new Error(`Solo se descarta una orden Abierta o Rechazada; esta está ${estado === "pendiente_aprobacion" ? "esperando aprobación (cancelá el envío primero)" : estado}.`);
  }
  if (bcNo) throw new Error(`Esta orden ya existe en Business Central como ${bcNo}: no se descarta desde acá. Reabrila o cerrala para que quede el rastro en los dos lados.`);
  if (await ordenTieneRecepciones(id)) throw new Error("La orden ya tiene recepciones registradas: no se puede descartar.");

  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    // Cuánto se va a devolver (solo para el mensaje). Va en un SELECT aparte y no en
    // un OUTPUT del UPDATE: en un UPDATE...FROM, el OUTPUT no puede leer columnas de
    // la tabla derivada, y si el motor lo rechaza se cae justo la vía de escape.
    const prev = await new sql.Request(tx).input("id", sql.Int, id).query(`
      SELECT ISNULL(SUM(od.quantity), 0) AS q
        FROM dbo.OrdenCompraDet od
        JOIN dbo.PedidoCompraDet pcd ON pcd.idPedidoCompraDet = od.idPedidoCompraDet
       WHERE od.idOrdenCompra = @id AND od.idPedidoCompraDet IS NOT NULL`);
    const saldoDevuelto = Number(prev.recordset[0]?.q ?? 0);
    // Devolver el saldo a las líneas de solicitud. Es EXACTAMENTE el mismo UPDATE que
    // usa updateOrden (probado en producción): agrupado por línea de pedido, porque
    // dos líneas de la orden pueden colgar de la misma.
    await new sql.Request(tx).input("id", sql.Int, id).query(`
      UPDATE pcd SET pcd.quantityOrdenado = ISNULL(pcd.quantityOrdenado,0) - x.q
      FROM dbo.PedidoCompraDet pcd
      JOIN (SELECT idPedidoCompraDet, SUM(quantity) AS q
              FROM dbo.OrdenCompraDet
             WHERE idOrdenCompra = @id AND idPedidoCompraDet IS NOT NULL
             GROUP BY idPedidoCompraDet) x ON x.idPedidoCompraDet = pcd.idPedidoCompraDet`);
    await new sql.Request(tx).input("id", sql.Int, id).input("u", sql.NVarChar(100), usuario)
      .query("UPDATE dbo.OrdenCompra SET esEliminada=1, fechaModificacion=getdate(), modificadoPor=@u WHERE idOrdenCompra=@id");
    await logMov(tx, {
      entidad: "orden", idEntidad: id, documentoNo: head.recordset[0].ordenNo ?? "",
      tipoMovimiento: "eliminado", estadoAnterior: estado,
      detalle: `Borrador descartado${motivo ? ` · Motivo: ${motivo}` : ""}${saldoDevuelto > 0 ? ` · ${saldoDevuelto} u. volvieron a la solicitud` : ""}`,
      usuario, rol,
    });
    await tx.commit();
    return { numero: head.recordset[0].ordenNo ?? "", saldoDevuelto };
  } catch (e) { await tx.rollback(); throw e; }
}

// DEVOLVER AL INGENIERO líneas que ya están dentro de una ORDEN (Abierta o
// Rechazada). Es el camino que faltaba: la variante, la medida o el grado del material
// los define QUIEN PIDE, no Proveeduría, así que cuando una orden se rechaza por eso
// (CP-005154, "Falta variante") el material tiene que volver a manos del ingeniero.
// Hasta hoy no se podía: la línea ya tenía orden —y con orden no se devuelve— y la
// orden ya existía en BC —y así no se descarta—, o sea que la única salida era que
// Proveeduría eligiera la variante, que es justo lo que no le toca.
//
// Lo que hace, en una sola transacción: le SACA las líneas a la orden (devolviéndole
// el saldo a la solicitud, con el mismo UPDATE agrupado que usa updateOrden) y recién
// entonces las marca devueltas. Si la orden se queda sin material, se descarta.
//
// Lo que NO hace: tocar Business Central. El pedido de allá lo re-sincroniza quien
// llama (mismo camino que editar la orden), y si la orden se descarta y ya existía en
// BC hay que darla de baja a mano — esta función devuelve `bcNo` justamente para
// poder decirlo. Borrar un pedido en BC no es algo que la app pueda decidir sola.
export async function devolverLineasDeOrden(
  idOrden: number, lineaIds: number[], motivo: string, usuario: string, rol: Role,
): Promise<{ ordenNo: string; bcNo: string; devueltas: number; nombres: string[]; ordenDescartada: boolean; pedidos: string[] }> {
  if (!lineaIds?.length) throw new Error("No se eligió ninguna línea para devolver.");
  if (!String(motivo ?? "").trim()) throw new Error("Escribí el motivo: es lo que el ingeniero va a leer para saber qué corregir.");
  if (!(await ensureLineaEstado())) throw new Error("La base todavía no tiene la columna dbo.PedidoCompraDet.idEstado, que es donde se marca la línea devuelta.");
  await ensureEstados();
  const pool = await getPool();

  const head = await pool.request().input("id", sql.Int, idOrden)
    .query("SELECT ordenNo, idEstado, bcNo FROM dbo.OrdenCompra WHERE idOrdenCompra=@id AND esEliminada=0");
  if (!head.recordset.length) throw new Error("Orden no encontrada.");
  const estado = codigoDeId(head.recordset[0].idEstado);
  const ordenNo = String(head.recordset[0].ordenNo ?? "");
  const bcNo = String(head.recordset[0].bcNo ?? "").trim();
  if (estado !== "abierto" && estado !== "rechazado") {
    throw new Error(`Solo se devuelve material de una orden Abierta o Rechazada; esta está ${estado === "pendiente_aprobacion" ? "esperando aprobación (cancelá el envío primero)" : estado}.`);
  }
  if (await ordenTieneRecepciones(idOrden)) throw new Error("La orden ya tiene recepciones registradas: ese material ya llegó y no se devuelve al ingeniero.");

  const det = await pool.request().input("id", sql.Int, idOrden).query(
    `SELECT od.idOrdenCompraDet, od.idPedidoCompraDet, od.tipoLinea, od.descripcion, od.quantity,
            od.quantityRecibida, od.quantityFacturada, pcd.idPedidoCompra
       FROM dbo.OrdenCompraDet od
       LEFT JOIN dbo.PedidoCompraDet pcd ON pcd.idPedidoCompraDet = od.idPedidoCompraDet
      WHERE od.idOrdenCompra = @id`);
  const porId = new Map<number, any>(det.recordset.map((l: any) => [Number(l.idOrdenCompraDet), l]));

  const aDevolver: any[] = [];
  for (const lid of lineaIds) {
    const l = porId.get(Number(lid));
    if (!l) throw new Error(`La línea ${lid} no es de esta orden.`);
    const nombre = String(l.descripcion || `Línea ${lid}`);
    if (l.tipoLinea !== "articulo") throw new Error(`${nombre}: un cargo no se devuelve al ingeniero.`);
    if (!l.idPedidoCompraDet) throw new Error(`${nombre}: esta línea no viene de una solicitud (se agregó a mano), así que no hay a quién devolvérsela. Quitala editando la orden.`);
    if (Number(l.quantityRecibida ?? 0) > 0 || Number(l.quantityFacturada ?? 0) > 0) {
      throw new Error(`${nombre}: ya tiene recibido/facturado, no se puede devolver.`);
    }
    // La línea dice de qué solicitud viene, pero esa solicitud tiene que EXISTIR: si
    // el enlace quedó colgando (línea borrada del otro lado), devolverla sacaría el
    // material de la orden sin que nadie lo reciba de vuelta. Mejor frenar y decirlo.
    if (!Number.isFinite(Number(l.idPedidoCompra))) {
      throw new Error(`${nombre}: la solicitud de origen ya no existe, así que no hay a quién devolvérsela. Quitala editando la orden.`);
    }
    aDevolver.push(l);
  }
  const ids = aDevolver.map((l) => Number(l.idOrdenCompraDet));
  const nombres = aDevolver.map((l) => String(l.descripcion || `Línea ${l.idOrdenCompraDet}`));
  // ¿Queda material en la orden? Si no, no tiene sentido dejarla viva: una orden sin
  // artículos no se puede guardar ni enviar, y en BC quedaría un pedido vacío.
  const quedan = det.recordset.filter((l: any) => l.tipoLinea === "articulo" && !ids.includes(Number(l.idOrdenCompraDet)));
  const ordenDescartada = quedan.length === 0;

  // Líneas de solicitud agrupadas por solicitud: la devolución se escribe POR PEDIDO
  // (su nota, su estado, su movimiento), y una orden puede mezclar varias.
  const porPedido = new Map<number, number[]>();
  for (const l of aDevolver) {
    const k = Number(l.idPedidoCompra);
    porPedido.set(k, [...(porPedido.get(k) ?? []), Number(l.idPedidoCompraDet)]);
  }

  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    // 1) devolverle el saldo a la solicitud SOLO por las líneas que se van. Mismo
    //    UPDATE agrupado de updateOrden/descartarOrden: dos líneas de la orden pueden
    //    colgar de la misma línea de solicitud y en un JOIN eso se toca una sola vez.
    const reqSaldo = new sql.Request(tx).input("id", sql.Int, idOrden);
    const paramsIds = ids.map((x, i) => { reqSaldo.input(`l${i}`, sql.Int, x); return `@l${i}`; });
    await reqSaldo.query(`
      UPDATE pcd SET pcd.quantityOrdenado =
        CASE WHEN ISNULL(pcd.quantityOrdenado,0) - x.q < 0 THEN 0 ELSE ISNULL(pcd.quantityOrdenado,0) - x.q END
      FROM dbo.PedidoCompraDet pcd
      JOIN (SELECT idPedidoCompraDet, SUM(quantity) AS q
              FROM dbo.OrdenCompraDet
             WHERE idOrdenCompra = @id AND idPedidoCompraDet IS NOT NULL
               AND idOrdenCompraDet IN (${paramsIds.join(",")})
             GROUP BY idPedidoCompraDet) x ON x.idPedidoCompraDet = pcd.idPedidoCompraDet`);

    // 2) sacarle las líneas a la orden
    const reqDel = new sql.Request(tx).input("id", sql.Int, idOrden);
    const paramsDel = ids.map((x, i) => { reqDel.input(`d${i}`, sql.Int, x); return `@d${i}`; });
    await reqDel.query(`DELETE FROM dbo.OrdenCompraDet WHERE idOrdenCompra=@id AND idOrdenCompraDet IN (${paramsDel.join(",")})`);

    // 3) marcar devueltas las líneas de cada solicitud (ya sin saldo comprometido)
    for (const [idPedido, idsLinea] of porPedido) {
      const cab = await new sql.Request(tx).input("id", sql.Int, idPedido)
        .query("SELECT pedidoNo, idEstado, notaCreador FROM dbo.PedidoCompra WHERE idPedidoCompra=@id");
      if (!cab.recordset.length) continue;
      const idDevuelto = await idDeEstado("devuelto");
      const lineasPedido = await new sql.Request(tx).input("id", sql.Int, idPedido)
        .query("SELECT idPedidoCompraDet, idEstado, descripcion FROM dbo.PedidoCompraDet WHERE idPedidoCompra=@id");
      const yaDevueltas = new Set<number>([
        ...lineasPedido.recordset.filter((l: any) => l.idEstado === idDevuelto).map((l: any) => Number(l.idPedidoCompraDet)),
        ...idsLinea,
      ]);
      const pedidoDevuelto = lineasPedido.recordset.every((l: any) => yaDevueltas.has(Number(l.idPedidoCompraDet)));
      const nombresPedido = lineasPedido.recordset
        .filter((l: any) => idsLinea.includes(Number(l.idPedidoCompraDet)))
        .map((l: any) => String(l.descripcion || `Línea ${l.idPedidoCompraDet}`));
      await marcarLineasDevueltasTx(tx, {
        idPedido, pedidoNo: cab.recordset[0].pedidoNo ?? "", idEstadoPedido: cab.recordset[0].idEstado,
        notaPrevia: cab.recordset[0].notaCreador ?? "",
        idsLinea, nombres: nombresPedido, pedidoDevuelto, motivo, usuario, rol,
        origen: `Devuelta desde la orden ${bcNo || ordenNo}`,
      });
    }

    // 4) la orden: se descarta si se quedó sin material, o queda con el resto
    const detalleOrden = `${nombres.length} línea(s) devuelta(s) al ingeniero: ${nombres.join("; ")} · Motivo: ${motivo}`;
    if (ordenDescartada) {
      await new sql.Request(tx).input("id", sql.Int, idOrden).input("u", sql.NVarChar(100), usuario)
        .query("UPDATE dbo.OrdenCompra SET esEliminada=1, fechaModificacion=getdate(), modificadoPor=@u WHERE idOrdenCompra=@id");
      await logMov(tx, {
        entidad: "orden", idEntidad: idOrden, documentoNo: ordenNo, tipoMovimiento: "eliminado",
        estadoAnterior: estado, detalle: `Orden descartada · ${detalleOrden}`, usuario, rol,
      });
    } else {
      await new sql.Request(tx).input("id", sql.Int, idOrden).input("u", sql.NVarChar(100), usuario)
        .query("UPDATE dbo.OrdenCompra SET fechaModificacion=getdate(), modificadoPor=@u WHERE idOrdenCompra=@id");
      await logMov(tx, {
        entidad: "orden", idEntidad: idOrden, documentoNo: ordenNo, tipoMovimiento: "editado",
        detalle: detalleOrden, usuario, rol,
      });
    }
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }

  return {
    ordenNo, bcNo, devueltas: aDevolver.length, nombres, ordenDescartada,
    pedidos: [...porPedido.keys()].map(String),
  };
}

export async function setOrdenEstado(id: number, estado: string, usuario: string, rol: Role, motivo?: string, bcNumber?: string) {
  const pool = await getPool();
  // Con material ya recibido/facturado, reabrir es corregir una orden que en BC ya
  // tiene recepciones registradas: quedaría descuadrada y allá tampoco se puede
  // des-lanzar. Se corta acá además de en la pantalla (pestaña vieja, llamada directa).
  if (estado === "abierto" && await ordenTieneRecepciones(id)) throw new Error(MSG_NO_REABRIR);
  const prev = await pool.request().input("id", sql.Int, id).query("SELECT idEstado, ordenNo FROM dbo.OrdenCompra WHERE idOrdenCompra=@id");
  const idEstado = await idDeEstado(estado);
  // Si BC devolvió el Nº del pedido, lo guardamos en bcNo (una vez creado en BC,
  // el reintento solo relanza y la recepción/factura ya lo encuentran).
  const req = pool.request().input("id", sql.Int, id).input("e", sql.Int, idEstado).input("u", sql.NVarChar(100), usuario);
  let setBc = "";
  if (bcNumber) { req.input("bcno", sql.NVarChar(20), bcNumber); setBc = ", bcNo=@bcno, syncedToBc=1"; }
  await req.query(`UPDATE dbo.OrdenCompra SET idEstado=@e, fechaModificacion=getdate(), modificadoPor=@u${setBc} WHERE idOrdenCompra=@id`);
  const tipo = estado === "pendiente_aprobacion" ? "enviado_aprobacion" : estado === "lanzado" ? "aprobado_lanzado" : estado === "abierto" ? "reabierto" : estado;
  const tx = new sql.Transaction(pool); await tx.begin();
  await logMov(tx, { entidad: "orden", idEntidad: id, documentoNo: prev.recordset[0]?.ordenNo ?? "", tipoMovimiento: tipo, estadoAnterior: codigoDeId(prev.recordset[0]?.idEstado), estadoNuevo: estado, detalle: motivo ? `Motivo: ${motivo}` : undefined, usuario, rol });
  await tx.commit();
}

// ----------------------------------------------------------------- RECEPCIONES
export interface NewRecepcionDB {
  idOrdenCompra: number; numeroFactura: string; fechaFactura: string; fechaRecepcion: string; fechaRegistro: string;
  total: number; usuario: string; rol: Role;
  lineas: { idOrdenCompraDet: number; cantidadRecibida: number; precioFactura?: number }[];
  // N.º de la factura que quedó registrada EN BC (lo devuelve BC al registrar).
  bcFacturaNo?: string;
  // Línea extra para la BITÁCORA de esta recepción. Hoy la usa la CONCILIACIÓN:
  // la recepción se guarda acá sin postear en BC porque BC ya la tenía, y eso hay
  // que poder leerlo después (si no, en la bitácora se ve igual que un registro
  // normal y nadie entiende por qué en BC quedó con otra fecha).
  nota?: string;
}

// El N.º de factura de BC vive en una columna que se agrega con
// sql/recepcion_bc_factura.sql. Todo lo de acá tolera que NO esté: sin ella la
// recepción se guarda igual y el número simplemente no se muestra. Una migración
// pendiente no puede impedir que Bodega reciba material.
let hayColBcFactura: boolean | null = null;
async function colBcFacturaExiste(): Promise<boolean> {
  if (hayColBcFactura !== null) return hayColBcFactura;
  try {
    const pool = await getPool();
    const r = await pool.request().query("SELECT COL_LENGTH('dbo.RecepcionCompra','bcFacturaNo') AS len");
    hayColBcFactura = r.recordset[0]?.len != null;
  } catch {
    hayColBcFactura = false;
  }
  return hayColBcFactura;
}

export async function createRecepcion(input: NewRecepcionDB): Promise<number> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool); await tx.begin();
  // MODO 2: si la factura viene EN REVISIÓN (sin número), solo se recibe el
  // material; NO se sube lo facturado ni se cierra la orden. Kattya registra
  // la factura después vía setRecepcionFactura.
  const enRevision = !String(input.numeroFactura ?? "").trim();
  try {
    const ord = await new sql.Request(tx).input("id", sql.Int, input.idOrdenCompra).query("SELECT ordenNo FROM dbo.OrdenCompra WHERE idOrdenCompra=@id");
    const ordenNo = ord.recordset[0]?.ordenNo ?? "";
    // Misma factura dos veces en la misma orden = registro duplicado (doble envío o
    // error de dedo). Se corta acá: en contabilidad una factura repetida se paga dos
    // veces. En revisión (sin número) no aplica.
    if (!enRevision) {
      const dup = await new sql.Request(tx)
        .input("id", sql.Int, input.idOrdenCompra).input("f", sql.NVarChar(40), String(input.numeroFactura).trim())
        .query("SELECT COUNT(*) AS n FROM dbo.RecepcionCompra WHERE idOrdenCompra=@id AND esEliminada=0 AND LTRIM(RTRIM(numeroFactura))=@f");
      if ((dup.recordset[0]?.n ?? 0) > 0) {
        throw new Error(`La factura ${input.numeroFactura} ya está registrada en ${ordenNo}. Revisá "Recibidas" antes de volver a registrarla.`);
      }
    }
    const max = await new sql.Request(tx).query("SELECT MAX(CAST(SUBSTRING(recepcionNo,5,20) AS INT)) AS m FROM dbo.RecepcionCompra WHERE recepcionNo LIKE 'REC-%'");
    const numero = "REC-" + String((max.recordset[0].m ?? 0) + 1).padStart(6, "0");
    // El N.º de BC entra en el mismo INSERT, pero solo si la columna ya está: se
    // pregunta antes en vez de romper el registro por una migración pendiente.
    const bcNo = String(input.bcFacturaNo ?? "").trim().slice(0, 50);
    const conBc = !!bcNo && (await colBcFacturaExiste());
    const rq = new sql.Request(tx)
      .input("idOrdenCompra", sql.Int, input.idOrdenCompra)
      .input("recepcionNo", sql.NVarChar(50), numero)
      .input("numeroFactura", sql.NVarChar(40), input.numeroFactura)
      .input("fechaFactura", sql.Date, input.fechaFactura)
      .input("fechaRecepcion", sql.Date, input.fechaRecepcion)
      .input("fechaRegistro", sql.Date, input.fechaRegistro)
      .input("total", sql.Decimal(18, 2), input.total)
      .input("creadoPor", sql.NVarChar(100), input.usuario);
    if (conBc) rq.input("bcFacturaNo", sql.NVarChar(50), bcNo);
    const ins = await rq
      .query(`INSERT dbo.RecepcionCompra (idOrdenCompra,recepcionNo,numeroFactura,fechaFactura,fechaRecepcion,fechaRegistro,total,esEliminada,fechaCreacion,creadoPor${conBc ? ",bcFacturaNo" : ""})
              OUTPUT INSERTED.idRecepcionCompra
              VALUES (@idOrdenCompra,@recepcionNo,@numeroFactura,@fechaFactura,@fechaRecepcion,@fechaRegistro,@total,0,getdate(),@creadoPor${conBc ? ",@bcFacturaNo" : ""})`);
    const idRec = ins.recordset[0].idRecepcionCompra as number;

    // Guard de SOBRE-RECEPCIÓN: la cantidad se acotaba solo en el cliente, así que
    // un POST repetido (retry, doble envío con red lenta) podía dejar
    // quantityRecibida > quantity y descuadrar la orden contra BC para siempre.
    // Se valida DENTRO de la transacción y se aborta con un mensaje claro.
    const idsLinea = [...new Set(input.lineas.map((l) => l.idOrdenCompraDet))];
    if (idsLinea.length) {
      const rq = new sql.Request(tx);
      const params = idsLinea.map((idl, i) => { rq.input(`l${i}`, sql.Int, idl); return `@l${i}`; });
      const act = await rq.query(
        `SELECT idOrdenCompraDet, descripcion, quantity, ISNULL(quantityRecibida,0) AS recibida
           FROM dbo.OrdenCompraDet WHERE idOrdenCompraDet IN (${params.join(",")})`
      );
      const porId = new Map(act.recordset.map((r: any) => [Number(r.idOrdenCompraDet), r]));
      for (const l of input.lineas) {
        const r = porId.get(Number(l.idOrdenCompraDet));
        if (!r) throw new Error(`La línea ${l.idOrdenCompraDet} ya no existe en la orden; recargá la pantalla.`);
        const pend = Number(r.quantity) - Number(r.recibida);
        if (Number(l.cantidadRecibida) > pend + 1e-6) {
          throw new Error(`"${r.descripcion}": querés recibir ${l.cantidadRecibida} y solo quedan ${pend} pendientes (puede que ya se haya registrado). Recargá la pantalla.`);
        }
      }
    }

    let line = 10000;
    for (const l of input.lineas) {
      await new sql.Request(tx)
        .input("idRecepcionCompra", sql.Int, idRec)
        .input("idOrdenCompraDet", sql.Int, l.idOrdenCompraDet)
        .input("lineNum", sql.Int, line)
        .input("quantityRecibida", sql.Decimal(18, 4), l.cantidadRecibida)
        .input("precioFactura", sql.Decimal(18, 4), l.precioFactura ?? null)
        .input("creadoPor", sql.NVarChar(100), input.usuario)
        .query(`INSERT dbo.RecepcionCompraDet (idRecepcionCompra,idOrdenCompraDet,lineNum,quantityRecibida,precioFactura,fechaCreacion,creadoPor)
                VALUES (@idRecepcionCompra,@idOrdenCompraDet,@lineNum,@quantityRecibida,@precioFactura,getdate(),@creadoPor)`);
      // acumular en la orden (en revisión: solo recibida, la facturada se sube al registrar la factura)
      await new sql.Request(tx).input("id", sql.Int, l.idOrdenCompraDet).input("q", sql.Decimal(18, 4), l.cantidadRecibida)
        .query(`UPDATE dbo.OrdenCompraDet SET quantityRecibida=ISNULL(quantityRecibida,0)+@q${enRevision ? "" : ", quantityFacturada=ISNULL(quantityFacturada,0)+@q"} WHERE idOrdenCompraDet=@id`);
      line += 10000;
    }
    // ¿orden completa?
    const saldo = await new sql.Request(tx).input("id", sql.Int, input.idOrdenCompra)
      .query("SELECT SUM(quantity - ISNULL(quantityRecibida,0)) AS pend FROM dbo.OrdenCompraDet WHERE idOrdenCompra=@id AND tipoLinea='articulo'");
    // En revisión NO cierra la orden: queda pendiente de factura hasta que Kattya la registre.
    const completa = !enRevision && Number(saldo.recordset[0].pend ?? 0) <= 0;
    if (completa) {
      const idComp = await idDeEstado("completado");
      await new sql.Request(tx).input("id", sql.Int, input.idOrdenCompra).input("e", sql.Int, idComp)
        .query("UPDATE dbo.OrdenCompra SET idEstado=@e WHERE idOrdenCompra=@id");
    }
    const nota = String(input.nota ?? "").trim();
    const detMov = (enRevision ? "Recepción (factura en revisión)" : `Factura ${input.numeroFactura}`) + (nota ? ` · ${nota}` : "");
    await logMov(tx, { entidad: "recepcion", idEntidad: idRec, documentoNo: input.numeroFactura || "(en revisión)", tipoMovimiento: enRevision ? "recibido" : "creado", usuario: input.usuario, rol: input.rol, detalle: detMov });
    await logMov(tx, { entidad: "orden", idEntidad: input.idOrdenCompra, documentoNo: ordenNo, tipoMovimiento: completa ? "recepcion_total" : "recepcion_parcial", estadoNuevo: completa ? "completado" : undefined, usuario: input.usuario, rol: input.rol, detalle: detMov });
    await tx.commit();
    return idRec;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

// MODO 2 — Kattya registra la factura de una recepción que estaba EN REVISIÓN.
// Marca el número de factura, sube lo FACTURADO de la orden (= lo recibido en
// esa recepción) y cierra la orden si ya quedó todo recibido.
export async function setRecepcionFactura(idRec: number, numeroFactura: string, usuario: string, rol: Role): Promise<void> {
  const num = String(numeroFactura ?? "").trim();
  if (!num) throw new Error("El número de factura es obligatorio.");
  const pool = await getPool();
  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    const rec = await new sql.Request(tx).input("id", sql.Int, idRec)
      .query("SELECT idOrdenCompra, numeroFactura FROM dbo.RecepcionCompra WHERE idRecepcionCompra=@id AND esEliminada=0");
    const row = rec.recordset[0];
    if (!row) throw new Error(`La recepción ${idRec} no existe.`);
    // Idempotencia: esto SUMA quantityFacturada por cada línea recibida. Si la
    // recepción ya tenía factura (doble envío, reintento, dos pestañas), volver a
    // correrlo duplicaba lo facturado en la orden. Solo se permite sobre una
    // recepción que está EN REVISIÓN (sin número de factura).
    const facturaActual = String(row.numeroFactura ?? "").trim();
    if (facturaActual) {
      throw new Error(`Esa recepción ya tiene la factura ${facturaActual} registrada.`);
    }
    const idOrden = row.idOrdenCompra as number;

    await new sql.Request(tx).input("id", sql.Int, idRec).input("f", sql.NVarChar(40), num)
      .query("UPDATE dbo.RecepcionCompra SET numeroFactura=@f, fechaFactura=ISNULL(fechaFactura,getdate()) WHERE idRecepcionCompra=@id");

    // subir lo FACTURADO de cada línea de la orden por lo que se recibió en esta recepción
    const dets = await new sql.Request(tx).input("id", sql.Int, idRec)
      .query("SELECT idOrdenCompraDet, quantityRecibida FROM dbo.RecepcionCompraDet WHERE idRecepcionCompra=@id");
    for (const d of dets.recordset) {
      await new sql.Request(tx).input("id", sql.Int, d.idOrdenCompraDet).input("q", sql.Decimal(18, 4), d.quantityRecibida)
        .query("UPDATE dbo.OrdenCompraDet SET quantityFacturada=ISNULL(quantityFacturada,0)+@q WHERE idOrdenCompraDet=@id");
    }

    const ord = await new sql.Request(tx).input("id", sql.Int, idOrden).query("SELECT ordenNo FROM dbo.OrdenCompra WHERE idOrdenCompra=@id");
    const ordenNo = ord.recordset[0]?.ordenNo ?? "";
    const saldo = await new sql.Request(tx).input("id", sql.Int, idOrden)
      .query("SELECT SUM(quantity - ISNULL(quantityRecibida,0)) AS pend FROM dbo.OrdenCompraDet WHERE idOrdenCompra=@id AND tipoLinea='articulo'");
    const completa = Number(saldo.recordset[0].pend ?? 0) <= 0;
    if (completa) {
      const idComp = await idDeEstado("completado");
      await new sql.Request(tx).input("id", sql.Int, idOrden).input("e", sql.Int, idComp)
        .query("UPDATE dbo.OrdenCompra SET idEstado=@e WHERE idOrdenCompra=@id");
    }
    await logMov(tx, { entidad: "recepcion", idEntidad: idRec, documentoNo: num, tipoMovimiento: "creado", usuario, rol, detalle: `Factura ${num} registrada (venía de revisión)` });
    await logMov(tx, { entidad: "orden", idEntidad: idOrden, documentoNo: ordenNo, tipoMovimiento: completa ? "recepcion_total" : "recepcion_parcial", estadoNuevo: completa ? "completado" : undefined, usuario, rol, detalle: `Factura ${num}` });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

// ------------------------------------------------- FOTOS DE LA FACTURA (Bodega)
// La imagen vive en dbo.RecepcionCompraFoto (ver sql/recepcion_foto.sql). Todo
// lo de acá tolera que la tabla NO exista todavía: la app no se puede caer por
// una migración pendiente, así que sin tabla simplemente "no hay fotos".
let hayTablaFoto: boolean | null = null;
async function tablaFotoExiste(): Promise<boolean> {
  if (hayTablaFoto !== null) return hayTablaFoto;
  const pool = await getPool();
  const r = await pool.request().query("SELECT OBJECT_ID('dbo.RecepcionCompraFoto') AS id");
  hayTablaFoto = r.recordset[0]?.id != null;
  return hayTablaFoto;
}

export interface NuevaFotoDB { mime: string; base64: string; ancho?: number; alto?: number }

// Guarda las fotos de una recepción ya registrada. Devuelve cuántas entraron.
// Lanza solo si la tabla no existe (para poder avisar "corré la migración").
export async function addRecepcionFotos(idRec: number, fotos: NuevaFotoDB[], usuario: string): Promise<number> {
  if (!fotos.length) return 0;
  if (!(await tablaFotoExiste())) {
    throw new Error("Falta la tabla dbo.RecepcionCompraFoto: hay que correr sql/recepcion_foto.sql en la base de la app.");
  }
  const pool = await getPool();
  let n = 0;
  for (const f of fotos) {
    const buf = Buffer.from(f.base64, "base64");
    if (!buf.length) continue;
    await pool.request()
      .input("idRec", sql.Int, idRec)
      .input("mime", sql.NVarChar(40), f.mime || "image/jpeg")
      .input("imagen", sql.VarBinary(sql.MAX), buf)
      .input("tamano", sql.Int, buf.length)
      .input("ancho", sql.Int, f.ancho ?? null)
      .input("alto", sql.Int, f.alto ?? null)
      .input("creadoPor", sql.NVarChar(100), usuario)
      .query(`INSERT dbo.RecepcionCompraFoto (idRecepcionCompra,mime,imagen,tamano,ancho,alto,esEliminada,fechaCreacion,creadoPor)
              VALUES (@idRec,@mime,@imagen,@tamano,@ancho,@alto,0,getdate(),@creadoPor)`);
    n++;
  }
  return n;
}

// La imagen misma (la sirve /api/recepciones/[id]/foto). Se valida que la foto
// pertenezca a esa recepción para que un id ajeno no devuelva otra factura.
export async function getRecepcionFoto(idRec: number, idFoto: number): Promise<{ mime: string; imagen: Buffer } | null> {
  if (!(await tablaFotoExiste())) return null;
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, idFoto).input("rec", sql.Int, idRec)
    .query(`SELECT mime, imagen FROM dbo.RecepcionCompraFoto
             WHERE idRecepcionCompraFoto=@id AND idRecepcionCompra=@rec AND esEliminada=0`);
  const row = r.recordset[0];
  return row ? { mime: row.mime ?? "image/jpeg", imagen: row.imagen as Buffer } : null;
}

// Metadatos (sin el blob) de todas las fotos, agrupados por recepción.
async function fotosPorRecepcion(): Promise<Map<number, RecepcionFoto[]>> {
  const mapa = new Map<number, RecepcionFoto[]>();
  if (!(await tablaFotoExiste())) return mapa;
  const pool = await getPool();
  const r = await pool.request().query(
    `SELECT idRecepcionCompraFoto, idRecepcionCompra, mime, tamano, ancho, alto
       FROM dbo.RecepcionCompraFoto WHERE esEliminada=0 ORDER BY idRecepcionCompraFoto`
  );
  for (const f of r.recordset) {
    const arr = mapa.get(f.idRecepcionCompra) ?? [];
    arr.push({ id: String(f.idRecepcionCompraFoto), mime: f.mime ?? "image/jpeg",
      tamano: f.tamano != null ? Number(f.tamano) : undefined,
      ancho: f.ancho != null ? Number(f.ancho) : undefined,
      alto: f.alto != null ? Number(f.alto) : undefined });
    mapa.set(f.idRecepcionCompra, arr);
  }
  return mapa;
}

// ----------------------------------------------------------------- listas extra
export async function listRecepciones(): Promise<Recepcion[]> {
  const pool = await getPool();
  const h = await pool.request().query("SELECT * FROM dbo.RecepcionCompra WHERE esEliminada = 0 ORDER BY idRecepcionCompra DESC");
  const d = await pool.request().query("SELECT * FROM dbo.RecepcionCompraDet ORDER BY idRecepcionCompraDet");
  const porRecepcion = porCabecera(d.recordset, "idRecepcionCompra");
  // Si la migración de fotos no está corrida, esto devuelve un mapa vacío.
  const fotos = await fotosPorRecepcion().catch(() => new Map<number, RecepcionFoto[]>());
  return h.recordset.map((r): Recepcion => ({
    id: String(r.idRecepcionCompra), ordenId: String(r.idOrdenCompra), numeroFactura: r.numeroFactura ?? "",
    fechaFactura: (r.fechaFactura?.toISOString?.() ?? "").slice(0, 10),
    fechaRecepcion: (r.fechaRecepcion?.toISOString?.() ?? "").slice(0, 10),
    fechaRegistro: (r.fechaRegistro?.toISOString?.() ?? "").slice(0, 10),
    total: Number(r.total ?? 0), parcial: !!r.esParcial, recibidoPor: r.creadoPor ?? undefined,
    // Sin la migración corrida la columna no viene en el SELECT * y esto queda
    // en undefined: la pantalla simplemente no muestra el N.º de BC.
    bcFacturaNo: (r.bcFacturaNo ?? "").toString().trim() || undefined,
    fotos: fotos.get(r.idRecepcionCompra),
    lineas: (porRecepcion.get(r.idRecepcionCompra) ?? [])
      .map((l): RecepcionLinea => ({
        ordenLineaId: String(l.idOrdenCompraDet),
        cantidadRecibida: Number(l.quantityRecibida ?? 0),
        precioFactura: l.precioFactura != null ? Number(l.precioFactura) : undefined,
      })),
  }));
}

// ----------------------------------------------------------------- MOVIMIENTOS
interface MovIn {
  entidad: "pedido" | "orden" | "recepcion"; idEntidad: number; documentoNo: string;
  tipoMovimiento: string; estadoAnterior?: string; estadoNuevo?: string; detalle?: string; usuario: string; rol: Role;
}
async function logMov(tx: sql.Transaction, m: MovIn) {
  const idAnt = m.estadoAnterior ? await idDeEstado(m.estadoAnterior) : null;
  const idNue = m.estadoNuevo ? await idDeEstado(m.estadoNuevo) : null;
  await new sql.Request(tx)
    .input("entidad", sql.NVarChar(20), m.entidad)
    .input("idEntidad", sql.Int, m.idEntidad)
    .input("documentoNo", sql.NVarChar(50), m.documentoNo)
    .input("tipoMovimiento", sql.NVarChar(50), m.tipoMovimiento)
    .input("idEstadoAnterior", sql.Int, idAnt)
    .input("idEstadoNuevo", sql.Int, idNue)
    .input("detalle", sql.NVarChar(sql.MAX), m.detalle ?? null)
    .input("usuario", sql.NVarChar(100), m.usuario)
    .input("rol", sql.NVarChar(20), m.rol)
    .query(`INSERT dbo.Movimiento (entidad,idEntidad,documentoNo,tipoMovimiento,idEstadoAnterior,idEstadoNuevo,detalle,usuario,rol,fecha)
            VALUES (@entidad,@idEntidad,@documentoNo,@tipoMovimiento,@idEstadoAnterior,@idEstadoNuevo,@detalle,@usuario,@rol,getdate())`);
}

export async function listMovimientos(entidad: string, idEntidad: number) {
  await ensureEstados();
  const pool = await getPool();
  const r = await pool.request().input("e", sql.NVarChar(20), entidad).input("id", sql.Int, idEntidad)
    .query("SELECT * FROM dbo.Movimiento WHERE entidad=@e AND idEntidad=@id ORDER BY fecha DESC, idMovimiento DESC");
  return r.recordset.map((m) => ({
    id: String(m.idMovimiento), entidad: m.entidad, idEntidad: String(m.idEntidad), documentoNo: m.documentoNo ?? "",
    tipoMovimiento: m.tipoMovimiento, estadoAnterior: codigoDeId(m.idEstadoAnterior), estadoNuevo: codigoDeId(m.idEstadoNuevo),
    detalle: m.detalle ?? undefined, usuario: m.usuario, rol: m.rol as Role, fecha: m.fecha?.toISOString?.() ?? "",
  }));
}

/* ============================================================================
   Plantillas de solicitud (dbo.PlantillaSolicitud). Compartidas; el front
   filtra por creadoPor. Las líneas se guardan como JSON (code+cantidad+obra).
   ============================================================================ */

export type PlantillaLineaDB = { code: string; descripcion?: string; cantidad: number; unidad?: string; obraCodigo: string };
export type TipoPlantilla = "general" | "bodega";
export type Plantilla = { id: number; nombre: string; creadoPor: string; idClasificacion: number | null; tipo: TipoPlantilla; lineas: PlantillaLineaDB[]; fechaCreacion: string };

function parseLineas(json: string): PlantillaLineaDB[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// ¿Existe ya la columna dbo.PlantillaSolicitud.tipo? (migración sql/plantilla_tipo.sql).
// Permite que el código funcione con o sin la columna, sin romper el listado.
async function plantillaTieneTipo(pool: sql.ConnectionPool): Promise<boolean> {
  try {
    const r = await pool.request().query("SELECT COL_LENGTH('dbo.PlantillaSolicitud','tipo') AS c");
    return r.recordset[0]?.c != null;
  } catch { return false; }
}
// tipo efectivo: el guardado, o inferido (sin clasificación ⇒ bodega) para filas viejas.
const tipoEfectivo = (tipo: unknown, idClas: number | null): TipoPlantilla =>
  tipo === "bodega" ? "bodega" : tipo === "general" ? "general" : (idClas == null ? "bodega" : "general");

export async function listPlantillas(): Promise<Plantilla[]> {
  const pool = await getPool();
  const hasTipo = await plantillaTieneTipo(pool);
  const cols = `idPlantillaSolicitud, nombre, creadoPor, idClasificacion, lineasJson, fechaCreacion${hasTipo ? ", tipo" : ""}`;
  const r = await pool.request().query(
    `SELECT ${cols} FROM dbo.PlantillaSolicitud WHERE esEliminada = 0 ORDER BY nombre`
  );
  return r.recordset.map((row) => {
    const idClas = row.idClasificacion ?? null;
    return {
      id: row.idPlantillaSolicitud,
      nombre: row.nombre,
      creadoPor: row.creadoPor,
      idClasificacion: idClas,
      tipo: tipoEfectivo(hasTipo ? row.tipo : undefined, idClas),
      lineas: parseLineas(row.lineasJson),
      fechaCreacion: row.fechaCreacion?.toISOString?.() ?? "",
    };
  });
}

export async function createPlantilla(input: { nombre: string; creadoPor: string; tipo?: TipoPlantilla; idClasificacion?: number | null; lineas: PlantillaLineaDB[] }): Promise<number> {
  const pool = await getPool();
  const hasTipo = await plantillaTieneTipo(pool);
  const lineasJson = JSON.stringify(input.lineas ?? []);
  const idClas = input.idClasificacion ?? null;
  const tipo: TipoPlantilla = input.tipo === "bodega" ? "bodega" : "general";
  // upsert por (nombre, creadoPor): si el mismo usuario reusa el nombre, se actualiza.
  const ex = await pool.request()
    .input("nombre", sql.NVarChar(100), input.nombre)
    .input("creadoPor", sql.NVarChar(100), input.creadoPor)
    .query("SELECT idPlantillaSolicitud FROM dbo.PlantillaSolicitud WHERE nombre=@nombre AND creadoPor=@creadoPor AND esEliminada=0");
  if (ex.recordset.length) {
    const id = ex.recordset[0].idPlantillaSolicitud as number;
    const req = pool.request()
      .input("id", sql.Int, id)
      .input("idClasificacion", sql.Int, idClas)
      .input("lineasJson", sql.NVarChar(sql.MAX), lineasJson)
      .input("modificadoPor", sql.NVarChar(100), input.creadoPor);
    if (hasTipo) req.input("tipo", sql.NVarChar(15), tipo);
    await req.query(`UPDATE dbo.PlantillaSolicitud SET idClasificacion=@idClasificacion, lineasJson=@lineasJson${hasTipo ? ", tipo=@tipo" : ""}, fechaModificacion=SYSUTCDATETIME(), modificadoPor=@modificadoPor WHERE idPlantillaSolicitud=@id`);
    return id;
  }
  const ins = pool.request()
    .input("nombre", sql.NVarChar(100), input.nombre)
    .input("creadoPor", sql.NVarChar(100), input.creadoPor)
    .input("idClasificacion", sql.Int, idClas)
    .input("lineasJson", sql.NVarChar(sql.MAX), lineasJson);
  if (hasTipo) ins.input("tipo", sql.NVarChar(15), tipo);
  const res = await ins.query(`INSERT dbo.PlantillaSolicitud (nombre, creadoPor, idClasificacion, lineasJson${hasTipo ? ", tipo" : ""}, esEliminada, fechaCreacion) OUTPUT INSERTED.idPlantillaSolicitud VALUES (@nombre,@creadoPor,@idClasificacion,@lineasJson${hasTipo ? ",@tipo" : ""},0,SYSUTCDATETIME())`);
  return res.recordset[0].idPlantillaSolicitud as number;
}

export async function updatePlantilla(id: number, input: { nombre: string; tipo?: TipoPlantilla; idClasificacion?: number | null; lineas: PlantillaLineaDB[]; usuario: string }): Promise<void> {
  const pool = await getPool();
  const hasTipo = await plantillaTieneTipo(pool);
  const tipo: TipoPlantilla = input.tipo === "bodega" ? "bodega" : "general";
  const req = pool.request()
    .input("id", sql.Int, id)
    .input("nombre", sql.NVarChar(100), input.nombre)
    .input("idClasificacion", sql.Int, input.idClasificacion ?? null)
    .input("lineasJson", sql.NVarChar(sql.MAX), JSON.stringify(input.lineas ?? []))
    .input("modificadoPor", sql.NVarChar(100), input.usuario || null);
  if (hasTipo) req.input("tipo", sql.NVarChar(15), tipo);
  await req.query(`UPDATE dbo.PlantillaSolicitud SET nombre=@nombre, idClasificacion=@idClasificacion, lineasJson=@lineasJson${hasTipo ? ", tipo=@tipo" : ""}, fechaModificacion=SYSUTCDATETIME(), modificadoPor=@modificadoPor WHERE idPlantillaSolicitud=@id`);
}

export async function deletePlantilla(id: number, usuario: string): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input("id", sql.Int, id)
    .input("modificadoPor", sql.NVarChar(100), usuario || null)
    .query("UPDATE dbo.PlantillaSolicitud SET esEliminada=1, fechaModificacion=SYSUTCDATETIME(), modificadoPor=@modificadoPor WHERE idPlantillaSolicitud=@id");
}

/* ============================================================================
   WBS: etapa -> partida -> sub_partida (maestro de clasificaciones) + matriz.
   "Clasificación" = sub_partida (nivel 1.1.1). Ver db/schema_clasificaciones.sql
   ============================================================================ */
export type WbsEtapa = { id: number; codigo: string; nombre: string };
export type WbsPartida = { id: number; codigo: string; nombre: string; etapaId: number | null };
export type WbsSubPartida = { id: number; codigo: string; nombre: string; partidaId: number | null };
export type Clasificacion = { id: number; nombre: string; partidaId: number | null; subPartidaId: number | null };

export async function listWbs(): Promise<{ etapas: WbsEtapa[]; partidas: WbsPartida[]; subpartidas: WbsSubPartida[]; clasificaciones: Clasificacion[] }> {
  const pool = await getPool();
  // OJO: en esta base, dbo.partida usa la convención "boletas" (idPartida/idEtapa/
  // esActivo) y NO existe dbo.sub_partidas. Aliaseamos las columnas de partida y las
  // clasificaciones cuelgan solo de partida (sin sub-partida).
  const [e, p, c] = await Promise.all([
    pool.request().query("SELECT id, codigo, nombre FROM dbo.etapa WHERE activo = 1 ORDER BY codigo"),
    pool.request().query("SELECT idPartida AS id, codigo, nombre, idEtapa AS etapa_id FROM dbo.partida WHERE esActivo = 1 ORDER BY codigo"),
    pool.request().query("SELECT id, nombre, partida_id, sub_partida_id FROM dbo.clasificacion WHERE activo = 1 ORDER BY nombre"),
  ]);
  return {
    etapas: e.recordset.map((r) => ({ id: r.id, codigo: String(r.codigo ?? ""), nombre: r.nombre ?? "" })),
    partidas: p.recordset.map((r) => ({ id: r.id, codigo: String(r.codigo ?? ""), nombre: r.nombre ?? "", etapaId: r.etapa_id ?? null })),
    subpartidas: [],
    clasificaciones: c.recordset.map((r) => ({ id: r.id, nombre: r.nombre ?? "", partidaId: r.partida_id ?? null, subPartidaId: r.sub_partida_id ?? null })),
  };
}

// Etapas (especialidades) de un ingeniero, por username → dbo.UsuarioEtapa.
//
// Va por el pool de AUTH, no por el de datos: esta consulta necesita el PADRÓN de
// usuarios (dbo.Usuario), que vive en la base de auth junto con UsuarioEtapa — y esa
// tabla tiene FK a Usuario Y a etapa, así que solo puede existir donde están las dos.
// Los idEtapa que devuelve se comparan contra dbo.etapa de la base de DATOS; los ids
// se conservan entre bases porque partida.idEtapa depende de ellos.
//
// Defensiva: si la tabla aún no existe o el usuario no tiene mapeo, devuelve []
// (la Matriz cae a "Todas las etapas" sin romperse).
export async function etapasDeUsuario(username: string): Promise<number[]> {
  const u = (username ?? "").trim();
  if (!u) return [];
  let etapas: number[] = [];
  try {
    const pool = await getAuthPool();
    const r = await pool.request().input("u", sql.NVarChar(256), u).query(
      "SELECT ue.idEtapa FROM dbo.UsuarioEtapa ue " +
      "JOIN dbo.Usuario us ON us.idUsuario = ue.idUsuario " +
      "WHERE us.username = @u"
    );
    etapas = r.recordset.map((x) => x.idEtapa as number).filter((n) => n != null);
  } catch (e) {
    // Se traga el error (la Matriz no se cae por esto) pero lo DEJA en el log: en
    // silencio, "sin mapeo" y "la tabla no existe en ninguna base" se ven igual.
    console.warn("etapasDeUsuario:", e);
    return [];
  }
  if (!etapas.length) return [];

  // Una etapa SIN clasificaciones activas no sirve como filtro: al ingeniero se le
  // abriría la Matriz filtrada y VACÍA, que se lee como "se perdió mi trabajo".
  // Mientras la etapa no tenga nada que mostrar es mejor no mandarla y que caiga a
  // "todas las etapas". Pasa hoy con ELECTROMECANICO (2 partidas, 0 clasificaciones)
  // y con las etapas nuevas de Infraestructura y Postventa.
  //
  // Va en DOS consultas, una por pool, a propósito: `UsuarioEtapa` vive con el padrón
  // y `partida`/`clasificacion` con los datos. Hoy son la misma base, pero un JOIN
  // entre las dos se rompería el día que se vuelvan a separar.
  try {
    const pool = await getPool();
    const req = pool.request();
    const params = etapas.map((e, i) => { req.input(`e${i}`, sql.Int, e); return `@e${i}`; });
    const r = await req.query(
      `SELECT DISTINCT pa.idEtapa FROM dbo.partida pa
         JOIN dbo.clasificacion c ON c.partida_id = pa.idPartida
        WHERE pa.idEtapa IN (${params.join(",")}) AND pa.esActivo = 1 AND c.activo = 1`
    );
    const conContenido = new Set(r.recordset.map((x) => x.idEtapa as number));
    return etapas.filter((e) => conContenido.has(e));
  } catch (e) {
    // Si no se pudo verificar, se devuelve lo que hay mapeado: es lo que pasaba antes.
    console.warn("etapasDeUsuario: no se pudo comprobar si las etapas tienen contenido:", e);
    return etapas;
  }
}

// Obras por las que arranca la Matriz de un ingeniero, por username → dbo.UsuarioObra.
//
// Es el hermano de `etapasDeUsuario` por el otro eje. Para Ana y Marco la fase no
// distingue su trabajo (infraestructura y postventa son OBRAS en BC, no fases de una
// casa), así que su Matriz arranca por obra. `patron` puede ser un código exacto
// ('INF-HDAII') o un patrón ('INF-%'), y se resuelve con LIKE: con el patrón, una
// obra nueva de infraestructura entra sola, sin tocar el mapeo.
//
// Dos consultas, una por pool, por lo mismo que en etapasDeUsuario: `UsuarioObra`
// vive con el padrón y `Obra` con los datos. Hoy son la misma base; un JOIN entre las
// dos se rompería el día que se separen.
//
// Si los patrones no calzan con ninguna obra devuelve [] a propósito: el consumidor
// cae a "todas las obras" en vez de abrir la Matriz filtrada y VACÍA.
export type ObraDeUsuario = { idObra: number; numeroObra: string; nombreMostrado: string };
export async function obrasDeUsuario(username: string): Promise<{ obras: ObraDeUsuario[]; patrones: string[] }> {
  const u = (username ?? "").trim();
  if (!u) return { obras: [], patrones: [] };
  let patrones: string[] = [];
  try {
    const pool = await getAuthPool();
    const r = await pool.request().input("u", sql.NVarChar(256), u).query(
      "SELECT uo.patron FROM dbo.UsuarioObra uo " +
      "JOIN dbo.Usuario us ON us.idUsuario = uo.idUsuario " +
      "WHERE us.username = @u"
    );
    patrones = r.recordset.map((x) => String(x.patron ?? "").trim()).filter(Boolean);
  } catch (e) {
    // La tabla puede no estar creada todavía: se avisa en el log y la Matriz sigue
    // mostrando todo (que es el comportamiento de siempre).
    console.warn("obrasDeUsuario:", e);
    return { obras: [], patrones: [] };
  }
  if (!patrones.length) return { obras: [], patrones: [] };
  try {
    const pool = await getPool();
    const req = pool.request();
    const cond = patrones.map((pat, i) => { req.input(`p${i}`, sql.NVarChar(50), pat); return `numeroObra LIKE @p${i}`; });
    const r = await req.query(
      `SELECT idObra, numeroObra, nombreMostrado FROM dbo.Obra
        WHERE ${cond.join(" OR ")} ORDER BY numeroObra`);
    return {
      obras: r.recordset.map((x) => ({ idObra: x.idObra, numeroObra: String(x.numeroObra ?? "").trim(), nombreMostrado: x.nombreMostrado ?? "" })),
      patrones,
    };
  } catch (e) {
    console.warn("obrasDeUsuario: no se pudieron resolver los patrones:", e);
    return { obras: [], patrones };
  }
}

// Crea una clasificación (control del ingeniero) colgando de una partida O de una sub_partida.
export async function createClasificacion(input: { nombre: string; partidaId?: number | null; subPartidaId?: number | null }): Promise<number> {
  const pool = await getPool();
  const nombre = input.nombre.trim();
  const partidaId = input.partidaId ?? null;
  const subPartidaId = input.subPartidaId ?? null;
  if (!nombre) throw new Error("Falta el nombre");
  if ((partidaId == null) === (subPartidaId == null)) throw new Error("Indicá una partida O una sub-partida (una sola)");
  const ins = await pool.request()
    .input("nombre", sql.NVarChar(160), nombre)
    .input("partidaId", sql.Int, partidaId)
    .input("subPartidaId", sql.Int, subPartidaId)
    .query("INSERT dbo.clasificacion (nombre, partida_id, sub_partida_id, activo, creado_en) OUTPUT INSERTED.id VALUES (@nombre,@partidaId,@subPartidaId,1,SYSUTCDATETIME())");
  return ins.recordset[0].id as number;
}

// Actualiza una clasificación existente (nombre y padre). Mantiene el XOR
// partida/sub-partida por el CHECK de la tabla. En AdelanteSBX solo hay partida.
export async function updateClasificacion(id: number, input: { nombre: string; partidaId?: number | null; subPartidaId?: number | null }): Promise<void> {
  const pool = await getPool();
  const nombre = input.nombre.trim();
  const partidaId = input.partidaId ?? null;
  const subPartidaId = input.subPartidaId ?? null;
  if (!nombre) throw new Error("Falta el nombre");
  if ((partidaId == null) === (subPartidaId == null)) throw new Error("Indicá una partida O una sub-partida (una sola)");
  await pool.request()
    .input("id", sql.Int, id)
    .input("nombre", sql.NVarChar(160), nombre)
    .input("partidaId", sql.Int, partidaId)
    .input("subPartidaId", sql.Int, subPartidaId)
    .query("UPDATE dbo.clasificacion SET nombre=@nombre, partida_id=@partidaId, sub_partida_id=@subPartidaId WHERE id=@id AND activo=1");
}

// Crea una clasificación (sub_partida) bajo una partida; el código se autogenera
// como <codigoPartida>.<siguiente>.
export async function createSubPartida(input: { partidaId: number; nombre: string }): Promise<number> {
  const pool = await getPool();
  const pr = await pool.request().input("pid", sql.Int, input.partidaId).query("SELECT codigo FROM dbo.partida WHERE id=@pid");
  if (!pr.recordset.length) throw new Error("Partida no encontrada");
  const pcod = String(pr.recordset[0].codigo);
  const mx = await pool.request().input("pid", sql.Int, input.partidaId)
    .query("SELECT MAX(CAST(RIGHT(codigo, CHARINDEX('.', REVERSE(codigo)) - 1) AS INT)) AS m FROM dbo.sub_partidas WHERE partida_id=@pid AND codigo LIKE '%.%.%'");
  const next = (mx.recordset[0].m ?? 0) + 1;
  const codigo = `${pcod}.${next}`;
  const ins = await pool.request()
    .input("codigo", sql.VarChar(20), codigo)
    .input("nombre", sql.NVarChar(200), input.nombre)
    .input("pid", sql.Int, input.partidaId)
    .query("INSERT dbo.sub_partidas (codigo, nombre, partida_id, activo, creado_en) OUTPUT INSERTED.id VALUES (@codigo,@nombre,@pid,1,SYSUTCDATETIME())");
  return ins.recordset[0].id as number;
}

export type ObraLite = { idObra: number; numeroObra: string; nombreMostrado: string; areaCosteo: string; proyecto: string };
export async function listObras(): Promise<ObraLite[]> {
  const pool = await getPool();
  const r = await pool.request().query("SELECT idObra, numeroObra, nombreMostrado, areaCosteo, proyectoPadre FROM dbo.Obra ORDER BY numeroObra");
  return r.recordset.map((x) => {
    const numero = x.numeroObra ?? "";
    // Proyecto = proyectoPadre si viene, si no el prefijo del código (VN, VC, VB…).
    const prefijo = String(numero).split(/[-.\s]/)[0] || "";
    return { idObra: x.idObra, numeroObra: numero, nombreMostrado: x.nombreMostrado ?? "", areaCosteo: x.areaCosteo ?? "", proyecto: (x.proyectoPadre ?? "") || prefijo };
  });
}

export type MatrizCelda = { idObra: number; idClasificacion: number; estado: string };
export async function matrizCeldas(): Promise<MatrizCelda[]> {
  const pool = await getPool();
  const r = await pool.request().query("SELECT idObra, idClasificacion, estado FROM dbo.vw_MatrizObraClasificacion");
  return r.recordset.map((x) => ({ idObra: x.idObra, idClasificacion: x.idClasificacion, estado: x.estado ?? "" }));
}

/* ============================================================================
   Vistas de tabla guardadas por usuario (DataTable / TanStack). Ver
   db/schema_tabla_vistas.sql
   ============================================================================ */
export type TablaVista = { id: number; nombre: string; config: any; esPredeterminada: boolean };

export async function listVistas(usuario: string, tablaKey: string): Promise<TablaVista[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input("usuario", sql.NVarChar(100), usuario)
    .input("tablaKey", sql.NVarChar(60), tablaKey)
    .query("SELECT id, nombre, configJson, esPredeterminada FROM dbo.TablaVista WHERE esEliminada=0 AND usuario=@usuario AND tablaKey=@tablaKey ORDER BY nombre");
  return r.recordset.map((row) => {
    let config: any = {};
    try { config = JSON.parse(row.configJson); } catch { config = {}; }
    return { id: row.id, nombre: row.nombre, config, esPredeterminada: !!row.esPredeterminada };
  });
}

export async function saveVista(input: { usuario: string; tablaKey: string; nombre: string; config: any; esPredeterminada?: boolean }): Promise<number> {
  const pool = await getPool();
  const configJson = JSON.stringify(input.config ?? {});
  const pred = input.esPredeterminada ? 1 : 0;
  if (pred) {
    await pool.request().input("usuario", sql.NVarChar(100), input.usuario).input("tablaKey", sql.NVarChar(60), input.tablaKey)
      .query("UPDATE dbo.TablaVista SET esPredeterminada=0 WHERE usuario=@usuario AND tablaKey=@tablaKey");
  }
  const ex = await pool.request()
    .input("usuario", sql.NVarChar(100), input.usuario).input("tablaKey", sql.NVarChar(60), input.tablaKey).input("nombre", sql.NVarChar(100), input.nombre)
    .query("SELECT id FROM dbo.TablaVista WHERE usuario=@usuario AND tablaKey=@tablaKey AND nombre=@nombre AND esEliminada=0");
  if (ex.recordset.length) {
    const id = ex.recordset[0].id as number;
    await pool.request().input("id", sql.Int, id).input("configJson", sql.NVarChar(sql.MAX), configJson).input("pred", sql.Bit, pred)
      .query("UPDATE dbo.TablaVista SET configJson=@configJson, esPredeterminada=@pred, fechaModificacion=SYSUTCDATETIME() WHERE id=@id");
    return id;
  }
  const ins = await pool.request()
    .input("usuario", sql.NVarChar(100), input.usuario).input("tablaKey", sql.NVarChar(60), input.tablaKey).input("nombre", sql.NVarChar(100), input.nombre)
    .input("configJson", sql.NVarChar(sql.MAX), configJson).input("pred", sql.Bit, pred)
    .query("INSERT dbo.TablaVista (usuario, tablaKey, nombre, configJson, esPredeterminada, esEliminada, fechaCreacion) OUTPUT INSERTED.id VALUES (@usuario,@tablaKey,@nombre,@configJson,@pred,0,SYSUTCDATETIME())");
  return ins.recordset[0].id as number;
}

export async function deleteVista(id: number, usuario: string): Promise<void> {
  const pool = await getPool();
  await pool.request().input("id", sql.Int, id).input("usuario", sql.NVarChar(100), usuario)
    .query("UPDATE dbo.TablaVista SET esEliminada=1, fechaModificacion=SYSUTCDATETIME() WHERE id=@id AND usuario=@usuario");
}

/* ============================================================================
   NOTAS DE CRÉDITO (Bodega) — líneas de factura recibida con problema (dañado /
   menos cantidad / precio distinto) para emitir una nota de crédito.
   Tabla dbo.NotaCreditoDet (ver sql/notas_credito.sql). Aislado del bootstrap.
   ============================================================================ */
export interface NewNotaCreditoDB {
  idOrdenCompra: number;
  usuario: string;
  lineas: { ordenLineaId?: string; articuloNo?: string; descripcion: string; motivo: string; cantidad: number; precioUnitario?: number; nota?: string }[];
}

// Auto-provisiona la tabla si no existe (igual que ensureEstados con el catálogo).
// Antes dependía de correr sql/notas_credito.sql a mano en la base; si no se
// corría, el INSERT/SELECT fallaba y el error se tragaba → las NC "desaparecían".
let notasCreditoTableReady = false;
async function ensureNotasCreditoTable() {
  if (notasCreditoTableReady) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'NotaCreditoDet' AND schema_id = SCHEMA_ID('dbo'))
    BEGIN
      CREATE TABLE dbo.NotaCreditoDet (
        idNotaCreditoDet  INT IDENTITY(1,1) PRIMARY KEY,
        idOrdenCompra     INT            NOT NULL,
        idOrdenCompraDet  INT            NULL,
        articuloNo        NVARCHAR(40)   NULL,
        descripcion       NVARCHAR(200)  NULL,
        motivo            NVARCHAR(30)   NOT NULL,
        cantidad          DECIMAL(18,4)  NOT NULL,
        precioUnitario    DECIMAL(18,4)  NULL,
        nota              NVARCHAR(300)  NULL,
        estado            NVARCHAR(20)   NOT NULL CONSTRAINT DF_NotaCreditoDet_estado DEFAULT ('pendiente'),
        esEliminada       BIT            NOT NULL CONSTRAINT DF_NotaCreditoDet_elim   DEFAULT (0),
        fechaCreacion     DATETIME       NOT NULL CONSTRAINT DF_NotaCreditoDet_fc     DEFAULT (getdate()),
        creadoPor         NVARCHAR(100)  NULL
      );
      CREATE INDEX IX_NotaCreditoDet_orden ON dbo.NotaCreditoDet(idOrdenCompra);
    END`);
  notasCreditoTableReady = true;
}

export async function createNotasCredito(input: NewNotaCreditoDB): Promise<number> {
  await ensureNotasCreditoTable();
  const pool = await getPool();
  let n = 0;
  for (const l of input.lineas) {
    if (!l.descripcion || !(l.cantidad > 0)) continue;
    await pool.request()
      .input("idOrdenCompra", sql.Int, input.idOrdenCompra)
      .input("idOrdenCompraDet", sql.Int, l.ordenLineaId ? Number(l.ordenLineaId) : null)
      .input("articuloNo", sql.NVarChar(40), l.articuloNo ?? null)
      .input("descripcion", sql.NVarChar(200), l.descripcion)
      .input("motivo", sql.NVarChar(30), l.motivo)
      .input("cantidad", sql.Decimal(18, 4), l.cantidad)
      .input("precioUnitario", sql.Decimal(18, 4), l.precioUnitario ?? null)
      .input("nota", sql.NVarChar(300), l.nota ?? null)
      .input("creadoPor", sql.NVarChar(100), input.usuario)
      .query(`INSERT dbo.NotaCreditoDet (idOrdenCompra,idOrdenCompraDet,articuloNo,descripcion,motivo,cantidad,precioUnitario,nota,estado,esEliminada,fechaCreacion,creadoPor)
              VALUES (@idOrdenCompra,@idOrdenCompraDet,@articuloNo,@descripcion,@motivo,@cantidad,@precioUnitario,@nota,'pendiente',0,getdate(),@creadoPor)`);
    n++;
  }
  return n;
}

// Cerrar (o reabrir) una línea de nota de crédito. La columna `estado` y el estado
// "resuelta" ya existían en el modelo, pero nada los escribía: la lista de
// Contabilidad solo crecía. Queda además en la bitácora de la orden, para saber
// quién la acreditó y cuándo (la tabla no tiene columna de modificación).
export async function setNotaCreditoEstado(id: number, estado: "pendiente" | "resuelta", usuario: string, rol: Role): Promise<void> {
  await ensureNotasCreditoTable();
  const pool = await getPool();
  const prev = await pool.request().input("id", sql.Int, id).query(
    `SELECT nc.idOrdenCompra, nc.descripcion, o.ordenNo
       FROM dbo.NotaCreditoDet nc
       LEFT JOIN dbo.OrdenCompra o ON o.idOrdenCompra = nc.idOrdenCompra
      WHERE nc.idNotaCreditoDet=@id`);
  if (!prev.recordset.length) throw new Error(`Nota de crédito ${id} no encontrada`);
  await pool.request().input("id", sql.Int, id).input("e", sql.NVarChar(20), estado)
    .query("UPDATE dbo.NotaCreditoDet SET estado=@e WHERE idNotaCreditoDet=@id");
  const row = prev.recordset[0];
  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    await logMov(tx, {
      entidad: "orden", idEntidad: Number(row.idOrdenCompra), documentoNo: row.ordenNo ?? "",
      tipoMovimiento: estado === "resuelta" ? "nc_resuelta" : "nc_reabierta",
      detalle: row.descripcion ?? undefined, usuario, rol,
    });
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
}

export async function listNotasCredito(): Promise<NotaCreditoLinea[]> {
  await ensureNotasCreditoTable();
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT nc.idNotaCreditoDet, nc.idOrdenCompra, nc.idOrdenCompraDet, nc.articuloNo, nc.descripcion,
           nc.motivo, nc.cantidad, nc.precioUnitario, nc.nota, nc.estado, nc.fechaCreacion, o.ordenNo, o.bcNo
    FROM dbo.NotaCreditoDet nc
    LEFT JOIN dbo.OrdenCompra o ON o.idOrdenCompra = nc.idOrdenCompra
    WHERE ISNULL(nc.esEliminada,0)=0
    ORDER BY nc.fechaCreacion DESC`);
  return r.recordset.map((x: any) => ({
    id: String(x.idNotaCreditoDet),
    ordenId: String(x.idOrdenCompra),
    // El N.º que se maneja es el de BC; sin él va el rótulo interno, nunca un
    // "CP-…" que en BC no existe (antes salía el interno crudo aunque la orden ya
    // tuviera su número de BC en la misma fila de la consulta).
    ordenNumero: x.bcNo || etiquetaInterna(x.ordenNo ?? ""),
    ordenLineaId: x.idOrdenCompraDet != null ? String(x.idOrdenCompraDet) : undefined,
    articuloNo: x.articuloNo ?? undefined,
    descripcion: x.descripcion ?? "",
    motivo: x.motivo,
    cantidad: Number(x.cantidad) || 0,
    precioUnitario: x.precioUnitario != null ? Number(x.precioUnitario) : undefined,
    nota: x.nota ?? undefined,
    fecha: x.fechaCreacion instanceof Date ? x.fechaCreacion.toISOString() : String(x.fechaCreacion ?? ""),
    estado: (x.estado ?? "pendiente") as NotaCreditoLinea["estado"],
    // Deep links a BC, SOLO con el N.º de BC:
    //  • bcFacturaUrl → Facturas de compra registradas (para hacer la NC).
    //  • bcUrl → el Pedido de compra (la orden que armó Proveeduría).
    // Antes caían al N.º de la app cuando faltaba el de BC, y el link abría BC
    // filtrando por un número que allá no existe: una lista vacía sin explicación.
    // Sin N.º de BC no hay link.
    bcFacturaUrl: (x.bcNo && bcDeepLinkFacturaRegistrada(String(x.bcNo))) || undefined,
    bcUrl: (x.bcNo && bcDeepLinkPedido(String(x.bcNo))) || undefined,
  }));
}
