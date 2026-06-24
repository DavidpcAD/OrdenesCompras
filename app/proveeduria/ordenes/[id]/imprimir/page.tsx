"use client";

import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { money, num, formatDate, ordenLineaImporte } from "@/lib/helpers";

// Datos de la empresa (Adelante) para el encabezado del documento.
const EMPRESA = {
  nombre: "Adelante Desarrollos S.A.",
  dir: ["Contiguo a Condominio Valle Ilios", "30801, El Guarco", "Cartago, Costa Rica"],
  tel: "4001-7670",
  email: "facturacion@adelantedesarrollos.com",
  cedula: "3-101-621790",
  banco: "BAC",
};

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
  const cur = orden.currencyCode || "";
  const articulos = orden.lineas.filter((l) => l.tipo === "articulo");
  const cargos = orden.lineas.filter((l) => l.tipo === "cargo");
  const lineas = [...articulos, ...cargos];
  const subtotal = orden.lineas.reduce((s, l) => s + ordenLineaImporte(l), 0);
  const iva = orden.lineas.reduce((s, l) => s + ordenLineaImporte(l) * ((l.ivaPct ?? 0) / 100), 0);
  const total = subtotal + iva;
  const ivaPctMostrar = articulos.find((l) => (l.ivaPct ?? 0) > 0)?.ivaPct ?? 13;

  return (
    <div className="po-root">
      <style>{`
        .po-root { background: #f3f4f6; min-height: 100vh; padding: 24px; font-family: Roboto, system-ui, sans-serif; color: #1f2328; }
        .po-toolbar { max-width: 800px; margin: 0 auto 16px; display: flex; gap: 10px; justify-content: flex-end; }
        .po-btn { cursor: pointer; border: none; border-radius: 999px; padding: 10px 18px; font: inherit; font-weight: 600; }
        .po-btn--primary { background: #add010; color: #1f2328; }
        .po-btn--ghost { background: #fff; color: #1f2328; border: 1.5px solid #e5e7eb; }
        .po-page { max-width: 800px; margin: 0 auto; background: #fff; padding: 44px 48px; box-shadow: 0 2px 18px rgba(0,0,0,.08); border-radius: 4px; }
        .po-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
        .po-title { font-size: 30px; font-weight: 800; letter-spacing: .5px; margin: 0; }
        .po-title small { display: block; font-size: 13px; font-weight: 600; color: #6b7280; letter-spacing: 2px; margin-top: 2px; }
        .po-logo { width: 40px; height: 40px; border-radius: 10px; background: #add010; color:#1f2328; font-weight: 800; font-size: 22px; display:inline-flex; align-items:center; justify-content:center; margin-bottom: 8px; }
        .po-empresa { text-align: right; font-size: 12px; line-height: 1.5; color: #374151; }
        .po-empresa b { font-size: 14px; color:#1f2328; }
        .po-accent { height: 4px; background: #add010; border-radius: 2px; margin: 18px 0; }
        .po-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 8px; }
        .po-box-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 4px; }
        .po-prov-name { font-size: 16px; font-weight: 700; }
        .po-kv { font-size: 12.5px; line-height: 1.8; }
        .po-kv .k { color: #6b7280; display: inline-block; min-width: 120px; }
        table.po-tbl { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 12px; }
        table.po-tbl thead th { background: #1f2328; color: #fff; text-align: left; padding: 8px 8px; font-weight: 600; font-size: 11px; }
        table.po-tbl thead th.n { text-align: right; }
        table.po-tbl tbody td { padding: 7px 8px; border-bottom: 1px solid #eef0f2; vertical-align: top; }
        table.po-tbl tbody td.n { text-align: right; white-space: nowrap; }
        table.po-tbl tbody tr:nth-child(even) td { background: #fafbfc; }
        .po-code { font-weight: 600; color: #374151; white-space: nowrap; }
        .po-tot { margin-top: 18px; display: flex; justify-content: flex-end; }
        .po-tot table { font-size: 13px; min-width: 280px; }
        .po-tot td { padding: 6px 4px; }
        .po-tot td.n { text-align: right; font-variant-numeric: tabular-nums; }
        .po-tot tr.grand td { border-top: 2px solid #1f2328; font-weight: 800; font-size: 15px; padding-top: 10px; }
        .po-foot { margin-top: 40px; display: flex; justify-content: space-between; gap: 40px; font-size: 11px; color: #6b7280; }
        .po-sign { flex: 1; }
        .po-sign .line { border-top: 1.5px solid #9ca3af; margin-top: 38px; padding-top: 6px; text-align: center; }
        @media print {
          .po-root { background: #fff; padding: 0; }
          .po-toolbar { display: none; }
          .po-page { box-shadow: none; max-width: none; margin: 0; padding: 18mm 16mm; border-radius: 0; }
          @page { size: A4; margin: 0; }
        }
      `}</style>

      <div className="po-toolbar">
        <button className="po-btn po-btn--ghost" onClick={() => router.back()}>‹ Volver</button>
        <button className="po-btn po-btn--primary" onClick={() => window.print()}>🖨️ Imprimir / Guardar PDF</button>
      </div>

      <div className="po-page">
        <div className="po-top">
          <div>
            <h1 className="po-title">ORDEN DE COMPRA<small>PEDIDO AL PROVEEDOR</small></h1>
          </div>
          <div className="po-empresa">
            <div className="po-logo">A</div>
            <div><b>{EMPRESA.nombre}</b></div>
            {EMPRESA.dir.map((d) => <div key={d}>{d}</div>)}
            <div>Tel. {EMPRESA.tel}</div>
            <div>{EMPRESA.email}</div>
            <div>Céd. jurídica {EMPRESA.cedula}</div>
            <div>Banco {EMPRESA.banco}</div>
          </div>
        </div>

        <div className="po-accent" />

        <div className="po-meta">
          <div>
            <div className="po-box-label">Proveedor</div>
            <div className="po-prov-name">{prov?.nombre ?? "—"}</div>
            <div className="po-kv"><span className="k">Nº proveedor</span> {prov?.code ?? "—"}</div>
          </div>
          <div>
            <div className="po-kv"><span className="k">Nº pedido</span> <b>{orden.numero}</b></div>
            <div className="po-kv"><span className="k">Fecha emisión</span> {formatDate(orden.fecha)}</div>
            <div className="po-kv"><span className="k">Moneda</span> {cur || "CRC (colones)"}</div>
            <div className="po-kv"><span className="k">Almacén entrega</span> {articulos[0]?.almacen ?? "—"}</div>
            {prov?.paymentTermsCode && <div className="po-kv"><span className="k">Términos pago</span> {prov.paymentTermsCode}</div>}
          </div>
        </div>

        <table className="po-tbl">
          <thead>
            <tr>
              <th style={{ width: 84 }}>Nº</th>
              <th>Descripción</th>
              <th className="n" style={{ width: 52 }}>Cant.</th>
              <th style={{ width: 78 }}>Unidad</th>
              <th className="n" style={{ width: 92 }}>Coste unit.</th>
              <th className="n" style={{ width: 56 }}>% Desc.</th>
              <th className="n" style={{ width: 104 }}>Importe</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.id}>
                <td className="po-code">{l.tipo === "cargo" ? "CARGO" : (l.articuloId || "")}</td>
                <td>{l.descripcion}{l.pedidoNumero ? <div style={{ color: "#9ca3af", fontSize: 10.5 }}>{l.pedidoNumero}</div> : null}</td>
                <td className="n">{num.format(l.cantidad)}</td>
                <td>{l.unidad}</td>
                <td className="n">{money(l.precioUnitario, cur)}</td>
                <td className="n">{(l.descuentoPct ?? 0) > 0 ? `${l.descuentoPct}%` : "—"}</td>
                <td className="n">{money(ordenLineaImporte(l), cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="po-tot">
          <table>
            <tbody>
              <tr><td>Subtotal (excl. IVA)</td><td className="n">{money(subtotal, cur)}</td></tr>
              <tr><td>{ivaPctMostrar}% IVA</td><td className="n">{money(iva, cur)}</td></tr>
              <tr className="grand"><td>Total{cur ? ` ${cur}` : " CRC"}</td><td className="n">{money(total, cur)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="po-foot">
          <div className="po-sign"><div className="line">Elaborado por (Proveeduría)</div></div>
          <div className="po-sign"><div className="line">Autorizado por</div></div>
        </div>
      </div>
    </div>
  );
}
