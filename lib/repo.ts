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
    lineas: lineas.map((l): PedidoLinea => ({
      id: String(l.idPedidoCompraDet), articuloId: l.itemNo ?? "", descripcion: l.descripcion ?? "",
      cantidad: Number(l.quantitySolicitado ?? 0), unidad: l.unitOfMeasureCode ?? "",
      almacen: l.locationCode ?? "", cantidadOrdenada: Number(l.quantityOrdenado ?? 0), notas: l.notaCreador ?? undefined,
    })),
  };
}

export interface NewPedidoDB {
  tipoSolicitud: string; obra?: string; obraNombre?: string; maquinaNo?: string;
  solicitante: string; prioridad: string; notas?: string; usuario: string; rol: Role;
  lineas: { itemNo: string; descripcion: string; cantidad: number; unidad: string; almacen: string }[];
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
      .input("creadoPor", sql.NVarChar(100), input.usuario)
      .query(`INSERT dbo.PedidoCompra (idEstado,pedidoNo,tipoSolicitud,obra,maquinaNo,proyecto,solicitante,prioridad,notaCreador,esEliminada,fechaCreacion,creadoPor)
              OUTPUT INSERTED.idPedidoCompra
              VALUES (@idEstado,@pedidoNo,@tipoSolicitud,@obra,@maquinaNo,@proyecto,@solicitante,@prioridad,@notaCreador,0,getdate(),@creadoPor)`);
    const idPedido = ins.recordset[0].idPedidoCompra as number;

    let line = 10000;
    for (const l of input.lineas) {
      await new sql.Request(tx)
        .input("idPedidoCompra", sql.Int, idPedido)
        .input("lineNum", sql.Int, line)
        .input("descripcion", sql.NVarChar(250), l.descripcion)
        .input("itemNo", sql.NVarChar(50), l.itemNo)
        .input("unitOfMeasureCode", sql.NVarChar(20), l.unidad)
        .input("locationCode", sql.NVarChar(20), l.almacen)
        .input("quantitySolicitado", sql.Decimal(18, 4), l.cantidad)
        .input("creadoPor", sql.NVarChar(100), input.usuario)
        .query(`INSERT dbo.PedidoCompraDet (idPedidoCompra,lineNum,descripcion,itemNo,unitOfMeasureCode,locationCode,quantitySolicitado,quantityOrdenado,fechaCreacion,creadoPor)
                VALUES (@idPedidoCompra,@lineNum,@descripcion,@itemNo,@unitOfMeasureCode,@locationCode,@quantitySolicitado,0,getdate(),@creadoPor)`);
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

export async function setOrdenEstado(id: number, estado: string, usuario: string, rol: Role) {
  const pool = await getPool();
  const prev = await pool.request().input("id", sql.Int, id).query("SELECT idEstado, ordenNo FROM dbo.OrdenCompra WHERE idOrdenCompra=@id");
  const idEstado = await idDeEstado(estado);
  await pool.request().input("id", sql.Int, id).input("e", sql.Int, idEstado).input("u", sql.NVarChar(100), usuario)
    .query("UPDATE dbo.OrdenCompra SET idEstado=@e, fechaModificacion=getdate(), modificadoPor=@u WHERE idOrdenCompra=@id");
  const tipo = estado === "pendiente_aprobacion" ? "enviado_aprobacion" : estado === "lanzado" ? "aprobado_lanzado" : estado === "abierto" ? "reabierto" : estado;
  const tx = new sql.Transaction(pool); await tx.begin();
  await logMov(tx, { entidad: "orden", idEntidad: id, documentoNo: prev.recordset[0]?.ordenNo ?? "", tipoMovimiento: tipo, estadoAnterior: codigoDeId(prev.recordset[0]?.idEstado), estadoNuevo: estado, usuario, rol });
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
      .map((l): RecepcionLinea => ({ ordenLineaId: String(l.idOrdenCompraDet), cantidadRecibida: Number(l.quantityRecibida ?? 0) })),
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
