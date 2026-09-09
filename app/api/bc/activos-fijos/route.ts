import { NextResponse } from "next/server";
import { bcActivosFijos } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/activos-fijos → { activos: [{ no, descripcion, clase }] }
// Catálogo de Activos fijos (Fixed Asset, BC 5600) para la línea de tipo "Activo
// fijo": esa compra se capitaliza contra el activo y no entra a inventario. Nunca
// 500, igual que el de recursos.
export async function GET() {
  try {
    return NextResponse.json({ activos: await bcActivosFijos() });
  } catch (e: any) {
    return NextResponse.json({ activos: [], error: String(e?.message ?? e) });
  }
}
