"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Card, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { num, formatDate, destinoCodigo } from "@/lib/helpers";
import type { PedidoEstado } from "@/lib/types";

const PED_BADGE: Record<PedidoEstado, { label: string; tone: string }> = {
  borrador: { label: "Borrador", tone: "gray" },
  aprobado: { label: "Aprobada", tone: "green" },
  en_orden: { label: "En orden", tone: "yellow" },
  cerrado: { label: "Recibida", tone: "green" },
  devuelto: { label: "Devuelta", tone: "red" },
};

// Dashboard de Ingeniería, para quien PIDE materiales (Laura): estado de sus
// solicitudes, los materiales que más pide y en qué obras. Todo con datos locales
// (instantáneo, sin consultar el stock de BC).
export default function DashboardPage() {
  const { pedidos } = useStore();
  const router = useRouter();

  const k = useMemo(() => ({
    total: pedidos.length,
    borradores: pedidos.filter((p) => p.estado === "borrador").length,
    enProceso: pedidos.filter((p) => p.estado === "aprobado" || p.estado === "en_orden").length,
    recibidas: pedidos.filter((p) => p.estado === "cerrado").length,
  }), [pedidos]);

  // Materiales que más pide (por cantidad total solicitada).
  const topMateriales = useMemo(() => {
    const m = new Map<string, { desc: string; cantidad: number; veces: number; unidad: string }>();
    for (const p of pedidos) for (const l of p.lineas) {
      const key = l.articuloId || l.descripcion;
      const e = m.get(key) ?? { desc: l.descripcion, cantidad: 0, veces: 0, unidad: l.unidad };
      e.cantidad += l.cantidad; e.veces += 1;
      m.set(key, e);
    }
    const arr = [...m.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 8);
    const max = arr.reduce((mx, x) => Math.max(mx, x.cantidad), 0) || 1;
    return { arr, max };
  }, [pedidos]);

  // Solicitudes por obra/destino.
  const porObra = useMemo(() => {
    const m = new Map<string, { obra: string; solic: number; lineas: number }>();
    for (const p of pedidos) {
      const key = destinoCodigo(p);
      const e = m.get(key) ?? { obra: key, solic: 0, lineas: 0 };
      e.solic += 1; e.lineas += p.lineas.length;
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.solic - a.solic).slice(0, 6);
  }, [pedidos]);

  const recientes = useMemo(
    () => [...pedidos].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")).slice(0, 6),
    [pedidos]
  );

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Dashboard</h1>
            <p className="ds-muted">Tus solicitudes de material: estado, lo que más pedís y en qué obras.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={k.total} label="Solicitudes" className="ds-reveal" style={{ "--ds-reveal-i": 0 } as React.CSSProperties} />
          <Tile value={k.borradores} label="Borradores (por enviar)" accent="var(--ds-color-yellow)" className="ds-reveal" style={{ "--ds-reveal-i": 1 } as React.CSSProperties} />
          <Tile value={k.enProceso} label="En proceso" accent="var(--ds-color-green-100)" className="ds-reveal" style={{ "--ds-reveal-i": 2 } as React.CSSProperties} />
          <Tile value={k.recibidas} label="Recibidas" accent="var(--ds-color-green-200)" className="ds-reveal" style={{ "--ds-reveal-i": 3 } as React.CSSProperties} />
        </div>

        {/* Materiales que más pido */}
        <Card className="mt-6 ds-reveal">
          <h2 className="ds-subtitle" style={{ marginBottom: 4 }}>Materiales que más pedís</h2>
          <p className="ds-muted ds-body-sm" style={{ marginTop: 0, marginBottom: 12 }}>Por cantidad total solicitada en todas tus solicitudes.</p>
          {topMateriales.arr.length === 0 ? (
            <div className="empty" style={{ padding: "12px 0" }}>Aún no hay solicitudes. Creá la primera en “Mis solicitudes”.</div>
          ) : (
            <div className="col">
              {topMateriales.arr.map((m, i) => (
                <div key={m.desc + i} className="col" style={{ gap: 6, padding: "10px 0", borderTop: i ? "1px solid var(--ds-color-gray-100)" : "none" }}>
                  <div className="row row--between gap-3">
                    <span className="ds-strong ds-truncate" title={m.desc} style={{ maxWidth: "70%" }}>{m.desc}</span>
                    <span className="ds-strong" style={{ whiteSpace: "nowrap" }}>{num.format(m.cantidad)} {m.unidad}</span>
                  </div>
                  <div className="row gap-3" style={{ alignItems: "center" }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 999, background: "var(--ds-color-gray-100)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.round((m.cantidad / topMateriales.max) * 100)}%`, background: "var(--ds-color-green-100)", borderRadius: 999 }} />
                    </div>
                    <span className="ds-muted ds-body-sm" style={{ whiteSpace: "nowrap" }}>{m.veces} pedido{m.veces === 1 ? "" : "s"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid-2 mt-4">
          {/* Por obra */}
          <Card className="ds-reveal">
            <h2 className="ds-subtitle" style={{ marginBottom: 12 }}>Solicitudes por obra</h2>
            {porObra.length === 0 ? (
              <div className="empty" style={{ padding: "12px 0" }}>Sin datos.</div>
            ) : (
              <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
                <table className="ds-table">
                  <thead><tr><th>Obra / destino</th><th className="ds-num">Solicitudes</th><th className="ds-num">Líneas</th></tr></thead>
                  <tbody>
                    {porObra.map((o) => (
                      <tr key={o.obra}>
                        <td className="ds-strong">{o.obra}</td>
                        <td className="ds-num">{num.format(o.solic)}</td>
                        <td className="ds-num ds-muted">{num.format(o.lineas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Actividad reciente */}
          <Card className="ds-reveal">
            <h2 className="ds-subtitle" style={{ marginBottom: 12 }}>Actividad reciente</h2>
            {recientes.length === 0 ? (
              <div className="empty" style={{ padding: "12px 0" }}>Sin solicitudes todavía.</div>
            ) : (
              <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
                <table className="ds-table">
                  <thead><tr><th>Solicitud</th><th>Fecha</th><th className="ds-num">Líneas</th><th>Estado</th></tr></thead>
                  <tbody>
                    {recientes.map((p) => {
                      const b = PED_BADGE[p.estado] ?? { label: p.estado, tone: "gray" };
                      return (
                        <tr key={p.id} className="is-clickable" style={{ cursor: "pointer" }} onClick={() => router.push(`/ingenieria/${p.id}`)}>
                          <td className="ds-strong">{p.numero}<div className="ds-body-sm ds-muted">{destinoCodigo(p)}</div></td>
                          <td className="ds-body-sm">{formatDate(p.fecha)}</td>
                          <td className="ds-num">{p.lineas.length}</td>
                          <td><Badge tone={b.tone}>{b.label}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </main>
    </AppShell>
  );
}
