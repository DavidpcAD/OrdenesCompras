"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { num, formatDate, ordenLineaImporte, numeroOrden } from "@/lib/helpers";
import { documentoDeOrden, destinoLineaDoc, etiquetaUnidad } from "@/lib/orden-doc";
import { useVariantes } from "@/lib/use-variantes";
import { Button } from "@/components/ui";
import { AdelanteMark } from "@/components/icons";

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
  const { ordenes, proveedores, cargando } = useStore();
  const orden = ordenes.find((o) => o.id === id);

  // El navegador propone el TÍTULO del documento como nombre del archivo al guardar
  // como PDF. Sin esto el archivo salía con el título genérico de la app, y había que
  // renombrarlo a mano para saber de qué orden era.
  const numeroTitulo = orden?.bcNumber || orden?.numero;   // para el título de la pestaña
  useEffect(() => {
    if (!numeroTitulo) return;
    const previo = document.title;
    document.title = `${numeroTitulo} · Orden de compra · Adelante`;
    return () => { document.title = previo; };
  }, [numeroTitulo]);

  // Descripciones de unidad de BC ("EST" -> "ESTAÑON"), las mismas que imprime el PDF
  // del servidor. Mientras cargan se ve el código; no hay salto de layout.
  const [unidadesBc, setUnidadesBc] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/bc/unidades").then((r) => (r.ok ? r.json() : { unidades: {} }))
      .then((d) => setUnidadesBc(d.unidades ?? {})).catch(() => {});
  }, []);
  // Nombre de la variante de cada línea, igual que en el PDF del servidor: el material
  // de BC es genérico y lo que hay que despachar es la variante.
  //
  // OJO: los hooks van ACÁ, antes de los returns tempranos de abajo. Estaban después,
  // y eso reventaba ("rendered more hooks than during the previous render") cuando la
  // orden no estaba en el store en el primer render y llegaba en el segundo.
  const variantes = useVariantes((orden?.lineas ?? []).map((l) => l.articuloId));

  if (!orden) {
    // Durante la carga (SQL/BC) el store aún está vacío: no mostrar "no encontrada".
    if (cargando) {
      return <div style={{ padding: 40, fontFamily: "var(--ds-font-family)", color: "var(--ds-color-gray-500)" }}>Cargando la orden…</div>;
    }
    return (
      <div style={{ padding: 40, fontFamily: "var(--ds-font-family)", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--ds-space-4)" }}>
        <span>Orden no encontrada.</span>
        <Button variant="outline" size="sm" onClick={() => router.back()}>Volver</Button>
      </div>
    );
  }

  // El PDF que se envía al proveedor solo se genera si la orden fue APROBADA
  // (Lanzada en BC) — o ya completada. Bloquea también la navegación directa por URL.
  if (orden.estado !== "lanzado" && orden.estado !== "completado") {
    return (
      <div style={{ padding: 40, fontFamily: "var(--ds-font-family)", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--ds-space-4)" }}>
        <span style={{ fontWeight: 700 }}>El PDF para el proveedor aún no está disponible.</span>
        <span style={{ color: "var(--ds-color-gray-500)", maxWidth: 540 }}>La orden <strong>{numeroOrden(orden)}</strong> debe estar <strong>aprobada (Lanzada)</strong> antes de generar el documento que se envía al proveedor.</span>
        <Button variant="outline" size="sm" onClick={() => router.back()}>Volver</Button>
      </div>
    );
  }

  const prov = proveedores.find((p) => p.id === orden.proveedorId);
  // Los números del documento salen de UN solo lugar, compartido con el PDF que
  // genera el servidor: si cada uno los calculara, un día dirían cosas distintas.
  const { numeroDoc, moneda: cur, lineas, almacenUnico, subtotal, iva, ivaPct, total, porTasaIva, unidades } = documentoDeOrden(orden, unidadesBc);
  const destinoLinea = destinoLineaDoc;

  const Campo = ({ k, v, b }: { k: string; v: React.ReactNode; b?: boolean }) => (
    <div style={{ display: "flex", gap: 12, marginBottom: 3 }}>
      <span style={{ minWidth: 150, color: "var(--ds-color-black)" }}>{k}</span>
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
        .po-root { background:var(--ds-color-gray-100); min-height:100vh; padding:24px; font-family:"Segoe UI",Roboto,system-ui,sans-serif; color:var(--ds-color-black); }
        .po-toolbar { max-width:820px; margin:0 auto 16px; display:flex; gap:10px; justify-content:flex-end; }
        .po-btn { cursor:pointer; border:none; border-radius:999px; padding:10px 18px; font:inherit; font-weight:600; }
        .po-btn--primary { background:var(--ds-color-green-100); color:var(--ds-color-black); }
        .po-btn--ghost { background:var(--ds-color-white); border:1.5px solid var(--ds-color-gray-200); color:var(--ds-color-black); }
        .po-page { max-width:820px; margin:0 auto; background:var(--ds-color-white); padding:40px 46px; box-shadow:0 2px 18px rgba(0,0,0,.10); font-size:11.5px; line-height:1.45; }
        .po-head { display:flex; justify-content:space-between; align-items:flex-start; }
        .po-doc { text-align:right; }
        .po-doc h1 { margin:0; font-size:26px; font-weight:800; letter-spacing:.5px; }
        .po-doc .pag { color:var(--ds-color-gray-500); margin-top:10px; }
        .po-cols { display:flex; justify-content:space-between; gap:40px; margin-top:26px; }
        .po-col-l { flex:1; }
        .po-col-r { width:300px; }
        .po-empresa { text-align:right; margin-bottom:14px; }
        .po-empresa b { font-size:13px; }
        .po-prov { font-weight:700; font-size:13px; margin-bottom:10px; }
        table.po-tbl { width:100%; border-collapse:collapse; margin-top:30px; font-size:11px; }
        table.po-tbl thead th { border-top:1.5px solid var(--ds-color-black); border-bottom:1.5px solid var(--ds-color-black); padding:7px 6px; text-align:left; vertical-align:bottom; font-weight:700; }
        table.po-tbl thead th.n { text-align:right; }
        table.po-tbl tbody td { padding:6px 6px; vertical-align:top; border-bottom:1px solid var(--ds-color-gray-100); }
        table.po-tbl tbody td.n { text-align:right; white-space:nowrap; }
        .po-tot { margin-top:18px; margin-left:auto; width:330px; }
        .po-tot .r { display:flex; justify-content:space-between; padding:5px 0; }
        .po-tot .r.sub { border-top:1.5px solid var(--ds-color-black); }
        .po-tot .r.grand { border-top:1.5px solid var(--ds-color-black); border-bottom:3px double var(--ds-color-black); font-weight:800; font-size:13px; }
        .po-ivaspec { margin-top:34px; font-size:10.5px; }
        .po-ivaspec h4 { margin:0 0 8px; font-size:12px; }
        .po-ivaspec table { width:100%; border-collapse:collapse; }
        .po-ivaspec th { text-align:right; padding:4px 6px; border-bottom:1.5px solid var(--ds-color-black); font-weight:700; }
        .po-ivaspec th:first-child { text-align:left; }
        .po-ivaspec td { text-align:right; padding:4px 6px; }
        .po-ivaspec td:first-child { text-align:left; }
        .po-ivaspec tr.tot td { border-top:1.5px solid var(--ds-color-black); font-weight:700; }
        /* Observaciones de la orden: lo último que lee el proveedor. Con borde arriba
           para que se lea como una nota del documento y no como una línea perdida, y
           sin partirse entre dos hojas. */
        .po-obs { margin-top:34px; border-top:1.5px solid var(--ds-color-black); padding-top:10px; page-break-inside:avoid; }
        .po-obs h4 { margin:0 0 6px; font-size:12px; }
        .po-obs p { margin:0; font-size:11px; white-space:pre-wrap; }
        .po-firmas { margin-top:54px; display:flex; gap:48px; }
        .po-firmas .f { flex:1; border-top:1.4px solid var(--ds-color-gray-400); padding-top:6px; text-align:center; color:var(--ds-color-gray-500); font-size:10.5px; }
        @media print {
          .po-root { background:var(--ds-color-white); padding:0; }
          .po-toolbar { display:none; }
          .po-page { box-shadow:none; max-width:none; margin:0; padding:14mm 13mm; }
          @page { size:A4; margin:0; }
        }
      `}</style>

      <div className="po-toolbar">
        <button className="po-btn po-btn--ghost" onClick={() => router.back()}>‹ Volver</button>
        <button className="po-btn po-btn--ghost" onClick={() => window.print()}>Imprimir</button>
        {/* Descarga el .pdf que arma el servidor: un clic, sin diálogo y sin riesgo de
            terminar guardando la página web en vez del documento. */}
        <a className="po-btn po-btn--primary" href={`/api/ordenes/${orden.id}/pdf`} style={{ textDecoration: "none", display: "inline-block" }}>
          ⬇ Descargar PDF
        </a>
      </div>

      <div className="po-page">
        {/* encabezado: logo + título */}
        <div className="po-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Marca del Design System (AdelanteMark). Antes acá había una hoja
                dibujada a mano que no es la marca de la empresa. Documento blanco =
                modo "Light" del DS: la marca en verde de marca, recoloreada con el
                `color` del padre (nunca tocando el fill). */}
            <AdelanteMark width={84} style={{ color: "var(--ds-color-green-100)", flexShrink: 0 }} />
            <div style={{ fontWeight: 800, letterSpacing: 1, color: "var(--ds-color-green-200)", fontSize: 13, lineHeight: 1 }}>
              ADELANTE<br /><span style={{ fontSize: 8, letterSpacing: 3, color: "var(--ds-color-gray-400)" }}>DESARROLLOS</span>
            </div>
          </div>
          <div className="po-doc">
            {/* Para el proveedor esto es una ORDEN DE COMPRA. "Pedido" acá se confunde
                con la solicitud interna (PED-…), que es otra cosa. */}
            <h1>Orden de compra</h1>
            <div className="pag">Pág. 1</div>
          </div>
        </div>

        {/* dos columnas: proveedor + datos / empresa */}
        <div className="po-cols">
          <div className="po-col-l">
            <div className="po-prov">{orden.proveedorNombre ?? prov?.nombre ?? "—"}</div>
            <Campo k="Compra a-Nº proveedor" v={orden.proveedorNo ?? prov?.code ?? "—"} />
            <div style={{ height: 14 }} />
            {/* El N.º que va al proveedor es el de BUSINESS CENTRAL: es el que existe
                en el ERP, el que Contabilidad va a buscar y el que él va a poner en su
                factura. El número interno de la app arranca en 1 en cada base y solo
                sirve adentro. Si por algo faltara el de BC, se cae al interno para no
                imprimir un documento sin número. */}
            <Campo k="Nº orden de compra" v={numeroDoc} b />
            <Campo k="Fecha emisión documento" v={formatDate(orden.fecha)} />
            {prov?.paymentTermsCode && <Campo k="Términos pago" v={prov.paymentTermsCode} />}
            <Campo k="Moneda" v={cur} />
            <div style={{ height: 14 }} />
            <Campo k="Almacén entrega" v={almacenUnico ?? "Varios (ver detalle)"} />
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
              <th style={{ width: 92 }}>Almacén /<br />Obra</th>
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
                <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{l.tipo === "cargo" ? "—" : (destinoLinea(l) || "—")}</td>
                <td>
                  {l.descripcion}
                  {l.variantCode && <div style={{ color: "var(--ds-color-gray-500)" }}>Variante: {variantes.etiqueta(l.articuloId, l.variantCode)}</div>}
                </td>
                <td className="n">{num.format(l.cantidad)}</td>
                <td>{etiquetaUnidad(l.unidad, unidades)}</td>
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
          {/* Con más de una tasa en la orden, poner "13% IVA" sería falso. */}
          <div className="r"><span>{porTasaIva.length > 1 ? "IVA" : `${ivaPct}% IVA`}</span><span>{fmt(iva)}</span></div>
          <div className="r grand"><span>Total {cur} con IVA</span><span>{fmt(total)}</span></div>
        </div>

        {/* desglose de IVA (como en BC): UNA fila por tasa. Antes metía todo en una
            sola fila con la tasa de la primera línea, así que una orden que mezcla
            13% con exento mostraba una base que no cuadraba con el importe de IVA. */}
        <div className="po-ivaspec">
          <h4>Especificación importe IVA</h4>
          <table>
            <thead>
              <tr>
                <th>Identif. IVA</th><th>% IVA</th><th>Importe línea</th><th>Base IVA</th><th>Importe IVA</th>
              </tr>
            </thead>
            <tbody>
              {porTasaIva.map((g) => (
                <tr key={g.pct}>
                  <td>IVA{g.pct}</td><td>{g.pct}</td><td>{fmt(g.base)}</td><td>{fmt(g.base)}</td><td>{fmt(g.iva)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td>Total</td><td></td><td>{fmt(subtotal)}</td><td>{fmt(subtotal)}</td><td>{fmt(iva)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Observaciones que escribió Proveeduría al armar la orden. Van al final, que
            es donde el proveedor busca las indicaciones (horario, contacto, referencia). */}
        {orden.observaciones?.trim() && (
          <div className="po-obs">
            <h4>Observaciones</h4>
            <p>{orden.observaciones.trim()}</p>
          </div>
        )}

      </div>
    </div>
  );
}
