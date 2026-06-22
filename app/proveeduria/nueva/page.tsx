"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Select, useToast } from "@/components/ui";
import { useStore } from "@/lib/store";
import { money, ultimoPrecioProveedor } from "@/lib/helpers";
import type { OrdenLinea } from "@/lib/types";

interface Row {
  pedidoNumero: string;
  pedidoLineaId: string;
  articuloId: string;
  descripcion: string;
  unidad: string;
  almacen: string;
  cantidad: string;
  precio: string;
  iva: string;
  descuento: string;
  proyecto: string;
  tarea: string;
}

export default function ArmarOrdenPage() {
  const { pedidos, proveedores, obras, ordenes, borrador, createOrden, setOrdenEstado, setBorrador } = useStore();
  const router = useRouter();
  const toast = useToast();

  const [proveedorId, setProveedorId] = useState("");
  const [currency, setCurrency] = useState("");
  const [flete, setFlete] = useState("");

  const [rows, setRows] = useState<Row[]>(() =>
    borrador.map((b) => {
      let info = { pedidoNumero: "", articuloId: "", descripcion: "", unidad: "", almacen: "", proyecto: "" };
      for (const p of pedidos) {
        const l = p.lineas.find((x) => x.id === b.pedidoLineaId);
        if (l) { info = { pedidoNumero: p.numero, articuloId: l.articuloId, descripcion: l.descripcion, unidad: l.unidad, almacen: l.almacen, proyecto: p.obraCodigo ?? "" }; break; }
      }
      return {
        pedidoLineaId: b.pedidoLineaId, ...info,
        cantidad: String(b.cantidad), precio: String(b.precio), iva: String(b.iva), descuento: "0", tarea: "",
      };
    })
  );

  useEffect(() => { if (borrador.length === 0) router.replace("/proveeduria"); }, [borrador, router]);

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.pedidoLineaId === id ? { ...r, ...patch } : r)));

  const calcImporte = (r: Row) => Number(r.cantidad) * Number(r.precio) * (1 - (Number(r.descuento) || 0) / 100);
  const subtotal = rows.reduce((s, r) => s + calcImporte(r), 0);
  const fleteShare = (r: Row) => (subtotal > 0 && (Number(flete) || 0) > 0 ? (Number(flete) || 0) * calcImporte(r) / subtotal : 0);
  const lastPrice = (r: Row) => (proveedorId ? ultimoPrecioProveedor(ordenes, r.articuloId, proveedorId) : null);
  const ivaTotal = rows.reduce((s, r) => s + calcImporte(r) * ((Number(r.iva) || 0) / 100), 0);
  const fleteNum = Number(flete) || 0;
  const total = subtotal + fleteNum + ivaTotal;
  const pedidosDistintos = [...new Set(rows.map((r) => r.pedidoNumero))];
  const puedeCrear = !!proveedorId && rows.length > 0;

  function elegirProveedor(id: string) {
    setProveedorId(id);
    const p = proveedores.find((x) => x.id === id);
    if (p) setCurrency(p.currencyCode ?? "");
  }

  const [guardando, setGuardando] = useState(false);

  async function crear(enviarAprobacion: boolean) {
    if (!puedeCrear) { toast("Seleccioná un proveedor.", "error"); return; }
    setGuardando(true);
    try {
    const ls: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = rows.map((r) => ({
      tipo: "articulo", articuloId: r.articuloId, pedidoLineaId: r.pedidoLineaId, pedidoNumero: r.pedidoNumero,
      descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen: r.almacen,
      precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0, descuentoPct: Number(r.descuento) || 0,
      proyecto: r.proyecto || undefined, taskNo: r.tarea || undefined,
    }));
    if (fleteNum > 0) {
      ls.push({ tipo: "cargo", descripcion: "FLETE / TRANSPORTE", cantidad: 1, unidad: "UND",
        almacen: rows[0].almacen, precioUnitario: fleteNum, ivaPct: 13 });
    }
    const orden = await createOrden({ proveedorId, currencyCode: currency, lineas: ls });
    if (enviarAprobacion) await setOrdenEstado(orden.id, "pendiente_aprobacion");
    setBorrador([]);
    toast(`Orden ${orden.numero} ${enviarAprobacion ? "enviada a aprobación" : "guardada como abierta"}`, "success");
    router.push(`/proveeduria/ordenes/${orden.id}`);
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  // Crea el Pedido en BC (proveedor + materiales) y abre BC para la vista previa/registro nativos.
  async function crearEnBc() {
    if (!puedeCrear) { toast("Seleccioná un proveedor.", "error"); return; }
    const p = proveedores.find((x) => x.id === proveedorId);
    const vendorNo = p?.code;
    if (!vendorNo) { toast("El proveedor no tiene código de BC.", "error"); return; }
    const lineasBc = rows
      .filter((r) => r.articuloId && Number(r.cantidad) > 0)
      .map((r) => ({ itemNo: r.articuloId, cantidad: Number(r.cantidad), precio: Number(r.precio) || 0, descripcion: r.descripcion }));
    if (!lineasBc.length) { toast("No hay líneas de material para enviar a BC.", "error"); return; }
    setGuardando(true);
    try {
      const res = await fetch("/api/bc/ordenes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorNo, currencyCode: currency, lineas: lineasBc }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "No se pudo crear el pedido en BC");
      // registramos también la orden local para el seguimiento de la app
      try {
        const ls: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = rows.map((r) => ({
          tipo: "articulo", articuloId: r.articuloId, pedidoLineaId: r.pedidoLineaId, pedidoNumero: r.pedidoNumero,
          descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen: r.almacen,
          precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0, descuentoPct: Number(r.descuento) || 0,
          proyecto: r.proyecto || undefined, taskNo: r.tarea || undefined,
        }));
        await createOrden({ proveedorId, currencyCode: currency, lineas: ls });
      } catch { /* el pedido ya está en BC; el registro local es secundario */ }
      setBorrador([]);
      toast(`Pedido ${data.number} creado en BC. Abriendo para vista previa…`, "success");
      if (data.deepLink) window.open(data.deepLink, "_blank");
      router.push("/proveeduria/ordenes");
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  return (
    <AppShell role="proveeduria">
      <main className="page page--wide" style={{ paddingBottom: 120 }}>
        <div className="back-link" onClick={() => router.push("/proveeduria")}>‹ Volver a materiales</div>
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Armar orden de compra</h1>
            <p className="ds-muted">Revisá y ajustá lo que se va a enviar al proveedor.</p>
          </div>
        </div>

        <Card>
          <h3 className="ds-subtitle" style={{ marginBottom: 16 }}>Datos de la orden</h3>
          <div className="grid-3">
            <Field label="Proveedor" help="Hereda términos y moneda">
              <Select value={proveedorId} onChange={(e) => elegirProveedor(e.target.value)}>
                <option value="">Seleccionar proveedor…</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Moneda">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="">CRC (colones)</option>
                <option value="USD">USD (dólares)</option>
              </Select>
            </Field>
            <Field label="Flete / transporte" help="Opcional, se distribuye al facturar">
              <Input type="number" min={0} value={flete} onChange={(e) => setFlete(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <div className="row gap-2 wrap mt-4">
            <span className="ds-muted ds-label">Solicitudes en esta orden:</span>
            {pedidosDistintos.map((n) => <Badge key={n} tone="gray">{n}</Badge>)}
          </div>
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Pedido</th><th>Artículo</th><th>Almacén</th>
                  <th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Desc%</th><th className="ds-num">IVA%</th>
                  <th>Proyecto</th><th>Tarea</th><th className="ds-num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.pedidoLineaId}>
                    <td className="ds-body-sm ds-strong">{r.pedidoNumero}</td>
                    <td><div className="ds-truncate" title={r.descripcion} style={{ maxWidth: 200 }}>{r.descripcion}</div></td>
                    <td className="ds-muted ds-body-sm">{r.almacen}</td>
                    <td className="ds-num"><input className="ds-cell-input" type="number" min={0} value={r.cantidad} style={{ width: 70 }} onChange={(e) => setRow(r.pedidoLineaId, { cantidad: e.target.value })} /></td>
                    <td className="ds-num">
                      <input className="ds-cell-input" type="number" min={0} value={r.precio} style={{ width: 92 }} onChange={(e) => setRow(r.pedidoLineaId, { precio: e.target.value })} />
                      {(() => {
                        const lp = lastPrice(r);
                        if (lp == null) return <div className="ds-body-sm ds-muted">sin historial</div>;
                        const up = Number(r.precio) > lp, down = Number(r.precio) < lp;
                        return <div className="ds-body-sm" style={{ color: up ? "var(--ds-color-red-200)" : down ? "var(--ds-color-green-200)" : "var(--ds-color-gray-400)" }}>
                          últ. {money(lp, currency)} {up ? "↑" : down ? "↓" : "="}
                        </div>;
                      })()}
                    </td>
                    <td className="ds-num"><input className="ds-cell-input" type="number" min={0} max={100} value={r.descuento} style={{ width: 64 }} onChange={(e) => setRow(r.pedidoLineaId, { descuento: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" type="number" min={0} value={r.iva} style={{ width: 64 }} onChange={(e) => setRow(r.pedidoLineaId, { iva: e.target.value })} /></td>
                    <td>
                      <select className="ds-form-field__select" style={{ borderRadius: 8, padding: "6px 10px", minWidth: 130, fontSize: 13 }}
                        value={r.proyecto} onChange={(e) => setRow(r.pedidoLineaId, { proyecto: e.target.value })}>
                        <option value="">—</option>
                        {obras.map((o) => <option key={o.id} value={o.codigo}>{o.codigo}</option>)}
                      </select>
                    </td>
                    <td><input className="ds-cell-input" value={r.tarea} placeholder="1.1" style={{ width: 64, textAlign: "left" }} onChange={(e) => setRow(r.pedidoLineaId, { tarea: e.target.value })} /></td>
                    <td className="ds-num ds-strong">
                      {money(calcImporte(r) || 0, currency)}
                      {fleteShare(r) > 0 && <div className="ds-body-sm ds-muted" style={{ fontWeight: 400 }}>+ flete {money(fleteShare(r), currency)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {fleteNum > 0 && (
                <tfoot>
                  <tr><td colSpan={10} className="ds-body-sm ds-muted" style={{ padding: "10px 16px", borderTop: "1.5px solid var(--ds-color-gray-100)" }}>
                    El flete de {money(fleteNum, currency)} se reparte proporcional al importe de cada línea (mostrado como “+ flete”).
                  </td></tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        <div className="row mt-6" style={{ justifyContent: "flex-end" }}>
          <div className="totals" style={{ minWidth: 340 }}>
            <div className="totals__row"><span>Subtotal (excl. IVA)</span><span>{money(subtotal, currency)}</span></div>
            <div className="totals__row"><span>Flete</span><span>{money(fleteNum, currency)}</span></div>
            <div className="totals__row"><span>IVA</span><span>{money(ivaTotal, currency)}</span></div>
            <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}>
              <span>Total</span><span>{money(total, currency)}</span>
            </div>
          </div>
        </div>
      </main>

      <div className="action-bar">
        <div className="action-bar__inner">
          <span className="ds-muted">{rows.length} línea(s) · {pedidosDistintos.length} pedido(s) · <span className="ds-strong">{money(total, currency)}</span></span>
          <div className="row gap-3">
            <Button variant="outline" onClick={() => crear(false)} disabled={!puedeCrear || guardando}>Guardar como abierta</Button>
            <Button variant="outline" onClick={() => crear(true)} disabled={!puedeCrear || guardando}>Enviar a aprobación</Button>
            <Button onClick={crearEnBc} disabled={!puedeCrear || guardando}>{guardando ? "Creando…" : "Crear en BC (vista previa)"}</Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
