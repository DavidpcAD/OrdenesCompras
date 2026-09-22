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

const TOPE_CORREOS = 200;   // por corrida; con ~45 correos al día sobra

/**
 * Trae los correos nuevos desde el marcador y les saca los comprobantes.
 *
 * Solo mira los que traen adjuntos: más de la mitad del buzón son boletines, tiquetes
 * de caja y estados de cuenta que no llevan nada. Y de los adjuntos solo abre los
 * `.xml`, que además son livianos (~10 KB).
 */
export async function leerBuzon(desde: string | null): Promise<{
  correos: CorreoConComprobantes[];
  leidos: number;
  masNuevo: string | null;
}> {
  const c = cfg();
  const buzon = encodeURIComponent(c.buzon);

  // El filtro de fecha se aplica del lado de Microsoft para no traer el buzón entero.
  const filtro = ["hasAttachments eq true", desde ? `receivedDateTime gt ${desde}` : ""]
    .filter(Boolean).join(" and ");
  const url =
    `${GRAPH}/users/${buzon}/mailFolders/inbox/messages` +
    `?$filter=${encodeURIComponent(filtro)}` +
    `&$select=id,subject,from,receivedDateTime,webLink` +
    `&$orderby=receivedDateTime asc&$top=${TOPE_CORREOS}`;

  const data = await graph(url);
  const mensajes: any[] = data.value ?? [];

  const correos: CorreoConComprobantes[] = [];
  let masNuevo: string | null = null;

  for (const m of mensajes) {
    if (!masNuevo || m.receivedDateTime > masNuevo) masNuevo = m.receivedDateTime;
    const comprobantes = await comprobantesDe(buzon, m.id);
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

  return { correos, leidos: mensajes.length, masNuevo };
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
