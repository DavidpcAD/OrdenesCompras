import { NextResponse } from "next/server";
import { exigirSesion } from "@/lib/actor";
import { bcUltimosCostos } from "@/lib/bc";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/ultimos-costos → { costos: { "M01-0001": 1234.5, … } }
// Precio de la última compra por artículo (lo usa la columna de Inventarios).
export async function GET() {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    return NextResponse.json({ costos: await bcUltimosCostos() });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}
