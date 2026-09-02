"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, Modal } from "@/components/ui";
import { DestinoLinea } from "@/components/destino-linea";
import { IconCheck } from "@/components/icons";
import { esConsumoDirecto, num } from "@/lib/helpers";
import type { Pedido, PedidoLinea } from "@/lib/types";

// Diálogo para SUMARLE a una orden líneas de solicitud que quedaron pendientes por
// ordenar. Lo usan las DOS pantallas que arman líneas de orden: armar la orden
// (proveeduria/nueva) y corregir una orden abierta (proveeduria/ordenes/[id]/editar).
//
// Vive acá y no copiado en cada página porque la copia YA se había divergido: una
// filtraba por código + descripción y la otra solo por descripción, una formateaba
// el pendiente con `num` y la otra no. Lo que sí queda en cada página es su propio
// `onAgregar`: armar la fila es distinto de verdad en cada una (una consulta el
// último precio a BC, la otra lo tiene en memoria).
//
// Nada de `<table className="ds-table">`: `.ds-table thead th` (globals.css:370)
// pinta de NEGRO cualquier <th> y no hay variante clara, así que el encabezado de
// dos filas (rótulos + filtros) salían como dos barras negras apiladas dentro de un
// diálogo claro. Se reusa la pseudo-tabla en grilla que el DS ya tiene para las
// líneas de recepción: `.rec-line` + `.rec-line--head` (853-874).
export type LineaDisponible = { p: Pedido; l: PedidoLinea; pend: number; origen?: boolean };

// Debajo de esto, buscador y contador son adorno: "1 de 2 línea(s)" arriba de dos
// filas es justamente el tipo de detalle que hace ver mal una pantalla.
const CON_BUSCADOR = 6;

// Todo lo que alguien puede escribir para encontrar una línea: el material, su
// código o variante, el número de solicitud, el destino, la obra o quién la pidió.
const heno = ({ p, l }: LineaDisponible) =>
  [l.articuloId, l.descripcion, l.variantCode, p.numero, l.almacen, l.proyecto, l.taskNo, l.taskDescr,
    p.obraCodigo, p.obraNombre, p.solicitante].filter(Boolean).join(" ").toLowerCase();

export function AgregarLineasSolicitud({
  lineas, yaAgregada, onAgregar, onQuitar, onClose,
}: {
  /** Líneas pendientes por ordenar, ya ordenadas por la página. */
  lineas: LineaDisponible[];
  /** Derivado de las filas de la orden: la marca "Agregada" NO es estado propio. */
  yaAgregada: (l: PedidoLinea) => boolean;
  onAgregar: (p: Pedido, l: PedidoLinea, pend: number) => void;
  /** Deshacer un "Agregar" sin salir del diálogo. */
  onQuitar: (l: PedidoLinea) => void;
  onClose: (agregadas: number) => void;
}) {
  // FOTO de la lista al abrir. `lineas` se recalcula con CADA fila que entra a la
  // orden (la página descarta las que ya están), así que sin la foto la fila
  // desaparece bajo el cursor al hacer clic y el siguiente clic cae en otra línea
  // — en el teléfono, bajo el dedo. Con la foto se queda en su lugar, marcada
  // "Agregada". El diálogo se desmonta al cerrar, así que la foto se renueva sola.
  const [snap] = useState(() => lineas);
  const [q, setQ] = useState("");
  const [soloOrden, setSoloOrden] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);

  // `autoFocus` no alcanza: el Modal manda el foco a su botón de cerrar al montar
  // (components/ui.tsx:390-393). Se le pide un tick después.
  useEffect(() => { const t = setTimeout(() => qRef.current?.focus(), 0); return () => clearTimeout(t); }, []);

  const nOrigen = snap.filter((d) => d.origen).length;
  // El chip solo tiene sentido si hay de las dos: con todas de la misma solicitud
  // no filtra nada.
  const hayMezcla = nOrigen > 0 && nOrigen < snap.length;
  const conBuscador = snap.length > CON_BUSCADOR;
  const agregadas = snap.filter((d) => yaAgregada(d.l)).length;
  const cerrar = () => onClose(agregadas);

  // UN clic por línea cada 400 ms, y este freno no es un lujo: es un bug que se
  // reprodujo. El botón de la fila alterna (Agregar → Quitar en el mismo lugar) y
  // los dos clics de un doble clic llegan ANTES de que React vuelva a dibujar, o sea
  // los dos con la línea todavía "sin agregar": sin freno, el segundo clic no la
  // quitaba, la agregaba nuevamente y la orden quedaba con el mismo material DOS
  // VECES (verificado: 2 líneas → 4). Un "Quitar" o un "Agregar" de verdad nunca
  // llegan 400 ms después del anterior sobre la MISMA línea.
  const ultimoToque = useRef<Record<string, number>>({});
  const tocar = (id: string) => {
    const t = performance.now();
    if (t - (ultimoToque.current[id] ?? 0) < 400) return false;
    ultimoToque.current[id] = t;
    return true;
  };
  const agregar = (p: Pedido, l: PedidoLinea, pend: number) => { if (tocar(l.id)) onAgregar(p, l, pend); };
  const quitar = (l: PedidoLinea) => { if (tocar(l.id)) onQuitar(l); };

  // Agrupado por solicitud. `snap` ya viene en el orden que quiere la página (al
  // corregir una orden, las de ESA orden primero) y el Map conserva el orden de
  // inserción: los grupos salen en ese mismo orden sin volver a ordenar nada.
  const grupos = useMemo(() => {
    const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const gs = new Map<string, { p: Pedido; origen: boolean; items: LineaDisponible[] }>();
    for (const d of snap) {
      if (soloOrden && !d.origen) continue;
      if (toks.length) { const h = heno(d); if (!toks.every((t) => h.includes(t))) continue; }
      const g = gs.get(d.p.numero) ?? { p: d.p, origen: !!d.origen, items: [] as LineaDisponible[] };
      g.items.push(d);
      gs.set(d.p.numero, g);
    }
    return [...gs.values()];
  }, [snap, q, soloOrden]);
  const mostradas = grupos.reduce((n, g) => n + g.items.length, 0);
  // El rótulo del grupo se decide por cuántas solicitudes hay en TODA la lista, no
  // por cuántos grupos quedaron a la vista: si la lista entera es de una sola
  // solicitud (la de esta orden), el rótulo repite lo que ya se sabe; pero si hay
  // varias y el buscador dejó una, el número de solicitud es justo lo que hay que
  // ver para no agregar material de la obra equivocada.
  const conRotulos = new Set(snap.map((d) => d.p.numero)).size > 1;

  return (
    <Modal wide title="Agregar líneas de solicitud" onClose={cerrar}
      footer={<>
        <span className="ds-body-sm ds-muted" style={{ marginRight: "auto", alignSelf: "center" }} aria-live="polite">
          {agregadas > 0 ? `${agregadas} línea(s) agregada(s)` : ""}
        </span>
        <Button onClick={cerrar}>Listo</Button>
      </>}>

      {/* Una línea, no tres. Cuál viene de la solicitud de esta orden ya no hace
          falta explicarlo: lo dicen el orden de los grupos y la marca del rótulo. */}
      <p className="ds-body-sm ds-muted" style={{ margin: 0 }}>
        Entran con el pendiente completo y el último precio; la cantidad y el precio se ajustan después, en la tabla de la orden.
      </p>

      {snap.length === 0 ? (
        <EmptyState title="No quedan líneas pendientes por ordenar."
          hint="Cuando el ingeniero apruebe otra solicitud, sus líneas van a aparecer acá." />
      ) : (
        <>
          {conBuscador && (
            <div className="addl-tools">
              <input ref={qRef} className="md-filtro" value={q} onChange={(e) => setQ(e.target.value)}
                aria-label="Buscar material, código, solicitud, obra o solicitante"
                placeholder="Buscar material, código, solicitud u obra…" />
              {hayMezcla && (
                <button type="button" aria-pressed={soloOrden}
                  className={`filter-chip${soloOrden ? " is-active" : ""}`}
                  onClick={() => setSoloOrden((v) => !v)}>
                  De esta orden <span className="filter-chip__count">{nOrigen}</span>
                </button>
              )}
            </div>
          )}

          <div className="addl-scroll">
            {/* Encabezado de columnas liviano y pegajoso. Va DENTRO de la caja con
                scroll para que la barra de scroll no lo desalinee de las filas. */}
            <div className="rec-line rec-line--head addl-line addl-line--head" aria-hidden="true">
              <span>Artículo</span><span>Destino</span><span className="ds-num">Pendiente</span><span />
            </div>

            {grupos.length === 0 ? (
              <div className="empty empty--compact" role="status">
                Ninguna línea coincide con la búsqueda.{" "}
                <button type="button" className="link-btn"
                  onClick={() => { setQ(""); setSoloOrden(false); qRef.current?.focus(); }}>Limpiar</button>
              </div>
            ) : grupos.map((g) => (
              <div key={g.p.numero} role="group" aria-label={`Solicitud ${g.p.numero}`}
                className={`combo__group-wrap${g.origen ? " addl-grp--origen" : ""}`}>
                {conRotulos && (
                  <div className="combo__group">
                    {/* Corto a propósito: `.combo__group` va en mayúsculas, y con el
                        nombre del solicitante adentro el rótulo grita y se come dos
                        renglones. Quién la pidió se ve en la solicitud. */}
                    {[g.p.numero, g.p.obraCodigo].filter(Boolean).join(" · ")} · {g.items.length} {g.items.length === 1 ? "línea" : "líneas"}
                    {g.origen && <span className="addl-grp__origen"> · de esta orden</span>}
                  </div>
                )}

                {g.items.map(({ p, l, pend }) => {
                  const ya = yaAgregada(l);
                  const destino = esConsumoDirecto(l)
                    ? `obra ${l.proyecto}, tarea ${l.taskNo}`
                    : (l.almacen ? `almacén ${l.almacen}` : "sin almacén");
                  const etiqueta = `${l.articuloId} ${l.descripcion}${l.variantCode ? `, variante ${l.variantCode}` : ""}. Pendiente ${num.format(pend)} ${l.unidad}. Destino ${destino}. Solicitud ${p.numero}`;
                  return (
                    <div key={l.id} className={`rec-line addl-line${ya ? " is-ya" : ""}`}>
                      <span className="rec-line__desc">
                        <span className="rec-line__code">{l.articuloId}{l.variantCode ? ` · ${l.variantCode}` : ""}</span>
                        <span className="rec-line__name" title={`${l.articuloId} — ${l.descripcion}`}>{l.descripcion}</span>
                      </span>
                      {/* La tarea es lo que hace que la línea sea consumo de obra:
                          con ella se muestran obra y tarea, sin ella el almacén al
                          que entra el material (components/destino-linea.tsx). */}
                      <span className="addl-line__dest">
                        <DestinoLinea inline almacen={l.almacen}
                          obra={esConsumoDirecto(l) ? l.proyecto : ""} tarea={l.taskNo} tareaNombre={l.taskDescr} />
                      </span>
                      <span className="rec-line__qty">
                        {/* En móvil no hay encabezado de columnas: el número tiene
                            que decir que es el PENDIENTE y no lo que se pidió. */}
                        <span className="addl-pendlbl">Pendiente </span>{num.format(pend)} {l.unidad}
                      </span>
                      <span className="addl-line__acc">
                        <span className="addl-line__ok" aria-hidden={!ya}>
                          {ya ? <><IconCheck size={14} /> Agregada</> : null}
                        </span>
                        <button type="button" className="link-btn addl-add"
                          onClick={() => (ya ? quitar(l) : agregar(p, l, pend))}
                          aria-label={`${ya ? "Quitar de la orden" : "Agregar a la orden"}: ${etiqueta}`}>
                          {ya ? "Quitar" : "Agregar"}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Pie pegajoso: cuenta lo que se está viendo y, sobre todo, hace que
                las filas pasen por detrás en vez de cortarse a media altura. */}
            {conBuscador && grupos.length > 0 && (
              <div className="combo__more">
                {mostradas === snap.length ? `${mostradas} línea(s)` : `${mostradas} de ${snap.length} línea(s)`}
                {" · "}{grupos.length} {grupos.length === 1 ? "solicitud" : "solicitudes"}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
