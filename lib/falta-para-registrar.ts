/* ============================================================================
   ¿QUÉ FALTA PARA PODER REGISTRAR LA FACTURA?

   «Registrar factura» se apaga cuando falta algo, y hasta nov 2026 se apagaba sin
   decir qué: Bodega veía el botón gris, el total bien y "Recepción completa", y no
   tenía cómo saber que el N.º de factura (arriba de todo, fuera de la pantalla en
   el celular) estaba vacío.

   Esta lista es LA regla del botón: la pantalla lo apaga si trae algo, y muestra
   lo mismo como aviso. Una sola fuente, para que el aviso no pueda decir una cosa
   mientras el botón decide otra.
   ============================================================================ */

export type DatosParaRegistrar = {
  algoRecibido: boolean;     // al menos una línea con cantidad > 0
  numeroFactura: string;     // N.º de factura del proveedor (el del papel)
  tarjetaOn: boolean;        // "Pago con tarjeta" marcado (solo Contabilidad)
  tarjeta: string;           // forma de pago
  dimCode: string;           // dimensión del encabezado
  dimValue: string;          // valor de esa dimensión
};

/** Lo que falta, en el orden en que aparece en la pantalla. Vacía = se puede registrar. */
export function faltaParaRegistrar(d: DatosParaRegistrar): string[] {
  const falta: string[] = [];
  if (!String(d.numeroFactura ?? "").trim()) falta.push("el N.º de factura del proveedor");
  if (d.tarjetaOn) {
    if (!String(d.tarjeta ?? "").trim()) falta.push("la tarjeta");
    if (!String(d.dimCode ?? "").trim()) falta.push("la dimensión");
    if (!String(d.dimValue ?? "").trim()) falta.push("el valor de la dimensión");
  }
  if (!d.algoRecibido) falta.push("la cantidad que llegó en al menos una línea");
  return falta;
}

/** "a", "a y b", "a, b y c". */
export function unirConY(cosas: string[]): string {
  if (cosas.length <= 1) return cosas[0] ?? "";
  return `${cosas.slice(0, -1).join(", ")} y ${cosas[cosas.length - 1]}`;
}
