// Freno de CSRF: una escritura tiene que venir de ESTE mismo sitio.
//
// La cookie de sesión ya es SameSite=Lax, que frena el caso clásico (otra página que
// postea a la API con la sesión de quien la visita). Esto es el segundo candado: el
// navegador manda `Origin` en todo POST/PUT/PATCH/DELETE y no deja que una página lo
// falsifique, así que si dice otro sitio, se corta.
//
// Sin `Origin` se deja pasar (curl, scripts): sin cookie igual no entra, y alguien
// con una cookie robada no está haciendo CSRF. Se apaga con el App Setting
// `CSRF_ORIGEN=0` y se agregan dominios con `ORIGENES_PERMITIDOS` (coma), sin redeploy.

const ESCRITURA = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const lista = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

/**
 * El origen ajeno que hay que rechazar, o null si la escritura puede seguir.
 * `hostsPropios` son los nombres con que llegó el request (Host, x-forwarded-host,
 * separados por coma): vale cualquiera, para no cortar por cómo los pase Azure.
 */
export function origenAjeno(
  metodo: string,
  origin: string | null,
  hostsPropios: string,
  permitidos: string = process.env.ORIGENES_PERMITIDOS ?? ""
): string | null {
  if (!ESCRITURA.has((metodo || "").toUpperCase())) return null;
  if (!origin) return null;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return origin; // "null" (iframe sandbox, file://) o basura: no es este sitio
  }
  return [...lista(hostsPropios || ""), ...lista(permitidos)].includes(host) ? null : origin;
}

export const frenoOrigenActivo = (): boolean => process.env.CSRF_ORIGEN !== "0";
