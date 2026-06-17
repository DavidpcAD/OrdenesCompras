"use client";

import { AppShell } from "@/components/shell";
import { OrdenesLista } from "@/components/ordenes-lista";
import { useStore } from "@/lib/store";

export default function AprobacionTodasPage() {
  const { ordenes } = useStore();
  // Las que pasaron por aprobación: pendientes, lanzadas (aprobadas) y completadas.
  const lista = ordenes.filter((o) => o.estado !== "abierto");

  return (
    <AppShell role="aprobacion">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Todas las órdenes</h1>
            <p className="ds-muted">Órdenes que enviaste a aprobación, las que aprobaste (lanzadas) y las completadas. Hacé clic para ver el detalle, estados y facturas.</p>
          </div>
        </div>
        <div className="mt-2">
          <OrdenesLista ordenes={lista} hrefDetalle={(id) => `/aprobacion/${id}`} vacio="Todavía no hay órdenes que hayan pasado por aprobación." />
        </div>
      </main>
    </AppShell>
  );
}
