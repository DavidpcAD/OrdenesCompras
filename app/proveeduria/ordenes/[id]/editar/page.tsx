"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Select, useToast } from "@/components/ui";
import { Combobox } from "@/components/combobox";
import { useStore } from "@/lib/store";
import { money } from "@/lib/helpers";
import type { OrdenLinea } from "@/lib/types";

interface Row { key: string; articuloId: string; descripcion: string; unidad: string; obra: string; cantidad: string; precio: string; iva: string; descuento: string; proyecto?: string; taskNo?: string; pedidoLineaId?: string; pedidoNumero?: string; }
const uid = () => Math.random().toString(36).slice(2, 9);

export default function EditarOrdenPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { ordenes, proveedores, almacenes, updateOrden } = useStore();
  const orden = ordenes.find((o) => o.id === id);

  const [bcProv, setBcProv] = useState<typeof proveedores | null>(null);
  const [itemsBc, setItemsBc] = useState<{ code: string; descripcion: string; unidad: string }[]>([]);
  useEffect(() => {
    fetch("/api/bc/vendors").then((r) => (r.ok ? r.json() : { proveedores: [] })).then((d) => { if (Array.isArray(d.proveedores) && d.proveedores.length) setBcProv(d.proveedores); }).catch(() => {});
    fetch("/api/bc/items").then((r) => (r.ok ? r.json() : { items: [] })).then((d) => { if (Array.isArray(d.items)) setItemsBc(d.items.map((i: any) => ({ code: i.code, descripcion: i.descripcion, unidad: i.unidad || "UND" }))); }).catch(() => {});
  }, []);
  const catProv = bcProv ?? proveedores;

  const cargo = orden?.lineas.find((l) => l.tipo === "cargo");
  const [proveedorId, setProveedorId] = useState(orden?.proveedorId ?? "");
  const [currency, setCurrency] = useState(orden?.currencyCode ?? "");
  const [flete, setFlete] = useState(cargo ? String(cargo.precioUnitario) : "");
  const [almacen, setAlmacen] = useState(orden?.almacenRecepcion ?? "ALM-GRAL");
  const [rows, setRows] = useState<Row[]>(
    (orden?.lineas ?? []).filter((l) => l.tipo === "articulo").map((l) => ({
      key: l.id, articuloId: l.articuloId ?? "", descripcion: l.descripcion, unidad: l.unidad, obra: l.proyecto ?? l.almacen ?? "",
      cantidad: String(l.cantidad), precio: String(l.precioUnitario), iva: String(l.ivaPct ?? 13), descuento: String(l.descuentoPct ?? 0),
      proyecto: l.proyecto, taskNo: l.taskNo, pedidoLineaId: l.pedidoLineaId, pedidoNumero: l.pedidoNumero,
    }))
  );
  const [qaCode, setQaCode] = useState(""); const [qaQty, setQaQty] = useState(""); const [qaPrecio, setQaPrecio] = useState("");

  const provSel = catProv.find((x) => x.id === proveedorId);
  const setRow = (k: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const removeRow = (k: string) => setRows((rs) => rs.filter((r) => r.key !== k));
  function agregarLinea() {
    const it = itemsBc.find((x) => x.code === qaCode);
    if (!it || !(Number(qaQty) > 0)) { toast("Elegí un artículo y una cantidad.", "error"); return; }
    setRows((rs) => [...rs, { key: `m-${uid()}`, articuloId: it.code, descripcion: it.descripcion, unidad: it.unidad, obra: "", cantidad: String(Number(qaQty)), precio: String(Number(qaPrecio) || 0), iva: "13", descuento: "0", pedidoNumero: "Manual" }]);
    setQaCode(""); setQaQty(""); setQaPrecio("");
  }

  const calcImporte = (r: Row) => Number(r.cantidad) * Number(r.precio) * (1 - (Number(r.descuento) || 0) / 100);
  const subtotal = useMemo(() => rows.reduce((s, r) => s + calcImporte(r), 0), [rows]);
  const ivaTotal = useMemo(() => rows.reduce((s, r) => s + calcImporte(r) * ((Number(r.iva) || 0) / 100), 0), [rows]);
  const fleteNum = Number(flete) || 0;
  const total = subtotal + fleteNum + ivaTotal;
  const [guardando, setGuardando] = useState(false);

  if (!orden) return <AppShell role="proveeduria"><main className="page"><div className="empty">Orden no encontrada.</div></main></AppShell>;
  if (orden.estado !== "abierto") {
    return <AppShell role="proveeduria"><main className="page">
      <div className="back-link" onClick={() => router.push(`/proveeduria/ordenes/${id}`)}>‹ Volver a la orden</div>
      <div className="empty" style={{ padding: "48px 16px" }}>Esta orden ya no se puede editar: solo se permite mientras está Abierta (sin enviar a aprobación).</div>
    </main></AppShell>;
  }

  async function guardar() {
    if (!proveedorId) { toast("Seleccioná un proveedor.", "error"); return; }
    if (rows.length === 0) { toast("La orden debe tener al menos una línea.", "error"); return; }
    setGuardando(true);
    try {
      const ls: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = rows.map((r) => ({
        tipo: "articulo", articuloId: r.articuloId, pedidoLineaId: r.pedidoLineaId, pedidoNumero: r.pedidoNumero,
        descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen: r.obra,
        precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0, descuentoPct: Number(r.descuento) || 0,
        proyecto: r.proyecto || r.obra || undefined, taskNo: r.taskNo,
      }));
      if (fleteNum > 0) ls.push({ tipo: "cargo", descripcion: "FLETE / TRANSPORTE", cantidad: 1, unidad: "UND", almacen: rows[0]?.obra ?? "", precioUnitario: fleteNum, ivaPct: 13 });
      await updateOrden(orden!.id, { proveedorId, proveedorNo: provSel?.code, proveedorNombre: provSel?.nombre, currencyCode: currency, almacenRecepcion: almacen, lineas: ls });
      toast(`Orden ${orden!.numero} actualizada`, "success");
      router.push(`/proveeduria/ordenes/${orden!.id}`);
    } catch (e: any) { toast(String(e?.message ?? e), "error"); setGuardando(false); }
  }

  return (
    <AppShell role="proveeduria">
      <main className="page page--wide" style={{ paddingBottom: 120 }}>
        <div className="back-link" onClick={() => router.push(`/proveeduria/ordenes/${id}`)}>‹ Volver a la orden</div>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3"><h1 className="ds-heading">Editar {orden.numero}</h1><Badge tone="gray">Abierta</Badge></div>
            <p className="ds-muted">Ajustá proveedor, almacén, líneas y precios. Solo se puede mientras la orden esté Abierta.</p>
          </div>
        </div>

        <Card>
          <h3 className="ds-subtitle" style={{ marginBottom: 16 }}>Datos de la orden</h3>
          <div className="grid-3">
            <Field label="Proveedor" help="Hereda términos y moneda">
              <Combobox items={catProv} value={proveedorId} onChange={(k) => { setProveedorId(k); const p = catProv.find((x) => x.id === k); if (p) setCurrency(p.currencyCode ?? ""); }}
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
                {almacenes.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nombre}</option>)}
              </Select>
            </Field>
          </div>
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="row wrap gap-2" style={{ alignItems: "flex-end", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 6%, #fff)" }}>
            <div style={{ flex: "1 1 280px", minWidth: 220 }}>
              <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Agregar artículo</label>
              <Combobox items={itemsBc} value={qaCode} onChange={(k) => setQaCode(k)} getKey={(i) => i.code} getLabel={(i) => `${i.code} — ${i.descripcion}`} getSearch={(i) => `${i.code} ${i.descripcion}`} placeholder="Buscar artículo del catálogo…" />
            </div>
            <div><label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Cantidad</label><Input type="number" min={0} value={qaQty} onChange={(e) => setQaQty(e.target.value)} placeholder="0" style={{ width: 90 }} /></div>
            <div><label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Precio</label><Input type="number" min={0} value={qaPrecio} onChange={(e) => setQaPrecio(e.target.value)} placeholder="0" style={{ width: 110 }} /></div>
            <Button variant="outline" onClick={agregarLinea} disabled={!qaCode || !(Number(qaQty) > 0)}>+ Agregar línea</Button>
          </div>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Artículo</th><th>Obra</th><th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Desc%</th><th className="ds-num">IVA%</th><th className="ds-num">Importe</th><th></th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8}><div className="empty">Sin líneas. Agregá al menos una.</div></td></tr>}
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td><div className="ds-truncate" title={r.descripcion} style={{ maxWidth: 220 }}>{r.descripcion}</div>{r.pedidoNumero && <div className="ds-body-sm ds-muted">{r.pedidoNumero}</div>}</td>
                    <td className="ds-muted ds-body-sm">{r.obra || "—"}</td>
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
            <Button variant="outline" onClick={() => router.push(`/proveeduria/ordenes/${id}`)}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
