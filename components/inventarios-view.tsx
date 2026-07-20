"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { money, num } from "@/lib/helpers";
import type { Articulo } from "@/lib/types";

type Row = Articulo & { recibido: number };
type Existencia = { itemNo: string; variantCode: string; locationCode: string; descripcion: string; cantidad: number; unidad: string };
type StockEstado = "loading" | "ok" | "empty" | "error";
type StockInfo = { estado: StockEstado; total: number; detalle: Existencia[]; error?: string };

// Catálogo de artículos con su STOCK TOTAL de Business Central en una sola tabla.
// Al expandir una fila se ve el desglose por almacén y variante (inventoryByLocation).
// Compartido por Ingeniería y Proveeduría (cambia solo el AppShell que lo envuelve).
export function InventariosView({ tablaKey = "inventarios" }: { tablaKey?: string }) {
  const { articulos, ordenes } = useStore();

  const rows = useMemo<Row[]>(() => {
    const rec = new Map<string, number>();
    for (const o of ordenes) for (const l of o.lineas) {
      if (l.tipo === "articulo" && l.articuloId) rec.set(l.articuloId, (rec.get(l.articuloId) ?? 0) + (l.cantidadRecibida ?? 0));
    }
    return articulos.map((a) => ({ ...a, recibido: rec.get(a.code) ?? rec.get(a.id) ?? 0 }));
  }, [articulos, ordenes]);

  // Stock por artículo (total + desglose) desde BC. Se cargan todos en segundo
  // plano con concurrencia limitada; el total se llena progresivamente y el
  // desglose queda cacheado para cuando se expande la fila.
  const [stock, setStock] = useState<Record<string, StockInfo>>({});
  const codesKey = useMemo(() => rows.map((r) => r.code).filter(Boolean).join(","), [rows]);

  useEffect(() => {
    const codes = codesKey ? codesKey.split(",") : [];
    if (!codes.length) return;
    let vivo = true;
    setStock((prev) => {
      const n = { ...prev };
      for (const c of codes) if (!n[c]) n[c] = { estado: "loading", total: 0, detalle: [] };
      return n;
    });
    let i = 0;
    const LIMITE = 6;
    const worker = async () => {
      while (vivo && i < codes.length) {
        const code = codes[i++];
        try {
          const r = await fetch(`/api/bc/existencias?itemNo=${encodeURIComponent(code)}`);
          const body = await r.json().catch(() => ({}));
          if (!vivo) return;
          if (!r.ok) { setStock((p) => ({ ...p, [code]: { estado: "error", total: 0, detalle: [], error: body?.error } })); continue; }
          const ex: Existencia[] = Array.isArray(body?.existencias) ? body.existencias : [];
          const total = ex.reduce((s, e) => s + (Number(e.cantidad) || 0), 0);
          setStock((p) => ({ ...p, [code]: { estado: ex.length ? "ok" : "empty", total, detalle: ex } }));
        } catch (e: any) {
          if (vivo) setStock((p) => ({ ...p, [code]: { estado: "error", total: 0, detalle: [], error: String(e?.message ?? e) } }));
        }
      }
    };
    Promise.all(Array.from({ length: Math.min(LIMITE, codes.length) }, worker));
    return () => { vivo = false; };
  }, [codesKey]);

  const columns = useMemo<ColumnDef<Row, any>[]>(() => [
    { id: "code", header: "Código", accessorFn: (a) => a.code, meta: { label: "Código" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "desc", header: "Descripción", accessorFn: (a) => a.descripcion, meta: { label: "Descripción" }, cell: (c) => c.getValue() },
    { id: "unidad", header: "Unidad", accessorFn: (a) => a.unidad, meta: { label: "Unidad" }, cell: (c) => c.getValue() },
    {
      id: "stock", header: "Stock (BC)", accessorFn: (a) => stock[a.code]?.total ?? 0,
      meta: { label: "Stock (BC)", num: true }, enableColumnFilter: false,
      cell: (c) => {
        const a = c.row.original as Row;
        const info = stock[a.code];
        if (!info || info.estado === "loading") return <span className="ds-muted">…</span>;
        if (info.estado === "error") return <span className="ds-muted" title={info.error}>s/d</span>;
        const v = info.total;
        return <span className="ds-strong" style={{ color: v > 0 ? "var(--ds-color-green-300)" : "var(--ds-color-gray-400)" }}>{num.format(v)} {a.unidad}</span>;
      },
    },
    { id: "alm", header: "Almacén def.", accessorFn: (a) => a.almacenDefault ?? "—", meta: { label: "Almacén def." }, cell: (c) => c.getValue() },
    { id: "precio", header: "Precio ref.", accessorFn: (a) => a.precioReferencia ?? 0, meta: { label: "Precio ref.", num: true }, enableColumnFilter: false, cell: (c) => money(c.getValue(), "CRC") },
    { id: "recibido", header: "Recibido (app)", accessorFn: (a) => a.recibido, meta: { label: "Recibido (app)", num: true }, enableColumnFilter: false, cell: (c) => num.format(c.getValue()) },
  ], [stock]);

  // Desglose por almacén/variante al expandir la fila (solo ubicaciones con stock).
  const renderExpanded = (a: Row) => {
    const info = stock[a.code];
    if (!info || info.estado === "loading") return <div className="ds-muted ds-body-sm" style={{ padding: "6px 2px" }}>Consultando existencias en Business Central…</div>;
    if (info.estado === "error") return <div className="ds-body-sm" style={{ padding: "6px 2px", color: "var(--ds-color-red-200)" }}>No se pudo cargar de BC: {info.error || "sin conexión"}. Puede que <code>inventoryByLocation</code> no esté publicado o no haya conexión.</div>;
    const conStock = info.detalle.filter((e) => Number(e.cantidad) !== 0).sort((x, y) => y.cantidad - x.cantidad);
    if (!conStock.length) return <div className="ds-muted ds-body-sm" style={{ padding: "6px 2px" }}>Sin existencias en ninguna ubicación.</div>;
    return (
      <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
        <table className="ds-table">
          <thead>
            <tr><th>Almacén</th><th>Variante</th><th className="ds-num">Disponible</th><th>Unidad</th></tr>
          </thead>
          <tbody>
            {conStock.map((e, i) => (
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
          <p className="ds-muted">Catálogo de artículos con su <strong>stock total</strong> en Business Central. Expandí un material (⌄) para ver en <strong>qué almacenes y variantes</strong> tiene existencias (almacén general o el almacén virtual de cada obra).</p>
        </div>
      </div>

      <div className="mt-4">
        <DataTable data={rows} columns={columns} tablaKey={tablaKey} getRowId={(a) => a.code} renderExpanded={renderExpanded} vacio="Sin artículos en el catálogo." />
      </div>
    </main>
  );
}
