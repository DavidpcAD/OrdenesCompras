"use client";

import { useStore } from "@/lib/store";
import { formatDateTime, ROL_LABEL } from "@/lib/helpers";
import type { Movimiento } from "@/lib/types";

// Códigos de estado -> nombre legible (pedidos y órdenes).
const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  aprobado: "Aprobado",
  en_orden: "En orden",
  cerrado: "Cerrado",
  abierto: "Abierto",
  pendiente_aprobacion: "Pendiente de aprobación",
  lanzado: "Lanzado",
  parcial: "Parcial",
  completado: "Completado",
  anulado: "Anulado",
};
const estadoLabel = (c?: string) => (c ? (ESTADO_LABEL[c] ?? c) : undefined);

const LABEL: Record<string, string> = {
  creado: "Creado",
  reabierto: "Reabierto",
  editado: "Editado",
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

// Color del punto por etapa, para que cada evento se distinga de un vistazo.
function colorPunto(m: Movimiento): string {
  if (m.entidad === "orden") {
    switch (m.tipoMovimiento) {
      case "creado": return "var(--ds-color-gray-400)";   // En proveeduría · neutral (gris)
      case "enviado_aprobacion": return "var(--ds-color-yellow)"; // pendiente · amarillo
      case "aprobado_lanzado": return "var(--ds-color-green-200)"; // lanzada · verde
      case "recepcion_parcial": return "var(--ds-color-yellow)"; // recibido parcial · amarillo
      case "recepcion_total":
      case "completado": return "var(--ds-color-green-200)"; // recibido total / completado · verde fuerte
      case "eliminado": return "var(--ds-color-red-100)";
    }
  }
  // Pedido (ingeniería)
  switch (m.tipoMovimiento) {
    case "creado": return "var(--ds-color-gray-300)";     // creado · gris
    case "aprobado": return "var(--ds-color-green-100)";  // aprobado · verde lima
    case "reabierto": return "var(--ds-color-gray-400)";
    case "eliminado":
    case "rechazado": return "var(--ds-color-red-100)";
  }
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
            <span className="timeline__dot" style={{ background: colorPunto(m) }} />
            <div className="timeline__title">
              {etiqueta(m)}
              {ctxOrden && <span className="ds-muted" style={{ fontWeight: 400 }}> · {ctxOrden}</span>}
              {(() => {
                const ant = estadoLabel(m.estadoAnterior);
                const nue = estadoLabel(m.estadoNuevo);
                if (ant && nue && m.estadoAnterior !== m.estadoNuevo)
                  return <span className="ds-muted" style={{ fontWeight: 400 }}> · {ant} → {nue}</span>;
                if (nue)
                  return <span className="ds-muted" style={{ fontWeight: 400 }}> · {nue}</span>;
                return null;
              })()}
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
