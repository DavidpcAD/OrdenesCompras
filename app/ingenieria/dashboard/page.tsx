"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Card } from "@/components/ui";
import { useStore } from "@/lib/store";
import { num, formatDate, destinoCodigo } from "@/lib/helpers";
import type { PedidoEstado } from "@/lib/types";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const ESTADOS: { key: PedidoEstado; label: string; color: string; tone: string }[] = [
  { key: "borrador", label: "Borrador", color: "var(--ds-color-gray-300)", tone: "gray" },
  { key: "aprobado", label: "Aprobada", color: "var(--ds-color-green-200)", tone: "green" },
  { key: "en_orden", label: "En orden", color: "var(--ds-color-yellow)", tone: "yellow" },
  { key: "cerrado", label: "Recibida", color: "var(--ds-color-green-100)", tone: "green" },
  { key: "devuelto", label: "Devuelta", color: "var(--ds-color-red-100)", tone: "red" },
];

function weekStartISO(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();
  const mondayOffset = (dow + 6) % 7;
  x.setDate(x.getDate() - mondayOffset);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function MiniBars({ values }: { values: number[] }) {
  const max = values.reduce((mx, v) => Math.max(mx, v), 0) || 1;
  return (
    <div className="ana-mini-bars" aria-hidden>
      {values.map((v, i) => (
        <span key={i} style={{ height: `${Math.max(8, Math.round((v / max) * 48))}px` }} />
      ))}
    </div>
  );
}

// Barra horizontal (material / obra) con ranking opcional.
function BarRow({ label, right, sub, value, max, i, rank }: { label: string; right: string; sub?: string; value: number; max: number; i: number; rank?: number }) {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="col" style={{ gap: 7, padding: "11px 0", borderTop: i ? "1px solid var(--ds-color-gray-100)" : "none" }}>
      <div className="row row--between gap-3" style={{ alignItems: "center" }}>
        <span className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
          {rank != null && (
            <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 999, background: "var(--ds-color-gray-100)", color: "var(--ds-color-gray-500)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{rank}</span>
          )}
          <span className="ds-strong ds-truncate" title={label}>{label}</span>
        </span>
        <span className="ds-strong" style={{ whiteSpace: "nowrap" }}>{right}</span>
      </div>
      <div className="row gap-3" style={{ alignItems: "center" }}>
        <div style={{ flex: 1, height: 9, borderRadius: 999, background: "var(--ds-color-gray-100)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, var(--ds-color-green-100), var(--ds-color-green-200))", borderRadius: 999 }} />
        </div>
        {sub && <span className="ds-muted ds-body-sm" style={{ whiteSpace: "nowrap", minWidth: 62, textAlign: "right" }}>{sub}</span>}
      </div>
    </div>
  );
}

// Dashboard de Ingeniería (para quien pide material): KPIs y gráficos de sus
// solicitudes. Todo con datos locales (instantáneo, sin consultar stock de BC).
export default function DashboardPage() {
  const { pedidos } = useStore();
  const router = useRouter();

  const kpi = useMemo(() => {
    const materiales = new Set<string>(), obras = new Set<string>();
    let lineas = 0;
    for (const p of pedidos) {
      lineas += p.lineas.length;
      obras.add(destinoCodigo(p));
      for (const l of p.lineas) materiales.add(l.articuloId || l.descripcion);
    }
    return { total: pedidos.length, lineas, materiales: materiales.size, obras: obras.size };
  }, [pedidos]);

  const estados = useMemo(() => {
    const c = ESTADOS.map((e) => ({ ...e, count: pedidos.filter((p) => p.estado === e.key).length }));
    const total = c.reduce((s, x) => s + x.count, 0) || 1;
    return { c, total };
  }, [pedidos]);

  const topMateriales = useMemo(() => {
    const m = new Map<string, { desc: string; cantidad: number; veces: number; unidad: string }>();
    for (const p of pedidos) for (const l of p.lineas) {
      const key = l.articuloId || l.descripcion;
      const e = m.get(key) ?? { desc: l.descripcion, cantidad: 0, veces: 0, unidad: l.unidad };
      e.cantidad += l.cantidad; e.veces += 1; m.set(key, e);
    }
    const arr = [...m.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 6);
    return { arr, max: arr.reduce((mx, x) => Math.max(mx, x.cantidad), 0) || 1 };
  }, [pedidos]);

  const porObra = useMemo(() => {
    const m = new Map<string, { obra: string; solic: number; lineas: number }>();
    for (const p of pedidos) {
      const k = destinoCodigo(p);
      const e = m.get(k) ?? { obra: k, solic: 0, lineas: 0 };
      e.solic += 1; e.lineas += p.lineas.length; m.set(k, e);
    }
    const arr = [...m.values()].sort((a, b) => b.solic - a.solic).slice(0, 6);
    return { arr, max: arr.reduce((mx, x) => Math.max(mx, x.solic), 0) || 1 };
  }, [pedidos]);

  // Actividad por mes (últimos meses con solicitudes).
  const porMes = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pedidos) {
      const ym = (p.fecha || "").slice(0, 7); // YYYY-MM
      if (ym) m.set(ym, (m.get(ym) ?? 0) + 1);
    }
    const arr = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6)
      .map(([ym, count]) => ({ label: MESES[Number(ym.slice(5, 7)) - 1] ?? ym, count }));
    return { arr, max: arr.reduce((mx, x) => Math.max(mx, x.count), 0) || 1 };
  }, [pedidos]);

  const semanal = useMemo(() => {
    const now = new Date();
    const weeks: { key: string; label: string; count: number }[] = [];
    for (let i = 7; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
      const key = weekStartISO(d);
      weeks.push({ key, label: key.slice(5), count: 0 });
    }
    const idx = new Map<string, number>(weeks.map((w, i) => [w.key, i]));
    for (const p of pedidos) {
      if (!p.fecha) continue;
      const w = weekStartISO(new Date(`${p.fecha}T00:00:00`));
      const i = idx.get(w);
      if (i != null) weeks[i].count += 1;
    }
    return weeks;
  }, [pedidos]);

  const tasaAtendidas = useMemo(() => {
    if (pedidos.length === 0) return 0;
    const atendidas = pedidos.filter((p) => p.estado === "aprobado" || p.estado === "en_orden" || p.estado === "cerrado").length;
    return Math.round((atendidas / pedidos.length) * 100);
  }, [pedidos]);

  const lineasPromedio = kpi.total > 0 ? (kpi.lineas / kpi.total) : 0;

  const recientes = useMemo(
    () => [...pedidos].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")).slice(0, 8),
    [pedidos]
  );

  // Materiales distintos (todos, para el drill-down del KPI).
  const materialesDistintos = useMemo(() => {
    const m = new Map<string, { desc: string; cantidad: number; veces: number; unidad: string }>();
    for (const p of pedidos) for (const l of p.lineas) {
      const key = l.articuloId || l.descripcion;
      const e = m.get(key) ?? { desc: l.descripcion, cantidad: 0, veces: 0, unidad: l.unidad };
      e.cantidad += l.cantidad; e.veces += 1; m.set(key, e);
    }
    const arr = [...m.values()].sort((a, b) => b.veces - a.veces || b.cantidad - a.cantidad);
    return { arr, max: arr.reduce((mx, x) => Math.max(mx, x.veces), 0) || 1 };
  }, [pedidos]);

  // KPI seleccionado → panel de detalle (drill-down).
  const [kpiSel, setKpiSel] = useState<"solicitudes" | "lineas" | "materiales" | "obras">("solicitudes");

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Dashboard</h1>
            <p className="ds-muted">Vista ejecutiva de solicitudes: pipeline, ritmo de carga y materiales críticos.</p>
          </div>
        </div>

        <div className="ana-kpis mt-2">
          {([
            { k: "solicitudes", label: "Solicitudes", value: kpi.total, sub: `${tasaAtendidas}% con pedido`, bars: semanal.map((w) => w.count) },
            { k: "lineas", label: "Líneas pedidas", value: kpi.lineas, sub: `${lineasPromedio.toFixed(1)} por solicitud`, bars: porMes.arr.map((m) => m.count) },
            { k: "materiales", label: "Materiales distintos", value: kpi.materiales, sub: "Tocá para ver el detalle", bars: topMateriales.arr.map((m) => m.cantidad) },
            { k: "obras", label: "Obras activas", value: kpi.obras, sub: "Carga por destino", bars: porObra.arr.map((o) => o.solic) },
          ] as const).map((c, i) => (
            <button key={c.k} type="button" onClick={() => setKpiSel(c.k)}
              className={`ana-kpi ds-card ds-reveal${kpiSel === c.k ? " is-selected" : ""}`}
              aria-pressed={kpiSel === c.k} style={{ "--ds-reveal-i": i, textAlign: "left", cursor: "pointer" } as React.CSSProperties}>
              <span className="ana-kpi__label">{c.label}</span>
              <span className="ana-kpi__value">{c.value}</span>
              <span className="ana-kpi__sub">{c.sub}</span>
              <MiniBars values={c.bars} />
            </button>
          ))}
        </div>

        {/* Drill-down del KPI seleccionado */}
        <Card className="mt-4 ana-panel">
          {kpiSel === "solicitudes" && (<>
            <h2 className="ds-subtitle" style={{ marginBottom: 8 }}>Solicitudes recientes</h2>
            {recientes.length === 0 ? <div className="empty" style={{ padding: "12px 0" }}>Sin solicitudes todavía.</div> : (
              <div className="col">
                {recientes.map((p, i) => {
                  const e = ESTADOS.find((x) => x.key === p.estado);
                  return (
                    <div key={p.id} className="row row--between gap-3 is-clickable" style={{ cursor: "pointer", padding: "10px 0", borderTop: i ? "1px solid var(--ds-color-gray-100)" : "none" }} onClick={() => router.push(`/ingenieria/${p.id}`)}>
                      <div className="col" style={{ gap: 2 }}>
                        <span className="ds-strong" style={{ whiteSpace: "nowrap" }}>{p.numero}</span>
                        <span className="ds-muted ds-body-sm">{destinoCodigo(p)} · {formatDate(p.fecha)} · {p.lineas.length} línea{p.lineas.length === 1 ? "" : "s"}</span>
                      </div>
                      <Badge tone={e?.tone ?? "gray"}>{e?.label ?? p.estado}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </>)}
          {kpiSel === "lineas" && (<>
            <h2 className="ds-subtitle" style={{ marginBottom: 4 }}>Materiales que más pedís</h2>
            <p className="ds-muted ds-body-sm" style={{ marginTop: 0, marginBottom: 8 }}>Por cantidad total solicitada.</p>
            {topMateriales.arr.length === 0 ? <div className="empty" style={{ padding: "12px 0" }}>Aún no hay solicitudes.</div> : (
              <div className="col">
                {topMateriales.arr.map((m, i) => (
                  <BarRow key={m.desc + i} i={i} rank={i + 1} label={m.desc} right={`${num.format(m.cantidad)} ${m.unidad}`} sub={`${m.veces} pedido${m.veces === 1 ? "" : "s"}`} value={m.cantidad} max={topMateriales.max} />
                ))}
              </div>
            )}
          </>)}
          {kpiSel === "materiales" && (<>
            <h2 className="ds-subtitle" style={{ marginBottom: 4 }}>Materiales distintos</h2>
            <p className="ds-muted ds-body-sm" style={{ marginTop: 0, marginBottom: 8 }}>Ordenados por cuántas veces los pedís.</p>
            {materialesDistintos.arr.length === 0 ? <div className="empty" style={{ padding: "12px 0" }}>Sin datos.</div> : (
              <div className="col">
                {materialesDistintos.arr.slice(0, 12).map((m, i) => (
                  <BarRow key={m.desc + i} i={i} rank={i + 1} label={m.desc} right={`${m.veces} vez${m.veces === 1 ? "" : "ces"}`} sub={`${num.format(m.cantidad)} ${m.unidad}`} value={m.veces} max={materialesDistintos.max} />
                ))}
                {materialesDistintos.arr.length > 12 && <p className="ds-muted ds-body-sm" style={{ marginTop: 8 }}>+{materialesDistintos.arr.length - 12} más</p>}
              </div>
            )}
          </>)}
          {kpiSel === "obras" && (<>
            <h2 className="ds-subtitle" style={{ marginBottom: 8 }}>Solicitudes por obra</h2>
            {porObra.arr.length === 0 ? <div className="empty" style={{ padding: "12px 0" }}>Sin datos.</div> : (
              <div className="col">
                {porObra.arr.map((o, i) => (
                  <BarRow key={o.obra} i={i} rank={i + 1} label={o.obra} right={`${o.solic} solic.`} sub={`${o.lineas} línea${o.lineas === 1 ? "" : "s"}`} value={o.solic} max={porObra.max} />
                ))}
              </div>
            )}
          </>)}
        </Card>

        <div className="grid-2 mt-4">
          <Card className="ds-reveal ana-panel" style={{ "--ds-reveal-i": 4 } as React.CSSProperties}>
            <h2 className="ds-subtitle" style={{ marginBottom: 12 }}>Pipeline de solicitudes</h2>
            <div style={{ display: "flex", height: 16, borderRadius: 999, overflow: "hidden", background: "var(--ds-color-gray-100)" }}>
              {estados.c.map((e) => e.count > 0 && (
                <div key={e.key} title={`${e.label}: ${e.count}`} style={{ width: `${(e.count / estados.total) * 100}%`, background: e.color }} />
              ))}
            </div>
            <div className="row gap-4 wrap mt-4">
              {estados.c.map((e) => (
                <div key={e.key} className="row gap-2" style={{ alignItems: "center" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: e.color, flexShrink: 0 }} />
                  <span className="ds-body-sm">{e.label}</span>
                  <span className="ds-strong ds-body-sm">{e.count}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="ds-reveal ana-panel" style={{ "--ds-reveal-i": 5 } as React.CSSProperties}>
            <h2 className="ds-subtitle" style={{ marginBottom: 12 }}>Actividad mensual</h2>
            {porMes.arr.length === 0 ? (
              <div className="empty" style={{ padding: "12px 0" }}>Sin datos.</div>
            ) : (
              <div className="row" style={{ alignItems: "flex-end", gap: 14, height: 150, padding: "0 4px" }}>
                {porMes.arr.map((mm, i) => (
                  <div key={i} className="col" style={{ flex: 1, alignItems: "center", gap: 8, height: "100%", justifyContent: "flex-end" }}>
                    <span className="ds-strong ds-body-sm">{mm.count}</span>
                    <div style={{ width: "100%", maxWidth: 40, height: `${Math.max(6, (mm.count / porMes.max) * 110)}px`, background: "var(--ds-color-green-100)", borderRadius: "8px 8px 0 0" }} />
                    <span className="ds-muted ds-body-sm" style={{ textTransform: "capitalize" }}>{mm.label}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

      </main>
    </AppShell>
  );
}
