"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Modal, Textarea, useToast, QtyRing } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { useStore } from "@/lib/store";
import { formatDate, num, pedidoBadge, pedidoLineaPendiente, recibidoDeLineaPedido, destinoCodigo, destinoLabel, tipoSolicitudBadge } from "@/lib/helpers";

export default function ProveeduriaPedidoDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { pedidos, ordenes, articulos, setBorrador, devolverPedido } = useStore();
  const [devolverOpen, setDevolverOpen] = useState(false);
  const [motivo, setMotivo] = useState("");

  const pedido = pedidos.find((p) => p.id === id);
  if (!pedido) {
    return <AppShell role="proveeduria"><main className="page"><div className="empty">Solicitud no encontrada.</div></main></AppShell>;
  }
  const b = pedidoBadge(pedido.estado);
  const t = tipoSolicitudBadge(pedido.tipoSolicitud);
  const total = pedido.lineas.reduce((s, l) => s + l.cantidad, 0);
  const rec = pedido.lineas.reduce((s, l) => s + recibidoDeLineaPedido(ordenes, l.id), 0);
  const pct = total > 0 ? Math.round(Math.min(100, (rec / total) * 100)) : 0;
  const hayPendiente = pedido.lineas.some((l) => pedidoLineaPendiente(l) > 0);

  function crearOC() {
    const lineas = pedido!.lineas
      .filter((l) => pedidoLineaPendiente(l) > 0)
      .map((l) => { const a = articulos.find((x) => x.id === l.articuloId); return { pedidoLineaId: l.id, cantidad: pedidoLineaPendiente(l), precio: a?.precioReferencia ?? 0, iva: 13 }; });
    if (!lineas.length) { toast("Este pedido no tiene líneas pendientes por ordenar.", "error"); return; }
    setBorrador(lineas);
    router.push("/proveeduria/nueva");
  }
  async function confirmarDevolver() {
    if (!motivo.trim()) { toast("Escribí el motivo de la devolución.", "error"); return; }
    await devolverPedido(pedido!.id, motivo.trim());
    toast(`${pedido!.numero} devuelto a Ingeniería.`, "info");
    setDevolverOpen(false);
    router.push("/proveeduria/solicitudes");
  }

  return (
    <AppShell role="proveeduria">
      <main className="page">
        <div className="back-link" onClick={() => router.push("/proveeduria/solicitudes")}>‹ Volver a solicitudes</div>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3">
              <h1 className="ds-heading">{pedido.numero}</h1>
              <Badge tone={t.tone}>{t.label}</Badge>
              <Badge tone={b.tone}>{b.label}</Badge>
            </div>
            <p className="ds-muted">{destinoCodigo(pedido)} · {destinoLabel(pedido)} · {pedido.solicitante} · {formatDate(pedido.fecha)}</p>
          </div>
          <div className="row gap-3" style={{ alignItems: "center" }}>
            <div className="row gap-2" style={{ alignItems: "center" }}><QtyRing recibida={rec} total={total} /><span className="ds-body-sm ds-muted">entregado</span></div>
            <Button variant="red" onClick={() => setDevolverOpen(true)}>Devolver al ingeniero</Button>
            <Button onClick={crearOC} disabled={!hayPendiente}>Crear orden de compra →</Button>
          </div>
        </div>

        {pedido.notas && (
          <Card className="mt-2" style={{ background: "color-mix(in srgb, var(--ds-color-yellow) 8%, #fff)" }}>
            <span className="ds-label ds-muted">Comentario</span>
            <p style={{ margin: "4px 0 0" }}>{pedido.notas}</p>
          </Card>
        )}

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Artículo</th><th>Obra</th><th className="ds-num">Solicitado</th><th className="ds-num">Ordenado</th><th className="ds-num">Pendiente</th></tr></thead>
              <tbody>
                {pedido.lineas.map((l) => (
                  <tr key={l.id}>
                    <td><div className="ds-truncate" title={l.descripcion} style={{ maxWidth: 260 }}>{l.descripcion}</div></td>
                    <td className="ds-muted ds-body-sm">{l.almacen || "—"}</td>
                    <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
                    <td className="ds-num">{num.format(l.cantidadOrdenada)}</td>
                    <td className="ds-num">{pedidoLineaPendiente(l) > 0 ? <span className="ds-pending-text">{num.format(pedidoLineaPendiente(l))}</span> : "0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Historial</h3>
        <Card><Timeline entidad="pedido" idEntidad={pedido.id} traza /></Card>
      </main>

      {devolverOpen && (
        <Modal title={`Devolver ${pedido.numero} a Ingeniería`} onClose={() => setDevolverOpen(false)}
          footer={<><Button variant="outline" onClick={() => setDevolverOpen(false)}>Cancelar</Button><Button variant="red" onClick={confirmarDevolver}>Devolver</Button></>}>
          <p className="ds-muted ds-body-sm" style={{ marginTop: 0 }}>Indicá qué debe corregir el ingeniero. Le llega una notificación y el pedido queda en estado “Devuelto”.</p>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la devolución…" rows={4} style={{ width: "100%" }} />
        </Modal>
      )}
    </AppShell>
  );
}
