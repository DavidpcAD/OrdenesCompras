import { NextRequest, NextResponse } from "next/server";
import { getPedido } from "@/lib/repo";
import { pedidoAPdf, nombreArchivoPedido } from "@/lib/pedido-pdf";
import { bcDescripcionUnidades } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/pedidos/8/pdf → descarga la SOLICITUD DE COTIZACIÓN en PDF, para mandarle
// la lista de materiales a un proveedor y que ponga precios.
//
// Igual que el PDF de la orden: se genera en el servidor para que el botón baje un
// .pdf de una vez y no dependa de que el usuario elija bien en el diálogo de
// impresión (ahí, equivocándose de opción, termina guardando un .html).
//
// `?ver=1` lo abre en el navegador en vez de descargarlo.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Id de solicitud inválido." }, { status: 400 });
  try {
    const pedido = await getPedido(id);
    if (!pedido) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
    if (!pedido.lineas.length) {
      return NextResponse.json({ error: "La solicitud no tiene líneas: no hay nada que cotizar." }, { status: 409 });
    }
    // Descripciones de unidad desde BC ("ESTAÑON" en vez de "EST"). Si BC no
    // responde, sale el código: el documento no se cae por esto.
    const pdf = await pedidoAPdf(pedido, await bcDescripcionUnidades().catch(() => ({})));
    const verEnPantalla = new URL(req.url).searchParams.get("ver") === "1";
    return new NextResponse(pdf as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${verEnPantalla ? "inline" : "attachment"}; filename="${nombreArchivoPedido(pedido)}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("PDF de solicitud", id, e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
