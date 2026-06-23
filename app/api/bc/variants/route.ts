import { NextResponse } from "next/server";
import { bcVariantsEx } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const item = new URL(req.url).searchParams.get("item") ?? "";
  try {
    const { variantes, disponible } = await bcVariantsEx(item);
    return NextResponse.json({ variantes, disponible });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
