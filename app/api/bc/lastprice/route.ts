import { NextResponse } from "next/server";
import { bcUltimoPrecioFacturado, bcItemLastCost } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Último precio de compra de un item. Primero el precio con que se FACTURÓ a ese
// proveedor (lo más preciso); si no hay, cae al ÚLTIMO COSTO DIRECTO del item
// (vendor-independiente, que BC mantiene solo). Así casi siempre trae un precio.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const item = u.searchParams.get("item") ?? "";
  const vendor = u.searchParams.get("vendor") ?? "";
  try {
    let precio = await bcUltimoPrecioFacturado(item, vendor);
    let fuente: "proveedor" | "item" | null = precio != null ? "proveedor" : null;
    if (precio == null) { precio = await bcItemLastCost(item); fuente = precio != null ? "item" : null; }
    return NextResponse.json({ precio, fuente });
  } catch (e: any) {
    return NextResponse.json({ precio: null, fuente: null, error: String(e?.message ?? e) });
  }
}
