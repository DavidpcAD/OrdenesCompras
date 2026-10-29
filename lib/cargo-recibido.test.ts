import { test } from "node:test";
import assert from "node:assert/strict";
import { clasificarFacturasMismoNumero, detalleParaHistorial, importeDelCargo, tipoDeFacturaBc } from "./cargo-recibido.ts";

test("el status de BC separa borradores, registradas y anuladas", () => {
  assert.equal(tipoDeFacturaBc("Draft"), "borrador");
  assert.equal(tipoDeFacturaBc("In Review"), "borrador");
  assert.equal(tipoDeFacturaBc("In_x0020_Review"), "borrador"); // enum escapado de OData
  assert.equal(tipoDeFacturaBc("Open"), "registrada");
  assert.equal(tipoDeFacturaBc("Paid"), "registrada");
  assert.equal(tipoDeFacturaBc("Corrective"), "registrada");
  assert.equal(tipoDeFacturaBc("Canceled"), "anulada");
});

test("la 834 de Green Mountain: un borrador que quedó y la registrada desde la app", () => {
  const { borradores, registradas } = clasificarFacturasMismoNumero([
    { numero: "CF-005837", estado: "Draft", total: 14179.41, moneda: "USD", fecha: "2026-10-28" },
    { numero: "CFR-011966", estado: "Open", total: 14179.41, moneda: "USD", fecha: "2026-10-28" },
    { numero: "CFR-000001", estado: "Canceled", total: 1, moneda: "", fecha: "2026-01-01" },
  ]);
  assert.deepEqual(borradores.map((f) => f.numero), ["CF-005837"]);
  assert.deepEqual(registradas.map((f) => f.numero), ["CFR-011966"]);
});

test("un cargo con cantidad vale cantidad × precio, salvo que venga el total", () => {
  assert.equal(importeDelCargo({ precio: 1121, cantidad: 17 }), 19057);
  assert.equal(importeDelCargo({ precio: 14179.41 }), 14179.41);
  assert.equal(importeDelCargo({ precio: 500, cantidad: 0 }), 500);
  assert.equal(importeDelCargo({ chargeAmount: 300, precio: 1, cantidad: 2 }), 300);
});

test("el detalle del histórico guarda solo lo que viajó a BC", () => {
  const lineas = detalleParaHistorial(
    [{ documentNo: "CR-011175", lineNo: 20000 }, { documentNo: "CR-011176", lineNo: 10000 }],
    [
      { documentNo: "CR-011175", lineNo: 20000, itemNo: "LOT-VN", descripcion: "VN-I.03 - CORRESPONDE A TRASPASO DE LOTE",
        locationCode: "LOTES", cantidad: 1, importe: 234708.66, currencyCode: "", asignado: 14179.41 },
      { documentNo: "CR-099999", lineNo: 10000, itemNo: "NO-SE-MANDO" },
    ],
  );
  assert.equal(lineas.length, 2);
  assert.deepEqual(lineas[0], {
    recepcionNo: "CR-011175", lineaNo: 20000, articuloNo: "LOT-VN", descripcion: "VN-I.03 - CORRESPONDE A TRASPASO DE LOTE",
    almacen: "LOTES", cantidad: 1, importe: 234708.66, moneda: "", asignado: 14179.41,
  });
  // Sin datos de la pantalla igual queda la recepción y su línea; el reparto queda en blanco.
  assert.equal(lineas[1].recepcionNo, "CR-011176");
  assert.equal(lineas[1].descripcion, "");
  assert.equal(lineas[1].asignado, null);
});

test("el reparto por peso o volumen no se inventa, y los textos caben en su columna", () => {
  const [l] = detalleParaHistorial(
    [{ documentNo: "CR-1", lineNo: 1 }],
    [{ documentNo: "CR-1", lineNo: 1, descripcion: "x".repeat(500), asignado: null }],
  );
  assert.equal(l.asignado, null);
  assert.equal(l.descripcion.length, 200);
});
