import { NextResponse } from "next/server";
import { bcVariants } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const item = new URL(req.url).searchParams.get("item") ?? "";
  try {
    return NextResponse.json({ variantes: await bcVariants(item) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
