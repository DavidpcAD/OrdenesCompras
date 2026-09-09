import { NextResponse } from "next/server";
import { cerrarSolicitud, reabrirSolicitud } from "@/lib/repo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CERRAR (archivar) una solicitud: lo que quedó sin ordenar ya no se va a comprar.
// El motivo es obligatorio y se valida acá además de en el repo: el guard del modal
// no cuenta: cualquiera con sesión puede llamar esto con un curl, y una solicitud
// archivada sin explicación no se puede reconstruir después.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const { motivo } = body as { motivo?: string };
    if (!String(motivo ?? "").trim()) {
      return NextResponse.json({ error: "Escribí por qué se cierra la solicitud." }, { status: 400 });
    }
    const a = await actor(body);   // identidad de la sesión, no del body
    const r = await cerrarSolicitud(Number(params.id), String(motivo).trim(), a.usuario, a.rol);
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: estado(e) });
  }
}

// Deshacer el archivado. Es DELETE del cierre, no de la solicitud: la solicitud
// vuelve a la bandeja con su saldo (ver reabrirSolicitud).
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const a = await actor(body);
    const r = await reabrirSolicitud(Number(params.id), String((body as any)?.motivo ?? ""), a.usuario, a.rol);
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: estado(e) });
  }
}

// Regla de negocio (ya archivada, no existe, sin motivo) → 409, no 500: la pantalla
// lo muestra tal cual y no parece que se cayó el servidor. Mismo criterio que
// /api/pedidos/[id]/devolver.
function estado(e: any): number {
  const msg = String(e?.message ?? e);
  return /ya está archivada|no está archivada|no existe|Escribí por qué/i.test(msg) ? 409 : 500;
}
