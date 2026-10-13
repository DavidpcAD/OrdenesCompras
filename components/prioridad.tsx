"use client";

import type { Prioridad } from "@/lib/types";

// Las tres prioridades, en orden de menor a mayor. `tono` es el del distintivo
// (ds-badge) y el del puntito del selector, así que el color que se elige al armar
// es el mismo que Aprobación ve en el detalle.
export const PRIORIDADES: { value: Prioridad; label: string; tono: "gray" | "yellow" | "red" }[] = [
  { value: "normal", label: "Normal", tono: "gray" },
  { value: "alta", label: "Alta", tono: "yellow" },
  { value: "urgente", label: "Urgente", tono: "red" },
];

// El distintivo que ve quien revisa. "normal" es lo de siempre: no devuelve nada
// para no meter ruido en el encabezado (igual criterio que el PDF de la solicitud,
// que solo imprime la prioridad cuando no es normal).
export function badgePrioridad(p?: Prioridad): { tone: "yellow" | "red"; label: string } | null {
  if (p === "urgente") return { tone: "red", label: "Urgente" };
  if (p === "alta") return { tone: "yellow", label: "Prioridad alta" };
  return null;
}

// El "tag" para armar/editar la orden: un segmentado (el mismo primitivo que el
// resto de la app) con un puntito del color de cada nivel. Controlado.
export function PrioridadTag({ value, onChange }: { value: Prioridad; onChange: (p: Prioridad) => void }) {
  return (
    <div className="segmented prioridad-seg" role="group" aria-label="Prioridad de la orden">
      {PRIORIDADES.map((p) => (
        <button key={p.value} type="button" aria-pressed={value === p.value}
          className={`segmented__btn ${value === p.value ? "is-active" : ""}`}
          onClick={() => onChange(p.value)}>
          <span className="prioridad-seg__dot" data-tono={p.tono} aria-hidden />
          {p.label}
        </button>
      ))}
    </div>
  );
}
