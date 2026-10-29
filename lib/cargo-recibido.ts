import type { LineaCargoHist } from "./types.ts";

// Cargo sobre factura recibida: la parte PURA (sin BC ni SQL), para que las pruebas
// la importen sin arrastrar lib/bc.ts ni la base.

/** Una factura de compra de BC del mismo proveedor y con el mismo N.º de factura. */
export interface FacturaMismoNumero {
  numero: string;   // CF-… (borrador) o CFR-… (registrada)
  estado: string;   // status tal como lo devuelve BC
  total: number;
  moneda: string;   // "" = colones
  fecha: string;    // yyyy-mm-dd
  url?: string;     // deep link a BC
}

export type TipoFacturaBc = "borrador" | "registrada" | "anulada";

// La API estándar trae en `purchaseInvoices` las registradas Y los borradores; lo
// único que las separa es `status`. Los enums con espacio pueden llegar escapados
// ("In_x0020_Review", igual que el activo fijo), así que se normaliza antes.
export function tipoDeFacturaBc(status: string): TipoFacturaBc {
  const s = (status ?? "").replace(/_x0020_/g, " ").trim().toLowerCase();
  if (s === "draft" || s === "in review") return "borrador";
  if (s === "canceled" || s === "cancelled") return "anulada";
  return "registrada"; // Open, Paid, Corrective
}

// Lo que importa para no duplicar: los borradores (alguien la estaba armando a mano
// en BC) y las ya registradas (BC va a rechazar el N.º repetido). Las anuladas no
// cuentan.
export function clasificarFacturasMismoNumero(fs: FacturaMismoNumero[]): { borradores: FacturaMismoNumero[]; registradas: FacturaMismoNumero[] } {
  const borradores: FacturaMismoNumero[] = [];
  const registradas: FacturaMismoNumero[] = [];
  for (const f of fs) {
    const t = tipoDeFacturaBc(f.estado);
    if (t === "borrador") borradores.push(f);
    else if (t === "registrada") registradas.push(f);
  }
  return { borradores, registradas };
}

// Importe TOTAL del cargo. Un cargo no siempre es 1 × monto (CP-005449 era 17 ×
// ₡1 121): es cantidad × precio, salvo que venga el total ya hecho.
export function importeDelCargo(input: { chargeAmount?: number; precio?: number; cantidad?: number }): number {
  if (input.chargeAmount != null && input.chargeAmount > 0) return input.chargeAmount;
  const cantidad = input.cantidad && input.cantidad > 0 ? input.cantidad : 1;
  return (Number(input.precio) || 0) * cantidad;
}

const texto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const numero = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// El detalle de líneas para el histórico. Manda lo que de verdad viajó a BC
// (`enviadas`); el resto de los datos (descripción, almacén, importe) los pone la
// pantalla, y si una línea no los trae igual queda su recepción y su N.º de línea.
// Los textos se recortan al tamaño de su columna en dbo.CargoRecibidoDet.
export function detalleParaHistorial(
  enviadas: { documentNo: string; lineNo: number }[],
  detalle: unknown,
): LineaCargoHist[] {
  const filas = Array.isArray(detalle) ? detalle : [];
  return enviadas.map((e) => {
    const d: any = filas.find((x: any) => x && x.documentNo === e.documentNo && Number(x.lineNo) === Number(e.lineNo)) ?? {};
    const asignado = Number(d.asignado);
    return {
      recepcionNo: texto(e.documentNo, 30),
      lineaNo: Number(e.lineNo) || 0,
      articuloNo: texto(d.itemNo, 40),
      descripcion: texto(d.descripcion, 200),
      almacen: texto(d.locationCode, 20),
      cantidad: numero(d.cantidad),
      importe: numero(d.importe),
      moneda: texto(d.currencyCode, 10),
      asignado: d.asignado != null && d.asignado !== "" && Number.isFinite(asignado) ? asignado : null,
    };
  });
}
