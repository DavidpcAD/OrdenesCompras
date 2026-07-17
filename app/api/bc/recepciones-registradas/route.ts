import { NextRequest, NextResponse } from "next/server";
import { bcPostedReceiptLines } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/recepciones-registradas?vendor=&item=&doc=
// Líneas de recepciones de compra YA REGISTRADAS (albaranes) para asignarles un
// cargo de producto (flete de un tercero). Filtros: proveedor del material,
// artículo, N.º de recepción. Nunca 500: si la API custom aún no está publicada,
// devuelve { lineas: [], error } para que la UI avise sin romperse.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const lineas = await bcPostedReceiptLines({
      vendorNo: sp.get("vendor") ?? undefined,
      itemNo: sp.get("item") ?? undefined,
      documentNo: sp.get("doc") ?? undefined,
    });
    return NextResponse.json({ lineas });
  } catch (e: any) {
    return NextResponse.json({ lineas: [], error: String(e?.message ?? e) });
  }
}
