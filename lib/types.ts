// ============================================================================
// Modelo de datos — App de solicitud de material a proveedores
//
// Flujo (terminología de Adelante, no la de Business Central):
//   1. INGENIERÍA   crea un PEDIDO de compra (solicitud de material).
//   2. PROVEEDURÍA  toma líneas de pedidos y genera una ORDEN de compra
//                   que se envía al proveedor (asigna proveedor, precio, flete).
//   3. FACTURACIÓN  registra la RECEPCIÓN/FACTURA cuando el material llega a
//                   bodega. Soporta entregas parciales: la orden queda ABIERTA
//                   hasta que todas las líneas se reciben al 100%.
//
// Estos tipos están pensados para reflejarse 1:1 en SQL y mapearse a las
// entidades de Business Central (Purchase Header / Purchase Line).
// ============================================================================

export type Role = "ingenieria" | "proveeduria" | "facturacion";

export type LineType = "articulo" | "cargo"; // 'cargo' = flete / cargo de producto

// ---- Catálogos ----
export interface Proveedor {
  id: string;
  code: string;        // PROV-001305
  nombre: string;
  contacto?: string;
}

export interface Articulo {
  id: string;
  code: string;        // M16-0075
  descripcion: string;
  unidad: string;      // UND, KG, M, ...
  almacenDefault: string; // ALM-SSO
  precioReferencia: number;
}

// ============================ PEDIDO (Ingeniería) ===========================
export type PedidoEstado = "borrador" | "aprobado" | "en_orden" | "cerrado";

export interface PedidoLinea {
  id: string;
  articuloId: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  almacen: string;
  cantidadOrdenada: number; // cuánto de esta línea ya pasó a una orden de compra
  notas?: string;
}

export interface Pedido {
  id: string;
  numero: string;       // PED-000123
  proyecto: string;
  solicitante: string;
  fecha: string;        // ISO
  estado: PedidoEstado;
  prioridad: "normal" | "alta" | "urgente";
  notas?: string;
  lineas: PedidoLinea[];
}

// ============================ ORDEN (Proveeduría) ===========================
export type OrdenEstado =
  | "abierto"               // creada, aún editable
  | "pendiente_aprobacion"  // enviada a aprobación
  | "lanzado"               // aprobada / enviada al proveedor
  | "completado";           // recibida al 100% (se archiva)

export interface OrdenLinea {
  id: string;
  tipo: LineType;
  articuloId?: string;
  pedidoLineaId?: string;   // trazabilidad al pedido origen
  pedidoNumero?: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  almacen: string;
  precioUnitario: number;
  cantidadRecibida: number; // acumulado recibido por recepciones
  cantidadFacturada: number;
}

export interface Orden {
  id: string;
  numero: string;           // CP-000862
  proveedorId: string;
  fecha: string;            // ISO — fecha de emisión
  estado: OrdenEstado;
  versionesArchivadas: number;
  lineas: OrdenLinea[];
}

// ============================ RECEPCIÓN / FACTURA ===========================
export interface RecepcionLinea {
  ordenLineaId: string;
  cantidadRecibida: number; // cantidad que llegó en esta entrega
}

export interface Recepcion {
  id: string;
  ordenId: string;
  numeroFactura: string;
  fechaFactura: string;     // ISO — fecha del documento del proveedor
  fechaRecepcion: string;   // ISO — fecha en que llegó a bodega
  fechaRegistro: string;    // ISO — fecha contable (la que "vale" al buscar)
  total: number;
  lineas: RecepcionLinea[];
  parcial: boolean;
}
