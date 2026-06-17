"use client";

import { useRouter } from "next/navigation";
import { Badge, Card, QtyRing } from "@/components/ui";
import { useStore } from "@/lib/store";
import { money, formatDate, ordenBadge, ordenRecibidoPct, ordenSubtotal } from "@/lib/helpers";
import type { Orden } from "@/lib/types";

// Tabla de órdenes reutilizable; cada fila navega al detalle según el rol.
export function OrdenesLista({
  ordenes,
  hrefDetalle,
  vacio = "No hay órdenes.",
}: {
  ordenes: Orden[];
  hrefDetalle: (id: string) => string;
  vacio?: string;
}) {
  const { proveedores } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
        <table className="ds-table">
          <thead>
            <tr><th>N.º</th><th>Proveedor</th><th>Solicitudes</th><th>Fecha</th><th className="ds-num">Total</th><th>Recibido</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {ordenes.length === 0 && <tr><td colSpan={8}><div className="empty">{vacio}</div></td></tr>}
            {ordenes.map((o) => {
              const b = ordenBadge(o.estado);
              const peds = [...new Set(o.lineas.filter((l) => l.pedidoNumero).map((l) => l.pedidoNumero!))];
              return (
                <tr key={o.id} className="is-clickable" onClick={() => router.push(hrefDetalle(o.id))}>
                  <td className="ds-strong">{o.numero}</td>
                  <td>{prov(o.proveedorId)?.nombre ?? "—"}</td>
                  <td>
                    <div className="row gap-2 wrap">
                      {peds.slice(0, 2).map((n) => <Badge key={n} tone="gray">{n}</Badge>)}
                      {peds.length > 2 && <span className="ds-muted ds-body-sm">+{peds.length - 2}</span>}
                      {peds.length === 0 && <span className="ds-muted ds-body-sm">—</span>}
                    </div>
                  </td>
                  <td>{formatDate(o.fecha)}</td>
                  <td className="ds-num">{money(ordenSubtotal(o), o.currencyCode)}</td>
                  <td><div className="row gap-3"><QtyRing recibida={o.lineas.reduce((s, l) => s + l.cantidadRecibida, 0)} total={o.lineas.reduce((s, l) => s + l.cantidad, 0)} /><span className="ds-body-sm ds-muted">{ordenRecibidoPct(o)}%</span></div></td>
                  <td><Badge tone={b.tone}>{b.label}</Badge></td>
                  <td className="ds-num">›</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
