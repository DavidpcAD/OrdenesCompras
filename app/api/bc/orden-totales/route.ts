import { NextRequest, NextResponse } from "next/server";
import { bcOrdenTotales } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/orden-totales?orderNo=CP-000123
// Totales del pedido calculados por BC (subtotal excl. IVA, IVA, total con IVA).
// Nunca 500: si BC no responde o el pedido no existe, devuelve { totales: null }.
export async function GET(req: NextRequest) {
  const orderNo = req.nextUrl.searchParams.get("orderNo") ?? "";
  try {
    return NextResponse.json({ totales: await bcOrdenTotales(orderNo) });
  } catch (e: any) {
    return NextResponse.json({ totales: null, error: String(e?.message ?? e) });
  }
}
