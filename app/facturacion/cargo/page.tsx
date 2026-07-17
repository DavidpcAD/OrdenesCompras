"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Button, Card, Field, Input, Select, useToast } from "@/components/ui";
import { Combobox } from "@/components/combobox";
import { DateField } from "@/components/date-field";
import { useStore } from "@/lib/store";
import { money } from "@/lib/helpers";

// Línea de recepción registrada (albarán) tal como la devuelve
// /api/bc/recepciones-registradas.
type RcptLine = {
  documentNo: string; lineNo: number; vendorNo: string; itemNo: string;
  descripcion: string; locationCode: string; cantidad: number;
  precioUnitario: number; importe: number; pesoBruto: number; volumen: number; fecha: string;
};
const lineKey = (l: { documentNo: string; lineNo: number }) => `${l.documentNo}#${l.lineNo}`;

type Vendor = { id: string; code: string; nombre: string; currencyCode: string };

// Cargo de producto (flete/transporte facturado por un TERCERO) sobre líneas de
// recepciones YA REGISTRADAS. Caso: el material lo facturó su proveedor, pero el
// transporte lo trajo y factura otra empresa. Se genera un pedido con SOLO la
// línea de cargo y se asigna a las líneas de la(s) recepción(es), luego se registra.
export default function CargoSobreFacturaPage() {
  const { proveedores } = useStore();
  const router = useRouter();
  const toast = useToast();

  // --- Catálogos BC (proveedores + tipos de cargo) ---
  const [bcProv, setBcProv] = useState<Vendor[] | null>(null);
  const [itemCharges, setItemCharges] = useState<{ no: string; descripcion: string }[]>([]);
  useEffect(() => {
    fetch("/api/bc/vendors")
      .then((r) => (r.ok ? r.json() : { proveedores: [] }))
      .then((d) => { if (Array.isArray(d.proveedores) && d.proveedores.length) setBcProv(d.proveedores); })
      .catch(() => { /* sin BC: cae al catálogo de respaldo */ });
    fetch("/api/bc/itemcharges")
      .then((r) => (r.ok ? r.json() : { itemCharges: [] }))
      .then((d) => { if (Array.isArray(d.itemCharges)) setItemCharges(d.itemCharges); })
      .catch(() => { /* sin BC: el selector cae a "Flete / transporte" */ });
  }, []);
  const catProv = (bcProv ?? proveedores) as Vendor[];

  // --- Datos del cargo (proveedor del transporte + factura) ---
  const [chargeVendorId, setChargeVendorId] = useState("");
  const [currency, setCurrency] = useState("");
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const chargeVendor = catProv.find((v) => v.id === chargeVendorId);

  const [chargeNo, setChargeNo] = useState("");
  const [chargeDescripcion, setChargeDescripcion] = useState("FLETE / TRANSPORTE");
  const [cantidad, setCantidad] = useState("1");
  const [precio, setPrecio] = useState("");
  const cargoTotal = (Number(cantidad) || 0) * (Number(precio) || 0);
  const onTipoCargo = (no: string) => {
    setChargeNo(no);
    const ic = itemCharges.find((x) => x.no === no);
    setChargeDescripcion(ic ? ic.descripcion : "FLETE / TRANSPORTE");
  };

  function elegirProveedor(id: string, item: Vendor | null) {
    setChargeVendorId(id);
    if (item) setCurrency(item.currencyCode ?? "");
  }

  // --- Búsqueda de líneas de recepción registradas (material a cargar) ---
  const [matVendorId, setMatVendorId] = useState("");
  const [matItem, setMatItem] = useState("");
  const [docNo, setDocNo] = useState("");
  const matVendor = catProv.find((v) => v.id === matVendorId);

  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [resultados, setResultados] = useState<RcptLine[]>([]);
  const [buscarError, setBuscarError] = useState<string | null>(null);

  // Selección persistente por clave documentNo#lineNo (guarda la línea completa
  // para no perder los datos al re-buscar con otro filtro).
  const [seleccion, setSeleccion] = useState<Record<string, RcptLine>>({});
  const toggleLinea = (l: RcptLine) => setSeleccion((s) => {
    const k = lineKey(l); const next = { ...s };
    if (next[k]) delete next[k]; else next[k] = l;
    return next;
  });
  const lineasSel = useMemo(() => Object.values(seleccion), [seleccion]);

  async function buscar() {
    const vendorCode = matVendor?.code ?? "";
    if (!vendorCode && !matItem.trim() && !docNo.trim()) {
      toast("Poné al menos un filtro: proveedor del material, artículo o N.º de recepción.", "error");
      return;
    }
    setBuscando(true); setBuscarError(null);
    try {
      const qs = new URLSearchParams();
      if (vendorCode) qs.set("vendor", vendorCode);
      if (matItem.trim()) qs.set("item", matItem.trim());
      if (docNo.trim()) qs.set("doc", docNo.trim());
      const r = await fetch(`/api/bc/recepciones-registradas?${qs.toString()}`);
      const d = await r.json();
      setResultados(Array.isArray(d.lineas) ? d.lineas : []);
      if (d.error) setBuscarError(String(d.error));
      setBuscado(true);
    } catch (e: any) {
      setResultados([]); setBuscarError(String(e?.message ?? e)); setBuscado(true);
    } finally {
      setBuscando(false);
    }
  }

  // --- Reparto del cargo entre las líneas seleccionadas (preview) ---
  const [metodo, setMetodo] = useState("Amount"); // Amount|Equally|Weight|Volume
  const previewReparto = metodo === "Amount" || metodo === "Equally";
  const importeSel = lineasSel.reduce((s, l) => s + (l.importe || 0), 0);
  const share = (l: RcptLine) => {
    if (cargoTotal <= 0 || !lineasSel.length) return 0;
    if (metodo === "Equally") return cargoTotal / lineasSel.length;
    if (metodo === "Amount") return importeSel > 0 ? cargoTotal * (l.importe || 0) / importeSel : 0;
    return 0; // Weight / Volume → lo calcula BC
  };

  const puedeRegistrar = !!chargeVendorId && !!vendorInvoiceNo.trim() && !!chargeNo && cargoTotal > 0 && lineasSel.length > 0;

  const [registrando, setRegistrando] = useState(false);
  async function registrar() {
    if (!chargeVendorId) { toast("Elegí el proveedor del cargo (transporte).", "error"); return; }
    if (!vendorInvoiceNo.trim()) { toast("El N.º de factura del proveedor es obligatorio para registrar.", "error"); return; }
    if (!chargeNo) { toast("Elegí el tipo de cargo de producto.", "error"); return; }
    if (!(cargoTotal > 0)) { toast("El importe del cargo debe ser mayor que 0.", "error"); return; }
    if (!lineasSel.length) { toast("Seleccioná al menos una línea de recepción.", "error"); return; }
    setRegistrando(true);
    try {
      const r = await fetch("/api/bc/cargo-recibido", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeVendorNo: chargeVendor?.code,
          vendorInvoiceNo: vendorInvoiceNo.trim(),
          documentDate: documentDate || undefined,
          currencyCode: currency || undefined,
          chargeNo,
          chargeDescription: chargeDescripcion,
          cantidad: Number(cantidad) || 1,
          precio: Number(precio) || 0,
          metodo,
          receiptLines: lineasSel.map((l) => ({ documentNo: l.documentNo, lineNo: l.lineNo })),
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `Error ${r.status}`);
      toast(`Cargo registrado en BC (${d.resultado ?? "OK"}).`, "success");
      // Limpiar para un nuevo registro.
      setVendorInvoiceNo(""); setPrecio(""); setSeleccion({}); setResultados([]); setBuscado(false); setDocNo("");
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <AppShell role="facturacion">
      <main className="page page--wide" style={{ paddingBottom: 120 }}>
        <div className="back-link" onClick={() => router.push("/facturacion")}>Volver a órdenes por recibir</div>
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Cargo sobre factura recibida</h1>
            <p className="ds-muted">Para cuando un tercero factura aparte (p. ej. el transporte de un material ya recibido). Se crea el pedido con solo la línea de cargo y se asigna a las líneas de la recepción ya registrada.</p>
          </div>
        </div>

        {/* 1 · Datos del cargo (proveedor del transporte + su factura) */}
        <Card>
          <h3 className="ds-subtitle" style={{ marginBottom: 4 }}>1 · Proveedor del cargo y factura</h3>
          <p className="ds-muted ds-body-sm" style={{ marginTop: 0, marginBottom: 16 }}>El proveedor que factura el cargo (transportista), no el del material.</p>
          <div className="grid-3">
            <Field label="Proveedor del cargo" help="Quien factura el flete/transporte">
              <Combobox items={catProv} value={chargeVendorId} onChange={elegirProveedor}
                getKey={(p) => p.id} getLabel={(p) => `${p.code} — ${p.nombre}`}
                getSearch={(p) => `${p.code} ${p.nombre}`} placeholder="Buscar proveedor…" />
            </Field>
            <Field label="N.º factura proveedor" help="Obligatorio para registrar en BC">
              <Input value={vendorInvoiceNo} placeholder="Ej. FE-000123" onChange={(e) => setVendorInvoiceNo(e.target.value)} />
            </Field>
            <Field label="Moneda">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="">CRC (colones)</option>
                <option value="USD">USD (dólares)</option>
              </Select>
            </Field>
            <Field label="Fecha de emisión">
              <DateField value={documentDate} onChange={setDocumentDate} placeholder="Fecha de la factura" />
            </Field>
          </div>
        </Card>

        {/* 2 · La línea de cargo (tipo, cantidad, precio) */}
        <Card className="mt-4">
          <h3 className="ds-subtitle" style={{ marginBottom: 16 }}>2 · Cargo de producto</h3>
          <div className="row gap-3 wrap" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 260px", minWidth: 220 }}>
              <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Tipo de cargo</span>
              <Select value={chargeNo} onChange={(e) => onTipoCargo(e.target.value)}>
                <option value="">Flete / transporte</option>
                {itemCharges.map((ic) => <option key={ic.no} value={ic.no}>{ic.no} · {ic.descripcion}</option>)}
              </Select>
            </div>
            <div>
              <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Cantidad</span>
              <Input type="number" min={0} value={cantidad} style={{ width: 96 }} onChange={(e) => setCantidad(e.target.value)} />
            </div>
            <div>
              <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Precio</span>
              <Input type="number" min={0} value={precio} placeholder="0" style={{ width: 150 }} onChange={(e) => setPrecio(e.target.value)} />
            </div>
            <div style={{ minWidth: 130, textAlign: "right" }}>
              <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Importe del cargo</span>
              <span className="ds-strong" style={{ fontSize: 18 }}>{money(cargoTotal || 0, currency)}</span>
            </div>
          </div>
        </Card>

        {/* 3 · Buscar y seleccionar líneas de recepción registradas */}
        <Card className="mt-4">
          <h3 className="ds-subtitle" style={{ marginBottom: 4 }}>3 · Líneas de la recepción a cargar</h3>
          <p className="ds-muted ds-body-sm" style={{ marginTop: 0, marginBottom: 16 }}>Buscá las líneas de la recepción ya registrada (albarán) a las que se les reparte el cargo.</p>
          <div className="row gap-3 wrap" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 260px", minWidth: 220 }}>
              <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Proveedor del material</span>
              <Combobox items={catProv} value={matVendorId} onChange={(k) => setMatVendorId(k)}
                getKey={(p) => p.id} getLabel={(p) => `${p.code} — ${p.nombre}`}
                getSearch={(p) => `${p.code} ${p.nombre}`} placeholder="Buscar proveedor…" />
            </div>
            <div>
              <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Artículo (N.º)</span>
              <Input value={matItem} placeholder="Ej. M04-0038" style={{ width: 150 }} onChange={(e) => setMatItem(e.target.value)} />
            </div>
            <div>
              <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>N.º recepción</span>
              <Input value={docNo} placeholder="Ej. CR-000003" style={{ width: 150 }} onChange={(e) => setDocNo(e.target.value)} />
            </div>
            <Button onClick={buscar} disabled={buscando}>{buscando ? "Buscando…" : "Buscar líneas"}</Button>
          </div>

          {buscado && (
            <div className="mt-4">
              {buscarError && (
                <div className="ds-body-sm" style={{ color: "var(--ds-color-red-200)", marginBottom: 8 }}>
                  No se pudieron traer las líneas de recepción de BC. {buscarError}
                </div>
              )}
              {resultados.length === 0 ? (
                <div className="empty" style={{ padding: "16px 0" }}>
                  {buscarError ? "La API de recepciones registradas aún no responde (¿extensión BC publicada?)." : "No hay líneas de recepción para ese filtro."}
                </div>
              ) : (
                <div className="ds-table-wrap" style={{ boxShadow: "none", maxHeight: 420, overflow: "auto" }}>
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}></th>
                        <th>Recepción</th><th>Artículo</th><th>Descripción</th><th>Almacén</th>
                        <th className="ds-num">Cantidad</th><th className="ds-num">Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultados.map((l) => {
                        const checked = !!seleccion[lineKey(l)];
                        return (
                          <tr key={lineKey(l)} style={checked ? { background: "color-mix(in srgb, var(--ds-color-green-100) 8%, #fff)" } : undefined}>
                            <td className="ds-num"><input type="checkbox" className="ds-cbx" checked={checked} onChange={() => toggleLinea(l)} /></td>
                            <td className="ds-body-sm ds-strong">{l.documentNo}<span className="ds-muted"> · {l.lineNo}</span></td>
                            <td className="ds-body-sm">{l.itemNo}</td>
                            <td><div className="ds-truncate" title={l.descripcion} style={{ maxWidth: 240 }}>{l.descripcion}</div></td>
                            <td className="ds-muted ds-body-sm">{l.locationCode}</td>
                            <td className="ds-num ds-body-sm">{l.cantidad}</td>
                            <td className="ds-num ds-strong">{money(l.importe || 0, currency)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* 4 · Método de reparto + preview sobre las líneas seleccionadas */}
        {lineasSel.length > 0 && (
          <Card className="mt-4">
            <div className="row row--between wrap gap-3" style={{ alignItems: "center", marginBottom: 12 }}>
              <div className="col" style={{ gap: 2 }}>
                <span className="ds-subtitle">4 · Reparto del cargo</span>
                <span className="ds-muted ds-body-sm">{lineasSel.length} línea(s) seleccionada(s) · cargo {money(cargoTotal, currency)}</span>
              </div>
              <div>
                <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Método de asignación</span>
                <Select value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                  <option value="Amount">Por importe</option>
                  <option value="Equally">Igualmente</option>
                  <option value="Weight">Por peso</option>
                  <option value="Volume">Por volumen</option>
                </Select>
              </div>
            </div>
            <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Recepción</th><th>Artículo</th><th className="ds-num">Importe línea</th><th className="ds-num">Cargo asignado</th><th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lineasSel.map((l) => (
                    <tr key={lineKey(l)}>
                      <td className="ds-body-sm ds-strong">{l.documentNo}<span className="ds-muted"> · {l.lineNo}</span></td>
                      <td className="ds-body-sm"><div className="ds-truncate" title={l.descripcion} style={{ maxWidth: 240 }}>{l.itemNo} — {l.descripcion}</div></td>
                      <td className="ds-num ds-body-sm">{money(l.importe || 0, currency)}</td>
                      <td className="ds-num ds-strong">{previewReparto ? money(share(l), currency) : "—"}</td>
                      <td className="ds-num"><button type="button" className="icon-btn" title="Quitar" onClick={() => toggleLinea(l)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="ds-body-sm ds-muted" style={{ padding: "10px 16px", borderTop: "1.5px solid var(--ds-color-gray-100)" }}>
                      El cargo ({money(cargoTotal, currency)}) se reparte {
                        metodo === "Equally" ? "en partes iguales entre las líneas"
                        : metodo === "Weight" ? "por peso (lo calcula BC al registrar; no se previsualiza acá)"
                        : metodo === "Volume" ? "por volumen (lo calcula BC al registrar; no se previsualiza acá)"
                        : "proporcional al importe de cada línea"
                      }.
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )}
      </main>

      <div className="action-bar">
        <div className="action-bar__inner">
          <span className="ds-muted">
            {lineasSel.length} línea(s) · cargo <span className="ds-strong">{money(cargoTotal, currency)}</span>
            {chargeVendor && <> · a <span className="ds-strong">{chargeVendor.nombre}</span></>}
          </span>
          <div className="row gap-3">
            <Button variant="red" onClick={registrar} disabled={!puedeRegistrar || registrando}>
              {registrando ? "Registrando…" : "Registrar cargo en BC"}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
