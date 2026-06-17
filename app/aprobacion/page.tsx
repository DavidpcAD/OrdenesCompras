"use client";

import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Tile, useToast } from "@/components/ui";
import { useStore } from "@/lib/store";
import { money, formatDate, num, ordenLineaImporte } from "@/lib/helpers";

export default function AprobacionPage() {
  const { ordenes, proveedores, setOrdenEstado } = useStore();
  const toast = useToast();
  const prov = (id: string) => proveedores.find((p) => p.id === id);

  const porAprobar = ordenes.filter((o) => o.estado === "pendiente_aprobacion");

  async function aprobar(id: string, numero: string) {
    await setOrdenEstado(id, "lanzado");
    toast(`Orden ${numero} aprobada y lanzada`, "success");
  }
  async function rechazar(id: string, numero: string) {
    await setOrdenEstado(id, "abierto");
    toast(`Orden ${numero} devuelta a proveeduría`, "info");
  }

  return (
    <AppShell role="aprobacion">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Órdenes por aprobar</h1>
            <p className="ds-muted">Revisá las órdenes que proveeduría envió a aprobación. Al aprobar pasan a “Lanzado” y se envían al proveedor.</p>
          </div>
        </div>

        <div className="tiles mt-2" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <Tile value={porAprobar.length} label="Pendientes de aprobación" accent="var(--ds-color-yellow)" />
          <Tile value={ordenes.filter((o) => o.estado === "lanzado").length} label="Lanzadas" accent="var(--ds-color-green-100)" />
          <Tile value={ordenes.filter((o) => o.estado === "completado").length} label="Completadas" accent="var(--ds-color-green-200)" />
        </div>

        <div className="col gap-4 mt-6">
          {porAprobar.length === 0 && <Card><div className="empty">No hay órdenes pendientes de aprobación.</div></Card>}
          {porAprobar.map((o) => {
            const articulos = o.lineas.filter((l) => l.tipo === "articulo");
            const total = o.lineas.reduce((s, l) => s + ordenLineaImporte(l), 0);
            return (
              <Card key={o.id}>
                <div className="row row--between wrap gap-4" style={{ marginBottom: 12 }}>
                  <div className="col" style={{ gap: 4 }}>
                    <div className="row gap-3">
                      <span className="ds-subtitle">{o.numero}</span>
                      <Badge tone="yellow">Pendiente de aprobación</Badge>
                    </div>
                    <span className="ds-muted ds-label">{prov(o.proveedorId)?.code} · {prov(o.proveedorId)?.nombre} · {formatDate(o.fecha)}</span>
                  </div>
                  <div className="row gap-3">
                    <Button variant="red" onClick={() => rechazar(o.id, o.numero)}>Rechazar</Button>
                    <Button onClick={() => aprobar(o.id, o.numero)}>Aprobar y lanzar</Button>
                  </div>
                </div>

                <div className="ds-table-wrap" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)" }}>
                  <table className="ds-table">
                    <thead>
                      <tr><th>Tipo</th><th>Descripción</th><th>Almacén</th><th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Importe</th></tr>
                    </thead>
                    <tbody>
                      {o.lineas.map((l) => (
                        <tr key={l.id}>
                          <td>{l.tipo === "cargo" ? <Badge tone="yellow">Cargo</Badge> : <Badge tone="gray">Artículo</Badge>}</td>
                          <td>{l.descripcion}{l.pedidoNumero && <div className="ds-body-sm ds-muted">{l.pedidoNumero}</div>}</td>
                          <td className="ds-muted ds-body-sm">{l.almacen}</td>
                          <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
                          <td className="ds-num">{money(l.precioUnitario, o.currencyCode)}</td>
                          <td className="ds-num ds-strong">{money(ordenLineaImporte(l), o.currencyCode)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="row mt-4" style={{ justifyContent: "flex-end" }}>
                  <span className="ds-muted ds-label" style={{ marginRight: 12 }}>{articulos.length} línea(s) · Total</span>
                  <span className="ds-subtitle">{money(total, o.currencyCode)}</span>
                </div>
              </Card>
            );
          })}
        </div>
      </main>
    </AppShell>
  );
}
