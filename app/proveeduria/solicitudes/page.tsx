"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AppShell } from "@/components/shell";
import { Badge, QtyRing, Tile } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { VistaToggle } from "@/components/vista-toggle";
import { IconReceipt, IconList } from "@/components/icons";
import { useStore } from "@/lib/store";
import { formatDate, pedidoCompraBadge, pedidoOrdenadoPct, recibidoDeLineaPedido, destinoCodigo, destinoLabel, tipoSolicitudBadge } from "@/lib/helpers";
import type { Pedido } from "@/lib/types";

type Filtro = "todas" | "pendiente" | "parcial" | "comprado";

export default function ProveeduriaSolicitudesPage() {
  const { pedidos, ordenes } = useStore();
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("todas");

  // Proveeduría solo ve solicitudes ENVIADAS (no borrador ni devueltas).
  const enviadas = pedidos.filter((p) => p.estado !== "borrador" && p.estado !== "devuelto");
  const bucket = (p: Pedido): Exclude<Filtro, "todas"> => {
    const pct = pedidoOrdenadoPct(p);
    return pct >= 100 ? "comprado" : pct > 0 ? "parcial" : "pendiente";
  };
  const entregadoPct = (p: Pedido) => {
    const total = p.lineas.reduce((s, l) => s + l.cantidad, 0);
    const rec = p.lineas.reduce((s, l) => s + recibidoDeLineaPedido(ordenes, l.id), 0);
    return total > 0 ? Math.round(Math.min(100, (rec / total) * 100)) : 0;
  };
  const cuenta = (f: Filtro) => f === "todas" ? enviadas.length : enviadas.filter((p) => bucket(p) === f).length;
  const base = useMemo(() => enviadas.filter((p) => filtro === "todas" ? true : bucket(p) === filtro), [enviadas, filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo<ColumnDef<Pedido, any>[]>(() => [
    { id: "num", header: "N.º", accessorFn: (p) => p.numero, meta: { label: "N.º" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "tipo", header: "Tipo", accessorFn: (p) => tipoSolicitudBadge(p.tipoSolicitud).label, meta: { label: "Tipo" }, cell: (c) => { const t = tipoSolicitudBadge(c.row.original.tipoSolicitud); return <Badge tone={t.tone}>{t.label}</Badge>; } },
    {
      id: "obra", header: "Destino", accessorFn: (p) => `${destinoCodigo(p)} ${destinoLabel(p)}`.trim(), meta: { label: "Destino" },
      cell: (c) => { const p = c.row.original; return <div><div className="ds-strong ds-body-sm">{destinoCodigo(p)}</div><div className="ds-muted ds-body-sm ds-truncate" style={{ maxWidth: 160 }} title={destinoLabel(p)}>{destinoLabel(p)}</div></div>; },
    },
    { id: "comentario", header: "Comentario", accessorFn: (p) => p.notas ?? "", meta: { label: "Comentario" }, cell: (c) => <div className="ds-body-sm ds-muted ds-truncate" style={{ maxWidth: 220 }} title={c.getValue()}>{c.getValue() || "—"}</div> },
    { id: "solicitante", header: "Solicitante", accessorFn: (p) => p.solicitante, meta: { label: "Solicitante" }, cell: (c) => c.getValue() },
    { id: "fecha", header: "Fecha", accessorFn: (p) => p.fecha, meta: { label: "Fecha", date: true }, cell: (c) => formatDate(c.getValue()) },
    { id: "lineas", header: "Líneas", accessorFn: (p) => p.lineas.length, meta: { label: "Líneas", num: true }, enableColumnFilter: false, cell: (c) => c.getValue() },
    { id: "prioridad", header: "Prioridad", accessorFn: (p) => p.prioridad, meta: { label: "Prioridad" }, cell: (c) => { const p = c.row.original; return p.prioridad === "urgente" ? <Badge tone="red">Urgente</Badge> : p.prioridad === "alta" ? <Badge tone="yellow">Alta</Badge> : <Badge tone="gray">Normal</Badge>; } },
    { id: "estado", header: "Compra", accessorFn: (p) => pedidoCompraBadge(p).label, meta: { label: "Compra" }, cell: (c) => { const b = pedidoCompraBadge(c.row.original); return <Badge tone={b.tone}>{b.label}</Badge>; } },
    { id: "entregado", header: "Entregado", accessorFn: (p) => entregadoPct(p), meta: { label: "Entregado" }, enableColumnFilter: false, cell: (c) => { const p = c.row.original; const total = p.lineas.reduce((s, l) => s + l.cantidad, 0); const rec = p.lineas.reduce((s, l) => s + recibidoDeLineaPedido(ordenes, l.id), 0); return <div className="row gap-3" style={{ alignItems: "center" }}><QtyRing recibida={rec} total={total} /><span className="ds-body-sm ds-muted">{entregadoPct(p)}%</span></div>; } },
  ], [ordenes]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppShell role="proveeduria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Solicitudes de Ingeniería</h1>
            <p className="ds-muted">Solicitudes enviadas por Ingeniería, con su avance de compra. Entrá a una para crear la orden de compra o devolverla.</p>
          </div>
        </div>

        <VistaToggle opciones={[
          { label: "Por solicitud", href: "/proveeduria/solicitudes", active: true, icon: <IconReceipt size={16} /> },
          { label: "Por línea", href: "/proveeduria", active: false, icon: <IconList size={16} /> },
        ]} />

        <div className="tiles mt-2">
          <Tile value={cuenta("todas")} label="Todas" onClick={() => setFiltro("todas")} active={filtro === "todas"} />
          <Tile value={cuenta("pendiente")} label="Pendientes de comprar" accent="var(--ds-color-gray-300)" onClick={() => setFiltro("pendiente")} active={filtro === "pendiente"} />
          <Tile value={cuenta("parcial")} label="Parcialmente compradas" accent="var(--ds-color-yellow)" onClick={() => setFiltro("parcial")} active={filtro === "parcial"} />
          <Tile value={cuenta("comprado")} label="100% compradas" accent="var(--ds-color-green-200)" onClick={() => setFiltro("comprado")} active={filtro === "comprado"} />
        </div>

        <div className="mt-6">
          <DataTable data={base} columns={columns} tablaKey="solicitudes-prov" getRowId={(p) => p.id} onRowClick={(p) => router.push(`/proveeduria/solicitudes/${p.id}`)} vacio="No hay solicitudes que coincidan."
            renderExpanded={(p) => (
              <table className="ds-table" style={{ boxShadow: "none", background: "transparent" }}>
                <thead>
                  <tr><th>Artículo</th><th>Variante</th><th className="ds-num">Cantidad</th><th>Unidad</th></tr>
                </thead>
                <tbody>
                  {p.lineas.map((l) => (
                    <tr key={l.id}>
                      <td>{l.descripcion}</td>
                      <td className="ds-muted ds-body-sm">{l.variantCode || "—"}</td>
                      <td className="ds-num">{l.cantidad}</td>
                      <td className="ds-muted">{l.unidad}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )} />
        </div>
      </main>
    </AppShell>
  );
}
