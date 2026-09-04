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
    "¿Necesitás precios antes de comprar? \"⬇ PDF para cotizar\" baja la lista de materiales con las columnas de precio en blanco: se la mandás al proveedor y él la llena.",
    "Si vas a comprar, avanzá la solicitud a una orden de compra desde acá.",
    "¿Hay material que el ingeniero tiene que corregir? “Devolver al ingeniero” abre la lista y devolvés SOLO las líneas que marques (o todas). Lo que ya tiene orden de compra no se puede devolver: ese material ya se le pidió al proveedor.",
  ],
  tips: [
    "Una línea devuelta queda bloqueada: no aparece más en materiales por ordenar ni se le puede hacer orden de compra. El motivo queda en el historial.",
    "Si devolvés TODAS las líneas, la solicitud entera pasa a “Devuelta”; si devolvés solo una parte, la solicitud sigue viva con el resto.",
  ],
};
const ORDENES: HelpEntry = {
  titulo: "Órdenes de compra",
  resumen: "Las órdenes enviadas a proveedores y su estado.",
  detalle: [
    "Lista de las órdenes que armaste. Quedan abiertas hasta recibir el 100% del material.",
    "Los paneles de arriba cuentan las órdenes por estado.",
    "El N.º que ves (CP-005…) es el del pedido en Business Central, y aparece en cuanto enviás la orden a aprobación: ahí se crea el pedido en BC, ABIERTO. Aprobación después lo lanza. Mientras la orden esté abierta acá todavía no existe en BC y se muestra un rótulo interno (“Interno 37”), que sirve para nombrarla acá pero no se puede buscar en BC.",
  ],
  pasos: [
    "Tocá un panel de arriba para filtrar por estado (abiertas, pendientes de aprobación, rechazadas, completadas).",
    "Buscá por N.º de orden, proveedor o almacén. También encontrás una orden escribiendo su N.º interno viejo (CP-000037).",
    "La columna Almacén dice a dónde entra el material y, si la compra es consumo de una obra, muestra la obra debajo.",
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
    "Si está Abierta, usá “Editar” para ajustarla, o enviala a aprobación: al enviarla se crea el pedido en Business Central (Abierto) y aparece su N.º.",
    "Si Aprobación la rechazó, el aviso rojo de arriba dice el motivo: corregí eso, guardá y reenviala.",
    "Si ya está lanzada/recibida, consultá sus recepciones y facturas asociadas.",
    "Con “Imprimir” generás el PDF de la orden (se habilita cuando ya está aprobada).",
    "Si está Lanzada: “Volver a abrir” la corrige (también la des-lanza en Business Central) y “Cerrar orden” la da por terminada aunque falte material.",
    "Si la orden NO va a salir: “Descartar borrador” (sin N.º de BC) o “Anular orden” (con N.º de BC: borra el pedido allá). En los dos casos el material vuelve a quedar pendiente en la solicitud para ordenarlo distinto.",
  ],
  tips: [
    "“Anular orden” solo funciona si el pedido sigue Abierto en Business Central y sin recepciones. Si ya está lanzado, primero “Volver a abrir”. BC deja un documento en ₡0,00 al borrar un pedido: es normal, no hay que anularlo.",
    "“Cerrar orden” es para cuando el proveedor no va a traer el resto. Pide el motivo y, por defecto, devuelve lo no recibido a las solicitudes para poder volver a comprarlo.",
    "Si el resto se lo vas a comprar a otro, marcá “Crear una orden nueva con lo pendiente”: cierra esta y te deja la nueva armada y abierta.",
    "Una orden con facturas registradas ya no se puede volver a abrir: lo que llegó mal va por devolución.",
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
    "Con “+ De solicitudes” le sumás a esta orden líneas de solicitud que quedaron pendientes por ordenar (la que faltó de esta misma solicitud, o material de otra que se le pueda sumar al proveedor).",
    "En la columna Destino, tocá “Cambiar obra/tarea” (o “Asignar obra”) para corregir a qué obra se carga la línea y con qué tarea. Con obra, el material se consume en la obra; sin obra entra al almacén.",
    "Revisá el total; guardá los cambios.",
    "Cuando esté lista, enviala a aprobación.",
  ],
  tips: [
    "Si la línea va a una obra, la tarea es obligatoria: Business Central no acepta un Job No. sin Job Task No.",
    "Si la orden ya tiene pedido en Business Central y le cambiás el proveedor o la moneda, al guardar el pedido de allá cambia igual, y sus líneas se reescriben.",
    "Artículos SUELTOS no se pueden agregar a una orden nacida de solicitud (solo líneas de solicitudes): para una compra libre está la orden directa.",
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
const REPORTES: HelpEntry = {
  titulo: "Reportes de compras",
  resumen: "Historial de qué se compró, a quién, a qué precio y para qué obra.",
  detalle: [
    "Se arma con las órdenes de esta app. Por defecto solo cuenta las lanzadas y completadas: una orden en borrador o rechazada no es una compra.",
    "Los montos son sin IVA y ya con el descuento de línea. El flete y demás cargos no entran: no son material comprado.",
    "El precio promedio es ponderado por cantidad, no el promedio simple de los precios.",
  ],
  pasos: [
    "Elegí el rango de fechas (por defecto, los últimos 12 meses).",
    "En “Material” escribí el código o parte de la descripción para ver solo ese artículo.",
    "Cambiá de pestaña: por Material (historial de precios), por Obra (centro de costo) o por Personas (quién pidió / quién generó la OC).",
    "Tocá una fila para ver el detalle de cada compra; el número de orden abre la orden.",
    "“Descargar CSV” baja el detalle filtrado para abrirlo en Excel.",
  ],
  tips: [
    "Para negociar con un proveedor: buscá el material y mirá precio mínimo, promedio y último — con la fecha y el proveedor de esa última compra.",
    "Si un material se compró en colones y en dólares, los totales se muestran por separado y los precios son solo de la moneda de la última compra.",
  ],
};
const CONCILIACION_BC: HelpEntry = {
  titulo: "Conciliación con Business Central",
  resumen: "Revisa orden por orden que las líneas de la app sean las mismas que hay en BC.",
  detalle: [
    "Existe porque puede pasar —y pasó— que una orden tenga 7 líneas acá y 6 en BC: el material llega a la bodega, el proveedor lo factura, y en BC se registra de menos sin que nadie se entere.",
    "Si la orden todavía tiene su pedido en BC, se compara contra las líneas del pedido. Si ya se completó (BC borra el pedido cuando se recibe y factura todo), se compara contra lo que BC registró.",
    "“No se pudo verificar” no es lo mismo que “está mal”: significa que BC no contestó o que no hay contra qué comparar.",
  ],
  pasos: [
    "Elegí desde qué fecha querés revisar (mientras más atrás, más tarda: son una o dos consultas a BC por orden).",
    "Dale “Revisar”. Va por tandas y muestra lo que va encontrando; podés pararlo cuando quieras.",
    "Las órdenes que no cuadran salen con el detalle de qué línea falta y cuánta plata es. El número abre la orden.",
  ],
  tips: [
    "Lo que se revisa queda guardado en la orden: el aviso rojo aparece después en su detalle aunque nadie esté mirando esta pantalla.",
    "Si una orden dice que le falta una línea en BC, NO la recibas: primero hay que arreglar el pedido allá, o BC va a registrar de menos otra vez.",
  ],
};
const NUEVA: HelpEntry = {
  titulo: "Armar orden de compra",
  resumen: "Revisá y ajustá lo que se va a enviar al proveedor.",
  detalle: [
    "Se arma tomando líneas de solicitudes de Ingeniería.",
    "El precio que pongas es el costo unitario que se manda a Business Central.",
    "La columna Destino muestra UNA sola cosa por línea: si el ingeniero la pidió como consumo directo, la obra y su tarea (el material se carga a esa obra y no suma inventario); si la pidió a almacén, el almacén / centro de costo que eligió. Una compra para stock no pide tarea.",
  ],
  pasos: [
    "Confirmá el proveedor (hereda términos y moneda), la moneda y el almacén de recepción.",
    "Revisá las líneas que traés de la solicitud; ajustá las cantidades.",
    "Mirá el destino: lo trae la solicitud (lo pone quien pide el material). Si una línea muestra el almacén pero en realidad es consumo de una obra, tocá “Asignar obra” y elegí obra + tarea; con “Cambiar obra/tarea” corregís las que ya vienen con obra.",
    "Corregí los precios unitarios si difieren de lo cotizado.",
    "(Opcional) agregá un cargo de flete/transporte que se reparte entre las líneas.",
    "Hay DOS comentarios y no son lo mismo: “Observaciones para el proveedor” se imprimen en el PDF que él recibe; “Comentario para el aprobador” es interno y no sale en el PDF.",
    "Guardá como “Abierta” (borrador) o “Enviar a aprobación”. Al enviarla se crea el pedido en Business Central, todavía sin lanzar: si BC rechaza algo, la orden no se envía y el aviso dice qué corregir.",
  ],
  tips: [
    "Lo que vas armando se guarda solo: si te salís, recargás o volvés mañana, la pantalla lo recupera y te lo dice arriba. Eso vive en ESTA computadora y todavía no es una orden.",
    "¿Vas a seguir desde otra computadora o mañana con alguien más? Guardala como “Abierta”: ahí sí queda en el sistema, con su número, y cualquiera de Proveeduría la ve.",
  ],
};
const DIRECTA: HelpEntry = {
  titulo: "Nueva orden directa",
  resumen: "Compra que no viene de una solicitud de Ingeniería.",
  detalle: [
    "Para comprar material que no pasó por una solicitud: agregás los artículos del catálogo directamente.",
    "Cada línea puede ir a una obra (con su tarea) o quedarse sin obra. Sin obra el material entra al almacén de recepción y suma inventario; con obra, Business Central lo registra como consumo de esa obra y el inventario no sube. Así se compra un servicio para un proyecto sin pasar por Ingeniería.",
  ],
  pasos: [
    "Elegí el proveedor (hereda términos y moneda), la moneda y el almacén de recepción.",
    "Buscá un artículo del catálogo, poné la cantidad y el precio, y tocá “+ Agregar línea”.",
    "Si esa línea va a una obra, elegí la obra y la tarea ANTES de agregarla (quedan puestas para las siguientes). Para corregirlas después, tocá “Cambiar” en la columna Destino.",
    "Repetí para cada material que necesites.",
    "(Opcional) activá el cargo de flete/transporte.",
    "Revisá Subtotal / IVA / Total y guardá como abierta o enviá a aprobación. Al enviarla se crea el pedido en Business Central, todavía sin lanzar.",
  ],
  tips: [
    "La tarea es obligatoria cuando ponés obra: sin ella Business Central rechaza la línea.",
    "Lo que vas armando se guarda solo en esta computadora: si te salís o recargás, la pantalla lo recupera. Para que quede en el sistema, guardala como “Abierta”.",
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
    "Al expandir un artículo también ves su movimiento de compras: las recepciones registradas en Business Central (con proveedor, fecha y costo) y las órdenes de esta app que lo llevan, incluidas las que van en camino.",
  ],
  pasos: [
    "Buscá el artículo por nombre o código.",
    "Mirá la existencia por ubicación/almacén.",
    "Expandí la fila para ver a quién se le compró, cuándo y a qué precio, y qué órdenes lo tienen pendiente.",
    "Si aparece “s/d”, Business Central no respondió en ese momento — reintentá.",
  ],
};

// ─────────────────────────── Bodega (Pedro) ───────────────────────────
const ORDENES_POR_RECIBIR: HelpEntry = {
  titulo: "Órdenes por recibir",
  resumen: "Registrá la recepción y la factura cuando llega el material.",
  detalle: [
    "Lista de las órdenes lanzadas que esperan material en bodega. Soporta entregas parciales.",
    "Los cuatro paneles de arriba FILTRAN la lista: por recibir, sin recibir todavía, con recepción parcial y completadas.",
  ],
  pasos: [
    "Tocá un panel para ver solo esas órdenes: “Con recepción parcial” son las que vinieron a medias y hay que completar; “Sin recibir todavía” son las que no han llegado.",
    "Buscá la orden del material que llegó (por N.º o proveedor).",
    "Tocá “Registrar factura” en esa orden para abrir la recepción.",
    "Registrá lo que llegó (ver la ayuda de esa pantalla).",
  ],
  tips: [
    "El anillo de % muestra cuánto de la orden ya se recibió.",
    "Con un panel activo, el buscador busca dentro de ese grupo. “Ver las que faltan recibir” vuelve a la lista completa.",
  ],
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
    "Si una línea llegó dañada, con menos cantidad, a otro precio o llegó otro material, marcala para nota de crédito (en el celular por el menú ⋮ de la tarjeta; en la computadora por el ⚠ de la fila) y elegí el motivo: eso le queda a Contabilidad.",
    "Si la factura trae un flete o cargo extra, marcá “Esta factura trae un cargo de producto adicional” y describilo: le avisamos a Contabilidad para que lo agregue. Vos recibís y registrás igual.",
    "Revisá el Subtotal / IVA / Total de abajo. Cada línea muestra su importe según la cantidad que anotaste.",
    "Antes de registrar, en “Foto de la factura” podés adjuntar la foto de la factura física: se guarda con la recepción y después la ves en Recibidas.",
    "Si la factura está bien → “Registrar factura” y escribí el N.º de factura del proveedor.",
    "Si el material está bien pero la factura tiene un problema → “Recibir sin factura (a revisión)”: Contabilidad la registra después.",
  ],
  tips: [
    "Podés recibir parcial: registrás lo que llegó y la orden queda abierta para el resto.",
    "La foto se comprime en el teléfono antes de subirla: no consume datos ni llena la base.",
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
    "Tocá “Ver factura y líneas” para el detalle tal cual viaja a BC: artículo, cantidad, precio unitario, IVA e importe.",
    "Si la recepción trae foto de la factura (etiqueta “Con foto”), tocá la miniatura para verla grande; “Abrir imagen” la deja en otra pestaña para hacer zoom.",
    "Al final de las líneas ves el Subtotal, IVA y Total de la factura.",
  ],
};
const RECEPCION_DET: HelpEntry = {
  titulo: "Detalle de la recepción",
  resumen: "Las líneas recibidas en una factura puntual.",
  detalle: [
    "Ves qué artículos y cantidades entraron en esta factura/recepción específica.",
    "Si Bodega adjuntó la foto de la factura física, aparece abajo de las líneas.",
  ],
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
    "Acá llegan las líneas que Bodega marcó al recibir por dañado, menos cantidad, precio distinto o material distinto (llegó otro artículo).",
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
  if (p.startsWith("/proveeduria/reportes")) return REPORTES;
  if (p.startsWith("/proveeduria/conciliacion-bc")) return CONCILIACION_BC;
  if (p === "/proveeduria") return SOLICITUDES_LINEA;
  return GENERIC;
}
