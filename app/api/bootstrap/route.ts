import { NextResponse } from "next/server";
import { listOrdenes, listPedidos, listRecepciones } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Carga inicial de la data para el front-end (modo API).
// NO incluye el historial de movimientos: la tabla dbo.Movimiento completa viajaba
// en cada carga Y en cada auto-refresh (45s) solo para pintar el Timeline de dos
// pantallas de detalle. Ahora el Timeline lo pide por entidad a /api/movimientos.
export async function GET() {
  try {
    const [pedidos, ordenes, recepciones] = await Promise.all([
      listPedidos(), listOrdenes(), listRecepciones(),
    ]);
    return NextResponse.json({ pedidos, ordenes, recepciones });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
