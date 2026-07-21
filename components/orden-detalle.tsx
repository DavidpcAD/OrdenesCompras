"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, useToast } from "@/components/ui";
import { OrderLinesTable } from "@/components/order-lines";
import { Timeline } from "@/components/timeline";
import { useStore } from "@/lib/store";
import { money, num, formatDate, ordenBadge, ordenLineaImporte, ordenRecibidoPct, ordenPedidos, ordenEsDirecta } from "@/lib/helpers";
import type { Orden } from "@/lib/types";

// Vista de detalle de una orden, reutilizada por Proveeduría, Aprobación y Bodega.
// `acciones` son los botones específicos de cada rol (aprobar, recibir, etc.).
export function OrdenDetalle({
  orden,
  volverHref,
  volverLabel = "Volver",
  acciones,
  solicitudHref,
}: {
  orden: Orden;
  volverHref: string;
  volverLabel?: string;
  acciones?: React.ReactNode;
  solicitudHref?: (l: Orden["lineas"][number]) => string | null;
}) {
  const { proveedores, recepciones } = useStore();
  const router = useRouter();
  const toast = useToast();
  const [verFactura, setVerFactura] = useState<string | null>(null);
  const [relanzando, setRelanzando] = useState(false);
  // Totales calculados por BC (fuente de verdad). Se leen si la orden ya está en BC.
  const [bcTot, setBcTot] = useState<{ subtotal: number; iva: number; total: number; currencyCode: string } | null>(null);
  useEffect(() => {
    if (!orden.bcNumber) { setBcTot(null); return; }
    let vivo = true;
    fetch(`/api/bc/orden-totales?orderNo=${encodeURIComponent(orden.bcNumber)}`)
      .then((r) => (r.ok ? r.json() : { totales: null }))
      .then((d) => { if (vivo && d?.totales) setBcTot(d.totales); })
      .catch(() => { /* sin BC: se muestran los totales locales */ });
    return () => { vivo = false; };
  }, [orden.bcNumber]);

  // Reintenta el lanzamiento en BC de un pedido YA creado (no duplica). Ahora
  // RE-SINCRONIZA las líneas (precio + variante) antes del Release, para que las
  // correcciones hechas en la app después de crearlo (p.ej. el precio de un
  // material sin historial) sí viajen a BC.
  async function reintentarLanzar() {
    if (!orden.bcNumber) return;
    setRelanzando(true);
    try {
      const lineas = orden.lineas
        .filter((l) => l.tipo === "articulo" && l.articuloId && l.cantidad > 0)
        .map((l) => ({ itemNo: l.articuloId!, cantidad: l.cantidad, precio: l.precioUnitario || 0, descripcion: l.descripcion, variantCode: l.variantCode }));
      const r = await fetch("/api/bc/relanzar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo: orden.bcNumber, lineas }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) toast(`BC ${orden.bcNumber}: ${d.status ?? "lanzado"} (líneas sincronizadas)`, "success");
      else toast(`No se pudo lanzar en BC: ${d.error ?? r.status}`, "error");
    } catch (e: any) {
      toast(`No se pudo lanzar en BC: ${String(e?.message ?? e)}`, "error");
    } finally {
      setRelanzando(false);
    }
  }

  const prov = proveedores.find((p) => p.id === orden.proveedorId);
  const b = ordenBadge(orden.estado);
  const peds = ordenPedidos(orden);
  const esDirecta = ordenEsDirecta(orden);
  const recs = recepciones.filter((r) => r.ordenId === orden.id);
  const subtotal = orden.lineas.filter((l) => l.tipo === "articulo").reduce((s, l) => s + ordenLineaImporte(l), 0);
  const iva = orden.lineas.filter((l) => l.tipo === "articulo").reduce((s, l) => s + ordenLineaImporte(l) * ((l.ivaPct || 0) / 100), 0);
  const flete = orden.lineas.filter((l) => l.tipo === "cargo").reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);

  return (
    <main className="page">
      <div className="back-link" onClick={() => router.push(volverHref)}>{volverLabel}</div>
      <div className="page__head">
        <div className="page__title">
          <div className="row gap-3">
            <h1 className="ds-heading">{orden.numero}</h1>
            <Badge tone={b.tone}>{b.label}</Badge>
            {esDirecta && <Badge tone="yellow">Directa</Badge>}
          </div>
          <p className="ds-muted">{orden.proveedorNo ?? prov?.code} · {orden.proveedorNombre ?? prov?.nombre} · emitida {formatDate(orden.fecha)} · recibido {ordenRecibidoPct(orden)}%{orden.bcNumber ? ` · BC ${orden.bcNumber}` : ""}</p>
          {orden.almacenRecepcion && <p className="ds-body-sm ds-muted">Recepción en almacén <span className="ds-strong">{orden.almacenRecepcion}</span></p>}
          <div className="row gap-2 wrap mt-2">
            {esDirecta ? (
              <span className="ds-muted ds-body-sm">Compra directa · sin solicitud de origen</span>
            ) : (
              <>
                <span className="ds-muted ds-body-sm">Solicitudes origen:</span>
                {peds.map((n) => <Badge key={n} tone="gray">{n}</Badge>)}
              </>
            )}
          </div>
        </div>
        <div className="row gap-3">
          <button className="link-btn" title="Imprimir / Guardar PDF para el proveedor"
            onClick={() => router.push(`/proveeduria/ordenes/${orden.id}/imprimir`)}>🖨️ Imprimir</button>
          {orden.bcDeepLink && (
            <button className="link-btn" title="Abrir el Pedido en Business Central (editar · vista previa de registro · registrar)"
              onClick={() => window.open(orden.bcDeepLink!, "_blank")}>↗ Abrir en BC</button>
          )}
          {orden.bcNumber && (
            <button className="link-btn" disabled={relanzando} title="Reintentar el lanzamiento (Release) en BC del pedido ya creado"
              onClick={reintentarLanzar}>{relanzando ? "Lanzando…" : "↻ Reintentar lanzar en BC"}</button>
          )}
          {acciones}
        </div>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <OrderLinesTable orden={orden} solicitudHref={solicitudHref} />
      </Card>

      <div className="row mt-6" style={{ justifyContent: "flex-end" }}>
        <div className="totals" style={{ minWidth: 320 }}>
          {bcTot ? (
            <>
              <div className="totals__row"><span>Subtotal (excl. IVA)</span><span>{money(bcTot.subtotal, bcTot.currencyCode || orden.currencyCode)}</span></div>
              <div className="totals__row"><span>IVA</span><span>{money(bcTot.iva, bcTot.currencyCode || orden.currencyCode)}</span></div>
              <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}><span>Total (con IVA)</span><span>{money(bcTot.total, bcTot.currencyCode || orden.currencyCode)}</span></div>
              <div style={{ gridColumn: "1 / -1" }} className="ds-body-sm ds-muted">Totales calculados por Business Central ✓</div>
            </>
          ) : (
            <>
              <div className="totals__row"><span>Subtotal artículos</span><span>{money(subtotal, orden.currencyCode)}</span></div>
              <div className="totals__row"><span>Flete</span><span>{money(flete, orden.currencyCode)}</span></div>
              <div className="totals__row"><span>IVA (materiales)</span><span>{money(iva, orden.currencyCode)}</span></div>
              <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}><span>Total orden</span><span>{money(subtotal + flete + iva, orden.currencyCode)}</span></div>
              {orden.bcNumber && <div style={{ gridColumn: "1 / -1" }} className="ds-body-sm ds-muted">Estimado local · los totales definitivos los calcula BC.</div>}
            </>
          )}
        </div>
      </div>

      <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Recepciones / facturas</h3>
      {recs.length === 0 ? (
        <Card flat><div className="ds-muted">Sin recepciones registradas todavía.</div></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Factura</th><th>Fecha factura</th><th>Fecha registro</th><th className="ds-num">Total</th><th>Tipo</th><th></th></tr></thead>
              <tbody>
                {recs.map((r) => {
                  const abierto = verFactura === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className="is-clickable" onClick={() => setVerFactura(abierto ? null : r.id)}>
                        <td className="ds-strong">{r.numeroFactura}</td>
                        <td>{formatDate(r.fechaFactura)}</td>
                        <td>{formatDate(r.fechaRegistro)}</td>
                        <td className="ds-num">{money(r.total, orden.currencyCode)}</td>
                        <td>{r.parcial ? <Badge tone="yellow">Parcial</Badge> : <Badge tone="green">Completa</Badge>}</td>
                        <td className="ds-num ds-muted">{abierto ? "▾ ocultar" : "› ver"}</td>
                      </tr>
                      {abierto && (
                        <tr>
                          <td colSpan={6} style={{ background: "var(--ds-color-surface)", padding: "6px 12px 14px" }}>
                            <div className="fac-det">
                              <div className="fac-det__head">
                                <span className="ds-strong">Factura {r.numeroFactura}</span>
                                <span className="ds-body-sm ds-muted">Registrada {formatDate(r.fechaRegistro)} · {r.parcial ? "entrega parcial" : "entrega completa"}</span>
                              </div>
                              <div className="fac-det__grid fac-det__colhead">
                                <span>Artículo</span>
                                <span className="fac-det__num">Cantidad</span>
                                <span className="fac-det__num">Precio factura</span>
                                <span className="fac-det__num">Importe</span>
                              </div>
                              {r.lineas.map((rl, i) => {
                                const ol = orden.lineas.find((x) => x.id === rl.ordenLineaId);
                                const precio = rl.precioFactura ?? ol?.precioUnitario ?? 0;
                                const distinto = ol != null && rl.precioFactura != null && rl.precioFactura !== ol.precioUnitario;
                                return (
                                  <div className="fac-det__grid" key={i}>
                                    <div>
                                      <div className="ds-strong">{ol?.descripcion ?? `Línea ${rl.ordenLineaId}`}</div>
                                      {ol?.articuloId && <div className="ds-body-sm ds-muted">{ol.articuloId}</div>}
                                    </div>
                                    <div className="fac-det__num">{num.format(rl.cantidadRecibida)} {ol?.unidad ?? ""}</div>
                                    <div className="fac-det__num">
                                      {money(precio, orden.currencyCode)}
                                      {distinto && <div className="ds-body-sm ds-pending-text">orden: {money(ol!.precioUnitario, orden.currencyCode)}</div>}
                                    </div>
                                    <div className="fac-det__num ds-strong">{money(precio * rl.cantidadRecibida, orden.currencyCode)}</div>
                                  </div>
                                );
                              })}
                              <div className="fac-det__total">
                                <span>Total factura</span>
                                <span className="fac-det__num">{money(r.total, orden.currencyCode)}</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Historial</h3>
      <Card><Timeline entidad="orden" idEntidad={orden.id} /></Card>
    </main>
  );
}
