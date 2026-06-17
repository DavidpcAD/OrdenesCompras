"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, QtyRing, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { money, formatDate, ordenEsParcial, ordenRecibidoPct } from "@/lib/helpers";

export default function FacturacionPage() {
  const { ordenes, proveedores } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);

  // órdenes lanzadas pendientes de recibir (total o parcial)
  const porRecibir = ordenes.filter((o) => o.estado === "lanzado");
  const parciales = porRecibir.filter(ordenEsParcial).length;

  return (
    <AppShell role="facturacion">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Órdenes por recibir</h1>
            <p className="ds-muted">Registrá la factura cuando el material llega a bodega. Soporta entregas parciales.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={porRecibir.length} label="Órdenes por recibir" accent="var(--ds-color-red-100)" />
          <Tile value={parciales} label="Con recepción parcial" accent="var(--ds-color-yellow)" />
          <Tile value={ordenes.filter((o) => o.estado === "completado").length} label="Completadas" accent="var(--ds-color-green-200)" />
          <Tile value={ordenes.length} label="Órdenes en sistema" accent="var(--ds-color-gray-300)" />
        </div>

        <div className="col gap-4 mt-6">
          {porRecibir.length === 0 && <Card><div className="empty" style={{ lineHeight: 1.6 }}>No hay órdenes pendientes de recibir.<br /><span className="ds-muted ds-body-sm">Para ver todas las órdenes y sus facturas, abrí la pestaña <strong>“Todas las órdenes”</strong> arriba.</span></div></Card>}
          {porRecibir.map((o) => {
            const total = o.lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
            return (
              <Card key={o.id} interactive onClick={() => router.push(`/facturacion/${o.id}`)}>
                <div className="row row--between wrap gap-4">
                  <div className="row gap-4">
                    <QtyRing recibida={o.lineas.reduce((s, l) => s + l.cantidadRecibida, 0)} total={o.lineas.reduce((s, l) => s + l.cantidad, 0)} />
                    <div className="col" style={{ gap: 4 }}>
                      <div className="row gap-3">
                        <span className="ds-strong">{o.numero}</span>
                        {ordenEsParcial(o) ? <Badge tone="yellow">Parcial · {ordenRecibidoPct(o)}%</Badge> : <Badge tone="green">Lanzado</Badge>}
                      </div>
                      <span className="ds-muted ds-label">{prov(o.proveedorId)?.nombre} · emitida {formatDate(o.fecha)}</span>
                      <div className="row gap-2 wrap">
                        {[...new Set(o.lineas.filter((l) => l.pedidoNumero).map((l) => l.pedidoNumero!))].slice(0, 3).map((n) => <Badge key={n} tone="gray">{n}</Badge>)}
                      </div>
                    </div>
                  </div>
                  <div className="row gap-6">
                    <div className="col" style={{ alignItems: "flex-end" }}>
                      <span className="ds-strong">{money(total, o.currencyCode)}</span>
                      <span className="ds-muted ds-body-sm">total orden</span>
                    </div>
                    <Button variant="red">Registrar factura</Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </main>
    </AppShell>
  );
}
