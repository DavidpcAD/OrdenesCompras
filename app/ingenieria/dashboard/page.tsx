"use client";

import { useMemo } from "react";
import { AppShell } from "@/components/shell";
import { Card, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";

// Dashboard en tiempo real con datos de la app (solicitudes/órdenes/recepción).
// La parte "contra inventario" (faltantes, cobertura, reorden) depende de las
// existencias de BC (pendiente).
export default function DashboardPage() {
  const { pedidos, ordenes } = useStore();

  const k = useMemo(() => {
    let ordCant = 0, recCant = 0;
    for (const o of ordenes) for (const l of o.lineas) {
      if (l.tipo !== "articulo") continue;
      ordCant += l.cantidad; recCant += l.cantidadRecibida ?? 0;
    }
    const pct = ordCant > 0 ? Math.round((recCant / ordCant) * 100) : 0;
    return { solic: pedidos.length, orden: ordenes.length, pct, pend: Math.max(0, ordCant - recCant) };
  }, [pedidos, ordenes]);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Dashboard</h1>
            <p className="ds-muted">Resumen en tiempo real de solicitudes, órdenes y recepción. Los indicadores contra inventario se conectan a Business Central.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={k.solic} label="Solicitudes" />
          <Tile value={k.orden} label="Órdenes de compra" accent="var(--ds-color-yellow)" />
          <Tile value={`${k.pct}%`} label="Recibido (global)" accent="var(--ds-color-green-200)" />
          <Tile value={k.pend} label="Pendiente por recibir" accent="var(--ds-color-red-100)" />
        </div>

        <h2 className="ds-subtitle" style={{ marginTop: 28 }}>Contra inventario</h2>
        <Card className="mt-2" style={{ borderLeft: "4px solid var(--ds-color-yellow)" }}>
          <div className="ds-strong">Faltantes, cobertura y sugerencia de reorden: pendiente de conectar a BC</div>
          <div className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>Estos indicadores se calculan contra las existencias reales por almacén. Se activan cuando BC exponga el stock por ubicación y el punto de reorden de cada artículo.</div>
        </Card>
      </main>
    </AppShell>
  );
}
