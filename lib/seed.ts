import type { Articulo, Orden, Pedido, Proveedor, Recepcion } from "./types";

export const proveedores: Proveedor[] = [
  { id: "p1", code: "PROV-001305", nombre: "PRECISE FORMS INC", contacto: "ventas@preciseforms.com" },
  { id: "p2", code: "PROV-001562", nombre: "TECNIBRE S.A.", contacto: "compras@tecnibre.cr" },
  { id: "p3", code: "PROV-000522", nombre: "FERRETERIA EPA S.A", contacto: "info@epa.cr" },
  { id: "p4", code: "PROV-001514", nombre: "SOLUCIONES INTEGRALES DE IMPORTACIÓN", contacto: "info@sii.cr" },
  { id: "p5", code: "PROV-000490", nombre: "EUROMATERIALES EQUIPO Y MAQ.", contacto: "ventas@euromateriales.cr" },
  { id: "p6", code: "PROV-000007", nombre: "NVT CONSTRUCCION S.A.", contacto: "compras@nvt.cr" },
];

export const articulos: Articulo[] = [
  { id: "a1", code: "M16-0075", descripcion: "CASCO DE SEGURIDAD DELTA PLUS BLANCO", unidad: "UND", almacenDefault: "ALM-SSO", precioReferencia: 8500 },
  { id: "a2", code: "M16-0133", descripcion: "ZAPATO SEGURIDAD BESTBOY TALLA 42", unidad: "PAR", almacenDefault: "ALM-SSO", precioReferencia: 24500 },
  { id: "a3", code: "M16-0134", descripcion: "ZAPATO SEGURIDAD AGATE TALLA 40", unidad: "PAR", almacenDefault: "ALM-SSO", precioReferencia: 23900 },
  { id: "a4", code: "M13-0044", descripcion: "CALENTADOR INSTANTANEO KRONOS D17", unidad: "UND", almacenDefault: "VN-D.17", precioReferencia: 145000 },
  { id: "a5", code: "S24-0015", descripcion: "SERVICIO INSTALACION CALENTADOR", unidad: "UND", almacenDefault: "VN-D.17", precioReferencia: 35000 },
  { id: "a6", code: "M02-0210", descripcion: "VARILLA #4 GRADO 40 (6m)", unidad: "UND", almacenDefault: "ALM-CENTRAL", precioReferencia: 4200 },
  { id: "a7", code: "M02-0044", descripcion: "CEMENTO GRIS 50KG", unidad: "SACO", almacenDefault: "ALM-CENTRAL", precioReferencia: 7800 },
  { id: "a8", code: "M09-0301", descripcion: "TUBO PVC 4\" SDR 32.5 (6m)", unidad: "UND", almacenDefault: "ALM-CENTRAL", precioReferencia: 9600 },
  { id: "a9", code: "M16-0210", descripcion: "GUANTE NITRILO TALLA L (caja 100)", unidad: "CAJA", almacenDefault: "ALM-SSO", precioReferencia: 18900 },
];

export const pedidos: Pedido[] = [
  {
    id: "ped1", numero: "PED-000118", proyecto: "Torre Escazú — Fase 2", solicitante: "Ing. Fernando Mora",
    fecha: "2026-06-08", estado: "aprobado", prioridad: "alta", notas: "Para entrega de bodega de obra.",
    lineas: [
      { id: "pl1", articuloId: "a6", descripcion: "VARILLA #4 GRADO 40 (6m)", cantidad: 200, unidad: "UND", almacen: "ALM-CENTRAL", cantidadOrdenada: 0 },
      { id: "pl2", articuloId: "a7", descripcion: "CEMENTO GRIS 50KG", cantidad: 150, unidad: "SACO", almacen: "ALM-CENTRAL", cantidadOrdenada: 0 },
      { id: "pl3", articuloId: "a8", descripcion: "TUBO PVC 4\" SDR 32.5 (6m)", cantidad: 40, unidad: "UND", almacen: "ALM-CENTRAL", cantidadOrdenada: 0 },
    ],
  },
  {
    id: "ped2", numero: "PED-000119", proyecto: "Bodega SSO — Reposición", solicitante: "Laura Jiménez",
    fecha: "2026-06-09", estado: "aprobado", prioridad: "normal",
    lineas: [
      { id: "pl4", articuloId: "a1", descripcion: "CASCO DE SEGURIDAD DELTA PLUS BLANCO", cantidad: 30, unidad: "UND", almacen: "ALM-SSO", cantidadOrdenada: 0 },
      { id: "pl5", articuloId: "a2", descripcion: "ZAPATO SEGURIDAD BESTBOY TALLA 42", cantidad: 12, unidad: "PAR", almacen: "ALM-SSO", cantidadOrdenada: 0 },
      { id: "pl6", articuloId: "a9", descripcion: "GUANTE NITRILO TALLA L (caja 100)", cantidad: 10, unidad: "CAJA", almacen: "ALM-SSO", cantidadOrdenada: 0 },
    ],
  },
  {
    id: "ped3", numero: "PED-000120", proyecto: "Remodelación oficinas D17", solicitante: "Ing. Víctor Tames",
    fecha: "2026-06-10", estado: "borrador", prioridad: "normal",
    lineas: [
      { id: "pl7", articuloId: "a4", descripcion: "CALENTADOR INSTANTANEO KRONOS D17", cantidad: 4, unidad: "UND", almacen: "VN-D.17", cantidadOrdenada: 0 },
      { id: "pl8", articuloId: "a5", descripcion: "SERVICIO INSTALACION CALENTADOR", cantidad: 4, unidad: "UND", almacen: "VN-D.17", cantidadOrdenada: 0 },
    ],
  },
];

// Orden ya lanzada con recepción parcial, para demostrar el flujo de facturación
export const ordenes: Orden[] = [
  {
    id: "ord1", numero: "CP-000862", proveedorId: "p2", fecha: "2026-06-05",
    estado: "lanzado", versionesArchivadas: 2,
    lineas: [
      { id: "ol1", tipo: "articulo", articuloId: "a1", pedidoLineaId: "seed", pedidoNumero: "PED-000101",
        descripcion: "CASCO DE SEGURIDAD DELTA PLUS BLANCO", cantidad: 20, unidad: "UND", almacen: "ALM-SSO",
        precioUnitario: 8500, cantidadRecibida: 20, cantidadFacturada: 20 },
      { id: "ol2", tipo: "articulo", articuloId: "a2", pedidoLineaId: "seed", pedidoNumero: "PED-000101",
        descripcion: "ZAPATO SEGURIDAD BESTBOY TALLA 42", cantidad: 24, unidad: "PAR", almacen: "ALM-SSO",
        precioUnitario: 24500, cantidadRecibida: 12, cantidadFacturada: 12 },
      { id: "ol3", tipo: "articulo", articuloId: "a3", pedidoLineaId: "seed", pedidoNumero: "PED-000101",
        descripcion: "ZAPATO SEGURIDAD AGATE TALLA 40", cantidad: 10, unidad: "PAR", almacen: "ALM-SSO",
        precioUnitario: 23900, cantidadRecibida: 0, cantidadFacturada: 0 },
      { id: "ol4", tipo: "cargo", descripcion: "FLETE / TRANSPORTE", cantidad: 1, unidad: "UND", almacen: "ALM-SSO",
        precioUnitario: 45000, cantidadRecibida: 0, cantidadFacturada: 0 },
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
