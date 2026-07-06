"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Select, useToast } from "@/components/ui";
import { Combobox } from "@/components/combobox";
import { useStore } from "@/lib/store";
import { money, almacenesFisicos } from "@/lib/helpers";
import type { OrdenLinea } from "@/lib/types";

// Orden DIRECTA: compra armada por Proveeduría sin partir de una solicitud de
// Ingeniería (material que no vino en ningún pedido). Todas las líneas son
// manuales (pedidoNumero "Manual"); en la lista/detalle se marca como "Directa".
interface Row { key: string; articuloId: string; descripcion: string; unidad: string; obra: string; cantidad: string; precio: string; iva: string; descuento: string; }
const uid = () => Math.random().toString(36).slice(2, 9);

export default function OrdenDirectaPage() {
  const { proveedores, almacenes, createOrden, setOrdenEstado } = useStore();
  const router = useRouter();
  const toast = useToast();

  const [proveedorId, setProveedorId] = useState("");
  const [currency, setCurrency] = useState("");
  const [flete, setFlete] = useState("");
  const [almacen, setAlmacen] = useState("ALM-GRAL");

  // Catálogos en vivo desde Business Central (con respaldo al catálogo seed).
  const [bcProv, setBcProv] = useState<typeof proveedores | null>(null);
  const [itemsBc, setItemsBc] = useState<{ code: string; descripcion: string; unidad: string; precioUltimo?: number }[]>([]);
  const [bcAlm, setBcAlm] = useState<typeof almacenes | null>(null);
  useEffect(() => {
    fetch("/api/bc/vendors").then((r) => (r.ok ? r.json() : { proveedores: [] })).then((d) => { if (Array.isArray(d.proveedores) && d.proveedores.length) setBcProv(d.proveedores); }).catch(() => {});
    fetch("/api/bc/items").then((r) => (r.ok ? r.json() : { items: [] })).then((d) => { if (Array.isArray(d.items)) setItemsBc(d.items.map((i: any) => ({ code: i.code, descripcion: i.descripcion, unidad: i.unidad || "UND", precioUltimo: typeof i.lastDirectCost === "number" ? i.lastDirectCost : undefined }))); }).catch(() => {});
    fetch("/api/bc/almacenes").then((r) => (r.ok ? r.json() : { almacenes: [] })).then((d) => {
      if (Array.isArray(d.almacenes) && d.almacenes.length) { setBcAlm(d.almacenes); if (!d.almacenes.some((a: any) => a.codigo === "ALM-GRAL")) setAlmacen(d.almacenes[0].codigo); }
    }).catch(() => {});
  }, []);
  const catProv = bcProv ?? proveedores;
  const catAlm = almacenesFisicos(bcAlm ?? almacenes);
  const provSel = catProv.find((x) => x.id === proveedorId);

  const [rows, setRows] = useState<Row[]>([]);
  const [qaCode, setQaCode] = useState(""); const [qaQty, setQaQty] = useState(""); const [qaPrecio, setQaPrecio] = useState("");

  const setRow = (k: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const removeRow = (k: string) => setRows((rs) => rs.filter((r) => r.key !== k));
  function agregarLinea() {
    const it = itemsBc.find((x) => x.code === qaCode);
    if (!it || !(Number(qaQty) > 0)) { toast("Elegí un artículo y una cantidad.", "error"); return; }
    setRows((rs) => [...rs, { key: `m-${uid()}`, articuloId: it.code, descripcion: it.descripcion, unidad: it.unidad, obra: "", cantidad: String(Number(qaQty)), precio: String(Number(qaPrecio) || it.precioUltimo || 0), iva: "13", descuento: "0" }]);
    setQaCode(""); setQaQty(""); setQaPrecio("");
  }

  const calcImporte = (r: Row) => Number(r.cantidad) * Number(r.precio) * (1 - (Number(r.descuento) || 0) / 100);
  const subtotal = useMemo(() => rows.reduce((s, r) => s + calcImporte(r), 0), [rows]);
  const ivaTotal = useMemo(() => rows.reduce((s, r) => s + calcImporte(r) * ((Number(r.iva) || 0) / 100), 0), [rows]);
  const fleteNum = Number(flete) || 0;
  const total = subtotal + fleteNum + ivaTotal;
  const puedeCrear = !!proveedorId && rows.length > 0;
  const [guardando, setGuardando] = useState(false);

  function elegirProveedor(id: string) {
    setProveedorId(id);
    const p = catProv.find((x) => x.id === id);
    if (p) setCurrency(p.currencyCode ?? "");
  }

  async function crear(aprobar: boolean) {
    if (!puedeCrear) { toast("Seleccioná un proveedor y agregá al menos una línea.", "error"); return; }
    setGuardando(true);
    try {
      const ls: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = rows.map((r) => ({
        tipo: "articulo", articuloId: r.articuloId, pedidoNumero: "Manual",
        descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen: r.obra,
        precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0, descuentoPct: Number(r.descuento) || 0,
        proyecto: r.obra || undefined,
      }));
      if (fleteNum > 0) ls.push({ tipo: "cargo", descripcion: "FLETE / TRANSPORTE", cantidad: 1, unidad: "UND", almacen: rows[0]?.obra ?? "", precioUnitario: fleteNum, ivaPct: 13 });
      const orden = await createOrden({ proveedorId, proveedorNo: provSel?.code, proveedorNombre: provSel?.nombre, currencyCode: currency, almacenRecepcion: almacen, lineas: ls });
      if (aprobar) await setOrdenEstado(orden.id, "pendiente_aprobacion");
      toast(`Orden directa ${orden.numero} ${aprobar ? "enviada a aprobación" : "guardada como abierta"}`, "success");
      router.push(`/proveeduria/ordenes/${orden.id}`);
    } catch (e: any) { toast(String(e?.message ?? e), "error"); setGuardando(false); }
  }

  return (
    <AppShell role="proveeduria">
      <main className="page page--wide" style={{ paddingBottom: 120 }}>
        <div className="back-link" onClick={() => router.push("/proveeduria/ordenes")}>‹ Volver a órdenes</div>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3"><h1 className="ds-heading">Nueva orden directa</h1><Badge tone="yellow">Directa</Badge></div>
            <p className="ds-muted">Compra que no viene de una solicitud de Ingeniería. Agregá los artículos del catálogo directamente.</p>
          </div>
        </div>

        <Card>
          <h3 className="ds-subtitle" style={{ marginBottom: 16 }}>Datos de la orden</h3>
          <div className="grid-3">
            <Field label="Proveedor" help="Hereda términos y moneda">
              <Combobox items={catProv} value={proveedorId} onChange={(k) => elegirProveedor(k)}
                getKey={(p) => p.id} getLabel={(p) => `${p.code} — ${p.nombre}`} getSearch={(p) => `${p.code} ${p.nombre}`} placeholder="Buscar proveedor…" />
            </Field>
            <Field label="Moneda">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="">CRC (colones)</option><option value="USD">USD (dólares)</option></Select>
            </Field>
            <Field label="Flete / transporte" help="Opcional, se distribuye al facturar">
              <Input type="number" min={0} value={flete} onChange={(e) => setFlete(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Almacén de recepción" help="Dónde entra el material en BC (por defecto el General)">
              <Select value={almacen} onChange={(e) => setAlmacen(e.target.value)}>
                {catAlm.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nombre}</option>)}
              </Select>
            </Field>
          </div>
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="row wrap gap-2" style={{ alignItems: "flex-end", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 6%, #fff)" }}>
            <div style={{ flex: "1 1 280px", minWidth: 220 }}>
              <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Agregar artículo</label>
              <Combobox items={itemsBc} value={qaCode} onChange={(k) => { setQaCode(k); const it = itemsBc.find((x) => x.code === k); if (it?.precioUltimo) setQaPrecio(String(it.precioUltimo)); }} getKey={(i) => i.code} getLabel={(i) => `${i.code} — ${i.descripcion}`} getSearch={(i) => `${i.code} ${i.descripcion}`} minChars={2} placeholder="Buscar artículo del catálogo…" />
            </div>
            <div><label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Cantidad</label><Input type="number" min={0} value={qaQty} onChange={(e) => setQaQty(e.target.value)} placeholder="0" style={{ width: 90 }} /></div>
            <div><label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Precio</label><Input type="number" min={0} value={qaPrecio} onChange={(e) => setQaPrecio(e.target.value)} placeholder="0" style={{ width: 110 }} />{(() => { const it = itemsBc.find((x) => x.code === qaCode); return it?.precioUltimo ? <div className="ds-body-sm ds-muted" style={{ marginTop: 2 }}>últ. compra {money(it.precioUltimo, currency)}</div> : null; })()}</div>
            <Button variant="outline" onClick={agregarLinea} disabled={!qaCode || !(Number(qaQty) > 0)}>+ Agregar línea</Button>
          </div>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Artículo</th><th>Obra</th><th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Desc%</th><th className="ds-num">IVA%</th><th className="ds-num">Importe</th><th></th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8}><div className="empty">Sin líneas. Buscá un artículo del catálogo y agregalo.</div></td></tr>}
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td><div className="ds-truncate" title={r.descripcion} style={{ maxWidth: 220 }}>{r.descripcion}</div><div className="ds-body-sm ds-muted">{r.articuloId}</div></td>
                    <td><input className="ds-cell-input" value={r.obra} placeholder="—" style={{ width: 92 }} onChange={(e) => setRow(r.key, { obra: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" type="number" min={0} value={r.cantidad} style={{ width: 70 }} onChange={(e) => setRow(r.key, { cantidad: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" type="number" min={0} value={r.precio} style={{ width: 92 }} onChange={(e) => setRow(r.key, { precio: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" type="number" min={0} max={100} value={r.descuento} style={{ width: 60 }} onChange={(e) => setRow(r.key, { descuento: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" type="number" min={0} value={r.iva} style={{ width: 56 }} onChange={(e) => setRow(r.key, { iva: e.target.value })} /></td>
                    <td className="ds-num ds-strong">{money(calcImporte(r) || 0, currency)}</td>
                    <td className="ds-num"><button type="button" className="icon-btn" title="Quitar línea" onClick={() => removeRow(r.key)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="row mt-6" style={{ justifyContent: "flex-end" }}>
          <div className="totals" style={{ minWidth: 340 }}>
            <div className="totals__row"><span>Subtotal (excl. IVA)</span><span>{money(subtotal, currency)}</span></div>
            <div className="totals__row"><span>Flete</span><span>{money(fleteNum, currency)}</span></div>
            <div className="totals__row"><span>IVA</span><span>{money(ivaTotal, currency)}</span></div>
            <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}><span>Total</span><span>{money(total, currency)}</span></div>
          </div>
        </div>
      </main>

      <div className="action-bar">
        <div className="action-bar__inner">
          <span className="ds-muted">{rows.length} línea(s) · <span className="ds-strong">{money(total, currency)}</span></span>
          <div className="row gap-3">
            <Button variant="outline" onClick={() => crear(false)} disabled={!puedeCrear || guardando}>Guardar como abierta</Button>
            <Button onClick={() => crear(true)} disabled={!puedeCrear || guardando}>{guardando ? "Enviando…" : "Enviar a aprobación"}</Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
