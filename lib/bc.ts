// Cliente de Business Central (SaaS) por OAuth client-credentials (S2S),
// usando las APIs PERSONALIZADAS de Adelante (publisher 'adelante', v1.0):
//   - Items:  grupo 'inventory'  -> entitySet 'items'   (page 50125 ItemAPI)
//   - Obras:  grupo 'project'     -> entitySet 'jobs'    (page 50170 JobAPI)
// La compañía sale de BC_COMPANY_ID (GUID). El tenant/environment se deducen
// de BC_BASE_URL (o de BC_TENANT_ID/BC_ENVIRONMENT).

type TokenCache = { token: string; exp: number };
let tokenCache: TokenCache | null = null;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

function soloGuid(v?: string): string | null {
  const m = (v ?? "").match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return m ? m[0] : null;
}

function tenantYEntorno(): { tenant: string; environment: string } {
  const base = process.env.BC_BASE_URL ?? "";
  const m = base.match(/\/v2\.0\/([^/]+)\/([^/]+)\/api\b/i);
  if (m) return { tenant: m[1], environment: m[2] };
  return { tenant: env("BC_TENANT_ID"), environment: process.env.BC_ENVIRONMENT ?? "Sandbox" };
}

// Raíz de una API personalizada de Adelante para un grupo dado.
function customRoot(group: string): string {
  const { tenant, environment } = tenantYEntorno();
  return `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${environment}/api/adelante/${group}/v1.0`;
}

// Raíz de la API ESTÁNDAR v2.0 (la usa digitación; tiene itemVariants).
function stdRoot(): string {
  const { tenant, environment } = tenantYEntorno();
  return `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${environment}/api/v2.0`;
}

let companyIdCache: string | null = null;

// Resuelve el id de la compañía. Preferimos resolver por NOMBRE listando
// /companies del API custom (así no dependemos de un GUID mal configurado y
// caemos en la compañía a la que la app SÍ tiene permiso). Fallback al GUID.
async function getCompanyId(): Promise<string> {
  if (companyIdCache) return companyIdCache;
  const nombre = process.env.BC_COMPANY || "ADELANTE_DESARROLLOS_NUEVA";
  try {
    const token = await getToken();
    const res = await fetch(`${customRoot("inventory")}/companies`, { cache: "no-store", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      const lista: any[] = data.value ?? [];
      const comp = lista.find((c) => c.name === nombre || c.displayName === nombre) ?? lista[0];
      if (comp?.id) { companyIdCache = comp.id; return comp.id; }
    }
  } catch { /* cae al GUID configurado */ }
  const id = soloGuid(process.env.BC_COMPANY_ID);
  if (!id) throw new Error("No se pudo resolver la compañía de BC");
  companyIdCache = id;
  return id;
}

// El systemId de compañía para la API ESTÁNDAR (v2.0) puede diferir del que
// devuelve la API custom de Adelante. Resolvemos por nombre contra /companies estándar.
let stdCompanyIdCache: string | null = null;
async function getStdCompanyId(): Promise<string> {
  if (stdCompanyIdCache) return stdCompanyIdCache;
  const nombre = process.env.BC_COMPANY || "ADELANTE_DESARROLLOS_NUEVA";
  try {
    const token = await getToken();
    const res = await fetch(`${stdRoot()}/companies`, { cache: "no-store", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      const lista: any[] = data.value ?? [];
      const comp = lista.find((c) => c.name === nombre || c.displayName === nombre) ?? lista[0];
      if (comp?.id) { stdCompanyIdCache = comp.id; return comp.id; }
    }
  } catch { /* cae al id de la API custom */ }
  return getCompanyId();
}

// Lista de compañías visibles para la app (diagnóstico).
export async function bcCompanies(): Promise<{ id: string; name: string }[]> {
  const token = await getToken();
  const res = await fetch(`${customRoot("inventory")}/companies`, { cache: "no-store", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`BC ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.value ?? []).map((c: any) => ({ id: c.id, name: c.name ?? c.displayName }));
}

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const tenant = env("BC_TENANT_ID");
  const body = new URLSearchParams({
    client_id: env("BC_CLIENT_ID"),
    client_secret: env("BC_CLIENT_SECRET"),
    scope: "https://api.businesscentral.dynamics.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!res.ok) throw new Error(`OAuth BC falló (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  tokenCache = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

async function listAll(group: string, entity: string): Promise<any[]> {
  const token = await getToken();
  const cid = await getCompanyId();
  let url: string | null = `${customRoot(group)}/companies(${cid})/${entity}`;
  const out: any[] = [];
  let guard = 0;
  while (url && guard++ < 50) {
    // Datos maestros (items, obras): se cachean 5 min para acelerar la carga
    // (no como health/variants, que van siempre frescos con no-store).
    const res = await fetch(url, { next: { revalidate: 300 }, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`BC ${res.status} en ${url}: ${(await res.text()).slice(0, 250)}`);
    const data: any = await res.json();
    out.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  return out;
}

export type BcItem = { id: string; code: string; descripcion: string; unidad: string };
export type BcObra = { id: string; codigo: string; nombre: string };
export type BcAlmacen = { codigo: string; nombre: string };

export async function bcItems(): Promise<BcItem[]> {
  const rows = await listAll("inventory", "items");
  return rows
    .filter((i) => !(i.Blocked ?? i.blocked))
    .map((i) => {
      const code = i.No ?? i.no ?? i.number ?? "";
      return {
        id: i.id ?? i.systemId ?? code,
        code,
        descripcion: i.Description ?? i.description ?? i.displayName ?? code,
        unidad: i.BaseUnitOfMeasure ?? i.baseUnitOfMeasure ?? i.baseUnitOfMeasureCode ?? "UND",
      };
    });
}

export async function bcObras(): Promise<BcObra[]> {
  const rows = await listAll("project", "jobs");
  return rows.map((j) => ({
    id: j.id ?? j.no ?? "",
    codigo: j.no ?? j.No ?? "",
    nombre: j.description ?? j.Description ?? j.no ?? "",
  }));
}

// No hay API personalizada de almacenes; el almacén ya no se pide al solicitar.
export async function bcAlmacenes(): Promise<BcAlmacen[]> {
  return [];
}

export type BcVendor = { id: string; code: string; nombre: string; currencyCode: string };

// Proveedores (vendors) de BC por la API ESTÁNDAR v2.0 (la app tiene FULL ACCESS).
// Se cachean 5 min como dato maestro. code = number del proveedor (lo que va como vendorNo).
export async function bcVendors(): Promise<BcVendor[]> {
  const token = await getToken();
  const cid = await getStdCompanyId();
  let url: string | null = `${stdRoot()}/companies(${cid})/vendors?$select=id,number,displayName,currencyCode&$top=5000`;
  const out: any[] = [];
  let guard = 0;
  while (url && guard++ < 50) {
    const res = await fetch(url, { next: { revalidate: 300 }, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`BC ${res.status} en vendors: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    out.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  return out
    .filter((v) => !(v.blocked && v.blocked !== "_x0020_" && v.blocked !== " "))
    .map((v) => ({
      id: v.id ?? v.number ?? "",
      code: v.number ?? "",
      nombre: v.displayName ?? v.number ?? "",
      currencyCode: v.currencyCode ?? "",
    }))
    .filter((v) => v.code);
}

// Último precio con que se FACTURÓ un item a un proveedor, leído de las facturas
// de compra registradas en BC (API estándar v2.0). Revisa las facturas más
// recientes del proveedor y devuelve el precio de la línea de ese item.
// Devuelve null si no hay historial o si BC no responde (la UI cae al historial local).
export async function bcUltimoPrecioFacturado(itemNo: string, vendorNo: string): Promise<number | null> {
  if (!itemNo || !vendorNo) return null;
  try {
    const token = await getToken();
    const cid = await getStdCompanyId();
    const filtro = `$filter=${encodeURIComponent(`vendorNumber eq '${vendorNo}'`)}`;
    const url =
      `${stdRoot()}/companies(${cid})/purchaseInvoices?${filtro}` +
      `&$orderby=invoiceDate desc&$top=20` +
      `&$expand=purchaseInvoiceLines($select=lineType,lineObjectNumber,directUnitCost,unitCost)`;
    const res = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!res.ok) return null;
    const data: any = await res.json();
    for (const inv of (data.value ?? [])) {
      for (const l of (inv.purchaseInvoiceLines ?? [])) {
        if ((l.lineObjectNumber ?? "") === itemNo) {
          const precio = (typeof l.directUnitCost === "number" && l.directUnitCost > 0) ? l.directUnitCost
            : (typeof l.unitCost === "number" && l.unitCost > 0) ? l.unitCost : null;
          if (precio != null) return precio;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export type BcVariante = { code: string; descripcion: string };

// Resultado de cargar variantes. `disponible=false` significa que NO se pudo
// consultar el catálogo de variantes (p.ej. la app no tiene permiso sobre la
// tabla Item Variant 5401, o la API no está publicada): en ese caso el form
// NO debe asumir "no tiene variantes", porque el item podría tener variante
// obligatoria y el pedido fallaría en BC.
export type BcVariantsResult = { variantes: BcVariante[]; disponible: boolean };

function mapVariantes(rows: any[]): BcVariante[] {
  return (rows ?? []).map((v: any) => ({
    code: v.code ?? v.Code ?? "",
    descripcion: v.description ?? v.Description ?? v.code ?? "",
  }));
}

// Variantes de un item. Intenta primero la API CUSTOM de Adelante
// (api/adelante/inventory/v1.0/.../itemVariants, page 50128) y, si esa falla,
// cae a la API ESTÁNDAR v2.0 (.../itemVariants). Solo se considera "no tiene
// variantes" cuando alguna de las dos responde OK con lista vacía. Si ambas
// fallan (401/permiso/no publicada), devuelve disponible=false.
export async function bcVariantsEx(itemNo: string): Promise<BcVariantsResult> {
  if (!itemNo) return { variantes: [], disponible: true };
  const token = await getToken();
  const filtro = `$filter=itemNumber eq '${encodeURIComponent(itemNo)}'`;

  // 1) API custom de Adelante.
  try {
    const cid = await getCompanyId();
    const res = await fetch(`${customRoot("inventory")}/companies(${cid})/itemVariants?${filtro}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (res.ok) return { variantes: mapVariantes((await res.json()).value), disponible: true };
  } catch { /* intenta la estándar */ }

  // 2) Fallback: API estándar v2.0.
  try {
    const stdCid = await getStdCompanyId();
    const res = await fetch(`${stdRoot()}/companies(${stdCid})/itemVariants?${filtro}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (res.ok) return { variantes: mapVariantes((await res.json()).value), disponible: true };
  } catch { /* ambas fallaron */ }

  return { variantes: [], disponible: false };
}

// Compatibilidad: versión que solo devuelve la lista (sin el flag).
export async function bcVariants(itemNo: string): Promise<BcVariante[]> {
  return (await bcVariantsEx(itemNo)).variantes;
}

// ---- Escritura: crear Pedido de compra (Purchase Order) por la API ESTÁNDAR ----
export type NuevaLineaBc = { itemNo: string; cantidad: number; precio?: number; descripcion?: string };

export async function bcCrearPedido(input: { vendorNo: string; currencyCode?: string; lineas: NuevaLineaBc[] }): Promise<{ number: string; id: string; omitidas: string[] }> {
  if (!input?.vendorNo) throw new Error("Falta el proveedor (vendorNo).");
  const lineas = (input.lineas ?? []).filter((l) => l.itemNo && l.cantidad > 0);
  if (!lineas.length) throw new Error("No hay líneas de material válidas para el pedido.");
  const token = await getToken();
  const cid = await getCompanyId();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

  // 1) Encabezado: proveedor (+ moneda si no es CRC).
  const headerBody: Record<string, unknown> = { vendorNumber: input.vendorNo };
  const cur = (input.currencyCode ?? "").toUpperCase();
  if (cur && cur !== "CRC") headerBody.currencyCode = cur;
  const resH = await fetch(`${stdRoot()}/companies(${cid})/purchaseOrders`, { method: "POST", headers, body: JSON.stringify(headerBody) });
  if (!resH.ok) throw new Error(`BC ${resH.status} al crear el pedido: ${(await resH.text()).slice(0, 300)}`);
  const po: any = await resH.json();

  // 2) Líneas: una por material (tipo Artículo). Si una línea falla (p.ej. el item
  // no existe en BC — típico con data de prueba), la OMITIMOS y seguimos, en vez de
  // tumbar todo el pedido. Devolvemos las omitidas para avisar.
  const omitidas: string[] = [];
  for (const l of lineas) {
    const lineBody: Record<string, unknown> = { lineType: "Item", lineObjectNumber: l.itemNo, quantity: l.cantidad };
    if (l.precio && l.precio > 0) lineBody.directUnitCost = l.precio;
    // Almacén de recepción fijo (p.ej. ALM-GRAL): aunque Ingeniería pida para una
    // obra, el material entra siempre al almacén general. Configurable por env.
    const loc = process.env.BC_RECEPCION_LOCATION;
    if (loc) lineBody.locationCode = loc;
    const resL = await fetch(`${stdRoot()}/companies(${cid})/purchaseOrders(${po.id})/purchaseOrderLines`, { method: "POST", headers, body: JSON.stringify(lineBody) });
    if (!resL.ok) omitidas.push(l.itemNo);
  }
  return { number: po.number ?? "", id: po.id ?? "", omitidas };
}

// Raíz OData V4 (para los web services de codeunit custom, p.ej. AdelantePO).
function odataRoot(): string {
  const { tenant, environment } = tenantYEntorno();
  return `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${environment}/ODataV4`;
}

// Lanza (Release) un Pedido de compra en BC -> estado "Lanzado".
// La API estándar v2.0 NO puede liberar un pedido; se hace por el web service
// del codeunit custom "Adelante PO Actions" (publicado como "AdelantePO").
// Procedimiento esperado: AdelantePO_ReleaseOrder(orderNo) -> Text (status).
export async function bcReleasePedido(orderNo: string): Promise<string> {
  if (!orderNo) throw new Error("Falta el número de pedido para lanzar.");
  const token = await getToken();
  const cid = await getStdCompanyId();
  const url = `${odataRoot()}/AdelantePO_ReleaseOrder?company=${encodeURIComponent(cid)}`;
  const res = await fetch(url, {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ orderNo }),
  });
  if (!res.ok) throw new Error(`BC release ${res.status}: ${(await res.text()).slice(0, 250)}`);
  const d: any = await res.json().catch(() => ({}));
  return d?.value ?? "Released";
}

// Crea el Pedido en BC (queda Abierto) y lo LANZA enseguida -> "Lanzado".
// Si el create funciona pero el release falla (p.ej. AdelantePO no publicado aún),
// devuelve el pedido creado con released=false para que la UI avise sin romperse.
export async function bcCrearYLanzarPedido(input: { vendorNo: string; currencyCode?: string; lineas: NuevaLineaBc[] }):
  Promise<{ number: string; id: string; omitidas: string[]; released: boolean; releaseError?: string }> {
  const { number, id, omitidas } = await bcCrearPedido(input);
  try {
    await bcReleasePedido(number);
    return { number, id, omitidas, released: true };
  } catch (e: any) {
    return { number, id, omitidas, released: false, releaseError: String(e?.message ?? e) };
  }
}

// Deep link al Pedido recién creado, en la lista de Pedidos de compra de BC.
export function bcDeepLinkPedido(numero: string): string {
  const { tenant, environment } = tenantYEntorno();
  const company = process.env.BC_COMPANY || "ADELANTE_DESARROLLOS_NUEVA";
  const filtro = encodeURIComponent(`'No.' IS '${numero}'`);
  return `https://businesscentral.dynamics.com/${tenant}/${environment}?company=${encodeURIComponent(company)}&page=9307&filter=${filtro}`;
}

function decodeJwt(token: string): any {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(pad, "base64").toString("utf8"));
  } catch { return null; }
}

export async function bcHealth() {
  const out: any = { configCompanyId: soloGuid(process.env.BC_COMPANY_ID) };
  // --- DIAGNÓSTICO: qué credenciales ve el worker en runtime ---
  out.diag = {
    envClientId: process.env.BC_CLIENT_ID ?? null,
    envTenant: process.env.BC_TENANT_ID ?? null,
    envSecretLen: (process.env.BC_CLIENT_SECRET ?? "").length,
    envBaseUrl: process.env.BC_BASE_URL ?? null,
    authority: `https://login.microsoftonline.com/${process.env.BC_TENANT_ID}/oauth2/v2.0/token`,
  };
  try {
    const tok = await getToken();
    const p = decodeJwt(tok) ?? {};
    out.diag.token = { appid: p.appid, tid: p.tid, aud: p.aud, ver: p.ver, iss: p.iss, roles: p.roles, app_displayname: p.app_displayname, idtyp: p.idtyp };
    // Probes discriminantes con el MISMO token, contra /companies de cada API.
    // - standard  : si 401 => BC no reconoce la app en el entorno (registro/consent/entorno).
    // - automation: confirma reconocimiento de la app a nivel automation.
    // - custom    : si standard OK pero este 401 => permiso del API 'adelante' o extensión no publicada.
    const t = process.env.BC_TENANT_ID;
    const envName = (process.env.BC_ENVIRONMENT ?? "Sandbox");
    const base = `https://api.businesscentral.dynamics.com/v2.0/${t}/${envName}`;
    const probe = async (label: string, url: string) => {
      try {
        const r = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" } });
        let bodyMsg: string | null = null;
        if (!r.ok) { try { bodyMsg = (await r.text()).slice(0, 200); } catch { /* noop */ } }
        return {
          label, status: r.status, ok: r.ok,
          wwwAuthenticate: r.headers.get("www-authenticate"),
          msDiagnostics: r.headers.get("ms-diagnostics"),
          requestId: r.headers.get("request-id") ?? r.headers.get("x-ms-request-id"),
          body: bodyMsg,
        };
      } catch (e: any) { return { label, error: String(e?.message ?? e) }; }
    };
    const cidGuid = soloGuid(process.env.BC_COMPANY_ID);
    // Compañías que ve la API ESTÁNDAR (su systemId puede diferir del de la custom).
    try {
      const rc = await fetch(`${base}/api/v2.0/companies`, { cache: "no-store", headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" } });
      if (rc.ok) out.diag.stdCompanies = ((await rc.json()).value ?? []).map((c: any) => ({ id: c.id, name: c.name }));
    } catch { /* noop */ }
    const stdCid = out.diag.stdCompanies?.[0]?.id ?? cidGuid;
    out.diag.probes = await Promise.all([
      probe("standard", `${base}/api/v2.0/companies`),
      probe("automation", `${base}/api/microsoft/automation/v2.0/companies`),
      probe("custom-adelante", `${base}/api/adelante/inventory/v1.0/companies`),
      probe("custom-itemVariants", `${base}/api/adelante/inventory/v1.0/companies(${cidGuid})/itemVariants?$top=1`),
      probe("std-itemVariants(stdCid)", `${base}/api/v2.0/companies(${stdCid})/itemVariants?$top=1`),
    ]);
  } catch (e: any) { out.diag.tokenError = String(e?.message ?? e); }
  try {
    out.diag.outboundIp = (await (await fetch("https://api.ipify.org")).text()).trim();
  } catch (e: any) { out.diag.ipError = String(e?.message ?? e); }
  try { out.companies = await bcCompanies(); } catch (e: any) { out.companiesError = String(e?.message ?? e); }
  try { out.companyIdUsado = await getCompanyId(); } catch (e: any) { out.companyError = String(e?.message ?? e); }
  try { out.items = (await bcItems()).length; out.ok = true; } catch (e: any) { out.itemsError = String(e?.message ?? e); out.ok = false; }
  try { out.obras = (await bcObras()).length; } catch (e: any) { out.obrasError = String(e?.message ?? e); }
  return out;
}
