"use client";

import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { num, formatDate, ordenLineaImporte } from "@/lib/helpers";

// Datos de la empresa (Adelante) para el encabezado del documento.
const EMPRESA = {
  nombre: "Adelante Desarrollos S.A.",
  dir: ["Contiguo a Condominio Valle Ilios", "30801, El Guarco", "El Guarco, Cartago"],
  tel: "4001-7670",
  web: "",
  email: "facturacion@adelantedesarrollos.com",
  cif: "3-101-621790",
  banco: "BAC",
};

// Formato numérico al estilo del reporte de BC: 1,234.56
const fmt = (n: number, dec = 2) =>
  (n || 0).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

export default function ImprimirOrdenPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id ?? "");
  const { ordenes, proveedores } = useStore();
  const orden = ordenes.find((o) => o.id === id);

  if (!orden) {
    return (
      <div style={{ padding: 40, fontFamily: "Roboto, system-ui, sans-serif" }}>
        Orden no encontrada.{" "}
        <button onClick={() => router.back()} style={{ cursor: "pointer" }}>Volver</button>
      </div>
    );
  }

  const prov = proveedores.find((p) => p.id === orden.proveedorId);
  const cur = orden.currencyCode || "CRC";
  const articulos = orden.lineas.filter((l) => l.tipo === "articulo");
  const cargos = orden.lineas.filter((l) => l.tipo === "cargo");
  const lineas = [...articulos, ...cargos];
  const subtotal = orden.lineas.reduce((s, l) => s + ordenLineaImporte(l), 0);
  const ivaPct = articulos.find((l) => (l.ivaPct ?? 0) > 0)?.ivaPct ?? 13;
  const iva = orden.lineas.reduce((s, l) => s + ordenLineaImporte(l) * ((l.ivaPct ?? 0) / 100), 0);
  const total = subtotal + iva;

  const Campo = ({ k, v, b }: { k: string; v: React.ReactNode; b?: boolean }) => (
    <div style={{ display: "flex", gap: 12, marginBottom: 3 }}>
      <span style={{ minWidth: 150, color: "#222" }}>{k}</span>
      <span style={{ fontWeight: b ? 700 : 400 }}>{v}</span>
    </div>
  );
  const CampoR = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 3 }}>
      <span>{k}</span><span style={{ textAlign: "right" }}>{v}</span>
    </div>
  );

  return (
    <div className="po-root">
      <style>{`
        .po-root { background:#e9eaec; min-height:100vh; padding:24px; font-family:"Segoe UI",Roboto,system-ui,sans-serif; color:#1a1a1a; }
        .po-toolbar { max-width:820px; margin:0 auto 16px; display:flex; gap:10px; justify-content:flex-end; }
        .po-btn { cursor:pointer; border:none; border-radius:999px; padding:10px 18px; font:inherit; font-weight:600; }
        .po-btn--primary { background:#9ec813; color:#1a1a1a; }
        .po-btn--ghost { background:#fff; border:1.5px solid #d6d8dc; color:#1a1a1a; }
        .po-page { max-width:820px; margin:0 auto; background:#fff; padding:40px 46px; box-shadow:0 2px 18px rgba(0,0,0,.10); font-size:11.5px; line-height:1.45; }
        .po-head { display:flex; justify-content:space-between; align-items:flex-start; }
        .po-doc { text-align:right; }
        .po-doc h1 { margin:0; font-size:26px; font-weight:800; letter-spacing:.5px; }
        .po-doc .pag { color:#555; margin-top:10px; }
        .po-cols { display:flex; justify-content:space-between; gap:40px; margin-top:26px; }
        .po-col-l { flex:1; }
        .po-col-r { width:300px; }
        .po-empresa { text-align:right; margin-bottom:14px; }
        .po-empresa b { font-size:13px; }
        .po-prov { font-weight:700; font-size:13px; margin-bottom:10px; }
        table.po-tbl { width:100%; border-collapse:collapse; margin-top:30px; font-size:11px; }
        table.po-tbl thead th { border-top:1.5px solid #1a1a1a; border-bottom:1.5px solid #1a1a1a; padding:7px 6px; text-align:left; vertical-align:bottom; font-weight:700; }
        table.po-tbl thead th.n { text-align:right; }
        table.po-tbl tbody td { padding:6px 6px; vertical-align:top; border-bottom:1px solid #ededed; }
        table.po-tbl tbody td.n { text-align:right; white-space:nowrap; }
        .po-tot { margin-top:18px; margin-left:auto; width:330px; }
        .po-tot .r { display:flex; justify-content:space-between; padding:5px 0; }
        .po-tot .r.sub { border-top:1.5px solid #1a1a1a; }
        .po-tot .r.grand { border-top:1.5px solid #1a1a1a; border-bottom:3px double #1a1a1a; font-weight:800; font-size:13px; }
        .po-ivaspec { margin-top:34px; font-size:10.5px; }
        .po-ivaspec h4 { margin:0 0 8px; font-size:12px; }
        .po-ivaspec table { width:100%; border-collapse:collapse; }
        .po-ivaspec th { text-align:right; padding:4px 6px; border-bottom:1.5px solid #1a1a1a; font-weight:700; }
        .po-ivaspec th:first-child { text-align:left; }
        .po-ivaspec td { text-align:right; padding:4px 6px; }
        .po-ivaspec td:first-child { text-align:left; }
        .po-ivaspec tr.tot td { border-top:1.5px solid #1a1a1a; font-weight:700; }
        .po-firmas { margin-top:54px; display:flex; gap:48px; }
        .po-firmas .f { flex:1; border-top:1.4px solid #777; padding-top:6px; text-align:center; color:#555; font-size:10.5px; }
        @media print {
          .po-root { background:#fff; padding:0; }
          .po-toolbar { display:none; }
          .po-page { box-shadow:none; max-width:none; margin:0; padding:14mm 13mm; }
          @page { size:A4; margin:0; }
        }
      `}</style>

      <div className="po-toolbar">
        <button className="po-btn po-btn--ghost" onClick={() => router.back()}>‹ Volver</button>
        <button className="po-btn po-btn--primary" onClick={() => window.print()}>🖨️ Imprimir / Guardar PDF</button>
      </div>

      <div className="po-page">
        {/* encabezado: logo + título */}
        <div className="po-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="46" height="40" viewBox="0 0 46 40" aria-hidden>
              <path d="M4 30 C14 6 26 4 42 4 C30 12 26 24 22 36 C16 30 10 30 4 30 Z" fill="#7faf1b" />
              <path d="M2 36 C12 18 24 16 38 16 C28 22 24 30 21 38 C15 34 9 35 2 36 Z" fill="#9ec813" />
            </svg>
            <div style={{ fontWeight: 800, letterSpacing: 1, color: "#5f7d12", fontSize: 13, lineHeight: 1 }}>
              ADELANTE<br /><span style={{ fontSize: 8, letterSpacing: 3, color: "#888" }}>DESARROLLOS</span>
            </div>
          </div>
          <div className="po-doc">
            <h1>Pedido</h1>
            <div className="pag">Orden de compra · Pág. 1</div>
          </div>
        </div>

        {/* dos columnas: proveedor + datos / empresa */}
        <div className="po-cols">
          <div className="po-col-l">
            <div className="po-prov">{orden.proveedorNombre ?? prov?.nombre ?? "—"}</div>
            <Campo k="Compra a-Nº proveedor" v={orden.proveedorNo ?? prov?.code ?? "—"} />
            <div style={{ height: 14 }} />
            <Campo k="Nº pedido" v={orden.numero} b />
            <Campo k="Fecha emisión documento" v={formatDate(orden.fecha)} />
            {prov?.paymentTermsCode && <Campo k="Términos pago" v={prov.paymentTermsCode} />}
            <Campo k="Moneda" v={cur} />
            <div style={{ height: 14 }} />
            <Campo k="Almacén entrega" v={articulos[0]?.almacen ?? "—"} />
          </div>
          <div className="po-col-r">
            <div className="po-empresa">
              <div><b>{EMPRESA.nombre}</b></div>
              {EMPRESA.dir.map((d) => <div key={d}>{d}</div>)}
            </div>
            <CampoR k="Nº teléfono" v={EMPRESA.tel} />
            <CampoR k="Correo electrónico" v={EMPRESA.email} />
            <CampoR k="CIF/NIF" v={EMPRESA.cif} />
            <CampoR k="Banco" v={EMPRESA.banco} />
          </div>
        </div>

        {/* tabla de líneas */}
        <table className="po-tbl">
          <thead>
            <tr>
              <th style={{ width: 78 }}>Nº</th>
              <th>Descripción</th>
              <th className="n" style={{ width: 44 }}>Cant.</th>
              <th style={{ width: 80 }}>Unidad<br />medida</th>
              <th className="n" style={{ width: 88 }}>Coste unit.<br />directo</th>
              <th className="n" style={{ width: 54 }}>% Desc.</th>
              <th className="n" style={{ width: 96 }}>Importe</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.id}>
                <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{l.tipo === "cargo" ? "—" : (l.articuloId || "")}</td>
                <td>{l.descripcion}</td>
                <td className="n">{num.format(l.cantidad)}</td>
                <td>{l.unidad}</td>
                <td className="n">{fmt(l.precioUnitario)}</td>
                <td className="n">{(l.descuentoPct ?? 0) > 0 ? fmt(l.descuentoPct!, 0) : ""}</td>
                <td className="n">{fmt(ordenLineaImporte(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* totales */}
        <div className="po-tot">
          <div className="r sub"><span>Total {cur} sin IVA</span><span>{fmt(subtotal)}</span></div>
          <div className="r"><span>{ivaPct}% IVA</span><span>{fmt(iva)}</span></div>
          <div className="r grand"><span>Total {cur} con IVA</span><span>{fmt(total)}</span></div>
        </div>

        {/* desglose de IVA (como en BC) */}
        <div className="po-ivaspec">
          <h4>Especificación importe IVA</h4>
          <table>
            <thead>
              <tr>
                <th>Identif. IVA</th><th>% IVA</th><th>Importe línea</th><th>Base IVA</th><th>Importe IVA</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>IVA{ivaPct}</td><td>{ivaPct}</td><td>{fmt(subtotal)}</td><td>{fmt(subtotal)}</td><td>{fmt(iva)}</td>
              </tr>
              <tr className="tot">
                <td>Total</td><td></td><td>{fmt(subtotal)}</td><td>{fmt(subtotal)}</td><td>{fmt(iva)}</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
