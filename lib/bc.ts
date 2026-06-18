// Cliente de Business Central (SaaS, API v2.0) por OAuth client-credentials (S2S).
// Variables de entorno necesarias (Azure App Settings):
//   BC_TENANT_ID, BC_CLIENT_ID, BC_CLIENT_SECRET
//   BC_ENVIRONMENT   (ej. "Sandbox" o "Production")
//   BC_COMPANY_ID    (GUID de la compañía)  -- opcional si se usa BC_COMPANY
//   BC_COMPANY       (nombre de la compañía) -- opcional, se resuelve a id
//   BC_BASE_URL      (opcional; si no, se construye con tenant + environment)
//
// IMPORTANTE: además del registro en Azure AD, el App Registration debe estar
// dado de alta DENTRO de Business Central (Microsoft Entra Applications) con un
// permission set que permita leer Items / Locations / Projects. Sin eso, BC
// responde 401 aunque el token de Azure AD sea válido.

type TokenCache = { token: string; exp: number };
let tokenCache: TokenCache | null = null;
let companyIdCache: string | null = null;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
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
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OAuth BC falló (${res.status}): ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  tokenCache = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

function apiRoot(): string {
  if (process.env.BC_BASE_URL) return process.env.BC_BASE_URL.replace(/\/$/, "");
  const tenant = env("BC_TENANT_ID");
  const environment = env("BC_ENVIRONMENT");
  return `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${environment}/api/v2.0`;
}

async function bcFetch(path: string): Promise<any> {
  const token = await getToken();
  const url = path.startsWith("http") ? path : `${apiRoot()}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`BC ${res.status} en ${path}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

async function getCompanyId(): Promise<string> {
  if (companyIdCache) return companyIdCache;
  if (process.env.BC_COMPANY_ID) { companyIdCache = process.env.BC_COMPANY_ID; return companyIdCache; }
  const data = await bcFetch(`/companies`);
  const nombre = process.env.BC_COMPANY;
  const lista: any[] = data.value ?? [];
  const comp = nombre ? lista.find((c) => c.name === nombre || c.displayName === nombre) : lista[0];
  if (!comp) throw new Error(`No se encontró la compañía${nombre ? ` "${nombre}"` : ""} en BC`);
  companyIdCache = comp.id;
  return comp.id;
}

// Trae todas las páginas de un entitySet de la compañía.
async function listAll(entity: string, select?: string): Promise<any[]> {
  const cid = await getCompanyId();
  let url: string | null = `${apiRoot()}/companies(${cid})/${entity}${select ? `?$select=${select}` : ""}`;
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
  // En la API estándar las obras son "projects" (jobs). Si usan un objeto custom
  // (p.ej. GomJob de la localización CR), hay que publicar una API page y cambiar
  // este entitySet por el de esa API.
  const rows = await listAll("projects");
  return rows.map((p) => ({
    id: p.id ?? p.number ?? "",
    codigo: p.number ?? p.code ?? "",
    nombre: p.displayName ?? p.name ?? p.number ?? "",
  }));
}

export async function bcHealth() {
  const cid = await getCompanyId();
  const items = await bcItems();
  return { ok: true, companyId: cid, items: items.length };
}
