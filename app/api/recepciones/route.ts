import { NextResponse } from "next/server";
import { createRecepcion } from "@/lib/repo";
import { actor, exigirSesion } from "@/lib/actor";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    const body = await req.json();
    const id = await createRecepcion({ ...body, ...(await actor(body)) });
    return NextResponse.json({ idRecepcionCompra: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, "POST /api/recepciones · registrar recepción") }, { status: 500 });
  }
}
