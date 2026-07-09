"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Modal, useToast } from "@/components/ui";
import { VistaToggle } from "@/components/vista-toggle";
import { IconEye, IconReceipt, IconList } from "@/components/icons";
import { useStore } from "@/lib/store";
import { destinoLabel, destinoCodigo, money, num, pedidoLineaPendiente, solicitudResumen, tipoSolicitudBadge } from "@/lib/helpers";

interface Row {
  pedidoId: string;
  pedidoNumero: string;
  destino: string;
  tipo: "material" | "repuesto" | "stock";
  pedidoLineaId: string;
  articuloId: string;
  descripcion: string;
  unidad: string;
  almacen: string;
  pendiente: number;
  incluir: boolean;
  cantidad: string;
  precio: string;
  iva: string;
}

export default function ProveeduriaMaterialesPage() {
  const { pedidos, setBorrador } = useStore();
  const router = useRouter();
  const toast = useToast();

  // Proveeduría solo ve líneas de solicitudes ya ENVIADAS por Ingeniería
  // (aprobado / en orden) con saldo por ordenar. Se excluyen borrador y devueltas
  // (siguen en manos del solicitante) y las cerradas (sin saldo).
  const pedidosConSaldo = useMemo(
    () => pedidos.filter((p) => (p.estado === "aprobado" || p.estado === "en_orden") && p.lineas.some((l) => pedidoLineaPendiente(l) > 0)),
    [pedidos]
  );

  const baseRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    pedidosConSaldo.forEach((p) => {
      p.lineas.forEach((l) => {
        const pend = pedidoLineaPendiente(l);
        if (pend <= 0) return;
        rows.push({
          pedidoId: p.id, pedidoNumero: p.numero, destino: destinoLabel(p), tipo: p.tipoSolicitud,
          pedidoLineaId: l.id, articuloId: l.articuloId, descripcion: l.descripcion,
          unidad: l.unidad, almacen: l.almacen, pendiente: pend,
          incluir: false, cantidad: String(pend), precio: "0", iva: "13",
        });
      });
    });
    return rows;
  }, [pedidosConSaldo]);

  const [rows, setRows] = useState<Row[]>(baseRows);
  const baseKey = baseRows.map((r) => r.pedidoLineaId).join(",");
  const [lastKey, setLastKey] = useState(baseKey);
  if (baseKey !== lastKey) { setRows(baseRows); setLastKey(baseKey); }

  const [filtro, setFiltro] = useState<string>("all");
  const [pedFiltro, setPedFiltro] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  // Filtros por columna estilo Excel (una caja por columna)
  const [colF, setColF] = useState<Record<string, string>>({});
  const setCol = (k: string, v: string) => setColF((f) => ({ ...f, [k]: v }));

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.pedidoLineaId === id ? { ...r, ...patch } : r)));

  // Texto filtrable/buscable por columna (sirve para el filtro por columna y la búsqueda global)
  const cellText = (r: Row, k: string): string => {
    switch (k) {
      case "pedido": return r.pedidoNumero;
      case "articulo": return r.descripcion;
      case "almacen": return r.almacen ?? "";
      case "pend": return `${r.pendiente} ${r.unidad}`;
      case "aordenar": return r.cantidad;
      case "precio": return r.precio;
      case "iva": return r.iva;
      case "importe": return String(Number(r.cantidad) * Number(r.precio));
      default: return "";
    }
  };
  const COLS = ["pedido", "articulo", "almacen", "pend", "aordenar", "precio", "iva", "importe"];

  const visibles = rows
    .filter((r) => filtro === "all" || r.pedidoId === filtro)
    .filter((r) => COLS.every((k) => { const v = (colF[k] ?? "").trim().toLowerCase(); return !v || cellText(r, k).toLowerCase().includes(v); }));

  // Seleccionar todas las líneas VISIBLES (respeta filtros de columna)
  const visiblesIds = visibles.map((r) => r.pedidoLineaId);
  const allVisibleSel = visibles.length > 0 && visibles.every((r) => r.incluir);
  const someVisibleSel = visibles.some((r) => r.incluir);
  const toggleAllVisible = (check: boolean) =>
    setRows((rs) => rs.map((r) => (visiblesIds.includes(r.pedidoLineaId) ? { ...r, incluir: check } : r)));

  const incluidas = rows.filter((r) => r.incluir && Number(r.cantidad) > 0);
  const seleccionPorPedido = (pid: string) => rows.filter((r) => r.pedidoId === pid && r.incluir).length;
  const subtotal = incluidas.reduce((s, r) => s + Number(r.cantidad) * Number(r.precio), 0);
  const pedidosDistintos = new Set(incluidas.map((r) => r.pedidoNumero)).size;

  const dot = (tone: string) => (
    <span style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block",
      background: tone === "yellow" ? "var(--ds-color-yellow)" : "var(--ds-color-green-100)" }} />
  );

  function irArmar() {
    if (incluidas.length === 0) return;
    setBorrador(incluidas.map((r) => ({
      pedidoLineaId: r.pedidoLineaId, cantidad: Number(r.cantidad), precio: Number(r.precio), iva: Number(r.iva) || 0,
    })));
    router.push("/proveeduria/nueva");
  }

  // Convertir TODO un pedido (sus líneas pendientes) en una orden de compra.
  function convertirPedido(p: typeof pedidos[number]) {
    const lineas = p.lineas
      .filter((l) => pedidoLineaPendiente(l) > 0)
      .map((l) => ({ pedidoLineaId: l.id, cantidad: pedidoLineaPendiente(l), precio: 0, iva: 13 }));
    if (!lineas.length) { toast("Este pedido no tiene líneas pendientes por ordenar.", "error"); return; }
    setBorrador(lineas);
    router.push("/proveeduria/nueva");
  }

  const preview = previewId ? pedidos.find((p) => p.id === previewId) : null;

  return (
    <AppShell role="proveeduria">
      <main className="page" style={{ paddingBottom: incluidas.length ? 120 : undefined }}>
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Materiales solicitados</h1>
            <p className="ds-muted">Elegí un pedido para ver solo sus líneas, o seleccioná materiales de varios pedidos para una orden.</p>
          </div>
        </div>

        <VistaToggle opciones={[
          { label: "Por solicitud", href: "/proveeduria/solicitudes", active: false, icon: <IconReceipt size={16} /> },
          { label: "Por línea", href: "/proveeduria", active: true, icon: <IconList size={16} /> },
        ]} />

        {baseRows.length === 0 ? (
          <Card className="mt-4"><div className="empty" style={{ padding: "56px 16px", lineHeight: 1.6 }}>
            No hay líneas pendientes por ordenar.<br />
            <span className="ds-muted ds-body-sm">Cuando Ingeniería apruebe nuevas solicitudes, van a aparecer acá.</span>
          </div></Card>
        ) : (
        <div className="md-layout mt-2">
          {/* pedidos */}
          <div className="md-list" style={{ maxHeight: "calc(100vh - 210px)", overflowY: "auto", paddingRight: 4 }}>
            <input value={pedFiltro} onChange={(e) => setPedFiltro(e.target.value)} placeholder="Filtrar pedido u obra…"
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 8, borderRadius: 8, padding: "7px 10px", fontSize: 13, font: "inherit", border: "1.5px solid var(--ds-color-gray-100)", background: "var(--ds-color-white)", position: "sticky", top: 0, zIndex: 1 }} />
            <button className={`md-item ${filtro === "all" ? "is-active" : ""}`} onClick={() => setFiltro("all")}>
              <div className="md-item__top">
                <span className="ds-strong">Todos los pedidos</span>
                <span className="md-pill">{rows.length}</span>
              </div>
              <span className="ds-body-sm ds-muted">Ver todas las líneas pendientes</span>
            </button>
            {pedidosConSaldo
              .filter((p) => { const q = pedFiltro.trim().toLowerCase(); if (!q) return true; const r = solicitudResumen(p); return [p.numero, destinoCodigo(p), r.principal, r.secundaria ?? "", p.notas ?? ""].some((t) => t.toLowerCase().includes(q)); })
              .map((p) => {
              const n = p.lineas.filter((l) => pedidoLineaPendiente(l) > 0).length;
              const sel = seleccionPorPedido(p.id);
              return (
                <div key={p.id} className={`md-item ${filtro === p.id ? "is-active" : ""}`} style={{ cursor: "pointer" }} onClick={() => setFiltro(p.id)}>
                  <div className="md-item__top">
                    <span className="row gap-2" style={{ alignItems: "center" }}>{dot(p.tipoSolicitud === "repuesto" ? "yellow" : "green")} <span className="ds-strong">{p.numero}</span></span>
                    <span className="row gap-2" style={{ alignItems: "center" }}>
                      {sel > 0 ? <span className="md-pill">{sel} ✓</span> : <span className="ds-muted ds-body-sm">{n}</span>}
                      <span className="icon-btn" title="Ver líneas" onClick={(e) => { e.stopPropagation(); setPreviewId(p.id); }}><IconEye /></span>
                    </span>
                  </div>
                  {(() => { const r = solicitudResumen(p); return (
                    <span className="ds-body-sm ds-muted ds-truncate" style={{ maxWidth: 220 }} title={r.secundaria ? `${r.principal} · ${r.secundaria}` : r.principal}>
                      {tipoSolicitudBadge(p.tipoSolicitud).label} · <span className="ds-strong">{r.principal}</span>{r.secundaria ? ` · ${r.secundaria}` : ""}
                    </span>
                  ); })()}
                </div>
              );
            })}
          </div>

          {/* líneas */}
          <Card className="md-detail" style={{ padding: 0, overflow: "hidden" }}>
            <div className="row row--between" style={{ padding: "14px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)" }}>
              <span className="ds-label ds-muted">{visibles.length} línea(s){filtro !== "all" ? " del pedido" : ""}</span>
            </div>
            <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
              <table className="ds-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox" title="Seleccionar todas las líneas visibles" aria-label="Seleccionar todas"
                        checked={allVisibleSel}
                        ref={(el) => { if (el) el.indeterminate = someVisibleSel && !allVisibleSel; }}
                        onChange={(e) => toggleAllVisible(e.target.checked)} />
                    </th>
                    <th>Pedido</th><th>Artículo</th><th>Obra</th>
                    <th className="ds-num">Pend.</th><th className="ds-num">A ordenar</th>
                    <th className="ds-num">Precio</th><th className="ds-num">IVA%</th><th className="ds-num">Importe</th>
                  </tr>
                  <tr>
                    <th style={{ padding: "4px 8px" }}></th>
                    {COLS.map((k, i) => (
                      <th key={k} style={{ padding: "4px 6px", fontWeight: 400 }}>
                        <input value={colF[k] ?? ""} placeholder="Filtrar…" onChange={(e) => setCol(k, e.target.value)}
                          style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, padding: "4px 8px", fontSize: 12, font: "inherit", border: "1.5px solid var(--ds-color-gray-100)", background: "var(--ds-color-white)", textAlign: i >= 3 ? "right" : "left" }} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibles.length === 0 && (
                    <tr><td colSpan={9}><div className="empty">No hay líneas pendientes.</div></td></tr>
                  )}
                  {visibles.map((r) => {
                    const importe = Number(r.cantidad) * Number(r.precio);
                    return (
                      <tr key={r.pedidoLineaId} className="is-clickable"
                        style={{ background: r.incluir ? "color-mix(in srgb, var(--ds-color-green-100) 12%, #fff)" : undefined }}
                        onClick={() => setRow(r.pedidoLineaId, { incluir: !r.incluir })}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={r.incluir} onChange={(e) => setRow(r.pedidoLineaId, { incluir: e.target.checked })} />
                        </td>
                        <td><span className="row gap-2" style={{ alignItems: "center" }}>{dot(r.tipo === "repuesto" ? "yellow" : "green")}<span className="ds-body-sm ds-strong">{r.pedidoNumero}</span></span></td>
                        <td><div className="ds-truncate" title={r.descripcion}>{r.descripcion}</div></td>
                        <td className="ds-muted ds-body-sm">{r.almacen}</td>
                        <td className="ds-num ds-body-sm">{num.format(r.pendiente)} {r.unidad}</td>
                        <td className="ds-num" onClick={(e) => e.stopPropagation()}>
                          <input className="ds-cell-input" type="number" min={0} max={r.pendiente} value={r.cantidad} style={{ width: 78 }}
                            disabled={!r.incluir} onChange={(e) => setRow(r.pedidoLineaId, { cantidad: e.target.value })} />
                        </td>
                        <td className="ds-num" onClick={(e) => e.stopPropagation()}>
                          <input className="ds-cell-input" type="number" min={0} value={r.precio} style={{ width: 92 }}
                            disabled={!r.incluir} onChange={(e) => setRow(r.pedidoLineaId, { precio: e.target.value })} />
                        </td>
                        <td className="ds-num" onClick={(e) => e.stopPropagation()}>
                          <input className="ds-cell-input" type="number" min={0} value={r.iva} style={{ width: 50 }}
                            disabled={!r.incluir} onChange={(e) => setRow(r.pedidoLineaId, { iva: e.target.value })} />
                        </td>
                        <td className="ds-num ds-strong ds-body-sm">{money(importe || 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        )}
      </main>

      {/* barra inferior */}
      {incluidas.length > 0 && (
        <div className="action-bar">
          <div className="action-bar__inner">
            <div className="row gap-4 wrap">
              <span className="ds-strong">{incluidas.length} línea(s)</span>
              <span className="ds-muted">de {pedidosDistintos} pedido(s)</span>
              <span className="ds-muted">·</span>
              <span className="ds-strong">{money(subtotal)}</span>
            </div>
            <div className="row gap-3">
              <button className="link-btn" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, incluir: false })))}>Limpiar</button>
              <Button onClick={irArmar}>Armar orden de compra →</Button>
            </div>
          </div>
        </div>
      )}

      {/* popup: líneas de un pedido */}
      {preview && (
        <Modal title={`${preview.numero} · ${solicitudResumen(preview).principal}`} onClose={() => setPreviewId(null)}>
          <div className="row gap-3" style={{ marginBottom: 12 }}>
            {(() => { const t = tipoSolicitudBadge(preview.tipoSolicitud); return <Badge tone={t.tone}>{t.label}</Badge>; })()}
            <span className="ds-muted ds-label">{preview.solicitante}</span>
          </div>
          <div className="ds-table-wrap" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)" }}>
            <table className="ds-table">
              <thead><tr><th>Artículo</th><th>Obra</th><th className="ds-num">Solicitado</th><th className="ds-num">Pendiente</th></tr></thead>
              <tbody>
                {preview.lineas.map((l) => (
                  <tr key={l.id}>
                    <td><div className="ds-truncate" title={l.descripcion}>{l.descripcion}</div></td>
                    <td className="ds-muted ds-body-sm">{l.almacen}</td>
                    <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
                    <td className="ds-num">{pedidoLineaPendiente(l) > 0 ? <span className="ds-pending-text">{num.format(pedidoLineaPendiente(l))}</span> : "0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row gap-3 mt-4" style={{ justifyContent: "flex-end" }}>
            <Button variant="outline" onClick={() => { setFiltro(preview.id); setPreviewId(null); }}>Ver en la tabla</Button>
            <Button onClick={() => { convertirPedido(preview); setPreviewId(null); }}>Convertir en orden de compra →</Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
