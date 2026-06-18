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

function companyId(): string {
  const id = soloGuid(process.env.BC_COMPANY_ID);
  if (!id) throw new Error("BC_COMPANY_ID no es un GUID válido");
  return id;
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
  let url: string | null = `${customRoot(group)}/companies(${companyId()})/${entity}`;
  const out: any[] = [];
  let guard = 0;
  while (url && guard++ < 50) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
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

export type BcVariante = { code: string; descripcion: string };

// Variantes de un item, por la API ESTÁNDAR (requiere acceso completo, como digitación).
export async function bcVariants(itemNo: string): Promise<BcVariante[]> {
  if (!itemNo) return [];
  const token = await getToken();
  const url = `${stdRoot()}/companies(${companyId()})/itemVariants?$filter=itemNumber eq '${encodeURIComponent(itemNo)}'`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`BC ${res.status} en ${url}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.value ?? []).map((v: any) => ({ code: v.code ?? "", descripcion: v.description ?? v.code ?? "" }));
}

export async function bcHealth() {
  const out: any = { itemsRoot: customRoot("inventory"), obrasRoot: customRoot("project"), companyId: soloGuid(process.env.BC_COMPANY_ID) };
  try { out.items = (await bcItems()).length; out.ok = true; } catch (e: any) { out.itemsError = String(e?.message ?? e); out.ok = false; }
  try { out.obras = (await bcObras()).length; } catch (e: any) { out.obrasError = String(e?.message ?? e); }
  return out;
}
