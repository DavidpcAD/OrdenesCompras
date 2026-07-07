import { getPool, sql } from "./db";
import type { Orden, OrdenLinea, Pedido, PedidoLinea, Recepcion, RecepcionLinea, Role } from "./types";

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
  borrador: "Borrador", aprobado: "Aprobado", en_orden: "En orden", cerrado: "Cerrado",
  // orden
  abierto: "Abierto", pendiente_aprobacion: "Pendiente de aprobación", lanzado: "Lanzado", completado: "Completado",
};
const CODIGO_POR_NOMBRE: Record<string, string> = Object.fromEntries(
  Object.entries(NOMBRE_POR_CODIGO).map(([c, n]) => [n, c])
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
  // Solo los estados del módulo Compras, para no colisionar con los de otros módulos.
  const r = await pool.request().query("SELECT idEstado, estado FROM dbo.Estado WHERE modulo='Compras'");
  estadoNombreToId = new Map();
  estadoIdToNombre = new Map();
  for (const row of r.recordset) {
    estadoNombreToId.set(row.estado, row.idEstado);
    estadoIdToNombre.set(row.idEstado, row.estado);
  }
}

async function idDeEstado(codigo?: string): Promise<number | null> {
  if (!codigo) return null;
  await ensureEstados();
  const nombre = NOMBRE_POR_CODIGO[codigo] ?? codigo;
  return estadoNombreToId!.get(nombre) ?? null;
}
function codigoDeId(id: number | null): string | undefined {
  if (id == null || !estadoIdToNombre) return undefined;
  const nombre = estadoIdToNombre.get(id);
  return nombre ? (CODIGO_POR_NOMBRE[nombre] ?? nombre) : undefined;
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
export async function listPedidos(): Promise<Pedido[]> {
  await ensureEstados();
  const pool = await getPool();
  const h = await pool.request().query("SELECT * FROM dbo.PedidoCompra WHERE esEliminada = 0 ORDER BY idPedidoCompra DESC");
  const d = await pool.request().query("SELECT * FROM dbo.PedidoCompraDet ORDER BY idPedidoCompraDet");
  return h.recordset.map((p) => mapPedido(p, d.recordset.filter((x) => x.idPedidoCompra === p.idPedidoCompra)));
}

export async function getPedido(id: number): Promise<Pedido | null> {
  await ensureEstados();
  const pool = await getPool();
  const h = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.PedidoCompra WHERE idPedidoCompra=@id");
  if (!h.recordset.length) return null;
  const d = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.PedidoCompraDet WHERE idPedidoCompra=@id ORDER BY idPedidoCompraDet");
  return mapPedido(h.recordset[0], d.recordset);
}

function mapPedido(p: any, lineas: any[]): Pedido {
  return {
    id: String(p.idPedidoCompra), numero: p.pedidoNo ?? "",
    tipoSolicitud: (p.tipoSolicitud ?? "material") as Pedido["tipoSolicitud"],
    obraCodigo: p.obra ?? undefined, obraNombre: p.proyecto ?? undefined,
    maquinaNo: p.maquinaNo ?? undefined, maquinaNombre: undefined,
    solicitante: p.solicitante ?? "", fecha: (p.fechaCreacion?.toISOString?.() ?? "").slice(0, 10),
    estado: (codigoDeId(p.idEstado) ?? "borrador") as Pedido["estado"],
    prioridad: (p.prioridad ?? "normal") as Pedido["prioridad"], notas: p.notaCreador ?? undefined,
    idClasificacion: p.idClasificacion ?? null,
    lineas: lineas.map((l): PedidoLinea => ({
      id: String(l.idPedidoCompraDet), articuloId: l.itemNo ?? "", descripcion: l.descripcion ?? "",
      cantidad: Number(l.quantitySolicitado ?? 0), unidad: l.unitOfMeasureCode ?? "",
      almacen: l.locationCode ?? "", variantCode: l.variantCode ?? undefined, cantidadOrdenada: Number(l.quantityOrdenado ?? 0), notas: l.notaCreador ?? undefined,
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

export async function setPedidoEstado(id: number, estado: string, usuario: string, rol: Role) {
  const pool = await getPool();
  const prev = await pool.request().input("id", sql.Int, id).query("SELECT idEstado, pedidoNo FROM dbo.PedidoCompra WHERE idPedidoCompra=@id");
  const idEstado = await idDeEstado(estado);
  await pool.request().input("id", sql.Int, id).input("e", sql.Int, idEstado)
    .input("u", sql.NVarChar(100), usuario)
    .query("UPDATE dbo.PedidoCompra SET idEstado=@e, fechaModificacion=getdate(), modificadoPor=@u WHERE idPedidoCompra=@id");
  const tx = new sql.Transaction(pool); await tx.begin();
  await logMov(tx, { entidad: "pedido", idEntidad: id, documentoNo: prev.recordset[0]?.pedidoNo ?? "", tipoMovimiento: estado, estadoAnterior: codigoDeId(prev.recordset[0]?.idEstado), estadoNuevo: estado, usuario, rol });
  await tx.commit();
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
export async function listOrdenes(): Promise<Orden[]> {
  await ensureEstados();
  const pool = await getPool();
  const h = await pool.request().query("SELECT * FROM dbo.OrdenCompra WHERE esEliminada = 0 ORDER BY idOrdenCompra DESC");
  const d = await pool.request().query("SELECT * FROM dbo.OrdenCompraDet ORDER BY idOrdenCompraDet");
  return h.recordset.map((o) => mapOrden(o, d.recordset.filter((x) => x.idOrdenCompra === o.idOrdenCompra)));
}

export async function getOrden(id: number): Promise<Orden | null> {
  await ensureEstados();
  const pool = await getPool();
  const h = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.OrdenCompra WHERE idOrdenCompra=@id");
  if (!h.recordset.length) return null;
  const d = await pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.OrdenCompraDet WHERE idOrdenCompra=@id ORDER BY idOrdenCompraDet");
  return mapOrden(h.recordset[0], d.recordset);
}

function mapOrden(o: any, lineas: any[]): Orden {
  return {
    id: String(o.idOrdenCompra), numero: o.ordenNo ?? "", proveedorId: o.proveedorNo ?? "",
    fecha: (o.fechaEmision?.toISOString?.() ?? o.fechaCreacion?.toISOString?.() ?? "").slice(0, 10),
    currencyCode: o.currencyCode ?? "",
    estado: (codigoDeId(o.idEstado) ?? "abierto") as Orden["estado"],
    versionesArchivadas: Number(o.versionesArchivadas ?? 0),
    lineas: lineas.map((l): OrdenLinea => ({
      id: String(l.idOrdenCompraDet), tipo: (l.tipoLinea === "cargo" ? "cargo" : "articulo"),
      articuloId: l.itemNo ?? undefined, pedidoLineaId: l.idPedidoCompraDet ? String(l.idPedidoCompraDet) : undefined,
      pedidoNumero: undefined, descripcion: l.descripcion ?? "", cantidad: Number(l.quantity ?? 0),
      unidad: l.unitOfMeasureCode ?? "", almacen: l.locationCode ?? "", precioUnitario: Number(l.directUnitCost ?? 0),
      ivaPct: Number(l.vatPct ?? 0), descuentoPct: Number(l.lineDiscountPct ?? 0) || undefined,
      proyecto: l.jobNo ?? undefined, taskNo: l.taskNo ?? undefined,
      cantidadRecibida: Number(l.quantityRecibida ?? 0), cantidadFacturada: Number(l.quantityFacturada ?? 0),
    })),
  };
}

export interface NewOrdenDB {
  proveedorNo: string; proveedorNombre?: string; currencyCode: string; usuario: string; rol: Role;
  lineas: {
    tipoLinea: string; itemNo?: string; idPedidoCompraDet?: number; descripcion: string; cantidad: number;
    unidad: string; almacen: string; precioUnitario: number; ivaPct: number; descuentoPct?: number; jobNo?: string; taskNo?: string;
  }[];
}

export async function createOrden(input: NewOrdenDB): Promise<number> {
  const pool = await getPool();
  const idAbierto = await idDeEstado("abierto");
  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    const max = await new sql.Request(tx).query("SELECT MAX(CAST(SUBSTRING(ordenNo,4,20) AS INT)) AS m FROM dbo.OrdenCompra WHERE ordenNo LIKE 'CP-%'");
    const numero = "CP-" + String((max.recordset[0].m ?? 0) + 1).padStart(6, "0");
    const ins = await new sql.Request(tx)
      .input("idEstado", sql.Int, idAbierto)
      .input("ordenNo", sql.NVarChar(50), numero)
      .input("proveedorNo", sql.NVarChar(20), input.proveedorNo)
      .input("proveedorNombre", sql.NVarChar(150), input.proveedorNombre ?? null)
      .input("currencyCode", sql.NVarChar(10), input.currencyCode || null)
      .input("creadoPor", sql.NVarChar(100), input.usuario)
      .query(`INSERT dbo.OrdenCompra (idEstado,ordenNo,proveedorNo,proveedorNombre,currencyCode,fechaEmision,esEliminada,fechaCreacion,creadoPor)
              OUTPUT INSERTED.idOrdenCompra
              VALUES (@idEstado,@ordenNo,@proveedorNo,@proveedorNombre,@currencyCode,CAST(getdate() AS date),0,getdate(),@creadoPor)`);
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
        .input("unitOfMeasureCode", sql.NVarChar(20), l.unidad)
        .input("locationCode", sql.NVarChar(20), l.almacen)
        .input("quantity", sql.Decimal(18, 4), l.cantidad)
        .input("directUnitCost", sql.Decimal(18, 4), l.precioUnitario)
        .input("vatPct", sql.Decimal(9, 4), l.ivaPct)
        .input("lineDiscountPct", sql.Decimal(9, 4), l.descuentoPct ?? 0)
        .input("jobNo", sql.NVarChar(20), l.jobNo ?? null)
        .input("taskNo", sql.NVarChar(15), l.taskNo ?? null)
        .input("creadoPor", sql.NVarChar(100), input.usuario)
        .query(`INSERT dbo.OrdenCompraDet (idOrdenCompra,idPedidoCompraDet,lineNum,tipoLinea,descripcion,itemNo,unitOfMeasureCode,locationCode,quantity,quantityRecibida,quantityFacturada,directUnitCost,vatPct,lineDiscountPct,jobNo,taskNo,fechaCreacion,creadoPor)
                VALUES (@idOrdenCompra,@idPedidoCompraDet,@lineNum,@tipoLinea,@descripcion,@itemNo,@unitOfMeasureCode,@locationCode,@quantity,0,0,@directUnitCost,@vatPct,@lineDiscountPct,@jobNo,@taskNo,getdate(),@creadoPor)`);
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

export async function setOrdenEstado(id: number, estado: string, usuario: string, rol: Role, motivo?: string) {
  const pool = await getPool();
  const prev = await pool.request().input("id", sql.Int, id).query("SELECT idEstado, ordenNo FROM dbo.OrdenCompra WHERE idOrdenCompra=@id");
  const idEstado = await idDeEstado(estado);
  await pool.request().input("id", sql.Int, id).input("e", sql.Int, idEstado).input("u", sql.NVarChar(100), usuario)
    .query("UPDATE dbo.OrdenCompra SET idEstado=@e, fechaModificacion=getdate(), modificadoPor=@u WHERE idOrdenCompra=@id");
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
}

export async function createRecepcion(input: NewRecepcionDB): Promise<number> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    const ord = await new sql.Request(tx).input("id", sql.Int, input.idOrdenCompra).query("SELECT ordenNo FROM dbo.OrdenCompra WHERE idOrdenCompra=@id");
    const ordenNo = ord.recordset[0]?.ordenNo ?? "";
    const max = await new sql.Request(tx).query("SELECT MAX(CAST(SUBSTRING(recepcionNo,5,20) AS INT)) AS m FROM dbo.RecepcionCompra WHERE recepcionNo LIKE 'REC-%'");
    const numero = "REC-" + String((max.recordset[0].m ?? 0) + 1).padStart(6, "0");
    const ins = await new sql.Request(tx)
      .input("idOrdenCompra", sql.Int, input.idOrdenCompra)
      .input("recepcionNo", sql.NVarChar(50), numero)
      .input("numeroFactura", sql.NVarChar(40), input.numeroFactura)
      .input("fechaFactura", sql.Date, input.fechaFactura)
      .input("fechaRecepcion", sql.Date, input.fechaRecepcion)
      .input("fechaRegistro", sql.Date, input.fechaRegistro)
      .input("total", sql.Decimal(18, 2), input.total)
      .input("creadoPor", sql.NVarChar(100), input.usuario)
      .query(`INSERT dbo.RecepcionCompra (idOrdenCompra,recepcionNo,numeroFactura,fechaFactura,fechaRecepcion,fechaRegistro,total,esEliminada,fechaCreacion,creadoPor)
              OUTPUT INSERTED.idRecepcionCompra
              VALUES (@idOrdenCompra,@recepcionNo,@numeroFactura,@fechaFactura,@fechaRecepcion,@fechaRegistro,@total,0,getdate(),@creadoPor)`);
    const idRec = ins.recordset[0].idRecepcionCompra as number;

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
      // acumular en la orden
      await new sql.Request(tx).input("id", sql.Int, l.idOrdenCompraDet).input("q", sql.Decimal(18, 4), l.cantidadRecibida)
        .query("UPDATE dbo.OrdenCompraDet SET quantityRecibida=ISNULL(quantityRecibida,0)+@q, quantityFacturada=ISNULL(quantityFacturada,0)+@q WHERE idOrdenCompraDet=@id");
      line += 10000;
    }
    // ¿orden completa?
    const saldo = await new sql.Request(tx).input("id", sql.Int, input.idOrdenCompra)
      .query("SELECT SUM(quantity - ISNULL(quantityRecibida,0)) AS pend FROM dbo.OrdenCompraDet WHERE idOrdenCompra=@id AND tipoLinea='articulo'");
    const completa = Number(saldo.recordset[0].pend ?? 0) <= 0;
    if (completa) {
      const idComp = await idDeEstado("completado");
      await new sql.Request(tx).input("id", sql.Int, input.idOrdenCompra).input("e", sql.Int, idComp)
        .query("UPDATE dbo.OrdenCompra SET idEstado=@e WHERE idOrdenCompra=@id");
    }
    await logMov(tx, { entidad: "recepcion", idEntidad: idRec, documentoNo: input.numeroFactura, tipoMovimiento: "creado", usuario: input.usuario, rol: input.rol, detalle: `Factura ${input.numeroFactura}` });
    await logMov(tx, { entidad: "orden", idEntidad: input.idOrdenCompra, documentoNo: ordenNo, tipoMovimiento: completa ? "recepcion_total" : "recepcion_parcial", estadoNuevo: completa ? "completado" : undefined, usuario: input.usuario, rol: input.rol, detalle: `Factura ${input.numeroFactura}` });
    await tx.commit();
    return idRec;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

// ----------------------------------------------------------------- listas extra
export async function listRecepciones(): Promise<Recepcion[]> {
  const pool = await getPool();
  const h = await pool.request().query("SELECT * FROM dbo.RecepcionCompra WHERE esEliminada = 0 ORDER BY idRecepcionCompra DESC");
  const d = await pool.request().query("SELECT * FROM dbo.RecepcionCompraDet ORDER BY idRecepcionCompraDet");
  return h.recordset.map((r): Recepcion => ({
    id: String(r.idRecepcionCompra), ordenId: String(r.idOrdenCompra), numeroFactura: r.numeroFactura ?? "",
    fechaFactura: (r.fechaFactura?.toISOString?.() ?? "").slice(0, 10),
    fechaRecepcion: (r.fechaRecepcion?.toISOString?.() ?? "").slice(0, 10),
    fechaRegistro: (r.fechaRegistro?.toISOString?.() ?? "").slice(0, 10),
    total: Number(r.total ?? 0), parcial: !!r.esParcial,
    lineas: d.recordset.filter((x) => x.idRecepcionCompra === r.idRecepcionCompra)
      .map((l): RecepcionLinea => ({
        ordenLineaId: String(l.idOrdenCompraDet),
        cantidadRecibida: Number(l.quantityRecibida ?? 0),
        precioFactura: l.precioFactura != null ? Number(l.precioFactura) : undefined,
      })),
  }));
}

export async function listMovimientosAll() {
  await ensureEstados();
  const pool = await getPool();
  const r = await pool.request().query("SELECT * FROM dbo.Movimiento ORDER BY fecha DESC, idMovimiento DESC");
  return r.recordset.map((m) => ({
    id: String(m.idMovimiento), entidad: m.entidad, idEntidad: String(m.idEntidad), documentoNo: m.documentoNo ?? "",
    tipoMovimiento: m.tipoMovimiento, estadoAnterior: codigoDeId(m.idEstadoAnterior), estadoNuevo: codigoDeId(m.idEstadoNuevo),
    detalle: m.detalle ?? undefined, usuario: m.usuario, rol: m.rol as Role, fecha: m.fecha?.toISOString?.() ?? "",
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
export type Plantilla = { id: number; nombre: string; creadoPor: string; idClasificacion: number | null; lineas: PlantillaLineaDB[]; fechaCreacion: string };

function parseLineas(json: string): PlantillaLineaDB[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export async function listPlantillas(): Promise<Plantilla[]> {
  const pool = await getPool();
  const r = await pool.request().query(
    "SELECT idPlantillaSolicitud, nombre, creadoPor, idClasificacion, lineasJson, fechaCreacion FROM dbo.PlantillaSolicitud WHERE esEliminada = 0 ORDER BY nombre"
  );
  return r.recordset.map((row) => ({
    id: row.idPlantillaSolicitud,
    nombre: row.nombre,
    creadoPor: row.creadoPor,
    idClasificacion: row.idClasificacion ?? null,
    lineas: parseLineas(row.lineasJson),
    fechaCreacion: row.fechaCreacion?.toISOString?.() ?? "",
  }));
}

export async function createPlantilla(input: { nombre: string; creadoPor: string; idClasificacion?: number | null; lineas: PlantillaLineaDB[] }): Promise<number> {
  const pool = await getPool();
  const lineasJson = JSON.stringify(input.lineas ?? []);
  const idClas = input.idClasificacion ?? null;
  // upsert por (nombre, creadoPor): si el mismo usuario reusa el nombre, se actualiza.
  const ex = await pool.request()
    .input("nombre", sql.NVarChar(100), input.nombre)
    .input("creadoPor", sql.NVarChar(100), input.creadoPor)
    .query("SELECT idPlantillaSolicitud FROM dbo.PlantillaSolicitud WHERE nombre=@nombre AND creadoPor=@creadoPor AND esEliminada=0");
  if (ex.recordset.length) {
    const id = ex.recordset[0].idPlantillaSolicitud as number;
    await pool.request()
      .input("id", sql.Int, id)
      .input("idClasificacion", sql.Int, idClas)
      .input("lineasJson", sql.NVarChar(sql.MAX), lineasJson)
      .input("modificadoPor", sql.NVarChar(100), input.creadoPor)
      .query("UPDATE dbo.PlantillaSolicitud SET idClasificacion=@idClasificacion, lineasJson=@lineasJson, fechaModificacion=SYSUTCDATETIME(), modificadoPor=@modificadoPor WHERE idPlantillaSolicitud=@id");
    return id;
  }
  const ins = await pool.request()
    .input("nombre", sql.NVarChar(100), input.nombre)
    .input("creadoPor", sql.NVarChar(100), input.creadoPor)
    .input("idClasificacion", sql.Int, idClas)
    .input("lineasJson", sql.NVarChar(sql.MAX), lineasJson)
    .query("INSERT dbo.PlantillaSolicitud (nombre, creadoPor, idClasificacion, lineasJson, esEliminada, fechaCreacion) OUTPUT INSERTED.idPlantillaSolicitud VALUES (@nombre,@creadoPor,@idClasificacion,@lineasJson,0,SYSUTCDATETIME())");
  return ins.recordset[0].idPlantillaSolicitud as number;
}

export async function updatePlantilla(id: number, input: { nombre: string; idClasificacion?: number | null; lineas: PlantillaLineaDB[]; usuario: string }): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input("id", sql.Int, id)
    .input("nombre", sql.NVarChar(100), input.nombre)
    .input("idClasificacion", sql.Int, input.idClasificacion ?? null)
    .input("lineasJson", sql.NVarChar(sql.MAX), JSON.stringify(input.lineas ?? []))
    .input("modificadoPor", sql.NVarChar(100), input.usuario || null)
    .query("UPDATE dbo.PlantillaSolicitud SET nombre=@nombre, idClasificacion=@idClasificacion, lineasJson=@lineasJson, fechaModificacion=SYSUTCDATETIME(), modificadoPor=@modificadoPor WHERE idPlantillaSolicitud=@id");
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
  const [e, p, s, c] = await Promise.all([
    pool.request().query("SELECT id, codigo, nombre FROM dbo.etapa WHERE activo = 1 ORDER BY codigo"),
    pool.request().query("SELECT id, codigo, nombre, etapa_id FROM dbo.partida WHERE activo = 1 ORDER BY codigo"),
    pool.request().query("SELECT id, codigo, nombre, partida_id FROM dbo.sub_partidas WHERE activo = 1 ORDER BY codigo"),
    pool.request().query("SELECT id, nombre, partida_id, sub_partida_id FROM dbo.clasificacion WHERE activo = 1 ORDER BY nombre"),
  ]);
  return {
    etapas: e.recordset.map((r) => ({ id: r.id, codigo: String(r.codigo ?? ""), nombre: r.nombre ?? "" })),
    partidas: p.recordset.map((r) => ({ id: r.id, codigo: String(r.codigo ?? ""), nombre: r.nombre ?? "", etapaId: r.etapa_id ?? null })),
    subpartidas: s.recordset.map((r) => ({ id: r.id, codigo: String(r.codigo ?? ""), nombre: r.nombre ?? "", partidaId: r.partida_id ?? null })),
    clasificaciones: c.recordset.map((r) => ({ id: r.id, nombre: r.nombre ?? "", partidaId: r.partida_id ?? null, subPartidaId: r.sub_partida_id ?? null })),
  };
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
