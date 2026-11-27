"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Button, EmptyState, FiltroChip, Modal, QtyRing, Tile, useToast } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { IconReceipt, IconWarning } from "@/components/icons";
import { Icon } from "@/components/ds-icon";
import { useStore } from "@/lib/store";
import { useFiltroPantalla } from "@/lib/use-filtro-pantalla";
import { cuenta, formatDate, num, pedidoCompraBadge, pedidoOrdenadoPct, pedidoLineaPendiente, ordenesPorPedido, recibidoPorLineaPedido, destinoCodigo, destinoLabel, tipoSolicitudBadge, comentarioDeSolicitud, claseDestinoSolicitud, destinoSolicitudBadge, almacenesDeSolicitud, todayISO } from "@/lib/helpers";
import { FILTROS_SOLICITUDES, conteoSolicitudes, diasDesde, esperaTexto, filtrarSolicitudes, type FiltroSolicitudes } from "@/lib/compras-solicitudes";
import { useVariantes } from "@/lib/use-variantes";
import type { Pedido } from "@/lib/types";

// La pestaña "Solicitudes" de Compras: lo que pidió Ingeniería, con el avance de sus
// órdenes. Es una LISTA CON DETALLE AL LADO: tocar una fila no saca de la pantalla,
// abre la solicitud en el panel de la derecha (artículos, a dónde entra, en qué
// órdenes va) y desde ahí se arma la orden o se abre la solicitud completa. Así se
// recorre la cola de a una sin ir y volver del detalle por cada solicitud.
//
// Arriba van cuatro tarjetas con la cola de trabajo (Por gestionar, Sin orden,
// Parcialmente ordenadas, Urgentes) y debajo tres pastillas para consultar el resto
// (Todas, 100 % ordenadas, Archivadas). Las siete son UN solo filtro: ver
// lib/compras-solicitudes.ts.
//
// Sin ancho para el panel (pantalla angosta o el riel fijado), el detalle sale como
// panel lateral encima de la lista (`Modal lado`, el mismo de Facturas en revisión).

// Desde cuánto ancho de la zona de la tabla el panel va AL LADO en vez de encima. Con
// menos, la tabla quedaba en ~600 px y las cinco columnas no caben sin cortarse.
const ANCHO_PANEL_AL_LADO = 1080;

export function ComprasSolicitudes() {
  const { pedidos, ordenes, setBorrador } = useStore();
  const router = useRouter();
  const toast = useToast();
  // El filtro elegido se recuerda por sesión, así que volver de un detalle te deja la
  // pantalla como estaba. Vence si la pantalla se dejó de usar (ver
  // `use-filtro-pantalla`) y se valida contra la lista: un valor guardado que ya no
  // existe dejaba la tabla vacía sin nada en qué tocar para salir.
  //
  // Arranca en "Por gestionar" y no en "Todas": esta pestaña es la cola de trabajo, y
  // lo que ya se ordenó completo es consulta. "Todas" está a un toque, abajo.
  const [filtro, elegirFiltro] = useFiltroPantalla<FiltroSolicitudes>(
    "adelante_oc_kpi_solicitudes-prov", "gestionar",
    (v) => (FILTROS_SOLICITUDES as string[]).includes(v),
  );
  const n = useMemo(() => conteoSolicitudes(pedidos), [pedidos]);
  // Un filtro guardado de "archivadas" cuando ya no queda ninguna: su pastilla no se
  // dibuja, así que se cae a la cola de trabajo para no dejar una tabla vacía sin salida.
  const filtroVivo: FiltroSolicitudes = filtro === "archivadas" && n.archivadas === 0 ? "gestionar" : filtro;
  const base = useMemo(() => filtrarSolicitudes(pedidos, filtroVivo), [pedidos, filtroVivo]);
  // Tocar la tarjeta que ya está elegida la suelta y vuelve a la cola completa: sin
  // esto, la única salida de "Urgentes" era adivinar que "Por gestionar" la quita.
  const tocar = (f: FiltroSolicitudes) => elegirFiltro(filtroVivo === f && f !== "gestionar" ? "gestionar" : f);

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

  // ¿Cabe el panel al lado? Se mide la zona de la lista y no la ventana: con el riel
  // fijado abierto la misma ventana deja 200 px menos.
  const zonaRef = useRef<HTMLDivElement>(null);
  const [alLado, setAlLado] = useState(true);
  useEffect(() => {
    const el = zonaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setAlLado(e.contentRect.width >= ANCHO_PANEL_AL_LADO));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [selId, setSelId] = useState<string | null>(null);
  // Se busca en TODAS y no en las filtradas: si el auto-refresh cambia de cubeta a la
  // que se está mirando (alguien la ordenó), el panel no se cierra solo en la cara.
  const sel = selId ? pedidos.find((p) => p.id === selId) ?? null : null;

  // EL PIE DEL PANEL SIEMPRE A LA VISTA. El panel arranca debajo de las tarjetas y
  // solo se pega arriba al bajar; con un tope fijo en CSS (alto de la ventana) su pie
  // —"Crear orden"— quedaba debajo del borde hasta hacer scroll. Se mide el espacio
  // que queda de verdad desde donde está el panel, y se recalcula al bajar. Va directo
  // al estilo del elemento y no a un estado: así el scroll no repinta la tabla.
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    let raf = 0;
    // Abajo a la derecha flota "Compra directa" (components/shell.tsx): el pie del
    // panel termina arriba de él, con el mismo margen que `.app-content.has-fab`.
    const abajo = el.closest(".has-fab") ? 92 : 24;
    const medir = () => {
      raf = 0;
      const arriba = Math.max(el.getBoundingClientRect().top, 0);
      el.style.maxHeight = `${Math.max(320, window.innerHeight - arriba - abajo)}px`;
    };
    const pedir = () => { if (!raf) raf = requestAnimationFrame(medir); };
    medir();
    // En captura: el que scrollea puede ser la ventana o un contenedor del shell.
    document.addEventListener("scroll", pedir, { passive: true, capture: true });
    window.addEventListener("resize", pedir);
    return () => {
      document.removeEventListener("scroll", pedir, { capture: true });
      window.removeEventListener("resize", pedir);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [alLado, selId]);
  const verSolicitud = (p: Pedido) => router.push(`/proveeduria/solicitudes/${p.id}`);
  // Lo mismo que "Crear orden de compra →" del detalle sin nada marcado: todo lo que
  // le queda por ordenar. Para repartir entre proveedores está el detalle completo.
  const crearOrden = (p: Pedido) => {
    if (p.estado === "cerrado") return;
    const lineas = p.lineas
      .filter((l) => pedidoLineaPendiente(l) > 0)
      .map((l) => ({ pedidoLineaId: l.id, cantidad: pedidoLineaPendiente(l), precio: 0, iva: 13 }));
    if (!lineas.length) { toast(`${p.numero} no tiene líneas pendientes por ordenar.`, "error"); return; }
    setBorrador(lineas);
    router.push("/proveeduria/nueva");
  };

  const columns = useMemo<ColumnDef<Pedido, any>[]>(() => [
    {
      // El N.º con lo que más se pregunta de un vistazo debajo: cuántos artículos y de
      // qué tipo. La columna "Tipo" sigue existiendo (oculta) para filtrar por ella.
      id: "num", header: "Solicitud", accessorFn: (p) => p.numero, meta: { label: "Solicitud" },
      cell: (c) => {
        const p = c.row.original;
        return (
          <div>
            <div className="ds-strong ds-nowrap">{p.numero}</div>
            <div className="ds-muted ds-body-sm ds-nowrap">{cuenta(p.lineas.length, "artículo", "artículos")} · {tipoSolicitudBadge(p.tipoSolicitud).label}</div>
          </div>
        );
      },
    },
    {
      id: "obra", header: "Destino", accessorFn: (p) => `${destinoCodigo(p)} ${destinoLabel(p)}`.trim(), meta: { label: "Destino" },
      cell: (c) => { const p = c.row.original; return <div><div className="ds-strong ds-body-sm">{destinoCodigo(p)}</div><div className="ds-muted ds-body-sm ds-truncate" style={{ maxWidth: 200 }} title={destinoLabel(p)}>{destinoLabel(p)}</div></div>; },
    },
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
    {
      // "Normal" va en texto y no en pastilla: con una pastilla gris en cada fila, las
      // dos que importan (Alta, Urgente) se perdían entre cuarenta iguales.
      id: "prioridad", header: "Prioridad", accessorFn: (p) => p.prioridad, meta: { label: "Prioridad" },
      cell: (c) => { const p = c.row.original; return p.prioridad === "urgente" ? <Badge tone="red">Urgente</Badge> : p.prioridad === "alta" ? <Badge tone="yellow">Alta</Badge> : <span className="ds-muted ds-body-sm">Normal</span>; },
    },
    { id: "fecha", header: "Fecha", accessorFn: (p) => p.fecha, meta: { label: "Fecha", date: true }, cell: (c) => <span className="ds-nowrap">{formatDate(c.getValue())}</span> },
    // De acá para abajo, columnas que arrancan OCULTAS (ver `columnVisibilityInicial`):
    // lo dicen el panel o la segunda línea de "Solicitud", pero se pueden prender en
    // "Columnas", filtrar por ellas y el buscador las sigue mirando.
    { id: "tipo", header: "Tipo", accessorFn: (p) => tipoSolicitudBadge(p.tipoSolicitud).label, meta: { label: "Tipo" }, cell: (c) => { const t = tipoSolicitudBadge(c.row.original.tipoSolicitud); return <Badge tone={t.tone}>{t.label}</Badge>; } },
    {
      // A DÓNDE ENTRA EL MATERIAL, que es otra cosa que PARA QUÉ OBRA es. Lo de almacén
      // lo recibe Bodega y sube el stock; lo de consumo directo se carga contra la
      // obra y el stock no se mueve. Se deriva de la tarea de las líneas.
      id: "entraA", header: "Entra a", meta: { label: "Entra a" },
      accessorFn: (p) => [destinoSolicitudBadge(claseDestinoSolicitud(p)).label, ...almacenesDeSolicitud(p)].join(" "),
      cell: (c) => {
        const p = c.row.original;
        const d = destinoSolicitudBadge(claseDestinoSolicitud(p));
        const almacenes = almacenesDeSolicitud(p);
        return (
          <div title={d.ayuda}>
            <Badge tone={d.tone}>{d.label}</Badge>
            {!!almacenes.length && <div className="ds-muted ds-body-sm ds-truncate" style={{ maxWidth: 140, marginTop: 2 }}>{almacenes.join(" · ")}</div>}
          </div>
        );
      },
    },
    // El comentario del ingeniero, sin los encabezados internos que le apila encima
    // el cierre o la devolución (esos se leen en el detalle, con su tarjeta).
    { id: "comentario", header: "Comentario", accessorFn: (p) => comentarioDeSolicitud(p), meta: { label: "Comentario" }, cell: (c) => <div className="ds-body-sm ds-muted ds-truncate" style={{ maxWidth: 220 }} title={c.getValue()}>{c.getValue() || "—"}</div> },
    { id: "solicitante", header: "Solicitante", accessorFn: (p) => p.solicitante, meta: { label: "Solicitante" }, cell: (c) => c.getValue() },
    { id: "lineas", header: "Líneas", accessorFn: (p) => p.lineas.length, meta: { label: "Líneas", num: true }, enableColumnFilter: false, cell: (c) => c.getValue() },
    { id: "entregado", header: "Entregado", accessorFn: (p) => entregadoPct(p), meta: { label: "Entregado" }, enableColumnFilter: false, cell: (c) => { const p = c.row.original; const total = p.lineas.reduce((s, l) => s + l.cantidad, 0); return <div className="row gap-3" style={{ alignItems: "center" }}><QtyRing recibida={recibidoDe(p)} total={total} /><span className="ds-body-sm ds-muted">{entregadoPct(p)}%</span></div>; } },
  ], [recibidoPorLinea, ocsPorPedido]); // eslint-disable-line react-hooks/exhaustive-deps

  // `conNumero`: al lado, el N.º va en el cuerpo; encima, ya es el título del Modal.
  const panel = sel ? (
    <DetalleSolicitud pedido={sel} ocs={ocsPorPedido.get(sel.numero) ?? []} recibidoPorLinea={recibidoPorLinea}
      conNumero={alLado} onAbrirOrden={(id) => router.push(`/proveeduria/ordenes/${id}`)} />
  ) : null;
  const acciones = sel ? <AccionesSolicitud pedido={sel} onVer={() => verSolicitud(sel)} onCrear={() => crearOrden(sel)} /> : null;

  return (
    <>
      {/* El panel va al lado de TODO —tarjetas, pastillas y tabla— y no solo de la
          tabla: así arranca arriba, a la altura de las tarjetas, y le queda alto para
          los artículos sin tener que bajar primero. */}
      <div ref={zonaRef} className={`sol-md ${alLado ? "sol-md--al-lado" : ""}`}>
        <div className="sol-md__lista">
          {/* LA COLA DE TRABAJO. "Por gestionar" es la suma de las dos de al lado, y
              "Urgentes" sale de esa misma cola (una urgente ya ordenada no le toca a nadie). */}
          <div className="tiles" role="group" aria-label="Filtrar solicitudes">
            <Tile value={num.format(n.gestionar)} label="Por gestionar" accent="var(--ds-text)" onClick={() => tocar("gestionar")} active={filtroVivo === "gestionar"} />
            <Tile value={num.format(n.pendiente)} label="Sin orden de compra" accent="var(--ds-color-gray-300)" onClick={() => tocar("pendiente")} active={filtroVivo === "pendiente"} />
            <Tile value={num.format(n.parcial)} label="Parcialmente ordenadas" accent="var(--ds-color-yellow)" onClick={() => tocar("parcial")} active={filtroVivo === "parcial"} />
            <Tile value={num.format(n.urgentes)} label="Urgentes" accent="var(--ds-color-red-100)" onClick={() => tocar("urgentes")} active={filtroVivo === "urgentes"} />
          </div>

          <div className="filtros" role="group" aria-label="Consultar">
            <FiltroChip value={num.format(n.todas)} label="Todas" accent="var(--ds-color-green-100)" onClick={() => elegirFiltro("todas")} active={filtroVivo === "todas"} />
            <FiltroChip value={num.format(n.ordenado)} label="100% ordenadas" accent="var(--ds-color-green-200)" onClick={() => elegirFiltro("ordenado")} active={filtroVivo === "ordenado"} />
            {/* Solo si hay: una pastilla en 0 permanente es ruido. */}
            {n.archivadas > 0 && (
              <FiltroChip value={num.format(n.archivadas)} label="Archivadas" accent="var(--ds-color-gray-400)" onClick={() => elegirFiltro("archivadas")} active={filtroVivo === "archivadas"} />
            )}
          </div>

          <div className="mt-4">
            <DataTable data={base} columns={columns} tablaKey="solicitudes-prov" buscarPlaceholder="Buscar por N.º, material u obra…" getRowId={(p) => p.id}
              onRowClick={(p) => setSelId(p.id)}
              columnVisibilityInicial={{ tipo: false, entraA: false, comentario: false, solicitante: false, lineas: false, entregado: false }}
              vacio={filtroVivo === "archivadas" ? "Todavía no hay solicitudes archivadas." : filtroVivo === "urgentes" ? "No hay urgentes por gestionar." : "No hay solicitudes que coincidan."}
              rowClassName={(p) => [p.estado === "cerrado" ? "dt-row-archivada" : "", p.id === selId ? "is-panel" : ""].filter(Boolean).join(" ")} />
          </div>
        </div>

        {alLado && (
          sel ? (
            <aside ref={panelRef} className="sol-panel" aria-label={`Detalle de la solicitud ${sel.numero}`}>
              <div className="sol-panel__top">
                <span className="ds-label ds-muted">Detalle de solicitud</span>
                {/* La X del DS es "delete"; su "close" es un chevron hacia abajo. */}
                <button type="button" className="icon-btn" aria-label="Cerrar el detalle" title="Cerrar" onClick={() => setSelId(null)}><Icon name="delete" /></button>
              </div>
              <div className="sol-panel__cuerpo">{panel}</div>
              <div className="sol-panel__pie">{acciones}</div>
            </aside>
          ) : (
            <aside className="sol-panel sol-panel--vacio" aria-label="Detalle de solicitud">
              <EmptyState icon={<IconReceipt />} title="Elegí una solicitud"
                hint="Tocá una fila para ver sus artículos y armar la orden sin salir de la lista." />
            </aside>
          )
        )}
      </div>

      {!alLado && sel && (
        <Modal lado title={sel.numero} onClose={() => setSelId(null)} footer={acciones}>
          <div className="modal__cuerpo">{panel}</div>
        </Modal>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// El contenido del panel: lo mismo al lado o encima de la lista.

function DetalleSolicitud({ pedido: p, ocs, recibidoPorLinea, conNumero, onAbrirOrden }: {
  pedido: Pedido;
  ocs: { id: string; numero: string }[];
  recibidoPorLinea: Map<string, number>;
  conNumero: boolean;
  onAbrirOrden: (id: string) => void;
}) {
  // Las variantes se piden a BC SOLO de la solicitud abierta, no de toda la lista
  // (son cientos de materiales).
  const variantes = useVariantes(p.lineas.map((l) => l.articuloId));
  const b = pedidoCompraBadge(p);
  const tipo = tipoSolicitudBadge(p.tipoSolicitud);
  const entra = destinoSolicitudBadge(claseDestinoSolicitud(p));
  const almacenes = almacenesDeSolicitud(p);
  const espera = esperaTexto(diasDesde(p.fecha, todayISO()));
  const comentario = comentarioDeSolicitud(p);
  const cerrada = p.estado === "cerrado";
  const devueltas = p.lineas.filter((l) => l.devuelta).length;
  const sinVariante = cerrada ? 0 : p.lineas.filter((l) => pedidoLineaPendiente(l) > 0 && variantes.falta(l.articuloId, l.variantCode)).length;

  return (
    <>
      <div className="row gap-3 wrap" style={{ alignItems: "center" }}>
        {conNumero && <h2 className="ds-subtitle-lg">{p.numero}</h2>}
        <Badge tone={b.tone}>{b.label}</Badge>
        {p.prioridad === "urgente" && <Badge tone="red">Urgente</Badge>}
        {p.prioridad === "alta" && <Badge tone="yellow">Alta</Badge>}
      </div>
      <p className="ds-muted sol-panel__sub">{tipo.label} · {cuenta(p.lineas.length, "artículo", "artículos")}</p>

      <dl className="rev-datos sol-panel__datos">
        <dt>Solicitado por</dt><dd>{p.solicitante || "—"}</dd>
        <dt>Fecha</dt><dd>{formatDate(p.fecha)}{espera && <span className="rev-datos__nota ds-muted"> · {espera}</span>}</dd>
        <dt>Destino</dt><dd>{destinoCodigo(p)}{destinoLabel(p) && <span className="rev-datos__nota ds-muted"> · {destinoLabel(p)}</span>}</dd>
        <dt>Entra a</dt><dd title={entra.ayuda}>{entra.label}{!!almacenes.length && <span className="rev-datos__nota ds-muted"> · {almacenes.join(" · ")}</span>}</dd>
      </dl>

      {/* Avisos solo cuando cambian lo que se puede hacer con la solicitud. */}
      {cerrada && (
        <div className="ds-callout mt-4">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div><div className="ds-callout__title">Archivada</div><div className="ds-callout__body">Lo que faltaba por ordenar se dio de baja: ya no se compra.</div></div>
        </div>
      )}
      {devueltas > 0 && (
        <div className="ds-callout ds-callout--yellow mt-4">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div>
            <div className="ds-callout__title">{cuenta(devueltas, "línea devuelta", "líneas devueltas")} al ingeniero</div>
            <div className="ds-callout__body">No se pueden ordenar hasta que {p.solicitante || "quien la pidió"} las corrija.</div>
          </div>
        </div>
      )}
      {sinVariante > 0 && (
        <div className="ds-callout ds-callout--yellow mt-4">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div>
            <div className="ds-callout__title">{cuenta(sinVariante, "línea sin variante", "líneas sin variante")}</div>
            <div className="ds-callout__body">El material tiene varias variantes en Business Central y la solicitud no dice cuál. Elegila al armar la orden.</div>
          </div>
        </div>
      )}

      <h3 className="sol-panel__h">Artículos <span className="tab-compras__n">{p.lineas.length}</span></h3>
      <ul className="sol-art" aria-label="Artículos de la solicitud">
        {p.lineas.map((l) => {
          const ordenada = Math.min(l.cantidadOrdenada, l.cantidad);
          const recibida = recibidoPorLinea.get(l.id) ?? 0;
          // El estado de la línea, solo cuando dice algo: "falta todo" es lo normal
          // de una solicitud por gestionar y repetirlo en cada línea es ruido.
          const estado = l.devuelta ? <span className="ds-pending-text">Devuelta</span>
            : ordenada >= l.cantidad ? (recibida >= l.cantidad ? "Ordenada y recibida" : "Ordenada")
            : ordenada > 0 ? `Ordenado ${num.format(ordenada)} de ${num.format(l.cantidad)}`
            : null;
          const variante = l.variantCode ? variantes.etiqueta(l.articuloId, l.variantCode) : "";
          return (
            <li key={l.id} className={`sol-art__fila ${l.devuelta || (cerrada && ordenada < l.cantidad) ? "is-apagada" : ""}`}>
              <div className="sol-art__desc">
                <div className="sol-art__nombre">{l.descripcion}</div>
                <div className="ds-muted ds-body-sm">
                  {[l.articuloId, variante].filter(Boolean).join(" · ")}
                  {!l.variantCode && !cerrada && variantes.falta(l.articuloId, l.variantCode) && <> · <span className="ds-pending-text">Sin variante</span></>}
                  {estado && <> · {estado}</>}
                </div>
              </div>
              <div className="sol-art__cant">
                <span className="ds-strong">{num.format(l.cantidad)}</span>
                <span className="ds-muted ds-body-sm">{l.unidad}</span>
              </div>
            </li>
          );
        })}
      </ul>

      {ocs.length > 0 && (
        <>
          <h3 className="sol-panel__h">Órdenes de compra <span className="tab-compras__n">{ocs.length}</span></h3>
          <div className="row gap-2 wrap">
            {ocs.map((o) => (
              <button key={o.id} type="button" className="chip-link" title={`Abrir la orden ${o.numero}`} onClick={() => onAbrirOrden(o.id)}>
                {o.numero}<span className="chip-link__ir" aria-hidden>↗</span>
              </button>
            ))}
          </div>
        </>
      )}

      {comentario && (
        <>
          <h3 className="sol-panel__h">Observaciones</h3>
          <p className="sol-panel__nota">{comentario}</p>
        </>
      )}
    </>
  );
}

function AccionesSolicitud({ pedido: p, onVer, onCrear }: { pedido: Pedido; onVer: () => void; onCrear: () => void }) {
  const hayPendiente = p.estado !== "cerrado" && p.lineas.some((l) => pedidoLineaPendiente(l) > 0);
  return (
    <>
      <Button variant="white" onClick={onVer}>Ver solicitud</Button>
      <Button onClick={onCrear} disabled={!hayPendiente}
        title={hayPendiente ? "Arma una orden con todo lo que le falta por ordenar" : "No le queda nada por ordenar"}>
        Crear orden →
      </Button>
    </>
  );
}
