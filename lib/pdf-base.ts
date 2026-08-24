// Piezas comunes de los PDF que salen de la app (orden de compra y solicitud de
// cotización): hoja, marca, bloque de la empresa, primitivas de dibujo y numeración.
//
// Están acá para que los dos documentos se vean como de la misma casa. Cuando el
// encabezado estaba copiado en cada archivo, cualquier cambio (una dirección, el
// logo) quedaba a medias en uno de los dos.
//
// La build STANDALONE de pdfkit a propósito: la normal lee las métricas de las
// fuentes (Helvetica.afm) del disco con __dirname, y al empaquetar Next eso se rompe
// ("ENOENT … /vendor-chunks/data/Helvetica.afm"). Esta las trae embebidas.
// @ts-expect-error — la build standalone no trae tipos propios; la API es la misma.
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import { EMPRESA_DOC } from "./orden-doc";

// La marca del DS (react/AdelanteMark), en un viewBox de 163×71.
export const MARCA_PATH = "M0 0H45.645L87.8835 70.7845H41.4411L0 0ZM72.5219 20.6455H118.403L133.203 45.715H162.804L148.004 70.7845H102.257L72.5219 20.6455Z";
export const VERDE = "#add010";
export const GRIS = "#8a8a8a";
export const NEGRO = "#1a1a1a";

export const A4 = { ancho: 595.28, alto: 841.89 };
export const MARGEN = 40;
export const DERECHA = A4.ancho - MARGEN;
export const ANCHO_UTIL = DERECHA - MARGEN;   // 515
// Y en la que arranca el contenido de una hoja de CONTINUACIÓN. Deja libre la banda
// donde va el "Pág. 2 de 5" (arriba a la derecha); sin esto, la primera fila de la
// tabla quedaba escrita encima del número de hoja.
export const Y_CONTINUACION = MARGEN + 42;

export type OpcionesTexto = PDFKit.Mixins.TextOptions & { size?: number; bold?: boolean; color?: string };
export type Txt = (s: string, x: number, y: number, opts?: OpcionesTexto) => void;
export type Regla = (y: number, ancho?: number, color?: string, x1?: number, x2?: number) => void;

// Hoja A4 nueva + la promesa del Buffer final. `doc.end()` la resuelve.
export function nuevoDocumento(titulo: string): { doc: any; listo: Promise<Buffer> } {
  const doc = new PDFDocument({
    size: "A4", margin: MARGEN, bufferPages: true,
    info: { Title: titulo, Author: EMPRESA_DOC.nombre },
  });
  const trozos: Buffer[] = [];
  const listo = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (t: Buffer) => trozos.push(t));
    doc.on("end", () => resolve(Buffer.concat(trozos)));
    doc.on("error", reject);
  });
  return { doc, listo };
}

// Texto y líneas. `lineBreak: false` por defecto: en una tabla, un salto de línea
// inesperado corre todo lo de abajo.
export function dibujante(doc: any): { txt: Txt; regla: Regla } {
  const txt: Txt = (s, x, y, opts = {}) => {
    const { size = 8, bold = false, color = NEGRO, ...resto } = opts;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color)
      .text(s, x, y, { lineBreak: false, ...resto });
  };
  const regla: Regla = (y, ancho = 1.2, color = NEGRO, x1 = MARGEN, x2 = DERECHA) => {
    doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(ancho).strokeColor(color).stroke().restore();
  };
  return { txt, regla };
}

// Marca arriba a la izquierda y el título del documento a la derecha.
export function encabezadoMarca(doc: any, txt: Txt, titulo: string): void {
  doc.save().translate(MARGEN, MARGEN).scale(84 / 163).path(MARCA_PATH).fill(VERDE, "even-odd").restore();
  txt("ADELANTE", MARGEN + 92, MARGEN + 4, { size: 10, bold: true, color: "#6f8a1e", characterSpacing: 1 });
  txt("DESARROLLOS", MARGEN + 92, MARGEN + 17, { size: 6, color: GRIS, characterSpacing: 2.4 });
  txt(titulo, MARGEN, MARGEN, { size: 20, bold: true, width: ANCHO_UTIL, align: "right" });
  // El número de hoja NO se dibuja acá: lo pone `numerarPaginas` al final, cuando ya
  // se sabe cuántas son. Cuando se escribía "Pág. 1" desde el encabezado, en un
  // documento de dos hojas quedaba encima el "Pág. 2 de 2" y se leían pisados.
}

// Datos de Adelante alineados a la derecha. Devuelve la y en la que terminó.
// El valor va a la DERECHA con ancho generoso: el correo mide más que una columna
// de 130 y, como el texto no hace salto de línea, se salía y pisaba la fila de abajo.
export function bloqueEmpresa(txt: Txt, yInicial: number): number {
  let y = yInicial;
  const derecha = (s: string, size = 8, bold = false, color = NEGRO) => {
    txt(s, DERECHA - 240, y, { size, bold, color, width: 240, align: "right" });
    y += size + 3;
  };
  derecha(EMPRESA_DOC.nombre, 10, true);
  for (const l of EMPRESA_DOC.dir) derecha(l, 8, false, GRIS);
  y += 8;
  const par = (k: string, v: string, size = 8) => {
    txt(k, DERECHA - 260, y, { size: 8, width: 100 });
    txt(v, DERECHA - 158, y, { size, width: 158, align: "right" });
    y += 12;
  };
  par("Nº teléfono", EMPRESA_DOC.tel);
  par("Correo electrónico", EMPRESA_DOC.email, 7);
  par("CIF/NIF", EMPRESA_DOC.cif);
  par("Banco", EMPRESA_DOC.banco);
  return y;
}

// Numera las hojas al final, cuando ya se sabe cuántas son. Una sola hoja lleva
// "Pág. 1" y varias "Pág. 2 de 5": el proveedor tiene que poder ver si le llegó
// completo el documento.
export function numerarPaginas(doc: any): void {
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    const etiqueta = rango.count > 1 ? `Pág. ${i + 1} de ${rango.count}` : "Pág. 1";
    doc.font("Helvetica").fontSize(8).fillColor(GRIS)
      .text(etiqueta, MARGEN, MARGEN + 26, { width: ANCHO_UTIL, align: "right", lineBreak: false });
  }
}

// dd/mm/yyyy sin depender del locale del servidor (Azure corre en UTC/en-US).
export function formatearFecha(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? "");
}
