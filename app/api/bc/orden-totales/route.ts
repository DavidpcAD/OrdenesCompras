import { NextRequest, NextResponse } from "next/server";
import { bcOrdenTotales, bcCompanies } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/orden-totales?orderNo=CP-000123
// Totales del pedido calculados por BC (subtotal excl. IVA, IVA, total con IVA).
// Nunca 500: si BC no responde o el pedido no existe, devuelve { totales: null }.
//
// Y dice CUÁL de las dos cosas fue, en `motivo`. No es lo mismo: "BC no contesta"
// pasa y se arregla solo, pero "BC no tiene ese pedido" significa que el número
// que la app guardó apunta a un documento que ya no existe — y con eso la orden
// no se puede lanzar allá. Antes las dos se veían igual ("Estimado local") y la
// pantalla seguía ofreciendo un "Abrir en BC" que no abría nada.
export async function GET(req: NextRequest) {
  const orderNo = req.nextUrl.searchParams.get("orderNo") ?? "";
  try {
    const totales = await bcOrdenTotales(orderNo);
    if (totales) return NextResponse.json({ totales });
    // Sonda barata (/companies) para saber si BC está contestando. Si contesta y
    // el pedido no vino, es que no está allá.
    let bcContesta = false;
    try { bcContesta = (await bcCompanies()).length > 0; } catch { /* BC caído */ }
    return NextResponse.json({ totales: null, motivo: bcContesta ? "no-existe" : "sin-respuesta" });
  } catch (e: any) {
    return NextResponse.json({ totales: null, error: String(e?.message ?? e) });
  }
}
