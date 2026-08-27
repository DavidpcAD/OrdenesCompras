// Cliente de Business Central (SaaS) por OAuth client-credentials (S2S),
// usando las APIs PERSONALIZADAS de Adelante (publisher 'adelante', v1.0):
//   - Items:  grupo 'inventory'  -> entitySet 'items'   (page 50125 ItemAPI)
//   - Obras:  grupo 'project'     -> entitySet 'jobs'    (page 50170 JobAPI)
// La compañía sale de BC_COMPANY_ID (GUID). El tenant/environment se deducen
// de BC_BASE_URL (o de BC_TENANT_ID/BC_ENVIRONMENT).

import type { OrdenLinea } from "./types";

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

// Tenant y entorno de BC. Salen de BC_BASE_URL (que los trae en la ruta) o, si esa
// no los tiene, de BC_TENANT_ID + BC_ENVIRONMENT.
//
// NO se asume ningún entorno: si no viene por ningún lado, FALLA. Antes caía a
// "Sandbox", y eso significaba que borrar o escribir mal una variable mandaba toda la
// app al entorno de PRUEBAS sin un solo error: los pedidos que Aprobación lanzaba en
// Production simplemente no aparecían, y nada explicaba por qué.
export function resolverEntornoBc(cfg: { baseUrl?: string; tenantId?: string; environment?: string }): { tenant: string; environment: string } {
  // Acepta ".../v2.0/{tenant}/{entorno}/api/..." y ".../v2.0/{tenant}/{entorno}".
  const m = (cfg.baseUrl ?? "").trim().match(/\/v2\.0\/([^/\s]+)\/([^/?#\s]+)/);
  if (m) return { tenant: m[1], environment: m[2] };
  const tenant = (cfg.tenantId ?? "").trim();
  const environment = (cfg.environment ?? "").trim();
  if (!tenant) throw new Error("Falta la variable de entorno BC_TENANT_ID");
  if (!environment) {
    throw new Error(
      "Falta el entorno de Business Central: definí BC_ENVIRONMENT (p.ej. Production) o " +
      "incluílo en BC_BASE_URL (.../v2.0/<tenant>/<entorno>). No se asume ninguno a propósito: " +
      "asumir 'Sandbox' hacía que la app trabajara contra el entorno de pruebas sin avisar."
    );
  }
  return { tenant, environment };
}

function tenantYEntorno(): { tenant: string; environment: string } {
  return resolverEntornoBc({
    baseUrl: process.env.BC_BASE_URL,
    tenantId: process.env.BC_TENANT_ID,
    environment: process.env.BC_ENVIRONMENT,
  });
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
    const res = await bcFetch(`${customRoot("inventory")}/companies`, { cache: "no-store" });
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
    const res = await bcFetch(`${stdRoot()}/companies`, { cache: "no-store" });
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
  const res = await bcFetch(`${customRoot("inventory")}/companies`, { cache: "no-store" });
  if (!res.ok) throw new Error(`BC ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.value ?? []).map((c: any) => ({ id: c.id, name: c.name ?? c.displayName }));
}

async function getToken(force = false): Promise<string> {
  if (!force && tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
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

// fetch contra BC con reintento ante 401: el Sandbox a veces resetea el binding
// S2S y el token cacheado deja de ser aceptado. En ese caso pedimos un token
// FRESCO y reintentamos una vez. Logueamos ms-diagnostics para ver el motivo real.
async function bcFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const baseHeaders = { ...(init.headers as Record<string, string> | undefined), Accept: "application/json" };
  const run = (token: string) => fetch(url, { ...init, headers: { ...baseHeaders, Authorization: `Bearer ${token}` } });
  let res = await run(await getToken());
  if (res.status === 401) {
    console.warn(`BC 401 en ${url} — reintento con token fresco. ms-diagnostics=${res.headers.get("ms-diagnostics") ?? "n/a"}`);
    res = await run(await getToken(true)); // fuerza token nuevo (binding pudo resetearse)
    if (res.status === 401) console.error(`BC 401 persiste tras token fresco en ${url}. ms-diagnostics=${res.headers.get("ms-diagnostics") ?? "n/a"}`);
  }
  return res;
}

async function listAll(group: string, entity: string): Promise<any[]> {
  const cid = await getCompanyId();
  let url: string | null = `${customRoot(group)}/companies(${cid})/${entity}`;
  const out: any[] = [];
  let guard = 0;
  while (url && guard++ < 50) {
    // Datos maestros (items, obras): se cachean 5 min para acelerar la carga.
    const res = await bcFetch(url, { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) throw new Error(`BC ${res.status} en ${url}: ${(await res.text()).slice(0, 250)}`);
    const data: any = await res.json();
    out.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  return out;
}

export type BcItem = { id: string; code: string; descripcion: string; unidad: string; unidadCompra?: string;
  lastDirectCost?: number; categoria?: string; reorderPoint?: number; safetyStock?: number; reorderQty?: number };
export type BcObra = { id: string; codigo: string; nombre: string };
export type BcAlmacen = { codigo: string; nombre: string };

// Una fila de `items` de la API custom -> BcItem. Compartido por el catálogo
// completo (bcItems) y por la carga por páginas (bcItemsPagina).
function mapearItem(i: any): BcItem {
  const code = i.No ?? i.no ?? i.number ?? "";
  const costCustom = Number(i.LastDirectCost ?? i.lastDirectCost ?? i.UnitCost ?? i.unitCost ?? 0) || undefined;
  const catCustom = (i.ItemCategoryCode ?? i.itemCategoryCode ?? "").toString().trim() || undefined;
  return {
    id: i.id ?? i.systemId ?? code,
    code,
    descripcion: i.Description ?? i.description ?? i.displayName ?? code,
    unidad: i.BaseUnitOfMeasure ?? i.baseUnitOfMeasure ?? i.baseUnitOfMeasureCode ?? "UND",
    // La unidad con la que se COMPRA, que no siempre es la base. El adhesivo
    // M06-0009 se consume en gramos (base GR) pero al proveedor se le pide por
    // ESTAÑON, y BC arma la línea del pedido con ESA unidad. Si la extensión AL
    // todavía no expone el campo, queda undefined y el llamador usa la base.
    unidadCompra: (i.PurchUnitOfMeasure ?? i.purchUnitOfMeasure ?? "").toString().trim() || undefined,
    lastDirectCost: costCustom,
    categoria: catCustom,
    reorderPoint: Number(i.reorderPoint ?? i.ReorderPoint ?? 0) || undefined,
    safetyStock: Number(i.safetyStockQuantity ?? i.SafetyStockQuantity ?? 0) || undefined,
    reorderQty: Number(i.reorderQuantity ?? i.ReorderQuantity ?? 0) || undefined,
  };
}

// UNA página del catálogo, para que Inventarios pinte las primeras filas sin
// esperar los 5000+ artículos. Va directo a la API custom con $top/$skip y SIN el
// enriquecido de la API estándar (costo/categoría), que es la parte cara: para la
// primera pintada alcanza código, descripción y unidad. `hayMas` dice si seguir.
export async function bcItemsPagina(top: number, skip: number): Promise<{ items: BcItem[]; hayMas: boolean }> {
  const cid = await getCompanyId();
  const url = `${customRoot("inventory")}/companies(${cid})/items?$orderby=no&$top=${top}&$skip=${skip}`;
  const res = await bcFetch(url, { next: { revalidate: 300 } } as RequestInit);
  if (!res.ok) throw new Error(`BC ${res.status} en items?$top=${top}&$skip=${skip}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  const rows: any[] = data.value ?? [];
  return {
    items: rows.filter((i) => !(i.Blocked ?? i.blocked)).map(mapearItem),
    // Los bloqueados se filtran DESPUÉS, así que para saber si quedan más hay que
    // mirar cuántas filas trajo BC, no cuántas quedaron.
    hayMas: !!data["@odata.nextLink"] || rows.length >= top,
  };
}

let lastGoodItems: BcItem[] | null = null;
export async function bcItems(): Promise<BcItem[]> {
  try {
    const rows = await listAll("inventory", "items");
    let items: BcItem[] = rows.filter((i) => !(i.Blocked ?? i.blocked)).map(mapearItem);
    // Enriquecer con ÚLTIMO COSTO DIRECTO (precio de la última compra) y CATEGORÍA
    // del ítem (= partida en Planificación) desde la API estándar v2.0.
    const extra = await bcItemExtra();
    if (extra.size) items = items.map((i) => { const e = extra.get(i.code); return { ...i, lastDirectCost: e?.cost ?? i.lastDirectCost, categoria: e?.categoria ?? i.categoria }; });
    if (items.length) lastGoodItems = items; // guardamos el último catálogo bueno
    return items;
  } catch (e) {
    if (lastGoodItems) { console.warn("BC items falló; sirviendo último catálogo bueno cacheado."); return lastGoodItems; }
    throw e;
  }
}

// Mapa itemNo -> { último costo directo, categoría } desde la API estándar v2.0.
// Cacheado 5 min. Si falla, la UI cae al historial local / sin categoría.
async function bcItemExtra(): Promise<Map<string, { cost?: number; categoria?: string }>> {
  const map = new Map<string, { cost?: number; categoria?: string }>();
  try {
    const cid = await getStdCompanyId();
    let url: string | null = `${stdRoot()}/companies(${cid})/items?$select=number,lastDirectCost,unitCost,itemCategoryCode&$top=5000`;
    let guard = 0;
    while (url && guard++ < 20) {
      const res = await bcFetch(url, { next: { revalidate: 300 } } as RequestInit);
      if (!res.ok) break;
      const data: any = await res.json();
      for (const it of (data.value ?? [])) {
        const no = it.number ?? it.no ?? "";
        if (!no) continue;
        const cost = (typeof it.lastDirectCost === "number" && it.lastDirectCost > 0) ? it.lastDirectCost
          : (typeof it.unitCost === "number" && it.unitCost > 0) ? it.unitCost : undefined;
        const categoria = (it.itemCategoryCode ?? "").toString().trim() || undefined;
        map.set(no, { cost, categoria });
      }
      url = data["@odata.nextLink"] ?? null;
    }
  } catch { /* sin datos extra */ }
  return map;
}

// Precio de la ÚLTIMA COMPRA por artículo, en una sola pasada. La API estándar no
// sirve para esto: `unitCost`/`lastDirectCost` vienen en 0 para todo el catálogo (y
// ni se pueden filtrar), así que la columna "Precio ref." de Inventarios salía
// ₡0,00 en las 5000 filas. El endpoint custom `lastPurchasePrices` sí trae el costo
// real de cada recepción: ordenado por fecha desc, la PRIMERA aparición de cada
// item es su última compra. Cache 5 min como el resto de maestros.
export async function bcUltimosCostos(): Promise<Record<string, number>> {
  const rows = await listCustom("purchasing", "lastPurchasePrices?$orderby=postingDate desc,entryNo desc&$top=5000",
    { next: { revalidate: 300 } } as RequestInit);
  const out: Record<string, number> = {};
  for (const r of rows) {
    const item = r.itemNo ?? r.ItemNo ?? "";
    const costo = Number(r.unitCost ?? r.UnitCost ?? 0) || 0;
    if (!item || costo <= 0 || out[item] !== undefined) continue;   // ya está la más reciente
    out[item] = costo;
  }
  return out;
}

// Último costo directo de UN item (precio de su última compra), API estándar v2.0.
// Fallback cuando no hay precio facturado a un proveedor específico.
export async function bcItemLastCost(itemNo: string): Promise<number | null> {
  if (!itemNo) return null;
  try {
    const cid = await getStdCompanyId();
    const url = `${stdRoot()}/companies(${cid})/items?$filter=${encodeURIComponent(`number eq '${itemNo}'`)}&$select=number,lastDirectCost,unitCost&$top=1`;
    const res = await bcFetch(url, { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) return null;
    const it = ((await res.json())?.value ?? [])[0];
    if (!it) return null;
    return (typeof it.lastDirectCost === "number" && it.lastDirectCost > 0) ? it.lastDirectCost
      : (typeof it.unitCost === "number" && it.unitCost > 0) ? it.unitCost : null;
  } catch { return null; }
}

// Último COSTO DE COMPRA real del material, vía la API custom Adelante
// (page 50235 lastPurchasePrices sobre Item Ledger Entry, solo recepciones de
// compra). Trae el movimiento más reciente (postingDate desc, entryNo desc) y
// devuelve su unitCost. Es lo más fiel al "último precio pagado" por ese ítem.
export async function bcItemUltimaCompra(itemNo: string): Promise<number | null> {
  if (!itemNo) return null;
  try {
    const cid = await getCompanyId();
    const filtro = `$filter=${encodeURIComponent(`itemNo eq '${itemNo}'`)}`;
    const url = `${customRoot("purchasing")}/companies(${cid})/lastPurchasePrices?${filtro}&$orderby=postingDate desc,entryNo desc&$top=1`;
    const res = await bcFetch(url, { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) return null;
    const row = ((await res.json())?.value ?? [])[0];
    const uc = row?.unitCost;
    return (typeof uc === "number" && uc > 0) ? uc : null;
  } catch { return null; }
}

// Unidad BASE y unidad de COMPRA de cada material, en un mapa cacheado 5 min.
// Es lo que permite que la orden y el documento del proveedor salgan en la misma
// unidad que BC (ESTAÑON) en vez de en la unidad de inventario (GR).
//
// Dos fuentes, en este orden:
//   1) el catálogo (page 50125, campo PurchUnitOfMeasure): es la que BC usa de
//      verdad al armar la línea del pedido de compra.
//   2) si la extensión AL todavía no expone ese campo, la unidad de la ÚLTIMA
//      COMPRA registrada — `lastPurchasePrices` ya trae `unitOfMeasureCode`. Si el
//      material se viene comprando en estañones, se pide en estañones.
// El FACTOR (255.000 GR por estañón) se pide solo para los materiales donde las
// dos unidades difieren: hoy son 7 en todo el catálogo, no vale traer 5.500.
let cacheUnidades: { at: number; mapa: Record<string, UnidadCompraItem> } | null = null;
const TTL_UNIDADES = 5 * 60 * 1000;

export type UnidadCompraItem = { base: string; compra: string; factor?: number };

export async function bcUnidadesDeCompra(): Promise<Record<string, UnidadCompraItem>> {
  if (cacheUnidades && Date.now() - cacheUnidades.at < TTL_UNIDADES) return cacheUnidades.mapa;
  const mapa: Record<string, UnidadCompraItem> = {};
  try {
    const items = await bcItems();
    const ultimas = await unidadUltimaCompraPorItem();
    for (const it of items) {
      const base = (it.unidad ?? "").trim().toUpperCase();
      const compra = (it.unidadCompra ?? "").trim().toUpperCase() || ultimas[it.code] || base;
      if (base || compra) mapa[it.code] = { base, compra: compra || base };
    }
    const distintos = Object.keys(mapa).filter((c) => mapa[c].compra && mapa[c].compra !== mapa[c].base);
    for (const lote of trozos(distintos, 20)) {
      const filtro = lote.map((c) => `itemNo eq '${c.replace(/'/g, "''")}'`).join(" or ");
      let rows: any[] = [];
      try {
        rows = await listCustom("inventory", `itemUnitsOfMeasure?$filter=${encodeURIComponent(filtro)}`,
          { next: { revalidate: 300 } } as RequestInit);
      } catch { rows = []; }   // página sin publicar: se queda sin factor
      for (const r of rows) {
        const item = (r.itemNo ?? "").toString();
        const code = (r.code ?? "").toString().trim().toUpperCase();
        const f = Number(r.qtyPerUnitOfMeasure ?? 0) || 0;
        if (mapa[item] && code === mapa[item].compra && f > 0) mapa[item].factor = f;
      }
    }
    cacheUnidades = { at: Date.now(), mapa };
    return mapa;
  } catch {
    // Sin BC se devuelve lo último bueno, o vacío: el llamador respeta la unidad
    // que ya tenía guardada la línea.
    return cacheUnidades?.mapa ?? {};
  }
}

function trozos<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// Unidad con la que se compró cada material la última vez. Misma URL que
// `bcUltimosCostos`, así que comparten el cache de fetch de Next.
async function unidadUltimaCompraPorItem(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const rows = await listCustom("purchasing", "lastPurchasePrices?$orderby=postingDate desc,entryNo desc&$top=5000",
      { next: { revalidate: 300 } } as RequestInit);
    for (const r of rows) {
      const item = (r.itemNo ?? r.ItemNo ?? "").toString();
      const u = (r.unitOfMeasureCode ?? r.UnitOfMeasureCode ?? "").toString().trim().toUpperCase();
      if (item && u && out[item] === undefined) out[item] = u;   // la más reciente
    }
  } catch { /* sin historial */ }
  return out;
}

export type BcUnidadItem = { code: string; factor: number };

// Unidades de medida de UN material con su FACTOR a la unidad base: para M06-0009,
// GR con factor 1 y EST con factor 255.000 (un estañón trae 255.000 gramos). Es el
// dato que permite pasar un costo por gramo a precio por estañón.
// Page 50244 (grupo inventory). Defensiva: si la extensión AL todavía no está
// publicada devuelve [] — sin factor no se convierte nada, nunca se inventa uno.
export async function bcUnidadesDeItem(itemNo: string): Promise<BcUnidadItem[]> {
  if (!itemNo) return [];
  try {
    const filtro = `$filter=${encodeURIComponent(`itemNo eq '${itemNo}'`)}`;
    const rows = await listCustom("inventory", `itemUnitsOfMeasure?${filtro}`,
      { next: { revalidate: 300 } } as RequestInit);
    return rows
      .map((r) => ({
        code: (r.code ?? r.Code ?? "").toString().trim(),
        factor: Number(r.qtyPerUnitOfMeasure ?? r.QtyPerUnitOfMeasure ?? 0) || 0,
      }))
      .filter((u) => u.code && u.factor > 0);
  } catch { return []; }
}

export type BcUltimaCompra = {
  precio: number;      // por `unidad`, en `moneda` (NO por unidad base)
  unidad: string;      // la unidad con que se compró: EST
  factor: number;      // unidades base que trae esa unidad: 255000
  moneda: string;      // "" = colones (moneda local)
  documento: string;
  fecha: string;
};

// Última compra del material TAL COMO QUEDÓ EN EL DOCUMENTO: precio por la unidad
// con la que se compró y en la moneda del documento.
//
// Es distinto de `bcItemUltimaCompra`, que devuelve el costo por unidad BASE en
// colones (sirve para valorar inventario). Para cotizarle a un proveedor hay que
// usar esto: pegarle a una línea en estañones un costo por gramo la deja 255.000
// veces más barata.
//
// Defensiva: si la página 50239 no expone todavía la unidad (extensión AL sin
// publicar) devuelve null y el llamador se queda con el camino viejo.
export async function bcUltimaCompraDocumento(itemNo: string): Promise<BcUltimaCompra | null> {
  if (!itemNo) return null;
  try {
    const filtro = `$filter=${encodeURIComponent(`no eq '${itemNo}'`)}`;
    const rows = await listCustom("purchasing",
      `postedReceiptLines?${filtro}&$orderby=postingDate desc,documentNo desc&$top=1`,
      { next: { revalidate: 300 } } as RequestInit);
    const r = rows[0];
    if (!r) return null;
    const unidad = (r.unitOfMeasureCode ?? "").toString().trim();
    const precio = Number(r.directUnitCost ?? 0) || 0;
    if (!unidad || precio <= 0) return null;   // sin unidad no se sabe a qué corresponde el precio
    return {
      precio,
      unidad,
      factor: Number(r.qtyPerUnitOfMeasure ?? 0) || 1,
      moneda: (r.currencyCode ?? "").toString().trim(),
      documento: (r.documentNo ?? "").toString(),
      fecha: (r.postingDate ?? "").toString(),
    };
  } catch { return null; }
}

// Descripción de cada unidad de medida de BC: EST -> "ESTAÑON", GR -> "Gramos".
// El documento que ve el proveedor lleva la descripción, no el código, igual que
// el reporte de BC. API estándar v2.0, cache 5 min como el resto de maestros.
export async function bcDescripcionUnidades(): Promise<Record<string, string>> {
  try {
    const cid = await getStdCompanyId();
    const url = `${stdRoot()}/companies(${cid})/unitsOfMeasure?$select=code,displayName&$top=500`;
    const res = await bcFetch(url, { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) return {};
    const out: Record<string, string> = {};
    for (const u of ((await res.json())?.value ?? [])) {
      const code = (u.code ?? "").toString().trim();
      const desc = (u.displayName ?? "").toString().trim();
      if (code && desc) out[code] = desc;
    }
    return out;
  } catch { return {}; }
}

export async function bcObras(): Promise<BcObra[]> {
  const rows = await listAll("project", "jobs");
  return rows.map((j) => ({
    id: j.id ?? j.no ?? "",
    codigo: j.no ?? j.No ?? "",
    nombre: j.description ?? j.Description ?? j.no ?? "",
  }));
}

// Corre `p`, pero se rinde a los `ms`. El catálogo de obras se lee ANTES de guardar
// la orden, y bcFetch no lleva timeout: si el tenant de BC deja de contestar (sin
// error, colgado), sin esto el guardado se quedaría esperando el timeout de undici
// (~300 s) y la orden no se guardaría en ningún lado. Rendirse = "no pude leer el
// catálogo", que es un estado que el saneo ya sabe manejar.
async function conTiempoLimite<T>(p: Promise<T>, ms: number, que: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rechazar) => { t = setTimeout(() => rechazar(new Error(`${que}: BC no contestó en ${ms} ms`)), ms); }),
    ]);
  } finally { if (t) clearTimeout(t); }
}

// Códigos de obra que EXISTEN en BC (tabla Project/Job), en mayúscula. `null` = el
// catálogo NO se pudo leer, que no es lo mismo que "no hay obras": se avisa en el log
// y el llamador lo distingue, porque con `null` el saneo no opina y deja pasar lo que
// venga (incluido el ALM-GRAL que hace que BC rechace el pedido entero).
//
// OJO con la lista vacía: se trata como "no pude leer". Un 200 con `value: []` puede
// ser un permission set mal puesto, y creerle sería sacarle la obra a TODAS las líneas
// de TODAS las órdenes — mucho peor que el bug que esto arregla.
async function codigosDeObra(): Promise<Set<string> | null> {
  try {
    const codigos = new Set((await conTiempoLimite(bcObras(), 8000, "catálogo de obras"))
      .map((o) => (o.codigo ?? "").trim().toUpperCase()).filter(Boolean));
    if (!codigos.size) {
      console.warn("BC: el catálogo de obras vino VACÍO; no se verifica el Project No. de las líneas.");
      return null;
    }
    return codigos;
  } catch (e) {
    console.warn("BC: no se pudo leer el catálogo de obras; no se verifica el Project No. de las líneas —", e);
    return null;
  }
}

// Deja SIN OBRA a las líneas cuyo jobNo no es una obra real de BC.
//
// La obra de una línea es un Project No. de BC, pero en la app se venía llenando con
// el almacén/centro de costo de la solicitud, y ahí caben códigos que no son obras
// (ALM-GRAL y cualquier centro de costo sin proyecto). Al reescribir las líneas de un
// pedido, BC rechaza TODO el documento por una sola de esas:
//   "The field Project No. of table Purchase Line contains a value (ALM-GRAL) that
//    cannot be found in the related table (Project)"
// El pedido en BC se quedaba con las líneas VIEJAS y el edit no había forma de
// completarlo — reintentar daba siempre el mismo error, porque el código malo ya
// estaba guardado en el SQL.
//
// Es la parte pura (testeable sin BC): decide contra el catálogo que se le pase.
// Con `obras === null` no toca nada — un bache de red no debe borrarle la obra a una
// línea que sí la tiene, que es lo que hace que el material se cargue como consumo.
//
// `catalogo` es parte del contrato a propósito: "no se descartó nada" significa cosas
// MUY distintas según se haya podido leer el catálogo o no, y el llamador tiene que
// poder decírselo a quien está guardando.
export type SaneoObras<T> = { lineas: T[]; descartadas: string[]; catalogo: "ok" | "sin-leer" };

export function sinObrasInexistentes<T extends { jobNo?: string | null; taskNo?: string | null }>(
  lineas: T[], obras: Set<string> | null,
): SaneoObras<T> {
  const ls = lineas ?? [];
  if (!obras) return { lineas: ls, descartadas: [], catalogo: "sin-leer" };
  const fuera = new Set(ls.map((l) => (l.jobNo ?? "").trim().toUpperCase()).filter((c) => c && !obras.has(c)));
  if (!fuera.size) return { lineas: ls, descartadas: [], catalogo: "ok" };
  return {
    // La tarea se va con la obra: una Job Task sin Job No. tampoco existe en BC.
    lineas: ls.map((l) => (fuera.has((l.jobNo ?? "").trim().toUpperCase()) ? { ...l, jobNo: undefined, taskNo: undefined } : l)),
    descartadas: [...fuera].sort(),
    catalogo: "ok",
  };
}

// Íd., pero leyendo el catálogo de obras de BC (cache de 5 min). Se usa al guardar
// una orden, ANTES de tocar el SQL, para que el código malo no llegue a quedar
// guardado y el pedido de BC se pueda reescribir siempre.
export async function sanearObrasDeLineas<T extends { jobNo?: string | null; taskNo?: string | null }>(
  lineas: T[],
): Promise<SaneoObras<T>> {
  const ls = lineas ?? [];
  // Sin ninguna obra que verificar no se molesta a BC: no hay nada que pueda fallar,
  // así que el catálogo cuenta como "ok" (no queda nada sin verificar).
  if (!ls.some((l) => (l.jobNo ?? "").trim())) return { lineas: ls, descartadas: [], catalogo: "ok" };
  return sinObrasInexistentes(ls, await codigosDeObra());
}

// Texto para la persona que está guardando. "" = no hay nada que contarle.
// El saneo cambia a qué se costea el material, así que NO puede ser mudo.
export function avisoDeSaneo(saneo: { descartadas: string[]; catalogo: "ok" | "sin-leer" }): string {
  if (saneo.catalogo === "sin-leer") {
    return "No se pudo leer el catálogo de obras de BC, así que la obra de las líneas no se verificó. Si BC rechaza el pedido por el Project No., es por esto.";
  }
  if (!saneo.descartadas.length) return "";
  return `Se quitó la obra ${saneo.descartadas.join(", ")} de las líneas que la tenían: en BC no existe como obra (es un almacén o centro de costo). El material entra a inventario, no se costea a una obra.`;
}

// Lista paginada de una API custom con path+query ya armados (incluye $filter).
// A diferencia de listAll (datos maestros, cache 5 min), aquí el caller decide
// el cache vía `opts` (p.ej. no-store para stock, que cambia con cada recepción).
async function listCustom(group: string, path: string, opts: RequestInit = { cache: "no-store" }): Promise<any[]> {
  const cid = await getCompanyId();
  let url: string | null = `${customRoot(group)}/companies(${cid})/${path}`;
  const out: any[] = [];
  let guard = 0;
  while (url && guard++ < 50) {
    const res = await bcFetch(url, opts);
    if (!res.ok) throw new Error(`BC ${res.status} en ${url}: ${(await res.text()).slice(0, 250)}`);
    const data: any = await res.json();
    out.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  return out;
}

// Escapa una comilla simple para un literal OData ('' = comilla dentro del string).
function odataStr(v: string): string {
  return v.replace(/'/g, "''");
}

export type BcExistencia = { itemNo: string; variantCode: string; locationCode: string; descripcion: string; cantidad: number; unidad: string };

// Existencias (stock neto físico) por ubicación, vía la API custom Adelante
// `inventoryByLocation` (page 50236, grupo inventory). cantidad = quantityOnHand
// = SUM(Quantity) de TODOS los movimientos (inventario actual real). Fila por
// variante (PK = itemNo+variantCode+locationCode). Requiere al menos itemNo o
// locationCode (la API lo exige por performance). Convención: locationCode = N.º
// de obra, así que "existencias de una obra" = filtrar por su locationCode.
export async function bcExistencias(opts: { itemNo?: string; locationCode?: string }): Promise<BcExistencia[]> {
  const itemNo = (opts.itemNo ?? "").trim();
  const locationCode = (opts.locationCode ?? "").trim();
  if (!itemNo && !locationCode) throw new Error("Se requiere itemNo o locationCode para consultar existencias.");
  const conds: string[] = [];
  if (itemNo) conds.push(`itemNo eq '${odataStr(itemNo)}'`);
  if (locationCode) conds.push(`locationCode eq '${odataStr(locationCode)}'`);
  const rows = await listCustom("inventory", `inventoryByLocation?$filter=${encodeURIComponent(conds.join(" and "))}`);
  return rows.map((r) => ({
    itemNo: r.itemNo ?? r.ItemNo ?? "",
    variantCode: r.variantCode ?? r.VariantCode ?? "",
    locationCode: r.locationCode ?? r.LocationCode ?? "",
    descripcion: r.description ?? r.Description ?? "",
    cantidad: Number(r.quantityOnHand ?? r.QuantityOnHand ?? 0) || 0,
    unidad: r.unitOfMeasure ?? r.UnitOfMeasure ?? r.baseUnitOfMeasure ?? "",
  }));
}

export type BcJobTask = { jobNo: string; jobTaskNo: string; descripcion: string; tipo: string };

// Catálogo de tareas de obra (Job Task) vía la API custom Adelante `jobTasks`
// (page 50154, grupo project). Filtrable por jobNo. Datos relativamente estables:
// cache 5 min como el resto de maestros.
export async function bcJobTasks(jobNo?: string): Promise<BcJobTask[]> {
  const j = (jobNo ?? "").trim();
  const query = j ? `?$filter=${encodeURIComponent(`jobNo eq '${odataStr(j)}'`)}` : "";
  const rows = await listCustom("project", `jobTasks${query}`, { next: { revalidate: 300 } } as RequestInit);
  return rows.map((t) => ({
    jobNo: t.jobNo ?? t.JobNo ?? "",
    jobTaskNo: t.jobTaskNo ?? t.JobTaskNo ?? "",
    descripcion: t.description ?? t.Description ?? "",
    tipo: t.jobTaskType ?? t.JobTaskType ?? "",
  }));
}

export type BcItemCharge = { no: string; descripcion: string };

// Catálogo de Cargos de producto (Item Charge, tabla BC 5800): Transporte,
// Servicio de corte, Impuestos exterior, etc. Se usan al armar la orden para
// agregar líneas tipo "Cargo (Prod.)". Custom API Adelante (grupo purchasing).
// Defensiva: si aún no está publicada, devuelve [] (la UI cae a texto libre).
export async function bcItemCharges(): Promise<BcItemCharge[]> {
  try {
    const rows = await listCustom("purchasing", "itemCharges", { next: { revalidate: 300 } } as RequestInit);
    return rows
      .map((r) => ({ no: r.no ?? r.No ?? r.number ?? "", descripcion: r.description ?? r.Description ?? "" }))
      .filter((c) => c.no);
  } catch {
    return [];
  }
}

export type BcPostedReceiptLine = {
  documentNo: string;    // N.º de recepción registrada (albarán), p.ej. CR-000003
  lineNo: number;        // N.º de línea dentro de la recepción
  vendorNo: string;      // proveedor del material (Buy-from Vendor No.)
  itemNo: string;        // artículo recibido
  descripcion: string;
  locationCode: string;
  cantidad: number;      // cantidad recibida en la recepción
  precioUnitario: number;
  importe: number;       // importe de la línea (base del reparto "Por importe")
  pesoBruto: number;     // Gross Weight (base del reparto "Por peso")
  volumen: number;       // Unit Volume (base del reparto "Por volumen")
  fecha: string;         // fecha de registro (posting date)
};

// Líneas de recepciones de compra YA REGISTRADAS (albaranes, tabla Purch. Rcpt.
// Line 121), para asignarles un Cargo de producto que factura un TERCERO (caso
// típico: el material lo facturó el proveedor, pero el transporte lo trajo y
// factura otra empresa). Custom API Adelante `postedReceiptLines` (grupo
// purchasing). Filtrable por proveedor del material, artículo y/o N.º de
// recepción; exige al menos un filtro (performance). Propaga el error para que
// el endpoint distinga "API no publicada" de "sin resultados".
export async function bcPostedReceiptLines(opts: { vendorNo?: string; itemNo?: string; documentNo?: string }): Promise<BcPostedReceiptLine[]> {
  const vendorNo = (opts.vendorNo ?? "").trim();
  const itemNo = (opts.itemNo ?? "").trim();
  const documentNo = (opts.documentNo ?? "").trim();
  if (!vendorNo && !itemNo && !documentNo) throw new Error("Se requiere proveedor, artículo o N.º de recepción para buscar líneas de recepción.");
  const conds: string[] = [];
  if (vendorNo) conds.push(`buyFromVendorNo eq '${odataStr(vendorNo)}'`);
  if (itemNo) conds.push(`no eq '${odataStr(itemNo)}'`);
  if (documentNo) conds.push(`documentNo eq '${odataStr(documentNo)}'`);
  const rows = await listCustom("purchasing", `postedReceiptLines?$filter=${encodeURIComponent(conds.join(" and "))}&$orderby=documentNo desc,lineNo`);
  return rows
    .map((r) => ({
      documentNo: r.documentNo ?? r.DocumentNo ?? "",
      lineNo: Number(r.lineNo ?? r.LineNo ?? 0) || 0,
      vendorNo: r.buyFromVendorNo ?? r.BuyFromVendorNo ?? r.vendorNo ?? "",
      itemNo: r.no ?? r.No ?? r.itemNo ?? "",
      descripcion: r.description ?? r.Description ?? "",
      locationCode: r.locationCode ?? r.LocationCode ?? "",
      cantidad: Number(r.quantity ?? r.Quantity ?? 0) || 0,
      precioUnitario: Number(r.directUnitCost ?? r.DirectUnitCost ?? 0) || 0,
      importe: Number(r.lineAmount ?? r.LineAmount ?? r.amount ?? r.Amount ?? 0) || 0,
      pesoBruto: Number(r.grossWeight ?? r.GrossWeight ?? 0) || 0,
      volumen: Number(r.unitVolume ?? r.UnitVolume ?? 0) || 0,
      fecha: r.postingDate ?? r.PostingDate ?? "",
    }))
    .filter((l) => l.documentNo && l.lineNo > 0);
}

// Almacenes/ubicaciones (tabla Location) por la API custom de Adelante
// (api/adelante/inventory/v1.0/locations, page 50234). Se usan para elegir el
// almacén de recepción al armar la orden. Cache de último bueno + fallback.
let lastGoodAlmacenes: BcAlmacen[] | null = null;
export async function bcAlmacenes(): Promise<BcAlmacen[]> {
  try {
    const rows = await listAll("inventory", "locations");
    const alm = rows
      .map((l) => ({ codigo: l.code ?? l.Code ?? "", nombre: l.name ?? l.Name ?? l.code ?? l.Code ?? "" }))
      .filter((a) => a.codigo);
    if (alm.length) lastGoodAlmacenes = alm;
    return alm;
  } catch {
    return lastGoodAlmacenes ?? [];
  }
}

export type BcVendor = { id: string; code: string; nombre: string; currencyCode: string };

// Proveedores (vendors) de BC por la API ESTÁNDAR v2.0 (la app tiene FULL ACCESS).
// Se cachean 5 min como dato maestro. code = number del proveedor (lo que va como vendorNo).
let lastGoodVendors: BcVendor[] | null = null;
export async function bcVendors(): Promise<BcVendor[]> {
 try {
  const cid = await getStdCompanyId();
  let url: string | null = `${stdRoot()}/companies(${cid})/vendors?$select=id,number,displayName,currencyCode&$top=5000`;
  const out: any[] = [];
  let guard = 0;
  while (url && guard++ < 50) {
    const res = await bcFetch(url, { next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) throw new Error(`BC ${res.status} en vendors: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    out.push(...(data.value ?? []));
    url = data["@odata.nextLink"] ?? null;
  }
  const vendors = out
    .filter((v) => !(v.blocked && v.blocked !== "_x0020_" && v.blocked !== " "))
    .map((v) => ({
      id: v.id ?? v.number ?? "",
      code: v.number ?? "",
      nombre: v.displayName ?? v.number ?? "",
      currencyCode: v.currencyCode ?? "",
    }))
    .filter((v) => v.code);
  if (vendors.length) lastGoodVendors = vendors;
  return vendors;
 } catch (e) {
  if (lastGoodVendors) { console.warn("BC vendors falló; sirviendo último listado bueno cacheado."); return lastGoodVendors; }
  throw e;
 }
}

// Último precio con que se FACTURÓ un item a un proveedor, leído de las facturas
// de compra registradas en BC (API estándar v2.0). Revisa las facturas más
// recientes del proveedor y devuelve el precio de la línea de ese item.
// Devuelve null si no hay historial o si BC no responde (la UI cae al historial local).
export async function bcUltimoPrecioFacturado(itemNo: string, vendorNo: string): Promise<PrecioFacturado | null> {
  if (!itemNo || !vendorNo) return null;
  try {
    const cid = await getStdCompanyId();
    const filtro = `$filter=${encodeURIComponent(`vendorNumber eq '${vendorNo}'`)}`;
    const url =
      `${stdRoot()}/companies(${cid})/purchaseInvoices?${filtro}` +
      `&$orderby=invoiceDate desc&$top=20&$select=id,currencyCode,invoiceDate` +
      `&$expand=purchaseInvoiceLines($select=lineType,lineObjectNumber,unitOfMeasureCode,directUnitCost,unitCost)`;
    const res = await bcFetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data: any = await res.json();
    for (const inv of (data.value ?? [])) {
      for (const l of (inv.purchaseInvoiceLines ?? [])) {
        if ((l.lineObjectNumber ?? "") === itemNo) {
          const precio = (typeof l.directUnitCost === "number" && l.directUnitCost > 0) ? l.directUnitCost
            : (typeof l.unitCost === "number" && l.unitCost > 0) ? l.unitCost : null;
          // La unidad y la moneda VIAJAN CON EL PRECIO: ese precio es por la unidad
          // de la línea facturada (estañón) y en la moneda de la factura. Devolver
          // el número pelado fue justo el error que puso ₡1,74 en una línea de
          // estañones.
          if (precio != null) return {
            precio,
            unidad: (l.unitOfMeasureCode ?? "").toString().trim().toUpperCase(),
            moneda: (inv.currencyCode ?? "").toString().trim(),
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export type PrecioFacturado = { precio: number; unidad: string; moneda: string };

export type BcOrdenTotales = { subtotal: number; iva: number; total: number; currencyCode: string };

// Totales del Pedido de compra CALCULADOS POR BC (fuente de verdad): subtotal
// (excl. IVA, incluye cargos), IVA total y total con IVA. La app los MUESTRA tal
// cual para que la orden se vea igual que en BC (en vez de recalcular y desalinearse).
// Defensiva: null si BC no responde o el pedido no existe todavía.
export async function bcOrdenTotales(orderNo: string): Promise<BcOrdenTotales | null> {
  if (!orderNo) return null;
  try {
    const cid = await getStdCompanyId();
    const filtro = `$filter=${encodeURIComponent(`number eq '${odataStr(orderNo)}'`)}&$select=totalAmountExcludingTax,totalTaxAmount,totalAmountIncludingTax,currencyCode&$top=1`;
    const res = await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders?${filtro}`, { cache: "no-store" });
    if (!res.ok) return null;
    const po = ((await res.json())?.value ?? [])[0];
    if (!po) return null;
    return {
      subtotal: Number(po.totalAmountExcludingTax) || 0,
      iva: Number(po.totalTaxAmount) || 0,
      total: Number(po.totalAmountIncludingTax) || 0,
      currencyCode: po.currencyCode || "",
    };
    // OJO: NO agregar acá el estado de lanzamiento leyendo `po.status`. Se probó
    // (17 ago 2026) contra el Sandbox y ese campo devuelve "Open" también para
    // pedidos LANZADOS — no es el Status del Purchase Header. Mostrarlo hacía que
    // la orden dijera "en BC: Abierto" con el pedido lanzado en BC. Si se quiere el
    // estado real, va por un procedure del codeunit AdelantePO, no por esta API.
  } catch { return null; }
}

export type BcVariante = { code: string; descripcion: string; id?: string };

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
    id: v.id ?? v.systemId ?? undefined,   // systemId (GUID), para itemVariantId al crear el pedido
  }));
}

// Variantes de un item. Intenta primero la API CUSTOM de Adelante
// (api/adelante/inventory/v1.0/.../itemVariants, page 50128) y, si esa falla,
// cae a la API ESTÁNDAR v2.0 (.../itemVariants). Solo se considera "no tiene
// variantes" cuando alguna de las dos responde OK con lista vacía. Si ambas
// fallan (401/permiso/no publicada), devuelve disponible=false.
const lastGoodVariants = new Map<string, BcVariantsResult>();
export async function bcVariantsEx(itemNo: string): Promise<BcVariantsResult> {
  if (!itemNo) return { variantes: [], disponible: true };
  const filtro = `$filter=itemNumber eq '${encodeURIComponent(itemNo)}'`;

  // 1) API custom de Adelante.
  try {
    const cid = await getCompanyId();
    const res = await bcFetch(`${customRoot("inventory")}/companies(${cid})/itemVariants?${filtro}`, { cache: "no-store" });
    if (res.ok) { const r = { variantes: mapVariantes((await res.json()).value), disponible: true }; lastGoodVariants.set(itemNo, r); return r; }
  } catch { /* intenta la estándar */ }

  // 2) Fallback: API estándar v2.0.
  try {
    const stdCid = await getStdCompanyId();
    const res = await bcFetch(`${stdRoot()}/companies(${stdCid})/itemVariants?${filtro}`, { cache: "no-store" });
    if (res.ok) { const r = { variantes: mapVariantes((await res.json()).value), disponible: true }; lastGoodVariants.set(itemNo, r); return r; }
  } catch { /* ambas fallaron */ }

  // Ambas fallaron (binding parpadeó): si tenemos un resultado bueno previo de este
  // item, lo servimos en vez de alarmar con disponible:false.
  const cached = lastGoodVariants.get(itemNo);
  if (cached) { console.warn(`BC variantes de ${itemNo} falló; sirviendo último resultado bueno cacheado.`); return cached; }
  return { variantes: [], disponible: false };
}

// Resuelve el código de variante de un item a su itemVariantId (systemId GUID),
// que es lo que exige la línea estándar de BC (igual que locationId). Cachea por
// item+code. Usa la API estándar de itemVariants (devuelve id).
const stdVariantIdCache: Record<string, string | null> = {};
async function getStdVariantId(itemNo: string, code: string): Promise<string | null> {
  if (!itemNo || !code) return null;
  const key = `${itemNo}|${code}`;
  if (key in stdVariantIdCache) return stdVariantIdCache[key];
  try {
    const cid = await getStdCompanyId();
    const filtro = `$filter=${encodeURIComponent(`itemNumber eq '${itemNo}' and code eq '${code}'`)}&$select=id,code`;
    const res = await bcFetch(`${stdRoot()}/companies(${cid})/itemVariants?${filtro}`, { cache: "no-store" });
    if (res.ok) {
      const id = ((await res.json()).value ?? [])[0]?.id ?? null;
      stdVariantIdCache[key] = id;
      return id;
    }
  } catch { /* no resoluble */ }
  stdVariantIdCache[key] = null;
  return null;
}

// ---- Escritura: crear Pedido de compra (Purchase Order) por la API ESTÁNDAR ----
export type NuevaLineaBc = { itemNo: string; cantidad: number; precio?: number; descripcion?: string; variantCode?: string; unidad?: string; jobNo?: string };

// La API estándar de purchaseOrderLine NO acepta `locationCode`; requiere
// `locationId` (el systemId GUID del almacén). Lo resolvemos por código contra
// la entidad /locations estándar y lo cacheamos por código.
const stdLocationIdCache: Record<string, string | null> = {};
async function getStdLocationId(cid: string, code: string): Promise<string | null> {
  if (!code) return null;
  if (code in stdLocationIdCache) return stdLocationIdCache[code];
  try {
    const filtro = `$filter=${encodeURIComponent(`code eq '${code}'`)}&$select=id,code`;
    const res = await bcFetch(`${stdRoot()}/companies(${cid})/locations?${filtro}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const id = (data.value ?? [])[0]?.id ?? null;
      stdLocationIdCache[code] = id;
      return id;
    }
  } catch { /* sin ubicación resoluble */ }
  stdLocationIdCache[code] = null;
  return null;
}

// systemId (GUID) de una DIMENSIÓN por su código (p.ej. "CC" = Centro de Costo).
// Se consulta en vez de hardcodearse porque el GUID es distinto en cada entorno de
// BC (Sandbox y Production tienen dimensiones con el mismo código y otro id).
const stdDimensionIdCache: Record<string, string | null> = {};
async function getStdDimensionId(cid: string, code: string): Promise<string | null> {
  if (!code) return null;
  if (code in stdDimensionIdCache) return stdDimensionIdCache[code];
  try {
    const filtro = `$filter=${encodeURIComponent(`code eq '${code}'`)}&$select=id,code`;
    const res = await bcFetch(`${stdRoot()}/companies(${cid})/dimensions?${filtro}`, { cache: "no-store" });
    if (res.ok) {
      const id = ((await res.json()).value ?? [])[0]?.id ?? null;
      stdDimensionIdCache[code] = id;
      return id;
    }
  } catch { /* sin dimensión resoluble */ }
  stdDimensionIdCache[code] = null;
  return null;
}

// Código de la dimensión Centro de Costo en BC. Configurable por si cambia el
// nombre de la dimensión; el GUID NO se configura, se consulta (ver arriba).
function codigoDimensionCC(): string {
  return (process.env.BC_DIMENSION_CC ?? "CC").trim();
}

// Estampa la dimensión Centro de Costo = obra en el ENCABEZADO de un pedido recién
// creado (tiene que estar Abierto). Es lo que hace que el pedido entre al workflow
// de aprobación de BC. Devuelve null si quedó puesta, o el motivo si no se pudo.
async function ponerCentroCosto(cid: string, poId: string, obra: string): Promise<string | null> {
  const code = codigoDimensionCC();
  const dimId = await getStdDimensionId(cid, code);
  if (!dimId) return `la dimensión ${code} no existe en Business Central (o no se pudo consultar)`;
  try {
    const res = await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders(${poId})/dimensionSetLines`, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: dimId, valueCode: obra }),
    });
    if (!res.ok) return `BC ${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (e: any) {
    return String(e?.message ?? e);
  }
  return null;
}

// Cargo de producto (Item Charge) a agregar al pedido: tipo (chargeNo del catálogo
// BC), cantidad y precio unitario. Sin chargeNo cae al flete por defecto (env).
export type CargoBc = { chargeNo?: string; descripcion?: string; cantidad?: number; precio: number };

// Normaliza un precio a número válido para BC (directUnitCost). El precio puede
// llegar como number, o como string desde el request body / la BD, a veces con
// coma decimal o separadores de miles (es-CR: "1.234,56"). Si se manda crudo,
// BC lo recibe mal. Acá lo dejamos siempre como número limpio (5 decimales).
export function toBcAmount(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : 0;
  if (typeof v === "string") {
    const s = v.replace(/[^\d.,-]/g, "").trim();
    // Con los dos separadores presentes, el DECIMAL es el que aparece último:
    // "1.234,56" (es-CR) → 1234.56 y "1,234.56" (en-US) → 1234.56. Antes se asumía
    // siempre formato es-CR, así que un valor en formato US se leía 1000× más chico
    // (y esto se usa para el precio que viaja a BC).
    const ultimaComa = s.lastIndexOf(",");
    const ultimoPunto = s.lastIndexOf(".");
    let limpio: string;
    if (ultimaComa >= 0 && ultimoPunto >= 0) {
      const decimal = ultimaComa > ultimoPunto ? "," : ".";
      const miles = decimal === "," ? "." : ",";
      limpio = s.split(miles).join("").replace(decimal, ".");
    } else if (ultimaComa >= 0) {
      limpio = s.replace(",", ".");   // "1234,56" → "1234.56"
    } else {
      limpio = s;
    }
    const n = parseFloat(limpio);
    return Number.isFinite(n) ? Math.round(n * 1e5) / 1e5 : 0;
  }
  return 0;
}

export async function bcCrearPedido(input: { vendorNo: string; currencyCode?: string; locationCode?: string; lineas: NuevaLineaBc[]; cargos?: CargoBc[]; flete?: { monto: number; descripcion?: string } }): Promise<{ number: string; id: string; omitidas: string[]; creadas: number; lineError?: string; cargoError?: string; cargosCreados: number; avisoCC?: string }> {
  if (!input?.vendorNo) throw new Error("Falta el proveedor (vendorNo).");
  const lineas = (input.lineas ?? []).filter((l) => l.itemNo && l.cantidad > 0);
  if (!lineas.length) throw new Error("No hay líneas de material válidas para el pedido.");
  const cid = await getStdCompanyId(); // MISMA compañía que items/vendors (API estándar)
  const jsonHeaders = { "Content-Type": "application/json" };

  // 1) Encabezado: proveedor (+ moneda si no es CRC).
  const headerBody: Record<string, unknown> = { vendorNumber: input.vendorNo };
  const cur = (input.currencyCode ?? "").toUpperCase();
  if (cur && cur !== "CRC") headerBody.currencyCode = cur;
  const resH = await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(headerBody), cache: "no-store" });
  if (!resH.ok) throw new Error(`BC ${resH.status} al crear el pedido: ${(await resH.text()).slice(0, 300)}`);
  const po: any = await resH.json();

  // 2) Líneas: una por material (tipo Artículo). Si una línea falla, la OMITIMOS y
  // seguimos, pero GUARDAMOS el motivo real de BC (antes se descartaba y quedaba a
  // ciegas por qué no se agregaban las líneas). Devolvemos omitidas + primer error.
  const omitidas: string[] = [];
  let lineError: string | undefined;
  let cargoError: string | undefined;
  let cargosCreados = 0;
  let creadas = 0;
  // Almacén de recepción fijo (p.ej. ALM-GRAL): aunque Ingeniería pida para una
  // obra, el material entra siempre al almacén general. Configurable por env.
  // La línea estándar de BC requiere el GUID (locationId), no el código.
  const loc = input.locationCode || process.env.BC_RECEPCION_LOCATION;
  const locId = loc ? await getStdLocationId(cid, loc) : null;
  for (const l of lineas) {
    const lineBody: Record<string, unknown> = { lineType: "Item", lineObjectNumber: l.itemNo, quantity: l.cantidad };
    const precioItem = toBcAmount(l.precio);
    if (precioItem > 0) lineBody.directUnitCost = precioItem;
    if (locId) lineBody.locationId = locId;
    // La unidad en la que están la cantidad y el precio. Sin ella BC deja la base
    // del ítem, y comprar por estañón a precio de estañón anotado en gramos es un
    // error de 255.000× — así que si viene, viaja.
    const unidadItem = (l.unidad ?? "").trim().toUpperCase();
    if (unidadItem) lineBody.unitOfMeasureCode = unidadItem;
    // Variante: si el item la exige, BC pide itemVariantId (GUID), no el código.
    if (l.variantCode) {
      const vId = await getStdVariantId(l.itemNo, l.variantCode);
      if (vId) lineBody.itemVariantId = vId;
    }
    const resL = await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders(${po.id})/purchaseOrderLines`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(lineBody), cache: "no-store" });
    if (resL.ok) { creadas++; }
    else {
      omitidas.push(l.itemNo);
      if (!lineError) lineError = `${l.itemNo}: BC ${resL.status} ${(await resL.text()).slice(0, 400)}`;
    }
  }
  // 3) CARGOS DE PRODUCTO (Item Charge): NO por la API estándar (se traga la línea
  // sin avisar). Van por el codeunit AdelantePO_AddChargeLine (idempotente por
  // itemChargeNo). El reparto por importe lo hace el codeunit al registrar.
  const cargos: CargoBc[] = (input.cargos && input.cargos.length)
    ? input.cargos
    : (input.flete && input.flete.monto > 0 ? [{ descripcion: input.flete.descripcion, cantidad: 1, precio: input.flete.monto }] : []);
  if (creadas > 0) {
    for (const cg of cargos) {
      const qty = cg.cantidad && cg.cantidad > 0 ? cg.cantidad : 1;
      const precioCargo = toBcAmount(cg.precio);
      if (!(precioCargo > 0)) continue;
      // El tipo (Item Charge) debe ser un código REAL de BC. Antes caía a "FLETE",
      // que no existe → 404 y la orden quedaba sin flete. Si no hay tipo válido, se
      // omite el cargo y se reporta (no se inventa un código).
      const chargeNo = (cg.chargeNo || process.env.BC_ITEM_CHARGE_FLETE || "").trim();
      if (!chargeNo) {
        if (!cargoError) cargoError = "El cargo no tiene tipo (Item Charge). Elegí el tipo de cargo y reintentá.";
        continue;
      }
      try {
        await bcAddChargeLine(po.number, chargeNo, cg.descripcion || "CARGO / TRANSPORTE", qty, precioCargo);
        cargosCreados++;
      } catch (e: any) {
        if (!cargoError) cargoError = `cargo ${chargeNo}: ${String(e?.message ?? e)}`;
      }
    }
  }
  // Si NINGUNA línea entró, el pedido quedaría vacío en BC (y "no hay nada que
  // lanzar"). Borramos el encabezado huérfano y fallamos con el motivo real.
  if (creadas === 0) {
    try { await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders(${po.id})`, { method: "DELETE", cache: "no-store" }); } catch { /* best effort */ }
    throw new Error(`BC rechazó todas las líneas del pedido — ${lineError ?? "sin detalle"}`);
  }
  // Centro de Costo en el encabezado (ver ponerCentroCosto): sin esta dimensión el
  // pedido no entra al workflow de aprobación de BC. No es fatal.
  let avisoCC: string | undefined;
  const obraCC = (lineas.find((l) => (l.jobNo ?? "").trim())?.jobNo ?? "").trim();
  if (obraCC) {
    const err = await ponerCentroCosto(cid, String(po.id ?? ""), obraCC);
    if (err) avisoCC = `No se le pudo poner el Centro de Costo ${obraCC} al pedido ${po.number ?? ""} (${err}): en BC no va a entrar al circuito de aprobación.`;
  }
  return { number: po.number ?? "", id: po.id ?? "", omitidas, creadas, lineError, cargoError, cargosCreados, avisoCC };
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
  const cid = await getStdCompanyId();
  const url = `${odataRoot()}/AdelantePO_ReleaseOrder?company=${encodeURIComponent(cid)}`;
  const res = await bcFetch(url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo }),
  });
  if (!res.ok) throw new Error(`BC release ${res.status}: ${(await res.text()).slice(0, 250)}`);
  const d: any = await res.json().catch(() => ({}));
  return d?.value ?? "Released";
}

// Reabre (Reopen) un Pedido de compra en BC -> vuelve de "Lanzado" a "Abierto".
// Es el inverso de bcReleasePedido y hace falta para el flujo real: reabrir la orden
// acá, corregirla y volver a mandarla a aprobación. Con el pedido LANZADO en BC no
// se puede editar ni re-sincronizar, así que hay que des-lanzarlo primero.
// La API estándar v2.0 no puede cambiar el `status`: va por el codeunit custom
// "Adelante PO Actions" (publicado como "AdelantePO").
// Procedimiento esperado: AdelantePO_ReopenOrder(orderNo) -> Text (status).
export async function bcReopenPedido(orderNo: string): Promise<string> {
  if (!orderNo) throw new Error("Falta el número de pedido para reabrir.");
  const cid = await getStdCompanyId();
  const url = `${odataRoot()}/AdelantePO_ReopenOrder?company=${encodeURIComponent(cid)}`;
  const res = await bcFetch(url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo }),
  });
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 250);
    // 404 = el web service no está publicado en BC todavía. Decirlo con nombre y
    // apellido en vez de un "BC reopen 404" que no le dice nada a nadie.
    if (res.status === 404) throw new Error(`el web service AdelantePO_ReopenOrder no está publicado en Business Central`);
    throw new Error(`BC reopen ${res.status}: ${txt}`);
  }
  const d: any = await res.json().catch(() => ({}));
  return d?.value ?? "Open";
}

// Tipos de línea que se le manda a BC al reescribir un pedido. Es el shape de la
// app, no el de BC: la traducción la hace payloadReplaceLines.
export type LineaReplaceBc = {
  tipo: "articulo" | "cargo";
  itemNo?: string; variantCode?: string; locationCode?: string;
  unidad?: string;   // unidad de COMPRA (EST): en ella están cantidad y precio
  cantidad: number; precio: number | string; descuentoPct?: number;
  jobNo?: string; taskNo?: string;
  // Centro de costo (dimensión CC) de ESTA línea: para qué obra es el material.
  // No es lo mismo que `jobNo`, y por eso son dos campos:
  //   jobNo  → consumo directo: BC lo carga contra el proyecto y NO entra a
  //            inventario. Exige tarea.
  //   centroCosto → el material entra a bodega y queda apartado para esa obra
  //            hasta que campo lo pida. No exige tarea, y es la dimensión que
  //            dispara el workflow de aprobación de BC.
  // Un consumo directo lleva los dos (el CC es su misma obra); una compra para
  // stock lleva solo el CC.
  centroCosto?: string;
  chargeNo?: string; chargeMethod?: string; descripcion?: string;
};

// Traduce las líneas de la app al JSON que espera AdelantePO_ReplaceOrderLines.
// Está separado y exportado porque acá se decide QUÉ CANTIDAD y QUÉ PRECIO quedan
// en BC — o sea, contra qué van a recibir Bodega y facturar Contabilidad. Cubierto
// por lib/bc-replace.test.ts.
// El centro de costo de una línea, como lo espera el codeunit: código de la
// dimensión + valor. Se manda el código (no se asume "CC" del lado de BC) porque
// cuál es la dimensión de centro de costo es configuración: BC_DIMENSION_CC.
// Sin valor no se manda nada: mandar la clave vacía BORRARÍA la dimensión que BC
// pone sola por el ítem o el almacén (mismo error que se pagó con la unidad y la
// variante en CP-003884).
function dimensionDeLinea(l: LineaReplaceBc): Record<string, string> {
  const valor = (l.centroCosto ?? "").trim();
  return valor ? { ccCode: codigoDimensionCC(), ccValue: valor } : {};
}

export function payloadReplaceLines(lineas: LineaReplaceBc[]): { lines: Record<string, unknown>[]; omitidas: string[] } {
  const lines: Record<string, unknown>[] = [];
  const omitidas: string[] = [];
  for (const l of lineas ?? []) {
    const nombre = l.descripcion || l.itemNo || l.chargeNo || "línea sin nombre";
    const cantidad = Number(l.cantidad) || 0;
    // El codeunit también omite las cantidades <= 0, pero se filtran acá para que el
    // aviso al usuario diga QUÉ línea se cayó y no un conteo pelado.
    if (cantidad <= 0) { omitidas.push(`${nombre} (cantidad ${cantidad})`); continue; }
    const precio = toBcAmount(l.precio);
    if (l.tipo === "cargo") {
      // El tipo de cargo tiene que ser un Item Charge REAL de BC. Sin él la línea se
      // omite y se avisa, en vez de inventar un código que BC va a rechazar.
      const chargeNo = (l.chargeNo ?? "").trim();
      if (!chargeNo) { omitidas.push(`${nombre} (cargo sin tipo)`); continue; }
      lines.push({
        type: "Charge", itemChargeNo: chargeNo, description: l.descripcion || chargeNo,
        quantity: cantidad, directUnitCost: precio, chargeMethod: l.chargeMethod || "Amount",
        ...dimensionDeLinea(l),
      });
      continue;
    }
    const itemNo = (l.itemNo ?? "").trim();
    if (!itemNo) { omitidas.push(`${nombre} (sin Nº de artículo)`); continue; }
    // La unidad viaja junto a la cantidad y el precio. BC igual pone la unidad de
    // compra del ítem al validar el N.º, pero mandarla explícita deja constancia de
    // en qué unidad están estos números: si algún día no coinciden, BC se queda con
    // la del ítem en vez de facturar 1 gramo al precio de un estañón.
    const unidad = (l.unidad ?? "").trim().toUpperCase();
    const variante = (l.variantCode ?? "").trim();
    const linea: Record<string, unknown> = {
      type: "Item", itemNo, locationCode: l.locationCode ?? "",
      quantity: cantidad, directUnitCost: precio, lineDiscountPct: Number(l.descuentoPct) || 0,
      jobNo: l.jobNo ?? "", taskNo: l.taskNo ?? "",
      ...dimensionDeLinea(l),
    };
    // Unidad y variante EN BLANCO no se mandan: mandarlas vacías no es "que BC
    // ponga la del ítem", es BORRAR la que BC ya había puesto al validar el N.º de
    // artículo. Así se cayó CP-003884 al lanzarlo ("Unit of Measure Code must have
    // a value" / "Variant Code must have a value"): el pedido se creaba bien y
    // reventaba después, en manos del aprobador. Omitido, sobrevive el default de BC.
    if (unidad) linea.unitOfMeasureCode = unidad;
    if (variante) linea.variantCode = variante;
    lines.push(linea);
  }
  return { lines, omitidas };
}

// Reescribe TODAS las líneas de un pedido de compra ABIERTO en BC, para reflejar una
// orden que se reabrió y se corrigió en la app. Sin esto el edit queda solo en el SQL
// y Bodega/Contabilidad reciben y facturan contra las líneas viejas.
//
// Va por el codeunit (AdelantePO_ReplaceOrderLines, desde 1.2.3.8) y no por la API
// estándar a propósito: reescribir por la estándar serían N llamadas con fallo
// parcial garantizado, y encima se traga las líneas de Item Charge sin avisar. El
// codeunit lo hace todo-o-nada y él mismo se niega si el pedido está lanzado o si ya
// tiene recepciones registradas.
export async function bcReplaceOrderLines(orderNo: string, lineas: LineaReplaceBc[]): Promise<{ resultado: string; omitidas: string[] }> {
  if (!orderNo) throw new Error("Falta el número de pedido de BC.");
  const { lines, omitidas } = payloadReplaceLines(lineas);
  if (!lines.length) throw new Error("Ninguna línea de la orden es válida para BC.");
  const cid = await getStdCompanyId();
  const url = `${odataRoot()}/AdelantePO_ReplaceOrderLines?company=${encodeURIComponent(cid)}`;
  const res = await bcFetch(url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    // OJO: `linesJson` viaja como STRING con el JSON escapado (mismo estilo que el
    // resto del codeunit), NO como objeto anidado.
    body: JSON.stringify({ orderNo, linesJson: JSON.stringify({ lines }) }),
  });
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 400);
    if (res.status === 404) throw new Error("el web service AdelantePO_ReplaceOrderLines no está publicado en Business Central");
    throw new Error(`BC ${res.status}: ${txt}`);
  }
  const d: any = await res.json().catch(() => ({}));
  return { resultado: String(d?.value ?? "Líneas reescritas en BC."), omitidas };
}

// Traduce las líneas de una orden de la app (las que devuelve `getOrden`) a las
// que entiende el codeunit. Estaba escrito dos veces —al editar y al enviar a
// aprobación— y los dos caminos TIENEN que mandar exactamente lo mismo: si no,
// guardar una orden cambiaría en BC algo que crearla no había puesto.
//
// El almacén cae al de recepción por defecto cuando la línea no trae uno: sin
// locationCode el material no entra a ningún lado y el stock no sube.
export function lineasOrdenParaBc(
  lineas: OrdenLinea[],
  // Obra de la SOLICITUD por línea (idPedidoCompraDet → obra). Es de dónde sale el
  // centro de costo de una compra para STOCK: ahí la obra existe —el material queda
  // apartado en bodega para ella— pero no puede viajar como Job No., porque BC exige
  // tarea con él y una compra para stock no la tiene.
  obraDeSolicitud?: Map<string, string>,
): LineaReplaceBc[] {
  return lineas.map((l) => ({
    tipo: l.tipo === "cargo" ? ("cargo" as const) : ("articulo" as const),
    itemNo: l.articuloId, variantCode: l.variantCode,
    locationCode: l.almacen || process.env.BC_RECEPCION_LOCATION || "",
    unidad: l.unidad,
    cantidad: l.cantidad, precio: l.precioUnitario, descuentoPct: l.descuentoPct,
    jobNo: l.proyecto, taskNo: l.taskNo,
    centroCosto: centroCostoDeLinea(l, obraDeSolicitud),
    chargeNo: l.chargeNo, chargeMethod: l.chargeMethod, descripcion: l.descripcion,
  }));
}

// Para qué obra es esta línea, en los DOS tipos de pedido:
//  · consumo directo → su propia obra (la que ya viaja como Job No.);
//  · para stock      → la obra de la solicitud que la originó.
// En una compra directa sin obra no hay centro de costo y no se manda ninguno.
export function centroCostoDeLinea(l: OrdenLinea, obraDeSolicitud?: Map<string, string>): string {
  const propia = (l.proyecto ?? "").trim();
  if (propia) return propia;
  const dePedido = l.pedidoLineaId ? (obraDeSolicitud?.get(String(l.pedidoLineaId)) ?? "") : "";
  return dePedido.trim();
}

// Líneas que llevan obra pero NO tarea, descritas para el usuario. Es el chequeo
// que faltaba y por el que se trabaron las primeras órdenes creadas desde acá:
// el codeunit NO se niega —crea la línea con Job No. y sin Job Task No., y solo
// devuelve un aviso—, así que el pedido queda en BC y el error aparece mucho
// después, cuando el aprobador le da lanzar ("Job Task No. must have a value") y
// no tiene cómo arreglarlo. Se corta antes de tocar BC.
export function obrasSinTarea(lineas: LineaReplaceBc[]): string[] {
  return (lineas ?? [])
    .filter((l) => l.tipo !== "cargo" && (l.jobNo ?? "").trim() && !(l.taskNo ?? "").trim())
    .map((l) => `${l.descripcion || l.itemNo || "línea"} (obra ${(l.jobNo ?? "").trim()})`);
}

// Líneas de artículo SIN unidad de compra. Mismo criterio que obrasSinTarea: se
// corta antes de tocar BC porque el pedido se crearía igual y reventaría al
// lanzarlo, ya en manos del aprobador ("Unit of Measure Code must have a value").
//
// Acá NO se adivina la unidad. La cantidad y el precio de la línea están expresados
// EN la unidad de compra, así que dejar que BC ponga la unidad BASE del ítem no
// arregla nada: convierte el número en otro. Un estañón son 255.000 gramos, o sea
// un error de 255.000× facturado. Sin unidad, la línea no viaja.
export function lineasSinUnidad(lineas: LineaReplaceBc[]): string[] {
  return (lineas ?? [])
    .filter((l) => l.tipo !== "cargo" && (l.itemNo ?? "").trim() && !(l.unidad ?? "").trim())
    .map((l) => `${l.descripcion || l.itemNo || "línea"}`);
}

// Ítems que EXIGEN variante y cuya línea viene sin ella. BC solo lo dice al LANZAR
// ("Variant Code must have a value"), igual que la unidad y la tarea, así que el
// error le cae al aprobador y no a quien puede arreglarlo.
//
// Devuelve las líneas con la variante RESUELTA y las que no se pudieron resolver:
//   · el ítem no tiene variantes, o el catálogo de BC no contesta → la línea pasa
//     tal cual (un endpoint caído no puede volverse un pedido que no se deja enviar);
//   · tiene UNA sola → se pone, porque no hay nada que elegir: BC exige variante y
//     esa es la única válida. No es adivinar, es la única opción posible;
//   · tiene VARIAS → `ambiguas`, con los códigos, porque elegir el color o la medida
//     del material no es una decisión que pueda tomar el servidor.
//
// Lo pide la app y no el codeunit porque las pantallas de nueva/editar orden todavía
// no tienen selector de variante: las líneas que vienen de una solicitud llegan con
// la que puso Ingeniería, o sin ninguna.
// La DECISIÓN, separada de la consulta a BC para poder probarla: `catalogo` es
// itemNo → códigos de variante que existen en BC. Un ítem AUSENTE del mapa es "no
// sabemos" (no tiene variantes, o el catálogo no contestó) y su línea pasa igual.
export function decidirVariantes(
  lineas: LineaReplaceBc[],
  catalogo: Map<string, string[]>,
): { lineas: LineaReplaceBc[]; ambiguas: string[] } {
  const ambiguas: string[] = [];
  const out = (lineas ?? []).map((l) => {
    if (l.tipo === "cargo") return l;
    const itemNo = (l.itemNo ?? "").trim();
    if (!itemNo || (l.variantCode ?? "").trim()) return l;
    const cods = (catalogo.get(itemNo) ?? []).filter(Boolean);
    if (cods.length === 1) return { ...l, variantCode: cods[0] };
    if (cods.length > 1) {
      ambiguas.push(`${l.descripcion || itemNo} (elegí una: ${cods.slice(0, 6).join(", ")}${cods.length > 6 ? "…" : ""})`);
    }
    return l;
  });
  return { lineas: out, ambiguas };
}

export async function resolverVariantesRequeridas(
  lineas: LineaReplaceBc[],
): Promise<{ lineas: LineaReplaceBc[]; ambiguas: string[] }> {
  const items = [...new Set((lineas ?? [])
    .filter((l) => l.tipo !== "cargo" && (l.itemNo ?? "").trim() && !(l.variantCode ?? "").trim())
    .map((l) => l.itemNo!.trim()))];
  if (!items.length) return { lineas: lineas ?? [], ambiguas: [] };

  // Un solo chequeo por ítem, aunque el pedido repita el mismo material. Si el
  // catálogo no contesta, el ítem NO entra al mapa y su línea pasa.
  const catalogo = new Map<string, string[]>();
  await Promise.all(items.map(async (itemNo) => {
    try {
      const r = await bcVariantsEx(itemNo);
      if (r.disponible) catalogo.set(itemNo, r.variantes.map((v) => v.code).filter(Boolean));
    } catch { /* sin catálogo: la línea pasa */ }
  }));
  return decidirVariantes(lineas, catalogo);
}

// Obra que se le estampa al ENCABEZADO como dimensión Centro de Costo. El workflow
// de aprobación de BC (MS-POAPW-01) dispara por esa dimensión del encabezado con
// valor *VN*/*VB* — NO por el almacén de las líneas—, así que sin esto el pedido
// nunca entra a aprobación: `SendForApproval` contesta 200, el pedido se queda
// Abierto (no le aplica workflow) y `ReleaseOrder` lo lanza sin pasar por Luis.
//
// BC guarda UN valor por dimensión en el encabezado. Si el pedido mezcla obras se
// usa la PRIMERA (las líneas llevan la suya en jobNo, que es lo que costea de
// verdad); alcanza para que el pedido entre a aprobación, que es de lo que se trata.
// El centro de costo que va al ENCABEZADO. Con el CC ya puesto en cada línea, el del
// encabezado es solo el disparador del workflow de aprobación de BC (que filtra por
// *VN*/*VB*), así que alcanza con el de la primera línea que tenga.
//
// Devuelve además si la orden mezcla obras: el encabezado no puede representarlas a
// todas —tiene un solo CC— y eso hay que decirlo en vez de que parezca que toda la
// compra es de una sola.
export function centroCostoDeOrden(lineas: LineaReplaceBc[]): { cc: string; mezcla: string[] } {
  const ccs = [...new Set((lineas ?? [])
    .filter((l) => l.tipo !== "cargo")
    .map((l) => (l.centroCosto ?? "").trim())
    .filter(Boolean))];
  return { cc: ccs[0] ?? "", mezcla: ccs.length > 1 ? ccs : [] };
}

// Crea el Pedido de compra en BC en estado ABIERTO (sin lanzar), con todas sus
// líneas. Se llama al ENVIAR A APROBACIÓN: así el pedido ya existe allá y el
// aprobador (app de Producción) solo tiene que LANZARLO.
//
// El encabezado va por la API estándar y las líneas por el codeunit
// AdelantePO_ReplaceOrderLines —el mismo camino que el edit— a propósito: la API
// estándar de purchaseOrderLines no sabe de obra/tarea (jobNo/taskNo), ni de
// unidad de compra, ni de descuento de línea, y se traga las líneas de Cargo sin
// avisar. Sobre un pedido recién creado (Abierto y sin recepciones) el codeunit
// nunca se niega, así que reescribir "todas" las líneas es insertarlas.
//
// Si las líneas no entran, el encabezado se BORRA: un pedido vacío en BC no se
// puede lanzar y nadie sabría de dónde salió.
export async function bcCrearPedidoAbierto(input: { vendorNo: string; currencyCode?: string; lineas: LineaReplaceBc[] }): Promise<{ number: string; id: string; omitidas: string[]; avisoCC?: string }> {
  if (!input?.vendorNo) throw new Error("la orden no tiene el código de proveedor de BC (PROV-…)");
  const { lines, omitidas } = payloadReplaceLines(input.lineas ?? []);
  if (!lines.length) throw new Error(`ninguna línea de la orden es válida para BC${omitidas.length ? ` — ${omitidas.join("; ")}` : ""}`);
  const cid = await getStdCompanyId();
  const headerBody: Record<string, unknown> = { vendorNumber: input.vendorNo };
  const cur = (input.currencyCode ?? "").toUpperCase();
  if (cur && cur !== "CRC") headerBody.currencyCode = cur;
  const resH = await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders`, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(headerBody),
  });
  if (!resH.ok) throw new Error(`BC ${resH.status} al crear el pedido: ${(await resH.text()).slice(0, 300)}`);
  const po: any = await resH.json().catch(() => ({}));
  const number = String(po?.number ?? "");
  try {
    if (!number) throw new Error("BC creó el pedido pero no devolvió su N.º");
    await bcReplaceOrderLines(number, input.lineas);
  } catch (e) {
    try { await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders(${po?.id})`, { method: "DELETE", cache: "no-store" }); }
    catch { /* best effort: si tampoco se puede borrar, queda el encabezado vacío */ }
    throw e;
  }
  // Dimensión Centro de Costo = obra, en el encabezado: es la que mete el pedido al
  // workflow de aprobación de BC. Se pone DESPUÉS de las líneas (el pedido sigue
  // Abierto) y NO es fatal: si falla, el pedido existe y sirve, pero se va a lanzar
  // sin pasar por el aprobador — eso hay que decirlo, no tragárselo.
  let avisoCC: string | undefined;
  const { cc: obra, mezcla } = centroCostoDeOrden(input.lineas ?? []);
  if (obra) {
    const err = await ponerCentroCosto(cid, String(po?.id ?? ""), obra);
    if (err) avisoCC = `El pedido ${number} se creó, pero NO se le pudo poner el Centro de Costo ${obra} (${err}): en BC no va a entrar al circuito de aprobación de Luis y quedaría listo para lanzar directo. Revisalo en BC.`;
    else if (mezcla.length) {
      // Cada línea lleva SU centro de costo; el del encabezado es uno solo y por eso
      // no representa a todas. Decirlo, que si no parece que toda la compra es de una.
      avisoCC = `El pedido ${number} mezcla ${mezcla.length} centros de costo (${mezcla.join(", ")}). Cada línea lleva el suyo; el encabezado quedó con ${obra}, que es el que dispara la aprobación en BC.`;
    }
  } else {
    // Sin centro de costo el pedido no entra al workflow que filtra por obra (sí al
    // que filtra por almacén, si el almacén es de los que lo exigen). Se avisa igual:
    // que se lance sin pasar por nadie no puede ser una sorpresa.
    avisoCC = `El pedido ${number} se creó SIN centro de costo (ninguna línea trae obra). En BC solo va a requerir aprobación si su almacén la exige.`;
  }
  return { number, id: String(po?.id ?? ""), omitidas, avisoCC };
}

// ¿Se crea el pedido en BC al enviar a aprobación? Sí, salvo que se apague con
// BC_CREAR_AL_ENVIAR=0. El interruptor existe por la otra app: si la de
// Producción también crea el pedido al aprobar, en BC quedan DOS por orden, y
// eso hay que poder apagarlo desde Azure sin esperar un despliegue.
export function crearEnBcAlEnviar(): boolean {
  const v = (process.env.BC_CREAR_AL_ENVIAR ?? "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}

// BC se niega a TOCAR EL ENCABEZADO de un pedido lanzado, y los tres registros
// (recibir, recibir+facturar, facturar lo recibido) empiezan justo por ahí: N.º de
// factura del proveedor, fecha de registro y fecha del documento.
//
// Con el pedido en MONEDA EXTRANJERA eso revienta: al validar la fecha de registro,
// BC busca el tipo de cambio DE ESE DÍA y, si cambió respecto al del pedido,
// reescribe los importes de todas las líneas — y reescribir líneas sí exige el
// documento abierto:
//   "Status must be equal to 'Open' in Purchase Header … Current value is 'Released'"
// Un pedido en colones nunca lo pega (no hay tipo de cambio que recalcular), por eso
// apareció recién con la primera factura en dólares.
//
// El registro SÍ se puede hacer: lo que falta es reabrir el pedido. Se hace acá, se
// reintenta UNA vez, y `Purch.-Post` lo vuelve a lanzar al registrar. Si el reintento
// también falla, el mensaje avisa que el pedido quedó abierto en BC.
const BC_PIDE_ABIERTO = /Status must be equal to 'Open'|El estado debe ser igual a 'Abierto'/i;

/** ¿El error de BC es "este pedido tiene que estar Abierto"? (cubierto por tests) */
export function bcPideAbierto(textoDelError: string): boolean {
  return BC_PIDE_ABIERTO.test(textoDelError ?? "");
}

async function bcPostear(procedimiento: string, etiqueta: string, orderNo: string, body: Record<string, unknown>): Promise<string> {
  const cid = await getStdCompanyId();
  const url = `${odataRoot()}/${procedimiento}?company=${encodeURIComponent(cid)}`;
  const llamar = () => bcFetch(url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let res = await llamar();
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 400);
    if (!BC_PIDE_ABIERTO.test(txt)) throw new Error(`BC ${etiqueta} ${res.status}: ${txt.slice(0, 250)}`);
    await bcReopenPedido(orderNo);   // si esto falla, sube su propio error (dice qué pasó)
    res = await llamar();
    if (!res.ok) {
      const txt2 = (await res.text()).slice(0, 250);
      throw new Error(`BC ${etiqueta} ${res.status}: ${txt2} · OJO: el pedido ${orderNo} quedó ABIERTO en Business Central (se reabrió para reintentar).`);
    }
  }
  const d: any = await res.json().catch(() => ({}));
  return String(d?.value ?? "");
}

// Registra (Recibir + Facturar) una factura parcial del pedido en BC con todos sus
// movimientos contables, vía el web service custom AdelantePO_PostInvoice.
// lines = cantidades recibidas en ESTA factura por item ({itemNo, qty}).
export async function bcRegistrarFactura(
  orderNo: string,
  vendorInvoiceNo: string,
  lines: { itemNo: string; qty: number; variantCode?: string }[],
  postingDate = "", // fecha de registro (ISO yyyy-mm-dd). "" → BC usa la fecha del día
  // Cargo de transporte de ESTA factura/viaje (opcional). Se agrega a la OC y se
  // reparte entre lo que se recibe en este registro, según `metodo`.
  cargo?: { itemChargeNo: string; descripcion?: string; monto: number; metodo?: string },
): Promise<string> {
  if (!orderNo) throw new Error("Falta el número de pedido de BC.");
  if (!vendorInvoiceNo) throw new Error("Falta el N.º de factura del proveedor.");
  // Cargo de transporte por viaje: se agrega la línea de Cargo (Prod.) a la OC y se
  // asigna con el método elegido ANTES de registrar (para que quede repartido en
  // esta factura sobre lo recibido). Debe ir antes del PostInvoice.
  if (cargo && cargo.itemChargeNo && cargo.monto > 0) {
    await bcAddChargeLine(orderNo, cargo.itemChargeNo, cargo.descripcion || "Transporte", 1, cargo.monto);
    try { await bcAssignItemCharges(orderNo, (cargo.metodo || "Amount").trim() || "Amount"); }
    catch (e) { console.warn(`BC asignar cargo de transporte en ${orderNo} falló:`, e); }
  }
  return (await bcPostear("AdelantePO_PostInvoice", "registrar", orderNo,
    { orderNo, vendorInvoiceNo, linesJson: JSON.stringify(lines), postingDate })) || "Registrado";
}

// MODO 2 — Solo RECEPCIÓN (material llega bien, la factura queda en revisión).
// Registra la recepción en BC (Receive=true, Invoice=false) vía AdelantePO_PostReceipt.
// Mueve inventario/cantidad recibida sin tocar la factura ni el ledger del proveedor.
export async function bcRecibir(orderNo: string, lines: { itemNo: string; qty: number; variantCode?: string }[], postingDate = ""): Promise<string> {
  if (!orderNo) throw new Error("Falta el número de pedido de BC.");
  return (await bcPostear("AdelantePO_PostReceipt", "recibir", orderNo,
    { orderNo, linesJson: JSON.stringify(lines), postingDate })) || "Recibido";
}

// MODO 2 — Solo FACTURA de lo ya recibido (Kattya revisa y registra después).
// Factura en BC lo que estaba recibido-no-facturado (Receive=false, Invoice=true)
// vía AdelantePO_PostInvoiceOfReceived.
export async function bcFacturarRecibido(orderNo: string, vendorInvoiceNo: string, lines: { itemNo: string; qty: number; variantCode?: string }[], postingDate = ""): Promise<string> {
  if (!orderNo) throw new Error("Falta el número de pedido de BC.");
  if (!vendorInvoiceNo) throw new Error("Falta el N.º de factura del proveedor.");
  return (await bcPostear("AdelantePO_PostInvoiceOfReceived", "facturar", orderNo,
    { orderNo, vendorInvoiceNo, linesJson: JSON.stringify(lines), postingDate })) || "Facturado";
}

// Crea una línea de Cargo de producto (Item Charge) en un pedido, vía el codeunit
// AdelantePO_AddChargeLine. La API ESTÁNDAR se traga la línea de cargo sin avisar,
// así que las líneas de cargo van SIEMPRE por acá (las de artículo siguen por la
// API estándar). Es idempotente por itemChargeNo (no duplica si se reintenta).
export async function bcAddChargeLine(orderNo: string, itemChargeNo: string, description: string, quantity: number, directUnitCost: number): Promise<string> {
  if (!orderNo) throw new Error("Falta el número de pedido para el cargo.");
  if (!itemChargeNo) throw new Error("Falta el tipo de cargo (itemChargeNo).");
  // Agregar una línea a un pedido LANZADO también exige reabrirlo: mismo camino.
  return (await bcPostear("AdelantePO_AddChargeLine", "add cargo", orderNo,
    { orderNo, itemChargeNo, description, quantity: quantity > 0 ? quantity : 1, directUnitCost })) || "Agregado";
}

// Sugerir/aplicar la asignación de los Cargos de producto de un pedido con un
// método (Amount|Weight|Volume|Equally), vía el codeunit AdelantePO_AssignItemCharges.
export async function bcAssignItemCharges(orderNo: string, metodo = "Amount"): Promise<string> {
  if (!orderNo) throw new Error("Falta el número de pedido para asignar cargos.");
  const cid = await getStdCompanyId();
  const url = `${odataRoot()}/AdelantePO_AssignItemCharges?company=${encodeURIComponent(cid)}`;
  const res = await bcFetch(url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo, metodo }),
  });
  if (!res.ok) throw new Error(`BC asignar cargos ${res.status}: ${(await res.text()).slice(0, 250)}`);
  const d: any = await res.json().catch(() => ({}));
  return d?.value ?? "Asignado";
}

export type ReceiptLineRef = { documentNo: string; lineNo: number };

// Registra en BC un Cargo de producto (flete/transporte facturado por un TERCERO)
// contra líneas de recepciones YA REGISTRADAS. En un solo codeunit server-side
// (AdelantePO_PostChargeOnReceipts) hace todo el flujo de las capturas: crea un
// pedido de compra al proveedor del cargo con UNA sola línea "Cargo (Prod.)",
// "trae" las líneas de recepción indicadas, sugiere el reparto con `metodo`, fija
// el N.º de factura del proveedor y REGISTRA. Devuelve el nº de factura registrada.
export async function bcPostChargeOnReceipts(input: {
  chargeVendorNo: string;      // proveedor del cargo (transportista)
  vendorInvoiceNo: string;     // N.º factura proveedor (obligatorio para registrar)
  itemChargeNo?: string;       // tipo de cargo (Item Charge). Alias UI: chargeNo
  chargeNo?: string;
  chargeAmount?: number;       // importe TOTAL del cargo. Si no viene: precio × cantidad
  cantidad?: number;
  precio?: number;
  metodo?: string;             // Amount | Equally | Weight | Volume
  receiptLines: ReceiptLineRef[]; // líneas de recepción destino
  documentDate?: string;       // fecha de emisión (ISO yyyy-mm-dd) → Posting/Document Date. "" = hoy
  // NOTA: currencyCode lo resuelve BC por el proveedor del cargo (no se envía).
}): Promise<string> {
  const itemChargeNo = (input.itemChargeNo ?? input.chargeNo ?? "").trim();
  const chargeAmount = (input.chargeAmount != null && input.chargeAmount > 0)
    ? input.chargeAmount
    : (input.precio ?? 0) * (input.cantidad && input.cantidad > 0 ? input.cantidad : 1);
  if (!input.chargeVendorNo) throw new Error("Falta el proveedor del cargo.");
  if (!input.vendorInvoiceNo) throw new Error("Falta el N.º de factura del proveedor.");
  if (!itemChargeNo) throw new Error("Falta el tipo de cargo de producto.");
  if (!(chargeAmount > 0)) throw new Error("El importe del cargo debe ser mayor que 0.");
  const lines = (input.receiptLines ?? []).filter((l) => l.documentNo && l.lineNo > 0);
  if (!lines.length) throw new Error("Seleccioná al menos una línea de recepción para asignar el cargo.");
  const cid = await getStdCompanyId();
  const url = `${odataRoot()}/AdelantePO_PostChargeOnReceipts?company=${encodeURIComponent(cid)}`;
  // El JSON mapea 1:1 a los parámetros del codeunit: NO agregar campos de más.
  const body = {
    chargeVendorNo: input.chargeVendorNo,
    itemChargeNo,
    chargeAmount,
    vendorInvoiceNo: input.vendorInvoiceNo,
    metodo: (input.metodo ?? "Amount"),
    receiptLinesJson: JSON.stringify(lines),
    postingDate: input.documentDate ?? "", // "" → BC usa la fecha del día (Today)
  };
  const res = await bcFetch(url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`BC cargo sobre recibido ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const d: any = await res.json().catch(() => ({}));
  return d?.value ?? "Registrado";
}

// Base de un deep link a BC apuntando a una `page` con un `filtro` OData de la UI.
//
// NUNCA lanza: devuelve "" si no se puede resolver el entorno. Un deep link es una
// comodidad ("Abrir en BC"), y `mapOrden` lo arma para CADA orden con bcNo — cuando
// esto tiraba excepción, faltar una variable de BC no dejaba a la app sin el botón:
// reventaba el bootstrap entero y la pantalla salía SIN DATOS. Las llamadas de
// verdad a BC sí siguen fallando fuerte, que es donde hay que enterarse.
function bcDeepLink(page: number, filtro: string): string {
  let tenant: string, environment: string;
  try { ({ tenant, environment } = tenantYEntorno()); }
  catch (e) { console.warn("bcDeepLink: sin config de BC, se omite el link:", e); return ""; }
  const company = process.env.BC_COMPANY || "ADELANTE_DESARROLLOS_NUEVA";
  return `https://businesscentral.dynamics.com/${tenant}/${environment}?company=${encodeURIComponent(company)}&page=${page}&filter=${encodeURIComponent(filtro)}`;
}

// Deep link al Pedido de compra en BC (Purchase Orders, page 9307), por su N.º.
export function bcDeepLinkPedido(numero: string): string {
  return bcDeepLink(9307, `'No.' IS '${numero}'`);
}

// Deep link a las Facturas de compra REGISTRADAS de BC (Posted Purchase Invoices,
// page 146), filtradas por el N.º del pedido que las originó — para que Contabilidad
// vea contra cuál factura hacer la nota de crédito.
export function bcDeepLinkFacturaRegistrada(orderNo: string): string {
  return bcDeepLink(146, `'Order No.' IS '${orderNo}'`);
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
    // Mismo resolutor que usa la app (no una copia con su propio default, que fue
    // justo lo que escondía el problema). Si la config está incompleta se REPORTA y
    // se saltan las sondas: este endpoint es el que uno abre precisamente cuando la
    // config está mal, así que no puede caerse por eso.
    let entorno: { tenant: string; environment: string } | null = null;
    try { entorno = tenantYEntorno(); }
    catch (e: any) { out.diag.entornoError = String(e?.message ?? e); }
    out.diag.environment = entorno?.environment ?? null;
    // Las sondas necesitan tenant+entorno. Sin ellos no se inventa ninguno: se
    // reporta en diag.entornoError y el resto del diagnóstico sigue igual.
    if (entorno) {
      const base = `https://api.businesscentral.dynamics.com/v2.0/${entorno.tenant}/${entorno.environment}`;
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
    }
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
