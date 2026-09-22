import { esLineaRecibible } from "./helpers";
import { numeroOrden } from "./helpers";
import type { Orden, Proveedor } from "./types";

// Lo pedido vs. lo entregado, agrupado por proveedor. Vivía dentro de la pantalla de
// Dashboard; salió acá cuando esa pantalla pasó a ser la pestaña "Proveedores" de
// Compras, porque ahora lo consumen dos: el encabezado de la pantalla (los totales que
// van en la barra de plata) y la tabla de la pestaña. Un solo cálculo, una sola verdad.

// Importe de una línea de artículo (pedido) y su parte recibida.
const impPedido = (l: { cantidad: number; precioUnitario: number; descuentoPct?: number }) =>
  l.cantidad * l.precioUnitario * (1 - (l.descuentoPct ?? 0) / 100);
const impRecibido = (l: { cantidadRecibida: number; precioUnitario: number; descuentoPct?: number }) =>
  (l.cantidadRecibida ?? 0) * l.precioUnitario * (1 - (l.descuentoPct ?? 0) / 100);

export type LineaProv = {
  orden: string; estado: string; code: string; desc: string; unidad: string;
  cantidad: number; recibida: number; pendiente: number; monto: number;
};
export type FilaProv = {
  proveedorId: string; nombre: string; currency: string;
  nOrdenes: number; pedido: number; recibido: number; pendiente: number; pct: number;
  lineas: LineaProv[];
  // Fecha de la orden MÁS VIEJA que todavía le debe material. No es "días tarde":
  // `Promised Receipt Date` viene vacío en las 435 líneas de Production y el
  // `Expected Receipt Date` es idéntico al `Order Date` en el 100 % de los casos —o
  // sea, el relleno automático de BC, no una promesa de nadie. Decir "361 días tarde"
  // sería acusar al proveedor de incumplir una fecha que nunca dio. "Hace N días" sí
  // es cierto y sí ordena: hay órdenes de 327 días y otras de 498.
  desdeISO: string | null;
};
export type ResumenProv = {
  filas: FilaProv[];
  pedido: number;
  recibido: number;
  pendiente: number;
  pct: number;
};

export function resumenPorProveedor(ordenes: Orden[], proveedores: Proveedor[]): ResumenProv {
  const byProv = new Map<string, FilaProv>();
  for (const o of ordenes) {
    const prov = proveedores.find((p) => p.id === o.proveedorId);
    const nombre = o.proveedorNombre || prov?.nombre || o.proveedorId || "(sin proveedor)";
    const currency = o.currencyCode || prov?.currencyCode || "";
    // Agrupar por el MISMO proveedor aunque venga con distinto id (mock vs BC):
    // clave = código de proveedor si hay, si no el nombre normalizado. Así no se
    // repite "FERRETERIA EPA S.A" en dos filas.
    const key = (o.proveedorNo?.trim()) || nombre.trim().toUpperCase().replace(/\s+/g, " ");
    if (!byProv.has(key)) {
      byProv.set(key, { proveedorId: key, nombre, currency, nOrdenes: 0, pedido: 0, recibido: 0, pendiente: 0, pct: 0, lineas: [], desdeISO: null });
    }
    const r = byProv.get(key)!;
    r.nOrdenes += 1;
    // Solo cuenta para la antigüedad si esta orden todavía debe algo.
    const debe = o.lineas.some((l) => esLineaRecibible(l) && (l.cantidadRecibida ?? 0) < l.cantidad);
    if (debe && o.fecha && (!r.desdeISO || o.fecha < r.desdeISO)) r.desdeISO = o.fecha;
    for (const l of o.lineas) {
      // Sin los cargos, con todo lo demás: si se dejan fuera el recurso y el
      // activo fijo, el importe por proveedor no cuadra con el de la orden.
      if (!esLineaRecibible(l)) continue;
      const ped = impPedido(l);
      const rec = impRecibido(l);
      r.pedido += ped; r.recibido += rec;
      r.lineas.push({
        orden: numeroOrden(o), estado: o.estado,
        code: l.articuloId || "", desc: l.descripcion, unidad: l.unidad,
        cantidad: l.cantidad, recibida: l.cantidadRecibida ?? 0,
        pendiente: Math.max(0, l.cantidad - (l.cantidadRecibida ?? 0)), monto: ped,
      });
    }
  }
  const filas = [...byProv.values()].map((r) => {
    r.pendiente = Math.max(0, r.pedido - r.recibido);
    r.pct = r.pedido > 0 ? Math.round((r.recibido / r.pedido) * 100) : 0;
    return r;
  }).sort((a, b) => b.pendiente - a.pendiente);

  const pedido = filas.reduce((s, r) => s + r.pedido, 0);
  const recibido = filas.reduce((s, r) => s + r.recibido, 0);
  return {
    filas,
    pedido,
    recibido,
    pendiente: Math.max(0, pedido - recibido),
    pct: pedido > 0 ? Math.round((recibido / pedido) * 100) : 0,
  };
}
