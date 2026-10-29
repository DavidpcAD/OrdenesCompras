import { NextRequest, NextResponse } from "next/server";
import { bcFacturasConNumeroProveedor } from "@/lib/bc";
import { clasificarFacturasMismoNumero } from "@/lib/cargo-recibido";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/facturas-proveedor?vendor=PROV-000621&factura=834
// → { borradores: [...], registradas: [...] }: lo que BC ya tiene con ese mismo N.º
// de factura de ese proveedor. Lo usa Cargo sobre factura para avisar ANTES de
// registrar, porque la misma factura armada a mano en BC y registrada desde acá
// queda dos veces (la 834 de Green Mountain, 29 oct 2026). Si BC no contesta no
// frena nada: devuelve listas vacías y el error.
export async function GET(req: NextRequest) {
  const vendor = req.nextUrl.searchParams.get("vendor") ?? "";
  const factura = req.nextUrl.searchParams.get("factura") ?? "";
  try {
    return NextResponse.json(clasificarFacturasMismoNumero(await bcFacturasConNumeroProveedor(vendor, factura)));
  } catch (e: any) {
    return NextResponse.json({ borradores: [], registradas: [], error: String(e?.message ?? e) });
  }
}
