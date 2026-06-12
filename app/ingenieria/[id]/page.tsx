"use client";

import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, useToast } from "@/components/ui";
import { useStore } from "@/lib/store";
import { formatDate, num, pedidoBadge, pedidoLineaPendiente } from "@/lib/helpers";

export default function PedidoDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { pedidos, setPedidoEstado, deletePedido } = useStore();

  const pedido = pedidos.find((p) => p.id === id);
  if (!pedido) {
    return (
      <AppShell role="ingenieria">
        <main className="page"><div className="empty">Pedido no encontrado.</div></main>
      </AppShell>
    );
  }
  const b = pedidoBadge(pedido.estado);
  const ordenado = pedido.lineas.some((l) => l.cantidadOrdenada > 0);

  return (
    <AppShell role="ingenieria">
      <main className="page">
        <div className="back-link" onClick={() => router.push("/ingenieria")}>‹ Volver a pedidos</div>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3">
              <h1 className="ds-heading">{pedido.numero}</h1>
              <Badge tone={b.tone}>{b.label}</Badge>
            </div>
            <p className="ds-muted">{pedido.proyecto} · {pedido.solicitante} · {formatDate(pedido.fecha)}</p>
          </div>
          <div className="row gap-3">
            {pedido.estado === "borrador" && (
              <>
                <Button variant="outline" onClick={() => { deletePedido(pedido.id); toast("Pedido eliminado"); router.push("/ingenieria"); }}>
                  Eliminar
                </Button>
                <Button onClick={() => { setPedidoEstado(pedido.id, "aprobado"); toast(`${pedido.numero} aprobado y enviado a proveeduría`, "success"); }}>
                  Aprobar y enviar a proveeduría
                </Button>
              </>
            )}
            {pedido.estado === "aprobado" && (
              <Button variant="outline" onClick={() => { setPedidoEstado(pedido.id, "borrador"); toast("Pedido reabierto como borrador"); }}>
                Volver a borrador
              </Button>
            )}
          </div>
        </div>

        {pedido.notas && (
          <Card flat className="mt-2"><span className="ds-muted ds-label">Notas:</span> {pedido.notas}</Card>
        )}

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Artículo</th><th>Almacén</th><th className="ds-num">Solicitado</th>
                  <th className="ds-num">En orden</th><th className="ds-num">Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {pedido.lineas.map((l) => {
                  const pend = pedidoLineaPendiente(l);
                  return (
                    <tr key={l.id}>
                      <td>{l.descripcion}</td>
                      <td className="ds-muted">{l.almacen}</td>
                      <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
                      <td className="ds-num">{num.format(l.cantidadOrdenada)}</td>
                      <td className="ds-num">
                        {pend > 0 ? <span className="ds-pending-text">{num.format(pend)}</span> : <span className="ds-muted">0</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {pedido.estado === "aprobado" && !ordenado && (
          <p className="ds-muted ds-label mt-4">Este pedido está aprobado. Proveeduría puede convertirlo en una orden de compra.</p>
        )}
      </main>
    </AppShell>
  );
}
