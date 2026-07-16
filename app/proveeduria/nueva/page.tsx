"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { Combobox } from "@/components/combobox";
import { useStore } from "@/lib/store";
import { money, ultimoPrecioProveedor, almacenesFisicos, pedidoLineaPendiente } from "@/lib/helpers";
import type { OrdenLinea } from "@/lib/types";

interface Row {
  pedidoNumero: string;
  pedidoLineaId: string;
  articuloId: string;
  variantCode: string;
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

// Cargo de producto (Item Charge) a agregar a la orden: tipo (chargeNo del catálogo
// BC), cantidad y precio. chargeNo "" = flete por defecto.
interface Cargo { chargeNo: string; descripcion: string; cantidad: string; precio: string; }

export default function ArmarOrdenPage() {
  const { pedidos, proveedores, ordenes, almacenes, borrador, createOrden, setOrdenEstado, setBorrador } = useStore();
  const router = useRouter();
  const toast = useToast();

  const [proveedorId, setProveedorId] = useState("");
  const [currency, setCurrency] = useState("");
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [itemCharges, setItemCharges] = useState<{ no: string; descripcion: string }[]>([]);
  const [almacen, setAlmacen] = useState("ALM-GRAL");

  // Proveedores en vivo desde Business Central (fallback al catálogo si BC falla).
  const [bcProv, setBcProv] = useState<typeof proveedores | null>(null);
  useEffect(() => {
    fetch("/api/bc/vendors")
      .then((r) => (r.ok ? r.json() : { proveedores: [] }))
      .then((d) => { if (Array.isArray(d.proveedores) && d.proveedores.length) setBcProv(d.proveedores); })
      .catch(() => { /* sin BC, usa catálogo de respaldo */ });
  }, []);
  const catProv = bcProv ?? proveedores;
  const provSel = catProv.find((x) => x.id === proveedorId);

  // Catálogo de Cargos de producto (Item Charge) de BC para el selector de cargos.
  useEffect(() => {
    fetch("/api/bc/itemcharges")
      .then((r) => (r.ok ? r.json() : { itemCharges: [] }))
      .then((d) => { if (Array.isArray(d.itemCharges)) setItemCharges(d.itemCharges); })
      .catch(() => { /* sin BC: el selector cae a "Flete / transporte" */ });
  }, []);
  const addCargo = () => setCargos((cs) => [...cs, { chargeNo: "", descripcion: "FLETE / TRANSPORTE", cantidad: "1", precio: "" }]);
  const setCargo = (i: number, patch: Partial<Cargo>) => setCargos((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeCargo = (i: number) => setCargos((cs) => cs.filter((_, idx) => idx !== i));
  const onTipoCargo = (i: number, chargeNo: string) => {
    const ic = itemCharges.find((x) => x.no === chargeNo);
    setCargo(i, { chargeNo, descripcion: ic ? ic.descripcion : "FLETE / TRANSPORTE" });
  };
  const cargoImporte = (c: Cargo) => (Number(c.cantidad) || 0) * (Number(c.precio) || 0);

  // Catálogo de items de BC para agregar líneas manualmente a la orden.
  const [itemsBc, setItemsBc] = useState<{ code: string; descripcion: string; unidad: string; precioUltimo?: number }[]>([]);
  // Almacenes reales de BC (fallback al catálogo seed si BC no responde).
  const [bcAlm, setBcAlm] = useState<typeof almacenes | null>(null);
  useEffect(() => {
    fetch("/api/bc/items")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (Array.isArray(d.items)) setItemsBc(d.items.map((i: any) => ({ code: i.code, descripcion: i.descripcion, unidad: i.unidad || "UND", precioUltimo: typeof i.lastDirectCost === "number" ? i.lastDirectCost : undefined }))); })
      .catch(() => { /* sin BC */ });
    fetch("/api/bc/almacenes")
      .then((r) => (r.ok ? r.json() : { almacenes: [] }))
      .then((d) => {
        if (Array.isArray(d.almacenes) && d.almacenes.length) {
          setBcAlm(d.almacenes);
          if (!d.almacenes.some((a: any) => a.codigo === "ALM-GRAL")) setAlmacen(d.almacenes[0].codigo);
        }
      })
      .catch(() => { /* sin BC, usa seed */ });
  }, []);
  const catAlm = almacenesFisicos(bcAlm ?? almacenes);

  const [rows, setRows] = useState<Row[]>(() =>
    borrador.map((b) => {
      let info = { pedidoNumero: "", articuloId: "", variantCode: "", descripcion: "", unidad: "", almacen: "", proyecto: "" };
      for (const p of pedidos) {
        const l = p.lineas.find((x) => x.id === b.pedidoLineaId);
        if (l) { info = { pedidoNumero: p.numero, articuloId: l.articuloId, variantCode: l.variantCode ?? "", descripcion: l.descripcion, unidad: l.unidad, almacen: l.almacen, proyecto: p.tipoSolicitud === "material" ? (l.almacen || p.obraCodigo || "") : "" }; break; }
      }
      return {
        pedidoLineaId: b.pedidoLineaId, ...info,
        cantidad: String(b.cantidad), precio: String(b.precio), iva: String(b.iva), descuento: "0", tarea: "",
      };
    })
  );

  useEffect(() => { if (borrador.length === 0) router.replace("/proveeduria"); }, [borrador, router]);

  // Último precio de compra por BC: con proveedor trae el precio FACTURADO a ese
  // proveedor; SIN proveedor cae al último costo directo del item. Así el precio
  // del material aparece aunque todavía no se haya elegido proveedor.
  const [bcPrices, setBcPrices] = useState<Record<string, number | null>>({});
  const itemIdsKey = [...new Set(rows.map((r) => r.articuloId).filter(Boolean))].sort().join(",");
  useEffect(() => {
    const code = provSel?.code ?? "";
    const items = itemIdsKey ? itemIdsKey.split(",") : [];
    if (!items.length) { setBcPrices({}); return; }
    let cancel = false;
    Promise.all(items.map(async (it) => {
      try {
        const r = await fetch(`/api/bc/lastprice?item=${encodeURIComponent(it)}&vendor=${encodeURIComponent(code)}`);
        const d = await r.json();
        return [it, typeof d.precio === "number" ? d.precio : null] as const;
      } catch { return [it, null] as const; }
    })).then((pairs) => { if (!cancel) setBcPrices(Object.fromEntries(pairs)); });
    return () => { cancel = true; };
  }, [proveedorId, itemIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prellenar el precio con el ÚLTIMO precio de compra (costo directo del item)
  // en las líneas que vengan sin precio. No pisa lo que el comprador ya escribió.
  useEffect(() => {
    if (!itemsBc.length) return;
    setRows((rs) => rs.map((r) => {
      if (Number(r.precio) > 0) return r;
      const it = itemsBc.find((x) => x.code === r.articuloId);
      return it?.precioUltimo ? { ...r, precio: String(it.precioUltimo) } : r;
    }));
  }, [itemsBc]);

  // Prellenar también con el último precio de BC (por si el catálogo de items no
  // trae costo pero lastprice sí). No pisa lo que el comprador ya escribió.
  useEffect(() => {
    setRows((rs) => rs.map((r) => {
      if (Number(r.precio) > 0) return r;
      const p = bcPrices[r.articuloId];
      return typeof p === "number" && p > 0 ? { ...r, precio: String(p) } : r;
    }));
  }, [bcPrices]);

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.pedidoLineaId === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.pedidoLineaId !== id));

  // Agregar líneas de OTRAS solicitudes ya hechas (pendientes por ordenar) a la
  // orden que se está armando, sin salir de la página.
  const [addOpen, setAddOpen] = useState(false);
  const [addF, setAddF] = useState({ pedido: "", articulo: "", destino: "" });
  const yaEnOrden = new Set(rows.map((r) => r.pedidoLineaId));
  const lineasDisponibles = pedidos
    .filter((p) => p.estado === "aprobado" || p.estado === "en_orden")
    .flatMap((p) => p.lineas
      .filter((l) => pedidoLineaPendiente(l) > 0 && !yaEnOrden.has(l.id))
      .map((l) => ({ p, l, pend: pedidoLineaPendiente(l) })));
  const inc = (v: string, q: string) => !q || v.toLowerCase().includes(q.toLowerCase());
  const lineasDispFiltradas = lineasDisponibles.filter(({ p, l }) =>
    inc(p.numero, addF.pedido) && inc(l.descripcion, addF.articulo) && inc(l.almacen || p.obraCodigo || "", addF.destino));
  function agregarDeSolicitud(p: (typeof pedidos)[number], l: (typeof pedidos)[number]["lineas"][number], pend: number) {
    // Precio inicial = último precio de compra real (BC); si no hay historial, 0
    // para que proveeduría escriba lo acordado con el proveedor.
    const hist = itemsBc.find((x) => x.code === l.articuloId)?.precioUltimo ?? bcPrices[l.articuloId] ?? 0;
    setRows((rs) => [...rs, {
      pedidoNumero: p.numero, pedidoLineaId: l.id, articuloId: l.articuloId, variantCode: l.variantCode ?? "",
      descripcion: l.descripcion, unidad: l.unidad, almacen: l.almacen,
      cantidad: String(pend), precio: String(hist || 0), iva: "13", descuento: "0",
      proyecto: p.tipoSolicitud === "material" ? (l.almacen || p.obraCodigo || "") : "", tarea: "",
    }]);
  }

  const calcImporte = (r: Row) => Number(r.cantidad) * Number(r.precio) * (1 - (Number(r.descuento) || 0) / 100);
  const subtotal = rows.reduce((s, r) => s + calcImporte(r), 0);
  const cargosTotal = cargos.reduce((s, c) => s + cargoImporte(c), 0);
  const fleteShare = (r: Row) => (subtotal > 0 && cargosTotal > 0 ? cargosTotal * calcImporte(r) / subtotal : 0);
  const lastPrice = (r: Row) => {
    const bc = bcPrices[r.articuloId];
    if (typeof bc === "number") return bc;
    const it = itemsBc.find((x) => x.code === r.articuloId);
    if (it?.precioUltimo) return it.precioUltimo;
    return proveedorId ? ultimoPrecioProveedor(ordenes, r.articuloId, proveedorId) : null;
  };
  const ivaTotal = rows.reduce((s, r) => s + calcImporte(r) * ((Number(r.iva) || 0) / 100), 0);
  const total = subtotal + cargosTotal + ivaTotal;
  const pedidosDistintos = [...new Set(rows.map((r) => r.pedidoNumero))];
  const puedeCrear = !!proveedorId && rows.length > 0;

  function elegirProveedor(id: string) {
    setProveedorId(id);
    const p = catProv.find((x) => x.id === id);
    if (p) setCurrency(p.currencyCode ?? "");
  }

  const [guardando, setGuardando] = useState(false);

  // "Guardar como abierta": solo registra la orden local como borrador/abierta.
  async function crear(aprobar: boolean) {
    if (!puedeCrear) { toast("Seleccioná un proveedor.", "error"); return; }
    // Precio obligatorio para enviar a aprobación: ninguna línea puede ir a BC en 0.
    if (aprobar) {
      const sinPrecio = rows.filter((r) => !(Number(r.precio) > 0)).length;
      if (sinPrecio) { toast(`${sinPrecio} línea(s) sin precio. Poné el precio acordado antes de enviar a aprobación.`, "error"); return; }
    }
    setGuardando(true);
    try {
    const ls: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = rows.map((r) => ({
      tipo: "articulo", articuloId: r.articuloId, variantCode: r.variantCode || undefined, pedidoLineaId: r.pedidoLineaId, pedidoNumero: r.pedidoNumero,
      descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen: r.almacen,
      precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0, descuentoPct: Number(r.descuento) || 0,
      proyecto: r.proyecto || undefined, taskNo: r.tarea || undefined,
    }));
    for (const c of cargos) {
      if (cargoImporte(c) <= 0) continue;
      ls.push({ tipo: "cargo", chargeNo: c.chargeNo || undefined, descripcion: c.descripcion || "CARGO",
        cantidad: Number(c.cantidad) || 1, unidad: "UND", almacen: rows[0].almacen,
        precioUnitario: Number(c.precio) || 0, ivaPct: 13 });
    }
    const orden = await createOrden({ proveedorId, proveedorNo: provSel?.code, proveedorNombre: provSel?.nombre, currencyCode: currency, almacenRecepcion: almacen, lineas: ls });
    if (aprobar) await setOrdenEstado(orden.id, "pendiente_aprobacion");
    setBorrador([]);
    toast(`Orden ${orden.numero} ${aprobar ? "enviada a aprobación" : "guardada como abierta"}`, "success");
    router.push(`/proveeduria/ordenes/${orden.id}`);
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  return (
    <AppShell role="proveeduria">
      <main className="page page--wide" style={{ paddingBottom: 120 }}>
        <div className="back-link" onClick={() => router.push("/proveeduria")}>Volver a materiales</div>
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
              <Combobox items={catProv} value={proveedorId} onChange={(k) => elegirProveedor(k)}
                getKey={(p) => p.id} getLabel={(p) => `${p.code} — ${p.nombre}`}
                getSearch={(p) => `${p.code} ${p.nombre}`} placeholder="Buscar proveedor…" />
            </Field>
            <Field label="Moneda">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="">CRC (colones)</option>
                <option value="USD">USD (dólares)</option>
              </Select>
            </Field>
            <Field label="Almacén de recepción" help="Dónde entra el material en BC (por defecto el General)">
              <Select value={almacen} onChange={(e) => setAlmacen(e.target.value)}>
                {catAlm.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nombre}</option>)}
              </Select>
            </Field>
          </div>
          <div className="row gap-2 wrap mt-4">
            <span className="ds-muted ds-label">Solicitudes en esta orden:</span>
            {pedidosDistintos.map((n) => <Badge key={n} tone="gray">{n}</Badge>)}
          </div>
        </Card>

        {/* Cargos de producto (Item Charge): Transporte, Seguro, etc. Se distribuyen
            por importe entre los artículos al registrar en BC. */}
        <Card className="mt-4">
          <div className="row row--between wrap gap-3" style={{ alignItems: "center", marginBottom: cargos.length ? 12 : 0 }}>
            <div className="col" style={{ gap: 2 }}>
              <span className="ds-subtitle">Cargos de producto</span>
              <span className="ds-muted ds-body-sm">Transporte, seguro, etc. Se reparten <strong>por importe</strong> entre los artículos.</span>
            </div>
            <Button variant="outline" size="sm" onClick={addCargo}>+ Agregar cargo</Button>
          </div>
          {/* Filas (no tabla): así el desplegable de Tipo no lo recorta el overflow. */}
          {cargos.map((c, i) => (
            <div key={i} className="row gap-3 wrap" style={{ alignItems: "flex-end", padding: "12px 0", borderTop: "1.5px solid var(--ds-color-gray-100)" }}>
              <div style={{ flex: "1 1 240px", minWidth: 200 }}>
                <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Tipo de cargo</span>
                <Select value={c.chargeNo} onChange={(e) => onTipoCargo(i, e.target.value)}>
                  <option value="">Flete / transporte</option>
                  {itemCharges.map((ic) => <option key={ic.no} value={ic.no}>{ic.no} · {ic.descripcion}</option>)}
                </Select>
              </div>
              <div>
                <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Cantidad</span>
                <Input type="number" min={0} value={c.cantidad} style={{ width: 96 }} onChange={(e) => setCargo(i, { cantidad: e.target.value })} />
              </div>
              <div>
                <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Precio</span>
                <Input type="number" min={0} value={c.precio} placeholder="0" style={{ width: 130 }} onChange={(e) => setCargo(i, { precio: e.target.value })} />
              </div>
              <div style={{ minWidth: 110, textAlign: "right" }}>
                <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Importe</span>
                <span className="ds-strong">{money(cargoImporte(c) || 0, currency)}</span>
              </div>
              <button type="button" className="icon-btn icon-btn--quitar" title="Quitar cargo" style={{ marginBottom: 2 }} onClick={() => removeCargo(i)}>×</button>
            </div>
          ))}
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          {/* En una OC armada desde solicitudes SOLO se agregan líneas que alguien ya
              pidió. Material sin solicitud (limpieza, etc.) va por Compra directa. */}
          <div className="row row--between wrap gap-3" style={{ alignItems: "center", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 6%, #fff)" }}>
            <div className="col" style={{ gap: 2 }}>
              <span className="ds-strong ds-body-sm">Líneas de la orden</span>
              <span className="ds-muted ds-body-sm">Solo materiales de solicitudes ya hechas. ¿Material sin solicitud? Usá <span className="ds-strong">Compra directa</span>.</span>
            </div>
            <Button onClick={() => setAddOpen(true)} disabled={lineasDisponibles.length === 0} title="Sumar líneas pendientes de solicitudes ya hechas">+ De solicitudes{lineasDisponibles.length ? ` (${lineasDisponibles.length})` : ""}</Button>
          </div>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Pedido</th><th>Artículo</th><th>Obra</th>
                  <th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Desc%</th><th className="ds-num">IVA%</th>
                  <th className="ds-num">Importe</th><th></th>
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
                    <td className="ds-num ds-strong">
                      {money(calcImporte(r) || 0, currency)}
                      {fleteShare(r) > 0 && <div className="ds-body-sm ds-muted" style={{ fontWeight: 400 }}>+ cargos {money(fleteShare(r), currency)}</div>}
                    </td>
                    <td className="ds-num"><button type="button" className="icon-btn" title="Quitar línea" onClick={() => removeRow(r.pedidoLineaId)}>×</button></td>
                  </tr>
                ))}
              </tbody>
              {cargosTotal > 0 && (
                <tfoot>
                  <tr><td colSpan={9} className="ds-body-sm ds-muted" style={{ padding: "10px 16px", borderTop: "1.5px solid var(--ds-color-gray-100)" }}>
                    Los cargos ({money(cargosTotal, currency)}) se reparten proporcional al importe de cada línea (mostrado como “+ cargos”).
                  </td></tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        <div className="row mt-6" style={{ justifyContent: "flex-end" }}>
          <div className="totals" style={{ minWidth: 340 }}>
            <div className="totals__row"><span>Subtotal (excl. IVA)</span><span>{money(subtotal, currency)}</span></div>
            <div className="totals__row"><span>Cargos</span><span>{money(cargosTotal, currency)}</span></div>
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
            <Button onClick={() => crear(true)} disabled={!puedeCrear || guardando}>{guardando ? "Enviando…" : "Enviar a aprobación"}</Button>
          </div>
        </div>
      </div>

      {addOpen && (
        <Modal wide title="Agregar de solicitudes pendientes" onClose={() => setAddOpen(false)}
          footer={<Button variant="outline" onClick={() => setAddOpen(false)}>Cerrar</Button>}>
          <p className="ds-muted ds-body-sm" style={{ marginTop: 0 }}>Líneas pendientes por ordenar de solicitudes ya hechas. Se suman a esta orden.</p>
          {lineasDisponibles.length === 0 ? (
            <div className="empty">No hay líneas pendientes en otras solicitudes.</div>
          ) : (
            <div className="ds-table-wrap" style={{ boxShadow: "none", maxHeight: 420, overflow: "auto" }}>
              <table className="ds-table">
                <thead>
                  <tr><th>Pedido</th><th>Artículo</th><th>Destino</th><th className="ds-num">Pendiente</th><th /></tr>
                  <tr>
                    <th><input className="ds-cell-input" style={{ width: "100%" }} placeholder="Filtrar…" value={addF.pedido} onChange={(e) => setAddF((f) => ({ ...f, pedido: e.target.value }))} /></th>
                    <th><input className="ds-cell-input" style={{ width: "100%" }} placeholder="Filtrar…" value={addF.articulo} onChange={(e) => setAddF((f) => ({ ...f, articulo: e.target.value }))} /></th>
                    <th><input className="ds-cell-input" style={{ width: "100%" }} placeholder="Filtrar…" value={addF.destino} onChange={(e) => setAddF((f) => ({ ...f, destino: e.target.value }))} /></th>
                    <th /><th />
                  </tr>
                </thead>
                <tbody>
                  {lineasDispFiltradas.length === 0 && <tr><td colSpan={5}><div className="empty" style={{ padding: "20px 0" }}>Ninguna línea coincide con el filtro.</div></td></tr>}
                  {lineasDispFiltradas.map(({ p, l, pend }) => (
                    <tr key={l.id}>
                      <td className="ds-body-sm ds-strong">{p.numero}</td>
                      <td><div className="ds-truncate" style={{ maxWidth: 260 }} title={l.descripcion}>{l.descripcion}</div></td>
                      <td className="ds-muted ds-body-sm">{l.almacen || p.obraCodigo || "—"}</td>
                      <td className="ds-num">{pend} {l.unidad}</td>
                      <td className="ds-num"><Button variant="outline" size="sm" onClick={() => agregarDeSolicitud(p, l, pend)}>Agregar</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </AppShell>
  );
}
