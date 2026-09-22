import { NextRequest, NextResponse } from "next/server";
import { bcRecibidoSinFacturar, bcSinFechaDeEntrega } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/recibido-sin-facturar[?hoy=YYYY-MM-DD]
// Los dos números del Resumen que NO están en la base de la app:
//   · recibido en bodega y todavía sin factura registrada en BC, con su antigüedad;
//   · material pedido al que nadie le puso fecha de entrega.
// Van juntos en una llamada porque salen del mismo web service (`purchaseDocumentLines`)
// y la pantalla los pinta en el mismo momento; dos rutas serían dos esperas.
//
// `hoy` lo manda el navegador porque el servidor puede estar en UTC y en Costa Rica
// (UTC−6) eso corre la antigüedad un día — con tramos de 15 días, un día importa.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const hoy = searchParams.get("hoy") ?? new Date().toISOString().slice(0, 10);
  try {
    const [sinFacturar, sinFecha] = await Promise.all([
      bcRecibidoSinFacturar(hoy),
      bcSinFechaDeEntrega(),
    ]);
    return NextResponse.json({ sinFacturar, sinFecha });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
