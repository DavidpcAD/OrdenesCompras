"use client";

import { useRouter } from "next/navigation";

// Toggle de vista para conceptos con dos granularidades (por documento / por línea):
// Órdenes ↔ Líneas pedidas, y Solicitudes ↔ Líneas por ordenar. Navega entre las
// dos rutas manteniendo el mismo concepto; cada vista trae su propio buscador/filtros.
export function VistaToggle({ opciones }: { opciones: { label: string; href: string; active: boolean }[] }) {
  const router = useRouter();
  return (
    <div className="segmented" role="tablist" aria-label="Ver por">
      {opciones.map((o) => (
        <button key={o.href} type="button" role="tab" aria-selected={o.active}
          className={`segmented__btn ${o.active ? "is-active" : ""}`}
          onClick={() => { if (!o.active) router.push(o.href); }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
