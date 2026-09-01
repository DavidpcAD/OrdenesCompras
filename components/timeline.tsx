"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { formatDateTime, ROL_LABEL, numeroOrden } from "@/lib/helpers";
import type { Movimiento } from "@/lib/types";

// Códigos de estado -> nombre legible (pedidos y órdenes).
const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  aprobado: "Aprobado",
  en_orden: "En orden",
  cerrado: "Cerrado",
  abierto: "Abierto",
  pendiente_aprobacion: "Pendiente de aprobación",
  lanzado: "Lanzado",
  parcial: "Parcial",
  completado: "Completado",
  anulado: "Anulado",
};
const estadoLabel = (c?: string) => (c ? (ESTADO_LABEL[c] ?? c) : undefined);

const LABEL: Record<string, string> = {
  creado: "Creado",
  reabierto: "Reabierto",
  rechazado: "Rechazado",
  editado: "Editado",
  aprobado: "Aprobado",
  en_orden: "Pasó a orden de compra",
  cerrado: "Cerrado",
  enviado_aprobacion: "Enviado a aprobación",
  aprobado_lanzado: "Aprobado y lanzado",
  completado: "Completado",
  recepcion_parcial: "Recepción parcial",
  recepcion_total: "Recepción total",
  eliminado: "Eliminado",
  bc_renumerado: "N.º de Business Central corregido",
};

// Etiqueta contextual: el mismo tipo de movimiento se lee distinto según
// la etapa (pedido vs. orden vs. recepción), para que la traza completa
// se entienda de un vistazo.
function etiqueta(m: Movimiento): string {
  if (m.entidad === "orden") {
    if (m.tipoMovimiento === "creado") return "En proveeduría · orden de compra creada";
    if (m.tipoMovimiento === "enviado_aprobacion") return "Orden enviada a aprobación";
    if (m.tipoMovimiento === "aprobado_lanzado") return "Orden aprobada y lanzada";
    if (m.tipoMovimiento === "rechazado") return "Orden rechazada por Aprobación";
    if (m.tipoMovimiento === "recepcion_parcial") return "Recibido en bodega (parcial)";
    if (m.tipoMovimiento === "recepcion_total") return "Recibido en bodega (total)";
    if (m.tipoMovimiento === "nc_resuelta") return "Nota de crédito acreditada";
    if (m.tipoMovimiento === "nc_reabierta") return "Nota de crédito reabierta";
    // Cerrada a mano por Proveeduría (el proveedor no trajo el resto, se compró en
    // otro lado). El motivo va en el detalle del movimiento.
    if (m.tipoMovimiento === "cerrado") return "Orden cerrada por Proveeduría";
  }
  if (m.entidad === "recepcion" && m.tipoMovimiento === "creado") return "Factura registrada";
  return LABEL[m.tipoMovimiento] ?? m.tipoMovimiento;
}

// Color del punto por etapa, para que cada evento se distinga de un vistazo.
function colorPunto(m: Movimiento): string {
  if (m.entidad === "orden") {
    switch (m.tipoMovimiento) {
      case "creado": return "var(--ds-color-gray-400)";   // En proveeduría · neutral (gris)
      case "enviado_aprobacion": return "var(--ds-color-yellow)"; // pendiente · amarillo
      case "aprobado_lanzado": return "var(--ds-color-green-200)"; // lanzada · verde
      case "recepcion_parcial": return "var(--ds-color-yellow)"; // recibido parcial · amarillo
      case "recepcion_total":
      case "completado": return "var(--ds-color-green-200)"; // recibido total / completado · verde fuerte
      case "rechazado": return "var(--ds-color-red-200)";    // rechazada · rojo
      case "cerrado": return "var(--ds-color-gray-400)";     // cerrada a mano · neutral
      case "bc_renumerado": return "var(--ds-color-yellow)";  // se re-apuntó a otro pedido de BC
      case "eliminado": return "var(--ds-color-red-100)";
    }
  }
  // Pedido (ingeniería)
  switch (m.tipoMovimiento) {
    case "creado": return "var(--ds-color-gray-300)";     // creado · gris
    case "aprobado": return "var(--ds-color-green-100)";  // aprobado · verde lima
    case "reabierto": return "var(--ds-color-gray-400)";
    case "eliminado":
    case "rechazado": return "var(--ds-color-red-100)";
  }
  return "var(--ds-color-gray-300)";
}

export function Timeline({
  entidad,
  idEntidad,
  traza = false,
}: {
  entidad: Movimiento["entidad"];
  idEntidad: string;
  // Si es true y la entidad es un pedido, suma los movimientos de la(s)
  // orden(es) en las que entró el pedido (proveeduría → aprobación → bodega),
  // para mostrar el historial completo hasta que se factura.
  traza?: boolean;
}) {
  const { movimientos, pedidos, ordenes, modoApi } = useStore();

  // Mapa idOrden -> número de orden, para mostrar de qué orden viene cada evento.
  const numeroDeOrden = new Map(ordenes.map((o) => [o.id, numeroOrden(o)]));

  // Órdenes que incluyen al menos una línea de este pedido (enlace N:M): sus
  // movimientos completan la traza pedido → orden → recepción.
  const idsOrdenLigadas = useMemo(() => {
    if (!(traza && entidad === "pedido")) return [] as string[];
    const pedido = pedidos.find((p) => p.id === idEntidad);
    const lineasPedido = new Set(pedido?.lineas.map((l) => l.id) ?? []);
    return ordenes.filter((o) => o.lineas.some((l) => l.pedidoLineaId && lineasPedido.has(l.pedidoLineaId))).map((o) => o.id);
  }, [traza, entidad, idEntidad, pedidos, ordenes]);

  // En modo API el historial se pide POR ENTIDAD (`/api/movimientos`). Antes venía
  // entero dentro del bootstrap: la tabla Movimiento completa viajaba en cada carga
  // y en cada auto-refresh (45s) solo para pintar estas dos pantallas de detalle.
  const [remotos, setRemotos] = useState<Movimiento[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const clave = `${entidad}:${idEntidad}:${idsOrdenLigadas.join(",")}`;
  useEffect(() => {
    if (!modoApi) return;
    let vivo = true;
    setRemotos(null); setFallo(false);
    const pedir = async (ent: string, id: string) => {
      const r = await fetch(`/api/movimientos?entidad=${encodeURIComponent(ent)}&id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return Array.isArray(d) ? (d as Movimiento[]) : [];
    };
    Promise.all([pedir(entidad, idEntidad), ...idsOrdenLigadas.map((oid) => pedir("orden", oid))])
      .then((partes) => { if (vivo) setRemotos(partes.flat()); })
      .catch(() => { if (vivo) { setRemotos([]); setFallo(true); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoApi, clave]);

  let items: Movimiento[];
  if (modoApi) {
    if (remotos === null) return <div className="ds-muted ds-label">Cargando historial…</div>;
    // No decir "sin movimientos" cuando en realidad no se pudo consultar.
    if (fallo) return <div className="ds-muted ds-label">No se pudo cargar el historial.</div>;
    items = remotos;
  } else {
    items = movimientos.filter((m) => m.entidad === entidad && m.idEntidad === idEntidad);
    if (idsOrdenLigadas.length) {
      const ids = new Set(idsOrdenLigadas);
      items = [...items, ...movimientos.filter((m) => m.entidad === "orden" && ids.has(m.idEntidad))];
    }
  }

  const ordenados = items.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

  if (ordenados.length === 0) {
    return <div className="ds-muted ds-label">Sin movimientos registrados todavía.</div>;
  }

  return (
    <div className="timeline">
      {ordenados.map((m) => {
        const ctxOrden = m.entidad === "orden" ? numeroDeOrden.get(m.idEntidad) : undefined;
        return (
          <div key={m.id} className="timeline__item">
            <span className="timeline__dot" style={{ background: colorPunto(m) }} />
            <div className="timeline__title">
              {etiqueta(m)}
              {ctxOrden && <span className="ds-muted" style={{ fontWeight: 400 }}> · {ctxOrden}</span>}
              {(() => {
                const ant = estadoLabel(m.estadoAnterior);
                const nue = estadoLabel(m.estadoNuevo);
                if (ant && nue && m.estadoAnterior !== m.estadoNuevo)
                  return <span className="ds-muted" style={{ fontWeight: 400 }}> · {ant} → {nue}</span>;
                if (nue)
                  return <span className="ds-muted" style={{ fontWeight: 400 }}> · {nue}</span>;
                return null;
              })()}
            </div>
            <div className="timeline__meta">
              {m.usuario} · {ROL_LABEL[m.rol]} · {formatDateTime(m.fecha)}{m.detalle ? ` · ${m.detalle}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
