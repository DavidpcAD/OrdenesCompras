import { NextResponse } from "next/server";
import { createPedido, listPedidos } from "@/lib/repo";
import { actor, exigirSesion } from "@/lib/actor";
import { mensajeSeguro } from "@/lib/error-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    return NextResponse.json(await listPedidos());
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const sinSesion = await exigirSesion();
  if (sinSesion) return sinSesion;
  try {
    const body = await req.json();
    // usuario/rol de la SESIÓN, no del body (el body es falsificable).
    const id = await createPedido({ ...body, ...(await actor(body)) });
    return NextResponse.json({ idPedidoCompra: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, "POST /api/pedidos · crear solicitud") }, { status: 500 });
  }
}
