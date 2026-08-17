// Ayuda contextual por pantalla. La topbar tiene un botón ⓘ que, según la ruta
// actual, muestra qué es la pantalla, para qué sirve y un PASO A PASO para usarla.
// Un solo lugar para todo el texto de ayuda de la app (los 3 roles).
// Ver components/shell.tsx.

export type HelpEntry = {
  titulo: string;
  resumen: string;      // una línea
  detalle: string[];    // "Para qué sirve" — viñetas
  pasos?: string[];     // "Paso a paso" — instrucciones numeradas
  tips?: string[];      // consejos / atajos (opcional)
};

// ─────────────────────────── Proveeduría (Angie) ───────────────────────────
const DASHBOARD: HelpEntry = {
  titulo: "Dashboard",
  resumen: "Resumen de lo pedido vs. lo entregado, por proveedor.",
  detalle: [
    "Vista general de Proveeduría: cuánto se pidió en total, cuánto ha entregado cada proveedor y cuánto queda pendiente.",
    "Las tarjetas de arriba (Pedido total, Entregado, % global, Pendiente) resumen todas tus órdenes.",
    "La tabla agrupa por proveedor: una fila por proveedor con sus totales.",
  ],
  pasos: [
    "Mirá las 4 tarjetas de arriba para el panorama general del período.",
    "Escribí en “Buscar proveedor…” para encontrar uno por nombre.",
    "Tocá el chevron (v) al inicio de una fila para desplegar las líneas de ese proveedor.",
    "Ordená tocando el encabezado de una columna (▲▼); filtrá con el embudo de “Proveedor”.",
    "Cambiá entre “Tabla” y “Grid”, y con “Columnas” elegí qué datos mostrar.",
    "Con “Vistas” guardás la configuración actual (filtros/orden/columnas) para reusarla; con “Exportar” bajás CSV o PDF.",
  ],
  tips: ["El % de entregado se colorea: verde = al día, amarillo = parcial, rojo = sin entregar."],
};
const SOLICITUDES: HelpEntry = {
  titulo: "Solicitudes de Ingeniería",
  resumen: "Pedidos de material que llegan de Ingeniería para convertir en órdenes.",
  detalle: [
    "Acá llegan las solicitudes de material que Ingeniería envía desde la app de Producción.",
    "Cada solicitud tiene un destino/obra, un solicitante y sus líneas de material.",
    "El estado indica si está pendiente, ya está en una orden o cerrada.",
  ],
  pasos: [
    "Revisá la lista de solicitudes; usá el buscador o los filtros para acotar.",
    "Abrí una solicitud (clic) para ver sus líneas y a qué obra van.",
    "Elegí la(s) solicitud(es) o línea(s) que vas a comprar.",
    "Tocá el botón para armar la orden de compra con lo seleccionado.",
    "Alterná “por documento” / “por línea” con el toggle si querés juntar materiales de varias solicitudes.",
  ],
  tips: ["Las líneas en borrador (sin enviar) se resaltan en amarillo para que no se te pasen."],
};
const SOLICITUDES_LINEA: HelpEntry = {
  titulo: "Materiales solicitados (por línea)",
  resumen: "Las líneas de todas las solicitudes, para armar órdenes por artículo.",
  detalle: [
    "Es la misma información de Solicitudes pero desglosada artículo por artículo.",
    "Útil para juntar materiales de varias solicitudes en una sola orden a un proveedor.",
  ],
  pasos: [
    "Filtrá por estado o por columna para encontrar los materiales que querés comprar.",
    "Seleccioná las líneas a incluir en la orden.",
    "Armá la orden con lo seleccionado y elegí el proveedor.",
  ],
};
const SOLICITUD_DET: HelpEntry = {
  titulo: "Detalle de la solicitud",
  resumen: "Todo lo que pidió Ingeniería en esta solicitud.",
  detalle: [
    "Ves el encabezado (obra/destino, solicitante, fecha) y todas las líneas pedidas.",
  ],
  pasos: [
    "Revisá las líneas y cantidades solicitadas.",
    "Si vas a comprar, avanzá la solicitud a una orden de compra desde acá.",
  ],
};
const ORDENES: HelpEntry = {
  titulo: "Órdenes de compra",
  resumen: "Las órdenes enviadas a proveedores y su estado.",
  detalle: [
    "Lista de las órdenes que armaste. Quedan abiertas hasta recibir el 100% del material.",
    "Los paneles de arriba cuentan las órdenes por estado.",
  ],
  pasos: [
    "Tocá un panel de arriba para filtrar por estado (abiertas, pendientes de aprobación, rechazadas, completadas).",
    "Buscá por N.º de orden o proveedor.",
    "Clic en una orden para ver su detalle, estados e historial y las facturas asociadas.",
    "Desde el detalle podés editar (si está Abierta), enviar a aprobación, imprimir o revisar recepciones.",
    "Con el toggle ves por orden o por línea, y podés agrupar por proveedor.",
  ],
};
const ORDEN_DET: HelpEntry = {
  titulo: "Detalle de la orden",
  resumen: "Líneas, estado, historial y facturas de la orden.",
  detalle: [
    "Ves el proveedor, las líneas con cantidades y precios, el estado y el historial de movimientos.",
  ],
  pasos: [
    "Revisá las líneas y el estado actual (arriba).",
    "Si está Abierta, usá “Editar” para ajustarla, o enviala a aprobación.",
    "Si Aprobación la rechazó, el aviso rojo de arriba dice el motivo: corregí eso, guardá y reenviala.",
    "Si ya está lanzada/recibida, consultá sus recepciones y facturas asociadas.",
    "Con “Imprimir” generás el PDF de la orden (se habilita cuando ya está aprobada).",
  ],
};
const ORDEN_EDITAR: HelpEntry = {
  titulo: "Editar orden",
  resumen: "Ajustar proveedor, almacén, líneas y precios.",
  detalle: [
    "Solo se puede editar mientras la orden esté Abierta o Rechazada (una vez enviada a aprobación, no).",
    "El precio que dejes acá es el que viaja a Business Central como costo unitario de la línea.",
  ],
  pasos: [
    "Cambiá el proveedor y/o el almacén de recepción si hace falta.",
    "Agregá o quitá líneas y corregí cantidades y precios.",
    "Revisá el total; guardá los cambios.",
    "Cuando esté lista, enviala a aprobación.",
  ],
};
const ORDEN_IMPRIMIR: HelpEntry = {
  titulo: "Imprimir orden",
  resumen: "Versión imprimible / PDF de la orden de compra.",
  detalle: ["Muestra la orden en formato documento para imprimir o guardar como PDF."],
  pasos: [
    "Revisá que los datos del documento sean correctos.",
    "Usá el botón de imprimir (o Ctrl/Cmd+P) y elegí impresora o “Guardar como PDF”.",
  ],
  tips: ["Siempre sale en claro (papel blanco, tinta negra), aunque tengas la app en modo oscuro."],
};
const NUEVA: HelpEntry = {
  titulo: "Armar orden de compra",
  resumen: "Revisá y ajustá lo que se va a enviar al proveedor.",
  detalle: [
    "Se arma tomando líneas de solicitudes de Ingeniería.",
    "El precio que pongas es el costo unitario que se manda a Business Central.",
  ],
  pasos: [
    "Confirmá el proveedor (hereda términos y moneda), la moneda y el almacén de recepción.",
    "Revisá las líneas que traés de la solicitud; ajustá las cantidades.",
    "Corregí los precios unitarios si difieren de lo cotizado.",
    "(Opcional) agregá un cargo de flete/transporte que se reparte entre las líneas.",
    "Guardá como “Abierta” (borrador) o “Enviar a aprobación”.",
  ],
};
const DIRECTA: HelpEntry = {
  titulo: "Nueva orden directa",
  resumen: "Compra que no viene de una solicitud de Ingeniería.",
  detalle: [
    "Para comprar material que no pasó por una solicitud: agregás los artículos del catálogo directamente.",
  ],
  pasos: [
    "Elegí el proveedor (hereda términos y moneda), la moneda y el almacén de recepción.",
    "Buscá un artículo del catálogo, poné la cantidad y el precio, y tocá “+ Agregar línea”.",
    "Repetí para cada material que necesites.",
    "(Opcional) activá el cargo de flete/transporte.",
    "Revisá Subtotal / IVA / Total y guardá como abierta o enviá a aprobación.",
  ],
};
const PEDIDAS: HelpEntry = {
  titulo: "Líneas pedidas",
  resumen: "Todos los materiales ya ordenados a proveedores.",
  detalle: ["Reporte de todas las líneas ya ordenadas, sin importar la orden."],
  pasos: [
    "Filtrá por estado o por columna para encontrar lo que buscás.",
    "Ordená por la columna que necesites.",
    "Exportá el detalle a PDF con el botón de exportar.",
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
  ],
  pasos: [
    "Buscá el artículo por nombre o código.",
    "Mirá la existencia por ubicación/almacén.",
    "Si aparece “s/d”, Business Central no respondió en ese momento — reintentá.",
  ],
};

// ─────────────────────────── Bodega (Pedro) ───────────────────────────
const ORDENES_POR_RECIBIR: HelpEntry = {
  titulo: "Órdenes por recibir",
  resumen: "Registrá la recepción y la factura cuando llega el material.",
  detalle: [
    "Lista de las órdenes lanzadas que esperan material en bodega. Soporta entregas parciales.",
    "Los paneles resumen: por recibir, con recepción parcial, completadas y total en sistema.",
  ],
  pasos: [
    "Buscá la orden del material que llegó (por N.º o proveedor).",
    "Tocá “Registrar factura” en esa orden para abrir la recepción.",
    "Registrá lo que llegó (ver la ayuda de esa pantalla).",
  ],
  tips: ["El anillo de % muestra cuánto de la orden ya se recibió."],
};
const RECIBIR: HelpEntry = {
  titulo: "Recibir / registrar factura",
  resumen: "Anotá lo que llegó y registrá (o dejá en revisión) la factura.",
  detalle: [
    "Acá confirmás cuánto material entró a bodega y registrás la factura del proveedor.",
    "Abajo ves el Subtotal, IVA y Total de la factura tal cual va a Business Central.",
  ],
  pasos: [
    "Contá el material y anotá la cantidad que entró en cada línea (en el celular, el campo de cada tarjeta; en la computadora, la columna “A recibir”). Si llegó todo, usá “Recibir todo”.",
    "Si una línea llegó dañada, con menos cantidad o a otro precio, marcala para nota de crédito (en el celular por el menú ⋮ de la tarjeta; en la computadora por el ⚠ de la fila) y elegí el motivo: eso le queda a Contabilidad.",
    "Si la factura trae un flete o cargo extra, marcá “Esta factura trae un cargo de producto adicional” y describilo: le avisamos a Contabilidad para que lo agregue. Vos recibís y registrás igual.",
    "Revisá el Subtotal / IVA / Total de abajo.",
    "Si la factura está bien → “Registrar factura” y escribí el N.º de factura del proveedor.",
    "Si el material está bien pero la factura tiene un problema → “Recibir sin factura (a revisión)”: Contabilidad la registra después.",
  ],
  tips: [
    "Podés recibir parcial: registrás lo que llegó y la orden queda abierta para el resto.",
    "Usá “Vista previa” para revisar antes de registrar en BC (en la computadora).",
  ],
};
const RECIBIDAS: HelpEntry = {
  titulo: "Recibidas",
  resumen: "Historial del material que ya recibiste en bodega.",
  detalle: [
    "Cada tarjeta es una recepción registrada; queda guardado quién la recibió.",
    "La etiqueta de la factura indica si está OK, si va a Nota de crédito o si quedó En revisión.",
  ],
  pasos: [
    "Mirá la tarjeta: N.º de orden, proveedor, fecha, quién recibió, total y estado.",
    "Tocá “Ver líneas” para el detalle tal cual viaja a BC: artículo, cantidad, precio unitario, IVA e importe.",
    "Al final de las líneas ves el Subtotal, IVA y Total de la factura.",
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
    "Cada una indica el motivo, la cantidad y el monto.",
  ],
  pasos: [
    "En “Por acreditar” revisá las líneas y su motivo.",
    "Usá “Factura registrada” para abrir en Business Central la factura sobre la que hay que hacer la nota de crédito (si hubo entregas parciales, también aparece “Orden de compra”).",
    "Emitíla en BC y gestionala con el proveedor.",
    "Cuando ya esté emitida, tocá “Marcar acreditada”: la línea sale de pendientes y queda archivada en la pestaña “Acreditadas”.",
  ],
  tips: [
    "Si marcaste una por error, entrá a “Acreditadas” y tocá “Reabrir”.",
    "Quién acreditó cada línea y cuándo queda en el historial de la orden.",
  ],
};
const CARGO: HelpEntry = {
  titulo: "Cargo sobre factura recibida",
  resumen: "Registrar un cargo de tercero (p. ej. transporte) sobre algo ya recibido.",
  detalle: [
    "Se usa cuando un tercero factura aparte —por ejemplo el flete— de un material que ya se recibió.",
    "Se crea un pedido con solo la línea de cargo y se asigna a las líneas de la recepción ya registrada.",
  ],
  pasos: [
    "Elegí la orden/recepción sobre la que se aplica el cargo.",
    "Ingresá la descripción y el monto del cargo (p. ej. transporte).",
    "Elegí el método de reparto entre las líneas (por importe, peso, volumen o partes iguales).",
    "Registrá: se crea el pedido de solo cargo y se asigna en Business Central.",
  ],
};
const TODAS: HelpEntry = {
  titulo: "Todas las órdenes",
  resumen: "Consulta global de todas las órdenes y sus facturas.",
  detalle: ["Vista de contabilidad de todas las órdenes de la app."],
  pasos: [
    "Tocá un panel para filtrar por estado.",
    "Buscá por N.º o proveedor.",
    "Clic en una orden para ver su detalle, estados y facturas asociadas.",
  ],
};
const ARCHIVO: HelpEntry = {
  titulo: "Archivo y recepciones",
  resumen: "Órdenes cerradas y facturas registradas.",
  detalle: [
    "Historial de órdenes recibidas al 100% y todas las facturas registradas. Es consulta/respaldo; no se editan.",
  ],
  pasos: [
    "Buscá o filtrá la orden/factura que necesitás.",
    "Abrila para ver el detalle y las facturas asociadas.",
  ],
};

// Compartidas / genéricas
const DEVOLUCIONES: HelpEntry = {
  titulo: "Devoluciones",
  resumen: "Lo que volvió para atrás: solicitudes devueltas a Ingeniería y órdenes rechazadas por Aprobación.",
  detalle: [
    "Nada que ver con devolverle material al proveedor (para eso están las notas de crédito).",
    "Acá caen dos cosas: las solicitudes que Proveeduría devolvió al ingeniero para que las corrija, y las órdenes de compra que Aprobación rechazó.",
    "La columna Motivo dice por qué volvió; el tipo (Solicitud u Orden) lo indica la primera columna.",
  ],
  pasos: [
    "Mirá el tipo, el número y el motivo de cada fila.",
    "Tocá una fila para abrirla: si es una orden rechazada, entrás a corregirla y reenviarla a aprobación.",
    "Las solicitudes devueltas las corrige el ingeniero desde su app; acá quedan para seguimiento.",
  ],
  tips: [
    "Si el motivo sale “—”, la otra app no lo registró al rechazar: está en el historial de la orden.",
  ],
};
const GENERIC: HelpEntry = {
  titulo: "Compras Adelante",
  resumen: "Solicitud de material, órdenes de compra y recepción, integrado con Business Central.",
  detalle: [
    "Usá el menú de la izquierda para moverte entre las secciones de tu rol.",
    "Este botón (ⓘ) siempre te explica qué es la pantalla en la que estás y cómo usarla.",
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
