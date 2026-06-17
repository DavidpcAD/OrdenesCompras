"use client";

import { useStore } from "@/lib/store";
import { formatDateTime, ROL_LABEL } from "@/lib/helpers";
import type { Movimiento } from "@/lib/types";

const LABEL: Record<string, string> = {
  creado: "Creado",
  reabierto: "Reabierto",
  aprobado: "Aprobado",
  en_orden: "Pasó a orden de compra",
  cerrado: "Cerrado",
  enviado_aprobacion: "Enviado a aprobación",
  aprobado_lanzado: "Aprobado y lanzado",
  completado: "Completado",
  recepcion_parcial: "Recepción parcial",
  recepcion_total: "Recepción total",
  eliminado: "Eliminado",
};

// Etiqueta contextual: el mismo tipo de movimiento se lee distinto según
// la etapa (pedido vs. orden vs. recepción), para que la traza completa
// se entienda de un vistazo.
function etiqueta(m: Movimiento): string {
  if (m.entidad === "orden") {
    if (m.tipoMovimiento === "creado") return "En proveeduría · orden de compra creada";
    if (m.tipoMovimiento === "enviado_aprobacion") return "Orden enviada a aprobación";
    if (m.tipoMovimiento === "aprobado_lanzado") return "Orden aprobada y lanzada";
    if (m.tipoMovimiento === "recepcion_parcial") return "Recibido en bodega (parcial)";
    if (m.tipoMovimiento === "recepcion_total") return "Recibido en bodega (total)";
  }
  if (m.entidad === "recepcion" && m.tipoMovimiento === "creado") return "Factura registrada";
  return LABEL[m.tipoMovimiento] ?? m.tipoMovimiento;
}

function tono(tipo: string): string {
  if (["aprobado", "aprobado_lanzado", "recepcion_total", "completado"].includes(tipo)) return "var(--ds-color-green-100)";
  if (["enviado_aprobacion", "recepcion_parcial"].includes(tipo)) return "var(--ds-color-yellow)";
  if (["eliminado", "rechazado"].includes(tipo)) return "var(--ds-color-red-100)";
  return "var(--ds-color-gray-300)";
}

export function Timeline({
  entidad,
  idEntidad,
  traza = false,
}: {
  entidad: Movimiento["entidad"];
  idEntidad: string;
  // Si es true y la entidad es un pedido, suma los movimientos de la(s)
  // orden(es) en las que entró el pedido (proveeduría → aprobación → bodega),
  // para mostrar el historial completo hasta que se factura.
  traza?: boolean;
}) {
  const { movimientos, pedidos, ordenes } = useStore();

  // Movimientos propios de la entidad.
  let items = movimientos.filter((m) => m.entidad === entidad && m.idEntidad === idEntidad);

  // Mapa idOrden -> número de orden, para mostrar de qué orden viene cada evento.
  const numeroDeOrden = new Map(ordenes.map((o) => [o.id, o.numero]));

  if (traza && entidad === "pedido") {
    const pedido = pedidos.find((p) => p.id === idEntidad);
    const lineasPedido = new Set(pedido?.lineas.map((l) => l.id) ?? []);
    // Órdenes que incluyen al menos una línea de este pedido (enlace N:M).
    const ordenesLigadas = ordenes.filter((o) =>
      o.lineas.some((l) => l.pedidoLineaId && lineasPedido.has(l.pedidoLineaId))
    );
    const idsOrden = new Set(ordenesLigadas.map((o) => o.id));
    const movsOrden = movimientos.filter((m) => m.entidad === "orden" && idsOrden.has(m.idEntidad));
    items = [...items, ...movsOrden];
  }

  const ordenados = items.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

  if (ordenados.length === 0) {
    return <div className="ds-muted ds-label">Sin movimientos registrados todavía.</div>;
  }

  return (
    <div className="timeline">
      {ordenados.map((m) => {
        const ctxOrden = m.entidad === "orden" ? numeroDeOrden.get(m.idEntidad) : undefined;
        return (
          <div key={m.id} className="timeline__item">
            <span className="timeline__dot" style={{ background: tono(m.tipoMovimiento) }} />
            <div className="timeline__title">
              {etiqueta(m)}
              {ctxOrden && <span className="ds-muted" style={{ fontWeight: 400 }}> · {ctxOrden}</span>}
              {m.estadoAnterior && m.estadoNuevo && m.estadoAnterior !== m.estadoNuevo && (
                <span className="ds-muted" style={{ fontWeight: 400 }}> · {m.estadoAnterior} → {m.estadoNuevo}</span>
              )}
            </div>
            <div className="timeline__meta">
              {m.usuario} · {ROL_LABEL[m.rol]} · {formatDateTime(m.fecha)}{m.detalle ? ` · ${m.detalle}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
