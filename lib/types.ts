// ============================================================================
// Modelo de datos — App de solicitud de material a proveedores
//
// Flujo y personas reales:
//   1. INGENIERÍA  (Laura)  crea una SOLICITUD de material.
//        - tipo 'material'  → destino una OBRA
//        - tipo 'repuesto'  → destino una MÁQUINA
//        Pone ítems, almacén y cantidad. NO pone proveedor ni precio.
//   2. PROVEEDURÍA (Angie)  ve todos los materiales solicitados (de varios
//        pedidos) y selecciona líneas de DISTINTOS pedidos para armar UNA orden
//        que se envía al proveedor. Aquí elige proveedor, fechas, IVA, tipo.
//   3. BODEGA      (Kattya) recibe el material y registra la FACTURA, lo que
//        genera los movimientos contables y alimenta el inventario.
//
// Pedido ↔ Orden es N:M (el enlace vive a nivel de línea: OrdenLinea.pedidoLineaId).
// Una Orden tiene muchas Recepciones (entregas parciales).
// ============================================================================

// nota: la ruta interna 'facturacion' se muestra como "Bodega" (Kattya) en la UI
// Módulos con acceso a ESTA app. Ingeniería y Aprobación viven en la app de
// producción; acá solo Proveeduría (arma órdenes), Bodega (recibe) y
// Contabilidad (notas de crédito).
export type Role = "proveeduria" | "facturacion" | "contabilidad";

export type LineType = "articulo" | "cargo"; // 'cargo' = flete / cargo de producto
export type TipoSolicitud = "material" | "repuesto" | "stock"; // stock = compra para bodega/inventario

// ---- Catálogos (espejo de Business Central) ----
export interface Proveedor {
  id: string;
  code: string;        // PROV-001305
  nombre: string;
  paymentTermsCode?: string;   // CONTADO
  paymentMethodCode?: string;  // TRANSFER
  currencyCode?: string;       // "" = CRC
  cedula?: string;
}

export interface Articulo {
  id: string;
  code: string;        // M16-0075
  descripcion: string;
  unidad: string;      // UND, KG, M, ...
  almacenDefault: string;
  precioReferencia: number;
  tipo: "inventario" | "servicio"; // BC Item.Type
}

export interface Obra {
  id: string;
  codigo: string;      // OBRA-001
  nombre: string;
}

export interface Maquina {
  id: string;
  no: string;          // GomEqp Machine No.
  nombre: string;
  placa?: string;
}

export interface Almacen {
  codigo: string;      // ALM-GRAL
  nombre: string;
}

// ============================ PEDIDO (Ingeniería · Laura) ===================
export type PedidoEstado = "borrador" | "aprobado" | "en_orden" | "cerrado" | "devuelto";

// ============================ NOTIFICACIONES (in-app) =======================
export interface Notificacion {
  id: string;
  tipo: "pedido" | "orden" | "factura" | "devuelto";
  mensaje: string;
  fecha: string;       // ISO
  leida: boolean;
  rol?: string;        // a qué rol le interesa (opcional; puede referir a roles de la otra app)
  href?: string;       // a dónde llevar al hacer click
}

export interface PedidoLinea {
  id: string;
  articuloId: string;
  descripcion: string;
  cantidad: number;
  unidad: string;           // la de COMPRA de BC (EST), no la de inventario
  unidadBase?: string;      // la de inventario/consumo (GR), para la equivalencia
  factorCompra?: number;    // cuántas unidades base trae la de compra (255000)
  almacen: string;          // centro de costo / almacén: DÓNDE entra el material
  variantCode?: string;     // variante del item (si aplica)
  // Obra y tarea que puso QUIEN PIDE el material (Ingeniería), no Proveeduría.
  // Salen de `dbo.PedidoCompraDet.obra` / `.taskNo` / `.taskDescr`.
  //
  // OJO con la diferencia, que es la que decide si BC consume el material contra la
  // obra o lo mete al inventario: un pedido de material SIEMPRE dice para qué obra
  // es (`proyecto`), pero solo el de CONSUMO DIRECTO trae TAREA. Con tarea, la línea
  // de la orden lleva Job No. + Job Task No. y BC la consume contra el presupuesto;
  // sin tarea, el material es para stock y entra al almacén — ahí la obra es apenas
  // informativa y NO puede viajar como Job No. (BC rechaza una obra sin tarea).
  // Ver `esConsumoDirecto` en lib/helpers.ts.
  proyecto?: string;        // obra / Job No. de BC (informativa si no hay tarea)
  taskNo?: string;          // tarea de la obra (Job Task No.) — solo consumo directo
  taskDescr?: string;       // descripción de la tarea ("2.2 — Enchapes"), para mostrar
  cantidadOrdenada: number; // cuánto de esta línea ya pasó a una orden
  // Proveeduría devolvió ESTA línea al ingeniero (dbo.PedidoCompraDet.idEstado =
  // Devuelto). Queda bloqueada: no se puede ordenar ni volver a devolver, y su
  // pendiente cuenta como 0. Una línea que ya tiene orden de compra NO se devuelve.
  devuelta?: boolean;
  notas?: string;
}

// DEVOLUCIÓN de una solicitud (o de algunas de sus líneas) que hizo Proveeduría.
//
// No tiene columnas propias: se reconstruye del log `dbo.Movimiento`, donde queda el
// movimiento "devuelto" con su motivo, y la EDICIÓN posterior que hace el ingeniero
// desde la app de Producción (las dos apps escriben en la misma bitácora).
//
// Por qué importa: hasta ahora la única señal de que ya la habían corregido era que
// la solicitud DESAPARECÍA de la bandeja de Devoluciones. Nadie avisaba, y había que
// acordarse de que estaba devuelta para volver a mirarla.
export interface DevolucionSolicitud {
  fecha: string;             // ISO — la devolución más reciente
  motivo?: string;
  lineas?: string;           // qué se devolvió, tal como se llamaba entonces
  usuario?: string;          // quién la devolvió (Proveeduría)
  // Edición del ingeniero POSTERIOR a la devolución. `undefined` = todavía no la tocó.
  corregida?: { fecha: string; usuario?: string; rol?: string };
}

export interface Pedido {
  id: string;
  numero: string;            // PED-000123
  tipoSolicitud: TipoSolicitud;
  obraCodigo?: string;       // destino si material
  obraNombre?: string;
  maquinaNo?: string;        // destino si repuesto
  maquinaNombre?: string;
  solicitante: string;       // Laura
  loteRef?: string;          // lote/unidad de Planificación desde el que se armó (para enlazar)
  fecha: string;             // ISO
  estado: PedidoEstado;
  prioridad: "normal" | "alta" | "urgente";
  notas?: string;
  idClasificacion?: number | null; // clasificación WBS (para ligar la celda de la Matriz al pedido)
  // Devolución que le hizo Proveeduría, si hubo (sale de la bitácora, no de la tabla).
  devolucion?: DevolucionSolicitud;
  lineas: PedidoLinea[];
}

// ============================ ORDEN (Proveeduría · Angie) ===================
export type OrdenEstado =
  | "abierto"
  | "pendiente_aprobacion"
  | "rechazado"
  | "lanzado"
  | "completado";

export interface OrdenLinea {
  id: string;
  tipo: LineType;
  articuloId?: string;
  variantCode?: string;     // variante del item (obligatoria en BC para items con variantes)
  pedidoLineaId?: string;   // enlace N:M a la línea de pedido origen
  pedidoNumero?: string;
  descripcion: string;
  cantidad: number;
  unidad: string;           // la de COMPRA de BC (EST): es la que BC factura
  unidadBase?: string;      // la de inventario/consumo (GR), para la equivalencia
  factorCompra?: number;    // cuántas unidades base trae la de compra (255000)
  almacen: string;
  precioUnitario: number;   // por `unidad`, en la moneda de la orden
  ivaPct: number;
  chargeNo?: string;         // N.º de Cargo de producto (Item Charge BC) — solo líneas tipo "cargo"
  chargeMethod?: string;     // método de asignación del cargo: Amount|Weight|Volume|Equally (default Amount)
  descuentoPct?: number;     // descuento de línea
  proyecto?: string;         // obra / Job No.
  taskNo?: string;           // N.º tarea proyecto
  cantidadRecibida: number;
  cantidadFacturada: number;
}

export interface Orden {
  id: string;
  numero: string;           // CP-000862
  proveedorId: string;
  proveedorNo?: string;     // código BC del proveedor (PROV-…) para crear el pedido en BC al aprobar
  proveedorNombre?: string;
  almacenRecepcion?: string; // almacén/ubicación de recepción en BC (default ALM-GRAL)
  fecha: string;            // ISO emisión
  fechaRecepEsperada?: string;
  currencyCode: string;     // "" = CRC, "USD"
  estado: OrdenEstado;
  versionesArchivadas: number;
  lineas: OrdenLinea[];
  creadoPor?: string;       // quién generó la orden (para los reportes y la trazabilidad)
  bcNumber?: string;        // Nº del Pedido de compra en Business Central (CP-…)
  bcDeepLink?: string;      // link directo al Pedido en BC (editar / registrar / vista previa)
  notas?: string;           // motivo de la última devolución/denegación (Aprobación → Proveeduría)
  // Observaciones que escribe Proveeduría al armar la orden: instrucciones para el
  // proveedor (horario de entrega, contacto, referencia de cotización…). SALEN EN EL
  // PDF que se le manda, al final. En SQL viven en OrdenCompra.notaCreador.
  observaciones?: string;    // para el PROVEEDOR: se imprimen en el PDF de la orden
  notaInterna?: string;      // para el APROBADOR: interna, NO sale en el PDF
  motivoRechazo?: string;   // motivo del rechazo (Aprobación); también queda en el histórico
}

// ============================ RECEPCIÓN / FACTURA (Bodega · Kattya) =========
export interface RecepcionLinea {
  ordenLineaId: string;
  cantidadRecibida: number;
  precioFactura?: number;   // precio facturado de la línea (puede diferir del de la orden)
}

// Foto de la factura del proveedor (la que Bodega saca con el celular al recibir).
// Se guarda comprimida en la BD (dbo.RecepcionCompraFoto); acá viaja solo el
// METADATO — la imagen se pide aparte a /api/recepciones/{id}/foto?foto={id}
// para que el bootstrap no arrastre megas en cada refresco.
export interface RecepcionFoto {
  id: string;
  mime: string;
  tamano?: number;          // bytes ya comprimidos
  ancho?: number;
  alto?: number;
  // Solo en modo demo (sin API): la imagen vive en memoria como dataURL.
  url?: string;
}

export interface Recepcion {
  id: string;
  ordenId: string;
  numeroFactura: string;
  fechaFactura: string;
  fechaRecepcion: string;
  fechaRegistro: string;
  total: number;
  lineas: RecepcionLinea[];
  parcial: boolean;
  // Quién recibió/registró la recepción (hay varios en bodega). Es creadoPor en BD.
  recibidoPor?: string;
  // MODO 2: material recibido pero la factura quedó EN REVISIÓN (aún sin registrar).
  // Se deriva de numeroFactura vacío; Kattya la registra después (bcFacturarRecibido).
  facturaEnRevision?: boolean;
  // N.º de la factura que quedó REGISTRADA EN BC (lo devuelve BC al registrar).
  // No es el numeroFactura del proveedor: es el documento de allá, el que sirve
  // para encontrar el movimiento en Business Central. Puede no estar: recepciones
  // viejas, órdenes que no van a BC, o la columna sin migrar (sql/recepcion_bc_factura.sql).
  bcFacturaNo?: string;
  // Fotos de la factura física (0..n). Metadato solamente: ver RecepcionFoto.
  fotos?: RecepcionFoto[];
}

// ============================ NOTAS DE CRÉDITO (Bodega · Kattya) ============
// Líneas de una factura recibida que vienen MAL (dañado / menos cantidad / precio
// distinto). El material se recibe igual, pero esas líneas se marcan para emitir
// una NOTA DE CRÉDITO. Es DISTINTO de Devoluciones (que devuelve toda la OC/pedido).
// material_distinto = llegó OTRO artículo (no el que pide la orden).
export type MotivoNC = "danado" | "menos_cantidad" | "precio_distinto" | "material_distinto";
export interface NotaCreditoLinea {
  id: string;
  ordenId: string;
  ordenNumero: string;
  proveedor?: string;
  ordenLineaId?: string;
  articuloNo?: string;
  descripcion: string;
  motivo: MotivoNC;
  cantidad: number;
  precioUnitario?: number;
  nota?: string;
  fecha: string;                 // ISO
  estado: "pendiente" | "resuelta";
  bcUrl?: string;                // deep link al Pedido de compra en Business Central
  bcFacturaUrl?: string;         // deep link a las Facturas de compra registradas en BC
}

// ============================ BITÁCORA / MOVIMIENTOS ========================
export interface Movimiento {
  id: string;
  entidad: "pedido" | "orden" | "recepcion";
  idEntidad: string;
  documentoNo: string;
  tipoMovimiento: string;       // creado, enviado_aprobacion, aprobado, rechazado, recepcion_parcial…
  estadoAnterior?: string;
  estadoNuevo?: string;
  detalle?: string;
  usuario: string;
  rol: string;                  // actor del historial; puede ser un rol que ya no vive en esta app (ej. "aprobacion")
  fecha: string;                // ISO datetime
}
