"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Card, Tile } from "@/components/ui";
import { QtyRing } from "@/components/ui";
import { useStore } from "@/lib/store";
import { money, formatDate, ordenBadge, ordenRecibidoPct, ordenSubtotal } from "@/lib/helpers";

export default function OrdenesPage() {
  const { ordenes, proveedores } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);

  const abiertas = ordenes.filter((o) => o.estado === "abierto").length;
  const lanzadas = ordenes.filter((o) => o.estado === "lanzado").length;
  const completas = ordenes.filter((o) => o.estado === "completado").length;

  return (
    <AppShell role="proveeduria">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Órdenes de compra</h1>
            <p className="ds-muted">Órdenes enviadas a proveedores. Quedan abiertas hasta recibir el 100% del material.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={ordenes.length} label="Órdenes totales" />
          <Tile value={abiertas} label="Abiertas (borrador)" accent="var(--ds-color-gray-300)" />
          <Tile value={lanzadas} label="Lanzadas" accent="var(--ds-color-green-100)" />
          <Tile value={completas} label="Completadas" accent="var(--ds-color-green-200)" />
        </div>

        <Card className="mt-6" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr><th>N.º</th><th>Proveedor</th><th>Solicitudes</th><th>Fecha</th><th className="ds-num">Total</th><th>Recibido</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {ordenes.length === 0 && <tr><td colSpan={8}><div className="empty">Todavía no hay órdenes creadas.</div></td></tr>}
                {ordenes.map((o) => {
                  const b = ordenBadge(o.estado);
                  const total = ordenSubtotal(o);
                  const peds = [...new Set(o.lineas.filter((l) => l.pedidoNumero).map((l) => l.pedidoNumero!))];
                  return (
                    <tr key={o.id} className="is-clickable" onClick={() => router.push(`/proveeduria/ordenes/${o.id}`)}>
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
                      <td className="ds-num">{money(total, o.currencyCode)}</td>
                      <td><div className="row gap-3"><QtyRing recibida={o.lineas.reduce((s,l)=>s+l.cantidadRecibida,0)} total={o.lineas.reduce((s,l)=>s+l.cantidad,0)} /><span className="ds-body-sm ds-muted">{ordenRecibidoPct(o)}%</span></div></td>
                      <td><Badge tone={b.tone}>{b.label}</Badge></td>
                      <td className="ds-num">›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </AppShell>
  );
}
