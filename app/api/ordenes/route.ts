import { NextResponse } from "next/server";
import { createOrden, listOrdenes } from "@/lib/repo";
import { actor } from "@/lib/actor";

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
    const id = await createOrden({ ...body, ...(await actor(body)) });
    return NextResponse.json({ idOrdenCompra: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
