"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Card, EmptyState, Input, Tile } from "@/components/ui";
import { IconCheck, IconChevronDown } from "@/components/icons";
import { FotosFactura } from "@/components/fotos-factura";
import { useStore } from "@/lib/store";
import { money, formatDate, todayISO, numeroOrden } from "@/lib/helpers";

// Bodega (recibe): historial de lo que se recibió, con quién lo recibió.
// Pensada para celular/tablet: tarjetas grandes, sin tablas anchas.
export default function RecibidasPage() {
  const { recepciones, ordenes, proveedores, notasCredito, cargarNotasCredito } = useStore();
  // Las notas de crédito las marca Bodega al recibir (por defecto sin marcar).
  // Las cargamos para etiquetar cada recepción como "Factura OK" o "Nota de crédito".
  useEffect(() => { cargarNotasCredito(); /* eslint-disable-next-line */ }, []);
  // Qué tarjetas tienen las líneas desplegadas (permite varias abiertas a la vez).
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const toggleLineas = (id: string) =>
    setAbiertas((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const ordenDe = (ordenId: string) => ordenes.find((o) => o.id === ordenId);
  const provNombre = (ordenId: string) => {
    const o = ordenDe(ordenId);
    return (o ? (o.proveedorNombre ?? proveedores.find((p) => p.id === o.proveedorId)?.nombre) : "") ?? "—";
  };

  // Buscador: la lista solo crece, y para conciliar una factura hay que poder
  // encontrarla por su número (o por orden / proveedor) sin scrollear todo.
  const [q, setQ] = useState("");
  // Recepciones con material recibido (registradas o en revisión), más nuevas primero.
  const todas = useMemo(
    () => [...recepciones].sort((a, b) => (b.fechaRecepcion || "").localeCompare(a.fechaRecepcion || "")),
    [recepciones]
  );
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return todas;
    return todas.filter((r) => {
      const o = ordenes.find((x) => x.id === r.ordenId);
      const prov = o ? (o.proveedorNombre ?? proveedores.find((p) => p.id === o.proveedorId)?.nombre ?? "") : "";
      // Se busca por lo que se VE (el rótulo o el N.º de BC) y también por el CP-
      // interno crudo, que es el que anda en correos y en la bitácora.
      return [r.numeroFactura, r.bcFacturaNo, o ? numeroOrden(o) : "", o?.numero, o?.bcNumber, prov, formatDate(r.fechaRecepcion)]
        .some((v) => (v ?? "").toLowerCase().includes(t));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todas, q, ordenes, proveedores]);
  // `new Date().toISOString()` da la fecha UTC: en CR (UTC−6), después de las 6pm
  // ya es el día siguiente y el contador "Este mes" cambiaba de mes antes de tiempo.
  const hoy = todayISO();
  const delMes = todas.filter((r) => (r.fechaRecepcion || "").slice(0, 7) === hoy.slice(0, 7)).length;

  return (
    <>
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Recibidas</h1>
            <p className="ds-muted">Material que ya recibiste en bodega. Queda registrado quién lo recibió.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={todas.length} label="Recepciones" accent="var(--ds-color-green-100)" />
          <Tile value={delMes} label="Este mes" accent="var(--ds-color-yellow)" />
          <Tile value={new Set(todas.map((r) => r.ordenId)).size} label="Órdenes" accent="var(--ds-color-gray-300)" />
        </div>

        <div className="mt-4">
          <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar recepción"
            placeholder="Buscar por N.º de factura, orden o proveedor…" />
          {q.trim() !== "" && (
            <p className="ds-body-sm ds-muted" style={{ margin: "6px 0 0" }} role="status">
              {lista.length} de {todas.length} recepción(es)
            </p>
          )}
        </div>

        {lista.length === 0 ? (
          <Card className="mt-6">
            {q.trim() !== ""
              ? <EmptyState icon={<IconCheck size={24} />} title="Ninguna recepción coincide con la búsqueda." hint={<>Probá con el N.º de factura, el de orden o el proveedor.</>} />
              : <EmptyState icon={<IconCheck size={24} />} title="Todavía no recibiste material." hint={<>Cuando registres una recepción en <strong>Órdenes por recibir</strong>, aparece acá.</>} />}
          </Card>
        ) : (
          <div className="col gap-3 mt-6">
            {lista.map((r) => {
              const o = ordenDe(r.ordenId);
              const enRevision = !!r.facturaEnRevision || !r.numeroFactura;
              const unidades = r.lineas.reduce((s, l) => s + (Number(l.cantidadRecibida) || 0), 0);
              // Totales tal cual BC (precio del pedido, con descuento e IVA por línea).
              const tot = r.lineas.reduce((acc, rl) => {
                const ol = o?.lineas.find((l) => l.id === rl.ordenLineaId);
                const base = (ol?.precioUnitario ?? 0) * (Number(rl.cantidadRecibida) || 0) * (1 - (ol?.descuentoPct ?? 0) / 100);
                acc.subtotal += base;
                acc.iva += base * ((ol?.ivaPct ?? 0) / 100);
                return acc;
              }, { subtotal: 0, iva: 0 });
              const total = tot.subtotal + tot.iva;
              // ¿Marcada para nota de crédito? La marca Bodega al recibir (línea a línea).
              const lineIds = new Set(r.lineas.map((l) => l.ordenLineaId));
              const tieneNC = notasCredito.some((nc) => String(nc.ordenId) === String(o?.id ?? "") && (!nc.ordenLineaId || lineIds.has(nc.ordenLineaId)));
              return (
                <Card key={r.id} className="rec-card">
                  <div className="row row--between wrap gap-2" style={{ alignItems: "flex-start" }}>
                    <div className="col" style={{ gap: 3, minWidth: 0 }}>
                      <span className="ds-strong" style={{ fontSize: "var(--ds-font-size-subtitle)" }}>{o ? numeroOrden(o) : "—"}</span>
                      <span className="ds-body-sm ds-muted ds-truncate">{provNombre(r.ordenId)}</span>
                    </div>
                    <div className="row gap-2 wrap" style={{ justifyContent: "flex-end" }}>
                      {r.parcial ? <Badge tone="yellow">Parcial</Badge> : <Badge tone="green">Completa</Badge>}
                      {enRevision ? <Badge tone="gray">Factura en revisión</Badge> : tieneNC ? <Badge tone="red">Nota de crédito</Badge> : <Badge tone="green">Factura OK</Badge>}
                      {!!r.fotos?.length && <Badge tone="gray">Con foto</Badge>}
                    </div>
                  </div>
                  <div className="row wrap gap-4 mt-3" style={{ alignItems: "center" }}>
                    <span className="col" style={{ gap: 1 }}>
                      <span className="ds-label ds-muted">Recibido</span>
                      <span className="ds-body-sm ds-strong">{formatDate(r.fechaRecepcion)}</span>
                    </span>
                    <span className="col" style={{ gap: 1 }}>
                      <span className="ds-label ds-muted">Recibido por</span>
                      <span className="ds-body-sm ds-strong">{r.recibidoPor || "—"}</span>
                    </span>
                    <span className="col" style={{ gap: 1 }}>
                      <span className="ds-label ds-muted">Líneas</span>
                      <span className="ds-body-sm ds-strong">{r.lineas.length} · {unidades} und</span>
                    </span>
                    <span className="col" style={{ gap: 1, marginLeft: "auto", textAlign: "right" }}>
                      <span className="ds-label ds-muted">Total {enRevision ? "(est.)" : "(con IVA)"}</span>
                      <span className="ds-body-sm ds-strong">{money(total)}</span>
                    </span>
                    <span className="col" style={{ gap: 1, textAlign: "right" }}>
                      <span className="ds-label ds-muted">Factura</span>
                      <span className="ds-body-sm ds-strong">{r.numeroFactura || "—"}</span>
                    </span>
                    {/* N.º del documento que quedó registrado EN BC. Es el que sirve
                        para encontrar el movimiento allá, y antes solo aparecía unos
                        segundos en el aviso al registrar. Solo está en las recepciones
                        posteriores a la migración (sql/recepcion_bc_factura.sql), así
                        que si no hay número no se muestra la columna vacía. */}
                    {r.bcFacturaNo && (
                      <span className="col" style={{ gap: 1, textAlign: "right" }}>
                        <span className="ds-label ds-muted">En BC</span>
                        <span className="ds-body-sm ds-strong" style={{ userSelect: "all" }}>{r.bcFacturaNo}</span>
                      </span>
                    )}
                  </div>
                  {(() => {
                    const open = abiertas.has(r.id);
                    return (
                      <>
                        <button type="button" className="rec-card__toggle" onClick={() => toggleLineas(r.id)} aria-expanded={open}>
                          <IconChevronDown size={16} className={`rec-card__chev${open ? " is-open" : ""}`} />
                          {open ? "Ocultar detalle" : r.fotos?.length ? `Ver factura y líneas (${r.lineas.length})` : `Ver líneas (${r.lineas.length})`}
                        </button>
                        {open && (
                          <div className="rec-lines">
                            {/* La foto de la factura física, si Bodega la adjuntó al
                                recibir: se abre grande al tocarla. */}
                            {!!r.fotos?.length && (
                              <div className="rec-fotos">
                                <span className="ds-label ds-muted">Foto de la factura {r.numeroFactura ? `${r.numeroFactura}` : ""}</span>
                                <FotosFactura recepcionId={r.id} fotos={r.fotos} compacto />
                              </div>
                            )}
                            <div className="rec-lines__scroll">
                              <div className="rec-line rec-line--head">
                                <span>Artículo</span>
                                <span className="ds-num">Cant.</span>
                                <span className="ds-num">P. unit · BC</span>
                                <span className="ds-num">IVA</span>
                                <span className="ds-num">Importe</span>
                              </div>
                              {r.lineas.map((rl, i) => {
                                const ol = o?.lineas.find((l) => l.id === rl.ordenLineaId);
                                // Precio TAL CUAL viaja a BC = directUnitCost = precioUnitario de la
                                // línea de la orden (la factura NO manda precio; BC usa el del pedido).
                                const precio = ol?.precioUnitario ?? 0;
                                const desc = ol?.descuentoPct ?? 0;
                                const cant = Number(rl.cantidadRecibida) || 0;
                                const importe = precio * cant * (1 - desc / 100); // Line Amount Excl. VAT
                                return (
                                  <div key={i} className="rec-line">
                                    <span className="rec-line__desc">
                                      {(ol?.articuloId || ol?.tipo === "cargo") && <span className="rec-line__code">{ol?.articuloId || (ol?.chargeNo ?? "CARGO")}</span>}
                                      <span className="rec-line__name" title={ol?.descripcion ?? "Línea"}>{ol?.descripcion ?? "Línea"}</span>
                                      {desc > 0 && <span className="rec-line__meta">Desc. {desc}%</span>}
                                    </span>
                                    <span className="rec-line__qty ds-num">{cant} {ol?.unidad ?? "und"}</span>
                                    <span className="rec-line__price ds-num">{money(precio)}</span>
                                    <span className="rec-line__iva ds-num ds-muted">{ol?.ivaPct ?? 0}%</span>
                                    <span className="rec-line__amt ds-num">{money(importe)}</span>
                                  </div>
                                );
                              })}
                            </div>
                            {/* Totales de la recepción (mismo formato que la pantalla de recibir). */}
                            <div className="rec-totals">
                              <div className="rec-totals__row"><span className="ds-muted">Subtotal recibido</span><span className="ds-num">{money(tot.subtotal)}</span></div>
                              <div className="rec-totals__row"><span className="ds-muted">IVA</span><span className="ds-num">{money(tot.iva)}</span></div>
                              <div className="rec-totals__row rec-totals__row--grand"><span>Total {enRevision ? "estimado" : "factura (con IVA)"}</span><span className="ds-num">{money(total)}</span></div>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
