// QUÉ CAMBIÓ EN LA ORDEN, DICHO CON NOMBRE Y APELLIDO.
//
// El movimiento "editado" de la bitácora decía solo "1 línea(s)". Con eso, mirando
// CP-005249 seis días después, no había forma de saber qué se había tocado: si le
// cambiaron la cantidad, el precio, o si le quitaron una línea y le pusieron otra.
// El encabezado (proveedor y moneda) ya se registra aparte en `encabezado_cambiado`;
// esto es lo mismo para las LÍNEAS.
//
// Es una función pura a propósito: la parte que hay que poder probar sin base.

export interface LineaCambio {
  itemNo?: string | null;
  variantCode?: string | null;
  descripcion?: string | null;
  cantidad: number;
  precioUnitario: number;
}

/** Sin decimales inútiles: 40 y no "40.00", 6991.15 y no "6991.1500". */
function num(n: number): string {
  const r = Math.round((Number(n) || 0) * 100) / 100;
  return String(r);
}

/** Cómo se llama la línea en el mensaje. El código manda; la descripción respalda. */
function nombre(l: LineaCambio): string {
  const item = (l.itemNo ?? "").trim();
  const variante = (l.variantCode ?? "").trim();
  const desc = (l.descripcion ?? "").trim();
  const base = desc || item || "(sin descripción)";
  const codigo = item && desc ? ` ${item}` : "";
  return `${base}${codigo}${variante ? ` (${variante})` : ""}`;
}

// Dos líneas son "la misma" si son el mismo artículo y la misma variante. Sin código
// (una línea de texto o un cargo) manda la descripción. Se compara en mayúsculas y
// sin espacios de sobra porque el mismo artículo escrito distinto no es un cambio.
function clave(l: LineaCambio): string {
  const item = (l.itemNo ?? "").trim().toUpperCase();
  const variante = (l.variantCode ?? "").trim().toUpperCase();
  if (item) return `I:${item}|${variante}`;
  return `D:${(l.descripcion ?? "").trim().toUpperCase()}`;
}

function agrupar(lineas: LineaCambio[]): Map<string, LineaCambio[]> {
  const m = new Map<string, LineaCambio[]>();
  for (const l of lineas) {
    const k = clave(l);
    const ya = m.get(k);
    if (ya) ya.push(l); else m.set(k, [l]);
  }
  return m;
}

/**
 * Qué cambió entre las líneas viejas y las nuevas, en una frase para la bitácora.
 * Devuelve "" cuando no cambió nada en las líneas (el edit puede haber tocado solo
 * el encabezado o una nota, y decir "1 línea(s)" ahí es mentira).
 *
 * El mismo artículo repetido (dos líneas del mismo material para obras distintas) se
 * empareja en orden: la primera vieja con la primera nueva. No es perfecto, pero
 * nunca inventa un cambio que no pasó — a lo sumo lo cuenta como quitada + agregada.
 *
 * (cubierto por tests)
 */
export function resumirCambiosDeLineas(antes: LineaCambio[], despues: LineaCambio[], max = 6): string {
  const a = agrupar(antes ?? []);
  const d = agrupar(despues ?? []);
  const partes: string[] = [];

  for (const [k, viejas] of a) {
    const nuevas = d.get(k) ?? [];
    const pares = Math.min(viejas.length, nuevas.length);
    for (let i = 0; i < pares; i++) {
      const v = viejas[i], n = nuevas[i];
      const dif: string[] = [];
      if (num(v.cantidad) !== num(n.cantidad)) dif.push(`cantidad ${num(v.cantidad)} → ${num(n.cantidad)}`);
      if (num(v.precioUnitario) !== num(n.precioUnitario)) dif.push(`precio ${num(v.precioUnitario)} → ${num(n.precioUnitario)}`);
      if (dif.length) partes.push(`${nombre(n)}: ${dif.join(" y ")}`);
    }
    for (let i = pares; i < viejas.length; i++) partes.push(`quitada ${nombre(viejas[i])} ×${num(viejas[i].cantidad)}`);
  }

  for (const [k, nuevas] of d) {
    const viejas = a.get(k) ?? [];
    for (let i = viejas.length; i < nuevas.length; i++) partes.push(`agregada ${nombre(nuevas[i])} ×${num(nuevas[i].cantidad)}`);
  }

  if (!partes.length) return "";
  if (partes.length <= max) return partes.join(" · ");
  return `${partes.slice(0, max).join(" · ")} · y ${partes.length - max} cambio(s) más`;
}
