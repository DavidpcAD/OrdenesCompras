import { NextResponse } from "next/server";
import { bcResyncPedidoLines, bcReleasePedido, bcAssignItemCharges, bcAddChargeLine } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-sincroniza (precio + variante) las líneas de un pedido YA creado en BC y luego
// lo lanza. Se usa al REINTENTAR "Aprobar y lanzar": si la orden se corrigió en la
// app después de crearse en BC, esas correcciones viajan a BC antes del release.
export async function POST(req: Request) {
  try {
    const { orderNo, lineas, cargos, metodo } = await req.json();
    if (!orderNo) return NextResponse.json({ error: "Falta orderNo" }, { status: 400 });
    // OJO: resync solo PATCHea líneas que ya existen en BC (precio + variante). Una
    // línea agregada en la app después de crear el pedido NO se crea en BC. Antes el
    // resultado se descartaba y la orden quedaba "lanzada" sin avisar que a BC le
    // faltaba material. Ahora se reporta.
    let lineasError: string | undefined;
    let lineasPatched = 0;
    if (Array.isArray(lineas) && lineas.length) {
      const r = await bcResyncPedidoLines(orderNo, lineas);
      lineasPatched = r.patched;
      if (r.sinMatch.length) {
        lineasError = `Estas líneas no están en el pedido de BC y NO se agregaron: ${r.sinMatch.join(", ")}. Agregalas en BC o pedí que se cree el pedido de nuevo.`;
      }
    }
    // Cargos de producto: agregar la línea vía codeunit (idempotente por itemChargeNo),
    // así re-aprobar una orden que se creó sin el cargo lo completa. No debe tumbar,
    // pero SÍ reporta el error (antes se tragaba y quedaba lanzada sin flete).
    let cargoError: string | undefined;
    if (Array.isArray(cargos)) {
      for (const cg of cargos) {
        if (!(cg?.precio > 0)) continue;
        const chargeNo = (cg.chargeNo || process.env.BC_ITEM_CHARGE_FLETE || "").trim();
        if (!chargeNo) { if (!cargoError) cargoError = "El cargo no tiene tipo (Item Charge). Elegí el tipo y reintentá."; continue; }
        try { await bcAddChargeLine(orderNo, chargeNo, cg.descripcion || "CARGO / TRANSPORTE", cg.cantidad || 1, cg.precio); }
        catch (e: any) { if (!cargoError) cargoError = `cargo ${chargeNo}: ${String(e?.message ?? e)}`; }
      }
    }
    // Reasignar cargos si el método no es "por importe" (Amount ya es automático).
    const met = (metodo ?? "").trim();
    if (met && met.toLowerCase() !== "amount") {
      // No debe tumbar el relanzamiento, pero tampoco callarse: si el reparto falla,
      // el cargo queda distribuido por importe y nadie se enteraba.
      try { await bcAssignItemCharges(orderNo, met); }
      catch (e: any) {
        const msg = `no se pudo repartir el cargo por ${met}: ${String(e?.message ?? e)} (quedó por importe)`;
        cargoError = cargoError ? `${cargoError} · ${msg}` : msg;
      }
    }
    const status = await bcReleasePedido(orderNo);
    return NextResponse.json({ ok: true, status, cargoError, lineasError, lineasPatched });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 502 });
  }
}
