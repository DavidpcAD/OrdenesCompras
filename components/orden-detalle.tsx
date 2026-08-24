"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import { IconChevronDown, IconWarning } from "@/components/icons";
import { OrderLinesTable } from "@/components/order-lines";
import { Timeline } from "@/components/timeline";
import { useStore } from "@/lib/store";
import { money, num, formatDate, ordenBadge, proveedorLabel, ordenLineaImporte, ordenRecibidoPct, ordenPedidos, ordenEsDirecta, numeroOrden } from "@/lib/helpers";
import { ChipPedido } from "@/components/ordenes-lista";
import { useVolver } from "@/lib/use-volver";
import type { Orden } from "@/lib/types";

// Vista de detalle de una orden, reutilizada por Proveeduría, Aprobación y Bodega.
// `acciones` son los botones específicos de cada rol (aprobar, recibir, etc.).
export function OrdenDetalle({
  orden,
  volverHref,
  volverLabel = "Volver",
  acciones,
  solicitudHref,
  pedidoHref,
  aviso,
}: {
  orden: Orden;
  volverHref: string;
  volverLabel?: string;
  acciones?: React.ReactNode;
  solicitudHref?: (l: Orden["lineas"][number]) => string | null;
  // Link por N.º de solicitud (los chips del encabezado). Igual que en la lista: lo
  // arma la página, porque la ruta depende del rol.
  pedidoHref?: (numeroPedido: string) => string | null;
  // Aviso que tiene que QUEDARSE en pantalla (no un toast que se desvanece): p. ej.
  // "se reabrió acá pero en BC sigue Lanzado". Si eso se pierde, la orden queda
  // descuadrada con BC y nadie se enteró.
  aviso?: React.ReactNode;
}) {
  const { proveedores, recepciones } = useStore();
  const router = useRouter();
  const [verFactura, setVerFactura] = useState<string | null>(null);
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

  const prov = proveedores.find((p) => p.id === orden.proveedorId);
  const b = ordenBadge(orden.estado);
  // Volver = pantalla anterior (con su filtro), no una ruta fija.
  const { volver, etiqueta: volverTexto } = useVolver(volverHref, volverLabel);
  const peds = ordenPedidos(orden);
  const esDirecta = ordenEsDirecta(orden);
  const recs = recepciones.filter((r) => r.ordenId === orden.id);
  const subtotal = orden.lineas.filter((l) => l.tipo === "articulo").reduce((s, l) => s + ordenLineaImporte(l), 0);
  const iva = orden.lineas.filter((l) => l.tipo === "articulo").reduce((s, l) => s + ordenLineaImporte(l) * ((l.ivaPct || 0) / 100), 0);
  const flete = orden.lineas.filter((l) => l.tipo === "cargo").reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
  // El PDF para el proveedor solo se habilita cuando la orden fue APROBADA (Lanzada
  // en BC) — o ya completada. Antes de eso no debe enviarse nada al proveedor.
  const puedeImprimir = orden.estado === "lanzado" || orden.estado === "completado";

  return (
    <main className="page">
      <button type="button" className="back-link" onClick={volver}>{volverTexto}</button>
      <div className="page__head">
        <div className="page__title">
          <div className="row gap-3">
            <h1 className="ds-heading">{numeroOrden(orden)}</h1>
            <Badge tone={b.tone}>{b.label}</Badge>
            {esDirecta && <Badge tone="yellow">Directa</Badge>}
          </div>
          <p className="ds-muted">{orden.proveedorNo ?? prov?.code} · {proveedorLabel(orden, proveedores)} · emitida {formatDate(orden.fecha)} · recibido {ordenRecibidoPct(orden)}%{numeroOrden(orden) !== orden.numero ? ` · interno ${orden.numero}` : " · todavía no está en BC"}</p>
          {orden.almacenRecepcion && <p className="ds-body-sm ds-muted">Recepción en almacén <span className="ds-strong">{orden.almacenRecepcion}</span></p>}
          <div className="row gap-2 wrap mt-2">
            {esDirecta ? (
              <span className="ds-muted ds-body-sm">Compra directa · sin solicitud de origen</span>
            ) : (
              <>
                <span className="ds-muted ds-body-sm">Solicitudes origen:</span>
                {peds.map((n) => <ChipPedido key={n} numero={n} href={pedidoHref?.(n) ?? null} />)}
              </>
            )}
          </div>
        </div>
        <div className="row gap-3">
          <Button variant="outline" size="sm" disabled={!puedeImprimir}
            title={puedeImprimir ? "Ver y descargar el PDF para el proveedor" : "El PDF para el proveedor se habilita cuando la orden esté aprobada (Lanzada)."}
            onClick={() => { if (puedeImprimir) router.push(`/proveeduria/ordenes/${orden.id}/imprimir`); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" rx="1" /></svg>
            Imprimir
          </Button>
          {orden.bcDeepLink && (
            <button className="link-btn" title="Abrir el Pedido en Business Central (editar · vista previa de registro · registrar)"
              onClick={() => window.open(orden.bcDeepLink!, "_blank")}>↗ Abrir en BC</button>
          )}
          {acciones}
        </div>
      </div>

      {aviso}

      {/* Orden rechazada por Aprobación: el motivo se muestra arriba de las líneas
          para que Proveeduría sepa qué corregir antes de reenviarla. */}
      {orden.estado === "rechazado" && (
        <div className="ds-callout ds-callout--red mb-4" role="status">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div>
            <div className="ds-callout__title">Aprobación rechazó esta orden</div>
            <div className="ds-callout__body">
              {orden.motivoRechazo
                ? <>Motivo: <span className="ds-strong">{orden.motivoRechazo}</span></>
                : "No se registró un motivo. Revisá el historial al pie o consultá con Aprobación."}
            </div>
          </div>
        </div>
      )}

      {/* Observaciones para el proveedor: se imprimen en el PDF, así que hay que
          poder verlas (y notar que están) sin abrir la vista de impresión. */}
      {orden.observaciones?.trim() && (
        <Card flat className="mb-4">
          <div className="col" style={{ gap: 4 }}>
            <span className="ds-label ds-muted">Observaciones para el proveedor · salen en el PDF</span>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{orden.observaciones.trim()}</p>
          </div>
        </Card>
      )}

      {/* Comentario interno para quien aprueba. Va en una tarjeta aparte y con otro
          color para que nadie lo confunda con lo que lee el proveedor. */}
      {orden.notaInterna?.trim() && (
        <Card flat className="mb-4" style={{ background: "color-mix(in srgb, var(--ds-color-yellow) 8%, var(--ds-tint-base))" }}>
          <div className="col" style={{ gap: 4 }}>
            <span className="ds-label ds-muted">Comentario para el aprobador · interno, no sale en el PDF</span>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{orden.notaInterna.trim()}</p>
          </div>
        </Card>
      )}

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
                        <td className="ds-num ds-muted">
                          <button type="button" className="fac-ver-btn" aria-expanded={abierto}
                            aria-label={`${abierto ? "Ocultar" : "Ver"} detalle de la factura ${r.numeroFactura}`}
                            onClick={(e) => { e.stopPropagation(); setVerFactura(abierto ? null : r.id); }}>
                            {abierto ? "ocultar" : "ver"}
                            <IconChevronDown size={16} style={{ transform: abierto ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
                          </button>
                        </td>
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
