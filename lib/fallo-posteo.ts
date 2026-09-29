// EL INTENTO QUE NO ENTRÓ TAMBIÉN ES HISTORIA.
//
// Registrar, recibir y facturar hablan con Business Central. Cuando BC dice que no,
// la ruta devolvía 502 con el motivo y ahí moría: la pantalla mostraba el error, la
// persona cerraba el diálogo y en la orden no quedaba NADA. Días después, cuando
// alguien pregunta qué le pasó a esa compra, no hay ni rastro de que se haya
// intentado — y si el intento dejó algo torcido en BC, peor todavía.
//
// Eso es lo que costó CP-005541: el 28 sep 2026 un posteo des-lanzó el pedido en BC
// (un pedido en dólares hay que reabrirlo para moverle la fecha de registro), el
// reintento falló, el pedido quedó Abierto allá y la orden siguió diciendo "Lanzado"
// acá. El único aviso fue un toast. Se descubrió el 29, de casualidad, y hubo que
// reconstruirlo leyendo fechas del encabezado en BC.
//
// Acá se anotan las dos cosas, y ninguna puede tumbar la respuesta del error real:
//  1. SIEMPRE: el intento fallido va a la bitácora de la orden (`bc_fallo`).
//  2. Si el pedido quedó ABIERTO en BC, además se marca la orden como desalineada,
//     que es lo que hace salir el aviso rojo del detalle sin que nadie tenga que
//     correr "Verificar contra BC" a mano.
import { anotarFalloBc, guardarChequeoBc } from "./repo.ts";
import type { Role } from "./types.ts";

export type AccionBc = "registrar" | "recibir" | "facturar";

const QUE_SE_INTENTO: Record<AccionBc, string> = {
  registrar: "registrar la factura",
  recibir: "recibir el material",
  facturar: "facturar lo ya recibido",
};

// El texto de la bitácora, con el vocabulario de quien lo va a leer: "no se pudo
// recibir el material", no "POST /api/bc/recibir 502".
export function textoDelFallo(accion: AccionBc, orderNo: string, error: string): string {
  return `No se pudo ${QUE_SE_INTENTO[accion]} en Business Central${orderNo ? ` (pedido ${orderNo})` : ""}: ${error}`.slice(0, 3900);
}

// El texto del aviso rojo cuando el pedido quedó des-lanzado en BC. Dice las tres
// cosas que hacen falta para actuar: qué pasó, por qué el pedido está así, y quién
// lo destraba.
export function textoPedidoAbierto(accion: AccionBc, orderNo: string): string {
  return `SIN LANZAR EN BC — al intentar ${QUE_SE_INTENTO[accion]}, Business Central exigió el pedido ${orderNo} Abierto, `
    + `se reabrió para reintentar y el reintento tampoco entró: allá quedó ABIERTO. `
    + `Bodega no va a poder recibir hasta que se lance de nuevo (en BC, o mandando la orden otra vez a aprobación).`;
}

// Nunca lanza: esto corre DENTRO del catch de la ruta, y un problema al anotar no
// puede quedarse con el error que la persona necesita ver.
export async function anotarFalloDeBc(input: {
  error: string;
  ordenId: unknown;
  orderNo: unknown;
  accion: AccionBc;
  // Quién lo intentó, ya resuelto por la ruta desde la cookie firmada (ver
  // lib/actor.ts). Llega de afuera y no se lee acá a propósito: así este módulo no
  // depende de Next y se puede probar. Si el fallo pasó antes de resolverlo, queda
  // el mismo "Sistema" que usa el resto de la app.
  quien?: { usuario: string; rol: Role } | null;
  causa?: unknown;   // el Error tal cual: trae la bandera `pedidoAbiertoEnBc`
  // El pedido quedó Abierto en BC y la ruta ya lo sabe por otro lado (la red de
  // atrás de reponerLanzamientoTrasFallo, que no pasa por el Error).
  pedidoAbierto?: string;
}): Promise<void> {
  const id = Number(input.ordenId);
  if (!Number.isFinite(id) || id <= 0) return;   // sin orden no hay dónde anotarlo
  const quien = input.quien ?? { usuario: "Sistema", rol: "proveeduria" as Role };
  try {
    const no = String(input.orderNo ?? "");
    await anotarFalloBc(id, textoDelFallo(input.accion, no, input.error), quien.usuario, quien.rol);
    const abierto = input.pedidoAbierto || (input.causa as { pedidoAbiertoEnBc?: string } | undefined)?.pedidoAbiertoEnBc;
    if (abierto) {
      await guardarChequeoBc(id, "desalineado", textoPedidoAbierto(input.accion, abierto), quien.usuario, quien.rol);
    }
  } catch { /* la bitácora no puede tapar el error real */ }
}
