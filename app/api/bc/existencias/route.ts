import { NextRequest, NextResponse } from "next/server";
import { bcExistencias } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/existencias?itemNo=M01-0001  ó  ?locationCode=OR-4321  (al menos uno).
// Devuelve el stock neto físico por ubicación/variante desde BC (inventoryByLocation).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const itemNo = searchParams.get("itemNo") ?? undefined;
  const locationCode = searchParams.get("locationCode") ?? undefined;
  if (!itemNo?.trim() && !locationCode?.trim()) {
    return NextResponse.json({ error: "Se requiere itemNo o locationCode." }, { status: 400 });
  }
  try {
    return NextResponse.json({ existencias: await bcExistencias({ itemNo, locationCode }) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
