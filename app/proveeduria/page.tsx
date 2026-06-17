"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Modal, useToast } from "@/components/ui";
import { IconEye } from "@/components/icons";
import { useStore } from "@/lib/store";
import { destinoLabel, money, num, pedidoLineaPendiente } from "@/lib/helpers";

interface Row {
  pedidoId: string;
  pedidoNumero: string;
  destino: string;
  tipo: "material" | "repuesto";
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
  const { pedidos, articulos, setBorrador } = useStore();
  const router = useRouter();
  const toast = useToast();

  const pedidosConSaldo = useMemo(
    () => pedidos.filter((p) => p.estado === "aprobado" && p.lineas.some((l) => pedidoLineaPendiente(l) > 0)),
    [pedidos]
  );

  const baseRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    pedidosConSaldo.forEach((p) => {
      p.lineas.forEach((l) => {
        const pend = pedidoLineaPendiente(l);
        if (pend <= 0) return;
        const a = articulos.find((x) => x.id === l.articuloId);
        rows.push({
          pedidoId: p.id, pedidoNumero: p.numero, destino: destinoLabel(p), tipo: p.tipoSolicitud,
          pedidoLineaId: l.id, articuloId: l.articuloId, descripcion: l.descripcion,
          unidad: l.unidad, almacen: l.almacen, pendiente: pend,
          incluir: false, cantidad: String(pend), precio: String(a?.precioReferencia ?? 0), iva: "13",
        });
      });
    });
    return rows;
  }, [pedidosConSaldo, articulos]);

  const [rows, setRows] = useState<Row[]>(baseRows);
  const baseKey = baseRows.map((r) => r.pedidoLineaId).join(",");
  const [lastKey, setLastKey] = useState(baseKey);
  if (baseKey !== lastKey) { setRows(baseRows); setLastKey(baseKey); }

  const [filtro, setFiltro] = useState<string>("all");
  const [busqueda, setBusqueda] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.pedidoLineaId === id ? { ...r, ...patch } : r)));

  const q = busqueda.trim().toLowerCase();
  const visibles = rows
    .filter((r) => filtro === "all" || r.pedidoId === filtro)
    .filter((r) => !q || r.descripcion.toLowerCase().includes(q) || r.pedidoNumero.toLowerCase().includes(q));

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

        {baseRows.length === 0 ? (
          <Card className="mt-4"><div className="empty" style={{ padding: "56px 16px", lineHeight: 1.6 }}>
            No hay líneas pendientes por ordenar.<br />
            <span className="ds-muted ds-body-sm">Cuando Ingeniería apruebe nuevas solicitudes, van a aparecer acá.</span>
          </div></Card>
        ) : (
        <div className="md-layout mt-2">
          {/* pedidos */}
          <div className="md-list">
            <button className={`md-item ${filtro === "all" ? "is-active" : ""}`} onClick={() => setFiltro("all")}>
              <div className="md-item__top">
                <span className="ds-strong">Todos los pedidos</span>
                <span className="md-pill">{rows.length}</span>
              </div>
              <span className="ds-body-sm ds-muted">Ver todas las líneas pendientes</span>
            </button>
            {pedidosConSaldo.map((p) => {
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
                  <span className="ds-body-sm ds-muted ds-truncate" style={{ maxWidth: 200 }}>
                    {p.tipoSolicitud === "repuesto" ? "Repuesto · " : "Material · "}{destinoLabel(p)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* líneas */}
          <Card className="md-detail" style={{ padding: 0, overflow: "hidden" }}>
            <div className="row row--between" style={{ padding: "14px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)" }}>
              <span className="ds-label ds-muted">{visibles.length} línea(s){filtro !== "all" ? " del pedido" : ""}</span>
              <input className="ds-form-field__input" style={{ maxWidth: 240, borderRadius: 12, padding: "8px 14px" }}
                placeholder="Buscar material…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </div>
            <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
              <table className="ds-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th>Pedido</th><th>Artículo</th><th>Almacén</th>
                    <th className="ds-num">Pend.</th><th className="ds-num">A ordenar</th>
                    <th className="ds-num">Precio</th><th className="ds-num">IVA%</th><th className="ds-num">Importe</th>
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
        <Modal title={`${preview.numero} · ${destinoLabel(preview)}`} onClose={() => setPreviewId(null)}>
          <div className="row gap-3" style={{ marginBottom: 12 }}>
            {preview.tipoSolicitud === "repuesto" ? <Badge tone="yellow">Repuesto</Badge> : <Badge tone="green">Material</Badge>}
            <span className="ds-muted ds-label">{preview.solicitante}</span>
          </div>
          <div className="ds-table-wrap" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)" }}>
            <table className="ds-table">
              <thead><tr><th>Artículo</th><th>Almacén</th><th className="ds-num">Solicitado</th><th className="ds-num">Pendiente</th></tr></thead>
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
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
