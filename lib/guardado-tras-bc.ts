// EL HUECO ENTRE BC Y LA APP, CERRADO DEL LADO DEL SERVIDOR.
//
// Registrar una factura eran DOS viajes desde el navegador: primero POST a
// /api/bc/registrar (que postea en BC, la parte lenta y la que mueve plata) y
// después POST a /api/recepciones (que la guarda acá). Entre uno y otro no había
// nada: si la pestaña se cerraba, se vencía la sesión, se cortaba la red o el
// segundo POST fallaba, BC se quedaba con la factura registrada y la app con NADA.
// Sin reintento, sin compensación y sin rastro — el posteo bueno no se logueaba en
// ningún lado, así que ni la bitácora lo veía.
//
// Eso es exactamente lo que le pasó a CP-005394 el 10/09/2026: BC registró
// CFR-010109 por ₡973.359,85 con las 4 líneas correctas, y en la app la orden se
// quedó en Lanzado con recibido 0%. Nadie lo supo hasta que alguien abrió la orden
// seis días después.
//
// Ahora el guardado local va en la MISMA llamada, inmediatamente después de que BC
// confirma, del lado del servidor: sin navegador de por medio, sin viaje extra que
// se pueda perder. Lo único que puede fallar ya es la base — y eso se responde con
// el N.º del documento que BC registró, para que la pantalla ofrezca guardarlo sin
// volver a postear (el diálogo de conciliación) en vez de mandar a reintentar
// contra una pared.
//
// NO se reintenta el insert acá a propósito: `createRecepcion` es transaccional
// (falla = no insertó nada), reintentar contra la base que acaba de fallar rara vez
// cambia algo, y en el modo "factura en revisión" —que no tiene N.º de factura y
// por eso no pasa por el guard de duplicados— un reintento ciego podría dejar dos
// recepciones del mismo material.
import { createRecepcion, setRecepcionFactura, type NewRecepcionDB } from "./repo.ts";
import type { Role } from "./types.ts";

// El insert, inyectable. En producción es siempre `createRecepcion`; el parámetro
// existe para poder probar los frenos de acá (orden que no coincide, id inválido,
// quién queda como autor) sin una base de datos de por medio.
export type CrearRecepcion = (input: NewRecepcionDB) => Promise<number>;

// Lo que manda el navegador para guardar la recepción. Es el mismo cuerpo de
// /api/recepciones MENOS quién la hace: eso sale de la cookie firmada, igual que en
// la bitácora (ver lib/actor.ts), y nunca del body.
export type RecepcionTrasBc = Omit<NewRecepcionDB, "usuario" | "rol" | "bcFacturaNo">;

export type ResultadoGuardado = {
  // Id de la recepción que quedó guardada acá. Si no viene, no se guardó.
  recepcionId?: number;
  // Por qué no se pudo guardar, en claro. La pantalla lo muestra junto con el N.º
  // que BC sí registró: son las dos mitades de lo que pasó.
  errorLocal?: string;
};

export async function guardarRecepcionTrasBc(
  recepcion: RecepcionTrasBc | undefined | null,
  bcFacturaNo: string,
  actor: { usuario: string; rol: Role },
  ordenIdEsperada?: unknown,
  crear: CrearRecepcion = createRecepcion,
): Promise<ResultadoGuardado> {
  // Sin payload no hay nada que guardar: es el modo mock (los datos viven en el
  // navegador) o una pantalla que todavía no manda la recepción. El posteo a BC ya
  // se hizo y se responde igual que siempre.
  if (!recepcion || typeof recepcion !== "object") return {};

  // La recepción tiene que ser de la MISMA orden contra la que se posteó. Sin esto,
  // un cuerpo armado a mano podría registrar en BC contra un pedido y anotar el
  // material recibido en otra orden.
  const idOrden = Number((recepcion as any).idOrdenCompra);
  if (!Number.isFinite(idOrden) || idOrden <= 0) {
    return { errorLocal: "La recepción vino sin el id de la orden, no se guardó acá." };
  }
  if (ordenIdEsperada !== undefined && ordenIdEsperada !== null && String(ordenIdEsperada) !== "" && Number(ordenIdEsperada) !== idOrden) {
    return { errorLocal: `La recepción venía para la orden ${idOrden} y el registro fue contra la ${Number(ordenIdEsperada)}: no se guardó acá.` };
  }

  try {
    const id = await crear({
      ...recepcion,
      idOrdenCompra: idOrden,
      // El N.º que devolvió BC lo pone el servidor, no el navegador: es el dato que
      // ata la recepción de la app con el documento registrado allá.
      bcFacturaNo: bcFacturaNo || undefined,
      usuario: actor.usuario,
      rol: actor.rol,
    });
    return { recepcionId: id };
  } catch (e: any) {
    return { errorLocal: String(e?.message ?? e) };
  }
}

// ── LA OTRA MITAD: FACTURAR LO QUE YA SE HABÍA RECIBIDO ──────────────────────
// Mismo hueco, otra pantalla (Bodega → "Archivo y recepciones", cuando la factura
// venía en revisión y Contabilidad la registra después). Ahí el movimiento local es
// más chico —marcar la recepción como facturada— pero perderlo duele igual: la
// factura queda registrada en BC y la recepción se queda "en revisión" para siempre,
// invitando a registrarla otra vez.
export type FacturaTrasBc = { idRecepcionCompra: number; numeroFactura: string };
export type MarcarFacturada = (idRec: number, numeroFactura: string, usuario: string, rol: Role) => Promise<void>;

export async function marcarFacturadaTrasBc(
  f: FacturaTrasBc | undefined | null,
  actor: { usuario: string; rol: Role },
  marcar: MarcarFacturada = setRecepcionFactura,
): Promise<{ facturada?: boolean; errorLocal?: string }> {
  if (!f || typeof f !== "object") return {};
  const idRec = Number(f.idRecepcionCompra);
  const numero = String(f.numeroFactura ?? "").trim();
  if (!Number.isFinite(idRec) || idRec <= 0) return { errorLocal: "La recepción vino sin id, no se marcó facturada acá." };
  if (!numero) return { errorLocal: "La factura vino sin número, no se marcó facturada acá." };
  try {
    await marcar(idRec, numero, actor.usuario, actor.rol);
    return { facturada: true };
  } catch (e: any) {
    return { errorLocal: String(e?.message ?? e) };
  }
}
