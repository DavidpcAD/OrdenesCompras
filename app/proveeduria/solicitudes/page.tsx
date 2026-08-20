"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, QtyRing, Tile } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { VistaToggle } from "@/components/vista-toggle";
import { IconReceipt, IconList } from "@/components/icons";
import { useStore } from "@/lib/store";
import { formatDate, pedidoCompraBadge, pedidoOrdenadoPct, ordenesPorPedido, recibidoPorLineaPedido, destinoCodigo, destinoLabel, tipoSolicitudBadge } from "@/lib/helpers";
import type { Pedido } from "@/lib/types";

type Filtro = "todas" | "pendiente" | "parcial" | "ordenado";

export default function ProveeduriaSolicitudesPage() {
  const { pedidos, ordenes } = useStore();
  const router = useRouter();
  // El recuadro elegido arriba es un filtro más: se recuerda por sesión, así que
  // volver de un detalle te deja la pantalla como estaba.
  const CLAVE_FILTRO = "adelante_oc_kpi_solicitudes-prov";
  const [filtro, setFiltro] = useState<Filtro>("todas");
  useEffect(() => {
    try { const v = sessionStorage.getItem(CLAVE_FILTRO); if (v) setFiltro(v as Filtro); } catch { /* sin sessionStorage */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const elegirFiltro = (f: Filtro) => { setFiltro(f); try { sessionStorage.setItem(CLAVE_FILTRO, f); } catch { /* noop */ } };

  // Proveeduría solo ve solicitudes ENVIADAS (no borrador ni devueltas).
  const enviadas = pedidos.filter((p) => p.estado !== "borrador" && p.estado !== "devuelto");
  const bucket = (p: Pedido): Exclude<Filtro, "todas"> => {
    const pct = pedidoOrdenadoPct(p);
    return pct >= 100 ? "ordenado" : pct > 0 ? "parcial" : "pendiente";
  };
  // Índice recibido-por-línea: un pase sobre las órdenes en vez de recorrerlas
  // enteras por cada línea de cada fila (la tabla lo recalculaba en cada render).
  const recibidoPorLinea = useMemo(() => recibidoPorLineaPedido(ordenes), [ordenes]);
  // En qué orden(es) de compra entró cada solicitud, para poder mostrarla y abrirla.
  const ocsPorPedido = useMemo(() => ordenesPorPedido(pedidos, ordenes), [pedidos, ordenes]);
  const recibidoDe = (p: Pedido) => p.lineas.reduce((s, l) => s + (recibidoPorLinea.get(l.id) ?? 0), 0);
  const entregadoPct = (p: Pedido) => {
    const total = p.lineas.reduce((s, l) => s + l.cantidad, 0);
    return total > 0 ? Math.round(Math.min(100, (recibidoDe(p) / total) * 100)) : 0;
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
    {
      // Lo útil acá es la ORDEN: su número, y poder abrirla. El estado ("parcialmente
      // ordenado") queda como apoyo, y solo cuando falta algo por ordenar.
      id: "estado", header: "Orden de compra", meta: { label: "Orden de compra" },
      // El buscador de la tabla encuentra por N.º de orden además del estado.
      accessorFn: (p) => [...(ocsPorPedido.get(p.numero) ?? []).map((o) => o.numero), pedidoCompraBadge(p).label].join(" "),
      cell: (c) => {
        const p = c.row.original;
        const ocs = ocsPorPedido.get(p.numero) ?? [];
        const b = pedidoCompraBadge(p);
        return (
          <div className="col" style={{ gap: 4, alignItems: "flex-start" }}>
            {ocs.length > 0 && (
              <div className="row gap-2 wrap">
                {ocs.map((o) => (
                  <button key={o.id} type="button" className="chip-link" title={`Abrir la orden ${o.numero}`}
                    onClick={(e) => { e.stopPropagation(); router.push(`/proveeduria/ordenes/${o.id}`); }}>
                    {o.numero}<span className="chip-link__ir" aria-hidden>↗</span>
                  </button>
                ))}
              </div>
            )}
            {(ocs.length === 0 || pedidoOrdenadoPct(p) < 100) && <Badge tone={b.tone}>{b.label}</Badge>}
          </div>
        );
      },
    },
    { id: "entregado", header: "Entregado", accessorFn: (p) => entregadoPct(p), meta: { label: "Entregado" }, enableColumnFilter: false, cell: (c) => { const p = c.row.original; const total = p.lineas.reduce((s, l) => s + l.cantidad, 0); return <div className="row gap-3" style={{ alignItems: "center" }}><QtyRing recibida={recibidoDe(p)} total={total} /><span className="ds-body-sm ds-muted">{entregadoPct(p)}%</span></div>; } },
  ], [recibidoPorLinea, ocsPorPedido]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Solicitudes de Ingeniería</h1>
            <p className="ds-muted">Solicitudes enviadas por Ingeniería, con el avance de sus órdenes de compra. Entrá a una para crear la orden o devolverla.</p>
          </div>
        </div>

        <VistaToggle opciones={[
          { label: "Por solicitud", href: "/proveeduria/solicitudes", active: true, icon: <IconReceipt size={16} /> },
          { label: "Por línea", href: "/proveeduria", active: false, icon: <IconList size={16} /> },
        ]} />

        <div className="tiles mt-2">
          <Tile value={cuenta("todas")} label="Todas" onClick={() => elegirFiltro("todas")} active={filtro === "todas"} />
          <Tile value={cuenta("pendiente")} label="Sin orden de compra" accent="var(--ds-color-gray-300)" onClick={() => elegirFiltro("pendiente")} active={filtro === "pendiente"} />
          <Tile value={cuenta("parcial")} label="Parcialmente ordenadas" accent="var(--ds-color-yellow)" onClick={() => elegirFiltro("parcial")} active={filtro === "parcial"} />
          <Tile value={cuenta("ordenado")} label="100% ordenadas" accent="var(--ds-color-green-200)" onClick={() => elegirFiltro("ordenado")} active={filtro === "ordenado"} />
        </div>

        <div className="mt-6">
          <DataTable data={base} columns={columns} tablaKey="solicitudes-prov" buscarPlaceholder="Buscar por N.º, material u obra…" getRowId={(p) => p.id} onRowClick={(p) => router.push(`/proveeduria/solicitudes/${p.id}`)} vacio="No hay solicitudes que coincidan."
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
    </>
  );
}
