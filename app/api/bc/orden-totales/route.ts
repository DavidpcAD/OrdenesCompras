import { NextRequest, NextResponse } from "next/server";
import { bcOrdenTotales, bcCompanies, bcFacturasRegistradasDePedido, bcDeepLinkFacturaRegistrada } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/orden-totales?orderNo=CP-000123
// Totales del pedido calculados por BC (subtotal excl. IVA, IVA, total con IVA).
// Nunca 500: si BC no responde o el pedido no existe, devuelve { totales: null }.
//
// Y dice CUÁL de las tres cosas fue, en `motivo`. No es lo mismo:
//
//   "sin-respuesta" → BC no contesta. Pasa y se arregla solo.
//   "registrado"    → el pedido ya se recibió y facturó COMPLETO allá. BC lo borra al
//                     registrarlo, así que su ausencia es la prueba de que TODO salió
//                     bien. Vienen las facturas registradas y el link para abrirlas.
//   "no-existe"     → BC contesta, no hay pedido y tampoco hay nada registrado contra
//                     ese N.º: apunta a un documento que no existe y así no se puede
//                     lanzar nada.
//
// Los tres se veían igual ("Estimado local") hasta que se separó el primero, y los
// dos últimos siguieron confundidos hasta CP-005394: una compra que en BC entró
// perfecta (CFR-010109) salía en la app con un banner rojo diciendo que el pedido
// "o se borró allá, o no llegó a crearse". La segunda pregunta cuesta una llamada
// más y solo se hace en el caso raro —cuando el pedido ya no está—, así que la
// pantalla normal no paga nada por esto.
export async function GET(req: NextRequest) {
  const orderNo = req.nextUrl.searchParams.get("orderNo") ?? "";
  try {
    const totales = await bcOrdenTotales(orderNo);
    if (totales) return NextResponse.json({ totales });
    // Sonda barata (/companies) para saber si BC está contestando. Si contesta y
    // el pedido no vino, es que no está allá.
    let bcContesta = false;
    try { bcContesta = (await bcCompanies()).length > 0; } catch { /* BC caído */ }
    if (!bcContesta) return NextResponse.json({ totales: null, motivo: "sin-respuesta" });

    const facturas = await bcFacturasRegistradasDePedido(orderNo);
    if (facturas && facturas.length) {
      // Los totales SÍ son los de BC: los de la factura que registró. Se suman por si
      // el pedido se facturó en varias entregas.
      const suma = facturas.reduce((a, f) => ({
        subtotal: a.subtotal + f.subtotal, iva: a.iva + f.iva, total: a.total + f.total,
      }), { subtotal: 0, iva: 0, total: 0 });
      return NextResponse.json({
        totales: null, motivo: "registrado",
        registrado: {
          ...suma,
          currencyCode: facturas[0].currencyCode,
          facturas: facturas.map((f) => ({ numero: f.numero, fecha: f.fecha, total: f.total })),
          url: bcDeepLinkFacturaRegistrada(orderNo) || undefined,
        },
      });
    }
    return NextResponse.json({ totales: null, motivo: "no-existe" });
  } catch (e: any) {
    return NextResponse.json({ totales: null, error: String(e?.message ?? e) });
  }
}
