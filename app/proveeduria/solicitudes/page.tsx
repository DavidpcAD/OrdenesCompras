"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, QtyRing, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { formatDate, pedidoBadge, recibidoDeLineaPedido, destinoCodigo, destinoLabel } from "@/lib/helpers";

type Filtro = "todas" | "borrador" | "aprobado" | "devuelto";

export default function ProveeduriaSolicitudesPage() {
  const { pedidos, ordenes } = useStore();
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [colF, setColF] = useState<Record<string, string>>({});
  const setCol = (k: string, v: string) => setColF((f) => ({ ...f, [k]: v }));

  function entregado(p: typeof pedidos[number]): { rec: number; total: number; pct: number } {
    const total = p.lineas.reduce((s, l) => s + l.cantidad, 0);
    const rec = p.lineas.reduce((s, l) => s + recibidoDeLineaPedido(ordenes, l.id), 0);
    return { rec, total, pct: total > 0 ? Math.round(Math.min(100, (rec / total) * 100)) : 0 };
  }

  const COLS = ["num", "tipo", "obra", "comentario", "solicitante", "fecha", "lineas", "prioridad", "estado", "entregado"];
  const prioLabel = (p: typeof pedidos[number]) => p.prioridad === "urgente" ? "Urgente" : p.prioridad === "alta" ? "Alta" : "Normal";
  const cellText = (p: typeof pedidos[number], k: string): string => {
    switch (k) {
      case "num": return p.numero;
      case "tipo": return p.tipoSolicitud === "repuesto" ? "Repuesto" : "Material";
      case "obra": return `${destinoCodigo(p)} ${destinoLabel(p)}`.trim();
      case "comentario": return p.notas ?? "";
      case "solicitante": return p.solicitante;
      case "fecha": return formatDate(p.fecha);
      case "lineas": return String(p.lineas.length);
      case "prioridad": return prioLabel(p);
      case "estado": return pedidoBadge(p.estado).label;
      case "entregado": return `${entregado(p).pct}%`;
      default: return "";
    }
  };

  const filtradas = pedidos
    .filter((p) => filtro === "todas" ? true : p.estado === filtro)
    .filter((p) => COLS.every((k) => { const v = (colF[k] ?? "").trim().toLowerCase(); return !v || cellText(p, k).toLowerCase().includes(v); }));

  const cuenta = (f: Filtro) => f === "todas" ? pedidos.length : pedidos.filter((p) => p.estado === f).length;

  return (
    <AppShell role="proveeduria">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Solicitudes de Ingeniería</h1>
            <p className="ds-muted">Todos los pedidos con su info, comentario y avance. Entrá a uno para crear la orden de compra o devolverlo.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={cuenta("todas")} label="Todas" onClick={() => setFiltro("todas")} active={filtro === "todas"} />
          <Tile value={cuenta("aprobado")} label="Aprobadas (por ordenar)" accent="var(--ds-color-green-200)" onClick={() => setFiltro("aprobado")} active={filtro === "aprobado"} />
          <Tile value={cuenta("borrador")} label="En borrador" accent="var(--ds-color-gray-100)" onClick={() => setFiltro("borrador")} active={filtro === "borrador"} />
          <Tile value={cuenta("devuelto")} label="Devueltas" accent="var(--ds-color-red-100)" onClick={() => setFiltro("devuelto")} active={filtro === "devuelto"} />
        </div>

        <Card className="mt-6" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>N.º</th><th>Tipo</th><th>Obra</th><th>Comentario</th><th>Solicitante</th><th>Fecha</th>
                  <th className="ds-num">Líneas</th><th>Prioridad</th><th>Estado</th><th>Entregado</th><th></th>
                </tr>
                <tr>
                  {COLS.map((k) => (
                    <th key={k} style={{ padding: "4px 6px", fontWeight: 400 }}>
                      <input value={colF[k] ?? ""} placeholder="Filtrar…" onChange={(e) => setCol(k, e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, padding: "4px 8px", fontSize: 12, font: "inherit", border: "1.5px solid var(--ds-color-gray-100)", background: "#fff", textAlign: k === "lineas" ? "right" : "left" }} />
                    </th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 && (
                  <tr><td colSpan={11}><div className="empty">No hay solicitudes que coincidan.</div></td></tr>
                )}
                {filtradas.map((p) => {
                  const b = pedidoBadge(p.estado);
                  const e = entregado(p);
                  return (
                    <tr key={p.id} className="is-clickable" onClick={() => router.push(`/proveeduria/solicitudes/${p.id}`)}>
                      <td className="ds-strong">{p.numero}</td>
                      <td>{p.tipoSolicitud === "repuesto" ? <Badge tone="yellow">Repuesto</Badge> : <Badge tone="green">Material</Badge>}</td>
                      <td>
                        <div className="ds-strong ds-body-sm">{destinoCodigo(p)}</div>
                        <div className="ds-muted ds-body-sm ds-truncate" style={{ maxWidth: 160 }} title={destinoLabel(p)}>{destinoLabel(p)}</div>
                      </td>
                      <td><div className="ds-body-sm ds-muted ds-truncate" style={{ maxWidth: 200 }} title={p.notas ?? ""}>{p.notas ? p.notas : "—"}</div></td>
                      <td>{p.solicitante}</td>
                      <td>{formatDate(p.fecha)}</td>
                      <td className="ds-num">{p.lineas.length}</td>
                      <td>{p.prioridad === "urgente" ? <Badge tone="red">Urgente</Badge> : p.prioridad === "alta" ? <Badge tone="yellow">Alta</Badge> : <Badge tone="gray">Normal</Badge>}</td>
                      <td><Badge tone={b.tone}>{b.label}</Badge></td>
                      <td><div className="row gap-3" style={{ alignItems: "center" }}><QtyRing recibida={e.rec} total={e.total} /><span className="ds-body-sm ds-muted">{e.pct}%</span></div></td>
                      <td className="ds-num">›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </AppShell>
  );
}
