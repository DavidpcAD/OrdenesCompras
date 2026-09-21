// Pruebas de las cuentas con fechas "solo día". Lo que se protege acá es el bug de
// siempre: que la zona horaria de Costa Rica (UTC−6) corra un día para atrás.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { diasEnMes, entre, nombreMes, ordenarRango, primerDiaSemana, primeroDelMes, sumarDias, sumarMeses, textoRango, ultimoDelMes } from "./fechas.ts";

test("sumar y restar días cruza mes, año y bisiesto sin correrse", () => {
  assert.equal(sumarDias("2026-09-21", 1), "2026-09-22");
  assert.equal(sumarDias("2026-09-30", 1), "2026-10-01");
  assert.equal(sumarDias("2026-01-01", -1), "2025-12-31");
  assert.equal(sumarDias("2026-09-21", -6), "2026-09-15");
  // 2028 sí es bisiesto; 2026 no.
  assert.equal(sumarDias("2028-02-28", 1), "2028-02-29");
  assert.equal(sumarDias("2026-02-28", 1), "2026-03-01");
  // El día no se mueve al sumar cero: es el caso que delataba el parseo en UTC.
  assert.equal(sumarDias("2026-09-21", 0), "2026-09-21");
});

test("los días del mes salen bien, febrero incluido", () => {
  assert.equal(diasEnMes(2026, 9), 30);
  assert.equal(diasEnMes(2026, 12), 31);
  assert.equal(diasEnMes(2026, 2), 28);
  assert.equal(diasEnMes(2028, 2), 29);
});

// La semana arranca el LUNES, como el calendario en español. El 1.º de junio de 2026
// cae lunes (0) y el 1.º de septiembre de 2026, martes (1).
test("la semana arranca el lunes", () => {
  assert.equal(primerDiaSemana(2026, 6), 0);
  assert.equal(primerDiaSemana(2026, 9), 1);
  assert.equal(primerDiaSemana(2026, 11), 6);   // 1 de noviembre de 2026: domingo
});

test("correr el mes cruza el año en los dos sentidos", () => {
  assert.deepEqual(sumarMeses(2026, 9, 1), { y: 2026, m: 10 });
  assert.deepEqual(sumarMeses(2026, 12, 1), { y: 2027, m: 1 });
  assert.deepEqual(sumarMeses(2026, 1, -1), { y: 2025, m: 12 });
  assert.deepEqual(sumarMeses(2026, 1, -13), { y: 2024, m: 12 });
});

test("primero y último del mes", () => {
  assert.equal(primeroDelMes(2026, 9), "2026-09-01");
  assert.equal(ultimoDelMes(2026, 9), "2026-09-30");
  assert.equal(ultimoDelMes(2028, 2), "2028-02-29");
});

test("entre() no depende del orden de las puntas", () => {
  assert.equal(entre("2026-09-21", "2026-09-01", "2026-09-30"), true);
  assert.equal(entre("2026-09-21", "2026-09-30", "2026-09-01"), true);
  assert.equal(entre("2026-10-01", "2026-09-01", "2026-09-30"), false);
  assert.equal(entre("2026-09-01", "2026-09-01", "2026-09-01"), true);
});

test("un rango elegido al revés se ordena solo", () => {
  assert.deepEqual(ordenarRango({ from: "2026-09-30", to: "2026-09-01" }), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(ordenarRango({ from: "2026-09-01", to: "2026-09-30" }), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(ordenarRango({ from: "2026-09-01" }), { from: "2026-09-01" });
  assert.deepEqual(ordenarRango({}), {});
});

test("el rango se lee como lo diría una persona", () => {
  assert.equal(textoRango({ from: "2026-06-21", to: "2026-09-21" }), "21/06/2026 → 21/09/2026");
  assert.equal(textoRango({ from: "2026-09-21", to: "2026-09-21" }), "21/09/2026");
  assert.equal(textoRango({ from: "2026-06-21" }), "desde el 21/06/2026");
  assert.equal(textoRango({ to: "2026-09-21" }), "hasta el 21/09/2026");
  assert.equal(textoRango({}), "Cualquier fecha");
  assert.equal(textoRango(undefined, "Todas"), "Todas");
});

test("el mes se escribe en español y sin el 'de'", () => {
  assert.equal(nombreMes(2026, 6), "junio 2026");
  assert.equal(nombreMes(2026, 12), "diciembre 2026");
});
