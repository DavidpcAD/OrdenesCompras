"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, QtyRing } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { money, formatDate, ordenBadge, ordenRecibidoPct, ordenSubtotal, ordenPedidos, ordenEsDirecta, ordenLineaImporte, num } from "@/lib/helpers";
import type { Orden } from "@/lib/types";

// Lista de órdenes reutilizable (Proveeduría / Aprobación / Bodega), ahora sobre
// DataTable: el usuario ordena, filtra, muestra/oculta y reordena columnas y
// guarda sus vistas (SQL). Cada uso pasa a dónde navega cada fila.
export function OrdenesLista({
  ordenes,
  hrefDetalle,
  vacio = "No hay órdenes.",
}: {
  ordenes: Orden[];
  hrefDetalle: (id: string) => string;
  vacio?: string;
}) {
  const { proveedores } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);

  const columns = useMemo<ColumnDef<Orden, any>[]>(() => [
    { id: "num", header: "N.º", accessorFn: (o) => o.numero, meta: { label: "N.º" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "prov", header: "Proveedor", accessorFn: (o) => o.proveedorNombre ?? prov(o.proveedorId)?.nombre ?? "—", meta: { label: "Proveedor" }, cell: (c) => c.getValue() },
    {
      id: "solic", header: "Solicitudes", accessorFn: (o) => (ordenEsDirecta(o) ? "Directa" : ordenPedidos(o).join(" ")), meta: { label: "Solicitudes" },
      cell: (c) => {
        const o = c.row.original; const peds = ordenPedidos(o); const dir = ordenEsDirecta(o);
        return <div className="row gap-2 wrap">{dir && <Badge tone="yellow">Directa</Badge>}{peds.slice(0, 2).map((n) => <Badge key={n} tone="gray">{n}</Badge>)}{peds.length > 2 && <span className="ds-muted ds-body-sm">+{peds.length - 2}</span>}</div>;
      },
    },
    { id: "fecha", header: "Fecha", accessorFn: (o) => o.fecha, meta: { label: "Fecha" }, cell: (c) => formatDate(c.getValue()) },
    { id: "total", header: "Total", accessorFn: (o) => ordenSubtotal(o), meta: { label: "Total", num: true }, cell: (c) => money(c.getValue(), c.row.original.currencyCode) },
    {
      id: "recibido", header: "Recibido", accessorFn: (o) => ordenRecibidoPct(o), meta: { label: "Recibido" }, enableColumnFilter: false,
      cell: (c) => {
        const o = c.row.original;
        return <div className="row gap-3"><QtyRing recibida={o.lineas.reduce((s, l) => s + l.cantidadRecibida, 0)} total={o.lineas.reduce((s, l) => s + l.cantidad, 0)} /><span className="ds-body-sm ds-muted">{ordenRecibidoPct(o)}%</span></div>;
      },
    },
    { id: "estado", header: "Estado", accessorFn: (o) => ordenBadge(o.estado).label, meta: { label: "Estado" }, cell: (c) => { const b = ordenBadge(c.row.original.estado); return <Badge tone={b.tone}>{b.label}</Badge>; } },
  ], [proveedores]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DataTable
      data={ordenes}
      columns={columns}
      tablaKey="ordenes"
      getRowId={(o) => o.id}
      onRowClick={(o) => router.push(hrefDetalle(o.id))}
      vacio={vacio}
      renderExpanded={(o) => (
        <table className="ds-table" style={{ boxShadow: "none", background: "transparent" }}>
          <thead>
            <tr><th>Descripción</th><th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Importe</th></tr>
          </thead>
          <tbody>
            {o.lineas.map((l) => (
              <tr key={l.id}>
                <td>{l.descripcion}{l.pedidoNumero && <div className="ds-body-sm ds-muted">{l.pedidoNumero}</div>}</td>
                <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
                <td className="ds-num">{money(l.precioUnitario, o.currencyCode)}</td>
                <td className="ds-num ds-strong">{money(ordenLineaImporte(l), o.currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    />
  );
}
