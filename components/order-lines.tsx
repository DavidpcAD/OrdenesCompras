"use client";

import { Badge } from "@/components/ui";
import { money, num, ordenLineaPendiente } from "@/lib/helpers";
import type { Orden } from "@/lib/types";

export function OrderLinesTable({ orden, showRecepcion = true }: { orden: Orden; showRecepcion?: boolean }) {
  return (
    <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Tipo</th><th>Descripción</th><th>Almacén</th>
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
                <td>{l.tipo === "cargo" ? <Badge tone="yellow">Cargo</Badge> : <Badge tone="gray">Artículo</Badge>}</td>
                <td>{l.descripcion}{l.pedidoNumero && <div className="ds-body-sm ds-muted">{l.pedidoNumero}</div>}</td>
                <td className="ds-muted">{l.almacen}</td>
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
                <td className="ds-num ds-strong">{money(l.cantidad * l.precioUnitario, orden.currencyCode)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
