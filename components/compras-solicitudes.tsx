"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, FiltroChip, QtyRing } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { useFiltroPantalla } from "@/lib/use-filtro-pantalla";
import { formatDate, pedidoCompraBadge, pedidoOrdenadoPct, ordenesPorPedido, recibidoPorLineaPedido, destinoCodigo, destinoLabel, tipoSolicitudBadge, comentarioDeSolicitud, claseDestinoSolicitud, destinoSolicitudBadge, almacenesDeSolicitud } from "@/lib/helpers";
import { useVariantes } from "@/lib/use-variantes";
import type { Pedido } from "@/lib/types";

// La pestaña "Solicitudes" de Compras: lo que pidió Ingeniería, con el avance de sus
// órdenes. Era `app/proveeduria/solicitudes/page.tsx`; lo único que cambió al mudarse
// es que los recuadros grandes son ahora chips (el conteo vive en la pestaña) y que el
// "Ver por: Solicitud / Línea" lo dibuja la pantalla, en la barra de pestañas.

// "archivadas" no es un avance de compra como los otros tres: es el estado del
// documento. Por eso convive con ellos como filtro pero se resuelve aparte, antes de
// `bucket()` — meterlo adentro haría que una archivada al 60% dejara de contar en
// "Parcialmente ordenadas" y los conteos cambiarían de significado.
type Filtro = "todas" | "pendiente" | "parcial" | "ordenado" | "archivadas";
type Bucket = Exclude<Filtro, "todas" | "archivadas">;

export function ComprasSolicitudes() {
  const { pedidos, ordenes } = useStore();
  const router = useRouter();
  // El chip elegido es un filtro más: se recuerda por sesión, así que volver de un
  // detalle te deja la pantalla como estaba. Vence si la pantalla se dejó de usar (ver
  // `use-filtro-pantalla`), y se valida contra la lista: un filtro guardado que ya no
  // existe (o "archivadas" cuando ya no queda ninguna, porque su chip no se dibuja)
  // dejaba la tabla vacía sin nada en qué hacer clic para salir.
  const [filtro, elegirFiltro] = useFiltroPantalla<Filtro>(
    "adelante_oc_kpi_solicitudes-prov", "todas",
    (v) => (["todas", "pendiente", "parcial", "ordenado", "archivadas"] as string[]).includes(v),
  );

  // Proveeduría solo ve solicitudes ENVIADAS (no borrador ni devueltas). Las
  // ARCHIVADAS salen de acá: ya no se compran, así que no pueden sumar al conteo de
  // "Sin orden de compra" ni aparecer como trabajo vivo. Se consultan en su chip.
  const enviadas = pedidos.filter((p) => p.estado !== "borrador" && p.estado !== "devuelto" && p.estado !== "cerrado");
  const archivadas = pedidos.filter((p) => p.estado === "cerrado");
  const bucket = (p: Pedido): Bucket => {
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
  const cuenta = (f: Filtro) =>
    f === "todas" ? enviadas.length
      : f === "archivadas" ? archivadas.length
        : enviadas.filter((p) => bucket(p) === f).length;
  const base = useMemo(
    () => filtro === "archivadas" ? archivadas : enviadas.filter((p) => filtro === "todas" ? true : bucket(p) === filtro),
    [enviadas, archivadas, filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo<ColumnDef<Pedido, any>[]>(() => [
    { id: "num", header: "N.º", accessorFn: (p) => p.numero, meta: { label: "N.º" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "tipo", header: "Tipo", accessorFn: (p) => tipoSolicitudBadge(p.tipoSolicitud).label, meta: { label: "Tipo" }, cell: (c) => { const t = tipoSolicitudBadge(c.row.original.tipoSolicitud); return <Badge tone={t.tone}>{t.label}</Badge>; } },
    {
      // A DÓNDE ENTRA EL MATERIAL, que es otra cosa que PARA QUÉ OBRA es (la columna
      // de al lado). Ingeniería lo elige con el botón ALM/CD al armar el pedido y
      // para Proveeduría son dos flujos: lo de almacén lo recibe Bodega y sube el
      // stock; lo de consumo directo se carga contra la obra y el stock no se mueve.
      // No hay columna en la base que lo diga: se deriva de la tarea de las líneas.
      id: "entraA", header: "Entra a", meta: { label: "Entra a" },
      accessorFn: (p) => {
        const d = destinoSolicitudBadge(claseDestinoSolicitud(p));
        return [d.label, ...almacenesDeSolicitud(p)].join(" ");
      },
      cell: (c) => {
        const p = c.row.original;
        const d = destinoSolicitudBadge(claseDestinoSolicitud(p));
        const almacenes = almacenesDeSolicitud(p);
        return (
          <div title={d.ayuda}>
            <Badge tone={d.tone}>{d.label}</Badge>
            {!!almacenes.length && (
              <div className="ds-muted ds-body-sm ds-truncate" style={{ maxWidth: 140, marginTop: 2 }}>
                {almacenes.join(" · ")}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "obra", header: "Destino", accessorFn: (p) => `${destinoCodigo(p)} ${destinoLabel(p)}`.trim(), meta: { label: "Destino" },
      cell: (c) => { const p = c.row.original; return <div><div className="ds-strong ds-body-sm">{destinoCodigo(p)}</div><div className="ds-muted ds-body-sm ds-truncate" style={{ maxWidth: 160 }} title={destinoLabel(p)}>{destinoLabel(p)}</div></div>; },
    },
    // El comentario del ingeniero, sin los encabezados internos que le apila encima
    // el cierre o la devolución (esos se leen en el detalle, con su tarjeta).
    { id: "comentario", header: "Comentario", accessorFn: (p) => comentarioDeSolicitud(p), meta: { label: "Comentario" }, cell: (c) => <div className="ds-body-sm ds-muted ds-truncate" style={{ maxWidth: 220 }} title={c.getValue()}>{c.getValue() || "—"}</div> },
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
            {/* En la archivada el badge va SIEMPRE: es su estado, no un avance, y sin
                él una solicitud cerrada al 100% no se distinguía de una normal. */}
            {(p.estado === "cerrado" || ocs.length === 0 || pedidoOrdenadoPct(p) < 100) && <Badge tone={b.tone}>{b.label}</Badge>}
          </div>
        );
      },
    },
    { id: "entregado", header: "Entregado", accessorFn: (p) => entregadoPct(p), meta: { label: "Entregado" }, enableColumnFilter: false, cell: (c) => { const p = c.row.original; const total = p.lineas.reduce((s, l) => s + l.cantidad, 0); return <div className="row gap-3" style={{ alignItems: "center" }}><QtyRing recibida={recibidoDe(p)} total={total} /><span className="ds-body-sm ds-muted">{entregadoPct(p)}%</span></div>; } },
  ], [recibidoPorLinea, ocsPorPedido]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="filtros">
        <FiltroChip value={cuenta("todas")} label="Todas" onClick={() => elegirFiltro("todas")} active={filtro === "todas"} />
        <FiltroChip value={cuenta("pendiente")} label="Sin orden de compra" accent="var(--ds-color-gray-300)" onClick={() => elegirFiltro("pendiente")} active={filtro === "pendiente"} />
        <FiltroChip value={cuenta("parcial")} label="Parcialmente ordenadas" accent="var(--ds-color-yellow)" onClick={() => elegirFiltro("parcial")} active={filtro === "parcial"} />
        <FiltroChip value={cuenta("ordenado")} label="100% ordenadas" accent="var(--ds-color-green-200)" onClick={() => elegirFiltro("ordenado")} active={filtro === "ordenado"} />
        {/* Solo si hay: un chip en 0 permanente es ruido (mismo criterio que
            "Esperando corrección" en Órdenes). Si el filtro guardado es este y ya no
            queda ninguna, `useFiltroPantalla` no lo recupera y arranca en "todas". */}
        {archivadas.length > 0 && (
          <FiltroChip value={cuenta("archivadas")} label="Archivadas" accent="var(--ds-color-gray-400)" onClick={() => elegirFiltro("archivadas")} active={filtro === "archivadas"} />
        )}
      </div>

      <div className="mt-4">
        <DataTable data={base} columns={columns} tablaKey="solicitudes-prov" buscarPlaceholder="Buscar por N.º, material u obra…" getRowId={(p) => p.id} onRowClick={(p) => router.push(`/proveeduria/solicitudes/${p.id}`)}
          vacio={filtro === "archivadas" ? "Todavía no hay solicitudes archivadas." : "No hay solicitudes que coincidan."}
          rowClassName={(p) => (p.estado === "cerrado" ? "dt-row-archivada" : "")}
          renderExpanded={(p) => <LineasDeSolicitud pedido={p} />} />
      </div>
    </>
  );
}

// Las líneas de la solicitud desplegada. Es su propio componente para que las
// variantes se pidan a BC SOLO de la solicitud que se abrió, y no de todas las de
// la lista (son cientos de materiales).
function LineasDeSolicitud({ pedido }: { pedido: Pedido }) {
  const variantes = useVariantes(pedido.lineas.map((l) => l.articuloId));
  return (
    <table className="ds-table" style={{ boxShadow: "none", background: "transparent" }}>
      <thead>
        <tr><th>Artículo</th><th>Variante</th><th className="ds-num">Cantidad</th><th>Unidad</th></tr>
      </thead>
      <tbody>
        {pedido.lineas.map((l) => (
          <tr key={l.id}>
            <td>{l.descripcion}</td>
            {/* El CÓDIGO de la variante no dice nada ("0042"): al lado va el nombre
                que tiene en BC, que es lo que distingue el material. */}
            <td className="ds-body-sm">
              {l.variantCode
                ? <span className="ds-muted" title={variantes.etiqueta(l.articuloId, l.variantCode)}>{variantes.etiqueta(l.articuloId, l.variantCode)}</span>
                : variantes.falta(l.articuloId, l.variantCode)
                  ? <span className="ds-pending-text" title="El material tiene varias variantes en Business Central y la solicitud no dice cuál.">Sin variante</span>
                  : <span className="ds-muted">—</span>}
            </td>
            <td className="ds-num">{l.cantidad}</td>
            <td className="ds-muted">{l.unidad}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
