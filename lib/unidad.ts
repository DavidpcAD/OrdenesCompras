// Unidad de COMPRA vs unidad BASE de un material.
//
// En BC un material puede tener dos unidades distintas y las dos son correctas:
//   · la BASE, con la que se lleva el inventario y la consume la obra
//     (el adhesivo M06-0009 tiene base GR porque la fórmula lo usa en gramos);
//   · la de COMPRA, con la que se le pide al proveedor
//     (ese mismo adhesivo se compra por ESTAÑON, y 1 EST son 255.000 GR).
//
// La app usaba la base para todo, así que la orden decía "1 GR" y le pegaba a la
// línea el costo POR GRAMO (₡1,74) en lugar del precio por estañón (₡442.435).
// BC, en cambio, siempre arma la línea del pedido con la unidad de COMPRA: al
// validar el N.º de artículo copia `Item."Purch. Unit of Measure"`. O sea que la
// cantidad y el precio que la app le manda a BC se interpretan en estañones.
// Por eso acá la regla es una sola: en un documento de compra manda la unidad de
// compra, y todo precio viaja junto con la unidad a la que corresponde.

export type UnidadItem = {
  base: string;             // GR
  compra: string;           // EST
  factor?: number;          // 255000 unidades base por cada unidad de compra
};

export type PrecioRef = {
  precio: number;
  unidad: string;           // la unidad a la que corresponde ESE precio
  moneda: string;           // "" = colones (moneda local de BC)
  factor?: number;
};

const norm = (u?: string) => (u ?? "").trim().toUpperCase();

// La unidad con la que hay que pedirle al proveedor. Sin dato de BC se respeta lo
// que ya traía la línea: nunca se inventa una unidad.
export function unidadDeCompra(u: UnidadItem | undefined, guardada = ""): string {
  const compra = norm(u?.compra);
  return compra || norm(guardada) || "";
}

// ¿Se corrige la unidad que quedó guardada en la línea?
//
// Solo cuando la guardada es exactamente la BASE y BC compra en otra unidad: esa
// línea heredó la base por defecto (la app la copiaba del catálogo), nadie la
// eligió. Si alguien guardó cualquier otra cosa se respeta — puede ser una
// decisión deliberada, y reinterpretar una cantidad ajena es cambiar el pedido.
export function unidadCorregida(guardada: string, u?: UnidadItem): string {
  const g = norm(guardada);
  const base = norm(u?.base);
  const compra = norm(u?.compra);
  if (!compra || !base || base === compra) return g;
  return g === base ? compra : g;
}

// "1 EST = 255.000 GR" — para que nadie tenga que adivinar qué es un estañón.
// Null cuando no hay nada que aclarar (una sola unidad, o factor desconocido).
export function equivalencia(u?: UnidadItem): string | null {
  const base = norm(u?.base);
  const compra = norm(u?.compra);
  const f = Number(u?.factor ?? 0);
  if (!base || !compra || base === compra || !(f > 1)) return null;
  // Mismo formateo que el resto de la app (Intl es-CR, como `num` de helpers).
  return `1 ${compra} = ${new Intl.NumberFormat("es-CR", { maximumFractionDigits: 2 }).format(f)} ${base}`;
}

// Precio de referencia llevado a la unidad de la línea.
//
// Devuelve null cuando no se puede convertir con certeza, y eso es a propósito:
// más vale que Proveeduría escriba el precio que negoció, que ver un número que
// parece un precio y está 255.000 veces abajo.
export function precioEnUnidad(ref: PrecioRef | null | undefined, unidadLinea: string, unidadBase: string): number | null {
  if (!ref || !(ref.precio > 0)) return null;
  const rU = norm(ref.unidad);
  const lU = norm(unidadLinea);
  const base = norm(unidadBase);
  const f = Number(ref.factor ?? 0);
  if (!rU || !lU) return null;
  if (rU === lU) return ref.precio;                      // misma unidad: directo
  if (!(f > 0)) return null;                             // sin factor no se convierte
  if (rU === base) return ref.precio * f;                // costo por gramo -> por estañón
  if (lU === base) return ref.precio / f;                // precio por estañón -> por gramo
  return null;                                           // dos unidades alternas: no se adivina
}

// ¿La moneda del precio de referencia es la misma de la orden?
// "" y "CRC" son lo mismo: BC deja la moneda local en blanco.
export function mismaMoneda(a?: string, b?: string): boolean {
  const n = (m?: string) => { const x = norm(m); return x === "CRC" ? "" : x; };
  return n(a) === n(b);
}
