import { NextResponse } from "next/server";
import { bcRecibir, diagnosticarFalloBc, verificarLineasPosteables, frenoRegistroActivo } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MODO 2 — Solo recepción en BC (material bien, factura en revisión).
// body: { orderNo, lineas: [{itemNo, qty}], postingDate? }
//
// Mismo diagnóstico que /api/bc/registrar: acá no hay N.º de factura, así que lo
// único que se puede separar es "reintentá" de "BC no tiene el pedido" — pero esa
// sola ya evita mandar a Bodega a reintentar contra una pared.
export async function POST(req: Request) {
  const cuerpo = await req.json().catch(() => ({} as any));
  const { orderNo, lineas, postingDate } = cuerpo ?? {};
  try {
    // Mismo freno que en /api/bc/registrar: el codeunit ignora sin avisar la línea
    // que no encuentra en el pedido, y la app la marcaría recibida igual.
    // BC_FRENO_REGISTRO=0 lo apaga desde Azure: si el chequeo diera un falso
    // positivo, Bodega no podría recibir un camión y no se puede esperar un despliegue.
    const freno = frenoRegistroActivo()
      ? await verificarLineasPosteables(String(orderNo ?? ""), lineas ?? [], "recibir")
      : { ok: true, problemas: [] as string[], verificado: false };
    if (!freno.ok) {
      return NextResponse.json({
        ok: false,
        error: `NO se recibió: Business Central no puede recibir ${freno.problemas.length} línea(s).\n\n`
          + freno.problemas.map((p) => `• ${p}`).join("\n")
          + `\n\nCorregí el pedido ${orderNo} en BC (o la orden acá) y volvé a intentar.`,
        frenoLineas: true,
        problemas: freno.problemas,
      }, { status: 409 });
    }
    const receiptNo = await bcRecibir(orderNo, lineas ?? [], postingDate ?? "");
    return NextResponse.json({ ok: true, receiptNo });
  } catch (e: any) {
    const error = String(e?.message ?? e);
    const diag = await diagnosticarFalloBc(error, String(orderNo ?? "")).catch(() => null);
    return NextResponse.json({ ok: false, error, ...(diag ?? {}) }, { status: 502 });
  }
}
