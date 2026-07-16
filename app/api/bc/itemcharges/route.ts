import { NextResponse } from "next/server";
import { bcItemCharges } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/itemcharges → { itemCharges: [{ no, descripcion }] }
// Catálogo de Cargos de producto (Item Charge, BC 5800) para armar la orden.
// Nunca 500: si la API custom aún no está publicada, devuelve lista vacía.
export async function GET() {
  try {
    return NextResponse.json({ itemCharges: await bcItemCharges() });
  } catch (e: any) {
    return NextResponse.json({ itemCharges: [], error: String(e?.message ?? e) });
  }
}
