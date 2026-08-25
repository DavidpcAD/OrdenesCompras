import { NextResponse } from "next/server";
import { createOrden, listOrdenes } from "@/lib/repo";
import { actor } from "@/lib/actor";
import { sanearObrasDeLineas, avisoDeSaneo } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listOrdenes());
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Mismo saneo que al editar: la obra (jobNo) de una línea tiene que ser una obra
    // REAL de BC. Si entra un almacén/centro de costo disfrazado de obra, la orden
    // nace envenenada y explota después, al reescribir el pedido en BC.
    if (Array.isArray(body?.lineas)) {
      const saneo = await sanearObrasDeLineas(body.lineas);
      body.lineas = saneo.lineas;
      // Acá no hay canal de aviso hacia la pantalla (la respuesta es solo el id), así
      // que por lo menos queda en el log del server: si un día una orden aparece sin
      // obra, esto dice por qué.
      const a = avisoDeSaneo(saneo);
      if (a) console.warn(`Orden nueva: ${a}`);
    }
    const id = await createOrden({ ...body, ...(await actor(body)) });
    return NextResponse.json({ idOrdenCompra: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
