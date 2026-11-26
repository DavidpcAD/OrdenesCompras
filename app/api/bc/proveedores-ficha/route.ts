import { NextResponse } from "next/server";
import { exigirSesion } from "@/lib/actor";
import { bcFichaProveedores } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: la ficha de todos los proveedores tal como está en BC (pantalla Proveedores).
// Solo lectura. Si BC no contesta, la pantalla lo dice en vez de mostrar una lista vacía.
export async function GET() {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    return NextResponse.json({ proveedores: await bcFichaProveedores() });
  } catch (e: any) {
    return NextResponse.json({ proveedores: [], error: String(e?.message ?? e) }, { status: 200 });
  }
}
