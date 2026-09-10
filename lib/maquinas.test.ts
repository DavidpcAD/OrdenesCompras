import { test } from "node:test";
import assert from "node:assert/strict";
import { lineasPorMaquina, pendientePorAsignar, repartirEnPartesIguales, totalAsignado } from "./maquinas.ts";

test("tres filtros entre tres máquinas: uno para cada una", () => {
  assert.deepEqual(repartirEnPartesIguales(3, 3), [1, 1, 1]);
});

test("una cantidad entera no se parte en pedazos: 5 entre 2 son 3 y 2", () => {
  assert.deepEqual(repartirEnPartesIguales(5, 2), [3, 2]);
  assert.deepEqual(repartirEnPartesIguales(10, 3), [4, 3, 3]);
});

test("material fraccionado sí se parte parejo y la suma cuadra", () => {
  const partes = repartirEnPartesIguales(7.5, 2);
  assert.deepEqual(partes, [3.75, 3.75]);
  assert.equal(partes.reduce((s, p) => s + p, 0), 7.5);
});

test("sin máquinas, o sin cantidad, no hay nada que repartir", () => {
  assert.deepEqual(repartirEnPartesIguales(3, 0), []);
  assert.deepEqual(repartirEnPartesIguales(0, 3), []);
});

test("lo asignado y lo que falta", () => {
  const as = [{ no: "MAQ00017", nombre: "CAMION FOTON", cantidad: 2 }];
  assert.equal(totalAsignado(as), 2);
  assert.equal(pendientePorAsignar(3, as), 1);
  // Repartir más de lo que trae la línea da negativo: la pantalla lo avisa.
  assert.equal(pendientePorAsignar(1, as), -1);
});

test("la línea se parte en una por máquina", () => {
  const ls = lineasPorMaquina(3, [
    { no: "MAQ00017", nombre: "CAMION FOTON", cantidad: 1 },
    { no: "MAQ00018", nombre: "CAMION HYUNDAI", cantidad: 1 },
    { no: "MAQ00020", nombre: "CAMION JAC", cantidad: 1 },
  ]);
  assert.equal(ls.length, 3);
  assert.deepEqual(ls.map((l) => l.maquinaNo), ["MAQ00017", "MAQ00018", "MAQ00020"]);
  assert.deepEqual(ls.map((l) => l.cantidad), [1, 1, 1]);
});

test("lo que sobra queda en una línea SIN máquina, no se pierde", () => {
  const ls = lineasPorMaquina(3, [{ no: "MAQ00017", nombre: "CAMION FOTON", cantidad: 2 }]);
  assert.equal(ls.length, 2);
  assert.deepEqual(ls[1], { maquinaNo: "", maquinaNombre: "", cantidad: 1 });
});

test("sin asignaciones la línea queda como venía", () => {
  assert.deepEqual(lineasPorMaquina(3, []), [{ maquinaNo: "", maquinaNombre: "", cantidad: 3 }]);
});

test("una máquina con la cantidad completa no parte nada", () => {
  const ls = lineasPorMaquina(3, [{ no: "MAQ00005", nombre: "TRACTOR", cantidad: 3 }]);
  assert.deepEqual(ls, [{ maquinaNo: "MAQ00005", maquinaNombre: "TRACTOR", cantidad: 3 }]);
});
