"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { formatDate, pedidoBadge, pedidoTieneSaldo } from "@/lib/helpers";

export default function IngenieriaPage() {
  const { pedidos } = useStore();
  const router = useRouter();

  const borradores = pedidos.filter((p) => p.estado === "borrador").length;
  const aprobados = pedidos.filter((p) => p.estado === "aprobado").length;
  const enOrden = pedidos.filter((p) => p.estado === "en_orden").length;

  return (
    <AppShell role="ingenieria">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Mis pedidos de compra</h1>
            <p className="ds-muted">Solicitá material para tus proyectos. Cada pedido se guarda en SQL y se sincroniza con Business Central.</p>
          </div>
          <Link href="/ingenieria/nuevo"><Button>+ Nuevo pedido</Button></Link>
        </div>

        <div className="tiles mt-2">
          <Tile value={pedidos.length} label="Pedidos totales" />
          <Tile value={borradores} label="En borrador" accent="var(--ds-color-gray-300)" />
          <Tile value={aprobados} label="Aprobados" accent="var(--ds-color-green-100)" />
          <Tile value={enOrden} label="En orden de compra" accent="var(--ds-color-yellow)" />
        </div>

        <Card className="mt-6" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>N.º</th><th>Proyecto</th><th>Solicitante</th><th>Fecha</th>
                  <th className="ds-num">Líneas</th><th>Prioridad</th><th>Estado</th><th></th>
                </tr>
              </thead>
              <tbody>
                {pedidos.length === 0 && (
                  <tr><td colSpan={8}><div className="empty">Aún no hay pedidos. Creá el primero.</div></td></tr>
                )}
                {pedidos.map((p) => {
                  const b = pedidoBadge(p.estado);
                  return (
                    <tr key={p.id} className="is-clickable" onClick={() => router.push(`/ingenieria/${p.id}`)}>
                      <td className="ds-strong">{p.numero}</td>
                      <td>{p.proyecto}</td>
                      <td>{p.solicitante}</td>
                      <td>{formatDate(p.fecha)}</td>
                      <td className="ds-num">{p.lineas.length}</td>
                      <td>
                        {p.prioridad === "urgente" ? <Badge tone="red">Urgente</Badge>
                          : p.prioridad === "alta" ? <Badge tone="yellow">Alta</Badge>
                          : <Badge tone="gray">Normal</Badge>}
                      </td>
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
