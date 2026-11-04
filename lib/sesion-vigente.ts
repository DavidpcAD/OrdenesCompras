// ¿La sesión abierta sigue valiendo, aunque la cookie esté bien firmada?
//
// La cookie dura 30 días sin usarse y se renueva sola mientras se use (lib/session.ts).
// Eso es lo que pidió la gente —no tener que entrar todos los días—, pero una sesión
// así de larga solo es segura si se puede CORTAR DESDE AFUERA. Sin esto, alguien que
// se fue de la empresa con la app abierta en su celular seguiría adentro mientras la
// usara, y a quien le vieron la clave no tendría cómo sacar al otro.
//
// Cada pocos minutos se compara la cookie contra el padrón (dbo.Usuario/UsuarioRol):
//   · el usuario ya no existe              → se cierra
//   · ya no tiene un rol con acceso         → se cierra
//   · le tocó otro módulo                   → se cierra (que entre de nuevo con el nuevo)
//   · la contraseña cambió desde que entró  → se cierra (en TODOS sus equipos)
//
// La última es el botón de pánico: "perdí el celular" o "alguien vio mi clave" se
// resuelve cambiando la contraseña en ControlUsuarios. En minutos, toda sesión abierta
// con la clave vieja se cae sola.
//
// Lo que NO hace: tumbar a la gente si la base no contesta. Si el padrón no se pudo
// leer, la sesión sigue (la firma ya la validó); se vuelve a intentar al rato.
//
// Sin dependencias de SQL a propósito: quien lee el padrón se inyecta (lib/actor.ts le
// pasa estadoDeCuenta de lib/auth.ts), así esto se prueba sin base.
import type { SessionPayload } from "./session.ts";
import type { Role } from "./types.ts";

export type EstadoCuenta = { existe: false } | { existe: true; huella: string; role: Role | undefined };

export type Veredicto =
  | { vigente: true }
  | { vigente: false; motivo: "sin-usuario" | "sin-rol" | "otro-rol" | "otra-clave"; mensaje: string };

// Cuánto se confía en la última lectura del padrón. Es también lo que tarda, como
// mucho, en caerse una sesión después de cambiar la contraseña. Con ~30 personas son
// unas pocas consultas mínimas por minuto: nada al lado del bootstrap.
export const REVISAR_CADA_MS = 5 * 60 * 1000;
// Si la base no contestó, se reintenta antes: no hay que esperar 5 minutos para volver
// a revisar, pero tampoco martillarla mientras se recupera.
const REINTENTO_TRAS_FALLO_MS = 60 * 1000;
const MAX_ENTRADAS = 500;

/** El juicio en sí, sin base ni caché. (cubierto por tests) */
export function juzgarSesion(s: SessionPayload, c: EstadoCuenta): Veredicto {
  if (!c.existe) {
    return { vigente: false, motivo: "sin-usuario", mensaje: "Tu usuario ya no existe en el sistema. Si es un error, escribile a TI (davidpc@adelante.cr)." };
  }
  if (!c.role) {
    return { vigente: false, motivo: "sin-rol", mensaje: "Tu usuario ya no tiene acceso a Compras. Si es un error, escribile a TI (davidpc@adelante.cr)." };
  }
  if (c.role !== s.r) {
    return { vigente: false, motivo: "otro-rol", mensaje: "Cambiaron tus permisos en el sistema. Entrá de nuevo para ver tu módulo nuevo." };
  }
  // Cookies de antes de nov 2026: no traen huella. Valen hasta su vencimiento (12 h)
  // y no se renuevan (debeRenovar), así que esto se resuelve solo.
  if (s.h && s.h !== c.huella) {
    return { vigente: false, motivo: "otra-clave", mensaje: "Tu contraseña cambió. Entrá de nuevo con la nueva." };
  }
  return { vigente: true };
}

type Lectura = { t: number; estado: EstadoCuenta | null };   // null = la base no contestó

export function crearRevisor(leer: (username: string) => Promise<EstadoCuenta>, ahora: () => number = Date.now) {
  const cache = new Map<string, Lectura>();
  // Al abrir la app salen varios pedidos juntos; sin esto cada uno leía el padrón por
  // su cuenta (y con la base caída, cada uno dejaba su aviso en el log).
  const enVuelo = new Map<string, Promise<EstadoCuenta | null>>();
  const clave = (u: string) => (u ?? "").trim().toLowerCase();

  function leerFresco(u: string): Promise<EstadoCuenta | null> {
    const k = clave(u);
    const ya = enVuelo.get(k);
    if (ya) return ya;
    const p = (async () => {
      let estado: EstadoCuenta | null = null;
      try {
        estado = await leer(u);
      } catch (e) {
        console.warn(`[seguridad] no se pudo revisar la sesión contra el padrón · usuario=${u} · ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      }
      if (cache.size >= MAX_ENTRADAS) cache.clear();
      cache.set(k, { t: ahora(), estado });
      return estado;
    })().finally(() => enVuelo.delete(k));
    enVuelo.set(k, p);
    return p;
  }

  return async function revisar(s: SessionPayload): Promise<Veredicto> {
    const k = clave(s.u);
    const previa = cache.get(k);
    const vieja = !previa || ahora() - previa.t > (previa.estado ? REVISAR_CADA_MS : REINTENTO_TRAS_FALLO_MS);
    const estado = vieja ? await leerFresco(s.u) : previa!.estado;
    if (!estado) return { vigente: true };   // base caída: no se castiga a nadie

    const v = juzgarSesion(s, estado);
    if (v.vigente || vieja) return v;
    // Para CERRAR una sesión, la lectura tiene que ser de ahora: si la persona acaba de
    // cambiar la clave y entrar con la nueva, la caché todavía tiene la huella vieja y
    // la echaría de una sesión recién abierta.
    const fresco = await leerFresco(s.u);
    return fresco ? juzgarSesion(s, fresco) : { vigente: true };
  };
}
