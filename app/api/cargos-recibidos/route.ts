import { NextResponse } from "next/server";
import { listCargosRecibidos } from "@/lib/repo";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cargos-recibidos → { cargos: [...] }: el histórico de Cargo sobre factura,
// lo más nuevo primero, con el detalle de líneas y los links a BC. Aislado del
// bootstrap: si la base no contesta devuelve [] con el error.
export async function GET() {
  try {
    return NextResponse.json({ cargos: await listCargosRecibidos() });
  } catch (e) {
    return NextResponse.json({ cargos: [], error: mensajeSeguro(e) });
  }
}
