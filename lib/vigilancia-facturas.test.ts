// Las señales de vigilancia que salen de BC solo. Lo que se prueba acá es que la
// lista NO grite de más: un detector que marca 811 pares cuando 15 son reales no lo
// lee nadie, y el que lo lee deja de confiar en él.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  borradoresSinRegistrar, posiblesDobles, proveedoresCallados,
  proveedoresSinCedula, fichasDuplicadas, normalizarNumero, estaRegistrada, totalPorMoneda,
  type FacturaBc, type ProveedorBc,
} from "./vigilancia-facturas.ts";

const fac = (
  numero: string, numeroProveedor: string, proveedorCodigo: string,
  fecha: string, total: number, moneda = "CRC", proveedorNombre = proveedorCodigo,
): FacturaBc => ({ numero, numeroProveedor, proveedorCodigo, proveedorNombre, fecha, total, moneda });

// --- lo básico -------------------------------------------------------------

test("una factura registrada lleva la serie CFR; lo demás es borrador", () => {
  assert.equal(estaRegistrada({ numero: "CFR-010077" }), true);
  assert.equal(estaRegistrada({ numero: "CF-005124" }), false);
  // El caso real: 25 borradores traían un consecutivo de Hacienda como número.
  assert.equal(estaRegistrada({ numero: "00100001080000002469" }), false);
});

test("el número del proveedor se compara sin ceros de adelante ni puntos", () => {
  assert.equal(normalizarNumero("029644"), "29644");
  assert.equal(normalizarNumero("29.644"), "29644");
  assert.equal(normalizarNumero("8415-1"), "84151");
  assert.equal(normalizarNumero(""), "");
});

// --- borradores ------------------------------------------------------------

test("los borradores salen de la más vieja a la más nueva", () => {
  const r = borradoresSinRegistrar([
    fac("CFR-010077", "81028", "PROV-001717", "2026-08-27", 25119.45),
    fac("CF-005124", "17961", "PROV-000522", "2026-09-16", 44233.04),
    fac("00100001080000002476", "644231", "PROV-000411", "2025-11-26", 604610.57),
  ]);
  assert.deepEqual(r.map((f) => f.numero), ["00100001080000002476", "CF-005124"]);
});

// --- posibles dobles -------------------------------------------------------

test("agarra el par con sufijo -1: mismo proveedor, mismo monto, número prefijo", () => {
  const r = posiblesDobles([
    fac("CFR-009096", "8415", "PROV-000744", "2026-08-11", 1865956),
    fac("CFR-009097", "8415-1", "PROV-000744", "2026-08-11", 1865956),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].a.numero, "CFR-009096");
  assert.equal(r[0].dias, 0);
});

test("NO marca al proveedor que factura el mismo monto todas las semanas", () => {
  // Zavillana: ₡15.000 semanales con números correlativos. La regla suelta (mismo
  // proveedor + mismo monto) los daba por dobles; ninguno es prefijo del otro.
  const r = posiblesDobles([
    fac("CFR-008902", "16270", "PROV-000358", "2026-08-03", 15000),
    fac("CFR-009228", "16627", "PROV-000358", "2026-08-10", 15000),
    fac("CFR-009662", "16985", "PROV-000358", "2026-08-17", 15000),
    fac("CFR-009663", "17367", "PROV-000358", "2026-08-24", 15000),
  ]);
  assert.deepEqual(r, []);
});

test("no confunde proveedores distintos ni monedas distintas", () => {
  const r = posiblesDobles([
    fac("CFR-1", "8415", "PROV-A", "2026-08-11", 1000),
    fac("CFR-2", "8415-1", "PROV-B", "2026-08-11", 1000),          // otro proveedor
    fac("CFR-3", "9200", "PROV-A", "2026-08-11", 1000, "CRC"),
    fac("CFR-4", "9200-1", "PROV-A", "2026-08-11", 1000, "USD"),   // otra moneda
  ]);
  assert.deepEqual(r, []);
});

test("deja pasar los borradores y los documentos en cero", () => {
  const r = posiblesDobles([
    fac("CF-1", "8415", "PROV-A", "2026-08-11", 1000),
    fac("CF-2", "8415-1", "PROV-A", "2026-08-11", 1000),
    // Los ₡0,00 son los documentos vacíos que deja BC al borrar un pedido.
    fac("CFR-3", "700", "PROV-A", "2026-08-11", 0),
    fac("CFR-4", "700-1", "PROV-A", "2026-08-11", 0),
  ]);
  assert.deepEqual(r, []);
});

test("números cortos no hacen par: '7' es prefijo de medio mundo", () => {
  const r = posiblesDobles([
    fac("CFR-1", "7", "PROV-A", "2026-08-11", 1000),
    fac("CFR-2", "700", "PROV-A", "2026-08-11", 1000),
  ]);
  assert.deepEqual(r, []);
});

test("ordena por monto: lo que más plata pone en juego primero", () => {
  const r = posiblesDobles([
    fac("CFR-1", "5818", "PROV-A", "2026-08-01", 5000),
    fac("CFR-2", "5818-1", "PROV-A", "2026-08-01", 5000),
    fac("CFR-3", "311726", "PROV-B", "2026-07-08", 3213379.21),
    fac("CFR-4", "311726-1", "PROV-B", "2026-07-16", 3213379.21),
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].a.proveedorCodigo, "PROV-B");
  assert.equal(r[0].dias, 8);
});

// --- proveedores callados --------------------------------------------------

const cada = (codigo: string, desde: string, n: number, pasoDias: number): FacturaBc[] => {
  const t0 = Date.parse(desde);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(t0 + i * pasoDias * 86_400_000).toISOString().slice(0, 10);
    return fac(`CFR-${codigo}-${i}`, String(1000 + i), codigo, d, 1000);
  });
};

test("marca al que facturaba cada 2 días y lleva 40 sin aparecer", () => {
  // Vidralsa, el caso real: 161 facturas al año y silencio desde el 13 de agosto.
  const r = proveedoresCallados(cada("PROV-VID", "2026-01-01", 100, 2), "2026-09-22");
  assert.equal(r.length, 1);
  assert.equal(r[0].codigo, "PROV-VID");
  assert.ok(r[0].diasCallado > 30, `esperaba silencio largo, dio ${r[0].diasCallado}`);
});

test("no marca al que sigue facturando al día", () => {
  const r = proveedoresCallados(cada("PROV-VIVO", "2026-06-01", 50, 2), "2026-09-22");
  // La última cae el 27 de setiembre — todavía no ha pasado nada.
  assert.deepEqual(r, []);
});

test("no marca al proveedor de pocas facturas: sin ritmo no hay silencio", () => {
  const pocas = cada("PROV-RARO", "2025-11-01", 3, 30);
  assert.deepEqual(proveedoresCallados(pocas, "2026-09-22"), []);
});

test("el piso de 30 días evita que el de todos los días grite cada fin de semana", () => {
  // Factura a diario y la última fue hace 10 días: 4× su ritmo son 4 días, pero el
  // piso manda.
  const diario = cada("PROV-DIA", "2026-06-01", 100, 1);
  const ultima = diario[diario.length - 1].fecha;
  const hoy = new Date(Date.parse(ultima) + 10 * 86_400_000).toISOString().slice(0, 10);
  assert.deepEqual(proveedoresCallados(diario, hoy), []);
});

test("ordena por volumen: el que más factura duele más callado", () => {
  const r = proveedoresCallados(
    [...cada("PROV-CHICO", "2026-01-01", 10, 5), ...cada("PROV-GRANDE", "2026-01-01", 60, 2)],
    "2026-09-22",
  );
  assert.deepEqual(r.map((p) => p.codigo), ["PROV-GRANDE", "PROV-CHICO"]);
});

// --- proveedores sin cédula ------------------------------------------------

const prov = (codigo: string, nombre: string, cedula = ""): ProveedorBc => ({ codigo, nombre, cedula });

test("los sin cédula salen ordenados por cuántas facturas mueven", () => {
  const proveedores = [
    prov("PROV-000522", "FERRETERIA EPA S.A"),
    prov("PROV-001717", "Multisuministros", "3101629776"),
    prov("PROV-000740", "INDUSTRIAS BRENES S.A."),
  ];
  const facturas = [
    ...cada("PROV-000522", "2026-01-01", 5, 7),
    ...cada("PROV-000740", "2026-01-01", 2, 7),
    ...cada("PROV-001717", "2026-01-01", 9, 7),
  ];
  const r = proveedoresSinCedula(facturas, proveedores);
  assert.deepEqual(r.map((p) => p.codigo), ["PROV-000522", "PROV-000740"]);
  assert.equal(r[0].facturas, 5);
  assert.equal(r[0].nombre, "FERRETERIA EPA S.A");
});

test("una cédula a medio llenar cuenta como sin cédula", () => {
  const r = proveedoresSinCedula(
    [fac("CFR-1", "1", "PROV-X", "2026-01-01", 100)],
    [prov("PROV-X", "A medias", "3-101")],
  );
  assert.equal(r.length, 1);
});

test("la cédula con guiones sí vale", () => {
  const r = proveedoresSinCedula(
    [fac("CFR-1", "1", "PROV-X", "2026-01-01", 100)],
    [prov("PROV-X", "Con guiones", "3-101-191491")],
  );
  assert.deepEqual(r, []);
});

// --- fichas duplicadas -----------------------------------------------------

test("junta las fichas que comparten cédula y dice cuántas facturas tiene cada una", () => {
  const proveedores = [
    prov("PROV-000018", "AUTOSERVICIO AGUA CALIENTE S.A.", "3101094538"),
    prov("PROV-000061", "Auto Servicios Agua Caliente", "3101094538"),
    prov("PROV-001717", "Multisuministros", "3101629776"),
  ];
  const facturas = cada("PROV-000018", "2026-01-01", 3, 30);
  const r = fichasDuplicadas(proveedores, facturas);
  assert.equal(r.length, 1);
  assert.equal(r[0].cedula, "3101094538");
  // La ficha viva primero, la vacía después: así se ve de una que es borrable.
  assert.deepEqual(r[0].fichas.map((f) => f.facturas), [3, 0]);
});

test("primero las partidas de verdad, con facturas en las dos fichas", () => {
  const proveedores = [
    prov("PROV-A1", "Una viva", "3101000001"), prov("PROV-A2", "Una vacía", "3101000001"),
    prov("PROV-B1", "Partida 1", "3101000002"), prov("PROV-B2", "Partida 2", "3101000002"),
  ];
  const facturas = [
    ...cada("PROV-A1", "2026-01-01", 4, 30),
    ...cada("PROV-B1", "2026-01-01", 2, 30), ...cada("PROV-B2", "2026-02-01", 2, 30),
  ];
  const r = fichasDuplicadas(proveedores, facturas);
  assert.equal(r[0].cedula, "3101000002");
});

// --- totales por moneda ----------------------------------------------------

test("separa los colones de las otras monedas en vez de sumarlo todo", () => {
  const r = totalPorMoneda([
    { total: 1000, moneda: "CRC" },
    { total: 500, moneda: "CRC" },
    { total: 517.31, moneda: "USD" },
    { total: 20, moneda: "EURO" },
    { total: 80, moneda: "EURO" },
  ]);
  assert.equal(r.colones, 1500);
  assert.deepEqual(r.otras, [
    { moneda: "EURO", total: 100, n: 2 },
    { moneda: "USD", total: 517.31, n: 1 },
  ]);
});

test("sin monedas raras la lista de otras viene vacía", () => {
  assert.deepEqual(totalPorMoneda([{ total: 10, moneda: "CRC" }]).otras, []);
});
