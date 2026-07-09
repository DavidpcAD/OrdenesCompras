"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Modal, Tile, useToast } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { money, formatDate } from "@/lib/helpers";
import type { Recepcion } from "@/lib/types";

const esEnRevision = (r: Recepcion) => !!r.facturaEnRevision || !r.numeroFactura;

export default function ArchivoPage() {
  const { ordenes, recepciones, proveedores, facturarRecepcion } = useStore();
  const router = useRouter();
  const toast = useToast();
  const prov = (id: string) => proveedores.find((p) => p.id === id);
  const ordenDe = (r: Recepcion) => ordenes.find((x) => x.id === r.ordenId);
  const completadas = ordenes.filter((o) => o.estado === "completado");

  const enRevision = recepciones.filter(esEnRevision);
  const registradas = recepciones.filter((r) => !esEnRevision(r));

  // Registrar la factura de una recepción que quedó en revisión.
  const [facObj, setFacObj] = useState<Recepcion | null>(null);
  const [numFac, setNumFac] = useState("");
  const [guardando, setGuardando] = useState(false);
  async function confirmarFactura() {
    const rec = facObj;
    if (!rec) return;
    if (!numFac.trim()) { toast("Ingresá el número de factura.", "error"); return; }
    const o = ordenDe(rec);
    const bcLineas = rec.lineas
      .filter((l) => Number(l.cantidadRecibida) > 0)
      .map((l) => ({ itemNo: o?.lineas.find((x) => x.id === l.ordenLineaId)?.articuloId ?? "", qty: l.cantidadRecibida }))
      .filter((x) => x.itemNo);
    setGuardando(true);
    let aviso = "";
    try {
      if (o?.bcNumber && bcLineas.length) {
        try {
          const r = await fetch("/api/bc/facturar-recibido", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderNo: o.bcNumber, vendorInvoiceNo: numFac.trim(), lineas: bcLineas }),
          });
          const d = await r.json().catch(() => ({}));
          aviso = r.ok ? ` · registrada en BC (${d.postedNo ?? "OK"})` : ` · NO se pudo registrar en BC: ${d.error ?? r.status}`;
        } catch (e: any) { aviso = ` · BC no disponible: ${String(e?.message ?? e)}`; }
      }
      await facturarRecepcion(rec.id, numFac.trim());
      const fallo = aviso.includes("NO se pudo") || aviso.includes("no disponible");
      toast(`Factura ${numFac} registrada${aviso}`, fallo ? "info" : "success");
      setFacObj(null); setNumFac("");
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
    } finally { setGuardando(false); }
  }

  const columns = useMemo<ColumnDef<Recepcion, any>[]>(() => [
    { id: "factura", header: "Factura", accessorFn: (r) => r.numeroFactura, meta: { label: "Factura" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "orden", header: "Orden", accessorFn: (r) => ordenDe(r)?.numero ?? "—", meta: { label: "Orden" }, cell: (c) => c.getValue() },
    { id: "proveedor", header: "Proveedor", accessorFn: (r) => { const o = ordenDe(r); return (o ? (o.proveedorNombre ?? prov(o.proveedorId)?.nombre) : "") ?? "—"; }, meta: { label: "Proveedor" }, cell: (c) => c.getValue() },
    { id: "fecha", header: "Fecha registro", accessorFn: (r) => r.fechaRegistro, meta: { label: "Fecha registro" }, cell: (c) => formatDate(c.getValue()) },
    { id: "total", header: "Total", accessorFn: (r) => r.total, meta: { label: "Total", num: true }, cell: (c) => money(c.getValue(), ordenDe(c.row.original)?.currencyCode) },
    { id: "tipo", header: "Tipo", accessorFn: (r) => (r.parcial ? "Parcial" : "Completa"), meta: { label: "Tipo" }, cell: (c) => c.row.original.parcial ? <Badge tone="yellow">Parcial</Badge> : <Badge tone="green">Completa</Badge> },
  ], [ordenes, proveedores]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppShell role="facturacion">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Archivo y recepciones</h1>
            <p className="ds-muted">Órdenes recibidas al 100% y todas las facturas registradas.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={registradas.length} label="Facturas registradas" accent="var(--ds-color-green-100)" />
          <Tile value={enRevision.length} label="Facturas en revisión" accent="var(--ds-color-red-100)" />
          <Tile value={completadas.length} label="Órdenes completadas" accent="var(--ds-color-green-200)" />
          <Tile value={money(registradas.reduce((s, r) => s + r.total, 0))} label="Total facturado" accent="var(--ds-color-gray-300)" />
        </div>

        {enRevision.length > 0 && (
          <Card className="mt-6" style={{ padding: 0, overflow: "hidden", boxShadow: "inset 3px 0 0 var(--ds-color-red-100), var(--ds-shadow-01)" }}>
            <div className="row row--between" style={{ padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)" }}>
              <span className="ds-subtitle" style={{ fontSize: "var(--ds-font-size-subtitle)" }}>Facturas en revisión</span>
              <span className="ds-body-sm ds-muted">Material recibido; falta registrar la factura</span>
            </div>
            <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
              <table className="ds-table">
                <thead><tr><th>Orden</th><th>Proveedor</th><th>Recibido</th><th className="ds-num">Total est.</th><th /></tr></thead>
                <tbody>
                  {enRevision.map((r) => {
                    const o = ordenDe(r);
                    return (
                      <tr key={r.id}>
                        <td className="ds-strong ds-body-sm">{o?.numero ?? "—"}</td>
                        <td className="ds-body-sm">{(o ? (o.proveedorNombre ?? prov(o.proveedorId)?.nombre) : "") ?? "—"}</td>
                        <td className="ds-body-sm ds-muted">{formatDate(r.fechaRecepcion)} · {r.lineas.length} línea(s)</td>
                        <td className="ds-num">{money(r.total, o?.currencyCode)}</td>
                        <td className="ds-num"><Button variant="red" size="sm" onClick={() => { setNumFac(""); setFacObj(r); }}>Registrar factura</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Facturas registradas</h3>
        <DataTable data={registradas} columns={columns} tablaKey="recepciones" getRowId={(r) => r.id} onRowClick={(r) => router.push(`/facturacion/recepcion/${r.id}`)} vacio="Sin facturas registradas." />

        {facObj && (
          <Modal title={`Registrar factura · ${ordenDe(facObj)?.numero ?? ""}`} onClose={() => setFacObj(null)}
            footer={<><Button variant="outline" onClick={() => setFacObj(null)}>Cancelar</Button><Button variant="red" onClick={confirmarFactura} disabled={!numFac.trim() || guardando}>{guardando ? "Registrando…" : "Registrar factura"}</Button></>}>
            <p className="ds-muted ds-body-sm" style={{ marginTop: 0 }}>El material ya se recibió. Registrá la factura del proveedor (se contabiliza en BC lo ya recibido).</p>
            <Field label="N.º de factura del proveedor">
              <Input value={numFac} onChange={(e) => setNumFac(e.target.value)} placeholder="Ej. F-0099281" />
            </Field>
          </Modal>
        )}
      </main>
    </AppShell>
  );
}
