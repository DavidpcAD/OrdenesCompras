import type { Articulo, Almacen, Maquina, Obra, Orden, Pedido, Proveedor, Recepcion } from "./types";

export const proveedores: Proveedor[] = [
  { id: "p1", code: "PROV-001305", nombre: "PRECISE FORMS INC", paymentTermsCode: "CONTADO", paymentMethodCode: "TRANSFER", currencyCode: "USD", cedula: "3-012-882795" },
  { id: "p2", code: "PROV-001562", nombre: "TECNIBRE S.A.", paymentTermsCode: "CONTADO", paymentMethodCode: "TRANSFER", currencyCode: "", cedula: "3-101-552310" },
  { id: "p3", code: "PROV-000522", nombre: "FERRETERIA EPA S.A", paymentTermsCode: "30 DIAS", paymentMethodCode: "TRANSFER", currencyCode: "", cedula: "3-101-118401" },
  { id: "p4", code: "PROV-000001", nombre: "PLATINIUMS DE COSTA RICA S.R.L.", paymentTermsCode: "CONTADO", paymentMethodCode: "TRANSFER", currencyCode: "", cedula: "3-102-882795" },
  { id: "p5", code: "PROV-000007", nombre: "NVT CONSTRUCCION S.A.", paymentTermsCode: "CONTADO", paymentMethodCode: "TRANSFER", currencyCode: "", cedula: "3-101-445012" },
];

export const almacenes: Almacen[] = [
  { codigo: "ALM-GRAL", nombre: "Almacén General" },
  { codigo: "ALM-BAR", nombre: "Almacén Barani" },
  { codigo: "ALM-SSO", nombre: "Almacén Salud y Seguridad Ocupacional" },
  { codigo: "ALM-CENTRAL", nombre: "Almacén Central" },
  { codigo: "VN-M.28", nombre: "Bodega obra M.28" },
];

export const obras: Obra[] = [
  { id: "o1", codigo: "OBRA-001", nombre: "Torre Escazú — Fase 2" },
  { id: "o2", codigo: "OBRA-002", nombre: "Condominio Valle Ilios" },
  { id: "o3", codigo: "OBRA-003", nombre: "Bodegas Novarum" },
  { id: "o4", codigo: "OBRA-004", nombre: "Remodelación oficinas D17" },
];

export const maquinas: Maquina[] = [
  { id: "mq1", no: "MAQ-0012", nombre: "Excavadora CAT 320", placa: "EQ-1204" },
  { id: "mq2", no: "MAQ-0023", nombre: "Retroexcavadora JCB 3CX", placa: "EQ-2310" },
  { id: "mq3", no: "MAQ-0031", nombre: "Compactadora Bomag BW213", placa: "EQ-3105" },
  { id: "mq4", no: "MAQ-0044", nombre: "Generador Cummins 60kVA", placa: "EQ-4402" },
];

export const articulos: Articulo[] = [
  { id: "a1", code: "M16-0075", descripcion: "CASCO DE SEGURIDAD DELTA PLUS BLANCO", unidad: "UND", almacenDefault: "ALM-SSO", precioReferencia: 8500, tipo: "inventario" },
  { id: "a2", code: "M16-0133", descripcion: "ZAPATO SEGURIDAD BESTBOY TALLA 42", unidad: "PAR", almacenDefault: "ALM-SSO", precioReferencia: 24500, tipo: "inventario" },
  { id: "a3", code: "M16-0134", descripcion: "ZAPATO SEGURIDAD AGATE TALLA 40", unidad: "PAR", almacenDefault: "ALM-SSO", precioReferencia: 23900, tipo: "inventario" },
  { id: "a6", code: "M02-0210", descripcion: "VARILLA #4 GRADO 40 (6m)", unidad: "UND", almacenDefault: "ALM-CENTRAL", precioReferencia: 4200, tipo: "inventario" },
  { id: "a7", code: "M02-0044", descripcion: "CEMENTO GRIS 50KG", unidad: "SACO", almacenDefault: "ALM-CENTRAL", precioReferencia: 7800, tipo: "inventario" },
  { id: "a8", code: "M09-0301", descripcion: "TUBO PVC 4\" SDR 32.5 (6m)", unidad: "UND", almacenDefault: "ALM-CENTRAL", precioReferencia: 9600, tipo: "inventario" },
  { id: "a9", code: "M16-0210", descripcion: "GUANTE NITRILO TALLA L (caja 100)", unidad: "CAJA", almacenDefault: "ALM-SSO", precioReferencia: 18900, tipo: "inventario" },
  { id: "a10", code: "M01-0195", descripcion: "VARILLA LISA #7", unidad: "UND", almacenDefault: "ALM-GRAL", precioReferencia: 6870, tipo: "inventario" },
  // repuestos
  { id: "r1", code: "R20-0625", descripcion: "PIN REGULAR PARA FORMALETA", unidad: "UND", almacenDefault: "ALM-GRAL", precioReferencia: 920, tipo: "inventario" },
  { id: "r2", code: "R12-0044", descripcion: "FILTRO HIDRÁULICO CAT 320", unidad: "UND", almacenDefault: "ALM-GRAL", precioReferencia: 38500, tipo: "inventario" },
  { id: "r3", code: "R12-0090", descripcion: "JUEGO DIENTES DE CUCHARÓN", unidad: "JGO", almacenDefault: "ALM-GRAL", precioReferencia: 145000, tipo: "inventario" },
  { id: "s1", code: "S24-0015", descripcion: "SERVICIO INSTALACION", unidad: "UND", almacenDefault: "ALM-GRAL", precioReferencia: 35000, tipo: "servicio" },
];

export const pedidos: Pedido[] = [
  {
    id: "ped1", numero: "PED-000118", tipoSolicitud: "material",
    obraCodigo: "OBRA-001", obraNombre: "Torre Escazú — Fase 2",
    solicitante: "Laura Jiménez", fecha: "2026-06-08", estado: "aprobado", prioridad: "alta",
    notas: "Para entrega de bodega de obra.",
    lineas: [
      { id: "pl1", articuloId: "a6", descripcion: "VARILLA #4 GRADO 40 (6m)", cantidad: 200, unidad: "UND", almacen: "ALM-CENTRAL", cantidadOrdenada: 0 },
      { id: "pl2", articuloId: "a7", descripcion: "CEMENTO GRIS 50KG", cantidad: 150, unidad: "SACO", almacen: "ALM-CENTRAL", cantidadOrdenada: 0 },
      { id: "pl3", articuloId: "a8", descripcion: "TUBO PVC 4\" SDR 32.5 (6m)", cantidad: 40, unidad: "UND", almacen: "ALM-CENTRAL", cantidadOrdenada: 0 },
    ],
  },
  {
    id: "ped2", numero: "PED-000119", tipoSolicitud: "material",
    obraCodigo: "OBRA-003", obraNombre: "Bodegas Novarum",
    solicitante: "Laura Jiménez", fecha: "2026-06-09", estado: "aprobado", prioridad: "normal",
    lineas: [
      { id: "pl4", articuloId: "a1", descripcion: "CASCO DE SEGURIDAD DELTA PLUS BLANCO", cantidad: 30, unidad: "UND", almacen: "ALM-SSO", cantidadOrdenada: 0 },
      { id: "pl5", articuloId: "a2", descripcion: "ZAPATO SEGURIDAD BESTBOY TALLA 42", cantidad: 12, unidad: "PAR", almacen: "ALM-SSO", cantidadOrdenada: 0 },
      { id: "pl6", articuloId: "a9", descripcion: "GUANTE NITRILO TALLA L (caja 100)", cantidad: 10, unidad: "CAJA", almacen: "ALM-SSO", cantidadOrdenada: 0 },
    ],
  },
  {
    id: "ped3", numero: "PED-000120", tipoSolicitud: "repuesto",
    maquinaNo: "MAQ-0012", maquinaNombre: "Excavadora CAT 320",
    solicitante: "Laura Jiménez", fecha: "2026-06-10", estado: "aprobado", prioridad: "urgente",
    notas: "Máquina parada en obra, urge.",
    lineas: [
      { id: "pl7", articuloId: "r2", descripcion: "FILTRO HIDRÁULICO CAT 320", cantidad: 4, unidad: "UND", almacen: "ALM-GRAL", cantidadOrdenada: 0 },
      { id: "pl8", articuloId: "r3", descripcion: "JUEGO DIENTES DE CUCHARÓN", cantidad: 1, unidad: "JGO", almacen: "ALM-GRAL", cantidadOrdenada: 0 },
    ],
  },
];

// Orden ya lanzada con recepción parcial (para el flujo de bodega)
export const ordenes: Orden[] = [
  {
    id: "ord1", numero: "CP-000862", proveedorId: "p2", fecha: "2026-06-05",
    currencyCode: "", estado: "lanzado", versionesArchivadas: 2,
    lineas: [
      { id: "ol1", tipo: "articulo", articuloId: "a1", pedidoLineaId: "seed", pedidoNumero: "PED-000101",
        descripcion: "CASCO DE SEGURIDAD DELTA PLUS BLANCO", cantidad: 20, unidad: "UND", almacen: "ALM-SSO",
        precioUnitario: 8500, ivaPct: 13, cantidadRecibida: 20, cantidadFacturada: 20 },
      { id: "ol2", tipo: "articulo", articuloId: "a2", pedidoLineaId: "seed", pedidoNumero: "PED-000101",
        descripcion: "ZAPATO SEGURIDAD BESTBOY TALLA 42", cantidad: 24, unidad: "PAR", almacen: "ALM-SSO",
        precioUnitario: 24500, ivaPct: 13, cantidadRecibida: 12, cantidadFacturada: 12 },
      { id: "ol3", tipo: "articulo", articuloId: "a3", pedidoLineaId: "seed", pedidoNumero: "PED-000101",
        descripcion: "ZAPATO SEGURIDAD AGATE TALLA 40", cantidad: 10, unidad: "PAR", almacen: "ALM-SSO",
        precioUnitario: 23900, ivaPct: 13, cantidadRecibida: 0, cantidadFacturada: 0 },
      { id: "ol4", tipo: "cargo", descripcion: "FLETE / TRANSPORTE", cantidad: 1, unidad: "UND", almacen: "ALM-SSO",
        precioUnitario: 45000, ivaPct: 13, cantidadRecibida: 0, cantidadFacturada: 0 },
    ],
  },
];

export const recepciones: Recepcion[] = [
  {
    id: "rec1", ordenId: "ord1", numeroFactura: "F-0099281", fechaFactura: "2026-06-10",
    fechaRecepcion: "2026-06-10", fechaRegistro: "2026-06-10", total: 464000, parcial: true,
    lineas: [
      { ordenLineaId: "ol1", cantidadRecibida: 20 },
      { ordenLineaId: "ol2", cantidadRecibida: 12 },
    ],
  },
];
