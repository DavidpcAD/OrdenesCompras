import { NextRequest, NextResponse } from "next/server";
import { getOrden } from "@/lib/repo";
import { ordenAPdf } from "@/lib/orden-pdf";
import { nombreArchivoOrden, ordenImprimible } from "@/lib/orden-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ordenes/123/pdf → descarga el PDF de la orden para el proveedor.
//
// Se genera en el servidor para que el botón baje un .pdf de una vez, sin depender de
// que el usuario elija "Guardar como PDF" en el diálogo del navegador (ahí, si se
// equivoca de opción, termina guardando un .html).
//
// `?ver=1` lo muestra en el navegador en vez de descargarlo (vista previa).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Id de orden inválido." }, { status: 400 });
  try {
    const orden = await getOrden(id);
    if (!orden) return NextResponse.json({ error: "Orden no encontrada." }, { status: 404 });
    // Mismo candado que la pantalla: al proveedor solo se le manda una orden aprobada.
    if (!ordenImprimible(orden)) {
      return NextResponse.json({ error: "La orden debe estar aprobada (Lanzada) para generar el PDF." }, { status: 409 });
    }
    const pdf = await ordenAPdf(orden);
    const verEnPantalla = new URL(req.url).searchParams.get("ver") === "1";
    return new NextResponse(pdf as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${verEnPantalla ? "inline" : "attachment"}; filename="${nombreArchivoOrden(orden)}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("PDF de orden", id, e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
