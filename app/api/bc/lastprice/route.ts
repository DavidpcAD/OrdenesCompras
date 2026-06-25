import { NextResponse } from "next/server";
import { bcUltimoPrecioFacturado } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Último precio facturado de un item a un proveedor (item + vendor) desde BC.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const item = u.searchParams.get("item") ?? "";
  const vendor = u.searchParams.get("vendor") ?? "";
  try {
    const precio = await bcUltimoPrecioFacturado(item, vendor);
    return NextResponse.json({ precio });
  } catch (e: any) {
    return NextResponse.json({ precio: null, error: String(e?.message ?? e) });
  }
}
