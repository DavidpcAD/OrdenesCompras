// Cliente de Business Central (SaaS, API v2.0) por OAuth client-credentials (S2S).
// Variables de entorno (Azure App Settings):
//   BC_TENANT_ID, BC_CLIENT_ID, BC_CLIENT_SECRET
//   BC_ENVIRONMENT   (ej. "Sandbox")
//   BC_COMPANY       (nombre de la compañía, ej. "ADELANTE_DESARROLLOS_NUEVA")
//   BC_COMPANY_ID    (opcional; GUID de la compañía)
//   BC_BASE_URL      (opcional; se usa para deducir tenant/environment)
//
// Usamos la API ESTÁNDAR /api/v2.0 (items, locations, projects), que siempre
// está publicada en BC SaaS, y resolvemos la compañía por nombre para no
// depender de un id que pueda venir mal configurado.

type TokenCache = { token: string; exp: number };
let tokenCache: TokenCache | null = null;
let companyIdCache: string | null = null;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

function soloGuid(v?: string): string | null {
  const m = (v ?? "").match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return m ? m[0] : null;
}

// Deduce tenant y environment desde BC_BASE_URL (.../v2.0/{tenant}/{env}/api/...)
// o, si no, desde BC_TENANT_ID / BC_ENVIRONMENT.
function tenantYEntorno(): { tenant: string; environment: string } {
  const base = process.env.BC_BASE_URL ?? "";
  const m = base.match(/\/v2\.0\/([^/]+)\/([^/]+)\/api\b/i);
  if (m) return { tenant: m[1], environment: m[2] };
  return { tenant: env("BC_TENANT_ID"), environment: process.env.BC_ENVIRONMENT ?? "Production" };
}

// Raíz de la API estándar v2.0.
function stdRoot(): string {
  const { tenant, environment } = tenantYEntorno();
  return `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${environment}/api/v2.0`;
}

// Raíz de la API a usar: la personalizada (BC_BASE_URL, p.ej. .../api/adelante/v2.0)
// si está configurada; si no, la estándar.
function apiRoot(): string {
  return process.env.BC_BASE_URL ? process.env.BC_BASE_URL.replace(/\/$/, "") : stdRoot();
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
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`OAuth BC falló (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  tokenCache = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

async function bcFetch(url: string): Promise<any> {
  const token = await getToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`BC ${res.status} en ${url}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function bcCompanies(): Promise<{ id: string; name: string; displayName: string }[]> {
  const data = await bcFetch(`${stdRoot()}/companies?$select=id,name,displayName`);
  return (data.value ?? []).map((c: any) => ({ id: c.id, name: c.name, displayName: c.displayName }));
}

async function getCompanyId(): Promise<string> {
  if (companyIdCache) return companyIdCache;
  // Preferimos el GUID configurado (limpio). La API personalizada no
  // necesariamente expone /companies, así que no dependemos de eso.
  const idCfg = soloGuid(process.env.BC_COMPANY_ID);
  if (idCfg) { companyIdCache = idCfg; return idCfg; }
  const comps = await bcCompanies();
  const nombre = process.env.BC_COMPANY;
  const comp = (nombre && comps.find((c) => c.name === nombre || c.displayName === nombre)) || comps[0];
  if (!comp) throw new Error("No se pudo resolver la compañía de BC");
  companyIdCache = comp.id;
  return comp.id;
}

async function listAll(entity: string): Promise<any[]> {
  const cid = await getCompanyId();
  let url: string | null = `${apiRoot()}/companies(${cid})/${entity}`;
  const out: any[] = [];
  let guard = 0;
  while (url && guard++ < 50) {
    const data: any = await bcFetch(url);
    out.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  return out;
}

export type BcItem = { id: string; code: string; descripcion: string; unidad: string };
export type BcObra = { id: string; codigo: string; nombre: string };
export type BcAlmacen = { codigo: string; nombre: string };

export async function bcItems(): Promise<BcItem[]> {
  const rows = await listAll("items");
  return rows.map((i) => ({
    id: i.id ?? i.number ?? "",
    code: i.number ?? "",
    descripcion: i.displayName ?? i.displayName2 ?? i.number ?? "",
    unidad: i.baseUnitOfMeasureCode ?? i.baseUnitOfMeasure ?? "UND",
  }));
}

export async function bcAlmacenes(): Promise<BcAlmacen[]> {
  const rows = await listAll("locations");
  return rows.map((l) => ({ codigo: l.code ?? "", nombre: l.displayName ?? l.name ?? l.code ?? "" }));
}

export async function bcObras(): Promise<BcObra[]> {
  const rows = await listAll("projects");
  return rows.map((p) => ({ id: p.id ?? "", codigo: p.number ?? p.code ?? "", nombre: p.displayName ?? p.name ?? p.number ?? "" }));
}

// Diagnóstico: lista compañías, intenta items, y reporta cada error por separado.
export async function bcHealth() {
  const out: any = { apiRoot: apiRoot(), companyId: soloGuid(process.env.BC_COMPANY_ID) };
  try { out.companies = await bcCompanies(); } catch (e: any) { out.companiesError = String(e?.message ?? e); }
  try { out.companyIdUsado = await getCompanyId(); } catch (e: any) { out.companyError = String(e?.message ?? e); }
  try { out.items = (await bcItems()).length; out.ok = true; } catch (e: any) { out.itemsError = String(e?.message ?? e); out.ok = false; }
  return out;
}
