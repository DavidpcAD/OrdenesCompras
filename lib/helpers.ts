import type { Orden, OrdenLinea, Pedido, PedidoLinea, TipoSolicitud } from "./types";

// Badge del tipo de solicitud (Material / Repuesto / Stock).
export function tipoSolicitudBadge(t: TipoSolicitud): { label: string; tone: string } {
  return t === "repuesto" ? { label: "Repuesto", tone: "yellow" }
    : t === "stock" ? { label: "Stock", tone: "gray" }
    : { label: "Material", tone: "green" };
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
function esNombreObraVacio(s?: string): boolean {
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

export function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-CR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
  ingenieria: "Laura Jiménez",
  proveeduria: "Angie",
  aprobacion: "Luis Roberto",
  facturacion: "Kattya",
};

export const ROL_LABEL: Record<string, string> = {
  ingenieria: "Ingeniería",
  proveeduria: "Proveeduría",
  aprobacion: "Aprobación",
  facturacion: "Bodega",
};

// ---- líneas de pedido ----
export function pedidoLineaPendiente(l: PedidoLinea): number {
  return Math.max(0, l.cantidad - l.cantidadOrdenada);
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

// ---- líneas de orden ----
export function ordenLineaPendiente(l: OrdenLinea): number {
  return Math.max(0, l.cantidad - l.cantidadRecibida);
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

export function ordenRecibidoPct(o: Orden): number {
  const total = o.lineas.reduce((s, l) => s + l.cantidad, 0);
  if (total === 0) return 0;
  const rec = o.lineas.reduce((s, l) => s + l.cantidadRecibida, 0);
  return Math.round((rec / total) * 100);
}

export function ordenEstaCompleta(o: Orden): boolean {
  return o.lineas.length > 0 && o.lineas.every(ordenLineaCompleta);
}

export function ordenEsParcial(o: Orden): boolean {
  const algo = o.lineas.some((l) => l.cantidadRecibida > 0);
  return algo && !ordenEstaCompleta(o);
}

// Números de solicitud (PED-…) reales que originaron la orden. Las líneas
// agregadas a mano llevan pedidoNumero "Manual" y no cuentan como solicitud.
export function ordenPedidos(o: Orden): string[] {
  return [...new Set(o.lineas.filter((l) => l.pedidoNumero && l.pedidoNumero !== "Manual").map((l) => l.pedidoNumero!))];
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
    case "aprobado": return { label: "Aprobado", tone: "green" };
    case "en_orden": return { label: "En orden", tone: "yellow" };
    case "cerrado": return { label: "Cerrado", tone: "gray" };
    case "devuelto": return { label: "Devuelto", tone: "red" };
  }
}

// Estado de COMPRA de una solicitud, tal como lo ve Proveeduría (derivado del
// avance de órdenes, no del ciclo de vida borrador/aprobado del pedido).
export function pedidoCompraBadge(p: Pedido): { label: string; tone: string } {
  const pct = pedidoOrdenadoPct(p);
  if (pct >= 100) return { label: "100% comprado", tone: "green" };
  if (pct > 0) return { label: "Parcialmente comprado", tone: "yellow" };
  return { label: "Pendiente de comprar", tone: "gray" };
}

export function ordenBadge(estado: Orden["estado"]): { label: string; tone: string } {
  switch (estado) {
    case "abierto": return { label: "Abierto", tone: "gray" };
    case "pendiente_aprobacion": return { label: "Pendiente de aprobación", tone: "yellow" };
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
export function almacenesFisicos<T extends { codigo: string }>(list: T[]): T[] {
  return list.filter((a) => a.codigo.toUpperCase().startsWith("ALM-"));
}
