import { NextResponse } from "next/server";
import { addRecepcionFotos, getRecepcionFoto } from "@/lib/repo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Foto de la factura física de una recepción (la que saca Bodega con el celular).
// Llega YA COMPRIMIDA del navegador (ver lib/foto.ts); acá solo se valida el
// tamaño para que nadie suba una imagen de cámara sin pasar por la compresión.
const MAX_FOTOS = 4;
const MAX_BYTES = 1_500_000;   // por foto, ya comprimida (~1.4 MB)
const MIMES_OK = ["image/jpeg", "image/webp", "image/png"];

// GET /api/recepciones/{id}/foto?foto={idFoto} → la imagen (para el <img src>).
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const idFoto = Number(new URL(req.url).searchParams.get("foto") ?? 0);
    if (!idFoto) return NextResponse.json({ error: "Falta el parámetro foto." }, { status: 400 });
    const f = await getRecepcionFoto(Number(params.id), idFoto);
    if (!f) return NextResponse.json({ error: "Foto no encontrada." }, { status: 404 });
    return new NextResponse(new Uint8Array(f.imagen), {
      headers: {
        "Content-Type": f.mime,
        "Content-Length": String(f.imagen.length),
        // La imagen no cambia nunca (una foto nueva = otro id): se puede cachear
        // en el navegador. `private` porque es un documento de la empresa.
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

// POST /api/recepciones/{id}/foto  { fotos: [{ mime, base64, ancho, alto }] }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const a = await actor({ ...body, rol: body.rol ?? "facturacion" });
    const fotos = Array.isArray(body?.fotos) ? body.fotos : [];
    if (!fotos.length) return NextResponse.json({ error: "No vino ninguna foto." }, { status: 400 });
    if (fotos.length > MAX_FOTOS) return NextResponse.json({ error: `Máximo ${MAX_FOTOS} fotos por factura.` }, { status: 400 });
    const limpias = fotos.map((f: any) => {
      const base64 = String(f?.base64 ?? "").replace(/^data:[^,]+,/, "");
      const mime = String(f?.mime ?? "image/jpeg");
      if (!MIMES_OK.includes(mime)) throw new Error(`Formato de imagen no soportado: ${mime}`);
      // base64 → bytes: 4 caracteres = 3 bytes.
      if (Math.floor((base64.length * 3) / 4) > MAX_BYTES) throw new Error("La foto pesa demasiado incluso comprimida; volvé a tomarla.");
      return { mime, base64, ancho: Number(f?.ancho) || undefined, alto: Number(f?.alto) || undefined };
    });
    const guardadas = await addRecepcionFotos(Number(params.id), limpias, a.usuario);
    return NextResponse.json({ guardadas }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
