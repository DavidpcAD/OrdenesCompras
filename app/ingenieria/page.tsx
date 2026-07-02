"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, QtyRing, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { formatDate, pedidoBadge, pedidoCompraBadge, pedidoOrdenadoPct, recibidoDeLineaPedido, tipoSolicitudBadge } from "@/lib/helpers";

type Filtro = "todas" | "material" | "repuesto" | "aprobado";

export default function IngenieriaPage() {
  const { pedidos, ordenes } = useStore();

  // % entregado del pedido = lo recibido (en órdenes) / lo solicitado.
  function entregadoPct(p: typeof pedidos[number]): number {
    const total = p.lineas.reduce((s, l) => s + l.cantidad, 0);
    if (total <= 0) return 0;
    const rec = p.lineas.reduce((s, l) => s + recibidoDeLineaPedido(ordenes, l.id), 0);
    return Math.round(Math.min(100, (rec / total) * 100));
  }
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [colF, setColF] = useState<Record<string, string>>({});
  const setCol = (k: string, v: string) => setColF((f) => ({ ...f, [k]: v }));
  const PAGINA = 50;
  const [limite, setLimite] = useState(PAGINA);
  const listaRef = useRef<HTMLDivElement>(null);

  function seleccionar(f: Filtro) {
    setFiltro(f);
    setLimite(PAGINA);
    // bajar a la lista para que se vea de inmediato lo filtrado
    setTimeout(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  const material = pedidos.filter((p) => p.tipoSolicitud === "material").length;
  const repuesto = pedidos.filter((p) => p.tipoSolicitud === "repuesto").length;
  const aprobados = pedidos.filter((p) => p.estado === "aprobado").length;

  const COLS = ["num", "tipo", "destino", "comentario", "solicitante", "fecha", "lineas", "prioridad", "estado", "compra", "entregado"];
  const prioLabel = (p: typeof pedidos[number]) => p.prioridad === "urgente" ? "Urgente" : p.prioridad === "alta" ? "Alta" : "Normal";
  // Código y nombre del destino (obra o máquina) de un pedido.
  const destCodigo = (p: typeof pedidos[number]) => (p.tipoSolicitud === "repuesto" ? p.maquinaNo : p.obraCodigo) ?? "—";
  const destNombre = (p: typeof pedidos[number]) => (p.tipoSolicitud === "repuesto" ? p.maquinaNombre : p.obraNombre) ?? "";
  const cellText = (p: typeof pedidos[number], k: string): string => {
    switch (k) {
      case "num": return p.numero;
      case "tipo": return tipoSolicitudBadge(p.tipoSolicitud).label;
      case "destino": return `${destCodigo(p)} ${destNombre(p)}`.trim();
      case "comentario": return p.notas ?? "";
      case "solicitante": return p.solicitante;
      case "fecha": return formatDate(p.fecha);
      case "lineas": return String(p.lineas.length);
      case "prioridad": return prioLabel(p);
      case "estado": return pedidoBadge(p.estado).label;
      case "compra": return pedidoCompraBadge(p).label;
      case "entregado": return `${entregadoPct(p)}%`;
      default: return "";
    }
  };

  const filtradas = pedidos
    .filter((p) =>
      filtro === "material" ? p.tipoSolicitud === "material"
        : filtro === "repuesto" ? p.tipoSolicitud === "repuesto"
        : filtro === "aprobado" ? p.estado === "aprobado"
        : true
    )
    .filter((p) => COLS.every((k) => { const v = (colF[k] ?? "").trim().toLowerCase(); return !v || cellText(p, k).toLowerCase().includes(v); }));
  const visibles = filtradas.slice(0, limite);
  const etiquetaFiltro: Record<Filtro, string> = {
    todas: "Todas las solicitudes",
    material: "Solicitudes de material",
    repuesto: "Solicitudes de repuesto",
    aprobado: "Solicitudes aprobadas",
  };

  return (
    <AppShell role="ingenieria">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Mis solicitudes de material</h1>
            <p className="ds-muted">Pedí material para una obra o repuestos para una máquina. Proveeduría se encarga del proveedor.</p>
          </div>
          <Link href="/ingenieria/nuevo"><Button>+ Nueva solicitud</Button></Link>
        </div>

        <div className="tiles mt-2">
          <Tile value={pedidos.length} label="Solicitudes totales" onClick={() => seleccionar("todas")} active={filtro === "todas"} />
          <Tile value={material} label="De material (obra)" accent="var(--ds-color-green-100)" onClick={() => seleccionar("material")} active={filtro === "material"} />
          <Tile value={repuesto} label="De repuesto (máquina)" accent="var(--ds-color-yellow)" onClick={() => seleccionar("repuesto")} active={filtro === "repuesto"} />
          <Tile value={aprobados} label="Aprobadas" accent="var(--ds-color-green-200)" onClick={() => seleccionar("aprobado")} active={filtro === "aprobado"} />
        </div>

        <div ref={listaRef} className="row row--between wrap gap-3 mt-6" style={{ marginBottom: 12, alignItems: "center", scrollMarginTop: 80 }}>
          <span className="ds-label ds-muted">{etiquetaFiltro[filtro]} · {filtradas.length}</span>
          {filtro !== "todas" && <button className="link-btn" onClick={() => setFiltro("todas")}>Ver todas</button>}
        </div>

        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>N.º</th><th>Tipo</th><th>Destino</th><th>Comentario</th><th>Solicitante</th><th>Fecha</th>
                  <th className="ds-num">Líneas</th><th>Prioridad</th><th>Estado</th><th>Compra</th><th>Entregado</th><th></th>
                </tr>
                <tr>
                  {COLS.map((k) => (
                    <th key={k} style={{ padding: "4px 6px", fontWeight: 400 }}>
                      <input value={colF[k] ?? ""} placeholder="Filtrar…" onChange={(e) => { setCol(k, e.target.value); setLimite(PAGINA); }}
                        style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, padding: "4px 8px", fontSize: 12, font: "inherit", border: "1.5px solid var(--ds-color-gray-100)", background: "#fff", textAlign: k === "lineas" ? "right" : "left" }} />
                    </th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 && (
                  <tr><td colSpan={12}><div className="empty">{pedidos.length === 0 ? "Aún no hay solicitudes. Creá la primera." : "Ninguna solicitud coincide con los filtros."}</div></td></tr>
                )}
                {visibles.map((p) => {
                  const b = pedidoBadge(p.estado);
                  return (
                    <tr key={p.id} className="is-clickable" onClick={() => router.push(`/ingenieria/${p.id}`)}>
                      <td className="ds-strong">{p.numero}</td>
                      <td>{(() => { const t = tipoSolicitudBadge(p.tipoSolicitud); return <Badge tone={t.tone}>{t.label}</Badge>; })()}</td>
                      <td>
                        <div className="ds-strong ds-body-sm">{destCodigo(p)}</div>
                        {destNombre(p) && <div className="ds-muted ds-body-sm ds-truncate" style={{ maxWidth: 160 }} title={destNombre(p)}>{destNombre(p)}</div>}
                      </td>
                      <td><div className="ds-body-sm ds-muted ds-truncate" style={{ maxWidth: 200 }} title={p.notas ?? ""}>{p.notas ? p.notas : "—"}</div></td>
                      <td>{p.solicitante}</td>
                      <td>{formatDate(p.fecha)}</td>
                      <td className="ds-num">{p.lineas.length}</td>
                      <td>
                        {p.prioridad === "urgente" ? <Badge tone="red">Urgente</Badge>
                          : p.prioridad === "alta" ? <Badge tone="yellow">Alta</Badge>
                          : <Badge tone="gray">Normal</Badge>}
                      </td>
                      <td><Badge tone={b.tone}>{b.label}</Badge></td>
                      <td>
                        {(() => {
                          const c = pedidoCompraBadge(p); const pct = pedidoOrdenadoPct(p);
                          return (
                            <div className="row gap-2" style={{ alignItems: "center" }}>
                              <Badge tone={c.tone}>{c.label}</Badge>
                              {pct > 0 && pct < 100 && <span className="ds-body-sm ds-muted">{pct}%</span>}
                            </div>
                          );
                        })()}
                      </td>
                      <td>
                        {(() => {
                          const total = p.lineas.reduce((s, l) => s + l.cantidad, 0);
                          const rec = p.lineas.reduce((s, l) => s + recibidoDeLineaPedido(ordenes, l.id), 0);
                          return (
                            <div className="row gap-3" style={{ alignItems: "center" }}>
                              <QtyRing recibida={rec} total={total} />
                              <span className="ds-body-sm ds-muted">{entregadoPct(p)}%</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="ds-num">›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {filtradas.length > limite && (
          <div className="row mt-4" style={{ justifyContent: "center" }}>
            <Button variant="outline" onClick={() => setLimite((n) => n + PAGINA)}>
              Mostrar más ({filtradas.length - limite} restantes)
            </Button>
          </div>
        )}
      </main>
    </AppShell>
  );
}
