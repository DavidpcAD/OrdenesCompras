"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { DestinoLinea } from "@/components/destino-linea";
import { money, num, ordenLineaImporte, ordenLineaPendiente } from "@/lib/helpers";
import { codigoDeItem } from "@/lib/unidad";
import { useVariantes } from "@/lib/use-variantes";
import type { Orden, OrdenLinea } from "@/lib/types";

export function OrderLinesTable({ orden, showRecepcion = true, solicitudHref }: { orden: Orden; showRecepcion?: boolean; solicitudHref?: (l: OrdenLinea) => string | null }) {
  // Variantes de los materiales de la orden. La línea guarda el código ("0042") y el
  // nombre está en BC: sin él, dos líneas del mismo material se ven idénticas.
  const variantes = useVariantes(orden.lineas.map((l) => l.articuloId));
  return (
    <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th className="hide-mobile">Tipo</th><th>Descripción</th><th className="hide-mobile">Destino</th>
            <th className="ds-num">Cantidad</th>
            {showRecepcion && <th className="ds-num">Recibido</th>}
            {showRecepcion && <th className="ds-num">Pendiente</th>}
            <th className="ds-num">Precio unit.</th><th className="ds-num">Importe</th>
          </tr>
        </thead>
        <tbody>
          {orden.lineas.map((l) => {
            const pend = ordenLineaPendiente(l);
            const pendiente = showRecepcion && pend > 0 && l.tipo === "articulo";
            return (
              <tr key={l.id} className={pendiente ? "row-pending" : ""}>
                <td className="hide-mobile">{l.tipo === "cargo" ? <Badge tone="yellow">Cargo</Badge> : <Badge tone="gray">Artículo</Badge>}</td>
                <td>
                  {l.descripcion}
                  {l.variantCode && (
                    <div className="ds-body-sm ds-muted">Variante {variantes.etiqueta(l.articuloId, l.variantCode)}</div>
                  )}
                  {/* En móvil la columna Destino se oculta: el destino se repite acá
                      en una línea para no perderlo. */}
                  {l.tipo === "articulo" && (
                    <div className="ds-body-sm ds-muted only-mobile-cols">
                      <DestinoLinea inline almacen={l.almacen} obra={l.proyecto} tarea={l.taskNo} avisarSinTarea={false} />
                    </div>
                  )}
                  <div className="ds-body-sm ds-muted">
                    {(() => {
                      // La obra/tarea NO va acá: vive en la columna Destino, que es
                      // o la obra que consume el material o el almacén al que entra.
                      const rest = l.descuentoPct ? `−${l.descuentoPct}%` : "";
                      const href = l.pedidoNumero ? solicitudHref?.(l) : null;
                      // El CÓDIGO del material va primero: es con lo que Proveeduría
                      // confirma que la línea es la que se pidió y con lo que se busca
                      // en BC. La descripción sola no alcanza — "TUBO 3X3X1.8MM H.N." y
                      // "TUBO 3X3 HG 1.8 MM" son dos materiales distintos en la misma
                      // orden. Se muestra el código pelado (el guardado puede traer la
                      // variante pegada, "M11-0081 -VAR 12", que BC no conoce); la
                      // variante ya va en su propia línea.
                      const codigo = l.tipo === "articulo" ? codigoDeItem(l.articuloId ?? "") : "";
                      return <>
                        {codigo && <span className="ds-strong">{codigo}</span>}
                        {codigo && (l.pedidoNumero || rest) ? " · " : ""}
                        {l.pedidoNumero && (href
                          ? <Link className="linklike" href={href} title="Ver la solicitud (quién la pidió)">{l.pedidoNumero}</Link>
                          : <span>{l.pedidoNumero}</span>)}
                        {l.pedidoNumero && rest ? " · " : ""}{rest}
                      </>;
                    })()}
                  </div>
                </td>
                {/* Destino: la obra que consume el material (consumo directo) o el
                    almacén al que entra. Nunca las dos. */}
                <td className="ds-body-sm hide-mobile">
                  <DestinoLinea almacen={l.almacen} obra={l.proyecto} tarea={l.taskNo} avisarSinTarea={false} />
                </td>
                <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
                {showRecepcion && <td className="ds-num">{num.format(l.cantidadRecibida)}</td>}
                {showRecepcion && (
                  <td className="ds-num">
                    {l.tipo === "cargo" ? <span className="ds-muted">—</span>
                      : pend > 0 ? <span className="ds-pending-text">{num.format(pend)}</span>
                      : <span className="ds-muted">0</span>}
                  </td>
                )}
                <td className="ds-num">{money(l.precioUnitario, orden.currencyCode)}</td>
                <td className="ds-num ds-strong">{money(ordenLineaImporte(l), orden.currencyCode)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
