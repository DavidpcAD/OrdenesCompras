import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { health } from "@/lib/repo";
import { SESSION_COOKIE, verifySession, authEnabled } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health check. Es una de las POCAS rutas públicas (la usa el probe de Azure), así
// que sin sesión responde lo mínimo: `{ ok }` y nada más. Antes devolvía los
// conteos de pedidos/órdenes/recepciones —volumen del negocio— a cualquiera, y si
// SQL estaba caído soltaba el error crudo con host y puerto ("…:1433").
// Con sesión válida (o en local, donde no hay secreto configurado) sí da el detalle,
// que es para lo que se usa a mano.
export async function GET() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const conDetalle = !authEnabled() || !!(await verifySession(token));
  try {
    const h = await health();
    return NextResponse.json(conDetalle ? h : { ok: true });
  } catch (e: any) {
    console.error("health", e);
    return NextResponse.json(
      conDetalle ? { ok: false, error: String(e?.message ?? e) } : { ok: false },
      { status: 500 }
    );
  }
}
