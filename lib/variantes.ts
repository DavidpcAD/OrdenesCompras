import { codigoDeItem } from "./unidad.ts";

// LA VARIANTE DEL MATERIAL, en un solo lugar.
//
// En BC el ítem es genérico ("PORCELANATO 60X60CM", "VARILLA DEFORME #3") y lo que
// distingue lo que hay que comprar vive en la VARIANTE: el grado de la varilla, el
// tipo de porcelanato, la talla del zapato. La solicitud guarda apenas el CÓDIGO
// (dbo.PedidoCompraDet.variantCode); el nombre está en BC.
//
// Sin el nombre, Proveeduría veía "M12-0014 · PORCELANATO 60X60CM" y no podía saber
// cuál pedirle al proveedor —ni el proveedor cuál cotizar—. Estas funciones son la
// parte pura (sin BC, sin React) que usan las pantallas, los dos PDF y los tests.

export type Variante = { code: string; descripcion: string };

const norm = (s?: string) => (s ?? "").trim().toUpperCase();

// Clave del mapa de nombres que viaja a los documentos: "M12-0014|0042".
// Se normaliza ítem y código porque el itemNo de una línea puede venir con la
// variante pegada ("M11-0081 -VAR 12") y en mayúsculas/minúsculas mezcladas.
export function claveVariante(itemNo?: string, code?: string): string {
  return `${norm(codigoDeItem(itemNo ?? ""))}|${norm(code)}`;
}

// Nombre de la variante de una línea, buscado en el mapa que trajo BC. "" si no se
// conoce (BC no contestó, o la variante ya no existe): el código solo es mejor que
// un renglón en blanco.
export function nombreDeVariante(nombres: Record<string, string>, itemNo?: string, code?: string): string {
  if (!norm(code)) return "";
  return (nombres[claveVariante(itemNo, code)] ?? "").trim();
}

// Lo que se muestra/imprime: "0042 — ZAPATO FAL DUERO … NO. 42". Sin nombre, el
// código; sin código, "" (la línea no lleva variante y no hay nada que decir).
export function etiquetaVariante(code?: string, nombre?: string): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  const n = (nombre ?? "").trim();
  // El nombre de la variante a veces ES el código (BC lo copia cuando no le
  // pusieron descripción): repetirlo dos veces no informa nada.
  return n && norm(n) !== norm(c) ? `${c} — ${n}` : c;
}

// La línea NO dice cuál variante es y el ítem tiene varias: hay que preguntar antes
// de comprar. Con UNA sola variante no falta nada que elegir, y con el catálogo
// vacío (o BC caído) no se puede afirmar que falte.
export function faltaVariante(code: string | undefined, variantes: Variante[]): boolean {
  return !(code ?? "").trim() && (variantes ?? []).length > 1;
}

// La descripción tal como se IMPRIME en los documentos del proveedor: el material y,
// debajo, su variante. En un solo lugar para que la solicitud de cotización y la
// orden digan lo mismo, y para que el alto de la fila del PDF se calcule sobre el
// texto completo (si no, la variante se le monta encima a la línea siguiente).
export function descripcionParaDocumento(descripcion: string | undefined, etiqueta: string): string {
  const desc = (descripcion ?? "").trim() || "—";
  return etiqueta ? `${desc}\nVariante: ${etiqueta}` : desc;
}
