import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_NOTA, MSG_MOTIVO_CIERRE, PREFIJO_CIERRE,
  comentarioSinMarcasInternas, componerNotaCierre, detalleDeCierre, lineaCancelada,
  motivoDeCierre, motivoObligatorio, quitarNotaCierre, segmentosDeNota,
} from "./cierre-solicitud.ts";

// --- la regla dura: nunca se cierra sin decir por qué -------------------------
// Es el único requisito que David enunció explícito ("SIEMPRE poner una nota del
// porqué"), y vive acá porque la suite no puede importar repo.ts ni las rutas.

test("motivoObligatorio: sin motivo no se cierra", () => {
  for (const vacio of [undefined, "", "   ", "\n\t "]) {
    assert.throws(() => motivoObligatorio(vacio as any), /Escribí por qué/);
  }
  assert.equal(motivoObligatorio("  se compró en otro lado  "), "se compró en otro lado");
  // El mensaje es el que ve la usuaria: dice qué hacer y para qué sirve.
  assert.match(MSG_MOTIVO_CIERRE, /historial/);
});

test("componerNotaCierre y detalleDeCierre también exigen el motivo", () => {
  assert.throws(() => componerNotaCierre("   ", "algo"), /Escribí por qué/);
  assert.throws(() => detalleDeCierre({ nombres: [], unidades: 0 }, ""), /Escribí por qué/);
});

// --- la nota del pedido -------------------------------------------------------

test("componerNotaCierre: el motivo adelante y el comentario del ingeniero atrás", () => {
  assert.equal(
    componerNotaCierre("cambió el alcance", "Tapia prefabricada Central AD"),
    "⛔ Cerrada: cambió el alcance · Tapia prefabricada Central AD",
  );
  assert.equal(componerNotaCierre("ya no se necesita"), "⛔ Cerrada: ya no se necesita");
  assert.equal(componerNotaCierre("ya no se necesita", "   "), "⛔ Cerrada: ya no se necesita");
});

test("componerNotaCierre: nunca desborda la columna de 500", () => {
  const nota = componerNotaCierre("x".repeat(400), "y".repeat(400));
  assert.equal(nota.length, MAX_NOTA);
  assert.ok(nota.startsWith(PREFIJO_CIERRE));
});

test("componerNotaCierre: se apila sobre una devolución vieja sin pisarla", () => {
  const previa = "↩ Devuelto: pidió de más · Tapia prefabricada";
  const nota = componerNotaCierre("no hay presupuesto", previa);
  assert.equal(nota, "⛔ Cerrada: no hay presupuesto · ↩ Devuelto: pidió de más · Tapia prefabricada");
  assert.equal(segmentosDeNota(nota).length, 3);
});

test("motivoDeCierre: lo lee esté donde esté, y devuelve '' si no hubo cierre", () => {
  assert.equal(motivoDeCierre("⛔ Cerrada: se compró en otro lado · nota"), "se compró en otro lado");
  assert.equal(motivoDeCierre("↩ Devuelto: x · ⛔ Cerrada: y"), "y");
  assert.equal(motivoDeCierre("Tapia prefabricada"), "");
  assert.equal(motivoDeCierre(undefined), "");
});

test("quitarNotaCierre: deshacer el cierre saca su encabezado y deja lo demás", () => {
  assert.equal(
    quitarNotaCierre("⛔ Cerrada: me equivoqué · ↩ Devuelto: pidió de más · Tapia"),
    "↩ Devuelto: pidió de más · Tapia",
  );
  assert.equal(quitarNotaCierre("⛔ Cerrada: me equivoqué"), "");
  // Sin cierre en la nota, no toca nada (reabrir dos veces es inofensivo).
  assert.equal(quitarNotaCierre("Tapia prefabricada"), "Tapia prefabricada");
  assert.equal(quitarNotaCierre(undefined), "");
});

// --- lo que ve el PROVEEDOR ---------------------------------------------------
// El motivo del cierre es interno ("no hay presupuesto") igual que el de la
// devolución: no puede salir en el PDF que recibe el proveedor.

test("comentarioSinMarcasInternas: saca TODOS los encabezados apilados, no solo el primero", () => {
  assert.equal(
    comentarioSinMarcasInternas("⛔ Cerrada: no hay plata · ↩ Devuelto: pidió de más · Tapia prefabricada"),
    "Tapia prefabricada",
  );
  assert.equal(comentarioSinMarcasInternas("⛔ Cerrada: no hay plata"), "");
  assert.equal(comentarioSinMarcasInternas("↩ Devuelto: pidió de más"), "");
  assert.equal(comentarioSinMarcasInternas("Tapia prefabricada Central AD"), "Tapia prefabricada Central AD");
  assert.equal(comentarioSinMarcasInternas(undefined), "");
});

test("comentarioSinMarcasInternas: un comentario con '·' adentro no se parte de más", () => {
  assert.equal(
    comentarioSinMarcasInternas("⛔ Cerrada: x · Entregar en portón 2 · preguntar por Marvin"),
    "Entregar en portón 2 · preguntar por Marvin",
  );
});

// --- el detalle de la bitácora -----------------------------------------------

test("detalleDeCierre: dice qué quedó sin comprar y mantiene el ' · Motivo: '", () => {
  const d = detalleDeCierre({ nombres: ["CEMENTO 50KG", "VARILLA #3"], unidades: 30 }, "se compró en otro lado");
  assert.equal(d, "Cerrada con 2 línea(s) sin ordenar (30 u.): CEMENTO 50KG; VARILLA #3 · Motivo: se compró en otro lado");
  // La convención de separador es la que ya parsea repo.ts para las devoluciones.
  assert.equal(d.split(/·\s*Motivo:\s*/i)[1], "se compró en otro lado");
});

test("detalleDeCierre: sin saldo pendiente lo dice, no inventa líneas", () => {
  assert.equal(
    detalleDeCierre({ nombres: [], unidades: 0 }, "duplicada"),
    "Cerrada sin saldo pendiente · Motivo: duplicada",
  );
});

test("detalleDeCierre: el saldo fraccionado no ensucia el historial", () => {
  const d = detalleDeCierre({ nombres: ["ARENA"], unidades: 0.1 + 0.2 }, "x");
  assert.match(d, /\(0\.3 u\.\)/);
});

// --- la línea cancelada, que es derivada --------------------------------------

test("lineaCancelada: solo si el pedido está cerrado Y a la línea le quedaba saldo", () => {
  // Pedido vivo: nada está cancelado, tenga o no saldo.
  assert.equal(lineaCancelada(false, 10, 0), false);
  assert.equal(lineaCancelada(false, 10, 10), false);
  // Pedido cerrado: se cancela lo que quedó sin ordenar…
  assert.equal(lineaCancelada(true, 10, 0), true);
  assert.equal(lineaCancelada(true, 10, 4), true);
  // …y NO lo que se ordenó entero: ese material sí se compró.
  assert.equal(lineaCancelada(true, 10, 10), false);
  // Ordenado de más (pasa con el granel: se pidieron 25.000 KG y llegaron 27.100).
  assert.equal(lineaCancelada(true, 10, 12), false);
});

test("lineaCancelada: el redondeo del float no inventa un saldo de 0", () => {
  // 0.1 + 0.2 = 0.30000000000000004; sin la tolerancia, esta línea quedaría
  // "cancelada" por 4e-17 de saldo y aparecería tachada sin razón.
  assert.equal(lineaCancelada(true, 0.1 + 0.2, 0.3), false);
});
