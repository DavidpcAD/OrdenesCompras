// Ayuda contextual por pantalla. La topbar tiene un botón ⓘ que, según la ruta
// actual, muestra qué es la pantalla y para qué sirve. Un solo lugar para todo el
// texto de ayuda de la app (los 3 roles). Ver components/shell.tsx.

export type HelpEntry = {
  titulo: string;
  resumen: string;      // una línea
  detalle: string[];    // viñetas: para qué sirve / qué podés hacer / tips
};

// ─────────────────────────── Proveeduría (Angie) ───────────────────────────
const DASHBOARD: HelpEntry = {
  titulo: "Dashboard",
  resumen: "Resumen de lo pedido vs. lo entregado, por proveedor.",
  detalle: [
    "Vista general de Proveeduría: cuánto se pidió en total, cuánto ha entregado cada proveedor y cuánto queda pendiente.",
    "Las tarjetas de arriba (Pedido total, Entregado, % global, Pendiente) resumen todas tus órdenes.",
    "La tabla agrupa por proveedor; abrí una fila (chevron) para ver el detalle de sus líneas.",
    "Podés buscar, ordenar, cambiar a vista Grid, elegir columnas y guardar vistas; con Exportar bajás CSV o PDF.",
  ],
};
const SOLICITUDES: HelpEntry = {
  titulo: "Solicitudes de Ingeniería",
  resumen: "Pedidos de material que llegan de Ingeniería para convertir en órdenes.",
  detalle: [
    "Acá llegan las solicitudes de material que Ingeniería envía desde la app de Producción.",
    "Desde una solicitud armás la orden de compra al proveedor (botón para crear la orden).",
    "Los estados te dicen si la solicitud está pendiente, ya está en una orden o cerrada.",
    "Podés alternar la vista por documento o por línea con el toggle de arriba.",
  ],
};
const SOLICITUDES_LINEA: HelpEntry = {
  titulo: "Materiales solicitados (por línea)",
  resumen: "Las líneas de todas las solicitudes, para armar órdenes por artículo.",
  detalle: [
    "Es la misma información de Solicitudes pero desglosada línea por línea (artículo por artículo).",
    "Útil para juntar materiales de varias solicitudes en una sola orden a un proveedor.",
    "Filtrá y seleccioná las líneas que querés incluir en la orden.",
  ],
};
const SOLICITUD_DET: HelpEntry = {
  titulo: "Detalle de la solicitud",
  resumen: "Todo lo que pidió Ingeniería en esta solicitud.",
  detalle: [
    "Ves el encabezado (obra/destino, solicitante, fecha) y todas las líneas de material pedidas.",
    "Desde acá podés avanzar la solicitud a una orden de compra.",
  ],
};
const ORDENES: HelpEntry = {
  titulo: "Órdenes de compra",
  resumen: "Las órdenes enviadas a proveedores y su estado.",
  detalle: [
    "Lista de las órdenes que armaste. Quedan abiertas hasta recibir el 100% del material.",
    "Tocá un panel de arriba para filtrar por estado (abiertas, pendientes de aprobación, rechazadas, completadas).",
    "Clic en una orden para ver su detalle, estados y las facturas asociadas.",
    "Alterná ver por orden o por línea, y agrupá por proveedor.",
  ],
};
const ORDEN_DET: HelpEntry = {
  titulo: "Detalle de la orden",
  resumen: "Líneas, estado, historial y facturas de la orden.",
  detalle: [
    "Ves el proveedor, las líneas con cantidades y precios, el estado y el historial de movimientos.",
    "Según el estado podés editarla (si está Abierta), enviarla a aprobación, imprimirla o consultar sus recepciones.",
  ],
};
const ORDEN_EDITAR: HelpEntry = {
  titulo: "Editar orden",
  resumen: "Ajustar proveedor, almacén, líneas y precios.",
  detalle: [
    "Solo se puede editar mientras la orden esté Abierta (antes de enviarla a aprobación).",
    "Podés cambiar el proveedor y el almacén de recepción, agregar/quitar líneas y corregir cantidades y precios.",
    "El precio que dejes acá es el que viaja a Business Central como costo unitario de la línea.",
  ],
};
const ORDEN_IMPRIMIR: HelpEntry = {
  titulo: "Imprimir orden",
  resumen: "Versión imprimible / PDF de la orden de compra.",
  detalle: [
    "Muestra la orden en formato documento para imprimir o guardar como PDF.",
    "Siempre sale en claro (papel blanco, tinta negra), aunque tengas la app en modo oscuro.",
  ],
};
const NUEVA: HelpEntry = {
  titulo: "Armar orden de compra",
  resumen: "Revisá y ajustá lo que se va a enviar al proveedor.",
  detalle: [
    "Se arma tomando líneas de solicitudes de Ingeniería.",
    "Confirmá proveedor, moneda y almacén; ajustá cantidades y precios antes de enviar.",
    "Podés guardarla como Abierta (borrador) o enviarla a aprobación.",
  ],
};
const DIRECTA: HelpEntry = {
  titulo: "Nueva orden directa",
  resumen: "Compra que no viene de una solicitud de Ingeniería.",
  detalle: [
    "Para comprar material que no pasó por una solicitud: agregás los artículos del catálogo directamente.",
    "Elegí proveedor, moneda y almacén; buscá artículos y poné cantidad y precio.",
    "Podés sumar un cargo de flete/transporte que se reparte entre las líneas.",
  ],
};
const PEDIDAS: HelpEntry = {
  titulo: "Líneas pedidas",
  resumen: "Todos los materiales ya ordenados a proveedores.",
  detalle: [
    "Reporte de todas las líneas que ya se ordenaron, sin importar la orden.",
    "Filtrá por estado o por columna y exportá el detalle a PDF.",
  ],
};
const PEDIDO_DET: HelpEntry = {
  titulo: "Detalle del pedido",
  resumen: "El material pedido y su seguimiento.",
  detalle: ["Ves las líneas del pedido y el estado de cada una."],
};
const INVENTARIOS: HelpEntry = {
  titulo: "Inventarios",
  resumen: "Existencias por artículo y almacén (consulta a Business Central).",
  detalle: [
    "Consultá cuánto hay de cada artículo y en qué ubicación, leído en vivo de Business Central.",
    "Sirve para saber si hace falta comprar antes de armar una orden.",
    "Si BC no responde, la existencia aparece como “s/d”.",
  ],
};

// ─────────────────────────── Bodega (Pedro) ───────────────────────────
const ORDENES_POR_RECIBIR: HelpEntry = {
  titulo: "Órdenes por recibir",
  resumen: "Registrá la recepción y la factura cuando llega el material.",
  detalle: [
    "Lista de las órdenes lanzadas que esperan material en bodega. Soporta entregas parciales.",
    "Abrí una orden para registrar cuánto llegó de cada línea.",
    "Los paneles de arriba resumen: por recibir, con recepción parcial, completadas y total en sistema.",
  ],
};
const RECIBIR: HelpEntry = {
  titulo: "Recibir / registrar factura",
  resumen: "Anotá lo que llegó y registrá (o dejá en revisión) la factura.",
  detalle: [
    "Poné en “A recibir” la cantidad que llegó por línea (o usá “Recibir todo lo pendiente”).",
    "Dos formas de registrar: “Registrar factura” (todo bien) o “Recibir sin factura (a revisión)” cuando la factura tiene un problema y la revisa Contabilidad después.",
    "Si una línea llegó dañada, con menos cantidad o a otro precio, marcala con el ⚠ para generar una nota de crédito.",
    "Podés agregar un cargo de transporte de esa entrega; se reparte entre las líneas recibidas.",
    "Abajo ves el Subtotal, IVA y Total de la factura tal cual va a Business Central.",
  ],
};
const RECIBIDAS: HelpEntry = {
  titulo: "Recibidas",
  resumen: "Historial del material que ya recibiste en bodega.",
  detalle: [
    "Cada tarjeta es una recepción registrada; queda guardado quién la recibió.",
    "Tocá “Ver líneas” para ver el detalle tal cual viaja a BC: artículo, cantidad, precio unitario, IVA e importe, con el total.",
    "La etiqueta de la factura indica si está OK, si va a Nota de crédito o si quedó En revisión.",
  ],
};
const RECEPCION_DET: HelpEntry = {
  titulo: "Detalle de la recepción",
  resumen: "Las líneas recibidas en una factura puntual.",
  detalle: ["Ves qué artículos y cantidades entraron en esta factura/recepción específica."],
};
const ORDEN_VER: HelpEntry = {
  titulo: "Ver orden",
  resumen: "Consulta de la orden y sus recepciones.",
  detalle: ["Vista de solo lectura de la orden, sus líneas, estado y las facturas/recepciones asociadas."],
};

// ─────────────────────────── Contabilidad (Kathya) ───────────────────────────
const NOTAS_CREDITO: HelpEntry = {
  titulo: "Notas de crédito",
  resumen: "Líneas de facturas con problema para cobrar al proveedor.",
  detalle: [
    "Acá llegan las líneas que Bodega marcó al recibir por dañado, menos cantidad o precio distinto.",
    "Cada una indica el motivo, la cantidad y el monto; desde el encabezado podés abrir la orden.",
    "Gestionás la nota de crédito con el proveedor y la marcás como resuelta.",
  ],
};
const CARGO: HelpEntry = {
  titulo: "Cargo sobre factura recibida",
  resumen: "Registrar un cargo de tercero (p. ej. transporte) sobre algo ya recibido.",
  detalle: [
    "Se usa cuando un tercero factura aparte —por ejemplo el flete— de un material que ya se recibió.",
    "Se crea un pedido con solo la línea de cargo y se asigna a las líneas de la recepción ya registrada.",
    "Elegí el método de reparto del cargo entre las líneas (por importe, peso, volumen o partes iguales).",
  ],
};
const TODAS: HelpEntry = {
  titulo: "Todas las órdenes",
  resumen: "Consulta global de todas las órdenes y sus facturas.",
  detalle: [
    "Vista de contabilidad de todas las órdenes de la app.",
    "Tocá un panel para filtrar y clic en una orden para ver su detalle, estados y facturas asociadas.",
  ],
};
const ARCHIVO: HelpEntry = {
  titulo: "Archivo y recepciones",
  resumen: "Órdenes cerradas y facturas registradas.",
  detalle: [
    "Historial de órdenes recibidas al 100% y todas las facturas registradas.",
    "Sirve de consulta y respaldo; no se editan.",
  ],
};

// Compartidas / genéricas
const DEVOLUCIONES: HelpEntry = {
  titulo: "Devoluciones",
  resumen: "Material o líneas devueltas al proveedor.",
  detalle: [
    "Registro de lo que se devolvió al proveedor (material rechazado o sobrante).",
    "Queda para trazabilidad y para cruzar con notas de crédito.",
  ],
};
const GENERIC: HelpEntry = {
  titulo: "Compras Adelante",
  resumen: "Solicitud de material, órdenes de compra y recepción, integrado con Business Central.",
  detalle: [
    "Usá el menú de la izquierda para moverte entre las secciones de tu rol.",
    "Este botón (ⓘ) siempre te explica qué es la pantalla en la que estás.",
  ],
};

// Devuelve la ayuda de la ruta actual (de la más específica a la más general).
export function helpForPath(p: string): HelpEntry {
  // ---- Bodega ----
  if (p === "/facturacion") return ORDENES_POR_RECIBIR;
  if (p.startsWith("/facturacion/recibidas")) return RECIBIDAS;
  if (p.startsWith("/facturacion/archivo")) return ARCHIVO;
  if (p.startsWith("/facturacion/notas-credito")) return NOTAS_CREDITO;
  if (p.startsWith("/facturacion/cargo")) return CARGO;
  if (p.startsWith("/facturacion/todas")) return TODAS;
  if (p.startsWith("/facturacion/devoluciones")) return DEVOLUCIONES;
  if (p.startsWith("/facturacion/recepcion/")) return RECEPCION_DET;
  if (p.startsWith("/facturacion/ver/")) return ORDEN_VER;
  if (/^\/facturacion\/[^/]+$/.test(p)) return RECIBIR; // /facturacion/{id}
  // ---- Proveeduría ----
  if (p.startsWith("/proveeduria/dashboard")) return DASHBOARD;
  if (p.startsWith("/proveeduria/solicitudes/")) return SOLICITUD_DET;
  if (p.startsWith("/proveeduria/solicitudes")) return SOLICITUDES;
  if (p.endsWith("/editar")) return ORDEN_EDITAR;
  if (p.endsWith("/imprimir")) return ORDEN_IMPRIMIR;
  if (/^\/proveeduria\/ordenes\/[^/]+$/.test(p)) return ORDEN_DET;
  if (p.startsWith("/proveeduria/ordenes")) return ORDENES;
  if (p.startsWith("/proveeduria/nueva")) return NUEVA;
  if (p.startsWith("/proveeduria/directa")) return DIRECTA;
  if (p.startsWith("/proveeduria/pedidas")) return PEDIDAS;
  if (p.startsWith("/proveeduria/pedido/")) return PEDIDO_DET;
  if (p.startsWith("/proveeduria/devoluciones")) return DEVOLUCIONES;
  if (p.startsWith("/proveeduria/inventarios")) return INVENTARIOS;
  if (p === "/proveeduria") return SOLICITUDES_LINEA;
  return GENERIC;
}
