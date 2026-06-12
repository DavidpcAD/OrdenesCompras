"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Card, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { CRC, formatDate } from "@/lib/helpers";

export default function ArchivoPage() {
  const { ordenes, recepciones, proveedores } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);
  const completadas = ordenes.filter((o) => o.estado === "completado");

  return (
    <AppShell role="facturacion">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Archivo y recepciones</h1>
            <p className="ds-muted">Órdenes recibidas al 100% y todas las facturas registradas.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={recepciones.length} label="Facturas registradas" accent="var(--ds-color-green-100)" />
          <Tile value={completadas.length} label="Órdenes completadas" accent="var(--ds-color-green-200)" />
          <Tile value={CRC.format(recepciones.reduce((s, r) => s + r.total, 0))} label="Total facturado" accent="var(--ds-color-gray-300)" />
          <Tile value={recepciones.filter((r) => r.parcial).length} label="Entregas parciales" accent="var(--ds-color-yellow)" />
        </div>

        <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Facturas registradas</h3>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Factura</th><th>Orden</th><th>Proveedor</th><th>Fecha registro</th><th className="ds-num">Total</th><th>Tipo</th></tr></thead>
              <tbody>
                {recepciones.length === 0 && <tr><td colSpan={6}><div className="empty">Sin facturas registradas.</div></td></tr>}
                {recepciones.map((r) => {
                  const o = ordenes.find((x) => x.id === r.ordenId);
                  return (
                    <tr key={r.id} className={o ? "is-clickable" : ""} onClick={() => o && router.push(`/proveeduria/ordenes/${o.id}`)}>
                      <td className="ds-strong">{r.numeroFactura}</td>
                      <td>{o?.numero ?? "—"}</td>
                      <td>{o ? prov(o.proveedorId)?.nombre : "—"}</td>
                      <td>{formatDate(r.fechaRegistro)}</td>
                      <td className="ds-num">{CRC.format(r.total)}</td>
                      <td>{r.parcial ? <Badge tone="yellow">Parcial</Badge> : <Badge tone="green">Completa</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </AppShell>
  );
}
