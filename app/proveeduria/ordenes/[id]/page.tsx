"use client";

import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, useToast } from "@/components/ui";
import { OrderLinesTable } from "@/components/order-lines";
import { Timeline } from "@/components/timeline";
import { useStore } from "@/lib/store";
import { money, formatDate, ordenBadge, ordenLineaImporte, ordenRecibidoPct } from "@/lib/helpers";

export default function ProvOrdenDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { ordenes, proveedores, recepciones, setOrdenEstado } = useStore();

  const orden = ordenes.find((o) => o.id === id);
  if (!orden) {
    return <AppShell role="proveeduria"><main className="page"><div className="empty">Orden no encontrada.</div></main></AppShell>;
  }
  const prov = proveedores.find((p) => p.id === orden.proveedorId);
  const b = ordenBadge(orden.estado);
  const recs = recepciones.filter((r) => r.ordenId === orden.id);
  const subtotal = orden.lineas.filter((l) => l.tipo === "articulo").reduce((s, l) => s + ordenLineaImporte(l), 0);
  const flete = orden.lineas.filter((l) => l.tipo === "cargo").reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);

  async function act(estado: NonNullable<typeof orden>["estado"], msg: string) {
    await setOrdenEstado(orden!.id, estado);
    toast(msg, "success");
  }

  return (
    <AppShell role="proveeduria">
      <main className="page">
        <div className="back-link" onClick={() => router.push("/proveeduria/ordenes")}>‹ Volver a órdenes</div>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3">
              <h1 className="ds-heading">{orden.numero}</h1>
              <Badge tone={b.tone}>{b.label}</Badge>
            </div>
            <p className="ds-muted">{prov?.code} · {prov?.nombre} · emitida {formatDate(orden.fecha)} · recibido {ordenRecibidoPct(orden)}%</p>
            <div className="row gap-2 wrap mt-2">
              <span className="ds-muted ds-body-sm">Solicitudes origen:</span>
              {[...new Set(orden.lineas.filter((l) => l.pedidoNumero).map((l) => l.pedidoNumero!))].map((n) => (
                <Badge key={n} tone="gray">{n}</Badge>
              ))}
              {orden.lineas.every((l) => !l.pedidoNumero) && <span className="ds-muted ds-body-sm">—</span>}
            </div>
          </div>
          <div className="row gap-3">
            {orden.estado === "abierto" && (
              <Button onClick={() => act("pendiente_aprobacion", `${orden.numero} enviada a aprobación`)}>Enviar a aprobación</Button>
            )}
            {orden.estado === "pendiente_aprobacion" && (
              <>
                <span className="ds-muted ds-label" style={{ alignSelf: "center" }}>En espera de aprobación de Luis Roberto</span>
                <Button variant="outline" onClick={() => act("abierto", "Solicitud de aprobación cancelada")}>Cancelar envío</Button>
              </>
            )}
            {orden.estado === "lanzado" && (
              <Button variant="outline" onClick={() => act("abierto", "Orden reabierta para edición")}>Volver a abrir</Button>
            )}
          </div>
        </div>

        <Card style={{ padding: 0, overflow: "hidden" }}>
          <OrderLinesTable orden={orden} />
        </Card>

        <div className="row mt-6" style={{ justifyContent: "flex-end" }}>
          <div className="totals" style={{ minWidth: 320 }}>
            <div className="totals__row"><span>Subtotal artículos</span><span>{money(subtotal, orden.currencyCode)}</span></div>
            <div className="totals__row"><span>Flete</span><span>{money(flete, orden.currencyCode)}</span></div>
            <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}><span>Total orden</span><span>{money(subtotal + flete, orden.currencyCode)}</span></div>
          </div>
        </div>

        <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Recepciones / facturas</h3>
        {recs.length === 0 ? (
          <Card flat><div className="ds-muted">Sin recepciones registradas todavía.</div></Card>
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
              <table className="ds-table">
                <thead><tr><th>Factura</th><th>Fecha factura</th><th>Fecha registro</th><th className="ds-num">Total</th><th>Tipo</th></tr></thead>
                <tbody>
                  {recs.map((r) => (
                    <tr key={r.id}>
                      <td className="ds-strong">{r.numeroFactura}</td>
                      <td>{formatDate(r.fechaFactura)}</td>
                      <td>{formatDate(r.fechaRegistro)}</td>
                      <td className="ds-num">{money(r.total, orden.currencyCode)}</td>
                      <td>{r.parcial ? <Badge tone="yellow">Parcial</Badge> : <Badge tone="green">Completa</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Historial</h3>
        <Card><Timeline entidad="orden" idEntidad={orden.id} /></Card>
      </main>
    </AppShell>
  );
}
