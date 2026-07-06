"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AppShell } from "@/components/shell";
import { Badge, Button, QtyRing, Tile } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { formatDate, pedidoBadge, pedidoCompraBadge, pedidoOrdenadoPct, recibidoDeLineaPedido, tipoSolicitudBadge } from "@/lib/helpers";
import type { Pedido } from "@/lib/types";

type Filtro = "todas" | "material" | "repuesto" | "aprobado";

export default function IngenieriaPage() {
  const { pedidos, ordenes } = useStore();
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const listaRef = useRef<HTMLDivElement>(null);

  const entregadoPct = (p: Pedido) => {
    const total = p.lineas.reduce((s, l) => s + l.cantidad, 0);
    if (total <= 0) return 0;
    const rec = p.lineas.reduce((s, l) => s + recibidoDeLineaPedido(ordenes, l.id), 0);
    return Math.round(Math.min(100, (rec / total) * 100));
  };
  function seleccionar(f: Filtro) { setFiltro(f); setTimeout(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }

  const material = pedidos.filter((p) => p.tipoSolicitud === "material").length;
  const repuesto = pedidos.filter((p) => p.tipoSolicitud === "repuesto").length;
  const aprobados = pedidos.filter((p) => p.estado === "aprobado").length;
  const destCodigo = (p: Pedido) => (p.tipoSolicitud === "repuesto" ? p.maquinaNo : p.obraCodigo) ?? "—";
  const destNombre = (p: Pedido) => (p.tipoSolicitud === "repuesto" ? p.maquinaNombre : p.obraNombre) ?? "";

  const base = useMemo(() => pedidos.filter((p) =>
    filtro === "material" ? p.tipoSolicitud === "material"
      : filtro === "repuesto" ? p.tipoSolicitud === "repuesto"
      : filtro === "aprobado" ? p.estado === "aprobado" : true
  ), [pedidos, filtro]);

  const columns = useMemo<ColumnDef<Pedido, any>[]>(() => [
    { id: "num", header: "N.º", accessorFn: (p) => p.numero, meta: { label: "N.º" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "tipo", header: "Tipo", accessorFn: (p) => tipoSolicitudBadge(p.tipoSolicitud).label, meta: { label: "Tipo" }, cell: (c) => { const t = tipoSolicitudBadge(c.row.original.tipoSolicitud); return <Badge tone={t.tone}>{t.label}</Badge>; } },
    { id: "destino", header: "Destino", accessorFn: (p) => `${destCodigo(p)} ${destNombre(p)}`.trim(), meta: { label: "Destino" }, cell: (c) => { const p = c.row.original; return <div><div className="ds-strong ds-body-sm">{destCodigo(p)}</div>{destNombre(p) && <div className="ds-muted ds-body-sm ds-truncate" style={{ maxWidth: 160 }} title={destNombre(p)}>{destNombre(p)}</div>}</div>; } },
    { id: "comentario", header: "Comentario", accessorFn: (p) => p.notas ?? "", meta: { label: "Comentario" }, cell: (c) => <div className="ds-body-sm ds-muted ds-truncate" style={{ maxWidth: 220 }} title={c.getValue()}>{c.getValue() || "—"}</div> },
    { id: "solicitante", header: "Solicitante", accessorFn: (p) => p.solicitante, meta: { label: "Solicitante" }, cell: (c) => c.getValue() },
    { id: "fecha", header: "Fecha", accessorFn: (p) => p.fecha, meta: { label: "Fecha" }, cell: (c) => formatDate(c.getValue()) },
    { id: "lineas", header: "Líneas", accessorFn: (p) => p.lineas.length, meta: { label: "Líneas", num: true }, enableColumnFilter: false, cell: (c) => c.getValue() },
    { id: "prioridad", header: "Prioridad", accessorFn: (p) => p.prioridad, meta: { label: "Prioridad" }, cell: (c) => { const p = c.row.original; return p.prioridad === "urgente" ? <Badge tone="red">Urgente</Badge> : p.prioridad === "alta" ? <Badge tone="yellow">Alta</Badge> : <Badge tone="gray">Normal</Badge>; } },
    { id: "estado", header: "Estado", accessorFn: (p) => pedidoBadge(p.estado).label, meta: { label: "Estado" }, cell: (c) => { const b = pedidoBadge(c.row.original.estado); return <Badge tone={b.tone}>{b.label}</Badge>; } },
    { id: "compra", header: "Compra", accessorFn: (p) => pedidoCompraBadge(p).label, meta: { label: "Compra" }, cell: (c) => { const p = c.row.original; const b = pedidoCompraBadge(p); const pct = pedidoOrdenadoPct(p); return <div className="row gap-2" style={{ alignItems: "center" }}><Badge tone={b.tone}>{b.label}</Badge>{pct > 0 && pct < 100 && <span className="ds-body-sm ds-muted">{pct}%</span>}</div>; } },
    { id: "entregado", header: "Entregado", accessorFn: (p) => entregadoPct(p), meta: { label: "Entregado" }, enableColumnFilter: false, cell: (c) => { const p = c.row.original; const total = p.lineas.reduce((s, l) => s + l.cantidad, 0); const rec = p.lineas.reduce((s, l) => s + recibidoDeLineaPedido(ordenes, l.id), 0); return <div className="row gap-3" style={{ alignItems: "center" }}><QtyRing recibida={rec} total={total} /><span className="ds-body-sm ds-muted">{entregadoPct(p)}%</span></div>; } },
  ], [ordenes]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Mis solicitudes de material</h1>
            <p className="ds-muted">Pedí material para una obra o repuestos para una máquina. Proveeduría se encarga del proveedor.</p>
          </div>
          <Link href="/ingenieria/nuevo"><Button>+ Nueva solicitud</Button></Link>
        </div>

        <div className="tiles mt-2">
          <Tile value={pedidos.length} label="Solicitudes totales" onClick={() => seleccionar("todas")} active={filtro === "todas"} />
          <Tile value={material} label="De material (obra)" accent="var(--ds-color-green-100)" onClick={() => seleccionar("material")} active={filtro === "material"} />
          <Tile value={repuesto} label="De repuesto (máquina)" accent="var(--ds-color-yellow)" onClick={() => seleccionar("repuesto")} active={filtro === "repuesto"} />
          <Tile value={aprobados} label="Aprobadas" accent="var(--ds-color-green-200)" onClick={() => seleccionar("aprobado")} active={filtro === "aprobado"} />
        </div>

        <div ref={listaRef} className="mt-6" style={{ scrollMarginTop: 80 }}>
          <DataTable data={base} columns={columns} tablaKey="solicitudes-ing" getRowId={(p) => p.id} onRowClick={(p) => router.push(`/ingenieria/${p.id}`)} vacio={pedidos.length === 0 ? "Aún no hay solicitudes. Creá la primera." : "Ninguna solicitud coincide."} />
        </div>
      </main>
    </AppShell>
  );
}
