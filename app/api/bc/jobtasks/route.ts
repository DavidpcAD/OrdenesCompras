import { NextRequest, NextResponse } from "next/server";
import { bcJobTasks } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/jobtasks?jobNo=OR-4321  (jobNo opcional; sin él devuelve todas).
// Catálogo de tareas de obra desde BC (jobTasks, page 50154).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobNo = searchParams.get("jobNo") ?? undefined;
  try {
    return NextResponse.json({ jobTasks: await bcJobTasks(jobNo) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
