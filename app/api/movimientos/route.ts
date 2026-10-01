import { NextResponse } from "next/server";
import { listMovimientos } from "@/lib/repo";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const entidad = searchParams.get("entidad") ?? "";
    const id = Number(searchParams.get("id") ?? 0);
    return NextResponse.json(await listMovimientos(entidad, id));
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}
