"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { AppShell } from "@/components/shell";
import { Badge } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { destinoLabel, num, recibidoDeLineaPedido, tipoSolicitudBadge } from "@/lib/helpers";
import type { TipoSolicitud } from "@/lib/types";

type Fila = {
  key: string; proyecto: string; pedidoId: string; pedidoNumero: string; tipo: TipoSolicitud;
  articulo: string; unidad: string; almacen: string; solicitado: number; recibido: number; pendiente: number; comentario: string;
};

export default function SeguimientoPage() {
  const { pedidos, ordenes } = useStore();
  const router = useRouter();

  const filas = useMemo<Fila[]>(() => pedidos.flatMap((p) => p.lineas.map((l) => {
    const recibido = recibidoDeLineaPedido(ordenes, l.id);
    return {
      key: l.id, proyecto: destinoLabel(p), pedidoId: p.id, pedidoNumero: p.numero, tipo: p.tipoSolicitud,
      articulo: l.descripcion, unidad: l.unidad, almacen: l.almacen, solicitado: l.cantidad, recibido,
      pendiente: Math.max(0, l.cantidad - recibido), comentario: p.notas ?? "",
    };
  })), [pedidos, ordenes]);

  const columns = useMemo<ColumnDef<Fila, any>[]>(() => [
    { id: "proyecto", header: "Proyecto", accessorFn: (f) => f.proyecto, meta: { label: "Proyecto" }, cell: (c) => c.getValue() },
    { id: "obra", header: "Obra", accessorFn: (f) => f.almacen ?? "", meta: { label: "Obra" }, cell: (c) => <span className="ds-muted">{c.getValue() || "—"}</span> },
    { id: "pedido", header: "Pedido", accessorFn: (f) => f.pedidoNumero, meta: { label: "Pedido" }, cell: (c) => { const f = c.row.original; const t = tipoSolicitudBadge(f.tipo); return <span className="row gap-2" style={{ alignItems: "center" }}><Badge tone={t.tone}>{t.label}</Badge><span className="ds-body-sm ds-strong">{f.pedidoNumero}</span></span>; } },
    { id: "articulo", header: "Artículo", accessorFn: (f) => f.articulo, meta: { label: "Artículo" }, cell: (c) => <div className="ds-truncate" title={c.getValue()} style={{ maxWidth: 260 }}>{c.getValue()}</div> },
    { id: "solicitado", header: "Solicitado", accessorFn: (f) => f.solicitado, meta: { label: "Solicitado", num: true }, enableColumnFilter: false, cell: (c) => <span>{num.format(c.getValue())} {c.row.original.unidad}</span> },
    { id: "recibido", header: "Recibido", accessorFn: (f) => f.recibido, meta: { label: "Recibido", num: true }, enableColumnFilter: false, cell: (c) => <span className="ds-strong">{num.format(c.getValue())}</span> },
    { id: "porrecibir", header: "Por recibir", accessorFn: (f) => f.pendiente, meta: { label: "Por recibir", num: true }, enableColumnFilter: false, cell: (c) => c.getValue() > 0 ? <span className="ds-pending-text">{num.format(c.getValue())}</span> : <span className="ds-muted">0</span> },
    { id: "comentario", header: "Comentario", accessorFn: (f) => f.comentario, meta: { label: "Comentario" }, cell: (c) => <span className="ds-muted ds-body-sm">{c.getValue() || "—"}</span> },
  ], []);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Seguimiento por proyecto</h1>
            <p className="ds-muted">Todas las líneas que pediste, agrupadas por proyecto: lo solicitado, lo que ya llegó y lo que falta.</p>
          </div>
        </div>
        <div className="mt-4">
          <DataTable data={filas} columns={columns} tablaKey="seguimiento" getRowId={(f) => f.key} onRowClick={(f) => router.push(`/ingenieria/${f.pedidoId}`)} vacio="No hay líneas para mostrar." />
        </div>
      </main>
    </AppShell>
  );
}
