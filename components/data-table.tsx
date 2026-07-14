"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel,
  getFacetedRowModel, getFacetedUniqueValues, flexRender,
  type Column, type ColumnDef, type FilterFn, type SortingState, type ColumnFiltersState, type VisibilityState, type ColumnOrderState, type PaginationState,
} from "@tanstack/react-table";
import { Button, Card, Input, Select } from "@/components/ui";
import { IconTable, IconGrid } from "@/components/icons";
import { useStore } from "@/lib/store";

// Texto plano de un valor de celda (para opciones y comparación de filtro).
const asText = (v: unknown): string => v == null ? "" : String(v);

// Filtro multi-selección: el valor del filtro es un arreglo de valores permitidos.
// Vacío/undefined = sin filtro (todas). Coincide si el texto de la celda está en el set.
const multiFilter: FilterFn<any> = (row, colId, value) => {
  if (!value || (Array.isArray(value) && value.length === 0)) return true;
  return (value as string[]).includes(asText(row.getValue(colId)));
};

// Filtro de fecha por RANGO: el valor es { from?, to? } en ISO (YYYY-MM-DD).
// Compara la parte de fecha del valor de la celda (funciona día/mes/año/rango).
type DateRange = { from?: string; to?: string };
const dateRangeFilter: FilterFn<any> = (row, colId, value) => {
  const r = value as DateRange | undefined;
  if (!r || (!r.from && !r.to)) return true;
  const v = asText(row.getValue(colId)).slice(0, 10);
  if (!v) return false;
  if (r.from && v < r.from) return false;
  if (r.to && v > r.to) return false;
  return true;
};
const isDateCol = (c: { meta?: unknown }) => !!(c.meta as { date?: boolean } | undefined)?.date;

// Motor de tabla reutilizable (TanStack, headless) con el design system de la app.
// Vista Tabla o Grid, ordenar, filtro por columna, búsqueda global, mostrar/ocultar
// y reordenar columnas, paginación, y VISTAS guardadas por usuario en SQL (/api/vistas).
// Cada columna debe tener `id`; opcional meta.label (nombre legible) y meta.num (derecha).

type ColMeta = { label?: string; num?: boolean; date?: boolean };
type VistaCfg = {
  columnOrder?: ColumnOrderState; columnVisibility?: VisibilityState; sorting?: SortingState;
  columnFilters?: ColumnFiltersState; globalFilter?: string; pageSize?: number; modo?: "tabla" | "grid";
};
type Vista = { id: number; nombre: string; config: VistaCfg; esPredeterminada: boolean };

export function DataTable<T>({
  data, columns, tablaKey, getRowId, onRowClick, rowClassName, vacio = "No hay registros.", modoInicial = "tabla", renderExpanded,
  titulo = "Reporte",
}: {
  data: T[];
  columns: ColumnDef<T, any>[];
  tablaKey: string;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  vacio?: string;
  modoInicial?: "tabla" | "grid";
  // Si se pasa, cada fila gana un botón ⇕ que despliega este contenido (p.ej. las líneas).
  renderExpanded?: (row: T) => ReactNode;
  // Título del reporte al exportar (CSV/PDF). El export usa las filas FILTRADAS
  // y las columnas visibles, así que "filtrás en la app y descargás eso".
  titulo?: string;
}) {
  const { usuario } = useStore();
  // Inyecta el filtro multi-selección a las columnas que no traigan uno propio.
  const cols = useMemo(() => columns.map((c) => (c.filterFn ? c : { ...c, filterFn: isDateCol(c) ? dateRangeFilter : multiFilter })), [columns]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [filterCol, setFilterCol] = useState<string | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => columns.map((c) => c.id!).filter(Boolean));
  const [globalFilter, setGlobalFilter] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [panel, setPanel] = useState<null | "cols" | "vistas" | "export">(null);
  const [modo, setModo] = useState<"tabla" | "grid">(modoInicial);

  const table = useReactTable({
    data, columns: cols,
    state: { sorting, columnFilters, columnVisibility, columnOrder, globalFilter, pagination },
    onSortingChange: setSorting, onColumnFiltersChange: setColumnFilters, onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder, onGlobalFilterChange: setGlobalFilter, onPaginationChange: setPagination,
    globalFilterFn: "includesString",
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(), getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  // Abre el popover de filtro anclado bajo el botón de la columna.
  function abrirFiltro(colId: string, btn: HTMLElement) {
    if (filterCol === colId) { setFilterCol(null); return; }
    const r = btn.getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - 330 - 12);
    setFilterAnchor({ left: Math.max(12, left), top: r.bottom + 6 });
    setFilterCol(colId);
  }

  // ---- Vistas guardadas (SQL) ----
  const [vistas, setVistas] = useState<Vista[]>([]);
  const aplicadaDefault = useRef(false);
  async function cargarVistas() {
    if (!usuario) return;
    try {
      const r = await fetch(`/api/vistas?usuario=${encodeURIComponent(usuario)}&tabla=${encodeURIComponent(tablaKey)}`);
      const d = await r.json(); if (r.ok) setVistas(d.vistas ?? []);
    } catch { /* sin BD */ }
  }
  useEffect(() => { cargarVistas(); }, [usuario, tablaKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (aplicadaDefault.current || vistas.length === 0) return;
    const def = vistas.find((v) => v.esPredeterminada);
    if (def) { aplicarVista(def); aplicadaDefault.current = true; }
  }, [vistas]); // eslint-disable-line react-hooks/exhaustive-deps

  function aplicarVista(v: Vista) {
    const c = v.config ?? {};
    if (c.columnOrder) setColumnOrder(c.columnOrder);
    setColumnVisibility(c.columnVisibility ?? {}); setSorting(c.sorting ?? []); setColumnFilters(c.columnFilters ?? []);
    setGlobalFilter(c.globalFilter ?? ""); setModo(c.modo ?? "tabla");
    setPagination((p) => ({ ...p, pageSize: c.pageSize ?? p.pageSize, pageIndex: 0 })); setPanel(null);
  }
  async function guardarVista() {
    const nombre = window.prompt("Nombre de la vista:"); if (!nombre?.trim()) return;
    const config: VistaCfg = { columnOrder, columnVisibility, sorting, columnFilters, globalFilter, pageSize: pagination.pageSize, modo };
    const pred = window.confirm("¿Marcar como predeterminada (se aplica al abrir)?");
    try {
      const r = await fetch("/api/vistas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario, tabla: tablaKey, nombre: nombre.trim(), config, esPredeterminada: pred }) });
      if (!r.ok) throw new Error(); await cargarVistas();
    } catch { alert("No se pudo guardar la vista."); }
  }
  async function borrarVista(v: Vista) {
    if (!window.confirm(`¿Borrar la vista "${v.nombre}"?`)) return;
    try { await fetch(`/api/vistas/${v.id}?usuario=${encodeURIComponent(usuario ?? "")}`, { method: "DELETE" }); await cargarVistas(); } catch { /* noop */ }
  }
  function resetVista() {
    setColumnOrder(columns.map((c) => c.id!).filter(Boolean)); setColumnVisibility({}); setSorting([]);
    setColumnFilters([]); setGlobalFilter(""); setPagination((p) => ({ ...p, pageIndex: 0 })); setPanel(null);
  }

  const leaf = table.getAllLeafColumns();
  const moveCol = (id: string, dir: -1 | 1) => setColumnOrder((prev) => {
    const order = prev.length ? [...prev] : leaf.map((c) => c.id);
    const i = order.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return order;
    [order[i], order[j]] = [order[j], order[i]]; return order;
  });
  // Reordenar arrastrando el encabezado: mueve `from` a la posición de `to`.
  const [dragCol, setDragCol] = useState<string | null>(null);
  const reorderCol = (from: string, to: string) => setColumnOrder((prev) => {
    const order = prev.length ? [...prev] : leaf.map((c) => c.id);
    const fi = order.indexOf(from), ti = order.indexOf(to);
    if (fi < 0 || ti < 0 || fi === ti) return order;
    order.splice(fi, 1); order.splice(ti, 0, from); return order;
  });
  const labelDe = (colId: string) => (leaf.find((x) => x.id === colId)?.columnDef.meta as ColMeta | undefined)?.label ?? colId;
  const rows = table.getRowModel().rows;

  // --- Exportar (CSV / PDF) — usa las filas FILTRADAS y las columnas visibles ---
  const valCelda = (row: any, colId: string): string => {
    try { const v = row.getValue(colId); if (v == null) return ""; return typeof v === "number" ? String(v) : String(v); }
    catch { return ""; }
  };
  const colsExport = () => table.getVisibleLeafColumns().map((c) => c.id).filter(Boolean) as string[];
  const filasExport = () => table.getFilteredRowModel().rows;

  const exportCSV = () => {
    const cols = colsExport();
    const esc = (s: string) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lineas = [cols.map((c) => esc(labelDe(c))).join(",")];
    for (const r of filasExport()) lineas.push(cols.map((c) => esc(valCelda(r, c))).join(","));
    const csv = "﻿" + lineas.join("\r\n"); // BOM: Excel respeta acentos
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${tablaKey || "reporte"}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const cols = colsExport();
    const escH = (s: string) => s.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m] as string));
    const filas = filasExport();
    const ths = cols.map((c) => `<th>${escH(labelDe(c))}</th>`).join("");
    const trs = filas.map((r) => `<tr>${cols.map((c) => `<td>${escH(valCelda(r, c))}</td>`).join("")}</tr>`).join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escH(titulo)}</title>
      <style>
        *{font-family:-apple-system,Segoe UI,Roboto,sans-serif;box-sizing:border-box}
        body{margin:32px;color:#1a1a1a}
        h1{font-size:20px;margin:0 0 2px}
        .meta{color:#888;font-size:12px;margin-bottom:18px}
        table{border-collapse:collapse;width:100%;font-size:12px}
        thead th{background:#111;color:#fff;text-align:left;padding:8px 10px}
        thead th:first-child{border-top-left-radius:8px}
        thead th:last-child{border-top-right-radius:8px}
        tbody td{padding:7px 10px;border-bottom:1px solid #eee}
        tbody tr:nth-child(even){background:#fafafa}
        @media print{@page{margin:14mm}}
      </style></head><body>
      <h1>${escH(titulo)}</h1>
      <div class="meta">Compras Adelante · ${filas.length} registro(s)</div>
      <table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <>
      {/* Toolbar */}
      <div className="row row--between wrap gap-3 dt-toolbar" style={{ marginBottom: 14, alignItems: "center", position: "relative" }}>
        <Input value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} placeholder="Buscar…" style={{ maxWidth: 300 }} />
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <span className="ds-muted ds-body-sm">{table.getFilteredRowModel().rows.length}</span>
          <div className="segmented">
            <button type="button" className={`segmented__btn ${modo === "tabla" ? "is-active" : ""}`} onClick={() => setModo("tabla")}><IconTable size={15} />Tabla</button>
            <button type="button" className={`segmented__btn ${modo === "grid" ? "is-active" : ""}`} onClick={() => setModo("grid")}><IconGrid size={15} />Grid</button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setPanel(panel === "cols" ? null : "cols")}>Columnas</Button>
          <Button variant="ghost" size="sm" onClick={() => setPanel(panel === "vistas" ? null : "vistas")}>Vistas</Button>
          <button type="button" className={`dt-export-btn${panel === "export" ? " is-open" : ""}`} onClick={() => setPanel(panel === "export" ? null : "export")} title="Exportar (CSV / PDF)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
            Exportar
          </button>
        </div>

        {panel && <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />}
        {panel === "cols" && (
          <Card flat style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 31, width: 280, maxHeight: 380, overflowY: "auto", padding: 8 }}>
            <div className="ds-label ds-muted" style={{ padding: "4px 8px 8px" }}>Columnas — mostrar y ordenar</div>
            {(columnOrder.length ? columnOrder : leaf.map((c) => c.id)).map((cid) => {
              const col = leaf.find((c) => c.id === cid); if (!col) return null;
              return (
                <div key={cid} className="row row--between gap-2" style={{ alignItems: "center", padding: "5px 8px", borderRadius: 8 }}>
                  <label className="row gap-2 ds-body-sm" style={{ alignItems: "center", cursor: "pointer" }}>
                    <input type="checkbox" className="ds-cbx" checked={col.getIsVisible()} onChange={col.getToggleVisibilityHandler()} /> {labelDe(cid)}
                  </label>
                  <span className="row gap-1">
                    <button type="button" className="icon-btn" title="Subir" onClick={() => moveCol(cid, -1)}>↑</button>
                    <button type="button" className="icon-btn" title="Bajar" onClick={() => moveCol(cid, 1)}>↓</button>
                  </span>
                </div>
              );
            })}
          </Card>
        )}
        {panel === "vistas" && (
          <Card flat style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 31, width: 300, maxHeight: 380, overflowY: "auto", padding: 8 }}>
            <div className="row row--between" style={{ alignItems: "center", padding: "4px 8px 8px" }}>
              <span className="ds-label ds-muted">Mis vistas</span>
              <button type="button" className="link-btn" onClick={resetVista}>Restablecer</button>
            </div>
            {vistas.length === 0 && <div className="ds-body-sm ds-muted" style={{ padding: "6px 8px" }}>Sin vistas guardadas.</div>}
            {vistas.map((v) => (
              <div key={v.id} className="row row--between gap-2" style={{ alignItems: "center", padding: "5px 8px" }}>
                <button type="button" className="link-btn" onClick={() => aplicarVista(v)} style={{ textAlign: "left" }}>{v.nombre}{v.esPredeterminada ? " ★" : ""}</button>
                <button type="button" className="icon-btn" title="Borrar" onClick={() => borrarVista(v)}>×</button>
              </div>
            ))}
            <div style={{ borderTop: "1.5px solid var(--ds-color-gray-100)", marginTop: 6, paddingTop: 8 }}>
              <Button variant="outline" size="sm" block onClick={guardarVista}>Guardar vista actual</Button>
            </div>
          </Card>
        )}
        {panel === "export" && (
          <Card flat style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 31, width: 260, padding: 8 }}>
            <div className="ds-label ds-muted" style={{ padding: "4px 8px 8px" }}>Descargar {table.getFilteredRowModel().rows.length} fila(s) filtradas</div>
            <button type="button" className="dt-filter-row" onClick={() => { exportCSV(); setPanel(null); }}>
              <span className="dt-export-ic" aria-hidden>CSV</span>
              <span>Excel / CSV</span>
            </button>
            <button type="button" className="dt-filter-row" onClick={() => { exportPDF(); setPanel(null); }}>
              <span className="dt-export-ic" aria-hidden>PDF</span>
              <span>Reporte PDF</span>
            </button>
          </Card>
        )}
      </div>

      {/* Vista Grid (tarjetas) */}
      {modo === "grid" ? (
        rows.length === 0 ? <div className="empty">{vacio}</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {rows.map((row) => (
              <Card key={row.id} className={rowClassName?.(row.original) ?? ""} interactive={!!onRowClick} onClick={onRowClick ? () => onRowClick(row.original) : undefined} style={{ minWidth: 0 }}>
                {row.getVisibleCells().map((cell) => (
                  <div key={cell.id} style={{ display: "grid", gridTemplateColumns: "minmax(64px, 38%) 1fr", gap: 8, alignItems: "start", padding: "4px 0" }}>
                    <span className="ds-muted ds-body-sm" style={{ overflowWrap: "anywhere" }}>{(cell.column.columnDef.meta as ColMeta | undefined)?.label ?? cell.column.id}</span>
                    <span className="ds-body-sm" style={{ textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
                  </div>
                ))}
              </Card>
            ))}
          </div>
        )
      ) : (
        /* Vista Tabla */
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none", overflowX: "auto" }}>
            <table className="ds-table dt-dark">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id} className="dt-headrow">
                    {renderExpanded && <th className="dt-hx" aria-hidden />}
                    {hg.headers.map((h) => {
                      const meta = h.column.columnDef.meta as ColMeta | undefined;
                      const sorted = h.column.getIsSorted(); const canSort = h.column.getCanSort();
                      const canFilter = h.column.getCanFilter();
                      const fv = h.column.getFilterValue();
                      const esFecha = isDateCol(h.column.columnDef);
                      const activos = esFecha
                        ? ((fv as DateRange | undefined)?.from || (fv as DateRange | undefined)?.to ? 1 : 0)
                        : ((fv as string[] | undefined) ?? []).length;
                      const isDragging = dragCol === h.column.id;
                      const isTarget = dragCol && dragCol !== h.column.id;
                      return (
                        <th
                          key={h.id}
                          className={meta?.num ? "ds-num" : ""}
                          draggable
                          onDragStart={(e) => { setDragCol(h.column.id); e.dataTransfer.effectAllowed = "move"; }}
                          onDragOver={(e) => { if (isTarget) e.preventDefault(); }}
                          onDrop={(e) => { e.preventDefault(); if (dragCol) reorderCol(dragCol, h.column.id); setDragCol(null); }}
                          onDragEnd={() => setDragCol(null)}
                          style={{ opacity: isDragging ? 0.4 : 1, boxShadow: isTarget ? "inset 2px 0 0 var(--ds-color-green-100)" : undefined }}
                        >
                          <div className="dt-hpill">
                            <button type="button" className="dt-hpill__label" title="Ordenar · arrastrá para mover"
                              onClick={canSort ? h.column.getToggleSortingHandler() : undefined}>
                              {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                              {canSort && <span className="dt-hpill__sort" aria-hidden>{sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}</span>}
                            </button>
                            {canFilter && (
                              <button type="button" className={`dt-hpill__filter${activos ? " is-active" : ""}${filterCol === h.column.id ? " is-open" : ""}`}
                                title={activos ? `${activos} filtro(s)` : "Filtrar"}
                                onClick={(e) => { e.stopPropagation(); abrirFiltro(h.column.id, e.currentTarget); }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>
                                {activos > 0 && <span className="dt-hpill__badge">{activos}</span>}
                              </button>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={table.getVisibleLeafColumns().length + (renderExpanded ? 1 : 0)}><div className="empty">{vacio}</div></td></tr>}
                {rows.map((row) => {
                  const open = expanded.has(row.id);
                  return (
                    <Fragment key={row.id}>
                      <tr className={[onRowClick ? "is-clickable" : "", rowClassName?.(row.original) ?? ""].filter(Boolean).join(" ")} onClick={onRowClick ? () => onRowClick(row.original) : undefined}>
                        {renderExpanded && (
                          <td className="dt-xcell" onClick={(e) => e.stopPropagation()}>
                            <button type="button" className={`dt-exp-btn${open ? " is-open" : ""}`} aria-expanded={open}
                              title={open ? "Ocultar líneas" : "Ver líneas"} onClick={() => toggleExpanded(row.id)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                            </button>
                          </td>
                        )}
                        {row.getVisibleCells().map((cell) => {
                          const meta = cell.column.columnDef.meta as ColMeta | undefined;
                          return <td key={cell.id} className={meta?.num ? "ds-num" : ""}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
                        })}
                      </tr>
                      {renderExpanded && (
                        <tr className="dt-exp-row">
                          <td colSpan={table.getVisibleLeafColumns().length + 1} style={{ padding: 0, border: 0 }}>
                            <div className={`dt-exp-wrap${open ? " is-open" : ""}`}>
                              <div className="dt-exp-clip">
                                <div className="dt-exp-body">{open ? renderExpanded(row.original) : null}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Paginación */}
      <div className="row row--between wrap gap-3 mt-4" style={{ alignItems: "center" }}>
        <span className="ds-body-sm ds-muted">Página {table.getState().pagination.pageIndex + 1} de {Math.max(1, table.getPageCount())}</span>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <Select value={String(pagination.pageSize)} onChange={(e) => setPagination((p) => ({ ...p, pageSize: Number(e.target.value), pageIndex: 0 }))} style={{ width: "auto", minWidth: 120 }}>
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / pág.</option>)}
          </Select>
          <button type="button" className="ds-navctrl" title="Anterior" aria-label="Página anterior"
            onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <button type="button" className="ds-navctrl" title="Siguiente" aria-label="Página siguiente"
            onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
      </div>

      {/* Popover de filtro por columna (buscador + checkboxes) */}
      {filterCol && (() => {
        const col = table.getColumn(filterCol);
        if (!col) return null;
        return <ColumnFilterPopover col={col} label={labelDe(filterCol)} anchor={filterAnchor} onClose={() => setFilterCol(null)} />;
      })()}
    </>
  );
}

// Popover de filtro estilo Adelante: cajita blanca flotante con buscador y lista
// de opciones (valores distintos de la columna) como checkboxes multi-selección.
// "Todos" limpia el filtro. Posición fija (evita recortes por el scroll horizontal).
function ColumnFilterPopover<T>({ col, label, anchor, onClose }: {
  col: Column<T, unknown>; label: string; anchor: { left: number; top: number }; onClose: () => void;
}) {
  // Hooks primero (siempre), luego la rama de fecha retorna antes de tocar `sel`
  // (para fecha el filtro es un objeto {from,to}, no un arreglo).
  const [q, setQ] = useState("");
  const opciones = useMemo(() => {
    if (isDateCol(col.columnDef)) return [] as string[];
    const set = new Set<string>();
    for (const k of col.getFacetedUniqueValues().keys()) { const s = asText(k); if (s !== "") set.add(s); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  }, [col]);

  // Columna de fecha: filtro por rango (día / mes / año / rango libre).
  if (isDateCol(col.columnDef)) {
    const range = (col.getFilterValue() as DateRange | undefined) ?? {};
    const setRange = (r: DateRange) => col.setFilterValue(r.from || r.to ? r : undefined);
    const pad = (n: number) => String(n).padStart(2, "0");
    const hoy = new Date();
    const y = hoy.getFullYear(), m = hoy.getMonth();
    const iso = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const mesFrom = `${y}-${pad(m + 1)}-01`, mesTo = iso(new Date(y, m + 1, 0));
    const hoyIso = iso(hoy);
    return (
      <>
        <div className="dt-filter-scrim" onClick={onClose} />
        <div className="dt-filter-pop" style={{ left: anchor.left, top: anchor.top }} onClick={(e) => e.stopPropagation()}>
          <div className="dt-filter-pop__list" style={{ padding: 14, gap: 12, display: "flex", flexDirection: "column" }}>
            <div className="dt-date-quick">
              <button type="button" onClick={() => setRange({ from: hoyIso, to: hoyIso })}>Hoy</button>
              <button type="button" onClick={() => setRange({ from: mesFrom, to: mesTo })}>Este mes</button>
              <button type="button" onClick={() => setRange({ from: `${y}-01-01`, to: `${y}-12-31` })}>Este año</button>
            </div>
            <label className="dt-date-field"><span>Desde</span>
              <input type="date" value={range.from ?? ""} max={range.to || undefined} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            </label>
            <label className="dt-date-field"><span>Hasta</span>
              <input type="date" value={range.to ?? ""} min={range.from || undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </label>
            <button type="button" className="dt-date-clear" onClick={() => setRange({})}>Limpiar</button>
          </div>
        </div>
      </>
    );
  }

  // Columna normal: multi-selección por checkboxes.
  const sel = new Set((col.getFilterValue() as string[] | undefined) ?? []);
  const visibles = opciones.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const todos = sel.size === 0;
  const toggle = (val: string) => {
    const next = new Set(sel);
    next.has(val) ? next.delete(val) : next.add(val);
    col.setFilterValue(next.size ? Array.from(next) : undefined);
  };

  return (
    <>
      <div className="dt-filter-scrim" onClick={onClose} />
      <div className="dt-filter-pop" style={{ left: anchor.left, top: anchor.top }} onClick={(e) => e.stopPropagation()}>
        <div className="dt-filter-pop__search">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar en ${label}…`} />
        </div>
        <div className="dt-filter-pop__list">
          <button type="button" className="dt-filter-row" onClick={() => col.setFilterValue(undefined)}>
            <span className={`dt-check${todos ? " is-checked" : ""}`} aria-hidden>{todos ? "✓" : ""}</span>
            <span className="dt-strong">Todos</span>
          </button>
          {visibles.length === 0 && <div className="dt-filter-empty">Sin coincidencias</div>}
          {visibles.map((opt) => {
            const on = sel.has(opt);
            return (
              <button key={opt} type="button" className="dt-filter-row" onClick={() => toggle(opt)}>
                <span className={`dt-check${on ? " is-checked" : ""}`} aria-hidden>{on ? "✓" : ""}</span>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}


