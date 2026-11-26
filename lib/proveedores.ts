// LA FICHA DEL PROVEEDOR (pantalla Proveedores, nov 2026).
//
// Pedido de quien da seguimiento a las notas de crédito: tener a mano los datos de
// cada proveedor —código, cédula, teléfono, correo, condiciones de pago— para
// llamarle o escribirle por una NC, sin abrir Business Central. Se lee de la ficha
// de BC tal cual (web service OData `Ficha_proveedor_Excel`, la tabla 23 casi
// completa): la app no guarda proveedores ni los corrige, solo los muestra.
//
// Ojo con lo que hay: al 26 nov 2026, de 852 fichas solo 62 tienen teléfono, 15
// celular y 31 correo. Lo que falta se completa en BC, no acá.
import type { NotaCreditoLinea, Orden } from "./types.ts";

export type ProveedorFicha = {
  codigo: string;          // PROV-… (No.)
  nombre: string;
  tipoId: string;          // Cédula Jurídica / Física / DIMEX… ("" si no está)
  cedula: string;
  telefono: string;
  celular: string;
  correo: string;
  direccion: string;
  ciudad: string;
  provincia: string;       // County en BC
  pais: string;
  codPostal: string;
  moneda: string;          // "" en BC = colones
  terminosPago: string;    // CONTADO, 30D…
  formaPago: string;
  grupoNegocio: string;    // Gen. Bus. Posting Group
  grupoIva: string;        // VAT Bus. Posting Group
  grupoProveedor: string;  // Vendor Posting Group
  saldo: number;           // Balance (LCY): lo que se le debe, en colones
  vencido: number;         // Balance Due (LCY)
  bloqueado: string;       // "" = activo; "All" / "Payment" = bloqueado en BC
  modificado: string;      // último cambio de la ficha (YYYY-MM-DD)
};

/** Los campos que se piden a BC. Un nombre que no exista da 400 con el nombre adentro. */
export const CAMPOS_FICHA = [
  "No", "Name", "GJW_Tipo_Identificacion", "GJW_No_Identificacion", "VAT_Registration_No",
  "Phone_No", "MobilePhoneNo", "E_Mail", "Address", "Address_2", "City", "County",
  "Country_Region_Code", "Post_Code", "Currency_Code", "Payment_Terms_Code", "Payment_Method_Code",
  "Gen_Bus_Posting_Group", "VAT_Bus_Posting_Group", "Vendor_Posting_Group",
  "Balance_LCY", "Balance_Due_LCY", "Blocked", "Last_Date_Modified",
].join(",");

/** Los enums de BC en OData pueden venir con los espacios escapados ("_x0020_"). */
export function enumBc(v: unknown): string {
  return String(v ?? "").replace(/_x0020_/g, " ").trim();
}

const txt = (v: unknown) => String(v ?? "").trim();
const numero = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const dia = (v: unknown) => {
  const d = txt(v).slice(0, 10);
  return d && d !== "0001-01-01" ? d : "";
};

export function fichaDeOdata(r: Record<string, unknown>): ProveedorFicha {
  return {
    codigo: txt(r.No),
    nombre: txt(r.Name) || txt(r.No),
    tipoId: enumBc(r.GJW_Tipo_Identificacion),
    // La cédula vive en dos campos: el de la localización CR y el VAT de BC. Casi
    // siempre son el mismo número; si el primero está vacío se usa el segundo.
    cedula: txt(r.GJW_No_Identificacion) || txt(r.VAT_Registration_No),
    telefono: txt(r.Phone_No),
    celular: txt(r.MobilePhoneNo),
    correo: txt(r.E_Mail),
    direccion: [txt(r.Address), txt(r.Address_2)].filter(Boolean).join(", "),
    ciudad: txt(r.City),
    provincia: txt(r.County),
    pais: txt(r.Country_Region_Code),
    codPostal: txt(r.Post_Code),
    moneda: txt(r.Currency_Code),
    terminosPago: txt(r.Payment_Terms_Code),
    formaPago: txt(r.Payment_Method_Code),
    grupoNegocio: txt(r.Gen_Bus_Posting_Group),
    grupoIva: txt(r.VAT_Bus_Posting_Group),
    grupoProveedor: txt(r.Vendor_Posting_Group),
    saldo: numero(r.Balance_LCY),
    vencido: numero(r.Balance_Due_LCY),
    bloqueado: enumBc(r.Blocked),
    modificado: dia(r.Last_Date_Modified),
  };
}

/** Rótulo del bloqueo de BC: "" = activo. */
export function etiquetaBloqueo(b: string): string {
  const v = enumBc(b).toLowerCase();
  if (!v) return "";
  if (v === "all") return "Bloqueado";
  if (v === "payment") return "Pagos bloqueados";
  if (v === "invoice") return "Facturas bloqueadas";
  return enumBc(b);
}

/** ¿Hay por dónde contactarlo? Teléfono, celular o correo. */
export function tieneContacto(f: Pick<ProveedorFicha, "telefono" | "celular" | "correo">): boolean {
  return !!(f.telefono || f.celular || f.correo);
}

// Para cruzar por nombre cuando la NC no trae la orden: sin tildes, sin puntuación,
// sin espacios de más. "Ferretería X, S.A." y "FERRETERIA X SA" son el mismo.
export function claveNombre(s: string): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    // El punto se quita sin dejar espacio: "S.A." tiene que dar "sa", igual que "SA".
    .toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export type NcDeProveedor = {
  lineas: NotaCreditoLinea[];
  /** Monto estimado (precio × cantidad, sin IVA) por moneda de la orden. */
  porMoneda: [string, number][];
  /** N.º de las órdenes con NC pendiente (CP-…), sin repetir. */
  ordenes: string[];
};

/**
 * Las NC PENDIENTES agrupadas por código de proveedor. El código sale de la orden
 * (`Orden.proveedorId` es el código PROV-…, no el GUID); si la orden no está o su
 * código no es una ficha conocida, se cruza por nombre. Lo que no calza con
 * ninguna ficha queda fuera: no hay a quién atribuírselo.
 */
export function ncPendientesPorProveedor(
  ncs: NotaCreditoLinea[],
  ordenes: Pick<Orden, "id" | "proveedorId" | "proveedorNombre" | "currencyCode">[],
  fichas: Pick<ProveedorFicha, "codigo" | "nombre">[],
): Map<string, NcDeProveedor> {
  const porId = new Map(ordenes.map((o) => [String(o.id), o]));
  const codigos = new Set(fichas.map((f) => f.codigo));
  const porNombre = new Map<string, string>();
  for (const f of fichas) {
    const k = claveNombre(f.nombre);
    if (k && !porNombre.has(k)) porNombre.set(k, f.codigo);
  }
  type Grupo = { lineas: NotaCreditoLinea[]; montos: Map<string, number>; ordenes: Set<string> };
  const acc = new Map<string, Grupo>();
  for (const nc of ncs) {
    if (nc.estado === "resuelta") continue;
    const o = porId.get(String(nc.ordenId));
    let codigo = String(o?.proveedorId ?? "").trim();
    if (!codigos.has(codigo)) codigo = porNombre.get(claveNombre(nc.proveedor || o?.proveedorNombre || "")) ?? "";
    if (!codigo) continue;
    const g: Grupo = acc.get(codigo) ?? { lineas: [], montos: new Map(), ordenes: new Set() };
    g.lineas.push(nc);
    const moneda = (o?.currencyCode || "CRC").trim() || "CRC";
    g.montos.set(moneda, (g.montos.get(moneda) ?? 0) + (nc.precioUnitario ?? 0) * (Number(nc.cantidad) || 0));
    if (nc.ordenNumero) g.ordenes.add(nc.ordenNumero);
    acc.set(codigo, g);
  }
  const out = new Map<string, NcDeProveedor>();
  for (const [codigo, g] of acc) {
    out.set(codigo, { lineas: g.lineas, porMoneda: [...g.montos], ordenes: [...g.ordenes] });
  }
  return out;
}
