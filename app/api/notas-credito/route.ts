import { NextResponse } from "next/server";
import { createNotasCredito, listNotasCredito } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/notas-credito  → { notas: [...] }  (líneas marcadas para nota de crédito)
// POST /api/notas-credito  → crea las líneas marcadas. Body: { idOrdenCompra, usuario, lineas }
// Aislado del bootstrap: si la tabla dbo.NotaCreditoDet no existe, GET devuelve []
// y no rompe el resto de la app.
export async function GET() {
  try {
    return NextResponse.json({ notas: await listNotasCredito() });
  } catch (e: any) {
    return NextResponse.json({ notas: [], error: String(e?.message ?? e) });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const n = await createNotasCredito(body);
    return NextResponse.json({ ok: true, creadas: n });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
