"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Modal, useToast } from "@/components/ui";
import { DataTable } from "@/components/data-table";
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

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.pedidoLineaId === id ? { ...r, ...patch } : r)));

  // Líneas del pedido elegido en el panel izquierdo (o todas). La DataTable maneja
  // búsqueda, filtros por columna, columnas/vistas y exportar.
  const dataTabla = rows.filter((r) => filtro === "all" || r.pedidoId === filtro);
  const selIds = new Set(dataTabla.map((r) => r.pedidoLineaId));
  const allSel = dataTabla.length > 0 && dataTabla.every((r) => r.incluir);
  const someSel = dataTabla.some((r) => r.incluir);
  const toggleAll = (check: boolean) =>
    setRows((rs) => rs.map((r) => (selIds.has(r.pedidoLineaId) ? { ...r, incluir: check } : r)));

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

  // Columnas de la DataTable. La selección y las cantidades editables (armado de
  // orden por línea) viven como celdas personalizadas, así conserva ese flujo
  // pero con el look/filtros/exportar de las demás tablas.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const columns: ColumnDef<Row, any>[] = [
    {
      id: "sel", enableColumnFilter: false, enableSorting: false,
      header: () => (
        <input type="checkbox" className="ds-cbx" title="Seleccionar todas" aria-label="Seleccionar todas"
          checked={allSel} ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }}
          onClick={stop} onChange={(e) => toggleAll(e.target.checked)} />
      ),
      cell: (c) => { const r = c.row.original; return (
        <input type="checkbox" className="ds-cbx" checked={r.incluir} onClick={stop}
          onChange={(e) => setRow(r.pedidoLineaId, { incluir: e.target.checked })} />
      ); },
    },
    { id: "pedido", header: "Pedido", accessorFn: (r) => r.pedidoNumero, meta: { label: "Pedido" },
      cell: (c) => { const r = c.row.original; return <span className="row gap-2" style={{ alignItems: "center" }}>{dot(r.tipo === "repuesto" ? "yellow" : "green")}<span className="ds-body-sm ds-strong">{r.pedidoNumero}</span></span>; } },
    { id: "articulo", header: "Artículo", accessorFn: (r) => r.descripcion, meta: { label: "Artículo" },
      cell: (c) => <div className="ds-truncate" title={c.getValue()} style={{ maxWidth: 280 }}>{c.getValue()}</div> },
    { id: "obra", header: "Obra", accessorFn: (r) => r.almacen || "—", meta: { label: "Obra" },
      cell: (c) => <span className="ds-muted ds-body-sm">{c.getValue()}</span> },
    { id: "pend", header: "Pend.", accessorFn: (r) => r.pendiente, meta: { label: "Pend.", num: true }, enableColumnFilter: false,
      cell: (c) => { const r = c.row.original; return <span className="ds-body-sm">{num.format(r.pendiente)} {r.unidad}</span>; } },
    { id: "aordenar", header: "A ordenar", accessorFn: (r) => r.cantidad, meta: { label: "A ordenar", num: true }, enableColumnFilter: false, enableSorting: false,
      cell: (c) => { const r = c.row.original; return <input className="ds-cell-input" type="number" min={0} max={r.pendiente} value={r.cantidad} style={{ width: 78 }} disabled={!r.incluir} onClick={stop} onChange={(e) => setRow(r.pedidoLineaId, { cantidad: e.target.value })} />; } },
    { id: "precio", header: "Precio", accessorFn: (r) => r.precio, meta: { label: "Precio", num: true }, enableColumnFilter: false, enableSorting: false,
      cell: (c) => { const r = c.row.original; return <input className="ds-cell-input" type="number" min={0} value={r.precio} style={{ width: 92 }} disabled={!r.incluir} onClick={stop} onChange={(e) => setRow(r.pedidoLineaId, { precio: e.target.value })} />; } },
    { id: "iva", header: "IVA%", accessorFn: (r) => r.iva, meta: { label: "IVA%", num: true }, enableColumnFilter: false, enableSorting: false,
      cell: (c) => { const r = c.row.original; return <input className="ds-cell-input" type="number" min={0} value={r.iva} style={{ width: 50 }} disabled={!r.incluir} onClick={stop} onChange={(e) => setRow(r.pedidoLineaId, { iva: e.target.value })} />; } },
    { id: "importe", header: "Importe", accessorFn: (r) => Number(r.cantidad) * Number(r.precio), meta: { label: "Importe", num: true }, enableColumnFilter: false,
      cell: (c) => <span className="ds-strong ds-body-sm">{money(Number(c.getValue()) || 0)}</span> },
  ];

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

          {/* líneas — misma DataTable que el resto, con celdas editables para armar la orden */}
          <Card className="md-detail" style={{ padding: 16 }}>
            <DataTable
              data={dataTabla}
              columns={columns}
              tablaKey="prov-lineas"
              titulo="Materiales solicitados"
              getRowId={(r) => r.pedidoLineaId}
              onRowClick={(r) => setRow(r.pedidoLineaId, { incluir: !r.incluir })}
              rowClassName={(r) => (r.incluir ? "dt-row-incluida" : "")}
              vacio="No hay líneas pendientes."
            />
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
