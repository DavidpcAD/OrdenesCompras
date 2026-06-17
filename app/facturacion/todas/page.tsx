"use client";

import { AppShell } from "@/components/shell";
import { OrdenesLista } from "@/components/ordenes-lista";
import { useStore } from "@/lib/store";

export default function BodegaTodasPage() {
  const { ordenes } = useStore();
  // Las que llegaron (o están por llegar) a bodega: lanzadas y completadas.
  const lista = ordenes.filter((o) => o.estado === "lanzado" || o.estado === "completado");

  return (
    <AppShell role="facturacion">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Todas las órdenes</h1>
            <p className="ds-muted">Órdenes lanzadas y completadas. Hacé clic para ver el detalle, estados y las facturas asociadas.</p>
          </div>
        </div>
        <div className="mt-2">
          <OrdenesLista ordenes={lista} hrefDetalle={(id) => `/facturacion/ver/${id}`} vacio="Todavía no hay órdenes lanzadas o completadas." />
        </div>
      </main>
    </AppShell>
  );
}
