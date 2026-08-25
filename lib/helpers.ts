import type { Orden, OrdenLinea, Pedido, PedidoLinea, Recepcion, Role, TipoSolicitud } from "./types";

// Badge del tipo de solicitud (Material / Repuesto / Stock).
export function tipoSolicitudBadge(t: TipoSolicitud): { label: string; tone: string } {
  return t === "repuesto" ? { label: "Repuesto", tone: "yellow" }
    : t === "stock" ? { label: "Stock", tone: "gray" }
    : { label: "Material", tone: "green" };
}

// Devoluciones que le competen a un rol: solicitudes que Proveeduría devolvió a
// Ingeniería (pedido "devuelto") y órdenes que Aprobación rechazó (orden
// "rechazado"). Una sola regla para la bandeja de Devoluciones Y para el punto rojo
// del menú: si se escriben aparte, tarde o temprano dicen cosas distintas.
export function devolucionesDeRol(role: Role, pedidos: Pedido[], ordenes: Orden[]): { solicitudes: Pedido[]; ordenes: Orden[] } {
  return {
    solicitudes: role === "proveeduria" ? pedidos.filter((p) => p.estado === "devuelto") : [],
    ordenes: role === "proveeduria" || role === "facturacion" ? ordenes.filter((o) => o.estado === "rechazado") : [],
  };
}

// Cuántas devoluciones quedan sin corregir (0 = nada que hacer). El punto rojo del
// menú se apaga solo: al reenviar la solicitud o relanzar la orden, el estado cambia
// y esto vuelve a 0. No hay nada que "marcar como leído".
export function devolucionesPendientes(role: Role, pedidos: Pedido[], ordenes: Orden[]): number {
  const d = devolucionesDeRol(role, pedidos, ordenes);
  return d.solicitudes.length + d.ordenes.length;
}

export function destinoLabel(p: Pedido): string {
  return p.tipoSolicitud === "repuesto"
    ? `${p.maquinaNombre ?? p.maquinaNo ?? "Máquina"}`
    : `${p.obraNombre ?? p.obraCodigo ?? "Obra"}`;
}

// Código del destino (obra o máquina) — para mostrar el CÓDIGO de obra (VN-K.21),
// no la descripción del proyecto.
export function destinoCodigo(p: Pedido): string {
  return (p.tipoSolicitud === "repuesto" ? p.maquinaNo : p.obraCodigo) ?? "—";
}

// Nombres de obra "vacíos" que no le dicen nada a Proveeduría (vienen así de BC).
export function esNombreObraVacio(s?: string): boolean {
  const t = (s ?? "").trim().toLowerCase();
  return !t || t === "por definir" || t === "sin definir" || t === "n/d";
}

// Texto ÚTIL para que Proveeduría identifique una solicitud. El modelo/nombre de
// obra suele venir "POR DEFINIR" y el código de máquina (MAQ-0012) no dice nada,
// así que se prioriza el COMENTARIO del solicitante y, en repuestos, el NOMBRE de
// la máquina. `principal` es el texto fuerte; `secundaria` el dato de apoyo.
export function solicitudResumen(p: Pedido): { principal: string; secundaria?: string } {
  const comentario = p.notas?.trim() || undefined;
  if (p.tipoSolicitud === "repuesto") {
    const maquina = p.maquinaNombre?.trim() || undefined;
    if (maquina) return { principal: maquina, secundaria: comentario };
    if (comentario) return { principal: comentario };
    return { principal: p.maquinaNo || "Repuesto" };
  }
  const obra = (!esNombreObraVacio(p.obraNombre) ? p.obraNombre?.trim() : undefined) || p.obraCodigo || undefined;
  if (comentario) return { principal: comentario, secundaria: obra };
  return { principal: obra || "Material" };
}

export const CRC = new Intl.NumberFormat("es-CR", {
  style: "currency",
  currency: "CRC",
  minimumFractionDigits: 2,
});

export const num = new Intl.NumberFormat("es-CR", { maximumFractionDigits: 2 });

export function money(amount: number, currencyCode?: string): string {
  const cur = currencyCode && currencyCode.trim() ? currencyCode : "CRC";
  return new Intl.NumberFormat("es-CR", { style: "currency", currency: cur, minimumFractionDigits: 2 }).format(amount || 0);
}

// El selector de Moneda de la app usa "" = CRC (colones) y "USD". BC devuelve
// "CRC" para proveedores en colones, que NO matchea la opción "" y dejaba el
// Select en "Seleccioná…". Normaliza el código de BC al valor del selector.
export function monedaApp(code?: string): string {
  const c = (code ?? "").trim().toUpperCase();
  return c === "CRC" ? "" : c;
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  // Fechas "solo día" (YYYY-MM-DD) se formatean directo, SIN convertir zona horaria:
  // new Date("2026-07-21") se parsea como UTC medianoche y en CR (UTC−6) mostraba el
  // día anterior (20/07). Acá tomamos los dígitos tal cual → dd/mm/aaaa.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleDateString("es-CR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Fecha de HOY en local (no UTC): new Date().toISOString() daba la fecha UTC, que en
// la tarde de CR ya es el día siguiente. Construimos la fecha local para que el
// default coincida con el día real.
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-CR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const PERSONA_POR_ROL: Record<string, string> = {
  proveeduria: "Angie",
  facturacion: "Pedro",
  contabilidad: "Kattya",
};

// Etiquetas para MOSTRAR (historial/timeline). Incluye roles que ya no entran a
// esta app pero sí aparecen en movimientos viejos (Ingeniería/Aprobación viven
// ahora en la app de producción).
export const ROL_LABEL: Record<string, string> = {
  proveeduria: "Proveeduría",
  facturacion: "Bodega",
  contabilidad: "Contabilidad",
  ingenieria: "Ingeniería",
  aprobacion: "Aprobación",
};

// ---- líneas de pedido ----

// ¿La línea de la solicitud es CONSUMO DIRECTO de una obra? Lo dice la TAREA, no la
// obra: Ingeniería marca cada pedido de material con destino ALM (entra al almacén)
// o CD (se consume contra la obra), y solo el CD obliga a elegir la actividad. Un
// pedido de material para stock igual dice para qué obra es, así que mirar la obra
// sola metía en la orden un Job No. sin tarea — y BC rechaza el pedido entero al
// lanzarlo ("Job Task No. must have a value"), que es como se trabaron las primeras
// órdenes creadas desde acá.
//
// Mismo criterio que usa la app de Producción para su etiqueta "CD · consumo directo".
export function esConsumoDirecto(l: Pick<PedidoLinea, "taskNo">): boolean {
  return !!(l.taskNo ?? "").trim();
}

// La obra que la línea le pasa a la ORDEN (Job No. de BC): solo la del consumo
// directo. Sin tarea, la obra de la solicitud es informativa y el material entra al
// almacén. Proveeduría siempre puede asignar obra+tarea a mano en la orden.
export function obraParaOrden(l: Pick<PedidoLinea, "proyecto" | "taskNo">): string {
  return esConsumoDirecto(l) ? (l.proyecto ?? "").trim() : "";
}

// A dónde fue lo que entró con una factura: CONSUMO DIRECTO de una obra —la línea
// de la orden lleva Job No., BC la carga contra el presupuesto y el stock NO sube—
// o entrada al ALMACÉN. Una misma factura puede traer las dos cosas, así que se
// devuelven las dos listas y no una etiqueta sola.
//
// Se mira la línea de la ORDEN (que es lo que viajó a BC), no la solicitud: es la
// única fuente de verdad de lo que BC hizo con el material.
export function destinoDeRecepcion(
  r: Pick<Recepcion, "lineas">,
  orden: Pick<Orden, "lineas">,
): { obras: string[]; almacenes: string[] } {
  const obras = new Set<string>();
  const almacenes = new Set<string>();
  for (const rl of r.lineas ?? []) {
    const ol = orden.lineas.find((x) => x.id === rl.ordenLineaId);
    if (!ol || ol.tipo === "cargo") continue;        // el flete no es material
    if ((rl.cantidadRecibida ?? 0) <= 0) continue;
    const obra = (ol.proyecto ?? "").trim();
    if (obra) obras.add(obra);
    else almacenes.add((ol.almacen ?? "").trim() || "—");
  }
  return { obras: [...obras], almacenes: [...almacenes] };
}

export function pedidoLineaPendiente(l: PedidoLinea): number {
  // Una línea devuelta al ingeniero está BLOQUEADA: aunque le quede cantidad sin
  // ordenar, ya no se compra. Cortarlo acá la saca de una sola vez de todos lados
  // (materiales por línea, "+ De solicitudes", crear OC, saldo del pedido).
  if (l.devuelta) return 0;
  return Math.max(0, l.cantidad - l.cantidadOrdenada);
}

// ¿Se puede devolver esta línea al ingeniero? Solo lo que Proveeduría todavía no
// comprometió: con orden de compra hecha, el material ya está pedido al proveedor
// y devolver la línea dejaría a Ingeniería creyendo que no se compró.
export function puedeDevolverLinea(l: PedidoLinea): boolean {
  return !l.devuelta && (l.cantidadOrdenada ?? 0) <= 0;
}

// Órdenes que se llevaron ESTA línea de solicitud, con su estado. Sirve para
// explicar por qué la línea no se puede devolver: "no se puede" a secas manda a
// alguien a revisar orden por orden cuál se la llevó.
export type OrdenDeLinea = { id: string; etiqueta: string; estado: Orden["estado"]; cantidad: number; enBc: boolean };
export function ordenesDeLineaPedido(ordenes: Orden[], pedidoLineaId: string): OrdenDeLinea[] {
  const out: OrdenDeLinea[] = [];
  for (const o of ordenes) {
    const cantidad = o.lineas
      .filter((l) => l.tipo === "articulo" && l.pedidoLineaId === pedidoLineaId)
      .reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
    if (cantidad > 0) out.push({ id: o.id, etiqueta: numeroOrden(o), estado: o.estado, cantidad, enBc: !!o.bcNumber });
  }
  return out;
}

// ¿Es un BORRADOR que se puede descartar? Abierta o rechazada y sin N.º de BC: no
// existe en Business Central, así que descartarla no deja nada colgando allá.
export function ordenEsBorradorDescartable(o: Pick<Orden, "estado" | "bcNumber">): boolean {
  return (o.estado === "abierto" || o.estado === "rechazado") && !o.bcNumber;
}

// Motivo por el que una línea NO se puede devolver (para decirlo en la pantalla en
// vez de dejar la casilla apagada sin explicación). Con las órdenes a mano, nombra
// la que se la llevó y —si todavía es un borrador— dice cómo soltarla.
export function motivoNoDevolver(l: PedidoLinea, ordenes?: Orden[]): string {
  if (l.devuelta) return "ya está devuelta";
  if ((l.cantidadOrdenada ?? 0) <= 0) return "";
  const suyas = ordenes ? ordenesDeLineaPedido(ordenes, l.id) : [];
  if (!suyas.length) return "ya tiene orden de compra";
  // Una orden CERRADA sigue apuntando a la línea aunque ya le haya devuelto el saldo
  // (al cerrar no se borran sus líneas). Si hay órdenes vivas, el saldo lo retienen
  // esas: mirar solo esas es lo que hace que el consejo del borrador salga cuando
  // corresponde en vez de quedar tapado por una orden vieja.
  const vivas = suyas.filter((o) => o.estado !== "completado");
  const base = vivas.length ? vivas : suyas;
  const nombres = base.map((o) => o.etiqueta).join(", ");
  const borradores = base.filter((o) => ordenEsBorradorDescartable(o));
  if (borradores.length === base.length) {
    // Todavía no se le pidió nada a nadie: el material se suelta descartando ese
    // borrador (o quitando la línea de él) y ahí sí se puede devolver.
    return `está en ${nombres} (todavía sin enviar a Business Central) — descartá ese borrador y esta línea se libera`;
  }
  return `ya tiene orden de compra (${nombres})`;
}

// Qué se cotiza: lo que falta por ordenar. Si ya se ordenó todo (o la solicitud es
// vieja y se quiere volver a cotizar), se manda la solicitud completa — pero NUNCA
// lo devuelto al ingeniero: ese material no se va a comprar, y el fallback lo
// mandaba a cotizar con su cantidad completa (se escribió cuando "sin pendiente"
// solo podía significar "ya se ordenó todo").
export function lineasACotizar(pedido: Pedido): { linea: PedidoLinea; cantidad: number }[] {
  const pendientes = pedido.lineas
    .map((l) => ({ linea: l, cantidad: pedidoLineaPendiente(l) }))
    .filter((x) => x.cantidad > 0);
  if (pendientes.length) return pendientes;
  return pedido.lineas.filter((l) => !l.devuelta).map((l) => ({ linea: l, cantidad: l.cantidad }));
}

// El comentario que SÍ se le imprime al proveedor. `notaCreador` hace doble oficio:
// es el comentario del ingeniero y también donde queda escrito el motivo de una
// devolución (para que lo vean las dos apps). Ese motivo es INTERNO — "el ingeniero
// pidió de más, no hay presupuesto" no puede salir en el papel que recibe el
// proveedor —, así que acá se recorta el prefijo de la devolución y queda solo el
// comentario original.
export function observacionesParaProveedor(notas?: string): string {
  const t = (notas ?? "").trim();
  if (!t.startsWith("↩")) return t;
  const corte = t.indexOf(" · ");        // "↩ Devuelta(s): … — motivo · <comentario original>"
  return corte >= 0 ? t.slice(corte + 3).trim() : "";
}

export function pedidoTieneSaldo(p: Pedido): boolean {
  return p.lineas.some((l) => pedidoLineaPendiente(l) > 0);
}

// % de la solicitud que Proveeduría ya convirtió en órdenes de compra
// (cantidadOrdenada / cantidad). Es el avance de COMPRA, distinto del de entrega.
export function pedidoOrdenadoPct(p: Pedido): number {
  const total = p.lineas.reduce((s, l) => s + l.cantidad, 0);
  if (total === 0) return 0;
  const ord = p.lineas.reduce((s, l) => s + Math.min(l.cantidadOrdenada, l.cantidad), 0);
  return Math.round(Math.min(100, (ord / total) * 100));
}

// Cuánto de una línea de pedido ya LLEGÓ (recibido en bodega), rastreando las
// órdenes en las que entró esa línea (enlace N:M por OrdenLinea.pedidoLineaId).
export function recibidoDeLineaPedido(ordenes: Orden[], pedidoLineaId: string): number {
  let total = 0;
  for (const o of ordenes) {
    for (const l of o.lineas) {
      if (l.pedidoLineaId === pedidoLineaId) total += l.cantidadRecibida;
    }
  }
  return total;
}

// Índice pedidoLineaId → cantidad recibida, armado en UN pase sobre las órdenes.
// Para listas (una fila por solicitud, con varias líneas cada una) usar esto en un
// useMemo: llamar recibidoDeLineaPedido por línea recorre TODAS las órdenes cada vez.
export function recibidoPorLineaPedido(ordenes: Orden[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of ordenes) {
    for (const l of o.lineas) {
      if (!l.pedidoLineaId) continue;
      m.set(l.pedidoLineaId, (m.get(l.pedidoLineaId) ?? 0) + l.cantidadRecibida);
    }
  }
  return m;
}

// ---- líneas de orden ----
export function ordenLineaPendiente(l: OrdenLinea): number {
  return Math.max(0, l.cantidad - l.cantidadRecibida);
}

// Resumen de lo que una orden dejó SIN recibir. Es lo que se devuelve a las
// solicitudes al cerrarla y lo que se pasaría a una orden nueva. Solo artículos:
// un cargo (flete) no tiene saldo por recibir.
export function ordenPendienteResumen(o: Orden): { lineas: number; unidades: number } {
  const pend = soloArticulos(o).map(ordenLineaPendiente).filter((q) => q > 0);
  return { lineas: pend.length, unidades: pend.reduce((s, q) => s + q, 0) };
}

// Devuelve a las solicitudes lo que una orden dejó SIN recibir, al cerrarla.
// Sin esto, esas unidades quedan "ya ordenadas" para siempre y nadie las puede
// volver a comprar sin abrir una solicitud nueva.
// OJO: se SUMA el pendiente de todas las líneas de la orden que apuntan a la misma
// línea de pedido antes de restar. Si se restara línea por línea (o con un JOIN que
// toca la fila una sola vez, como en SQL), una orden con el mismo material repetido
// devolvería de menos y el saldo quedaría mal para siempre.
export function devolverPendienteAPedidos(pedidos: Pedido[], orden: Orden): Pedido[] {
  const porLinea = new Map<string, number>();
  for (const l of soloArticulos(orden)) {
    if (!l.pedidoLineaId) continue;
    const pend = ordenLineaPendiente(l);
    if (pend > 0) porLinea.set(l.pedidoLineaId, (porLinea.get(l.pedidoLineaId) ?? 0) + pend);
  }
  if (!porLinea.size) return pedidos;
  return pedidos.map((p) => {
    let tocado = false;
    const ls = p.lineas.map((pl) => {
      const dev = porLinea.get(pl.id) ?? 0;
      if (dev <= 0) return pl;
      tocado = true;
      return { ...pl, cantidadOrdenada: Math.max(0, pl.cantidadOrdenada - dev) };
    });
    if (!tocado) return p;
    // Si volvió a quedar saldo, la solicitud deja de estar "en orden": tiene que
    // reaparecer en "Por línea" para que Proveeduría la pueda comprar de nuevo.
    const sinSaldo = ls.every((pl) => pl.cantidadOrdenada >= pl.cantidad - 1e-9);
    return { ...p, lineas: ls, estado: (sinSaldo ? "en_orden" : "aprobado") as Pedido["estado"] };
  });
}

// Nombre del proveedor para mostrar, sin quedarse nunca en un "—" mudo.
// En producción `proveedorId` de la orden es el CÓDIGO ("PROV-000002") mientras el
// catálogo de BC usa el GUID como `id`, así que buscar solo por id no encuentra
// nada. Se prueba por id, por código, y si no hay catálogo se muestra el código —
// que al menos identifica al proveedor.
// Hace falta porque hay órdenes con `proveedorNombre` en NULL: las editadas antes
// del fix 8b8a5d3. Para arreglar los datos, ver sql/repair_proveedor_nombre.sql.
export function proveedorLabel(
  o: Pick<Orden, "proveedorNombre" | "proveedorNo" | "proveedorId">,
  catalogo: { id: string; code: string; nombre: string }[] = [],
): string {
  const nombre = (o.proveedorNombre ?? "").trim();
  if (nombre) return nombre;
  const codigo = (o.proveedorNo ?? o.proveedorId ?? "").trim();
  const hit = catalogo.find((p) => p.id === o.proveedorId)
    ?? (codigo ? catalogo.find((p) => p.code === codigo) : undefined);
  return (hit?.nombre ?? "").trim() || codigo || "—";
}

export function ordenLineaCompleta(l: OrdenLinea): boolean {
  return l.cantidadRecibida >= l.cantidad - 1e-9;
}

// Último precio usado para un artículo con un proveedor (para detectar aumentos)
export function ultimoPrecioProveedor(ordenes: Orden[], articuloId: string, proveedorId: string): number | null {
  const cand = ordenes
    .filter((o) => o.proveedorId === proveedorId)
    .flatMap((o) => o.lineas.filter((l) => l.articuloId === articuloId).map((l) => ({ fecha: o.fecha, precio: l.precioUnitario })))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return cand.length ? cand[0].precio : null;
}

export function ordenLineaImporte(l: OrdenLinea): number {
  return l.cantidad * l.precioUnitario * (1 - (l.descuentoPct ?? 0) / 100);
}

export function ordenSubtotal(o: Orden): number {
  return o.lineas.reduce((s, l) => s + ordenLineaImporte(l), 0);
}

// El avance de recepción se mide SOLO sobre los artículos: las líneas de cargo
// (flete) no se reciben en bodega, se facturan. Si se cuentan, una orden con flete
// nunca llega a 100% ni se completa — y en SQL la regla ya es `tipoLinea='articulo'`.
const soloArticulos = (o: Orden) => o.lineas.filter((l) => l.tipo !== "cargo");

export function ordenRecibidoPct(o: Orden): number {
  const arts = soloArticulos(o);
  const total = arts.reduce((s, l) => s + l.cantidad, 0);
  if (total === 0) return 0;
  const rec = arts.reduce((s, l) => s + l.cantidadRecibida, 0);
  return Math.round((rec / total) * 100);
}

// Cantidades para los anillos/barras de progreso (mismo criterio: sin cargos).
export function ordenAvance(o: Orden): { recibida: number; total: number } {
  const arts = soloArticulos(o);
  return {
    recibida: arts.reduce((s, l) => s + l.cantidadRecibida, 0),
    total: arts.reduce((s, l) => s + l.cantidad, 0),
  };
}

export function ordenEstaCompleta(o: Orden): boolean {
  const arts = soloArticulos(o);
  return arts.length > 0 && arts.every(ordenLineaCompleta);
}

export function ordenEsParcial(o: Orden): boolean {
  const algo = soloArticulos(o).some((l) => l.cantidadRecibida > 0);
  return algo && !ordenEstaCompleta(o);
}

// Números de solicitud (PED-…) reales que originaron la orden. Las líneas
// agregadas a mano llevan pedidoNumero "Manual" y no cuentan como solicitud.
// N.º de la orden TAL COMO SE MANEJA: el de Business Central. Es el que existe en el
// ERP, el que ve el proveedor en el PDF y el que Contabilidad busca.
//
// Mientras la orden todavía no está en BC no hay número que mostrar, así que se
// muestra un RÓTULO, no un número: ver `etiquetaInterna`.
export function numeroOrden(o: { numero: string; bcNumber?: string }): string {
  return o.bcNumber || etiquetaInterna(o.numero);
}

// Rótulo de una orden que todavía no existe en Business Central.
//
// El `numero` interno de la app es una serie aparte (MAX+1 sobre su propia tabla,
// ver createOrden) que además usa el MISMO prefijo y el MISMO formato de 6 dígitos
// que la serie C PED de BC: "CP-000037" se lee igual que "CP-005156" pero en BC no
// existe. Alguien lo buscaba allá y no aparecía. Por eso acá se rompe el disfraz:
// "Interno 37" no se puede confundir con un pedido de BC.
//
// Un formato que no sea CP-<dígitos> se devuelve tal cual: es un dato migrado o de
// otra serie y adivinar sería peor que mostrarlo.
export function etiquetaInterna(numero: string): string {
  const n = (numero ?? "").trim();
  if (!n) return "—";
  const m = /^CP-0*(\d+)$/i.exec(n);
  return m ? `Interno ${m[1]}` : n;
}

// ¿La orden ya existe en Business Central? Es lo que separa "N.º de verdad" de
// "rótulo interno", y decide si tiene sentido ofrecer un link a BC.
export function tieneBc(o: { bcNumber?: string }): boolean {
  return !!(o.bcNumber ?? "").trim();
}

export function ordenPedidos(o: Orden): string[] {
  return [...new Set(o.lineas.filter((l) => l.pedidoNumero && l.pedidoNumero !== "Manual").map((l) => l.pedidoNumero!))];
}

// Almacén(es)/centro(s) de costo a donde entra el material de la orden
// (locationCode de las líneas de artículo). Casi siempre es uno solo: es el dato
// que Proveeduría necesita ver en la lista para saber a dónde va la compra sin
// abrir la orden. Las líneas de cargo (flete) no cuentan: heredan el almacén.
export function ordenAlmacenes(o: Orden): string[] {
  return [...new Set(soloArticulos(o).map((l) => (l.almacen ?? "").trim()).filter(Boolean))];
}

// Obra(s) a las que se carga la orden como consumo (Job No. de las líneas). Vacío
// = la compra entra a inventario, no a una obra.
export function ordenObras(o: Orden): string[] {
  return [...new Set(soloArticulos(o).map((l) => (l.proyecto ?? "").trim()).filter(Boolean))];
}

// Orden "directa" = compra armada sin partir de una solicitud (ninguna línea
// proviene de un pedido real). Las órdenes que nacen de solicitudes tienen al
// menos una línea con su PED-… de origen.
export function ordenEsDirecta(o: Orden): boolean {
  return ordenPedidos(o).length === 0;
}

// ---- badges ----
export function pedidoBadge(estado: Pedido["estado"]): { label: string; tone: string } {
  switch (estado) {
    case "borrador": return { label: "Borrador", tone: "gray" };
    case "aprobado": return { label: "En proveeduría", tone: "green" };
    case "en_orden": return { label: "En orden", tone: "yellow" };
    case "cerrado": return { label: "Cerrado", tone: "gray" };
    case "devuelto": return { label: "Devuelto", tone: "red" };
  }
}

// Estado de una solicitud frente a las ÓRDENES DE COMPRA, tal como lo ve
// Proveeduría (derivado del avance de órdenes, no del ciclo borrador/aprobado).
//
// Dice "ordenado", no "comprado", a propósito: que exista la orden de compra solo
// significa que se le pidió al proveedor. Comprado de verdad es cuando llega y se
// factura, y eso lo cuenta la columna "Entregado".
export function pedidoCompraBadge(p: Pedido): { label: string; tone: string } {
  const pct = pedidoOrdenadoPct(p);
  if (pct >= 100) return { label: "100% ordenado", tone: "green" };
  if (pct > 0) return { label: "Parcialmente ordenado", tone: "yellow" };
  return { label: "Sin orden de compra", tone: "gray" };
}

// Índice solicitud (N.º PED) -> órdenes de compra en las que entró. El enlace es
// N:M: una solicitud puede repartirse en varias órdenes y una orden puede juntar
// varias solicitudes. Se resuelve por el N.º de pedido de la línea y, si no viene,
// por el id de la línea de pedido (más fiable que el string).
export function ordenesPorPedido(pedidos: Pedido[], ordenes: Orden[]): Map<string, { id: string; numero: string }[]> {
  const pedidoDeLinea = new Map<string, string>();
  for (const p of pedidos) for (const l of p.lineas) pedidoDeLinea.set(l.id, p.numero);
  const m = new Map<string, { id: string; numero: string }[]>();
  for (const o of ordenes) {
    const numeros = new Set<string>();
    for (const l of o.lineas) {
      const num = (l.pedidoNumero && l.pedidoNumero !== "Manual")
        ? l.pedidoNumero
        : (l.pedidoLineaId ? pedidoDeLinea.get(l.pedidoLineaId) : undefined);
      if (num) numeros.add(num);
    }
    for (const num of numeros) {
      const arr = m.get(num) ?? [];
      // El N.º que se muestra es el que se maneja: el de BC (ver numeroOrden).
      if (!arr.some((x) => x.id === o.id)) arr.push({ id: o.id, numero: numeroOrden(o) });
      m.set(num, arr);
    }
  }
  return m;
}

export function ordenBadge(estado: Orden["estado"]): { label: string; tone: string } {
  switch (estado) {
    case "abierto": return { label: "Abierto", tone: "gray" };
    case "pendiente_aprobacion": return { label: "Pendiente de aprobación", tone: "yellow" };
    case "rechazado": return { label: "Rechazada", tone: "red" };
    case "lanzado": return { label: "Lanzado", tone: "green" };
    case "completado": return { label: "Completado", tone: "green" };
  }
}

// Distribución proporcional de un cargo (flete) por importe de las líneas de artículo
export function distribuirCargo(monto: number, lineas: OrdenLinea[]): Record<string, number> {
  const articulos = lineas.filter((l) => l.tipo === "articulo");
  const base = articulos.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
  const res: Record<string, number> = {};
  if (base === 0) return res;
  articulos.forEach((l) => {
    res[l.id] = (monto * (l.cantidad * l.precioUnitario)) / base;
  });
  return res;
}

export function nextNumero(prefix: string, existentes: string[]): string {
  const nums = existentes
    .map((n) => parseInt(n.replace(/[^0-9]/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}-${String(max + 1).padStart(6, "0")}`;
}

// Solo almacenes físicos (códigos ALM-*). Oculta bodegas de obra (VN-M.28, etc.),
// que no son ubicaciones físicas de recepción y no deben ofrecerse al armar órdenes.
// Un almacén FÍSICO es una bodega de la empresa (ALM-*). El resto de las
// ubicaciones de BC son centros de costo: una por obra/área.
export function esAlmacenFisico(codigo: string): boolean {
  return (codigo ?? "").toUpperCase().startsWith("ALM-");
}

// TODOS los almacenes/centros de costo de BC para elegir dónde se recibe, con las
// BODEGAS primero y el resto por código. Antes la lista se filtraba a ALM-* y solo
// se ofrecían 4 opciones; el material puede entrar a cualquier centro de costo, así
// que filtrarlos era decidir por el usuario algo que no nos toca.
export function almacenesParaRecepcion<T extends { codigo: string }>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    Number(esAlmacenFisico(b.codigo)) - Number(esAlmacenFisico(a.codigo)) ||
    a.codigo.localeCompare(b.codigo, "es"));
}
