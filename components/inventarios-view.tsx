"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Skeleton } from "@/components/ui";
import { useStore } from "@/lib/store";
import { money, num } from "@/lib/helpers";

type Row = { code: string; descripcion: string; unidad: string; almacenDefault: string; precioReferencia: number; recibido: number };
type Existencia = { itemNo: string; variantCode: string; locationCode: string; descripcion: string; cantidad: number; unidad: string };
type StockInfo = { total: number; detalle: Existencia[] };
type StockEstado = "loading" | "ok" | "error";

// Catálogo COMPLETO de artículos de Business Central con su stock total, en una
// sola tabla. Al expandir una fila se ve el desglose por almacén y variante.
// El stock se trae POR ALMACÉN (pocas llamadas) y se agrega por ítem, así escala
// aunque el catálogo tenga cientos de productos.
// Compartido por Ingeniería y Proveeduría (cambia solo el AppShell que lo envuelve).
export function InventariosView({ tablaKey = "inventarios" }: { tablaKey?: string }) {
  const { articulos, ordenes } = useStore();

  // Catálogo de BC (todos los productos). Fallback al catálogo local si BC no responde.
  const [items, setItems] = useState<{ code: string; descripcion: string; unidad: string; lastDirectCost?: number }[] | null>(null);
  useEffect(() => {
    fetch("/api/bc/items")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (Array.isArray(d.items)) setItems(d.items.map((i: any) => ({ code: i.code, descripcion: i.descripcion, unidad: i.unidad || "UND", lastDirectCost: typeof i.lastDirectCost === "number" ? i.lastDirectCost : undefined }))); })
      .catch(() => { /* sin BC: se usa el catálogo local */ });
  }, []);

  const recibidoMap = useMemo(() => {
    const rec = new Map<string, number>();
    for (const o of ordenes) for (const l of o.lineas) {
      if (l.tipo === "articulo" && l.articuloId) rec.set(l.articuloId, (rec.get(l.articuloId) ?? 0) + (l.cantidadRecibida ?? 0));
    }
    return rec;
  }, [ordenes]);
  const artByCode = useMemo(() => { const m = new Map<string, any>(); for (const a of articulos) m.set(a.code, a); return m; }, [articulos]);

  const rows = useMemo<Row[]>(() => {
    const base = (items && items.length)
      ? items
      : articulos.map((a) => ({ code: a.code, descripcion: a.descripcion, unidad: a.unidad, lastDirectCost: undefined as number | undefined }));
    return base.map((b) => {
      const a = artByCode.get(b.code);
      return {
        code: b.code,
        descripcion: b.descripcion,
        unidad: b.unidad,
        almacenDefault: a?.almacenDefault ?? "—",
        precioReferencia: a?.precioReferencia ?? b.lastDirectCost ?? 0,
        recibido: recibidoMap.get(b.code) ?? 0,
      };
    });
  }, [items, articulos, artByCode, recibidoMap]);

  // Stock por ítem: se trae POR ALMACÉN y se agrega. Una sola pasada (concurrencia
  // limitada); el total y el desglose quedan cacheados. Escala con #almacenes, no
  // con #productos.
  const [stockByItem, setStockByItem] = useState<Record<string, StockInfo>>({});
  const [stockEstado, setStockEstado] = useState<StockEstado>("loading");
  useEffect(() => {
    let vivo = true;
    (async () => {
      setStockEstado("loading");
      let locs: string[] = [];
      try {
        const r = await fetch("/api/bc/almacenes");
        const d = await r.json().catch(() => ({}));
        locs = Array.isArray(d.almacenes) ? d.almacenes.map((a: any) => a.codigo).filter(Boolean) : [];
      } catch { /* sin BC */ }
      if (!vivo) return;
      if (!locs.length) { setStockEstado("error"); return; }
      const map: Record<string, StockInfo> = {};
      let i = 0, okAlguno = false;
      const LIMITE = 6;
      const worker = async () => {
        while (vivo && i < locs.length) {
          const loc = locs[i++];
          try {
            const r = await fetch(`/api/bc/existencias?locationCode=${encodeURIComponent(loc)}`);
            const d = await r.json().catch(() => ({}));
            if (!r.ok) continue;
            okAlguno = true;
            for (const e of (d.existencias ?? []) as Existencia[]) {
              const it = e.itemNo; if (!it) continue;
              const cant = Number(e.cantidad) || 0;
              if (!map[it]) map[it] = { total: 0, detalle: [] };
              map[it].total += cant;
              if (cant !== 0) map[it].detalle.push(e);
            }
          } catch { /* salta este almacén */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(LIMITE, locs.length) }, worker));
      if (!vivo) return;
      setStockByItem(map);
      setStockEstado(okAlguno ? "ok" : "error");
    })();
    return () => { vivo = false; };
  }, []);

  const columns = useMemo<ColumnDef<Row, any>[]>(() => [
    { id: "code", header: "Código", accessorFn: (a) => a.code, meta: { label: "Código" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "desc", header: "Descripción", accessorFn: (a) => a.descripcion, meta: { label: "Descripción" }, cell: (c) => c.getValue() },
    { id: "unidad", header: "Unidad", accessorFn: (a) => a.unidad, meta: { label: "Unidad" }, cell: (c) => c.getValue() },
    {
      id: "stock", header: "Stock (BC)", accessorFn: (a) => stockByItem[a.code]?.total ?? 0,
      meta: { label: "Stock (BC)", num: true }, enableColumnFilter: false,
      cell: (c) => {
        const a = c.row.original as Row;
        if (stockEstado === "loading") return <Skeleton width={54} height={13} />;
        if (stockEstado === "error") return <span className="ds-muted" title="Business Central no respondió">s/d</span>;
        const v = stockByItem[a.code]?.total ?? 0;
        return <span className="ds-strong" style={{ color: v > 0 ? "var(--ds-color-green-300)" : "var(--ds-color-gray-400)" }}>{num.format(v)} {a.unidad}</span>;
      },
    },
    { id: "alm", header: "Almacén def.", accessorFn: (a) => a.almacenDefault, meta: { label: "Almacén def." }, cell: (c) => c.getValue() },
    { id: "precio", header: "Precio ref.", accessorFn: (a) => a.precioReferencia, meta: { label: "Precio ref.", num: true }, enableColumnFilter: false, cell: (c) => money(c.getValue(), "CRC") },
    { id: "recibido", header: "Recibido (app)", accessorFn: (a) => a.recibido, meta: { label: "Recibido (app)", num: true }, enableColumnFilter: false, cell: (c) => num.format(c.getValue()) },
  ], [stockByItem, stockEstado]);

  // Desglose por almacén/variante al expandir la fila (solo ubicaciones con stock).
  const renderExpanded = (a: Row) => {
    if (stockEstado === "loading") return (
      <div className="col gap-2" style={{ padding: "8px 2px" }}>
        {[70, 55, 62].map((w, i) => (
          <div key={i} className="row gap-4" style={{ alignItems: "center" }}>
            <Skeleton width={`${w}%`} height={12} style={{ maxWidth: 260 }} />
            <Skeleton width={40} height={12} />
          </div>
        ))}
      </div>
    );
    if (stockEstado === "error") return <div className="ds-body-sm" style={{ padding: "6px 2px", color: "var(--ds-color-red-200)" }}>No se pudo cargar el stock de BC. Puede que <code>inventoryByLocation</code> no esté publicado o no haya conexión.</div>;
    const det = (stockByItem[a.code]?.detalle ?? []).filter((e) => Number(e.cantidad) !== 0).sort((x, y) => y.cantidad - x.cantidad);
    if (!det.length) return <div className="ds-muted ds-body-sm" style={{ padding: "6px 2px" }}>Sin existencias en ninguna ubicación.</div>;
    return (
      <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
        <table className="ds-table">
          <thead>
            <tr><th>Almacén</th><th>Variante</th><th className="ds-num">Disponible</th><th>Unidad</th></tr>
          </thead>
          <tbody>
            {det.map((e, i) => (
              <tr key={`${e.locationCode}-${e.variantCode}-${i}`}>
                <td className="ds-strong">{e.locationCode || "—"}</td>
                <td>{e.variantCode || "(sin variante)"}</td>
                <td className="ds-num ds-strong" style={{ color: "var(--ds-color-green-300)" }}>{num.format(e.cantidad)}</td>
                <td className="ds-muted">{e.unidad || a.unidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <main className="page page--wide">
      <div className="page__head">
        <div className="page__title">
          <h1 className="ds-heading">Inventarios</h1>
          <p className="ds-muted">Todos los artículos de Business Central con su <strong>stock total</strong>. Expandí un material (⌄) para ver en <strong>qué almacenes y variantes</strong> tiene existencias (almacén general o el almacén virtual de cada obra).</p>
        </div>
      </div>

      <div className="mt-4 ds-reveal">
        <DataTable data={rows} columns={columns} tablaKey={tablaKey} buscarPlaceholder="Buscar por código o descripción…" getRowId={(a) => a.code} renderExpanded={renderExpanded} vacio="Sin artículos en el catálogo." />
      </div>
    </main>
  );
}
