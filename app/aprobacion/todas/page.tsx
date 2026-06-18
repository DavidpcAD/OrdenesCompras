"use client";

import { useRef, useState } from "react";
import { AppShell } from "@/components/shell";
import { Tile } from "@/components/ui";
import { OrdenesLista } from "@/components/ordenes-lista";
import { useStore } from "@/lib/store";

type Filtro = "todas" | "pendiente_aprobacion" | "lanzado" | "completado";

export default function AprobacionTodasPage() {
  const { ordenes } = useStore();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const listaRef = useRef<HTMLDivElement>(null);

  function seleccionar(f: Filtro) {
    setFiltro(f);
    setTimeout(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  // Las que pasaron por aprobación (no las que siguen en proveeduría).
  const base = ordenes.filter((o) => o.estado !== "abierto");
  const pend = base.filter((o) => o.estado === "pendiente_aprobacion").length;
  const lanz = base.filter((o) => o.estado === "lanzado").length;
  const comp = base.filter((o) => o.estado === "completado").length;

  const lista = base.filter((o) => (filtro === "todas" ? true : o.estado === filtro));
  const etiqueta: Record<Filtro, string> = {
    todas: "Todas las órdenes",
    pendiente_aprobacion: "Pendientes de aprobación",
    lanzado: "Lanzadas (aprobadas)",
    completado: "Completadas",
  };

  return (
    <AppShell role="aprobacion">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Todas las órdenes</h1>
            <p className="ds-muted">Tocá un panel para filtrar. Clic en una orden para ver su detalle, estados y facturas.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={base.length} label="Órdenes totales" onClick={() => seleccionar("todas")} active={filtro === "todas"} />
          <Tile value={pend} label="Pendientes de aprobación" accent="var(--ds-color-yellow)" onClick={() => seleccionar("pendiente_aprobacion")} active={filtro === "pendiente_aprobacion"} />
          <Tile value={lanz} label="Lanzadas (aprobadas)" accent="var(--ds-color-green-100)" onClick={() => seleccionar("lanzado")} active={filtro === "lanzado"} />
          <Tile value={comp} label="Completadas" accent="var(--ds-color-green-200)" onClick={() => seleccionar("completado")} active={filtro === "completado"} />
        </div>

        <div ref={listaRef} className="row row--between mt-6" style={{ marginBottom: 12, alignItems: "baseline", scrollMarginTop: 80 }}>
          <span className="ds-label ds-muted">{etiqueta[filtro]}</span>
          {filtro !== "todas" && <button className="link-btn" onClick={() => setFiltro("todas")}>Ver todas</button>}
        </div>

        <OrdenesLista key={filtro} ordenes={lista} hrefDetalle={(id) => `/aprobacion/${id}`} vacio="No hay órdenes en esta categoría." />
      </main>
    </AppShell>
  );
}
