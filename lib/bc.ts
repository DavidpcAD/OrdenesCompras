// Cliente de Business Central (SaaS) por OAuth client-credentials (S2S),
// usando las APIs PERSONALIZADAS de Adelante (publisher 'adelante', v1.0):
//   - Items:  grupo 'inventory'  -> entitySet 'items'   (page 50125 ItemAPI)
//   - Obras:  grupo 'project'     -> entitySet 'jobs'    (page 50170 JobAPI)
// La compañía sale de BC_COMPANY_ID (GUID). El tenant/environment se deducen
// de BC_BASE_URL (o de BC_TENANT_ID/BC_ENVIRONMENT).

import type { OrdenLinea } from "./types";
import { claveVariante } from "./variantes.ts";
import { codigoDeItem } from "./unidad.ts";
import { cotejarLineas, type Cotejo, type LineaApp, type LineaBc } from "./bc-conciliacion.ts";

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
// IVA REAL por línea, tal como lo va a contabilizar BC: código de artículo (o de
// cargo) → % de IVA.
//
// Hace falta porque el IVA% que se escribe en la app NO viaja a BC: allá se calcula
// cruzando el grupo de IVA del proveedor con el del artículo. Cuando los dos no
// coinciden, el estimado de la app —y con él el total del PDF que ve el proveedor y
// el que aprueba— queda corto o largo (CP-005254: la app decía IVA 0 y BC cobra 13%
// del artículo, ₡1.270,16 de diferencia). Con esto la app puede adoptar el de BC.
export async function bcIvaDeLineasOrden(orderNo: string): Promise<Record<string, number> | null> {
  if (!orderNo) return null;
  try {
    const cid = await getStdCompanyId();
    // Las líneas de la API estándar cuelgan del pedido por su GUID, no por el N.º.
    const filtro = `$filter=${encodeURIComponent(`number eq '${odataStr(orderNo)}'`)}&$select=id&$top=1`;
    const res = await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders?${filtro}`, { cache: "no-store" });
    if (!res.ok) return null;
    const id = ((await res.json())?.value ?? [])[0]?.id;
    if (!id) return null;
    const resL = await bcFetch(
      `${stdRoot()}/companies(${cid})/purchaseOrders(${id})/purchaseOrderLines?$select=lineType,lineObjectNumber,description,taxPercent`,
      { cache: "no-store" });
    if (!resL.ok) return null;
    const out: Record<string, number> = {};
    for (const l of ((await resL.json())?.value ?? [])) {
      // `lineObjectNumber` es el N.º de artículo en las líneas Item y el N.º de
      // cargo en las Charge — los dos códigos con los que la app arma sus líneas.
      const code = String(l?.lineObjectNumber ?? "").trim().toUpperCase();
      const pct = Number(l?.taxPercent);
      if (!code || !Number.isFinite(pct)) continue;
      out[code] = pct;
    }
    return out;
  } catch { return null; }
}

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

// ── LAS LÍNEAS DEL PEDIDO EN BC, PARA COTEJARLAS CONTRA LA ORDEN ─────────────
// La app escribía a BC y nunca volvía a mirar. Así se perdió una línea entera de
// CP-005172 (₡22.820 de tornillos que el proveedor facturó y BC nunca registró):
// el pedido se creó con 6 de 7 líneas y nadie lo supo hasta ver el papel.
//
// Se lee por la API CUSTOM `purchaseLines` (page 50174, ya publicada, filtrada a
// Document Type = Order), que es la única que devuelve el CÓDIGO de variante —la
// estándar `purchaseOrderLines` solo trae el GUID del itemVariant, y sin el código
// no se puede cotejar una línea con variante contra la orden.
//
// `fuente` dice con qué se comparó, porque cambia lo que se puede afirmar:
//   "custom"   → completo (incluye variante).
//   "estandar" → sin variante: sirve para ver si FALTA una línea, no para
//                distinguir dos variantes del mismo material.
//   null en `lineas` → no se pudo leer (BC caído, API no publicada, pedido que ya
//                no existe). NUNCA se devuelve [] en ese caso: una lista vacía
//                significaría "BC no tiene nada" y eso sí sería una acusación.
// `status` y `vendorNo` solo vienen por el codeunit (AdelantePO_GetOrderLines): son
// el ESTADO REAL del pedido y su Buy-from Vendor No., que ninguna otra lectura da.
// Van acá porque llegan GRATIS en la misma respuesta con la que se cotejan las
// líneas — hasta el 3 sep 2026 se descartaban al parsear, y por eso la app nunca
// supo que un pedido seguía Abierto en BC (CP-005143) ni que había cambiado de
// proveedor (CP-005183). Quedan opcionales: los otros dos caminos no los traen.
export type BcLineasPedido = { lineas: LineaBc[]; fuente: "custom" | "estandar"; status?: string; vendorNo?: string; };

// El Status del pedido, normalizado. `Format(PurchHeader.Status)` viaja en el
// IDIOMA DE LA SESIÓN del web service (igual que el tipo de línea, ver abajo), así
// que llega "Open" o "Abierto" según quién pregunte: comparar contra un solo texto
// sería un freno que funciona hoy y se rompe el día que cambie el idioma.
export type EstadoBcPedido = "abierto" | "lanzado" | "pendiente-aprobacion" | "desconocido";
export function estadoLanzamientoBc(status?: string): EstadoBcPedido {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return "desconocido";
  if (s.startsWith("open") || s.startsWith("abierto")) return "abierto";
  if (s.startsWith("released") || s.startsWith("lanzado")) return "lanzado";
  if (s.includes("approval") || s.includes("aprobaci")) return "pendiente-aprobacion";
  return "desconocido";
}

// El tipo de línea llega de tres fuentes distintas y ninguna promete el mismo texto:
// la API estándar manda "Item"/"Charge", la custom manda el enum formateado y el
// codeunit manda el CAPTION EN EL IDIOMA DE LA SESIÓN ("Producto", "Cargo (prod.)").
// Por eso se acepta también el número del enum de BC (2 = Item, 5 = Charge (Item)),
// que es lo único estable — y por eso GetOrderLines manda `typeNo`.
function tipoLineaBc(t: unknown, typeNo?: unknown): "articulo" | "cargo" | "otro" {
  const n = Number(typeNo);
  if (Number.isFinite(n) && n > 0) {
    if (n === 2) return "articulo";
    if (n === 5) return "cargo";
    return "otro";
  }
  const s = String(t ?? "").trim().toLowerCase().replace(/[\s_.\-()]/g, "");
  if (s === "item" || s === "articulo" || s === "artículo" || s === "producto" || s === "2") return "articulo";
  if (s.startsWith("charge") || s.startsWith("cargo") || s === "5") return "cargo";
  return "otro";
}

export async function bcLineasPedido(orderNo: string): Promise<BcLineasPedido | null> {
  const no = (orderNo ?? "").trim();
  if (!no) return null;

  // 1) API custom de Adelante (la buena: trae variantCode y las cantidades ya
  //    recibidas/facturadas, que es lo que hace falta para frenar una recepción).
  try {
    const rows = await listCustom(
      "purchasing",
      `purchaseLines?$filter=${encodeURIComponent(`documentNo eq '${odataStr(no)}'`)}&$orderby=lineNo`,
    );
    // CERO líneas NO significa "el pedido está vacío": un $filter contra un pedido
    // que ya no existe devuelve exactamente lo mismo, y BC BORRA el pedido cuando se
    // recibe y factura todo. Tratar las dos cosas igual sería catastrófico: toda
    // orden completada diría "a BC le faltan las 7 líneas" y, peor, el freno de
    // Bodega bloquearía el diálogo de conciliación (el que sirve justo cuando BC ya
    // registró la factura). Se confirma con una consulta barata antes de afirmar nada.
    if (!rows.length) {
      // Un pedido que existe NO puede tener cero líneas: o BC lo borró (y entonces no
      // hay nada que cotejar), o esta lectura no está mirando lo mismo que la escritura
      // — la API custom resuelve la compañía por otro camino que la estándar, con la que
      // la app CREA el pedido. Ante la duda no se acusa: se baja al siguiente camino,
      // que usa la misma resolución de compañía que la escritura.
      if ((await bcEstadoDelPedido(no)) !== "existe") return null;
      throw new Error("purchaseLines devolvió 0 líneas para un pedido que sí existe");
    }
    return {
      fuente: "custom",
      lineas: rows.map((r: any) => ({
        documentNo: String(r.documentNo ?? no),
        lineNo: Number(r.lineNo ?? 0) || 0,
        tipo: tipoLineaBc(r.type),
        itemNo: String(r.no ?? "").trim(),
        variantCode: String(r.variantCode ?? "").trim(),
        descripcion: String(r.description ?? "").trim(),
        unidad: String(r.unitOfMeasureCode ?? "").trim(),
        almacen: String(r.locationCode ?? "").trim(),
        cantidad: Number(r.quantity ?? 0) || 0,
        recibida: Number(r.quantityReceived ?? 0) || 0,
        facturada: Number(r.quantityInvoiced ?? 0) || 0,
        pendiente: Number(r.outstandingQuantity ?? 0) || 0,
        precioUnitario: Number(r.directUnitCost ?? 0) || 0,
      })),
    };
  } catch { /* la custom puede no estar publicada en este entorno: se sigue probando */ }

  // 1-bis) El codeunit (AdelantePO_GetOrderLines, desde 1.2.6.0). Es el MISMO canal
  // por el que la app escribe las líneas, así que si escribir funciona, leer también:
  // no depende de que la página API esté publicada ni permisada.
  try {
    const cid = await getStdCompanyId();
    const res = await bcFetch(`${odataRoot()}/AdelantePO_GetOrderLines?company=${encodeURIComponent(cid)}`, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNo: no }),
    });
    if (res.ok) {
      const d: any = await res.json().catch(() => ({}));
      const payload = JSON.parse(String(d?.value ?? "{}"));
      // Mismo cuidado que arriba: sin líneas, primero confirmar que el pedido existe.
      // (Acá el codeunit ya falla si no existe —GetOrder hace Error—, pero el día que
      // eso cambie no puede convertirse en una acusación silenciosa.)
      if (!(payload?.lines ?? []).length) {
        if ((await bcEstadoDelPedido(no)) !== "existe") return null;
        throw new Error("GetOrderLines devolvió 0 líneas para un pedido que sí existe");
      }
      return {
        fuente: "custom",
        // Los dos datos del ENCABEZADO que solo este canal entrega. Antes se perdían
        // acá mismo: el JSON los traía y el parseo se quedaba con `lines`.
        status: String(payload?.status ?? "").trim() || undefined,
        vendorNo: String(payload?.vendorNo ?? "").trim() || undefined,
        lineas: (payload?.lines ?? []).map((r: any) => {
          const cantidad = Number(r.quantity ?? 0) || 0;
          const recibida = Number(r.quantityReceived ?? 0) || 0;
          return {
            documentNo: String(payload?.orderNo ?? no),
            lineNo: Number(r.lineNo ?? 0) || 0,
            tipo: tipoLineaBc(r.type, r.typeNo),
            itemNo: String(r.no ?? "").trim(),
            variantCode: String(r.variantCode ?? "").trim(),
            descripcion: String(r.description ?? "").trim(),
            unidad: String(r.unitOfMeasureCode ?? "").trim(),
            almacen: String(r.locationCode ?? "").trim(),
            cantidad,
            recibida,
            facturada: Number(r.quantityInvoiced ?? 0) || 0,
            pendiente: Number(r.outstandingQuantity ?? Math.max(0, cantidad - recibida)) || 0,
            precioUnitario: Number(r.directUnitCost ?? 0) || 0,
          };
        }),
      };
    }
  } catch { /* último recurso: la API estándar */ }

  // 2) Red de seguridad: API estándar v2.0. No trae el código de variante, así que
  //    el cotejo que salga de acá tiene que ignorar la variante (lo dice `fuente`).
  try {
    const cid = await getStdCompanyId();
    const filtro = `$filter=${encodeURIComponent(`number eq '${odataStr(no)}'`)}&$select=id&$top=1`;
    const res = await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders?${filtro}`, { cache: "no-store" });
    if (!res.ok) return null;
    const id = ((await res.json())?.value ?? [])[0]?.id;
    if (!id) return null;   // el pedido no está en BC: eso lo reporta bcEstadoDelPedido
    // SIN $select a propósito: si uno solo de los campos no existe en la versión de la
    // API, BC contesta 400 y se pierde la lectura entera — o sea, la verificación se
    // apaga justo cuando es el último recurso. Se pide todo y se lee lo que venga.
    const resL = await bcFetch(
      `${stdRoot()}/companies(${cid})/purchaseOrders(${id})/purchaseOrderLines`,
      { cache: "no-store" });
    if (!resL.ok) return null;
    const filas = ((await resL.json())?.value ?? []);
    // Último camino: si acá tampoco hay líneas, el pedido existe pero no se pudo ver su
    // contenido. Se devuelve null ("no se pudo leer") en vez de una lista vacía, que
    // sería acusar a BC de no tener nada.
    if (!filas.length) return null;
    return {
      fuente: "estandar",
      lineas: filas.map((l: any) => {
        const cantidad = Number(l.quantity ?? 0) || 0;
        const recibida = Number(l.receivedQuantity ?? 0) || 0;
        return {
          documentNo: no,
          lineNo: Number(l.sequence ?? 0) || 0,
          tipo: tipoLineaBc(l.lineType),
          itemNo: String(l.lineObjectNumber ?? "").trim(),
          variantCode: "",
          descripcion: String(l.description ?? "").trim(),
          unidad: String(l.unitOfMeasureCode ?? "").trim(),
          almacen: "",
          cantidad,
          recibida,
          facturada: Number(l.invoicedQuantity ?? 0) || 0,
          pendiente: Math.max(0, cantidad - recibida),
          // El costo unitario se llama distinto según la versión de la API.
          precioUnitario: Number(l.unitCost ?? l.directUnitCost ?? 0) || 0,
        };
      }),
    };
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

// ---- Variantes de VARIOS ítems en una sola consulta ------------------------
//
// Las pantallas que muestran la variante (materiales solicitados, detalle de la
// solicitud, líneas de la orden) tienen decenas de líneas: preguntar ítem por ítem
// eran decenas de llamadas a BC por cada vez que se abría la pantalla. Se piden en
// lotes de 20 con un solo `$filter`.
const LOTE_VARIANTES = 20;

// Agrupa las filas de itemVariants por ítem. Devuelve null cuando la respuesta no
// dice a qué ítem pertenece cada fila: agrupar a ciegas sería repartir variantes
// entre materiales que no son (mejor "no se pudo" que un dato inventado).
//
// Con un lote de UN solo ítem sí se pueden atribuir todas las filas: la consulta
// preguntó por ese y nada más.
export function agruparVariantes(rows: any[], lote: string[]): Record<string, BcVariante[]> | null {
  const norm = (s: string) => s.trim().toUpperCase();
  const porItem: Record<string, BcVariante[]> = {};
  const indice = new Map<string, string>();
  for (const i of lote) { const k = i.trim(); if (k) { porItem[k] = []; indice.set(norm(k), k); } }
  const unico = Object.keys(porItem).length === 1 ? Object.keys(porItem)[0] : "";
  for (const v of rows ?? []) {
    const item = String(v?.itemNumber ?? v?.ItemNumber ?? v?.itemNo ?? v?.ItemNo ?? "").trim();
    const clave = item ? indice.get(norm(item)) : unico;
    if (!clave) {
      if (!item) return null;   // la respuesta no identifica el ítem y el lote es de varios
      continue;                 // vino un ítem que no se preguntó: se ignora
    }
    porItem[clave].push(...mapVariantes([v]));
  }
  return porItem;
}

async function variantesDeLote(lote: string[]): Promise<Record<string, BcVariante[]> | null> {
  const filtro = `$filter=${encodeURIComponent(lote.map((n) => `itemNumber eq '${n.replace(/'/g, "''")}'`).join(" or "))}`;

  // 1) API custom de Adelante, igual que bcVariantsEx.
  try {
    const cid = await getCompanyId();
    const res = await bcFetch(`${customRoot("inventory")}/companies(${cid})/itemVariants?${filtro}`, { cache: "no-store" });
    if (res.ok) { const g = agruparVariantes((await res.json()).value, lote); if (g) return g; }
  } catch { /* intenta la estándar */ }

  // 2) Fallback: API estándar v2.0.
  try {
    const cid = await getStdCompanyId();
    const res = await bcFetch(`${stdRoot()}/companies(${cid})/itemVariants?${filtro}`, { cache: "no-store" });
    if (res.ok) { const g = agruparVariantes((await res.json()).value, lote); if (g) return g; }
  } catch { /* ambas fallaron */ }

  console.warn(`BC variantes en lote falló para ${lote.length} ítem(s).`);
  return null;
}

export type BcVariantesLote = { porItem: Record<string, BcVariante[]>; disponible: boolean };

// Variantes de una lista de ítems. `disponible=false` significa que algún lote no se
// pudo consultar: la pantalla NO debe concluir "no tiene variantes" (mismo criterio
// que bcVariantsEx). Un lote que falla no se reintenta ítem por ítem a propósito:
// con 100 líneas en pantalla eso serían 100 llamadas a BC justo cuando está mal.
export async function bcVariantesDeItems(items: string[]): Promise<BcVariantesLote> {
  // El itemNo de una línea puede traer la variante pegada ("M11-0081 -VAR 12"): BC
  // solo conoce "M11-0081", así que se pregunta por el código pelado. Es la misma
  // normalización que hace la clave de los documentos (`claveVariante`), y sin ella
  // el PDF quedaba sin el nombre justo en las líneas que sí tienen variante.
  const unicos = [...new Set((items ?? []).map((i) => codigoDeItem(i ?? "")).filter(Boolean))];
  if (!unicos.length) return { porItem: {}, disponible: true };
  const porItem: Record<string, BcVariante[]> = {};
  let disponible = true;
  for (let i = 0; i < unicos.length; i += LOTE_VARIANTES) {
    const lote = unicos.slice(i, i + LOTE_VARIANTES);
    const g = await variantesDeLote(lote);
    if (!g) { disponible = false; continue; }
    Object.assign(porItem, g);
    // Alimenta la caché de "último resultado bueno" que usa bcVariantsEx cuando BC
    // parpadea: lo que ya se preguntó en lote no hay que volver a preguntarlo suelto.
    for (const [item, vs] of Object.entries(g)) lastGoodVariants.set(item, { variantes: vs, disponible: true });
  }
  return { porItem, disponible };
}

// Nombre de cada variante, con la clave que usan los documentos ("ITEM|CODE" →
// "ZAPATO … NO. 42"). Es lo que se imprime al lado del material en el PDF de
// cotización y en el de la orden.
export async function bcNombresDeVariante(items: string[]): Promise<Record<string, string>> {
  const { porItem } = await bcVariantesDeItems(items);
  const out: Record<string, string> = {};
  for (const [item, vs] of Object.entries(porItem)) {
    for (const v of vs) {
      const code = (v.code ?? "").trim();
      if (code) out[claveVariante(item, code)] = (v.descripcion ?? "").trim();
    }
  }
  return out;
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

// Líneas de artículo SIN almacén (locationCode). Es el único de los tres que BC NO
// castiga: el pedido se crea, se lanza y se registra igual, y el material no entra a
// ningún lado. Nadie se entera hasta que alguien busca el stock y no está — o hasta
// que Proveeduría tiene que arreglarlo en BC, y lo arregla BORRANDO el pedido y
// creando otro. Ahí la orden de la app queda apuntando a un número que ya no existe
// y no hay cómo re-apuntarla (CP-004719 → CP-005200, ago 2026).
//
// Se corre sobre el resultado de `lineasOrdenParaBc`, o sea con el default de
// BC_RECEPCION_LOCATION YA aplicado: si igual llega vacío es que no hay a dónde caer,
// ni en la línea ni en la configuración. Ahí no se manda nada a BC. (Cubierto por tests.)
export function lineasSinAlmacen(lineas: LineaReplaceBc[]): string[] {
  return (lineas ?? [])
    .filter((l) => l.tipo !== "cargo" && (l.itemNo ?? "").trim() && !(l.locationCode ?? "").trim())
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

// ---- Por qué dijo NO Business Central ------------------------------------
//
// Cuando BC rechaza un registro hay dos mundos, y la app los trataba igual
// ("la orden queda por recibir para reintentar"):
//
//  · REINTENTABLE — periodo cerrado, permisos, BC caído, un dato de la línea.
//    Reintentar sirve.
//  · YA ESTÁ HECHO ALLÁ — reintentar no va a servir NUNCA. Son dos:
//      1. "Purchase Invoice 586265 already exists for this vendor": el chequeo
//         estándar de N.º de factura de proveedor repetido. BC ya la registró.
//      2. "Pedido de compra CP-005148 no encontrado en BC": el PurchHeader.Get
//         de nuestros codeunits. Cuando un pedido se recibe y factura COMPLETO,
//         `Purch.-Post` BORRA el pedido de compra (queda la recepción y la
//         factura registradas), así que el pedido ausente suele significar
//         justamente que ya se registró todo.
//
//    En los dos casos el material YA entró en BC y la app se quedaba con la
//    orden "por recibir" para siempre, mandando a Bodega a reintentar contra una
//    pared. Caso real: CP-005148 y la factura 586265, 28 ago 2026.
const BC_FACTURA_DUPLICADA = /already exists for this vendor|ya existe para este proveedor/i;
const BC_SIN_PEDIDO = /no encontrado en BC|not found in BC|pedido de compra .{0,40}no (?:encontrado|existe)/i;

export type FalloRegistroBc = "factura-duplicada" | "pedido-no-existe" | "reintentable";

/** Qué clase de "no" dijo BC, leyendo su respuesta. (cubierto por tests) */
export function clasificarFalloBc(textoDelError: string): FalloRegistroBc {
  const t = textoDelError ?? "";
  if (BC_FACTURA_DUPLICADA.test(t)) return "factura-duplicada";
  if (BC_SIN_PEDIDO.test(t)) return "pedido-no-existe";
  return "reintentable";
}

// ---- El "no" por DIMENSIONES (el CC amarrado al almacén) -------------------
//
// CP-005293, 3 sep 2026. BC rechazó el registro con:
//
//   "The dimensions used in Order CP-005293, line no. 10000 are invalid.
//    The Dimension Value Code must be F-MUEBLES for Dimension Code CC for
//    Location F-MUEBLES. Currently it's VN-L.34."
//
// Traducido: la UBICACIÓN F-MUEBLES tiene en BC una dimensión predeterminada
// CC = F-MUEBLES con registro de valores "Igual código", o sea que toda línea que
// entre a ese almacén está obligada a llevar ESE valor de CC y ningún otro. La app
// le manda el CC de la OBRA (ver dimensionDeLinea), y los dos no pueden convivir.
//
// Lo caro no es el rechazo: es CUÁNDO llega. BC no valida esa combinación al crear
// la línea ni al lanzar el pedido, solo AL REGISTRAR — el pedido se creó bien,
// Aprobación lo lanzó bien, y el "no" le aparece a Bodega con el camión en la puerta.
//
// Y contra este "no" REINTENTAR NO SIRVE NUNCA: no es un parpadeo de BC ni un dato
// de la factura, es configuración de dimensiones. Cada reintento da exactamente el
// mismo error. Por eso se detecta y se explica en vez de caer en "la orden queda por
// recibir para reintentar", que era lo único que la pantalla sabía decir.
const BC_DIMENSIONES_INVALIDAS =
  /dimensions used in .{0,120}?\bare invalid|dimensiones (?:utilizadas|usadas) en .{0,120}?no son v[áa]lidas/i;

// Lo que BC alcanzó a decir del choque. Los campos van vacíos cuando el texto no se
// pudo desarmar (BC contesta en el idioma de la sesión del web service, así que el
// mensaje llega en inglés o en español según quién pregunte): el aviso tiene que
// servir igual, aunque sea sin los detalles.
export type ConflictoDimensiones = {
  lineNo: string;     // "10000"    — la línea DEL PEDIDO EN BC, no la de la app
  dimension: string;  // "CC"       — qué dimensión choca
  debeSer: string;    // "F-MUEBLES"— el valor que BC exige
  actual: string;     // "VN-L.34"  — el que lleva la línea (el de la obra)
  porQue: string;     // "Location F-MUEBLES" — quién impone la obligación
};

// El "for <algo>" y el "Currently it's <valor>" se cortan con `. ` y no con el
// primer punto: hay códigos CON punto adentro (la obra VN-L.34, la bodega VN-M.28),
// y cortar en el punto los partía a la mitad.
const DIM_LINEA = /(?:line no\.?\s*|n\.?[ºo°]?\s*de l[íi]nea\s*|l[íi]nea n\.?[ºo°]?\s*)(\d+)/i;
const DIM_DEBE = /must be\s+(\S+?)\s+for\s+Dimension\s+Code\s+(\S+?)\s+for\s+(.+?)\.\s*(?:Currently|CorrelationId|$)/i;
const DIM_DEBE_ES = /debe ser\s+(\S+?)\s+para (?:el )?c[óo]digo de dimensi[óo]n\s+(\S+?)\s+para\s+(.+?)\.\s*(?:Actualmente|CorrelationId|$)/i;
const DIM_ACTUAL = /(?:Currently it'?s|Actualmente es)\s+([^\s.]+(?:\.[^\s.]+)*)/i;

/**
 * ¿El "no" de BC es un choque de dimensiones? Devuelve lo que se le pudo sacar al
 * mensaje, o null si es otra cosa. (cubierto por tests)
 */
export function conflictoDeDimensiones(textoDelError: string): ConflictoDimensiones | null {
  const t = textoDelError ?? "";
  if (!BC_DIMENSIONES_INVALIDAS.test(t)) return null;
  const debe = DIM_DEBE.exec(t) ?? DIM_DEBE_ES.exec(t);
  return {
    lineNo: DIM_LINEA.exec(t)?.[1] ?? "",
    dimension: debe?.[2] ?? "",
    debeSer: debe?.[1] ?? "",
    actual: DIM_ACTUAL.exec(t)?.[1] ?? "",
    porQue: (debe?.[3] ?? "").trim(),
  };
}

// BC nombra al culpable con su propia palabra y en su propio idioma ("Location
// F-MUEBLES"). Acá se dice en castellano: el aviso lo lee Bodega, no un consultor.
const QUIEN_OBLIGA: [RegExp, string][] = [
  [/^(?:Location|Ubicaci[óo]n)\s+/i, "el almacén "],
  [/^(?:Item|Art[íi]culo)\s+/i, "el artículo "],
  [/^(?:Vendor|Proveedor)\s+/i, "el proveedor "],
  [/^(?:Job|Proyecto|Obra)\s+/i, "la obra "],
];

/**
 * El choque contado para quien está en la pantalla: qué no le gustó a BC y qué hay
 * que hacer (que NO es reintentar). Sin el verbo del principio — ese lo pone cada
 * ruta, porque no es lo mismo "NO se recibió" que "NO se facturó". (cubierto por tests)
 */
export function explicarConflictoDimensiones(c: ConflictoDimensiones, orderNo = ""): string {
  const donde = [
    c.lineNo ? `la línea ${c.lineNo}` : "una línea",
    orderNo ? `del pedido ${orderNo}` : "",
  ].filter(Boolean).join(" ");
  let quien = c.porQue;
  for (const [en, es] of QUIEN_OBLIGA) if (en.test(quien)) { quien = quien.replace(en, es); break; }
  const choque = c.dimension && c.debeSer
    ? `${quien || "su almacén"} obliga a que la dimensión ${c.dimension} sea ${c.debeSer}`
      + (c.actual ? `, y la línea lleva ${c.actual}` : "")
    : "las dimensiones de la línea no son las que exige su almacén";
  return `Business Central no acepta las dimensiones de ${donde}: ${choque}.\n\n`
    + `Esto NO se arregla reintentando: es configuración de dimensiones en Business Central, `
    + `y cada intento va a dar el mismo error. Se corrige allá — o quitándole el "Igual código" `
    + `a la dimensión predeterminada que lo obliga, o dejando en la línea el valor que BC exige. `
    + `Avisale a Proveeduría. Nada se guardó.`;
}

export type BcPedidoEstado = "existe" | "no-existe" | "sin-respuesta";

// ¿Existe el pedido de compra en BC? Distingue "no está" de "BC no contesta",
// que es la diferencia entre "esto ya se registró / el N.º apunta a nada" y
// "volvé a intentar en un rato" (mismo criterio que /api/bc/orden-totales).
export async function bcEstadoDelPedido(orderNo: string): Promise<BcPedidoEstado> {
  if (!(orderNo ?? "").trim()) return "no-existe";
  try {
    const cid = await getStdCompanyId();
    const filtro = `$filter=${encodeURIComponent(`number eq '${odataStr(orderNo.trim())}'`)}&$select=number&$top=1`;
    const res = await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders?${filtro}`, { cache: "no-store" });
    if (!res.ok) return "sin-respuesta";
    const d: any = await res.json().catch(() => ({}));
    // La consulta contestó 200: si el pedido no vino, no está. No hace falta
    // sondear /companies como en orden-totales (ahí el 200 no era observable).
    return (d?.value ?? []).length ? "existe" : "no-existe";
  } catch {
    return "sin-respuesta";
  }
}

// ── ARTÍCULOS BLOQUEADOS EN BC ───────────────────────────────────────────────
// Un artículo con "Bloqueado" marcado NO se puede comprar: BC rechaza la línea al
// insertarla en el pedido. Y ahí está la causa REAL, verificada, de la línea que se
// perdió en CP-005172: `M06-0116 TORNILLO P/GYP 1-1/4 P FINA` estaba bloqueado en BC
// desde el 14/08/2026 — once días antes de la orden. BC rechazó esa línea, quien la
// creó siguió con las demás, y el pedido se lanzó con 6 de 7 líneas.
//
// El catálogo de la app ya esconde los bloqueados (bcItemsPagina/bcItems los filtran),
// pero eso no alcanza: la línea puede venir de una SOLICITUD de Ingeniería hecha antes
// del bloqueo, o el artículo puede bloquearse después de armada la orden. El único
// momento que sirve para preguntarlo es justo antes de mandar el pedido a BC.
//
// Devuelve los artículos bloqueados que trae la orden (vacío = todo en orden). Si BC
// no contesta devuelve vacío: no se traba una orden por una consulta que falló.
export async function itemsBloqueadosDeLineas(lineas: LineaReplaceBc[]): Promise<string[]> {
  const codigos = [...new Set((lineas ?? [])
    .filter((l) => l.tipo !== "cargo")
    .map((l) => codigoDeItem(String(l.itemNo ?? "")).trim().toUpperCase())
    .filter(Boolean))];
  if (!codigos.length) return [];
  const bloqueados = new Set<string>();
  try {
    const cid = await getCompanyId();
    // De a 20 por consulta: el $filter va en la URL y con una orden de 30 líneas se
    // pasa de largo.
    for (let i = 0; i < codigos.length; i += 20) {
      const trozo = codigos.slice(i, i + 20);
      const filtro = trozo.map((c) => `No eq '${odataStr(c)}'`).join(" or ");
      const url = `${customRoot("inventory")}/companies(${cid})/items?$filter=${encodeURIComponent(filtro)}&$select=No,Description,Blocked`;
      const res = await bcFetch(url, { cache: "no-store" });
      if (!res.ok) return [];
      for (const it of ((await res.json())?.value ?? [])) {
        if (it?.Blocked ?? it?.blocked) {
          const no = String(it.No ?? it.no ?? "").trim();
          const desc = String(it.Description ?? it.description ?? "").replace(/ /g, " ").trim();
          bloqueados.add(desc ? `${no} (${desc})` : no);
        }
      }
    }
  } catch { return []; }
  return [...bloqueados];
}

// ── LA PARED: la orden de la app contra el pedido de BC ──────────────────────
// Se llama en los tres momentos en que la app y BC se pueden separar:
//   1. al CREAR el pedido (enviar a aprobación) — ahí es gratis arreglarlo;
//   2. al GUARDAR una orden que ya vive en BC;
//   3. antes de RECIBIR/FACTURAR — ahí ya es plata.
//
// `estado`:
//   "ok"           → las líneas coinciden. Es lo único que autoriza a seguir.
//   "desalineado"  → coinciden en parte: `cotejo.diferencias` dice exactamente qué.
//   "sin-pedido"   → BC contestó y NO tiene ese pedido. Ojo: en una orden COMPLETADA
//                    esto es NORMAL (al registrarlo todo, BC borra el pedido), y por
//                    eso quien llama tiene que mirar el estado de la orden antes de
//                    gritar. Ver `chequeoAplica`.
//   "sin-lectura"  → no se pudo leer BC (caído, sin permiso, API no publicada). NO
//                    es lo mismo que "está mal": no se afirma nada.
export type EstadoChequeoBc = "ok" | "desalineado" | "sin-pedido" | "sin-lectura";
export type ChequeoBc = {
  estado: EstadoChequeoBc;
  fuente?: "custom" | "estandar";
  cotejo?: Cotejo;
  // El cotejo del ENCABEZADO: ¿el pedido de allá sigue siendo del mismo proveedor?
  // `verificado:false` = no se pudo mirar (no es que esté bien).
  proveedor?: FrenoProveedor;
  // El estado REAL del pedido en BC ("desconocido" si la lectura no lo trajo).
  estadoBc?: EstadoBcPedido;
  mensaje: string;
  // Fecha en que se hizo (la pone quien lo guarda; acá no se inventan relojes).
};

// Traduce las líneas de la orden de la app a lo que entiende el cotejo. El itemNo se
// deja crudo a propósito: `claveLinea` es la que pela la variante pegada, y así el
// cotejo trata igual a "M11-0081 -VAR 12" y a "M11-0081".
export function lineasOrdenParaCotejo(lineas: OrdenLinea[]): LineaApp[] {
  return (lineas ?? []).map((l) => ({
    id: String(l.id),
    tipo: l.tipo === "cargo" ? ("cargo" as const) : ("articulo" as const),
    itemNo: String((l.tipo === "cargo" ? l.chargeNo : l.articuloId) ?? ""),
    variantCode: String(l.variantCode ?? ""),
    descripcion: String(l.descripcion ?? ""),
    cantidad: Number(l.cantidad) || 0,
    precioUnitario: Number(l.precioUnitario) || 0,
    // La unidad NO es opcional acá: sin ella no se detecta el caso más caro de todos
    // (la misma cantidad en otra unidad — 1 EST son 255.000 GR).
    unidad: String(l.unidad ?? ""),
  }));
}

// Lo que REALMENTE se le mandó a BC, en forma de cotejo. Se usa en el momento de
// crear/reescribir: ahí la comparación tiene que ser contra el payload que salió
// —no contra el SQL crudo— porque la app resuelve la variante en vuelo
// (resolverVariantesRequeridas) y todavía no la guardó. Comparar contra SQL daría
// "falta en BC" en cada línea con variante resuelta, que es un falso positivo.
export function lineasReplaceParaCotejo(lineas: LineaReplaceBc[]): LineaApp[] {
  return (lineas ?? []).map((l, i) => ({
    id: String(i),
    tipo: l.tipo === "cargo" ? ("cargo" as const) : ("articulo" as const),
    itemNo: String((l.tipo === "cargo" ? l.chargeNo : l.itemNo) ?? ""),
    variantCode: String(l.variantCode ?? ""),
    descripcion: String(l.descripcion ?? ""),
    cantidad: Number(l.cantidad) || 0,
    precioUnitario: toBcAmount(l.precio),
    unidad: String(l.unidad ?? ""),
  }));
}

export async function chequearOrdenContraBc(orderNo: string, lineas: LineaApp[], proveedorNo = "", estadoOrden = ""): Promise<ChequeoBc> {
  const no = (orderNo ?? "").trim();
  if (!no) return { estado: "sin-lectura", mensaje: "La orden no tiene N.º de Business Central." };
  const bc = await bcLineasPedido(no);
  if (!bc) {
    // Se distingue "no está" de "no se pudo ver": la primera es un hecho sobre BC,
    // la segunda es un hecho sobre la red. Confundirlas fue lo que llenó la pantalla
    // de falsos "BC no tiene el pedido".
    const est = await bcEstadoDelPedido(no);
    if (est === "no-existe") {
      return { estado: "sin-pedido", mensaje: `Business Central no tiene el pedido ${no}.` };
    }
    return { estado: "sin-lectura", mensaje: `No se pudieron leer las líneas de ${no} en Business Central (BC no contestó o la API de líneas no está publicada).` };
  }
  // Un pedido que existe pero devuelve CERO líneas es un pedido vacío en BC: no se
  // puede lanzar y no hay nada que recibir. Cuenta como desalineado del peor tipo.
  const cotejo = cotejarLineas(lineas, bc.lineas, {
    ignorarVariante: bc.fuente === "estandar",
    soloArticulos: true,
  });
  // El ENCABEZADO también se coteja. Una orden puede tener las líneas perfectas y
  // estar apuntando a un pedido que allá es de otro proveedor — y eso es más grave
  // que cualquier diferencia de cantidades, porque la plata termina en otra cuenta
  // por pagar. Por eso manda sobre el resultado de las líneas y abre el mensaje.
  // El proveedor sale del MISMO llamado que trajo las líneas cuando ese canal lo
  // entrega; solo si no vino se le pregunta aparte a la API estándar.
  // El encabezado (proveedor + estado) puede venir con las líneas o no, según por
  // cuál de los tres caminos las haya leído `bcLineasPedido`: la página API
  // `purchaseLines` devuelve líneas y nada más. Cuando no vino, se pregunta aparte
  // — no se da por bueno lo que no se miró.
  const enc = bc.status || bc.vendorNo ? bc : (await bcEncabezadoPedido(no)) ?? {};
  const prov = enc.vendorNo
    ? cotejoProveedor(no, { vendorNo: enc.vendorNo, vendorName: "" }, proveedorNo)
    : await verificarProveedorDelPedido(no, proveedorNo);
  const sinVariante = bc.fuente === "estandar" ? " (Verificado sin variante: la API de líneas de Adelante no contestó.)" : "";
  // Y el ESTADO: la orden puede figurar aprobada acá y el pedido seguir Abierto en
  // BC, porque quien lanza es la app de Aprobación. Con las líneas y el proveedor
  // bien, esto es lo único que separa a Bodega de un error crudo de BC.
  const estadoBc = estadoLanzamientoBc(enc.status);
  const appDiceLanzada = estadoOrden === "lanzado" || estadoOrden === "completado";
  if (appDiceLanzada && (estadoBc === "abierto" || estadoBc === "pendiente-aprobacion")) {
    const comoEsta = estadoBc === "abierto" ? "Abierto" : "Pendiente de aprobación";
    return {
      estado: "desalineado", fuente: bc.fuente, cotejo, proveedor: prov, estadoBc,
      mensaje: `SIN LANZAR EN BC — la orden figura ${estadoOrden} acá, pero el pedido ${no} está ${comoEsta} en Business Central. `
        + `Bodega no va a poder recibir hasta que Aprobación lo lance allá.`
        + (cotejo.ok ? "" : ` Además: ${cotejo.resumen}`) + sinVariante,
    };
  }
  if (!prov.ok) {
    return {
      estado: "desalineado", fuente: bc.fuente, cotejo, proveedor: prov, estadoBc,
      mensaje: `PROVEEDOR DISTINTO — ${prov.mensaje}.`
        + (cotejo.ok ? ` (Las ${cotejo.lineasApp} línea(s) sí coinciden.)` : ` Además: ${cotejo.resumen}`)
        + sinVariante,
    };
  }
  if (cotejo.ok) {
    return {
      estado: "ok", fuente: bc.fuente, cotejo, proveedor: prov, estadoBc,
      mensaje: `${no}: las ${cotejo.lineasApp} línea(s) de la orden están en Business Central`
        + (prov.verificado ? ` y el pedido es del proveedor ${prov.bc?.vendorNo}, como acá.` : ".")
        + sinVariante,
    };
  }
  return {
    estado: "desalineado", fuente: bc.fuente, cotejo, proveedor: prov, estadoBc,
    mensaje: `${no}: ${cotejo.resumen}` + sinVariante,
  };
}

// ── LO QUE BC REGISTRÓ DE VERDAD (factura de compra registrada) ──────────────
// Para cotejar una orden que ya se completó: allá el pedido ya no existe (BC lo
// borra al registrarlo todo), así que la única prueba de qué entró es la factura
// registrada. Es lo que hizo falta para entender CP-005172: su factura CFR-009599
// tenía 6 líneas y la orden 7.
//
// Va por la API estándar (`purchaseInvoices` + $expand de sus líneas), que alcanza
// para lo que importa: artículo, cantidad y precio. No trae el código de variante —
// por eso el cotejo contra facturas se hace ignorando la variante.
export async function bcLineasFacturaRegistrada(numeroFactura: string): Promise<LineaBc[] | null> {
  const no = (numeroFactura ?? "").trim();
  if (!no) return null;
  try {
    const cid = await getStdCompanyId();
    const url = `${stdRoot()}/companies(${cid})/purchaseInvoices`
      + `?$filter=${encodeURIComponent(`number eq '${odataStr(no)}'`)}&$top=1&$select=number`
      + `&$expand=purchaseInvoiceLines($select=sequence,lineType,lineObjectNumber,description,unitOfMeasureCode,quantity,unitCost)`;
    const res = await bcFetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const inv = ((await res.json())?.value ?? [])[0];
    if (!inv) return null;
    return (inv.purchaseInvoiceLines ?? []).map((l: any) => {
      const cantidad = Number(l.quantity ?? 0) || 0;
      return {
        documentNo: no,
        lineNo: Number(l.sequence ?? 0) || 0,
        tipo: tipoLineaBc(l.lineType),
        itemNo: String(l.lineObjectNumber ?? "").trim(),
        variantCode: "",
        descripcion: String(l.description ?? "").trim(),
        unidad: String(l.unitOfMeasureCode ?? "").trim(),
        almacen: "",
        cantidad,
        recibida: cantidad,
        facturada: cantidad,
        pendiente: 0,
        precioUnitario: Number(l.unitCost ?? 0) || 0,
      };
    });
  } catch { return null; }
}

// Lo que BC REGISTRÓ contra ESTE pedido, buscado por el N.º de pedido de origen
// (`Order No.` de las líneas de factura registrada). Es el camino bueno para mirar
// hacia atrás: no depende de que la app haya guardado el N.º del documento —cosa que
// solo hace desde el 1 de septiembre de 2026—, así que alcanza también a las órdenes
// viejas, que son justamente las que nadie revisó nunca.
//
// Necesita la página API `postedInvoiceLines` (50247, desde la versión 1.2.6.0 de la
// extensión). Mientras no esté publicada devuelve null y el cotejo cae al camino por
// N.º de factura guardado.
export async function bcLineasFacturadasDePedido(orderNo: string): Promise<LineaBc[] | null> {
  const no = (orderNo ?? "").trim();
  if (!no) return null;
  try {
    const rows = await listCustom(
      "purchasing",
      `postedInvoiceLines?$filter=${encodeURIComponent(`orderNo eq '${odataStr(no)}'`)}&$orderby=documentNo,lineNo`,
    );
    return rows.map((r: any) => {
      const cantidad = Number(r.quantity ?? 0) || 0;
      return {
        documentNo: String(r.documentNo ?? ""),
        lineNo: Number(r.lineNo ?? 0) || 0,
        tipo: tipoLineaBc(r.type),
        itemNo: String(r.no ?? "").trim(),
        variantCode: String(r.variantCode ?? "").trim(),
        descripcion: String(r.description ?? "").trim(),
        unidad: String(r.unitOfMeasureCode ?? "").trim(),
        almacen: String(r.locationCode ?? "").trim(),
        cantidad,
        recibida: cantidad,
        facturada: cantidad,
        pendiente: 0,
        precioUnitario: Number(r.directUnitCost ?? 0) || 0,
      };
    });
  } catch { return null; }
}

// ── EL FRENO ANTES DE REGISTRAR ──────────────────────────────────────────────
// Antes de recibir o facturar, se comprueba que CADA línea que se va a postear
// exista en el pedido de BC y tenga saldo suficiente.
//
// Por qué acá y no solo en BC: los tres procedures de registro del codeunit buscan
// la línea con `FindFirst()` y, si no la encuentran, NO HACEN NADA — sin error y
// sin decirlo. BC devuelve el N.º de la factura registrada igual, la app da el
// registro por bueno y marca recibido lo que allá nunca entró. Así se facturó
// CP-005172 con ₡22.820 de menos y así entró material a la bodega que el inventario
// de BC nunca vio.
//
// El criterio replica EXACTAMENTE los filtros del AL (No. + Variant Code + saldo),
// así que lo que pasa este chequeo es lo que el codeunit va a poder calzar.
// ── INTERRUPTORES DE EMERGENCIA ──────────────────────────────────────────────
// Los dos cortes nuevos (no dejar enviar a aprobación una orden que en BC quedó
// distinta, y no dejar registrar una línea que BC no va a poder calzar) FRENAN
// trabajo real. Si alguno diera un falso positivo en producción, Proveeduría no
// puede mandar órdenes o Bodega no puede recibir un camión — y esperar un despliegue
// para destrabarlo no es una opción. Se apagan desde App Settings de Azure, igual que
// BC_CREAR_AL_ENVIAR:
//
//   BC_PARED_APROBACION=0   → el cotejo se hace y se guarda, pero NO frena el envío.
//   BC_FRENO_REGISTRO=0     → no se verifica antes de postear (queda solo el freno
//                             del codeunit, cuando la extensión 1.2.6.0 esté publicada).
//
// Apagados, la app NO vuelve a ser ciega: sigue cotejando, guardando el resultado en
// la orden y avisando. Lo único que se pierde es el corte.
export function paredAprobacionActiva(): boolean {
  const v = (process.env.BC_PARED_APROBACION ?? "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}
export function frenoRegistroActivo(): boolean {
  const v = (process.env.BC_FRENO_REGISTRO ?? "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}
export function frenoProveedorActivo(): boolean {
  const v = (process.env.BC_FRENO_PROVEEDOR ?? "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}

// ── EL PROVEEDOR DEL PEDIDO EN BC ────────────────────────────────────────────
// La app le manda el proveedor a BC UNA sola vez: al crear el pedido. De ahí en
// adelante todo lo que hace —reescribir líneas al editar, lanzar, recibir,
// facturar— identifica el pedido SOLO por su número. El "Comprar a" del
// encabezado no se vuelve a leer nunca, y el nombre que muestran las pantallas
// sale de NUESTRA base (OrdenCompra.proveedorNombre), congelado el día que se
// creó la orden. O sea: si allá le cambian el proveedor al pedido, acá no se nota.
//
// Eso fue CP-005183 (25 ago 2026): la orden decía FERRETERIA EPA S.A
// (PROV-000522) —y en BC ese código SÍ es EPA—, pero para el 28 el pedido en BC
// había pasado a PROV-000163 (Corazón de Papel). Bodega recibió contra el número,
// BC registró contra el proveedor que el pedido tenía ese día, y la factura 15403
// de EPA (₡425.034,36) quedó en la cuenta por pagar de otro proveedor. En BC no
// quedó rastro de quién lo cambió: el registro de cambios está apagado.
//
// Se lee por la API estándar v2.0, la MISMA con la que la app crea el pedido, así
// que si crear funciona, leer también.
export type ProveedorBc = { vendorNo: string; vendorName: string };
export async function bcProveedorDePedido(orderNo: string): Promise<ProveedorBc | null> {
  const no = (orderNo ?? "").trim();
  if (!no) return null;
  try {
    const cid = await getStdCompanyId();
    const filtro = `$filter=${encodeURIComponent(`number eq '${odataStr(no)}'`)}&$top=1`;
    const pedir = async (select: string) =>
      bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders?${filtro}${select}`, { cache: "no-store" });
    // Con $select la respuesta es mínima; pero si algún día BC renombra un campo, un
    // $select inválido devuelve 400 y este freno se quedaría CIEGO sin que nadie se
    // entere — que es justo el modo de falla que vino a tapar. Por eso reintenta sin
    // $select antes de rendirse, y si igual falla lo dice en el log.
    let res = await pedir("&$select=number,vendorNumber,vendorName");
    if (!res.ok) res = await pedir("");
    if (!res.ok) {
      console.warn(`No se pudo leer el proveedor del pedido ${no} en BC (${res.status}): el freno de proveedor queda sin verificar.`);
      return null;
    }
    const d: any = await res.json().catch(() => ({}));
    const row = (d?.value ?? [])[0];
    // Sin fila: el pedido no existe allá (o ya se registró del todo y BC lo borró).
    // No hay proveedor que cotejar, y eso NO es un desajuste.
    if (!row) return null;
    return { vendorNo: String(row.vendorNumber ?? "").trim(), vendorName: String(row.vendorName ?? "").trim() };
  } catch {
    return null;
  }
}

export type FrenoProveedor = { ok: boolean; verificado: boolean; mensaje?: string; bc?: ProveedorBc };

// ── EL ENCABEZADO COMPLETO: PROVEEDOR + ESTADO ───────────────────────────────
// Las dos preguntas que hay que hacerle a BC antes de registrar, en UNA sola
// lectura (AdelantePO_GetOrderLines devuelve las dos cosas junto con las líneas):
//
//   1. ¿Sigue siendo del mismo proveedor?   → CP-005183
//   2. ¿Está LANZADO?                       → CP-005143
//
// El caso 2: quien aprueba y lanza el pedido en BC es la app de Aprobación
// (produccion.adelante.cr). Esta app solo se entera de que "quedó aprobada", y
// hasta ahora se lo creía: marcaba `lanzado` en su base sin preguntarle a BC. Si
// el lanzamiento de allá no pasó, el pedido se queda Abierto y Bodega lo descubre
// contra la pared, con el error crudo de BC ("must be approved and released").
// De 113 órdenes lanzadas, dos quedaron así: CP-005143 y CP-005180.
//
// Como siempre: si no se pudo leer, NO se frena (`verificado:false`).
export type ProblemaEncabezado = "proveedor" | "no-lanzado";
export type FrenoEncabezado = {
  ok: boolean; verificado: boolean; problema?: ProblemaEncabezado; mensaje?: string;
  bcVendorNo?: string; bcVendorName?: string; bcEstado?: EstadoBcPedido;
};

// El ENCABEZADO por el canal que dice la verdad. Va DIRECTO al codeunit y no por
// `bcLineasPedido`, a propósito: esa función prueba primero la página API
// `purchaseLines`, que devuelve las líneas pero NO el encabezado. Si el freno se
// colgara de ella, en el entorno donde esa página contesta el estado llegaría
// siempre vacío y el freno no frenaría nunca — sin que nadie se entere, que es
// justo el modo de falla que vinimos a tapar.
export async function bcEncabezadoPedido(orderNo: string): Promise<{ status?: string; vendorNo?: string } | null> {
  const no = (orderNo ?? "").trim();
  if (!no) return null;
  try {
    const cid = await getStdCompanyId();
    const res = await bcFetch(`${odataRoot()}/AdelantePO_GetOrderLines?company=${encodeURIComponent(cid)}`, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNo: no }),
    });
    if (!res.ok) return null;
    const d: any = await res.json().catch(() => ({}));
    const payload = JSON.parse(String(d?.value ?? "{}"));
    return {
      status: String(payload?.status ?? "").trim() || undefined,
      vendorNo: String(payload?.vendorNo ?? "").trim() || undefined,
    };
  } catch {
    return null;
  }
}

export async function verificarEncabezadoDelPedido(orderNo: string, proveedorNoOrden: string): Promise<FrenoEncabezado> {
  const no = (orderNo ?? "").trim();
  if (!no) return { ok: true, verificado: false };
  const bc = await bcEncabezadoPedido(no);
  const bcEstado = estadoLanzamientoBc(bc?.status);

  // 1) PROVEEDOR. Se prefiere el `vendorNo` que vino con las líneas (mismo canal por
  //    el que la app escribe); si esa lectura no lo trajo, se pregunta por la API
  //    estándar antes de dar el tema por verificado.
  const prov = bc?.vendorNo
    ? cotejoProveedor(no, { vendorNo: bc.vendorNo, vendorName: "" }, proveedorNoOrden)
    : await verificarProveedorDelPedido(no, proveedorNoOrden).catch(() => ({ ok: true, verificado: false }) as FrenoProveedor);
  if (!prov.ok) {
    return {
      ok: false, verificado: true, problema: "proveedor", mensaje: prov.mensaje,
      bcVendorNo: prov.bc?.vendorNo, bcVendorName: prov.bc?.vendorName, bcEstado,
    };
  }

  // 2) ESTADO. Solo frena lo que BC afirmó: "desconocido" es no haber podido leer.
  if (bcEstado === "abierto" || bcEstado === "pendiente-aprobacion") {
    const comoEsta = bcEstado === "abierto" ? "ABIERTO" : "PENDIENTE DE APROBACIÓN";
    return {
      ok: false, verificado: true, problema: "no-lanzado", bcEstado,
      mensaje: `el pedido ${no} está ${comoEsta} en Business Central, no lanzado. `
        + `Business Central no deja recibir ni facturar contra un pedido sin lanzar. `
        + `La orden figura aprobada acá, pero en BC el lanzamiento todavía no entró: `
        + `tiene que lanzarlo Aprobación desde su app`,
    };
  }
  return { ok: true, verificado: bcEstado === "lanzado" || prov.verificado, bcEstado, bcVendorNo: prov.bc?.vendorNo };
}

// ¿El pedido de BC sigue siendo del proveedor de esta orden? Se usa como freno
// antes de recibir/facturar y como parte del cotejo de "Verificar contra BC".
//
// Igual que el freno de líneas: si NO se pudo leer, no se frena (`verificado:false`).
// Trabar a Bodega por una consulta que falló sería peor que el problema; y si BC no
// contesta, el registro tampoco va a entrar y el error sale por su propio camino.
// Se frena SOLO cuando BC contestó y dijo otro proveedor.
export async function verificarProveedorDelPedido(orderNo: string, proveedorNoOrden: string): Promise<FrenoProveedor> {
  const esperado = (proveedorNoOrden ?? "").trim();
  if (!esperado || !(orderNo ?? "").trim()) return { ok: true, verificado: false };
  return cotejoProveedor(orderNo, await bcProveedorDePedido(orderNo), esperado);
}

// La decisión, sin red: separada para poder probarla. `bc` en null es "no se pudo
// leer o el pedido ya no está allá" — las dos cosas se tratan igual, como
// "no verificado", porque ninguna de las dos afirma que haya un desajuste.
export function cotejoProveedor(orderNo: string, bc: ProveedorBc | null, proveedorNoOrden: string): FrenoProveedor {
  const esperado = (proveedorNoOrden ?? "").trim();
  if (!esperado) return { ok: true, verificado: false };
  if (!bc || !bc.vendorNo.trim()) return { ok: true, verificado: false };
  if (bc.vendorNo.trim().toUpperCase() === esperado.toUpperCase()) return { ok: true, verificado: true, bc };
  return {
    ok: false, verificado: true, bc,
    mensaje: `el pedido ${orderNo} en Business Central es del proveedor ${bc.vendorNo}`
      + `${bc.vendorName ? ` (${bc.vendorName})` : ""}, pero esta orden es de ${esperado}. `
      + `O le cambiaron el proveedor al pedido en BC, o la orden quedó apuntando al pedido equivocado. `
      + `Registrarlo así le carga esta compra a la cuenta de otro proveedor`,
  };
}

export type ModoRegistro = "recibir" | "facturar-recibido";

export type FrenoRegistro = { ok: boolean; problemas: string[]; verificado: boolean };

export async function verificarLineasPosteables(
  orderNo: string,
  lineas: { itemNo: string; qty: number; variantCode?: string }[],
  modo: ModoRegistro = "recibir",
): Promise<FrenoRegistro> {
  const pedidas = (lineas ?? []).filter((l) => (l.itemNo ?? "").trim() && (Number(l.qty) || 0) > 0);
  if (!pedidas.length) return { ok: true, problemas: [], verificado: false };
  const bc = await bcLineasPedido(orderNo);
  // Sin lectura no se frena: si BC no contesta, el registro tampoco va a entrar y
  // el error va a salir por su propio camino. Bloquear acá sería trabar a Bodega
  // por un problema de red. `verificado:false` deja constancia de que no se miró.
  if (!bc) return { ok: true, problemas: [], verificado: false };

  const problemas: string[] = [];
  // Se consume el saldo a medida que se valida, igual que hace el codeunit al
  // asignar cantidades: dos líneas del mismo material no pueden usar el mismo saldo.
  const saldo = new Map<string, number>();
  const porItem = new Map<string, LineaBc[]>();
  for (const l of bc.lineas) {
    if (l.tipo !== "articulo") continue;
    const item = codigoDeItem(l.itemNo).toUpperCase();
    porItem.set(item, [...(porItem.get(item) ?? []), l]);
    const disponible = modo === "facturar-recibido" ? Math.max(0, l.recibida - l.facturada) : l.pendiente;
    saldo.set(`${item}|${l.variantCode.trim().toUpperCase()}`, (saldo.get(`${item}|${l.variantCode.trim().toUpperCase()}`) ?? 0) + disponible);
  }
  const queFalta = modo === "facturar-recibido" ? "recibido sin facturar" : "pendiente de recibir";

  for (const p of pedidas) {
    const item = codigoDeItem(String(p.itemNo)).toUpperCase();
    const variante = String(p.variantCode ?? "").trim().toUpperCase();
    const enBc = porItem.get(item) ?? [];
    if (!enBc.length) {
      problemas.push(`${p.itemNo}: el pedido ${orderNo} de Business Central NO tiene ninguna línea de este artículo. Si se registra, BC lo va a ignorar en silencio y la app lo va a dar por recibido.`);
      continue;
    }
    // La variante solo se puede exigir si BC nos la devolvió (la API estándar no
    // la trae). Si se comparó sin ella, se avisa pero no se frena por variante.
    const clave = bc.fuente === "custom" && variante ? `${item}|${variante}` : "";
    if (clave && !saldo.has(clave)) {
      const otras = [...new Set(enBc.map((l) => l.variantCode || "(sin variante)"))].join(", ");
      problemas.push(`${p.itemNo}: la orden lo recibe con variante "${variante}" y en BC la(s) línea(s) de ese artículo tienen ${otras}. El registro filtra por variante: no va a calzar y BC lo va a saltar sin avisar.`);
      continue;
    }
    // Saldo: sumado por artículo+variante cuando hay variante, y por artículo cuando
    // no (que es como lo va a resolver el codeunit).
    // Sin variante se puede tomar saldo de cualquier variante del artículo, pero se
    // empieza por la línea SIN variante: si no, esta línea le come el saldo a la
    // variante que otra línea sí pidió por nombre y la frena después sin motivo.
    const claves = clave
      ? [clave]
      : [`${item}|`, ...[...saldo.keys()].filter((k) => k.startsWith(`${item}|`) && k !== `${item}|`)];
    const disponible = claves.reduce((s, k) => s + (saldo.get(k) ?? 0), 0);
    const q = Number(p.qty) || 0;
    if (disponible + 1e-6 < q) {
      problemas.push(`${p.itemNo}: se quieren registrar ${q} y en BC solo hay ${disponible} ${queFalta} en el pedido ${orderNo}.`);
      continue;
    }
    // Descontar del saldo, en orden, para que la siguiente línea del mismo material
    // no vuelva a contar lo mismo.
    let resta = q;
    for (const k of claves) {
      if (resta <= 0) break;
      const s = saldo.get(k) ?? 0;
      const usa = Math.min(s, resta);
      saldo.set(k, s - usa);
      resta -= usa;
    }
  }
  return { ok: problemas.length === 0, problemas, verificado: true };
}

// ¿Tiene sentido gritar por este chequeo, según el estado de la orden?
// En una orden COMPLETADA que BC ya borró no hay nada roto: Purch.-Post borra el
// pedido cuando se recibió y facturó todo. Decirle a esa orden "BC no tiene el
// pedido" es el falso positivo que hizo que nadie mirara el aviso cuando SÍ estaba
// roto (CP-005172 lo mostraba, y era ruido).
export function chequeoAplica(estado: EstadoChequeoBc, estadoOrden: string): boolean {
  if (estado === "ok" || estado === "sin-lectura") return false;
  if (estado === "sin-pedido") return estadoOrden !== "completado";
  return true;   // "desalineado" importa siempre: la plata ya no cuadra
}

export type BcFacturaProveedor = { numero: string; vendorNo: string; fecha: string; total: number; estado: string };

// La factura de compra que BC YA tiene con ese N.º de factura del proveedor, si
// existe. Es la prueba de que el registro sí entró (aunque la app lo haya
// reportado como fallido) y lo que se le muestra a Bodega antes de conciliar.
// null = no está, o BC no dejó buscarla: nunca inventa un "sí".
export async function bcFacturaDeProveedor(vendorInvoiceNo: string, vendorNo = ""): Promise<BcFacturaProveedor | null> {
  const inv = (vendorInvoiceNo ?? "").trim();
  const prov = (vendorNo ?? "").trim();
  if (!inv) return null;
  const CAMPOS = "&$select=number,vendorInvoiceNumber,vendorNumber,invoiceDate,status,totalAmountIncludingTax";
  const mapear = (r: any): BcFacturaProveedor => ({
    numero: String(r?.number ?? ""),
    vendorNo: String(r?.vendorNumber ?? ""),
    fecha: String(r?.invoiceDate ?? ""),
    total: Number(r?.totalAmountIncludingTax ?? 0) || 0,
    estado: String(r?.status ?? ""),
  });
  try {
    const cid = await getStdCompanyId();
    const pedir = async (filtro: string, top: number, orderby = ""): Promise<any[] | null> => {
      const url = `${stdRoot()}/companies(${cid})/purchaseInvoices?$filter=${encodeURIComponent(filtro)}`
        + `${orderby ? `&$orderby=${orderby}` : ""}${CAMPOS}&$top=${top}`;
      const res = await bcFetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const d: any = await res.json().catch(() => ({}));
      return (d?.value ?? []) as any[];
    };
    const conds = [`vendorInvoiceNumber eq '${odataStr(inv)}'`];
    if (prov) conds.push(`vendorNumber eq '${odataStr(prov)}'`);
    let rows = await pedir(conds.join(" and "), 5);
    // Si BC no deja filtrar por vendorInvoiceNumber, se piden las últimas
    // facturas del proveedor y se compara acá.
    if (rows === null && prov) {
      const ultimas = await pedir(`vendorNumber eq '${odataStr(prov)}'`, 100, "invoiceDate desc");
      rows = (ultimas ?? []).filter((r) => String(r?.vendorInvoiceNumber ?? "").trim().toLowerCase() === inv.toLowerCase());
    }
    return rows && rows.length ? mapear(rows[0]) : null;
  } catch {
    return null;
  }
}

export type DiagnosticoBc = {
  motivo: FalloRegistroBc;
  yaEnBc: boolean;                       // true = BC ya tiene el movimiento
  pedido: BcPedidoEstado | null;
  facturaBc: BcFacturaProveedor | null;  // la factura que BC ya tiene, si se pudo ver
};

// Traduce el "no" de BC a algo que la pantalla pueda usar: ¿se reintenta, o esto
// ya está registrado allá y lo único que falta es guardarlo acá?
export async function diagnosticarFalloBc(error: string, orderNo: string, vendorInvoiceNo = "", vendorNo = ""): Promise<DiagnosticoBc> {
  const motivo = clasificarFalloBc(error);
  if (motivo === "reintentable") return { motivo, yaEnBc: false, pedido: null, facturaBc: null };
  if (motivo === "factura-duplicada") {
    // Que la factura ya exista lo dijo BC: con eso alcanza. Buscarla es para
    // MOSTRAR cuál es (N.º, fecha, total), no para decidir.
    return { motivo, yaEnBc: true, pedido: null, facturaBc: await bcFacturaDeProveedor(vendorInvoiceNo, vendorNo) };
  }
  // "Pedido no encontrado": se confirma contra BC antes de darlo por cierto. Si el
  // pedido sí está, el mensaje hablaba de otra cosa (o fue un parpadeo) y esto se
  // puede reintentar como siempre.
  const pedido = await bcEstadoDelPedido(orderNo);
  if (pedido !== "no-existe") return { motivo: "reintentable", yaEnBc: false, pedido, facturaBc: null };
  // Sin pedido en BC, la factura registrada es la prueba de que ya se registró
  // todo (Purch.-Post borra el pedido al completarlo).
  const facturaBc = await bcFacturaDeProveedor(vendorInvoiceNo, vendorNo);
  return { motivo, yaEnBc: !!facturaBc, pedido, facturaBc };
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
