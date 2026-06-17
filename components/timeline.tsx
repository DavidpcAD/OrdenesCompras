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

function tono(tipo: string): string {
  if (["aprobado", "aprobado_lanzado", "recepcion_total", "completado"].includes(tipo)) return "var(--ds-color-green-100)";
  if (["enviado_aprobacion", "recepcion_parcial"].includes(tipo)) return "var(--ds-color-yellow)";
  if (["eliminado", "rechazado"].includes(tipo)) return "var(--ds-color-red-100)";
  return "var(--ds-color-gray-300)";
}

export function Timeline({ entidad, idEntidad }: { entidad: Movimiento["entidad"]; idEntidad: string }) {
  const { movimientos } = useStore();
  const items = movimientos
    .filter((m) => m.entidad === entidad && m.idEntidad === idEntidad)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

  if (items.length === 0) {
    return <div className="ds-muted ds-label">Sin movimientos registrados todavía.</div>;
  }

  return (
    <div className="timeline">
      {items.map((m) => (
        <div key={m.id} className="timeline__item">
          <span className="timeline__dot" style={{ background: tono(m.tipoMovimiento) }} />
          <div className="timeline__title">
            {LABEL[m.tipoMovimiento] ?? m.tipoMovimiento}
            {m.estadoAnterior && m.estadoNuevo && m.estadoAnterior !== m.estadoNuevo && (
              <span className="ds-muted" style={{ fontWeight: 400 }}> · {m.estadoAnterior} → {m.estadoNuevo}</span>
            )}
          </div>
          <div className="timeline__meta">
            {m.usuario} · {ROL_LABEL[m.rol]} · {formatDateTime(m.fecha)}{m.detalle ? ` · ${m.detalle}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
