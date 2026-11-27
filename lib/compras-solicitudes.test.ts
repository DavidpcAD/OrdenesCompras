// Las tarjetas de la pestaña Solicitudes son la cola de trabajo de Proveeduría. Si
// una cuenta de más o de menos nadie lo nota en pantalla: simplemente se trabaja
// sobre la lista equivocada. Estas pruebas cuidan los cruces donde eso pasa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conteoSolicitudes, cumpleFiltro, diasDesde, esperaTexto, filtrarSolicitudes } from "./compras-solicitudes.ts";
import type { Pedido, PedidoLinea } from "./types.ts";

const linea = (o: Partial<PedidoLinea> = {}): PedidoLinea => ({
  id: "l1", articuloId: "M01-0001", descripcion: "Material de prueba", cantidad: 10, unidad: "UND",
  almacen: "ALM-PRUEBA", cantidadOrdenada: 0, ...o,
} as PedidoLinea);

const pedido = (o: Partial<Pedido> = {}): Pedido => ({
  id: "1", numero: "PED-000001", tipoSolicitud: "material", solicitante: "Persona de prueba",
  fecha: "2026-11-20", estado: "aprobado", prioridad: "normal", lineas: [linea()], ...o,
} as Pedido);

test("por gestionar = sin orden + parcial; lo 100 % ordenado no cuenta", () => {
  const sinOrden = pedido({ id: "a" });
  const parcial = pedido({ id: "b", lineas: [linea({ cantidadOrdenada: 4 })] });
  const ordenada = pedido({ id: "c", lineas: [linea({ cantidadOrdenada: 10 })] });
  const n = conteoSolicitudes([sinOrden, parcial, ordenada]);
  assert.equal(n.gestionar, 2);
  assert.equal(n.pendiente, 1);
  assert.equal(n.parcial, 1);
  assert.equal(n.ordenado, 1);
  assert.equal(n.todas, 3);
});

test("una urgente que ya se ordenó completa deja de contar como urgente", () => {
  const viva = pedido({ id: "a", prioridad: "urgente" });
  const resuelta = pedido({ id: "b", prioridad: "urgente", lineas: [linea({ cantidadOrdenada: 10 })] });
  const alta = pedido({ id: "c", prioridad: "alta" });
  assert.deepEqual(filtrarSolicitudes([viva, resuelta, alta], "urgentes").map((p) => p.id), ["a"]);
});

test("borrador y devuelta no son de Proveeduría: no cuentan en ningún filtro", () => {
  for (const estado of ["borrador", "devuelto"] as const) {
    const p = pedido({ estado });
    for (const f of ["gestionar", "pendiente", "urgentes", "todas", "archivadas"] as const) {
      assert.equal(cumpleFiltro(p, f), false, `${estado} en ${f}`);
    }
  }
});

test("la archivada vive solo en su pastilla, aunque le quede saldo", () => {
  const p = pedido({ estado: "cerrado", lineas: [linea({ cantidadOrdenada: 6 })] });
  assert.equal(cumpleFiltro(p, "archivadas"), true);
  assert.equal(cumpleFiltro(p, "parcial"), false);
  assert.equal(cumpleFiltro(p, "gestionar"), false);
  assert.equal(cumpleFiltro(p, "todas"), false);
});

test("días de espera por calendario, sin correrse por la zona horaria", () => {
  assert.equal(diasDesde("2026-11-27", "2026-11-27"), 0);
  assert.equal(diasDesde("2026-11-26T23:30:00", "2026-11-27"), 1);
  assert.equal(diasDesde("2026-10-31", "2026-11-03"), 3);
  assert.equal(diasDesde("", "2026-11-27"), null);
  assert.equal(esperaTexto(0), "hoy");
  assert.equal(esperaTexto(1), "ayer");
  assert.equal(esperaTexto(9), "hace 9 días");
});
