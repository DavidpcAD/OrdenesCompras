"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Badge, Card, EmptyState, Tile } from "@/components/ui";
import { IconEdit, IconReceipt, IconBox } from "@/components/icons";
import { useStore } from "@/lib/store";
import { money, formatDate } from "@/lib/helpers";
import type { MotivoNC } from "@/lib/types";

const MOTIVO: Record<MotivoNC, { label: string; tone: string }> = {
  precio_distinto: { label: "Precio distinto", tone: "yellow" },
  menos_cantidad: { label: "Menos cantidad", tone: "yellow" },
  danado: { label: "Material dañado", tone: "red" },
};

// Notas de crédito (Bodega · Kattya): líneas de facturas recibidas marcadas con
// problema (dañado / menos cantidad / precio distinto) para emitir una NC.
// Distinto de Devoluciones (que devuelve toda la OC/pedido).
export default function NotasCreditoPage() {
  const { notasCredito, cargarNotasCredito, recepciones } = useStore();
  useEffect(() => { cargarNotasCredito(); /* eslint-disable-next-line */ }, []);

  const pend = useMemo(() => notasCredito.filter((n) => n.estado !== "resuelta"), [notasCredito]);
  const grupos = useMemo(() => {
    const m = new Map<string, { ordenId: string; ordenNumero: string; proveedor?: string; bcUrl?: string; bcFacturaUrl?: string; lineas: typeof pend }>();
    for (const n of pend) {
      if (!m.has(n.ordenId)) m.set(n.ordenId, { ordenId: n.ordenId, ordenNumero: n.ordenNumero, proveedor: n.proveedor, bcUrl: n.bcUrl, bcFacturaUrl: n.bcFacturaUrl, lineas: [] });
      m.get(n.ordenId)!.lineas.push(n);
    }
    return [...m.values()].sort((a, b) => (b.lineas[0]?.fecha || "").localeCompare(a.lineas[0]?.fecha || ""));
  }, [pend]);

  const totalNC = pend.reduce((s, n) => s + (n.precioUnitario ?? 0) * n.cantidad, 0);

  return (
    <>
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Notas de crédito</h1>
            <p className="ds-muted">Líneas de facturas recibidas con problema (dañado, menos cantidad o precio distinto) para emitir la nota de crédito al proveedor. Se marcan al recibir la factura.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={pend.length} label="Líneas por acreditar" accent="var(--ds-color-red-100)" />
          <Tile value={grupos.length} label="Órdenes afectadas" accent="var(--ds-color-yellow)" />
          <Tile value={money(totalNC)} label="Monto estimado" accent="var(--ds-color-gray-300)" />
        </div>

        {grupos.length === 0 ? (
          <Card className="mt-6"><EmptyState icon={<IconEdit size={24} />} title="No hay líneas para nota de crédito." hint={<>Al registrar una factura en <strong>Por recibir</strong>, marcá las líneas que vengan mal (precio, cantidad o dañadas) y aparecen acá.</>} /></Card>
        ) : (
          <div className="col gap-4 mt-6">
            {grupos.map((g, gi) => {
              // "Orden de compra" solo si hubo ENTREGAS PARCIALES (varias recepciones
              // o alguna parcial). Si se recibió todo de una, va solo "Factura registrada".
              const recs = recepciones.filter((r) => r.ordenId === g.ordenId);
              const huboParciales = recs.length > 1 || recs.some((r) => r.parcial);
              return (
              <Card key={gi} style={{ padding: 0, overflow: "hidden" }}>
                <div className="nc-grp-head">
                  <span className="ds-strong">{g.ordenNumero || "— sin orden"}{g.proveedor ? <span className="ds-muted"> · {g.proveedor}</span> : null}</span>
                  <span className="row gap-3 wrap" style={{ alignItems: "center" }}>
                    <span className="ds-body-sm ds-muted">{g.lineas.length} línea(s)</span>
                    {g.bcFacturaUrl && (
                      <a href={g.bcFacturaUrl} target="_blank" rel="noopener noreferrer" className="nc-linkbtn nc-linkbtn--primary" title="Ver la factura registrada en Business Central (para hacer la nota de crédito)">
                        <IconReceipt size={16} /> Factura registrada
                        <svg className="nc-linkbtn__ext" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7M9 7h8v8" /></svg>
                      </a>
                    )}
                    {huboParciales && g.bcUrl && (
                      <a href={g.bcUrl} target="_blank" rel="noopener noreferrer" className="nc-linkbtn" title="Hubo entregas parciales: ver la orden de compra en Business Central">
                        <IconBox size={16} /> Orden de compra
                        <svg className="nc-linkbtn__ext" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7M9 7h8v8" /></svg>
                      </a>
                    )}
                    {!g.bcFacturaUrl && !g.bcUrl && <Link href={`/facturacion/ver/${g.ordenId}`} className="nc-linkbtn">Ver orden</Link>}
                  </span>
                </div>
                <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
                  <table className="ds-table">
                    <thead><tr><th>Material</th><th>Motivo</th><th className="ds-num">Cantidad</th><th className="ds-num">Precio unit.</th><th className="ds-num">Importe</th><th>Fecha</th></tr></thead>
                    <tbody>
                      {g.lineas.map((n) => {
                        const mo = MOTIVO[n.motivo] ?? { label: n.motivo, tone: "gray" };
                        return (
                          <tr key={n.id}>
                            <td><span className="ds-strong ds-body-sm">{n.articuloNo ? `${n.articuloNo} · ` : ""}</span>{n.descripcion}</td>
                            <td><Badge tone={mo.tone}>{mo.label}</Badge></td>
                            <td className="ds-num">{n.cantidad}</td>
                            <td className="ds-num">{n.precioUnitario != null ? money(n.precioUnitario) : "—"}</td>
                            <td className="ds-num ds-strong">{n.precioUnitario != null ? money(n.precioUnitario * n.cantidad) : "—"}</td>
                            <td className="ds-body-sm ds-muted">{formatDate(n.fecha)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
