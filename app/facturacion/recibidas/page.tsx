"use client";

import { useMemo } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Card, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { money, formatDate } from "@/lib/helpers";

// Bodega (recibe): historial de lo que se recibió, con quién lo recibió.
// Pensada para celular/tablet: tarjetas grandes, sin tablas anchas.
export default function RecibidasPage() {
  const { recepciones, ordenes, proveedores } = useStore();
  const ordenDe = (ordenId: string) => ordenes.find((o) => o.id === ordenId);
  const provNombre = (ordenId: string) => {
    const o = ordenDe(ordenId);
    return (o ? (o.proveedorNombre ?? proveedores.find((p) => p.id === o.proveedorId)?.nombre) : "") ?? "—";
  };

  // Recepciones con material recibido (registradas o en revisión), más nuevas primero.
  const lista = useMemo(
    () => [...recepciones].sort((a, b) => (b.fechaRecepcion || "").localeCompare(a.fechaRecepcion || "")),
    [recepciones]
  );
  const hoy = new Date().toISOString().slice(0, 10);
  const delMes = lista.filter((r) => (r.fechaRecepcion || "").slice(0, 7) === hoy.slice(0, 7)).length;

  return (
    <AppShell role="facturacion">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Recibidas</h1>
            <p className="ds-muted">Material que ya recibiste en bodega. Queda registrado quién lo recibió.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={lista.length} label="Recepciones" accent="var(--ds-color-green-100)" />
          <Tile value={delMes} label="Este mes" accent="var(--ds-color-yellow)" />
          <Tile value={new Set(lista.map((r) => r.ordenId)).size} label="Órdenes" accent="var(--ds-color-gray-300)" />
        </div>

        {lista.length === 0 ? (
          <Card className="mt-6"><div className="empty" style={{ lineHeight: 1.6 }}>Todavía no recibiste material.<br /><span className="ds-muted ds-body-sm">Cuando registres una recepción en <strong>Órdenes por recibir</strong>, aparece acá.</span></div></Card>
        ) : (
          <div className="col gap-3 mt-6">
            {lista.map((r) => {
              const o = ordenDe(r.ordenId);
              const enRevision = !!r.facturaEnRevision || !r.numeroFactura;
              const unidades = r.lineas.reduce((s, l) => s + (Number(l.cantidadRecibida) || 0), 0);
              return (
                <Card key={r.id} className="rec-card">
                  <div className="row row--between wrap gap-2" style={{ alignItems: "flex-start" }}>
                    <div className="col" style={{ gap: 3, minWidth: 0 }}>
                      <span className="ds-strong" style={{ fontSize: "var(--ds-font-size-subtitle)" }}>{o?.numero ?? "—"}</span>
                      <span className="ds-body-sm ds-muted ds-truncate">{provNombre(r.ordenId)}</span>
                    </div>
                    {enRevision ? <Badge tone="yellow">En revisión</Badge> : (r.parcial ? <Badge tone="yellow">Parcial</Badge> : <Badge tone="green">Completa</Badge>)}
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
                      <span className="ds-label ds-muted">{enRevision ? "Total est." : "Factura"}</span>
                      <span className="ds-body-sm ds-strong">{r.numeroFactura || "—"}</span>
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}
