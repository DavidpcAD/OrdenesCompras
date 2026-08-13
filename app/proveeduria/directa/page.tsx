"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Select, useToast } from "@/components/ui";
import { Combobox } from "@/components/combobox";
import { useStore } from "@/lib/store";
import { money, almacenesFisicos, monedaApp } from "@/lib/helpers";
import type { OrdenLinea } from "@/lib/types";

// Orden DIRECTA: compra armada por Proveeduría sin partir de una solicitud de
// Ingeniería (material que no vino en ningún pedido). Todas las líneas son
// manuales (pedidoNumero "Manual"); en la lista/detalle se marca como "Directa".
interface Row { key: string; articuloId: string; descripcion: string; unidad: string; obra: string; cantidad: string; precio: string; iva: string; descuento: string; variantCode: string; variantNombre: string; }
type Variante = { code: string; descripcion: string };
// Cargo de producto (Item Charge) a agregar a la orden: tipo (chargeNo del catálogo
// BC), cantidad y precio. chargeNo "" = flete por defecto. Igual que en "nueva".
interface Cargo { chargeNo: string; descripcion: string; cantidad: string; precio: string; }
const uid = () => Math.random().toString(36).slice(2, 9);

export default function OrdenDirectaPage() {
  const { proveedores, almacenes, createOrden, setOrdenEstado } = useStore();
  const router = useRouter();
  const toast = useToast();

  const qtyId = useId();
  const priceId = useId();
  const [proveedorId, setProveedorId] = useState("");
  const [currency, setCurrency] = useState("");
  const [almacen, setAlmacen] = useState("ALM-GRAL");
  // Cargos de producto (Item Charge): igual que al armar una orden desde un pedido.
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [metodoAsig, setMetodoAsig] = useState("Amount"); // Amount|Weight|Volume|Equally
  const [itemCharges, setItemCharges] = useState<{ no: string; descripcion: string }[]>([]);

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
    // Catálogo de Cargos de producto (Item Charge) de BC para el selector de tipo.
    fetch("/api/bc/itemcharges").then((r) => (r.ok ? r.json() : { itemCharges: [] }))
      .then((d) => { if (Array.isArray(d.itemCharges)) setItemCharges(d.itemCharges); }).catch(() => {});
  }, []);
  const catProv = bcProv ?? proveedores;
  const catAlm = almacenesFisicos(bcAlm ?? almacenes);
  const provSel = catProv.find((x) => x.id === proveedorId);

  const [rows, setRows] = useState<Row[]>([]);
  const [qaCode, setQaCode] = useState(""); const [qaQty, setQaQty] = useState(""); const [qaPrecio, setQaPrecio] = useState("");
  // Variantes del artículo elegido (color/medida/etc. en BC). Si el item tiene
  // variantes, hay que elegir una ANTES de agregar la línea (BC la exige).
  const [qaVariantes, setQaVariantes] = useState<Variante[]>([]);
  const [qaVariante, setQaVariante] = useState("");
  const [qaVariantesError, setQaVariantesError] = useState(false);
  const variantePendiente = qaVariantes.length > 0 && !qaVariante;

  const setRow = (k: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const removeRow = (k: string) => setRows((rs) => rs.filter((r) => r.key !== k));
  // Cargos de producto (mismo comportamiento que en "nueva").
  const addCargo = () => setCargos((cs) => [...cs, { chargeNo: "", descripcion: "FLETE / TRANSPORTE", cantidad: "1", precio: "" }]);
  const setCargo = (i: number, patch: Partial<Cargo>) => setCargos((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeCargo = (i: number) => setCargos((cs) => cs.filter((_, idx) => idx !== i));
  const onTipoCargo = (i: number, chargeNo: string) => { const ic = itemCharges.find((x) => x.no === chargeNo); setCargo(i, { chargeNo, descripcion: ic ? ic.descripcion : "FLETE / TRANSPORTE" }); };
  const cargoImporte = (c: Cargo) => (Number(c.cantidad) || 0) * (Number(c.precio) || 0);
  function agregarLinea() {
    const it = itemsBc.find((x) => x.code === qaCode);
    if (!it || !(Number(qaQty) > 0)) { toast("Elegí un artículo y una cantidad.", "error"); return; }
    if (variantePendiente) { toast("Este artículo tiene variantes: elegí una antes de agregar la línea.", "error"); return; }
    const variante = qaVariantes.find((v) => v.code === qaVariante);
    setRows((rs) => [...rs, { key: `m-${uid()}`, articuloId: it.code, descripcion: it.descripcion, unidad: it.unidad, obra: "", cantidad: String(Number(qaQty)), precio: String(Number(qaPrecio) || it.precioUltimo || 0), iva: "13", descuento: "0", variantCode: qaVariante, variantNombre: variante?.descripcion ?? "" }]);
    setQaCode(""); setQaQty(""); setQaPrecio(""); setQaVariantes([]); setQaVariante(""); setQaVariantesError(false);
  }

  const calcImporte = (r: Row) => Number(r.cantidad) * Number(r.precio) * (1 - (Number(r.descuento) || 0) / 100);
  const subtotal = useMemo(() => rows.reduce((s, r) => s + calcImporte(r), 0), [rows]);
  const cargosTotal = cargos.reduce((s, c) => s + cargoImporte(c), 0);
  // El IVA (13%) se aplica a los materiales Y a los cargos, igual que en BC.
  const ivaCargos = cargosTotal * 0.13;
  const ivaTotal = useMemo(() => rows.reduce((s, r) => s + calcImporte(r) * ((Number(r.iva) || 0) / 100), 0), [rows]) + ivaCargos;
  const total = subtotal + cargosTotal + ivaTotal;
  const puedeCrear = !!proveedorId && rows.length > 0;
  const [guardando, setGuardando] = useState(false);

  function elegirProveedor(id: string) {
    setProveedorId(id);
    const p = catProv.find((x) => x.id === id);
    if (p) setCurrency(monedaApp(p.currencyCode));
  }

  async function crear(aprobar: boolean) {
    if (!puedeCrear) { toast("Seleccioná un proveedor y agregá al menos una línea.", "error"); return; }
    // Todo cargo con importe debe tener un TIPO válido (Item Charge de BC): sin tipo,
    // BC rechaza el cargo y la orden queda sin el flete. Se bloquea acá.
    if (cargos.some((c) => cargoImporte(c) > 0 && !c.chargeNo)) {
      toast("Elegí el tipo de cargo (transporte) antes de continuar. Sin tipo, BC no acepta el flete.", "error"); return;
    }
    setGuardando(true);
    try {
      const ls: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = rows.map((r) => ({
        tipo: "articulo", articuloId: r.articuloId, variantCode: r.variantCode || undefined, pedidoNumero: "Manual",
        descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen: r.obra,
        precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0, descuentoPct: Number(r.descuento) || 0,
        proyecto: r.obra || undefined,
      }));
      for (const c of cargos) {
        if (cargoImporte(c) <= 0) continue;
        ls.push({ tipo: "cargo", chargeNo: c.chargeNo || undefined, chargeMethod: metodoAsig, descripcion: c.descripcion || "CARGO",
          cantidad: Number(c.cantidad) || 1, unidad: "UND", almacen: rows[0]?.obra ?? "", precioUnitario: Number(c.precio) || 0, ivaPct: 13 });
      }
      const orden = await createOrden({ proveedorId, proveedorNo: provSel?.code, proveedorNombre: provSel?.nombre, currencyCode: currency, almacenRecepcion: almacen, lineas: ls });
      if (aprobar) await setOrdenEstado(orden.id, "pendiente_aprobacion");
      toast(`Orden directa ${orden.numero} ${aprobar ? "enviada a aprobación" : "guardada como abierta"}`, "success");
      router.push(`/proveeduria/ordenes/${orden.id}`);
    } catch (e: any) { toast(String(e?.message ?? e), "error"); setGuardando(false); }
  }

  return (
    <>
      <main className="page page--wide" style={{ paddingBottom: 120 }}>
        <button type="button" className="back-link" onClick={() => router.push("/proveeduria/ordenes")}>Volver a órdenes</button>
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
            <Field label="Almacén de recepción" help="Dónde entra el material en BC (por defecto el General)">
              <Select value={almacen} onChange={(e) => setAlmacen(e.target.value)}>
                {catAlm.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nombre}</option>)}
              </Select>
            </Field>
          </div>
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="row wrap gap-2" style={{ alignItems: "flex-end", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 6%, var(--ds-tint-base))" }}>
            <div style={{ flex: "1 1 280px", minWidth: 220 }}>
              <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Agregar artículo</label>
              <Combobox items={itemsBc} value={qaCode} onChange={(k) => {
                  setQaCode(k);
                  setQaVariantes([]); setQaVariante(""); setQaVariantesError(false);
                  const it = itemsBc.find((x) => x.code === k);
                  if (it?.precioUltimo) setQaPrecio(String(it.precioUltimo)); // respaldo inmediato
                  if (k) {
                    fetch(`/api/bc/lastprice?item=${encodeURIComponent(k)}&vendor=${encodeURIComponent(provSel?.code ?? "")}`)
                      .then((r) => r.json()).then((d) => { if (typeof d.precio === "number" && d.precio > 0) setQaPrecio(String(d.precio)); }).catch(() => {});
                    // Variantes del item: si tiene, se exige elegir una antes de agregar.
                    fetch(`/api/bc/variants?item=${encodeURIComponent(k)}`)
                      .then((r) => (r.ok ? r.json() : { variantes: [], disponible: false }))
                      .then((d) => { setQaVariantes(d.variantes ?? []); setQaVariantesError(d.disponible === false); })
                      .catch(() => { setQaVariantes([]); setQaVariantesError(true); });
                  }
                }} getKey={(i) => i.code} getLabel={(i) => `${i.code} — ${i.descripcion}`} getSearch={(i) => `${i.code} ${i.descripcion}`} minChars={2} placeholder="Buscar artículo del catálogo…" />
            </div>
            {qaVariantes.length > 0 && (
              <div style={{ flex: "0 1 200px", minWidth: 170 }}>
                <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Variante</label>
                <div style={!qaVariante ? { outline: "1.5px solid var(--ds-color-red-100)", borderRadius: 12 } : undefined}>
                  <Combobox items={qaVariantes} value={qaVariante} onChange={(k) => setQaVariante(k)} getKey={(v) => v.code} getLabel={(v) => `${v.code} — ${v.descripcion}`} getSearch={(v) => `${v.code} ${v.descripcion}`} placeholder="Elegí variante…" />
                </div>
              </div>
            )}
            <div><label className="ds-label ds-muted" htmlFor={qtyId} style={{ display: "block", marginBottom: 4 }}>Cantidad</label><Input id={qtyId} type="number" min={0} value={qaQty} onChange={(e) => setQaQty(e.target.value)} placeholder="0" style={{ width: 90 }} /></div>
            <div><label className="ds-label ds-muted" htmlFor={priceId} style={{ display: "block", marginBottom: 4 }}>Precio</label><Input id={priceId} type="number" min={0} value={qaPrecio} onChange={(e) => setQaPrecio(e.target.value)} placeholder="0" style={{ width: 110 }} />{(() => { const it = itemsBc.find((x) => x.code === qaCode); return it?.precioUltimo ? <div className="ds-body-sm ds-muted" style={{ marginTop: 2 }}>últ. compra {money(it.precioUltimo, currency)}</div> : null; })()}</div>
            <Button variant="outline" onClick={agregarLinea} disabled={!qaCode || !(Number(qaQty) > 0) || variantePendiente}>+ Agregar línea</Button>
          </div>
          {qaCode && qaVariantesError && (
            <div role="alert" className="ds-body-sm" style={{ color: "var(--ds-color-red-100)", padding: "0 16px 10px" }}>
              No se pudieron cargar las variantes de este material. Si requiere variante, la orden podría fallar en Business Central.
            </div>
          )}
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Artículo</th><th>Obra</th><th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Desc%</th><th className="ds-num">IVA%</th><th className="ds-num">Importe</th><th></th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8}><div className="empty">Sin líneas. Buscá un artículo del catálogo y agregalo.</div></td></tr>}
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td><div className="ds-truncate" title={r.descripcion} style={{ maxWidth: 220 }}>{r.descripcion}</div><div className="ds-body-sm ds-muted">{r.articuloId}{r.variantCode ? ` · var. ${r.variantCode}${r.variantNombre ? ` (${r.variantNombre})` : ""}` : ""}</div></td>
                    <td><input className="ds-cell-input" aria-label="Obra" value={r.obra} placeholder="—" style={{ width: 92 }} onChange={(e) => setRow(r.key, { obra: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" aria-label="Cantidad" type="number" min={0} value={r.cantidad} style={{ width: 70 }} onChange={(e) => setRow(r.key, { cantidad: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" aria-label="Precio" type="number" min={0} value={r.precio} style={{ width: 92 }} onChange={(e) => setRow(r.key, { precio: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" aria-label="Descuento %" type="number" min={0} max={100} value={r.descuento} style={{ width: 60 }} onChange={(e) => setRow(r.key, { descuento: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" aria-label="IVA %" type="number" min={0} value={r.iva} style={{ width: 56 }} onChange={(e) => setRow(r.key, { iva: e.target.value })} /></td>
                    <td className="ds-num ds-strong">{money(calcImporte(r) || 0, currency)}</td>
                    <td className="ds-num"><button type="button" className="icon-btn" title="Quitar línea" aria-label="Quitar línea" onClick={() => removeRow(r.key)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Cargos de producto (Item Charge): Transporte, Seguro, etc. Se reparten
            entre los artículos al registrar en BC. Igual que al armar la orden
            desde un pedido de compra. */}
        <Card className="mt-4">
          <div className="row row--between wrap gap-3" style={{ alignItems: "center", marginBottom: cargos.length ? 12 : 0 }}>
            <div className="col" style={{ gap: 2 }}>
              <span className="ds-subtitle">Cargos de producto</span>
              <span className="ds-muted ds-body-sm">Transporte, seguro, etc. Se reparten entre los artículos según el método elegido.</span>
            </div>
            <div className="row gap-3 wrap" style={{ alignItems: "flex-end" }}>
              {cargos.length > 0 && (
                <div>
                  <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Método de asignación</span>
                  <Select value={metodoAsig} onChange={(e) => setMetodoAsig(e.target.value)}>
                    <option value="Amount">Por importe</option>
                    <option value="Equally">Equitativo (por línea)</option>
                    <option value="Weight">Por peso</option>
                    <option value="Volume">Por volumen</option>
                  </Select>
                </div>
              )}
              <Button variant="outline" size="sm" onClick={addCargo}>+ Agregar cargo</Button>
            </div>
          </div>
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
              <button type="button" className="icon-btn icon-btn--quitar" title="Quitar cargo" aria-label="Quitar cargo" style={{ marginBottom: 2 }} onClick={() => removeCargo(i)}>×</button>
            </div>
          ))}
        </Card>

        <div className="row mt-6" style={{ justifyContent: "flex-end" }}>
          <div className="totals" style={{ minWidth: 340 }}>
            <div className="totals__row"><span>Subtotal (excl. IVA)</span><span>{money(subtotal, currency)}</span></div>
            <div className="totals__row"><span>Cargos</span><span>{money(cargosTotal, currency)}</span></div>
            <div className="totals__row"><span>IVA</span><span>{money(ivaTotal, currency)}</span></div>
            <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}><span>Total</span><span>{money(total, currency)}</span></div>
          </div>
        </div>
      </main>

      <div className="action-bar">
        <div className="action-bar__inner">
          <span className="ds-muted">{rows.length} línea(s) · <span className="ds-strong">{money(total, currency)}</span></span>
          <div className="row gap-3 action-bar__cta">
            <Button variant="outline" onClick={() => crear(false)} disabled={!puedeCrear || guardando}>Guardar como abierta</Button>
            <Button onClick={() => crear(true)} disabled={!puedeCrear || guardando}>{guardando ? "Enviando…" : "Enviar a aprobación"}</Button>
          </div>
        </div>
      </div>
    </>
  );
}
