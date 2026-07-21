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

export type BcItem = { id: string; code: string; descripcion: string; unidad: string; lastDirectCost?: number; categoria?: string; reorderPoint?: number; safetyStock?: number; reorderQty?: number };
export type BcObra = { id: string; codigo: string; nombre: string };
export type BcAlmacen = { codigo: string; nombre: string };

let lastGoodItems: BcItem[] | null = null;
export async function bcItems(): Promise<BcItem[]> {
  try {
    const rows = await listAll("inventory", "items");
    let items: BcItem[] = rows
      .filter((i) => !(i.Blocked ?? i.blocked))
      .map((i) => {
        const code = i.No ?? i.no ?? i.number ?? "";
        const costCustom = Number(i.LastDirectCost ?? i.lastDirectCost ?? i.UnitCost ?? i.unitCost ?? 0) || undefined;
        const catCustom = (i.ItemCategoryCode ?? i.itemCategoryCode ?? "").toString().trim() || undefined;
        return {
          id: i.id ?? i.systemId ?? code,
          code,
          descripcion: i.Description ?? i.description ?? i.displayName ?? code,
          unidad: i.BaseUnitOfMeasure ?? i.baseUnitOfMeasure ?? i.baseUnitOfMeasureCode ?? "UND",
          lastDirectCost: costCustom,
          categoria: catCustom,
          reorderPoint: Number(i.reorderPoint ?? i.ReorderPoint ?? 0) || undefined,
          safetyStock: Number(i.safetyStockQuantity ?? i.SafetyStockQuantity ?? 0) || undefined,
          reorderQty: Number(i.reorderQuantity ?? i.ReorderQuantity ?? 0) || undefined,
        };
      });
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

export async function bcObras(): Promise<BcObra[]> {
  const rows = await listAll("project", "jobs");
  return rows.map((j) => ({
    id: j.id ?? j.no ?? "",
    codigo: j.no ?? j.No ?? "",
    nombre: j.description ?? j.Description ?? j.no ?? "",
  }));
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
export async function bcUltimoPrecioFacturado(itemNo: string, vendorNo: string): Promise<number | null> {
  if (!itemNo || !vendorNo) return null;
  try {
    const cid = await getStdCompanyId();
    const filtro = `$filter=${encodeURIComponent(`vendorNumber eq '${vendorNo}'`)}`;
    const url =
      `${stdRoot()}/companies(${cid})/purchaseInvoices?${filtro}` +
      `&$orderby=invoiceDate desc&$top=20` +
      `&$expand=purchaseInvoiceLines($select=lineType,lineObjectNumber,directUnitCost,unitCost)`;
    const res = await bcFetch(url, { cache: "no-store" });
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

// Compatibilidad: versión que solo devuelve la lista (sin el flag).
export async function bcVariants(itemNo: string): Promise<BcVariante[]> {
  return (await bcVariantsEx(itemNo)).variantes;
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
export type NuevaLineaBc = { itemNo: string; cantidad: number; precio?: number; descripcion?: string; variantCode?: string };

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

// Cargo de producto (Item Charge) a agregar al pedido: tipo (chargeNo del catálogo
// BC), cantidad y precio unitario. Sin chargeNo cae al flete por defecto (env).
export type CargoBc = { chargeNo?: string; descripcion?: string; cantidad?: number; precio: number };

export async function bcCrearPedido(input: { vendorNo: string; currencyCode?: string; locationCode?: string; lineas: NuevaLineaBc[]; cargos?: CargoBc[]; flete?: { monto: number; descripcion?: string } }): Promise<{ number: string; id: string; omitidas: string[]; creadas: number; lineError?: string; cargoError?: string; cargosCreados: number }> {
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
    if (l.precio && l.precio > 0) lineBody.directUnitCost = l.precio;
    if (locId) lineBody.locationId = locId;
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
      if (!(cg.precio > 0)) continue;
      const chargeNo = cg.chargeNo || process.env.BC_ITEM_CHARGE_FLETE || "FLETE";
      try {
        await bcAddChargeLine(po.number, chargeNo, cg.descripcion || "CARGO / TRANSPORTE", qty, cg.precio);
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
  return { number: po.number ?? "", id: po.id ?? "", omitidas, creadas, lineError, cargoError, cargosCreados };
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

// Re-sincroniza PRECIO + VARIANTE de las líneas de un pedido YA creado en BC, para
// reflejar correcciones hechas en la app después de crearlo (antes, "reintentar
// lanzar" solo relanzaba la versión vieja). Empareja por número de artículo en
// orden y solo hace PATCH de lo que cambió.
// OJO: no verificado aún contra un pedido real con release fallido — probar en
// el Sandbox (CP-003833) antes de confiar en producción.
export async function bcResyncPedidoLines(orderNo: string, lineas: NuevaLineaBc[]): Promise<{ patched: number; sinMatch: string[] }> {
  if (!orderNo) throw new Error("Falta el número de pedido de BC.");
  const items = (lineas ?? []).filter((l) => l.itemNo && l.cantidad > 0);
  if (!items.length) return { patched: 0, sinMatch: [] };
  const cid = await getStdCompanyId();
  const jsonHeaders = { "Content-Type": "application/json" };
  // 1) Pedido por número -> id.
  const filtro = `$filter=${encodeURIComponent(`number eq '${orderNo}'`)}&$select=id,number`;
  const resPo = await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders?${filtro}`, { cache: "no-store" });
  if (!resPo.ok) throw new Error(`BC ${resPo.status} al buscar el pedido ${orderNo}.`);
  const poId = ((await resPo.json()).value ?? [])[0]?.id;
  if (!poId) throw new Error(`No se encontró el pedido ${orderNo} en BC.`);
  // 2) Líneas existentes en BC.
  const resLines = await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders(${poId})/purchaseOrderLines?$select=id,lineType,lineObjectNumber,quantity,directUnitCost,itemVariantId`, { cache: "no-store" });
  if (!resLines.ok) throw new Error(`BC ${resLines.status} al leer las líneas de ${orderNo}.`);
  const bcLines: any[] = (await resLines.json()).value ?? [];
  const usados = new Set<string>();
  let patched = 0; const sinMatch: string[] = [];
  for (const l of items) {
    const bc = bcLines.find((b) => !usados.has(b.id) && String(b.lineObjectNumber) === String(l.itemNo) && /item/i.test(String(b.lineType)));
    if (!bc) { sinMatch.push(l.itemNo); continue; }
    usados.add(bc.id);
    const patch: Record<string, unknown> = {};
    if (l.precio && l.precio > 0 && Number(bc.directUnitCost) !== l.precio) patch.directUnitCost = l.precio;
    if (l.variantCode) {
      const vId = await getStdVariantId(l.itemNo, l.variantCode);
      if (vId && bc.itemVariantId !== vId) patch.itemVariantId = vId;
    }
    if (!Object.keys(patch).length) continue;
    const resP = await bcFetch(`${stdRoot()}/companies(${cid})/purchaseOrders(${poId})/purchaseOrderLines(${bc.id})`, {
      method: "PATCH", cache: "no-store",
      headers: { ...jsonHeaders, "If-Match": bc["@odata.etag"] ?? "*" },
      body: JSON.stringify(patch),
    });
    if (!resP.ok) throw new Error(`BC ${resP.status} al actualizar la línea ${l.itemNo}: ${(await resP.text()).slice(0, 200)}`);
    patched++;
  }
  return { patched, sinMatch };
}

// Registra (Recibir + Facturar) una factura parcial del pedido en BC con todos sus
// movimientos contables, vía el web service custom AdelantePO_PostInvoice.
// lines = cantidades recibidas en ESTA factura por item ({itemNo, qty}).
export async function bcRegistrarFactura(
  orderNo: string,
  vendorInvoiceNo: string,
  lines: { itemNo: string; qty: number; variantCode?: string }[],
  postingDate = "", // fecha de registro (ISO yyyy-mm-dd). "" → BC usa la fecha del día
): Promise<string> {
  if (!orderNo) throw new Error("Falta el número de pedido de BC.");
  if (!vendorInvoiceNo) throw new Error("Falta el N.º de factura del proveedor.");
  const cid = await getStdCompanyId();
  const url = `${odataRoot()}/AdelantePO_PostInvoice?company=${encodeURIComponent(cid)}`;
  const res = await bcFetch(url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo, vendorInvoiceNo, linesJson: JSON.stringify(lines), postingDate }),
  });
  if (!res.ok) throw new Error(`BC registrar ${res.status}: ${(await res.text()).slice(0, 250)}`);
  const d: any = await res.json().catch(() => ({}));
  return d?.value ?? "Registrado";
}

// MODO 2 — Solo RECEPCIÓN (material llega bien, la factura queda en revisión).
// Registra la recepción en BC (Receive=true, Invoice=false) vía AdelantePO_PostReceipt.
// Mueve inventario/cantidad recibida sin tocar la factura ni el ledger del proveedor.
export async function bcRecibir(orderNo: string, lines: { itemNo: string; qty: number; variantCode?: string }[], postingDate = ""): Promise<string> {
  if (!orderNo) throw new Error("Falta el número de pedido de BC.");
  const cid = await getStdCompanyId();
  const url = `${odataRoot()}/AdelantePO_PostReceipt?company=${encodeURIComponent(cid)}`;
  const res = await bcFetch(url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo, linesJson: JSON.stringify(lines), postingDate }),
  });
  if (!res.ok) throw new Error(`BC recibir ${res.status}: ${(await res.text()).slice(0, 250)}`);
  const d: any = await res.json().catch(() => ({}));
  return d?.value ?? "Recibido";
}

// MODO 2 — Solo FACTURA de lo ya recibido (Kattya revisa y registra después).
// Factura en BC lo que estaba recibido-no-facturado (Receive=false, Invoice=true)
// vía AdelantePO_PostInvoiceOfReceived.
export async function bcFacturarRecibido(orderNo: string, vendorInvoiceNo: string, lines: { itemNo: string; qty: number; variantCode?: string }[], postingDate = ""): Promise<string> {
  if (!orderNo) throw new Error("Falta el número de pedido de BC.");
  if (!vendorInvoiceNo) throw new Error("Falta el N.º de factura del proveedor.");
  const cid = await getStdCompanyId();
  const url = `${odataRoot()}/AdelantePO_PostInvoiceOfReceived?company=${encodeURIComponent(cid)}`;
  const res = await bcFetch(url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo, vendorInvoiceNo, linesJson: JSON.stringify(lines), postingDate }),
  });
  if (!res.ok) throw new Error(`BC facturar ${res.status}: ${(await res.text()).slice(0, 250)}`);
  const d: any = await res.json().catch(() => ({}));
  return d?.value ?? "Facturado";
}

// Crea el Pedido en BC (queda Abierto) y lo LANZA enseguida -> "Lanzado".
// Si el create funciona pero el release falla (p.ej. AdelantePO no publicado aún),
// devuelve el pedido creado con released=false para que la UI avise sin romperse.
export async function bcCrearYLanzarPedido(input: { vendorNo: string; currencyCode?: string; locationCode?: string; lineas: NuevaLineaBc[]; cargos?: CargoBc[]; metodo?: string; flete?: { monto: number; descripcion?: string } }):
  Promise<{ number: string; id: string; omitidas: string[]; creadas: number; lineError?: string; cargoError?: string; cargosCreados?: number; released: boolean; releaseError?: string }> {
  const { number, id, omitidas, creadas, lineError, cargoError, cargosCreados } = await bcCrearPedido(input);
  // Si NINGUNA línea entró a BC, no tiene sentido intentar lanzar (BC responde
  // "nothing to release"). Devolvemos released=false con el motivo real de la línea.
  if (creadas === 0) {
    return { number, id, omitidas, creadas, lineError, cargoError, cargosCreados, released: false, releaseError: lineError ?? "BC rechazó todas las líneas del pedido." };
  }
  // FORZAR EL PRECIO DE LA APP: al insertar la línea, la API estándar valida el
  // N.º del artículo y autocompleta el "Direct Unit Cost" desde la ficha del ítem,
  // PISANDO el precio que mandamos en el POST (si el ítem no tiene costo, lo deja
  // en blanco → no se puede facturar). Re-sincronizamos con PATCH para que el
  // precio NEGOCIADO en la app sea el que queda en BC. No debe tumbar el lanzamiento.
  try { await bcResyncPedidoLines(number, input.lineas); } catch (e) { console.warn(`BC resync de precios en ${number} falló:`, e); }
  // Cargos con método distinto de importe: reasignar explícitamente (Igualmente/
  // Peso/Volumen). El default "Amount" ya lo hace el codeunit al registrar, así que
  // solo llamamos cuando el método NO es Amount. No debe tumbar el lanzamiento.
  const met = (input.metodo ?? "").trim();
  const hayCargos = (input.cargos && input.cargos.length) || (input.flete && input.flete.monto > 0);
  if (hayCargos && met && met.toLowerCase() !== "amount") {
    try { await bcAssignItemCharges(number, met); } catch (e) { console.warn(`BC asignar cargo (${met}) en ${number} falló:`, e); }
  }
  try {
    await bcReleasePedido(number);
    return { number, id, omitidas, creadas, lineError, cargoError, cargosCreados, released: true };
  } catch (e: any) {
    return { number, id, omitidas, creadas, lineError, cargoError, cargosCreados, released: false, releaseError: String(e?.message ?? e) };
  }
}

// Crea una línea de Cargo de producto (Item Charge) en un pedido, vía el codeunit
// AdelantePO_AddChargeLine. La API ESTÁNDAR se traga la línea de cargo sin avisar,
// así que las líneas de cargo van SIEMPRE por acá (las de artículo siguen por la
// API estándar). Es idempotente por itemChargeNo (no duplica si se reintenta).
export async function bcAddChargeLine(orderNo: string, itemChargeNo: string, description: string, quantity: number, directUnitCost: number): Promise<string> {
  if (!orderNo) throw new Error("Falta el número de pedido para el cargo.");
  if (!itemChargeNo) throw new Error("Falta el tipo de cargo (itemChargeNo).");
  const cid = await getStdCompanyId();
  const url = `${odataRoot()}/AdelantePO_AddChargeLine?company=${encodeURIComponent(cid)}`;
  const res = await bcFetch(url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo, itemChargeNo, description, quantity: quantity > 0 ? quantity : 1, directUnitCost }),
  });
  if (!res.ok) throw new Error(`BC add cargo ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const d: any = await res.json().catch(() => ({}));
  return d?.value ?? "Agregado";
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
