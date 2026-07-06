"use client";

import { useEffect, useRef, useState } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel, flexRender,
  type ColumnDef, type SortingState, type ColumnFiltersState, type VisibilityState, type ColumnOrderState, type PaginationState,
} from "@tanstack/react-table";
import { Button, Card, Input } from "@/components/ui";
import { useStore } from "@/lib/store";

// Motor de tabla reutilizable (TanStack, headless) con el design system de la app.
// Vista Tabla o Grid, ordenar, filtro por columna, búsqueda global, mostrar/ocultar
// y reordenar columnas, paginación, y VISTAS guardadas por usuario en SQL (/api/vistas).
// Cada columna debe tener `id`; opcional meta.label (nombre legible) y meta.num (derecha).

type ColMeta = { label?: string; num?: boolean };
type VistaCfg = {
  columnOrder?: ColumnOrderState; columnVisibility?: VisibilityState; sorting?: SortingState;
  columnFilters?: ColumnFiltersState; globalFilter?: string; pageSize?: number; modo?: "tabla" | "grid";
};
type Vista = { id: number; nombre: string; config: VistaCfg; esPredeterminada: boolean };

export function DataTable<T>({
  data, columns, tablaKey, getRowId, onRowClick, vacio = "No hay registros.", modoInicial = "tabla",
}: {
  data: T[];
  columns: ColumnDef<T, any>[];
  tablaKey: string;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  vacio?: string;
  modoInicial?: "tabla" | "grid";
}) {
  const { usuario } = useStore();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => columns.map((c) => c.id!).filter(Boolean));
  const [globalFilter, setGlobalFilter] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [panel, setPanel] = useState<null | "cols" | "vistas">(null);
  const [modo, setModo] = useState<"tabla" | "grid">(modoInicial);

  const table = useReactTable({
    data, columns,
    state: { sorting, columnFilters, columnVisibility, columnOrder, globalFilter, pagination },
    onSortingChange: setSorting, onColumnFiltersChange: setColumnFilters, onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder, onGlobalFilterChange: setGlobalFilter, onPaginationChange: setPagination,
    globalFilterFn: "includesString",
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
  });

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
  const labelDe = (colId: string) => (leaf.find((x) => x.id === colId)?.columnDef.meta as ColMeta | undefined)?.label ?? colId;
  const rows = table.getRowModel().rows;

  return (
    <>
      {/* Toolbar */}
      <div className="row row--between wrap gap-3" style={{ marginBottom: 14, alignItems: "center", position: "relative" }}>
        <Input value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} placeholder="Buscar…" style={{ maxWidth: 300 }} />
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <span className="ds-muted ds-body-sm">{table.getFilteredRowModel().rows.length}</span>
          <div className="segmented">
            <button type="button" className={`segmented__btn ${modo === "tabla" ? "is-active" : ""}`} onClick={() => setModo("tabla")}>Tabla</button>
            <button type="button" className={`segmented__btn ${modo === "grid" ? "is-active" : ""}`} onClick={() => setModo("grid")}>Grid</button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setPanel(panel === "cols" ? null : "cols")}>Columnas</Button>
          <Button variant="ghost" size="sm" onClick={() => setPanel(panel === "vistas" ? null : "vistas")}>Vistas</Button>
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
                    <input type="checkbox" checked={col.getIsVisible()} onChange={col.getToggleVisibilityHandler()} /> {labelDe(cid)}
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
      </div>

      {/* Vista Grid (tarjetas) */}
      {modo === "grid" ? (
        rows.length === 0 ? <div className="empty">{vacio}</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {rows.map((row) => (
              <Card key={row.id} interactive={!!onRowClick} onClick={onRowClick ? () => onRowClick(row.original) : undefined}>
                {row.getVisibleCells().map((cell) => (
                  <div key={cell.id} className="row row--between gap-3" style={{ alignItems: "center", padding: "3px 0" }}>
                    <span className="ds-muted ds-body-sm">{(cell.column.columnDef.meta as ColMeta | undefined)?.label ?? cell.column.id}</span>
                    <span className="ds-body-sm" style={{ textAlign: "right" }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
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
            <table className="ds-table">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const meta = h.column.columnDef.meta as ColMeta | undefined;
                      const sorted = h.column.getIsSorted(); const canSort = h.column.getCanSort();
                      return (
                        <th key={h.id} className={meta?.num ? "ds-num" : ""} style={{ cursor: canSort ? "pointer" : undefined, userSelect: "none", whiteSpace: "nowrap" }} onClick={canSort ? h.column.getToggleSortingHandler() : undefined}>
                          {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                          {canSort && <span className="ds-muted" style={{ fontSize: 10 }}> {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}</span>}
                        </th>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  {table.getVisibleLeafColumns().map((col) => (
                    <th key={col.id} style={{ padding: "4px 6px", fontWeight: 400 }}>
                      {col.getCanFilter() ? (
                        <input className="ds-cell-input" value={(col.getFilterValue() as string) ?? ""} placeholder="Filtrar…" onChange={(e) => col.setFilterValue(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={table.getVisibleLeafColumns().length}><div className="empty">{vacio}</div></td></tr>}
                {rows.map((row) => (
                  <tr key={row.id} className={onRowClick ? "is-clickable" : ""} onClick={onRowClick ? () => onRowClick(row.original) : undefined}>
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as ColMeta | undefined;
                      return <td key={cell.id} className={meta?.num ? "ds-num" : ""}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Paginación */}
      <div className="row row--between wrap gap-3 mt-4" style={{ alignItems: "center" }}>
        <span className="ds-body-sm ds-muted">Página {table.getState().pagination.pageIndex + 1} de {Math.max(1, table.getPageCount())}</span>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <select className="ds-form-field__select" value={pagination.pageSize} onChange={(e) => setPagination((p) => ({ ...p, pageSize: Number(e.target.value), pageIndex: 0 }))} style={{ width: "auto" }}>
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / pág.</option>)}
          </select>
          <Button variant="ghost" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>‹ Anterior</Button>
          <Button variant="ghost" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Siguiente ›</Button>
        </div>
      </div>
    </>
  );
}
