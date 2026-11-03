import { NextResponse } from "next/server";
import { exigirSesion } from "@/lib/actor";
import { bcVendors } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    return NextResponse.json({ proveedores: await bcVendors() });
  } catch (e: any) {
    return NextResponse.json({ proveedores: [], error: String(e?.message ?? e) }, { status: 200 });
  }
}
