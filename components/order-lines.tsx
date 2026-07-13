"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { money, num, ordenLineaImporte, ordenLineaPendiente } from "@/lib/helpers";
import type { Orden, OrdenLinea } from "@/lib/types";

export function OrderLinesTable({ orden, showRecepcion = true, solicitudHref }: { orden: Orden; showRecepcion?: boolean; solicitudHref?: (l: OrdenLinea) => string | null }) {
  return (
    <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th className="hide-mobile">Tipo</th><th>Descripción</th><th className="hide-mobile">Almacén</th>
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
                  <div className="ds-body-sm ds-muted">
                    {(() => {
                      const rest = [l.proyecto && `Proy. ${l.proyecto}`, l.taskNo && `Tarea ${l.taskNo}`, l.descuentoPct ? `−${l.descuentoPct}%` : null].filter(Boolean).join(" · ");
                      const href = l.pedidoNumero ? solicitudHref?.(l) : null;
                      return <>
                        {l.pedidoNumero && (href
                          ? <Link className="linklike" href={href} title="Ver la solicitud (quién la pidió)">{l.pedidoNumero}</Link>
                          : <span>{l.pedidoNumero}</span>)}
                        {l.pedidoNumero && rest ? " · " : ""}{rest}
                      </>;
                    })()}
                  </div>
                </td>
                <td className="ds-muted hide-mobile">{l.almacen}</td>
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
