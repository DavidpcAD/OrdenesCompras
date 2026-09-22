import { NextResponse } from "next/server";
import { bcTipoCambio } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/tipo-cambio → { factor: { USD: 450, EURO: 520.9 }, fecha: { USD: "2026-09-22", … } }
//
// En COLONES POR UNIDAD, leído de Business Central (el mismo tipo de cambio con el
// que allá se registran las facturas). Lo usa el Resumen para juntar en un solo
// número las órdenes en dólares y en euros, en vez de dejarlas afuera.
//
// Nunca 500: si BC no contesta se devuelve vacío y el Resumen vuelve a mostrar los
// montos de una sola moneda diciendo cuáles quedaron fuera — que es lo que hacía
// antes. Un panel sin un número es mejor que un panel con un número inventado.
export async function GET() {
  try {
    return NextResponse.json(await bcTipoCambio());
  } catch (e: any) {
    return NextResponse.json({ factor: {}, fecha: {}, error: String(e?.message ?? e) });
  }
}
