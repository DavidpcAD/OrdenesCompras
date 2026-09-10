// UN REPUESTO PARA CADA MÁQUINA ES UNA LÍNEA PARA CADA MÁQUINA.
//
// En Business Central el equipo que consume el repuesto viaja en la LÍNEA del
// pedido de compra (N.º máquina, del parque de maquinaria GomEqp), no en el
// encabezado. O sea que "tres filtros para tres máquinas" NO es una línea de 3:
// son tres líneas de 1, cada una con su máquina. En una sola línea el costo cae
// en montón y ninguna de las tres máquinas queda con su historial de repuestos.
//
// Esto es la parte pura del reparto —sin React y sin BC—: repartir la cantidad de
// una línea entre máquinas, saber cuánto falta por asignar y partir la línea en
// las que van a viajar. La usan la pantalla de compra directa y sus pruebas.

export type AsignacionMaquina = { no: string; nombre: string; cantidad: number };

// Cantidad que va a viajar en UNA línea: su máquina (vacío = sin máquina, la
// línea entra como cualquier material) y cuánto.
export type LineaDeMaquina = { maquinaNo: string; maquinaNombre: string; cantidad: number };

// Cuatro decimales: es lo que aguanta `quantity` en SQL (decimal(18,4)) y lo que
// acepta BC. Sin esto, 10 / 3 deja 3,333333333333333 en la línea.
const redondear = (n: number) => Number(Number(n).toFixed(4));

// Repartir `total` entre `partes` máquinas.
//
// Con una cantidad ENTERA el reparto también es entero y el sobrante se le suma a
// las primeras: 5 filtros entre 2 máquinas son 3 y 2, nunca 2,5 y 2,5 (medio
// filtro no existe, y BC recibiría una línea que nadie puede recibir). Con una
// cantidad fraccionada —material que se compra por KG o M3— sí se parte parejo y
// la última se queda con la diferencia del redondeo, para que la suma cuadre.
export function repartirEnPartesIguales(total: number, partes: number): number[] {
  const t = Number(total) || 0;
  const n = Math.floor(Number(partes) || 0);
  if (n <= 0 || t <= 0) return [];
  if (Number.isInteger(t)) {
    const base = Math.floor(t / n);
    const resto = t - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
  }
  const cada = redondear(t / n);
  const out = Array.from({ length: n }, () => cada);
  out[n - 1] = redondear(t - cada * (n - 1));
  return out;
}

// Lo ya repartido entre las máquinas.
export function totalAsignado(asignaciones: AsignacionMaquina[]): number {
  return redondear((asignaciones ?? []).reduce((s, a) => s + (Number(a.cantidad) || 0), 0));
}

// Lo que queda sin máquina. Negativo = se repartió MÁS de lo que trae la línea
// (hay que avisarlo: BC recibiría más de lo que se compró).
export function pendientePorAsignar(total: number, asignaciones: AsignacionMaquina[]): number {
  return redondear((Number(total) || 0) - totalAsignado(asignaciones));
}

// Las líneas en las que queda partida la línea original: una por máquina con
// cantidad, y —si sobró— una última SIN máquina con el resto, que sigue siendo
// una compra legítima (dos filtros para dos máquinas y uno de repuesto a bodega).
// Sin asignaciones devuelve la línea tal como venía: nada que partir.
export function lineasPorMaquina(total: number, asignaciones: AsignacionMaquina[]): LineaDeMaquina[] {
  const t = Number(total) || 0;
  const out: LineaDeMaquina[] = (asignaciones ?? [])
    .filter((a) => a.no && (Number(a.cantidad) || 0) > 0)
    .map((a) => ({ maquinaNo: a.no, maquinaNombre: a.nombre ?? "", cantidad: redondear(Number(a.cantidad)) }));
  const resto = pendientePorAsignar(t, out.map((l) => ({ no: l.maquinaNo, nombre: l.maquinaNombre, cantidad: l.cantidad })));
  if (resto > 0) out.push({ maquinaNo: "", maquinaNombre: "", cantidad: resto });
  return out.length ? out : [{ maquinaNo: "", maquinaNombre: "", cantidad: redondear(t) }];
}
