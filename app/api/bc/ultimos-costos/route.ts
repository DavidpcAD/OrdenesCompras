import { NextResponse } from "next/server";
import { bcUltimosCostos } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/ultimos-costos → { costos: { "M01-0001": 1234.5, … } }
// Precio de la última compra por artículo (lo usa la columna de Inventarios).
export async function GET() {
  try {
    return NextResponse.json({ costos: await bcUltimosCostos() });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
