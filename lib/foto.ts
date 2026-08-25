// Compresión de la foto de la factura, EN EL NAVEGADOR.
//
// La cámara de un celular suelta 3–6 MB por foto. Subir eso a SQL (y volver a
// bajarlo cada vez que alguien abre "Recibidas") no tiene sentido para un
// documento que solo hay que poder LEER: con el lado largo en 1600 px y JPEG al
// 72 % una factura carta queda legible en ~150–350 KB.
//
// Todo pasa acá antes del POST: el servidor solo valida el tamaño final.

const MAX_LADO = 1600;        // px del lado largo
const MAX_BYTES = 900_000;    // objetivo por foto (~0.9 MB)
const CALIDAD_INICIAL = 0.72;

export interface FotoComprimida {
  mime: string;
  base64: string;     // sin el prefijo "data:...;base64,"
  dataUrl: string;    // para la miniatura y para el modo demo (sin API)
  ancho: number;
  alto: number;
  tamano: number;     // bytes finales
  nombre: string;     // nombre del archivo original (referencia para el usuario)
}

// Carga el archivo a un bitmap respetando la orientación EXIF (una foto tomada
// en vertical con el celular viene rotada por metadatos: sin esto se guarda
// acostada). createImageBitmap lo hace nativo; si no está, cae a <img>.
async function cargarImagen(file: File): Promise<{ w: number; h: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { w: bmp.width, h: bmp.height, draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h), close: () => bmp.close() };
    } catch { /* sigue con <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const el = new Image();
      el.onload = () => ok(el);
      el.onerror = () => fail(new Error("No se pudo leer la imagen."));
      el.src = url;
    });
    return { w: img.naturalWidth, h: img.naturalHeight, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h), close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

const aDataUrl = (blob: Blob) => new Promise<string>((ok, fail) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result));
  fr.onerror = () => fail(new Error("No se pudo leer la imagen comprimida."));
  fr.readAsDataURL(blob);
});

const aBlob = (canvas: HTMLCanvasElement, calidad: number) =>
  new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("No se pudo comprimir la imagen."))), "image/jpeg", calidad));

export async function comprimirFoto(file: File): Promise<FotoComprimida> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`"${file.name}" no es una imagen. Sacale una foto a la factura o adjuntá un JPG/PNG.`);
  }
  const src = await cargarImagen(file);
  try {
    const escala = Math.min(1, MAX_LADO / Math.max(src.w, src.h));
    let ancho = Math.max(1, Math.round(src.w * escala));
    let alto = Math.max(1, Math.round(src.h * escala));
    const canvas = document.createElement("canvas");
    let calidad = CALIDAD_INICIAL;
    let blob: Blob | null = null;
    // Baja calidad y, si aún no entra, también tamaño. 4 intentos: una factura
    // fotografiada de cerca (mucho detalle) necesita más de una pasada.
    for (let i = 0; i < 4; i++) {
      canvas.width = ancho; canvas.height = alto;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("El navegador no pudo procesar la imagen.");
      ctx.fillStyle = "#fff";              // el JPEG no tiene transparencia
      ctx.fillRect(0, 0, ancho, alto);
      src.draw(ctx, ancho, alto);
      blob = await aBlob(canvas, calidad);
      if (blob.size <= MAX_BYTES) break;
      if (i % 2 === 0) calidad = Math.max(0.4, calidad - 0.15);
      else { ancho = Math.round(ancho * 0.8); alto = Math.round(alto * 0.8); }
    }
    if (!blob) throw new Error("No se pudo comprimir la imagen.");
    const dataUrl = await aDataUrl(blob);
    return {
      mime: "image/jpeg",
      base64: dataUrl.replace(/^data:[^,]+,/, ""),
      dataUrl, ancho, alto, tamano: blob.size, nombre: file.name,
    };
  } finally {
    src.close();
  }
}

// "348 KB" — para que Bodega vea que la foto quedó liviana.
export function pesoLegible(bytes?: number): string {
  if (!bytes) return "";
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
}
