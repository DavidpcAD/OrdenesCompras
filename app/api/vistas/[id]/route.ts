import { NextResponse } from "next/server";
import { deleteVista } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const usuario = new URL(req.url).searchParams.get("usuario") ?? "";
    await deleteVista(Number(params.id), usuario);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
