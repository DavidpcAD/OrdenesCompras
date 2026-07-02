"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Card, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { money, formatDate } from "@/lib/helpers";

export default function ArchivoPage() {
  const { ordenes, recepciones, proveedores } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);
  const completadas = ordenes.filter((o) => o.estado === "completado");

  const [colF, setColF] = useState<Record<string, string>>({});
  const setCol = (k: string, v: string) => setColF((f) => ({ ...f, [k]: v }));
  const COLS = ["factura", "orden", "proveedor", "fecha", "total", "tipo"];
  const cellText = (r: typeof recepciones[number], k: string): string => {
    const o = ordenes.find((x) => x.id === r.ordenId);
    switch (k) {
      case "factura": return r.numeroFactura;
      case "orden": return o?.numero ?? "";
      case "proveedor": return (o ? (o.proveedorNombre ?? prov(o.proveedorId)?.nombre) : "") ?? "";
      case "fecha": return formatDate(r.fechaRegistro);
      case "total": return money(r.total, o?.currencyCode);
      case "tipo": return r.parcial ? "Parcial" : "Completa";
      default: return "";
    }
  };
  const filtradas = recepciones.filter((r) => COLS.every((k) => { const v = (colF[k] ?? "").trim().toLowerCase(); return !v || cellText(r, k).toLowerCase().includes(v); }));

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
          <Tile value={money(recepciones.reduce((s, r) => s + r.total, 0))} label="Total facturado" accent="var(--ds-color-gray-300)" />
          <Tile value={recepciones.filter((r) => r.parcial).length} label="Entregas parciales" accent="var(--ds-color-yellow)" />
        </div>

        <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Facturas registradas</h3>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr><th>Factura</th><th>Orden</th><th>Proveedor</th><th>Fecha registro</th><th className="ds-num">Total</th><th>Tipo</th></tr>
                <tr>
                  {COLS.map((k) => (
                    <th key={k} style={{ padding: "4px 6px", fontWeight: 400 }}>
                      <input value={colF[k] ?? ""} placeholder="Filtrar…" onChange={(e) => setCol(k, e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, padding: "4px 8px", fontSize: 12, font: "inherit", border: "1.5px solid var(--ds-color-gray-100)", background: "#fff", textAlign: k === "total" ? "right" : "left" }} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 && <tr><td colSpan={6}><div className="empty">{recepciones.length ? "Ninguna factura coincide con los filtros." : "Sin facturas registradas."}</div></td></tr>}
                {filtradas.map((r) => {
                  const o = ordenes.find((x) => x.id === r.ordenId);
                  return (
                    <tr key={r.id} className="is-clickable" onClick={() => router.push(`/facturacion/recepcion/${r.id}`)}>
                      <td className="ds-strong">{r.numeroFactura}</td>
                      <td>{o?.numero ?? "—"}</td>
                      <td>{o ? (o.proveedorNombre ?? prov(o.proveedorId)?.nombre ?? "—") : "—"}</td>
                      <td>{formatDate(r.fechaRegistro)}</td>
                      <td className="ds-num">{money(r.total, o?.currencyCode)}</td>
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
