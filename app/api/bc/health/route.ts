import { NextResponse } from "next/server";
import { bcHealth } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json(await bcHealth());
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
