"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { FiltroChip, ProgressBar } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useFiltroPantalla } from "@/lib/use-filtro-pantalla";
import { money, num } from "@/lib/helpers";
import type { FilaProv } from "@/lib/compras-proveedores";

// La pestaña "Proveedores" de Compras: lo pedido vs. lo entregado, por proveedor, con
// las líneas de cada uno al desplegar. Era la pantalla de Dashboard; su resumen de
// arriba se mudó al encabezado de Compras y acá quedó la tabla, que es lo que se
// acciona: a quién hay que corretearle el material.
// El cálculo llega hecho desde la pantalla (`resumenPorProveedor`) porque el encabezado
// necesita los mismos totales y sería un desperdicio recorrer 488 órdenes dos veces.

type Filtro = "todos" | "pendiente" | "aldia";

export function ComprasProveedores({ filas }: { filas: FilaProv[] }) {
  const [filtro, elegirFiltro] = useFiltroPantalla<Filtro>(
    "adelante_oc_kpi_compras-prov", "todos",
    (v) => (["todos", "pendiente", "aldia"] as string[]).includes(v),
  );

  const conPendiente = filas.filter((r) => r.pendiente > 0).length;
  const base = useMemo(
    () => filtro === "todos" ? filas : filtro === "pendiente" ? filas.filter((r) => r.pendiente > 0) : filas.filter((r) => r.pendiente <= 0),
    [filas, filtro],
  );

  const columns = useMemo<ColumnDef<FilaProv, any>[]>(() => [
    { id: "prov", header: "Proveedor", accessorFn: (r) => r.nombre, meta: { label: "Proveedor" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "ordenes", header: "Órdenes", accessorFn: (r) => r.nOrdenes, meta: { label: "Órdenes", num: true }, enableColumnFilter: false, cell: (c) => c.getValue() },
    { id: "pedido", header: "Pedido", accessorFn: (r) => r.pedido, meta: { label: "Pedido", num: true }, enableColumnFilter: false, cell: (c) => money(c.getValue(), c.row.original.currency) },
    { id: "recibido", header: "Entregado", accessorFn: (r) => r.recibido, meta: { label: "Entregado", num: true }, enableColumnFilter: false, cell: (c) => money(c.getValue(), c.row.original.currency) },
    { id: "pendiente", header: "Pendiente", accessorFn: (r) => r.pendiente, meta: { label: "Pendiente", num: true }, enableColumnFilter: false, cell: (c) => { const v = Number(c.getValue()); return <span className="ds-strong" style={{ color: v > 0 ? "var(--ds-color-red-200)" : "inherit" }}>{money(v, c.row.original.currency)}</span>; } },
    { id: "pct", header: "% entregado", accessorFn: (r) => r.pct, meta: { label: "% entregado", num: true }, enableColumnFilter: false, cell: (c) => { const r = c.row.original; return <div className="row" style={{ justifyContent: "flex-end" }}><ProgressBar compact value={r.recibido} total={r.pedido} /></div>; } },
  ], []);

  const renderExpanded = (r: FilaProv) => (
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
    <>
      <div className="filtros">
        <FiltroChip value={filas.length} label="Todos" onClick={() => elegirFiltro("todos")} active={filtro === "todos"} />
        <FiltroChip value={conPendiente} label="Con pendiente" accent="var(--ds-color-red-200)" onClick={() => elegirFiltro("pendiente")} active={filtro === "pendiente"} title="Proveedores que deben material" />
        <FiltroChip value={filas.length - conPendiente} label="Al día" accent="var(--ds-color-green-200)" onClick={() => elegirFiltro("aldia")} active={filtro === "aldia"} title="Ya entregaron todo lo que se les pidió" />
      </div>

      <div className="mt-4">
        <DataTable data={base} columns={columns} tablaKey="dash-prov" buscarPlaceholder="Buscar proveedor…" getRowId={(r) => r.proveedorId} renderExpanded={renderExpanded} vacio="Todavía no hay órdenes de compra." />
      </div>
    </>
  );
}
