"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { AppShell } from "@/components/shell";
import { Badge, Tile } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { money, formatDate } from "@/lib/helpers";
import type { Recepcion } from "@/lib/types";

export default function ArchivoPage() {
  const { ordenes, recepciones, proveedores } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);
  const ordenDe = (r: Recepcion) => ordenes.find((x) => x.id === r.ordenId);
  const completadas = ordenes.filter((o) => o.estado === "completado");

  const columns = useMemo<ColumnDef<Recepcion, any>[]>(() => [
    { id: "factura", header: "Factura", accessorFn: (r) => r.numeroFactura, meta: { label: "Factura" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "orden", header: "Orden", accessorFn: (r) => ordenDe(r)?.numero ?? "—", meta: { label: "Orden" }, cell: (c) => c.getValue() },
    { id: "proveedor", header: "Proveedor", accessorFn: (r) => { const o = ordenDe(r); return (o ? (o.proveedorNombre ?? prov(o.proveedorId)?.nombre) : "") ?? "—"; }, meta: { label: "Proveedor" }, cell: (c) => c.getValue() },
    { id: "fecha", header: "Fecha registro", accessorFn: (r) => r.fechaRegistro, meta: { label: "Fecha registro" }, cell: (c) => formatDate(c.getValue()) },
    { id: "total", header: "Total", accessorFn: (r) => r.total, meta: { label: "Total", num: true }, cell: (c) => money(c.getValue(), ordenDe(c.row.original)?.currencyCode) },
    { id: "tipo", header: "Tipo", accessorFn: (r) => (r.parcial ? "Parcial" : "Completa"), meta: { label: "Tipo" }, cell: (c) => c.row.original.parcial ? <Badge tone="yellow">Parcial</Badge> : <Badge tone="green">Completa</Badge> },
  ], [ordenes, proveedores]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppShell role="facturacion">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Archivo y recepciones</h1>
            <p className="ds-muted">Órdenes recibidas al 100% y todas las facturas registradas.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={recepciones.length} label="Facturas registradas" accent="var(--ds-color-green-100)" />
          <Tile value={completadas.length} label="Órdenes completadas" accent="var(--ds-color-green-200)" />
          <Tile value={money(recepciones.reduce((s, r) => s + r.total, 0))} label="Total facturado" accent="var(--ds-color-gray-300)" />
          <Tile value={recepciones.filter((r) => r.parcial).length} label="Entregas parciales" accent="var(--ds-color-yellow)" />
        </div>

        <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Facturas registradas</h3>
        <DataTable data={recepciones} columns={columns} tablaKey="recepciones" getRowId={(r) => r.id} onRowClick={(r) => router.push(`/facturacion/recepcion/${r.id}`)} vacio="Sin facturas registradas." />
      </main>
    </AppShell>
  );
}
