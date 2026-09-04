import { NextRequest, NextResponse } from "next/server";
import { bcComprasDeItem } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/compras-insumo?item=M04-0073 → { compras: [...] }
// Recepciones de compra registradas en BC de ese artículo, de la más reciente a la
// más vieja (lo muestra Inventarios al expandir la fila). Nunca 500: si BC no
// contesta devuelve { compras: [], error } y la pantalla lo dice sin romperse.
export async function GET(req: NextRequest) {
  const item = (req.nextUrl.searchParams.get("item") ?? "").trim();
  if (!item) return NextResponse.json({ compras: [], error: "Falta el artículo." }, { status: 400 });
  try {
    return NextResponse.json({ compras: await bcComprasDeItem(item) });
  } catch (e: any) {
    return NextResponse.json({ compras: [], error: String(e?.message ?? e) });
  }
}
