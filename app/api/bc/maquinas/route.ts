import { NextResponse } from "next/server";
import { bcMaquinas } from "@/lib/bc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/bc/maquinas → { maquinas: [{ no, nombre, placa }], origen, cargando }
//
// Parque de maquinaria de BC (tabla GomEqp Machine 71950576), para el "N.º máquina"
// de la línea del pedido de compra.
//
// `origen` dice por cuál de los tres caminos salió ("api-custom", "odata:<servicio>"
// o ""), que es el dato que hace falta cuando alguien pregunta por qué la lista se ve
// distinta en un entorno. `cargando` es lo que evita la mentira: la primera lectura
// del proceso se hace por OData y tarda cerca de un minuto y medio, así que en vez de
// dejar colgada a la pantalla —o de contestarle "no hay máquinas", que es falso— se
// devuelve vacío con `cargando: true` y la pantalla vuelve a preguntar.
//
// Nunca 500: sin catálogo, la orden se arma igual (la máquina es opcional).
export async function GET() {
  try {
    return NextResponse.json(await bcMaquinas());
  } catch (e: any) {
    return NextResponse.json({ maquinas: [], origen: "", cargando: false, error: String(e?.message ?? e) });
  }
}
