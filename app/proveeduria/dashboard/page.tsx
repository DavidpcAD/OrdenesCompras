"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AppShell } from "@/components/shell";
import { Tile, Badge, QtyRing } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { money, num } from "@/lib/helpers";

// Importe de una línea de artículo (pedido) y su parte recibida.
const impPedido = (l: { cantidad: number; precioUnitario: number; descuentoPct?: number }) =>
  l.cantidad * l.precioUnitario * (1 - (l.descuentoPct ?? 0) / 100);
const impRecibido = (l: { cantidadRecibida: number; precioUnitario: number; descuentoPct?: number }) =>
  (l.cantidadRecibida ?? 0) * l.precioUnitario * (1 - (l.descuentoPct ?? 0) / 100);

type LineaRow = { orden: string; estado: string; code: string; desc: string; unidad: string; cantidad: number; recibida: number; pendiente: number; monto: number };
type ProvRow = {
  proveedorId: string; nombre: string; currency: string;
  nOrdenes: number; pedido: number; recibido: number; pendiente: number; pct: number;
  lineas: LineaRow[];
};

// Dashboard de Proveeduría: qué se ha pedido vs. entregado, por proveedor.
// Cada fila se puede expandir para ver sus líneas. La tabla se puede filtrar,
// reordenar y guardar como vista (Columnas / Vistas) — Angie la arma como quiera.
export default function ProveeduriaDashboardPage() {
  const { ordenes, proveedores } = useStore();

  const { filas, tot } = useMemo(() => {
    const byProv = new Map<string, ProvRow>();
    for (const o of ordenes) {
      const prov = proveedores.find((p) => p.id === o.proveedorId);
      const nombre = o.proveedorNombre || prov?.nombre || o.proveedorId || "(sin proveedor)";
      const currency = o.currencyCode || prov?.currencyCode || "";
      if (!byProv.has(o.proveedorId)) {
        byProv.set(o.proveedorId, { proveedorId: o.proveedorId, nombre, currency, nOrdenes: 0, pedido: 0, recibido: 0, pendiente: 0, pct: 0, lineas: [] });
      }
      const r = byProv.get(o.proveedorId)!;
      r.nOrdenes += 1;
      for (const l of o.lineas) {
        if (l.tipo !== "articulo") continue;
        const ped = impPedido(l);
        const rec = impRecibido(l);
        r.pedido += ped; r.recibido += rec;
        r.lineas.push({
          orden: o.numero, estado: o.estado,
          code: l.articuloId || "", desc: l.descripcion, unidad: l.unidad,
          cantidad: l.cantidad, recibida: l.cantidadRecibida ?? 0,
          pendiente: Math.max(0, l.cantidad - (l.cantidadRecibida ?? 0)), monto: ped,
        });
      }
    }
    const filas = [...byProv.values()].map((r) => {
      r.pendiente = Math.max(0, r.pedido - r.recibido);
      r.pct = r.pedido > 0 ? Math.round((r.recibido / r.pedido) * 100) : 0;
      return r;
    }).sort((a, b) => b.pendiente - a.pendiente);
    const tot = filas.reduce((s, r) => ({ pedido: s.pedido + r.pedido, recibido: s.recibido + r.recibido }), { pedido: 0, recibido: 0 });
    return { filas, tot };
  }, [ordenes, proveedores]);

  const pctGlobal = tot.pedido > 0 ? Math.round((tot.recibido / tot.pedido) * 100) : 0;
  const pendienteGlobal = Math.max(0, tot.pedido - tot.recibido);

  const columns = useMemo<ColumnDef<ProvRow, any>[]>(() => [
    { id: "prov", header: "Proveedor", accessorFn: (r) => r.nombre, meta: { label: "Proveedor" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "ordenes", header: "Órdenes", accessorFn: (r) => r.nOrdenes, meta: { label: "Órdenes", num: true }, enableColumnFilter: false, cell: (c) => c.getValue() },
    { id: "pedido", header: "Pedido", accessorFn: (r) => r.pedido, meta: { label: "Pedido", num: true }, enableColumnFilter: false, cell: (c) => money(c.getValue(), c.row.original.currency) },
    { id: "recibido", header: "Entregado", accessorFn: (r) => r.recibido, meta: { label: "Entregado", num: true }, enableColumnFilter: false, cell: (c) => money(c.getValue(), c.row.original.currency) },
    { id: "pendiente", header: "Pendiente", accessorFn: (r) => r.pendiente, meta: { label: "Pendiente", num: true }, enableColumnFilter: false, cell: (c) => { const v = Number(c.getValue()); return <span className="ds-strong" style={{ color: v > 0 ? "var(--ds-color-red-200)" : "inherit" }}>{money(v, c.row.original.currency)}</span>; } },
    { id: "pct", header: "% entregado", accessorFn: (r) => r.pct, meta: { label: "% entregado", num: true }, enableColumnFilter: false, cell: (c) => { const r = c.row.original; return <div className="row gap-2" style={{ alignItems: "center", justifyContent: "flex-end" }}><QtyRing recibida={r.recibido} total={r.pedido} /><span className="ds-body-sm ds-muted">{r.pct}%</span></div>; } },
  ], []);

  const renderExpanded = (r: ProvRow) => (
    <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
      <table className="ds-table">
        <thead><tr><th>Orden</th><th>Artículo</th><th className="ds-num">Pedido</th><th className="ds-num">Entregado</th><th className="ds-num">Pendiente</th><th className="ds-num">Monto</th></tr></thead>
        <tbody>
          {r.lineas.map((l, i) => (
            <tr key={`${l.orden}-${l.code}-${i}`}>
              <td><span className="ds-strong ds-body-sm">{l.orden}</span></td>
              <td><span className="ds-strong ds-body-sm">{l.code}</span> <span className="ds-muted">— {l.desc}</span></td>
              <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
              <td className="ds-num">{num.format(l.recibida)}</td>
              <td className="ds-num ds-strong">{num.format(l.pendiente)}</td>
              <td className="ds-num">{money(l.monto, r.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <AppShell role="proveeduria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Dashboard</h1>
            <p className="ds-muted">Lo pedido vs. lo entregado, por proveedor. Abrí un proveedor para ver sus líneas. Filtrá, ordená y guardá tu vista.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={money(tot.pedido, "CRC")} label="Pedido (total)" />
          <Tile value={money(tot.recibido, "CRC")} label="Entregado (total)" accent="var(--ds-color-green-200)" />
          <Tile value={`${pctGlobal}%`} label="Entregado (global)" accent="var(--ds-color-green-100)" />
          <Tile value={money(pendienteGlobal, "CRC")} label="Pendiente por entregar" accent="var(--ds-color-red-100)" />
        </div>

        <h2 className="ds-subtitle" style={{ marginTop: 28 }}>Por proveedor</h2>
        <div className="mt-2">
          <DataTable data={filas} columns={columns} tablaKey="dash-prov" getRowId={(r) => r.proveedorId} renderExpanded={renderExpanded} vacio="Todavía no hay órdenes de compra." />
        </div>
      </main>
    </AppShell>
  );
}
