"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Button, Card, EmptyState, Modal, Select, useToast } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { VistaToggle } from "@/components/vista-toggle";
import { IconEye, IconReceipt, IconList } from "@/components/icons";
import { useStore } from "@/lib/store";
import { destinoLabel, destinoCodigo, money, num, pedidoLineaPendiente, solicitudResumen, tipoSolicitudBadge } from "@/lib/helpers";

interface Row {
  pedidoId: string;
  pedidoNumero: string;
  destino: string;
  solicitante: string;
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
  // Solicitantes (usuarios que crearon los pedidos pendientes) para el dropdown.
  const solicitantes = useMemo(
    () => [...new Set(pedidosConSaldo.map((p) => p.solicitante).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    [pedidosConSaldo]
  );

  const baseRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    pedidosConSaldo.forEach((p) => {
      p.lineas.forEach((l) => {
        const pend = pedidoLineaPendiente(l);
        if (pend <= 0) return;
        rows.push({
          pedidoId: p.id, pedidoNumero: p.numero, destino: destinoLabel(p), solicitante: p.solicitante, tipo: p.tipoSolicitud,
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
  // Cuando cambia el set de líneas (el auto-refresh de 45s trae un pedido nuevo de
  // Producción, o una línea se queda sin saldo) NO hay que pisar lo que la usuaria
  // ya llevaba armado: se CONSERVA su selección, cantidad, precio e IVA por línea y
  // solo se refrescan los datos del pedido. Antes se reemplazaba la tabla entera y
  // perdía el trabajo a medio hacer.
  if (baseKey !== lastKey) {
    setRows((prev) => {
      const previas = new Map(prev.map((r) => [r.pedidoLineaId, r]));
      return baseRows.map((b) => {
        const p = previas.get(b.pedidoLineaId);
        if (!p) return b;
        // Si otro usuario ordenó parte de la línea, el pendiente bajó: acotar.
        const cant = Number(p.cantidad) > b.pendiente ? String(b.pendiente) : p.cantidad;
        return { ...b, incluir: p.incluir, cantidad: cant, precio: p.precio, iva: p.iva };
      });
    });
    setLastKey(baseKey);
  }

  const [filtro, setFiltro] = useState<string>("all");
  const [pedFiltro, setPedFiltro] = useState("");
  // Buscador nuevo: filtra por el usuario que creó el pedido (solicitante).
  const [solicFiltro, setSolicFiltro] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.pedidoLineaId === id ? { ...r, ...patch } : r)));

  // Líneas del pedido elegido en el panel izquierdo (o todas) + filtro por
  // solicitante (usuario que creó el pedido). La DataTable maneja búsqueda,
  // filtros por columna, columnas/vistas y exportar.
  const qSolic = solicFiltro.trim().toLowerCase();
  const coincideSolic = (s: string) => !qSolic || s.toLowerCase().includes(qSolic);
  const dataTabla = rows.filter((r) => (filtro === "all" || r.pedidoId === filtro) && coincideSolic(r.solicitante));
  const rowsSolic = rows.filter((r) => coincideSolic(r.solicitante)); // para el contador de "Todos los pedidos"

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
      // El "seleccionar todas" respeta el filtro/búsqueda ACTIVOS de la tabla:
      // marca solo las filas visibles (filtradas). Como `incluir` es persistente
      // por fila, al filtrar otro material y volver a marcar, la selección se
      // ACUMULA (no toca las que quedaron fuera del filtro).
      header: ({ table }) => {
        const vis = table.getFilteredRowModel().rows;
        const marcadas = vis.filter((rr) => (rr.original as Row).incluir).length;
        const allSel = vis.length > 0 && marcadas === vis.length;
        const someSel = marcadas > 0;
        const toggleVisibles = (check: boolean) => {
          const ids = new Set(vis.map((rr) => (rr.original as Row).pedidoLineaId));
          setRows((rs) => rs.map((r) => (ids.has(r.pedidoLineaId) ? { ...r, incluir: check } : r)));
        };
        return (
          <input type="checkbox" className="ds-cbx" title="Seleccionar todas las filtradas" aria-label="Seleccionar todas las filtradas"
            checked={allSel} ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }}
            onClick={stop} onChange={(e) => toggleVisibles(e.target.checked)} />
        );
      },
      cell: (c) => { const r = c.row.original; return (
        <input type="checkbox" className="ds-cbx" aria-label={`Incluir ${r.articuloId} en la orden`} checked={r.incluir} onClick={stop}
          onChange={(e) => setRow(r.pedidoLineaId, { incluir: e.target.checked })} />
      ); },
    },
    { id: "pedido", header: "Pedido", accessorFn: (r) => r.pedidoNumero, meta: { label: "Pedido" },
      cell: (c) => { const r = c.row.original; return <span className="row gap-2" style={{ alignItems: "center" }}>{dot(r.tipo === "repuesto" ? "yellow" : "green")}<span className="ds-body-sm ds-strong">{r.pedidoNumero}</span></span>; } },
    { id: "articulo", header: "Artículo", accessorFn: (r) => `${r.articuloId} ${r.descripcion}`, meta: { label: "Artículo" },
      // El código va ARRIBA en su propia línea y la descripción abajo en dos líneas:
      // metidos en la misma fila, el código se comía ~90px y la medida del material
      // ("… 3/4") quedaba siempre cortada.
      cell: (c) => { const r = c.row.original; return <div style={{ maxWidth: 380, minWidth: 200 }} title={`${r.articuloId} — ${r.descripcion}`}><div className="ds-strong ds-body-sm">{r.articuloId}</div><div className="ds-clamp-2">{r.descripcion}</div></div>; } },
    { id: "obra", header: "Destino", accessorFn: (r) => r.almacen || "—", meta: { label: "Destino" },
      cell: (c) => <span className="ds-muted ds-body-sm">{c.getValue()}</span> },
    { id: "pend", header: "Pend.", accessorFn: (r) => r.pendiente, meta: { label: "Pend.", num: true }, enableColumnFilter: false,
      cell: (c) => { const r = c.row.original; return <span className="ds-body-sm">{num.format(r.pendiente)} {r.unidad}</span>; } },
    { id: "aordenar", header: "A ordenar", accessorFn: (r) => r.cantidad, meta: { label: "A ordenar", num: true }, enableColumnFilter: false, enableSorting: false,
      cell: (c) => { const r = c.row.original; return <input className="ds-cell-input" aria-label="Cantidad a ordenar" type="number" min={0} max={r.pendiente} value={r.cantidad} style={{ width: 78 }} disabled={!r.incluir} onClick={stop} onChange={(e) => setRow(r.pedidoLineaId, { cantidad: e.target.value })} />; } },
  ];

  return (
    <>
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
          <Card className="mt-4"><EmptyState icon={<IconList size={24} />} title="No hay líneas pendientes por ordenar." hint="Cuando Ingeniería apruebe nuevas solicitudes, van a aparecer acá." /></Card>
        ) : (
        <div className="md-layout mt-2">
          {/* pedidos */}
          <div className="md-list" style={{ maxHeight: "calc(100vh - 210px)", overflowY: "auto", paddingRight: 4 }}>
            <div className="md-filtros">
              <input className="md-filtro" value={pedFiltro} onChange={(e) => setPedFiltro(e.target.value)} aria-label="Filtrar pedido u obra" placeholder="Filtrar pedido u obra…" />
              {/* Filtro nuevo por el usuario que creó el pedido (solicitante):
                  dropdown con solo los que han solicitado. Afecta la lista de
                  pedidos Y las líneas de la tabla. */}
              <Select value={solicFiltro} onChange={(e) => setSolicFiltro(e.target.value)} placeholder="Solicitante: todos" className="md-select" ariaLabel="Filtrar por solicitante">
                <option value="">Todos los solicitantes</option>
                {solicitantes.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <button className={`md-item ${filtro === "all" ? "is-active" : ""}`} onClick={() => setFiltro("all")}>
              <div className="md-item__top">
                <span className="ds-strong">Todos los pedidos</span>
                <span className="md-pill">{rowsSolic.length}</span>
              </div>
              <span className="ds-body-sm ds-muted">{qSolic ? `Líneas de ${solicFiltro.trim()}` : "Ver todas las líneas pendientes"}</span>
            </button>
            {pedidosConSaldo
              .filter((p) => coincideSolic(p.solicitante))
              .filter((p) => { const q = pedFiltro.trim().toLowerCase(); if (!q) return true; const r = solicitudResumen(p); return [p.numero, destinoCodigo(p), r.principal, r.secundaria ?? "", p.notas ?? "", p.solicitante].some((t) => t.toLowerCase().includes(q)); })
              .map((p) => {
              const n = p.lineas.filter((l) => pedidoLineaPendiente(l) > 0).length;
              const sel = seleccionPorPedido(p.id);
              return (
                <div key={p.id} role="button" tabIndex={0} aria-pressed={filtro === p.id}
                  className={`md-item ${filtro === p.id ? "is-active" : ""}`} style={{ cursor: "pointer" }}
                  onClick={() => setFiltro(p.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFiltro(p.id); } }}>
                  <div className="md-item__top">
                    <span className="row gap-2" style={{ alignItems: "center" }}>{dot(p.tipoSolicitud === "repuesto" ? "yellow" : "green")} <span className="ds-strong">{p.numero}</span></span>
                    <span className="row gap-2" style={{ alignItems: "center" }}>
                      {sel > 0 ? <span className="md-pill">{sel} ✓</span> : <span className="ds-muted ds-body-sm">{n}</span>}
                      <button type="button" className="icon-btn" title="Ver líneas" aria-label="Ver líneas" onClick={(e) => { e.stopPropagation(); setPreviewId(p.id); }}><IconEye /></button>
                    </span>
                  </div>
                  {(() => { const r = solicitudResumen(p); return (
                    <span className="ds-body-sm ds-muted ds-truncate" style={{ maxWidth: 220 }} title={r.secundaria ? `${r.principal} · ${r.secundaria}` : r.principal}>
                      {tipoSolicitudBadge(p.tipoSolicitud).label} · <span className="ds-strong">{r.principal}</span>{r.secundaria ? ` · ${r.secundaria}` : ""}
                    </span>
                  ); })()}
                  <span className="md-item__solic" title={`Solicitó ${p.solicitante}`}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg>
                    {p.solicitante}
                  </span>
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
              buscarPlaceholder="Buscar por material, pedido u obra…"
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
              <span className="ds-muted">de {pedidosDistintos} pedido(s) · los precios se ponen al armar la orden</span>
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
              <thead><tr><th>Artículo</th><th>Destino</th><th className="ds-num">Solicitado</th><th className="ds-num">Pendiente</th></tr></thead>
              <tbody>
                {preview.lineas.map((l) => (
                  <tr key={l.id}>
                    <td><div className="ds-clamp-2" title={l.descripcion} style={{ maxWidth: 320, minWidth: 200 }}>{l.descripcion}</div></td>
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
    </>
  );
}
