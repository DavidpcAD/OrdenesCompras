"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Modal } from "@/components/ui";
import { LineasDeRecepcion } from "@/components/lineas-recepcion";
import { VersionesRecepcion } from "@/components/versiones-recepcion";
import { Timeline } from "@/components/timeline";
import { formatDate, lineasDeRecepcion, money, numeroOrden, ordenBadgeDe, ordenRecibidoPct, proveedorLabel } from "@/lib/helpers";
import type { EnvioARevision, Orden, Proveedor, Recepcion } from "@/lib/types";

// Lo que vale una recepción, sin y con IVA (el IVA de cada línea de la orden). Es el
// número que se compara contra el "Total" del papel antes de registrar. Cada línea se
// redondea al céntimo ANTES de sumar, como hace BC con el importe de línea: si no, con
// precios de 4 decimales el total se iba un céntimo del de BC.
export function totalesDeRecepcion(rec: Recepcion, orden?: Orden): { sub: number; iva: number; total: number } {
  if (!orden) return { sub: rec.total, iva: 0, total: rec.total };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  let sub = 0; let iva = 0;
  for (const { ol, importe } of lineasDeRecepcion(rec, orden)) {
    const linea = r2(importe);
    sub += linea;
    iva += linea * ((ol?.ivaPct ?? 0) / 100);
  }
  return { sub: r2(sub), iva: r2(iva), total: r2(sub + iva) };
}

type TotalesBc = { subtotal: number; iva: number; total: number; currencyCode?: string };

// EL PANEL DE LA ORDEN desde "Facturas en revisión": ver cómo está la orden antes de
// registrar su factura, sin salir de Archivo. Lo que se va a facturar (la recepción),
// lo que dice Business Central del pedido, las versiones de la recepción (precio
// corregido) y el historial de la orden.
export function PanelOrdenRevision({ rec, orden, proveedores, envio, onRegistrar, onClose }: {
  rec: Recepcion; orden?: Orden; proveedores: Proveedor[]; envio?: EnvioARevision;
  onRegistrar: () => void; onClose: () => void;
}) {
  const cur = orden?.currencyCode;
  const t = totalesDeRecepcion(rec, orden);
  // Los totales del PEDIDO en BC, para ver que dicen lo mismo que la app. Si la orden
  // tiene una sola recepción por todo, son los mismos números que los de arriba.
  const [bc, setBc] = useState<TotalesBc | null | "sin">(null);
  useEffect(() => {
    if (!orden?.bcNumber) { setBc("sin"); return; }
    let vivo = true;
    fetch(`/api/bc/orden-totales?orderNo=${encodeURIComponent(orden.bcNumber)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setBc(d?.totales ?? "sin"); })
      .catch(() => { if (vivo) setBc("sin"); });
    return () => { vivo = false; };
  }, [orden?.bcNumber]);
  const b = orden ? ordenBadgeDe(orden) : null;
  const titulo = orden ? `${numeroOrden(orden)} · ${proveedorLabel(orden, proveedores)}` : "Orden";
  const recibidoPor = rec.recibidoPor || envio?.enviadaPor;

  return (
    <Modal lado title={titulo} onClose={onClose} footer={
      <>
        <Button variant="outline" onClick={onClose}>Cerrar</Button>
        <Button variant="green" onClick={onRegistrar}>Registrar factura</Button>
      </>
    }>
      <div className="modal__cuerpo">
        {orden && (
          <div className="panel-orden__meta">
            <div className="row gap-2 wrap" style={{ alignItems: "center" }}>
              {b && <Badge tone={b.tone}>{b.label}</Badge>}
              <span className="ds-body-sm ds-muted">emitida {formatDate(orden.fecha)} · recibido {Math.round(ordenRecibidoPct(orden))}%</span>
            </div>
            <div className="ds-body-sm">
              Recibido el {formatDate(rec.fechaRecepcion)}{recibidoPor ? ` por ${recibidoPor}` : ""} · <span className="ds-strong">en revisión</span>
            </div>
            {envio?.motivo
              ? <div className="ds-body-sm"><span className="ds-muted">Fue a revisión por: </span>{envio.motivo}</div>
              : <div className="ds-body-sm ds-muted">Sin motivo anotado (se recibió antes de que la app lo pidiera).</div>}
            <div className="row gap-3 wrap">
              <Link className="chip-link" href={`/facturacion/ver/${orden.id}`} title="Abrir la pantalla completa de la orden">
                Abrir la orden completa<span className="chip-link__ir" aria-hidden>↗</span>
              </Link>
              {orden.bcDeepLink && (
                <a className="chip-link" href={orden.bcDeepLink} target="_blank" rel="noopener noreferrer" title={`Abrir el pedido ${numeroOrden(orden)} en Business Central`}>
                  Pedido en BC<span className="chip-link__ir" aria-hidden>↗</span>
                </a>
              )}
            </div>
          </div>
        )}

        <div className="panel-orden__caja">
          <LineasDeRecepcion rec={rec} orden={orden} />
        </div>

        {/* Los números que se comparan contra el papel: los de esta recepción, y al
            lado los del pedido en BC. */}
        <div className="panel-orden__totales">
          <div className="panel-orden__tot-col">
            <span className="ocl-top__ttl">Esta factura (app)</span>
            <div className="panel-orden__fila"><span className="ds-muted">Sin IVA</span><span className="ds-num">{money(t.sub, cur)}</span></div>
            <div className="panel-orden__fila"><span className="ds-muted">IVA</span><span className="ds-num">{money(t.iva, cur)}</span></div>
            <div className="panel-orden__fila panel-orden__fila--total"><span>Con IVA</span><span className="ds-num">{money(t.total, cur)}</span></div>
          </div>
          <div className="panel-orden__tot-col">
            <span className="ocl-top__ttl">Pedido en Business Central</span>
            {bc === null ? (
              <div className="ds-body-sm ds-muted">Leyendo BC…</div>
            ) : bc === "sin" ? (
              <div className="ds-body-sm ds-muted">No se pudo leer el pedido en BC ahora.</div>
            ) : (
              <>
                <div className="panel-orden__fila"><span className="ds-muted">Sin IVA</span><span className="ds-num">{money(bc.subtotal, cur)}</span></div>
                <div className="panel-orden__fila"><span className="ds-muted">IVA</span><span className="ds-num">{money(bc.iva, cur)}</span></div>
                <div className="panel-orden__fila panel-orden__fila--total"><span>Con IVA</span><span className="ds-num">{money(bc.total, cur)}</span></div>
                {Math.abs(bc.total - t.total) < 0.01
                  ? <div className="ds-body-sm panel-orden__ok">✓ Igual a la app</div>
                  : <div className="ds-body-sm ds-muted">El pedido incluye más que esta recepción (o falta algo por recibir).</div>}
              </>
            )}
          </div>
        </div>

        <VersionesRecepcion rec={rec} orden={orden} />

        {orden && (
          <section className="panel-orden__hist">
            <span className="ocl-top__ttl">Historial de la orden</span>
            <Timeline entidad="orden" idEntidad={orden.id} />
          </section>
        )}
      </div>
    </Modal>
  );
}
