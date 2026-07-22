"use client";

import { useRef, useState } from "react";
import { AppShell } from "@/components/shell";
import { Tile } from "@/components/ui";
import { OrdenesLista } from "@/components/ordenes-lista";
import { useStore } from "@/lib/store";

type Filtro = "todas" | "lanzado" | "completado";

export default function BodegaTodasPage() {
  const { ordenes } = useStore();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const listaRef = useRef<HTMLDivElement>(null);

  function seleccionar(f: Filtro) {
    setFiltro(f);
    setTimeout(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  // Las que llegaron (o están por llegar) a bodega.
  const base = ordenes.filter((o) => o.estado === "lanzado" || o.estado === "completado");
  const porRecibir = base.filter((o) => o.estado === "lanzado").length;
  const comp = base.filter((o) => o.estado === "completado").length;

  const lista = base.filter((o) => (filtro === "todas" ? true : o.estado === filtro));
  const etiqueta: Record<Filtro, string> = {
    todas: "Todas las órdenes",
    lanzado: "Por recibir (lanzadas)",
    completado: "Completadas",
  };

  return (
    <AppShell role="contabilidad">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Todas las órdenes</h1>
            <p className="ds-muted">Tocá un panel para filtrar. Clic en una orden para ver su detalle, estados y las facturas asociadas.</p>
          </div>
        </div>

        <div className="tiles mt-2" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <Tile value={base.length} label="Órdenes totales" onClick={() => seleccionar("todas")} active={filtro === "todas"} />
          <Tile value={porRecibir} label="Por recibir (lanzadas)" accent="var(--ds-color-yellow)" onClick={() => seleccionar("lanzado")} active={filtro === "lanzado"} />
          <Tile value={comp} label="Completadas" accent="var(--ds-color-green-200)" onClick={() => seleccionar("completado")} active={filtro === "completado"} />
        </div>

        <div ref={listaRef} className="row row--between mt-6" style={{ marginBottom: 12, alignItems: "baseline", scrollMarginTop: 80 }}>
          <span className="ds-label ds-muted">{etiqueta[filtro]}</span>
          {filtro !== "todas" && <button className="link-btn" onClick={() => setFiltro("todas")}>Ver todas</button>}
        </div>

        <OrdenesLista key={filtro} ordenes={lista} hrefDetalle={(id) => `/facturacion/ver/${id}`} vacio="No hay órdenes en esta categoría." />
      </main>
    </AppShell>
  );
}
