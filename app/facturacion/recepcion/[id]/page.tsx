"use client";

import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Card } from "@/components/ui";
import { useStore } from "@/lib/store";
import { money, formatDate, num } from "@/lib/helpers";

// Detalle de UNA recepción/factura: qué se recibió exactamente en ese registro
// (líneas, cantidad recibida, precio e importe), distinto del detalle acumulado
// de la orden. Se llega desde "Archivo y recepciones".
export default function RecepcionDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { recepciones, ordenes, proveedores } = useStore();

  const rec = recepciones.find((r) => r.id === id);
  if (!rec) {
    return <AppShell role="contabilidad"><main className="page"><div className="empty">Recepción no encontrada.</div></main></AppShell>;
  }
  const orden = ordenes.find((o) => o.id === rec.ordenId);
  const provNombre = orden?.proveedorNombre ?? proveedores.find((p) => p.id === orden?.proveedorId)?.nombre;
  const cur = orden?.currencyCode;

  // Resuelve cada línea de la recepción contra su línea de orden.
  const filas = rec.lineas.map((rl) => {
    const ol = orden?.lineas.find((l) => l.id === rl.ordenLineaId);
    const precio = rl.precioFactura ?? ol?.precioUnitario ?? 0;
    const desc = ol?.descuentoPct ?? 0;
    const importe = rl.cantidadRecibida * precio * (1 - desc / 100);
    return { rl, ol, precio, importe };
  });
  const esCargo = (f: typeof filas[number]) => f.ol?.tipo === "cargo";

  return (
    <AppShell role="contabilidad">
      <main className="page page--wide">
        <div className="back-link" onClick={() => router.push("/facturacion/archivo")}>Volver a archivo y recepciones</div>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3">
              <h1 className="ds-heading">Factura {rec.numeroFactura}</h1>
              {rec.parcial ? <Badge tone="yellow">Parcial</Badge> : <Badge tone="green">Completa</Badge>}
            </div>
            <p className="ds-muted">
              {provNombre ?? "—"}
              {orden && <> · orden <button className="link-btn" onClick={() => router.push(`/facturacion/ver/${orden.id}`)}>{orden.numero}</button></>}
            </p>
            <div className="row gap-4 wrap mt-2 ds-body-sm ds-muted">
              <span>Fecha factura: <span className="ds-strong">{formatDate(rec.fechaFactura)}</span></span>
              <span>Recepción en bodega: <span className="ds-strong">{formatDate(rec.fechaRecepcion)}</span></span>
              <span>Registro contable: <span className="ds-strong">{formatDate(rec.fechaRegistro)}</span></span>
            </div>
          </div>
        </div>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="row row--between" style={{ padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)" }}>
            <span className="ds-label ds-muted">{filas.length} línea(s) recibida(s) en esta factura</span>
          </div>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Artículo</th><th>Almacén</th>
                  <th className="ds-num">Recibido</th><th className="ds-num">Precio</th><th className="ds-num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 && <tr><td colSpan={5}><div className="empty">Esta factura no tiene líneas.</div></td></tr>}
                {filas.map((f) => (
                  <tr key={f.rl.ordenLineaId}>
                    <td>
                      {esCargo(f) ? <><Badge tone="yellow">Cargo</Badge> {f.ol?.descripcion ?? "Flete / transporte"}</> : (f.ol?.descripcion ?? "—")}
                      {!esCargo(f) && (
                        <div className="ds-body-sm ds-muted">
                          {[f.ol?.pedidoNumero, f.ol?.proyecto && `Proy. ${f.ol.proyecto}`, f.ol?.descuentoPct ? `−${f.ol.descuentoPct}%` : null].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="ds-muted">{f.ol?.almacen ?? "—"}</td>
                    <td className="ds-num">{num.format(f.rl.cantidadRecibida)} {f.ol?.unidad ?? ""}</td>
                    <td className="ds-num ds-muted">{money(f.precio, cur)}</td>
                    <td className="ds-num ds-strong">{money(f.importe, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="row mt-6" style={{ justifyContent: "flex-end" }}>
          <div className="totals" style={{ minWidth: 320 }}>
            <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}>
              <span>Total factura</span><span>{money(rec.total, cur)}</span>
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
