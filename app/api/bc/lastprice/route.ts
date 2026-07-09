import { NextResponse } from "next/server";
import { bcUltimoPrecioFacturado, bcItemUltimaCompra, bcItemLastCost } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Último precio de compra de un item, por prioridad:
//  1) "proveedor": precio con que se FACTURÓ a ese proveedor (lo más preciso).
//  2) "compra": último costo de una RECEPCIÓN de compra real del material
//     (API custom lastPurchasePrices, page 50235) — sirve aunque no haya proveedor.
//  3) "item": último costo directo que BC guarda en el ítem (respaldo).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const item = u.searchParams.get("item") ?? "";
  const vendor = u.searchParams.get("vendor") ?? "";
  try {
    let precio = await bcUltimoPrecioFacturado(item, vendor);
    let fuente: "proveedor" | "compra" | "item" | null = precio != null ? "proveedor" : null;
    if (precio == null) { precio = await bcItemUltimaCompra(item); fuente = precio != null ? "compra" : null; }
    if (precio == null) { precio = await bcItemLastCost(item); fuente = precio != null ? "item" : null; }
    return NextResponse.json({ precio, fuente });
  } catch (e: any) {
    return NextResponse.json({ precio: null, fuente: null, error: String(e?.message ?? e) });
  }
}
