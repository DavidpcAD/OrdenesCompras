// Freno anti-fuerza-bruta para /api/login.
//
// Dos capas:
//
// 1. DEMORA SUAVE (desde ago 2026): cada fallo del mismo usuario demora un poco más la
//    respuesta del siguiente fallo (250 ms, 500 ms… hasta 2 s). Molesta poco al que se
//    equivocó y vuelve lento al que prueba de a una.
//
// 2. PAUSA DURA (nov 2026): la demora sola no frena a quien manda cien intentos A LA
//    VEZ —cada uno espera su par de segundos en paralelo—. Pasados FALLOS_LIBRES
//    fallos seguidos con el mismo usuario, el próximo intento se rechaza SIN mirar la
//    contraseña hasta que pase una pausa que se duplica (30 s, 1 min, 2 min… tope 15
//    min). Lo mismo por dirección IP, con más margen: muchos usuarios distintos desde
//    el mismo lugar es alguien barriendo cuentas.
//
//    No es un bloqueo de cuenta: se destraba sola en minutos y nadie tiene que ir a TI.
//    Como la sesión dura 30 días, la gente casi no vuelve a escribir la clave, y una
//    pausa de unos minutos no le estorba a nadie que trabaje de verdad. A un atacante,
//    en cambio, lo deja en ~4 intentos por hora por usuario.
//
// El contador vive en memoria del proceso: con varias instancias en Azure cada una
// lleva el suyo, que igual recorta el ritmo del ataque.

const VENTANA_MS = 15 * 60 * 1000;   // se olvida de los fallos viejos
const DEMORA_POR_FALLO_MS = 250;
const DEMORA_MAX_MS = 2000;
const MAX_ENTRADAS = 500;            // techo de memoria

// Pausa dura
export const FALLOS_LIBRES = 5;
const PAUSA_BASE_MS = 30 * 1000;
const PAUSA_MAX_MS = 15 * 60 * 1000;
export const FALLOS_POR_IP = 30;     // en la ventana; ninguna oficina se equivoca tanto
const PAUSA_IP_MS = 15 * 60 * 1000;

type Entrada = { fallos: number; visto: number };
const porUsuario = new Map<string, Entrada>();
const porIp = new Map<string, Entrada>();

const clave = (username: string) => (username ?? "").trim().toLowerCase();

/** Cuánto hay que esperar después del último fallo, según cuántos van. (cubierto por tests) */
export function pausaPorFallos(fallos: number): number {
  if (fallos < FALLOS_LIBRES) return 0;
  return Math.min(PAUSA_BASE_MS * 2 ** (fallos - FALLOS_LIBRES), PAUSA_MAX_MS);
}

// Un contador se olvida cuando pasa la ventana DESPUÉS de terminada su pausa: si se
// olvidara a los 15 min justos, al que llegó a la pausa de 15 min se le reiniciarían
// los intentos libres apenas termina.
const vigente = (e: Entrada | undefined, ahora: number, pausa: number): e is Entrada =>
  !!e && ahora - e.visto <= VENTANA_MS + pausa;

function limpiar(mapa: Map<string, Entrada>, ahora: number, pausaDe: (e: Entrada) => number) {
  for (const [k, v] of mapa) {
    if (!vigente(v, ahora, pausaDe(v))) mapa.delete(k);
  }
  // Si aun así creció demasiado (muchos usuarios distintos = probablemente un
  // ataque), se tira la mitad más vieja en vez de crecer sin límite.
  if (mapa.size > MAX_ENTRADAS) {
    const viejos = [...mapa.entries()].sort((a, b) => a[1].visto - b[1].visto).slice(0, Math.floor(mapa.size / 2));
    for (const [k] of viejos) mapa.delete(k);
  }
}

const pausaIp = (e: Entrada) => (e.fallos >= FALLOS_POR_IP ? PAUSA_IP_MS : 0);
const pausaUsuario = (e: Entrada) => pausaPorFallos(e.fallos);

/** Milisegundos que hay que esperar antes de contestar un fallo de este usuario. */
export function demoraPorFallos(username: string): number {
  const ahora = Date.now();
  limpiar(porUsuario, ahora, pausaUsuario);
  const e = porUsuario.get(clave(username));
  if (!e || ahora - e.visto > VENTANA_MS) return 0;
  return Math.min(e.fallos * DEMORA_POR_FALLO_MS, DEMORA_MAX_MS);
}

/**
 * ¿Se puede intentar ya? Devuelve cuántos ms faltan (y por qué) o null si puede.
 * Se pregunta ANTES de mirar la contraseña: durante la pausa ni siquiera se compara,
 * así que probar ahí no le dice nada al atacante, ni siquiera si acertó.
 */
export function esperaAntesDeIntentar(username: string, ip: string): { ms: number; por: "usuario" | "ip" } | null {
  const ahora = Date.now();
  limpiar(porUsuario, ahora, pausaUsuario);
  limpiar(porIp, ahora, pausaIp);
  const eu = porUsuario.get(clave(username));
  if (eu) {
    const falta = eu.visto + pausaPorFallos(eu.fallos) - ahora;
    if (falta > 0) return { ms: falta, por: "usuario" };
  }
  const ei = ip && ip !== "?" ? porIp.get(ip) : undefined;
  if (ei && ei.fallos >= FALLOS_POR_IP) {
    const falta = ei.visto + PAUSA_IP_MS - ahora;
    if (falta > 0) return { ms: falta, por: "ip" };
  }
  return null;
}

function sumar(mapa: Map<string, Entrada>, k: string, ahora: number, pausaDe: (e: Entrada) => number): number {
  const e = mapa.get(k);
  const fallos = vigente(e, ahora, e ? pausaDe(e) : 0) ? e.fallos + 1 : 1;
  mapa.set(k, { fallos, visto: ahora });
  return fallos;
}

/** Anota el fallo y devuelve cuántos lleva ese usuario en la ventana (para el log). */
export function registrarFallo(username: string, ip?: string): number {
  const ahora = Date.now();
  if (ip && ip !== "?") sumar(porIp, ip, ahora, pausaIp);
  return sumar(porUsuario, clave(username), ahora, pausaUsuario);
}

// Umbral a partir del cual el log lo marca como posible fuerza bruta: equivocarse
// dos o tres veces es normal; diez en 15 minutos ya no.
export const FALLOS_SOSPECHOSOS = 10;

// Entrar bien limpia el contador DEL USUARIO, no el de la IP: si no, alguien con una
// cuenta propia válida podría entrar con ella entre intento e intento y reiniciar el
// freno de su IP.
export function registrarExito(username: string): void {
  porUsuario.delete(clave(username));
}

export const esperar = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * IP real de quien llama, en Azure App Service.
 *
 * Azure AGREGA la IP del cliente al final de X-Forwarded-For (como "IP:puerto"). Lo
 * que viene antes lo puede escribir cualquiera, así que tomar el PRIMERO —como hacían
 * los logs— dejaba a un atacante inventarse una IP distinta en cada intento y saltarse
 * el freno por IP. (cubierto por tests)
 */
export function ipCliente(xff: string | null | undefined): string {
  const partes = (xff ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const ultima = partes[partes.length - 1] ?? "";
  const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(ultima);
  if (v6) return v6[1];
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ultima)) return ultima.replace(/:\d+$/, "");
  return ultima || "?";
}

/** "30 segundos", "1 minuto", "8 minutos": para decirle a la persona cuánto esperar. */
export function textoEspera(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `${s} segundos`;
  const m = Math.ceil(s / 60);
  return m === 1 ? "1 minuto" : `${m} minutos`;
}
