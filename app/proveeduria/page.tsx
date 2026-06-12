"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { formatDate, num, pedidoLineaPendiente, pedidoTieneSaldo } from "@/lib/helpers";

export default function ProveeduriaPage() {
  const { pedidos, ordenes } = useStore();
  const router = useRouter();

  // pedidos aprobados con saldo pendiente de ordenar
  const porOrdenar = pedidos.filter((p) => (p.estado === "aprobado") && pedidoTieneSaldo(p));
  const ordenesAbiertas = ordenes.filter((o) => o.estado !== "completado").length;

  return (
    <AppShell role="proveeduria">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Pedidos por ordenar</h1>
            <p className="ds-muted">Pedidos aprobados por ingeniería. Generá la orden de compra que se envía al proveedor.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={porOrdenar.length} label="Pedidos por ordenar" accent="var(--ds-color-yellow)" />
          <Tile value={ordenes.length} label="Órdenes creadas" />
          <Tile value={ordenesAbiertas} label="Órdenes abiertas" accent="var(--ds-color-green-100)" />
          <Tile value={pedidos.length} label="Pedidos en sistema" accent="var(--ds-color-gray-300)" />
        </div>

        <div className="col gap-4 mt-6">
          {porOrdenar.length === 0 && (
            <Card><div className="empty">No hay pedidos pendientes de ordenar. 🎉</div></Card>
          )}
          {porOrdenar.map((p) => (
            <Card key={p.id} interactive onClick={() => router.push(`/proveeduria/pedido/${p.id}`)}>
              <div className="row row--between wrap gap-4">
                <div className="col" style={{ gap: 4 }}>
                  <div className="row gap-3">
                    <span className="ds-strong">{p.numero}</span>
                    {p.prioridad === "urgente" && <Badge tone="red">Urgente</Badge>}
                    {p.prioridad === "alta" && <Badge tone="yellow">Alta</Badge>}
                  </div>
                  <span className="ds-muted ds-label">{p.proyecto} · {p.solicitante} · {formatDate(p.fecha)}</span>
                </div>
                <div className="row gap-6">
                  <div className="col" style={{ alignItems: "flex-end" }}>
                    <span className="ds-strong">{p.lineas.filter((l) => pedidoLineaPendiente(l) > 0).length}</span>
                    <span className="ds-muted ds-body-sm">líneas pendientes</span>
                  </div>
                  <Button>Generar orden</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </AppShell>
  );
}
