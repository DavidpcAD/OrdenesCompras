// Freno anti-fuerza-bruta para /api/login.
//
// NO bloquea cuentas (un bloqueo se puede usar para dejar a alguien afuera y
// además molesta a quien simplemente se equivocó): solo DEMORA la respuesta de los
// intentos fallidos del mismo usuario, así probar miles de claves deja de ser
// gratis. El contador vive en memoria del proceso — con varias instancias en Azure
// cada una lleva el suyo, que igual recorta el ritmo del ataque.

const VENTANA_MS = 15 * 60 * 1000;   // se olvida de los fallos viejos
const DEMORA_POR_FALLO_MS = 250;
const DEMORA_MAX_MS = 2000;
const MAX_ENTRADAS = 500;            // techo de memoria

type Entrada = { fallos: number; visto: number };
const porUsuario = new Map<string, Entrada>();

const clave = (username: string) => (username ?? "").trim().toLowerCase();

function limpiar(ahora: number) {
  for (const [k, v] of porUsuario) {
    if (ahora - v.visto > VENTANA_MS) porUsuario.delete(k);
  }
  // Si aun así creció demasiado (muchos usuarios distintos = probablemente un
  // ataque), se tira la mitad más vieja en vez de crecer sin límite.
  if (porUsuario.size > MAX_ENTRADAS) {
    const viejos = [...porUsuario.entries()].sort((a, b) => a[1].visto - b[1].visto).slice(0, Math.floor(porUsuario.size / 2));
    for (const [k] of viejos) porUsuario.delete(k);
  }
}

/** Milisegundos que hay que esperar antes de contestar un fallo de este usuario. */
export function demoraPorFallos(username: string): number {
  const ahora = Date.now();
  limpiar(ahora);
  const e = porUsuario.get(clave(username));
  if (!e || ahora - e.visto > VENTANA_MS) return 0;
  return Math.min(e.fallos * DEMORA_POR_FALLO_MS, DEMORA_MAX_MS);
}

export function registrarFallo(username: string): void {
  const ahora = Date.now();
  const k = clave(username);
  const e = porUsuario.get(k);
  if (!e || ahora - e.visto > VENTANA_MS) porUsuario.set(k, { fallos: 1, visto: ahora });
  else porUsuario.set(k, { fallos: e.fallos + 1, visto: ahora });
}

export function registrarExito(username: string): void {
  porUsuario.delete(clave(username));
}

export const esperar = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
