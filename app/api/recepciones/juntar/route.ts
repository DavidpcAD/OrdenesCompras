import { NextResponse } from "next/server";
import { juntarRecepcionesEnRevision } from "@/lib/repo";
import { actor, exigirSesion } from "@/lib/actor";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// JUNTAR dos recepciones EN REVISIÓN de la misma orden en un solo registro, para
// registrar una factura que trae más de lo que tenía una sola. Solo la app: en BC no
// hay nada que juntar (ver juntarRecepcionesEnRevision en lib/repo.ts).
// body: { ids: [idRecepcionA, idRecepcionB] } → { ok, destinoId, origenId }
export async function POST(req: Request) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    const body = await req.json().catch(() => ({} as any));
    const ids = Array.isArray(body?.ids) ? body.ids.map((x: unknown) => Number(x)) : [];
    if (ids.length !== 2) return NextResponse.json({ error: "Faltan las dos recepciones a juntar. Recargá la página." }, { status: 400 });
    const a = await actor({ ...body, rol: body?.rol ?? "facturacion" });
    const r = await juntarRecepcionesEnRevision(ids[0], ids[1], a.usuario, a.rol);
    return NextResponse.json({ ok: true, destinoId: String(r.destinoId), origenId: String(r.origenId) });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 409 });
  }
}
