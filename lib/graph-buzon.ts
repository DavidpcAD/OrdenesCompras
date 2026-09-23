// EL BUZÓN DE FACTURACIÓN — lectura por Microsoft Graph, con identidad propia.
//
// Lee facturacion@adelantedesarrollos.com y devuelve los comprobantes electrónicos
// que vienen adjuntos, ya parseados. La app se autentica como ella misma (client
// credentials), no como una persona: así corre sola, de noche, sin que nadie tenga
// la sesión abierta.
//
// QUÉ HACE FALTA PARA QUE ESTO FUNCIONE (es un trámite, no código):
//
//   1. En Entra, sobre el registro de app que YA existe para Business Central:
//      API permissions → Microsoft Graph → Application permissions → `Mail.Read`
//      → Grant admin consent.
//   2. Acotarlo a ESE buzón, si no la app podría leer el correo de toda la empresa:
//        New-ApplicationAccessPolicy -AppId <BC_CLIENT_ID> `
//          -PolicyScopeGroupId <grupo-con-ese-buzon@adelantedesarrollos.com> `
//          -AccessRight RestrictAccess -Description "Solo el buzon de facturacion"
//   3. Variable `BUZON_FACTURACION=facturacion@adelantedesarrollos.com`.
//
// Se reutilizan a propósito las credenciales de BC (`BC_TENANT_ID` / `BC_CLIENT_ID` /
// `BC_CLIENT_SECRET`) para que el trámite sea agregarle UN permiso a una app que ya
// está aprobada, y no crear y consentir una nueva. Si algún día conviene separarlas,
// basta con definir `GRAPH_*` y estas mandan.
//
// Mientras el permiso no exista, `estadoBuzon()` dice exactamente qué falta y la
// pantalla lo muestra en vez de fallar con un 500 que no explica nada.

import { leerComprobanteXml, type Comprobante } from "./cruce-correo-bc.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";

const cfg = () => ({
  tenant: process.env.GRAPH_TENANT_ID || process.env.BC_TENANT_ID || "",
  clientId: process.env.GRAPH_CLIENT_ID || process.env.BC_CLIENT_ID || "",
  secret: process.env.GRAPH_CLIENT_SECRET || process.env.BC_CLIENT_SECRET || "",
  buzon: process.env.BUZON_FACTURACION || "",
});

export type EstadoBuzon =
  | { listo: true; buzon: string }
  | { listo: false; falta: string; comoSeArregla: string };

/** Si la app puede leer el buzón, y si no, qué falta exactamente. */
export function estadoBuzon(): EstadoBuzon {
  const c = cfg();
  if (!c.buzon) {
    return {
      listo: false,
      falta: "No está configurado cuál es el buzón.",
      comoSeArregla: "Definir la variable BUZON_FACTURACION con el correo del buzón (por ejemplo facturacion@adelantedesarrollos.com).",
    };
  }
  if (!c.tenant || !c.clientId || !c.secret) {
    return {
      listo: false,
      falta: "Faltan las credenciales para autenticarse contra Microsoft.",
      comoSeArregla: "La app usa las mismas de Business Central (BC_TENANT_ID, BC_CLIENT_ID, BC_CLIENT_SECRET). Si no están, hay que definirlas o poner las GRAPH_* equivalentes.",
    };
  }
  return { listo: true, buzon: c.buzon };
}

let cache: { token: string; exp: number } | null = null;

async function token(forzar = false): Promise<string> {
  const c = cfg();
  if (!forzar && cache && cache.exp > Date.now() + 60_000) return cache.token;
  const res = await fetch(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`Microsoft no dio token (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const j = await res.json();
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cache.token;
}

async function graph(url: string): Promise<any> {
  const pedir = (bearer: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" }, cache: "no-store" });

  let res = await pedir(await token());

  // Se reintenta con token FRESCO ante 401 y también ante 403, y el 403 es el que
  // importa acá: los roles de aplicación viajan DENTRO del token. Si la app pidió su
  // token antes de que un administrador consintiera Mail.Read, ese token no trae el
  // rol y Graph contesta 403 durante la hora que dura, aunque el permiso ya esté
  // dado. Pasó exactamente así el 22 de setiembre de 2026: el consentimiento estaba
  // puesto, la lectura funcionaba desde afuera, y la app seguía diciendo 403 porque
  // arrastraba el token de antes.
  if (res.status === 401 || res.status === 403) {
    res = await pedir(await token(true));
  }
  if (!res.ok) {
    const cuerpo = (await res.text()).slice(0, 400);
    // El error más probable en la primera puesta a punto es justo el del permiso, y
    // el mensaje crudo de Graph no lo dice en cristiano.
    if (res.status === 403) {
      throw new Error(
        "Microsoft rechazó la lectura del buzón (403). Casi siempre es que al registro de app le falta el permiso " +
        "Mail.Read de APLICACIÓN con consentimiento de administrador, o que la ApplicationAccessPolicy no incluye este buzón. " +
        `Respuesta: ${cuerpo}`,
      );
    }
    if (res.status === 404) {
      throw new Error(`Microsoft no encontró el buzón ${cfg().buzon} (404). Revisá que la dirección esté bien escrita. ${cuerpo}`);
    }
    throw new Error(`Graph ${res.status}: ${cuerpo}`);
  }
  return res.json();
}

export type CorreoConComprobantes = {
  messageId: string;
  asunto: string;
  remitente: string;
  recibido: string;
  webLink: string;
  comprobantes: Comprobante[];
};

const POR_PAGINA = 100;
const TOPE_POR_CORRIDA = 40;    // correos CON adjunto que se abren por vuelta
const A_LA_VEZ = 5;             // adjuntos en paralelo; más arriba Graph empieza a tirar 429
const DIAS_PRIMERA_CORRIDA = 30;

/**
 * Arma la consulta al buzón.
 *
 * REGLA QUE COSTÓ UN RATO: Exchange NO acepta filtrar por `hasAttachments` y ordenar
 * por `receivedDateTime` en la misma consulta — contesta 400 `InefficientFilter`
 * ("The restriction or sort order is too complex for this operation"). Solo tolera
 * filtrar y ordenar por la MISMA propiedad. Así que la fecha va en el filtro, el
 * orden va por fecha, y lo de los adjuntos se descarta acá con el `hasAttachments`
 * que viene en el `$select`. Sale más barato de lo que parece: son unos pocos bytes
 * por correo y evita traerse el buzón entero.
 *
 * Si no hay marcador (primera corrida) se arranca 30 días atrás y no desde el
 * principio: la bandeja tiene 31.932 correos y ordenar de viejo a nuevo empezaría en
 * 2019.
 */
export function consultaBuzon(buzon: string, desde: string | null, hoy = new Date()): string {
  const arranque = desde ?? new Date(hoy.getTime() - DIAS_PRIMERA_CORRIDA * 86_400_000).toISOString();
  const filtro = encodeURIComponent(`receivedDateTime gt ${arranque}`);
  return `${GRAPH}/users/${encodeURIComponent(buzon)}/mailFolders/inbox/messages` +
    `?$filter=${filtro}` +
    `&$select=id,subject,from,receivedDateTime,webLink,hasAttachments` +
    `&$orderby=receivedDateTime asc&$top=${POR_PAGINA}`;
}

/**
 * Trae los correos nuevos desde el marcador y les saca los comprobantes.
 *
 * Solo abre los que traen adjuntos: más de la mitad del buzón son boletines, tiquetes
 * de caja y estados de cuenta que no llevan nada. Y de los adjuntos solo lee los
 * `.xml`, que son livianos (~10 KB).
 *
 * Va por tandas y devuelve `hayMas`: abrir los adjuntos es una llamada por correo, y
 * una primera corrida de 30 días son cientos. Como el marcador avanza con lo que sí
 * se procesó, la corrida siguiente sigue donde quedó — y la pantalla se sincroniza
 * sola cada 3 minutos, así que se pone al día sin que nadie haga nada.
 */
export type Progreso = { hechos: number; total: number };

export async function leerBuzon(
  desde: string | null,
  onProgreso?: (p: Progreso) => void,
): Promise<{
  correos: CorreoConComprobantes[];
  leidos: number;
  masNuevo: string | null;
  hayMas: boolean;
}> {
  const c = cfg();
  const buzon = encodeURIComponent(c.buzon);

  const correos: CorreoConComprobantes[] = [];
  const pendientes: any[] = [];
  let masNuevo: string | null = null;
  let leidos = 0, abiertos = 0, hayMas = false;
  let url: string | null = consultaBuzon(c.buzon, desde);

  while (url) {
    const data: any = await graph(url);
    const mensajes: any[] = data.value ?? [];
    if (!mensajes.length) break;

    for (const m of mensajes) {
      if (abiertos >= TOPE_POR_CORRIDA) { hayMas = true; break; }
      leidos++;
      // El marcador solo avanza sobre lo que de verdad se terminó de procesar: si se
      // adelantara a toda la página, los que quedaron sin abrir no se volverían a ver.
      if (!masNuevo || m.receivedDateTime > masNuevo) masNuevo = m.receivedDateTime;
      if (!m.hasAttachments) continue;

      abiertos++;
      pendientes.push(m);
    }

    // El total se informa por página y no de entrada: cuántos correos con adjunto hay
    // solo se sabe al ir leyendo. Da una barra que puede crecer, pero es la verdad —
    // preferible a inventar un total redondo que después no calza.
    const totalConocido = abiertos;
    let hechos = abiertos - pendientes.length;
    onProgreso?.({ hechos, total: totalConocido });

    // Los adjuntos se piden de a cinco. Eran uno por uno y una corrida de 120 correos
    // se pasaba del tiempo que aguanta la petición: la pantalla mostraba "Timeout" y
    // el cotejo ni siquiera llegaba a correr.
    for (let i = 0; i < pendientes.length; i += A_LA_VEZ) {
      const grupo = pendientes.slice(i, i + A_LA_VEZ);
      const res = await Promise.all(grupo.map(async (m) => ({ m, comprobantes: await comprobantesDe(buzon, m.id) })));
      hechos += grupo.length;
      onProgreso?.({ hechos, total: totalConocido });
      for (const { m, comprobantes } of res) {
        if (!comprobantes.length) continue;
        correos.push({
          messageId: m.id,
          asunto: m.subject ?? "",
          remitente: m.from?.emailAddress?.address ?? "",
          recibido: m.receivedDateTime ?? "",
          webLink: m.webLink ?? "",
          comprobantes,
        });
      }
    }
    pendientes.length = 0;

    if (hayMas) break;
    url = data["@odata.nextLink"] ?? null;
  }

  return { correos, leidos, masNuevo, hayMas };
}

async function comprobantesDe(buzon: string, messageId: string): Promise<Comprobante[]> {
  // `$select` no aplica a contentBytes en fileAttachment, así que se pide todo el
  // adjunto; por eso importa filtrar por nombre antes de decidir qué parsear.
  const data = await graph(
    `${GRAPH}/users/${buzon}/messages/${encodeURIComponent(messageId)}/attachments`,
  );
  const out: Comprobante[] = [];
  for (const a of (data.value ?? [])) {
    const nombre: string = a.name ?? "";
    if (!/\.xml$/i.test(nombre)) continue;
    if (!a.contentBytes) continue;                    // adjunto de referencia, no viene el archivo
    let xml = "";
    try {
      xml = Buffer.from(a.contentBytes, "base64").toString("utf8");
    } catch { continue; }
    const c = leerComprobanteXml(xml, nombre);        // descarta solo los acuses de Hacienda
    if (c) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// EL XML DE UN COMPROBANTE, A PEDIDO
// ---------------------------------------------------------------------------
//
// La sincronización guarda de cada comprobante el encabezado y nada más: quién lo
// emitió, con qué número y por cuánto. Para el cotejo lado a lado hacen falta las
// LÍNEAS, y esas siguen dentro del XML adjunto al correo.
//
// Se van a buscar cuando alguien abre esa factura, no en cada corrida. Es una
// llamada a Graph por factura abierta contra guardar 1.300 XML al mes en la base —y,
// sobre todo, contra no poder mostrárselas NUNCA a las miles que ya están guardadas,
// porque el marcador del buzón solo avanza y esos correos no se releen.
//
// De dónde sale el id del correo: del `webLink` que ya se guardó. El `ItemID` de esa
// URL es el mismo id del mensaje, con dos caracteres cambiados —`/` viaja como `-` y
// `+` como `_`—. Medido contra el buzón real: 8 de 8 correos reconstruidos exactos y
// los adjuntos se bajan con ese id. Vale más que agregar una columna `messageId`,
// que solo serviría de hoy en adelante.

/** El id del mensaje de Graph escondido en el `webLink` de Outlook. */
export function idDeMensaje(webLink: string): string | null {
  const m = /[?&]ItemID=([^&]+)/i.exec(webLink ?? "");
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/\//g, "-").replace(/\+/g, "_");
  } catch {
    return null;
  }
}

export type AdjuntoComprobante = { archivo: string; xml: string; comprobante: Comprobante };

/**
 * El XML del comprobante `clave` dentro del correo que apunta ese `webLink`.
 *
 * Un mismo correo puede traer varias facturas —los proveedores grandes mandan la
 * tanda del día junta—, así que se escoge por clave y no "el primer XML": abrir la
 * factura A y que se muestren las líneas de la B sería peor que no mostrar nada.
 *
 * Devuelve null si el correo ya no está (se movió de carpeta o se borró) o si no
 * trae ese comprobante. La pantalla lo dice en cristiano y deja el enlace a Outlook.
 */
export async function xmlDeComprobante(webLink: string, clave: string): Promise<AdjuntoComprobante | null> {
  const id = idDeMensaje(webLink);
  if (!id) return null;
  const buzon = encodeURIComponent(cfg().buzon);
  const data = await graph(`${GRAPH}/users/${buzon}/messages/${encodeURIComponent(id)}/attachments`);
  for (const a of (data.value ?? [])) {
    const archivo: string = a.name ?? "";
    if (!/\.xml$/i.test(archivo) || !a.contentBytes) continue;
    let xml = "";
    try { xml = Buffer.from(a.contentBytes, "base64").toString("utf8"); } catch { continue; }
    const comprobante = leerComprobanteXml(xml, archivo);
    if (!comprobante) continue;                       // acuse de Hacienda
    if (comprobante.clave === clave) return { archivo, xml, comprobante };
  }
  // Ninguno calzó. No se cae al "primer XML que aparezca" a propósito: mostrar las
  // líneas de otra factura sería peor que decir que no se pudieron leer.
  return null;
}
