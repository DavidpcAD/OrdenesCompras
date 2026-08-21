// La build STANDALONE a propósito: la normal lee las métricas de las fuentes
// (Helvetica.afm) del disco con __dirname, y al empaquetar Next eso se rompe
// ("ENOENT … /vendor-chunks/data/Helvetica.afm"). Esta las trae embebidas, así que
// funciona igual en dev y en el App Service, sin copiar archivos de fuente.
// @ts-expect-error — la build standalone no trae tipos propios; la API es la misma.
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import type { Orden, OrdenLinea } from "./types";
import { ordenLineaImporte } from "./helpers";
import { documentoDeOrden, destinoLineaDoc, fmtDoc, EMPRESA_DOC } from "./orden-doc";

// PDF de la orden de compra que se le manda al proveedor, dibujado en el SERVIDOR con
// pdfkit. Existe para que "Descargar PDF" baje un .pdf de una vez, sin pasar por el
// diálogo de impresión del navegador.
//
// Sin Chromium a propósito: en el App Service no hay, y arrastrar un navegador
// headless para un documento de una página no se paga. Los NÚMEROS no se recalculan
// acá: salen de `documentoDeOrden`, el mismo que usa la pantalla, así que el PDF y la
// vista nunca pueden decir totales distintos.
//
// Tipografía: Helvetica (las 14 estándar del PDF, sin archivos de fuente). Los montos
// van con el CÓDIGO de moneda ("Total CRC sin IVA"), nunca con el símbolo ₡: ese
// carácter no existe en la codificación de las fuentes estándar y saldría en blanco.

// La marca del DS (react/AdelanteMark), en un viewBox de 163×71.
const MARCA_PATH = "M0 0H45.645L87.8835 70.7845H41.4411L0 0ZM72.5219 20.6455H118.403L133.203 45.715H162.804L148.004 70.7845H102.257L72.5219 20.6455Z";
const VERDE = "#add010";
const GRIS = "#8a8a8a";
const NEGRO = "#1a1a1a";

const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = 40;
const DERECHA = A4.ancho - MARGEN;

// Columnas de la tabla de líneas: x de inicio y ancho. Suman el ancho útil (515).
const COLS = {
  destino: { x: MARGEN, w: 62 },
  desc: { x: MARGEN + 66, w: 175 },
  cant: { x: MARGEN + 245, w: 42 },
  unidad: { x: MARGEN + 291, w: 46 },
  precio: { x: MARGEN + 341, w: 66 },
  desc_pct: { x: MARGEN + 411, w: 40 },
  importe: { x: MARGEN + 455, w: 60 },
};

export function ordenAPdf(orden: Orden): Promise<Buffer> {
  const d = documentoDeOrden(orden);
  const doc = new PDFDocument({ size: "A4", margin: MARGEN, bufferPages: true,
    info: { Title: `${d.numeroDoc} · Orden de compra`, Author: EMPRESA_DOC.nombre } });

  const trozos: Buffer[] = [];
  const listo = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (t: Buffer) => trozos.push(t));
    doc.on("end", () => resolve(Buffer.concat(trozos)));
    doc.on("error", reject);
  });

  const regla = (y: number, ancho = 1.2, color = NEGRO, x1 = MARGEN, x2 = DERECHA) => {
    doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(ancho).strokeColor(color).stroke().restore();
  };
  const txt = (s: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions & { size?: number; bold?: boolean; color?: string } = {}) => {
    const { size = 8, bold = false, color = NEGRO, ...resto } = opts;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color).text(s, x, y, { lineBreak: false, ...resto });
  };

  // ─────────────────────────────────────────────────────── encabezado
  doc.save().translate(MARGEN, MARGEN).scale(84 / 163).path(MARCA_PATH).fill(VERDE, "even-odd").restore();
  txt("ADELANTE", MARGEN + 92, MARGEN + 4, { size: 10, bold: true, color: "#6f8a1e", characterSpacing: 1 });
  txt("DESARROLLOS", MARGEN + 92, MARGEN + 17, { size: 6, color: GRIS, characterSpacing: 2.4 });
  txt("Orden de compra", MARGEN, MARGEN, { size: 20, bold: true, width: 515, align: "right" });
  txt("Pág. 1", MARGEN, MARGEN + 26, { size: 8, color: GRIS, width: 515, align: "right" });

  // ─────────────────────────────────────── dos columnas: proveedor / empresa
  let y = MARGEN + 56;
  const yCols = y;
  txt(orden.proveedorNombre ?? "—", MARGEN, y, { size: 10, bold: true, width: 250 });
  y += 16;
  const campo = (k: string, v: string, bold = false) => {
    txt(k, MARGEN, y, { size: 8 });
    txt(v, MARGEN + 118, y, { size: 8, bold, width: 140 });
    y += 12;
  };
  campo("Compra a-Nº proveedor", orden.proveedorNo ?? "—");
  y += 8;
  campo("Nº orden de compra", d.numeroDoc, true);
  campo("Fecha emisión documento", formatearFecha(orden.fecha));
  campo("Moneda", d.moneda);
  y += 8;
  campo("Almacén entrega", d.almacenUnico ?? "Varios (ver detalle)");

  // Bloque de la empresa, alineado a la derecha.
  let yd = yCols;
  const derecha = (s: string, size = 8, bold = false, color = NEGRO) => {
    txt(s, DERECHA - 240, yd, { size, bold, color, width: 240, align: "right" });
    yd += size + 3;
  };
  derecha(EMPRESA_DOC.nombre, 10, true);
  for (const l of EMPRESA_DOC.dir) derecha(l, 8, false, GRIS);
  yd += 8;
  // El valor va a la DERECHA con ancho generoso: el correo mide más que una columna
  // de 130 y, como el texto no hace salto de línea, se salía y le pisaba la fila de
  // abajo. Los que no caben se bajan de tamaño en vez de desbordarse.
  const parDerecha = (k: string, v: string, size = 8) => {
    txt(k, DERECHA - 260, yd, { size: 8, width: 100 });
    txt(v, DERECHA - 158, yd, { size, width: 158, align: "right" });
    yd += 12;
  };
  parDerecha("Nº teléfono", EMPRESA_DOC.tel);
  parDerecha("Correo electrónico", EMPRESA_DOC.email, 7);
  parDerecha("CIF/NIF", EMPRESA_DOC.cif);
  parDerecha("Banco", EMPRESA_DOC.banco);

  // ────────────────────────────────────────────────── tabla de líneas
  y = Math.max(y, yd) + 22;
  const cabecera = () => {
    regla(y, 1.2);
    y += 5;
    txt("Almacén /", COLS.destino.x, y, { size: 7.5, bold: true });
    txt("Obra", COLS.destino.x, y + 9, { size: 7.5, bold: true });
    txt("Descripción", COLS.desc.x, y + 9, { size: 7.5, bold: true });
    txt("Cant.", COLS.cant.x, y + 9, { size: 7.5, bold: true, width: COLS.cant.w, align: "right" });
    txt("Unidad", COLS.unidad.x, y, { size: 7.5, bold: true, width: COLS.unidad.w, align: "right" });
    txt("medida", COLS.unidad.x, y + 9, { size: 7.5, bold: true, width: COLS.unidad.w, align: "right" });
    txt("Coste unit.", COLS.precio.x, y, { size: 7.5, bold: true, width: COLS.precio.w, align: "right" });
    txt("directo", COLS.precio.x, y + 9, { size: 7.5, bold: true, width: COLS.precio.w, align: "right" });
    txt("% Desc.", COLS.desc_pct.x, y + 9, { size: 7.5, bold: true, width: COLS.desc_pct.w, align: "right" });
    txt("Importe", COLS.importe.x, y + 9, { size: 7.5, bold: true, width: COLS.importe.w, align: "right" });
    y += 22;
    regla(y, 1.2);
    y += 6;
  };
  cabecera();

  for (const l of d.lineas) {
    const desc = l.descripcion || "—";
    // Alto de la fila = lo que ocupe la descripción con salto de línea.
    const alto = Math.max(12, doc.font("Helvetica").fontSize(8).heightOfString(desc, { width: COLS.desc.w }));
    // Si no cabe, hoja nueva y se repite la cabecera (una orden puede tener 40 líneas).
    if (y + alto + 30 > A4.alto - MARGEN) {
      doc.addPage();
      y = MARGEN;
      cabecera();
    }
    const cargo = l.tipo === "cargo";
    txt(cargo ? "—" : (destinoLineaDoc(l) || "—"), COLS.destino.x, y, { size: 8, bold: !cargo });
    doc.font("Helvetica").fontSize(8).fillColor(NEGRO).text(desc, COLS.desc.x, y, { width: COLS.desc.w });
    txt(fmtDoc(l.cantidad, 0), COLS.cant.x, y, { size: 8, width: COLS.cant.w, align: "right" });
    txt(l.unidad || "", COLS.unidad.x, y, { size: 8, width: COLS.unidad.w, align: "right" });
    txt(fmtDoc(l.precioUnitario), COLS.precio.x, y, { size: 8, width: COLS.precio.w, align: "right" });
    txt((l.descuentoPct ?? 0) > 0 ? fmtDoc(l.descuentoPct!, 0) : "", COLS.desc_pct.x, y, { size: 8, width: COLS.desc_pct.w, align: "right" });
    txt(fmtDoc(ordenLineaImporte(l)), COLS.importe.x, y, { size: 8, width: COLS.importe.w, align: "right" });
    y += alto + 6;
    regla(y - 3, 0.5, "#dcdcdc");
  }

  // ─────────────────────────────────────────────────────── totales
  y += 14;
  const xTot = DERECHA - 250;
  const filaTotal = (k: string, v: string, opts: { top?: boolean; grande?: boolean } = {}) => {
    if (opts.top) { regla(y, 1.2, NEGRO, xTot, DERECHA); y += 5; }
    txt(k, xTot, y, { size: opts.grande ? 9.5 : 8.5, bold: !!opts.grande, width: 160 });
    txt(v, DERECHA - 110, y, { size: opts.grande ? 9.5 : 8.5, bold: !!opts.grande, width: 110, align: "right" });
    y += opts.grande ? 15 : 13;
  };
  filaTotal(`Total ${d.moneda} sin IVA`, fmtDoc(d.subtotal), { top: true });
  // Con más de una tasa en la orden, poner "13% IVA" sería falso.
  filaTotal(d.porTasaIva.length > 1 ? "IVA" : `${d.ivaPct}% IVA`, fmtDoc(d.iva));
  regla(y, 1.2, NEGRO, xTot, DERECHA);
  y += 4;
  filaTotal(`Total ${d.moneda} con IVA`, fmtDoc(d.total), { grande: true });
  regla(y - 2, 1.2, NEGRO, xTot, DERECHA);
  regla(y, 1.2, NEGRO, xTot, DERECHA);

  // ────────────────────────────────────── especificación del IVA (como BC)
  y += 24;
  if (y + 70 > A4.alto - MARGEN) { doc.addPage(); y = MARGEN; }
  txt("Especificación importe IVA", MARGEN, y, { size: 9, bold: true });
  y += 14;
  const colsIva = [
    { k: "Identif. IVA", x: MARGEN, w: 90, align: "left" as const },
    { k: "% IVA", x: MARGEN + 95, w: 60, align: "right" as const },
    { k: "Importe línea", x: MARGEN + 160, w: 110, align: "right" as const },
    { k: "Base IVA", x: MARGEN + 275, w: 110, align: "right" as const },
    { k: "Importe IVA", x: MARGEN + 390, w: 125, align: "right" as const },
  ];
  for (const c of colsIva) txt(c.k, c.x, y, { size: 7.5, bold: true, width: c.w, align: c.align });
  y += 11;
  regla(y, 1.2);
  y += 5;
  for (const g of d.porTasaIva) {
    const vals = [`IVA${g.pct}`, String(g.pct), fmtDoc(g.base), fmtDoc(g.base), fmtDoc(g.iva)];
    colsIva.forEach((c, i) => txt(vals[i], c.x, y, { size: 8, width: c.w, align: c.align }));
    y += 12;
  }
  regla(y, 1.2);
  y += 5;
  const totIva = ["Total", "", fmtDoc(d.subtotal), fmtDoc(d.subtotal), fmtDoc(d.iva)];
  colsIva.forEach((c, i) => txt(totIva[i], c.x, y, { size: 8, bold: true, width: c.w, align: c.align }));
  y += 18;

  // ─────────────────────────────────────────────────── observaciones
  const obs = orden.observaciones?.trim();
  if (obs) {
    const alto = doc.font("Helvetica").fontSize(8).heightOfString(obs, { width: 515 });
    if (y + alto + 30 > A4.alto - MARGEN) { doc.addPage(); y = MARGEN; }
    regla(y, 1.2);
    y += 8;
    txt("Observaciones", MARGEN, y, { size: 9, bold: true });
    y += 13;
    doc.font("Helvetica").fontSize(8).fillColor(NEGRO).text(obs, MARGEN, y, { width: 515 });
  }

  // Numerar las hojas al final, cuando ya se sabe cuántas son.
  const rango = doc.bufferedPageRange();
  if (rango.count > 1) {
    for (let i = 0; i < rango.count; i++) {
      doc.switchToPage(rango.start + i);
      doc.font("Helvetica").fontSize(8).fillColor(GRIS)
        .text(`Pág. ${i + 1} de ${rango.count}`, MARGEN, MARGEN + 26, { width: 515, align: "right", lineBreak: false });
    }
  }

  doc.end();
  return listo;
}

// dd/mm/yyyy sin depender del locale del servidor (Azure corre en UTC/en-US).
function formatearFecha(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? "");
}
