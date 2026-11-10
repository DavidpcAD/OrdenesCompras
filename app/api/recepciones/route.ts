import { NextResponse } from "next/server";
import { createRecepcion } from "@/lib/repo";
import { actor, exigirSesion } from "@/lib/actor";
import { mensajeSeguro } from "@/lib/error-sql";
import { faltaMotivoRevision } from "@/lib/helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    const body = await req.json();
    // Sin N.º de factura = va a revisión, y entonces el motivo es obligatorio (ver
    // faltaMotivoRevision). Las órdenes sin BC y el respaldo del navegador entran por acá.
    const sinMotivo = faltaMotivoRevision(body);
    if (sinMotivo) return NextResponse.json({ error: sinMotivo }, { status: 400 });
    const id = await createRecepcion({ ...body, ...(await actor(body)) });
    return NextResponse.json({ idRecepcionCompra: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, "POST /api/recepciones · registrar recepción") }, { status: 500 });
  }
}
