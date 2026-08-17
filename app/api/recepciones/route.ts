import { NextResponse } from "next/server";
import { createRecepcion } from "@/lib/repo";
import { actor } from "@/lib/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const id = await createRecepcion({ ...body, ...(await actor(body)) });
    return NextResponse.json({ idRecepcionCompra: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
