"use client";

import { useEffect, useMemo } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Card, Tile } from "@/components/ui";
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
  const { notasCredito, cargarNotasCredito } = useStore();
  useEffect(() => { cargarNotasCredito(); /* eslint-disable-next-line */ }, []);

  const pend = useMemo(() => notasCredito.filter((n) => n.estado !== "resuelta"), [notasCredito]);
  const grupos = useMemo(() => {
    const m = new Map<string, { ordenNumero: string; proveedor?: string; lineas: typeof pend }>();
    for (const n of pend) {
      if (!m.has(n.ordenId)) m.set(n.ordenId, { ordenNumero: n.ordenNumero, proveedor: n.proveedor, lineas: [] });
      m.get(n.ordenId)!.lineas.push(n);
    }
    return [...m.values()].sort((a, b) => (b.lineas[0]?.fecha || "").localeCompare(a.lineas[0]?.fecha || ""));
  }, [pend]);

  const totalNC = pend.reduce((s, n) => s + (n.precioUnitario ?? 0) * n.cantidad, 0);

  return (
    <AppShell role="contabilidad">
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
          <Card className="mt-6"><div className="empty" style={{ lineHeight: 1.6 }}>No hay líneas para nota de crédito.<br /><span className="ds-muted ds-body-sm">Al registrar una factura en <strong>Por recibir</strong>, marcá las líneas que vengan mal (precio, cantidad o dañadas) y aparecen acá.</span></div></Card>
        ) : (
          <div className="col gap-4 mt-6">
            {grupos.map((g, gi) => (
              <Card key={gi} style={{ padding: 0, overflow: "hidden" }}>
                <div className="row row--between wrap gap-3" style={{ padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)" }}>
                  <span className="ds-strong">{g.ordenNumero}{g.proveedor ? <span className="ds-muted"> · {g.proveedor}</span> : null}</span>
                  <span className="ds-body-sm ds-muted">{g.lineas.length} línea(s)</span>
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
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
