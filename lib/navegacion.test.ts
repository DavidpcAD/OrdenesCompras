// Pruebas del registro de navegación de la pestaña.
// De este contador cuelgan dos comportamientos que se notan enseguida cuando fallan:
// el botón "Volver" (si cree que hubo navegación interna cuando no la hubo, un back()
// saca a la persona del sistema) y la memoria de las tablas (si cree que seguimos en
// la misma visita, la lista se abre con la búsqueda de hace horas encima).
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { leerNav, siguienteNav, type RegistroNav } from "./navegacion.ts";

const VACIO: RegistroNav = { n: 0, ruta: null };

test("una pestaña nueva arranca sin registro", () => {
  assert.deepEqual(leerNav(null), VACIO);
});

// sessionStorage puede traer cualquier cosa de una versión anterior de la app: si eso
// tumbara la lectura, se caería la navegación entera de la pestaña.
test("la basura guardada no tumba la lectura", () => {
  for (const raw of ["", "no es json", "null", "123", '{"n":"dos"}', '{"n":-1}', "{}"]) {
    assert.deepEqual(leerNav(raw), VACIO, `con ${JSON.stringify(raw)}`);
  }
  assert.deepEqual(leerNav('{"n":3,"ruta":"/proveeduria/ordenes"}'), { n: 3, ruta: "/proveeduria/ordenes" });
});

// Entrar por un link directo (un correo, un WhatsApp) deja el contador en 0, y por eso
// "Volver" cae a su ruta de siempre en vez de sacar a la persona de la app.
test("la primera pantalla de la pestaña no cuenta como navegación", () => {
  assert.deepEqual(siguienteNav(VACIO, "/proveeduria/ordenes"), { n: 0, ruta: "/proveeduria/ordenes" });
});

test("cambiar de pantalla suma uno", () => {
  const ordenes = siguienteNav(VACIO, "/proveeduria/ordenes")!;
  const detalle = siguienteNav(ordenes, "/proveeduria/ordenes/OC-1")!;
  assert.deepEqual(detalle, { n: 1, ruta: "/proveeduria/ordenes/OC-1" });
  assert.deepEqual(siguienteNav(detalle, "/proveeduria/ordenes"), { n: 2, ruta: "/proveeduria/ordenes" });
});

// Recargar con F5 vuelve a pintar la misma ruta: el historial no cambió, así que el
// contador tampoco. Es lo que deja que la tabla reconozca la recarga como la MISMA
// visita y no borre lo que la persona estaba buscando.
test("volver a pintar la misma ruta no es una navegación", () => {
  const ordenes = siguienteNav(VACIO, "/proveeduria/ordenes")!;
  assert.equal(siguienteNav(ordenes, "/proveeduria/ordenes"), null);
});

// El caso que motivó todo esto: la búsqueda de la mañana no puede seguir puesta al
// entrar de nuevo desde el menú, pero sí tiene que sobrevivir la ida y vuelta al
// detalle. Lo que la tabla compara es este número.
test("volver del detalle y entrar desde el menú se distinguen", () => {
  let reg = siguienteNav(VACIO, "/proveeduria/ordenes")!;
  const visitaDondeBusco = reg.n;

  // Ida al detalle y vuelta: son dos navegaciones, el número ya no es el mismo (de
  // ahí que la vuelta se reconozca por la marca de fila y no por el contador).
  reg = siguienteNav(reg, "/proveeduria/ordenes/OC-1")!;
  reg = siguienteNav(reg, "/proveeduria/ordenes")!;
  assert.notEqual(reg.n, visitaDondeBusco);

  // Y una vuelta larga por la app termina todavía más lejos: entrar desde el menú
  // nunca puede confundirse con seguir parado en la pantalla.
  reg = siguienteNav(reg, "/proveeduria/dashboard")!;
  reg = siguienteNav(reg, "/proveeduria/solicitudes")!;
  reg = siguienteNav(reg, "/proveeduria/ordenes")!;
  assert.notEqual(reg.n, visitaDondeBusco);
});

// Alternar Lista / Por proveedor desmonta y vuelve a montar la tabla sin cambiar de
// ruta: ahí sí seguimos en la misma visita y lo escrito en la barra de búsqueda tiene
// que seguir donde estaba.
test("alternar pestañas dentro de la pantalla no mueve el contador", () => {
  const reg = siguienteNav(siguienteNav(VACIO, "/proveeduria/dashboard")!, "/proveeduria/ordenes")!;
  assert.equal(siguienteNav(reg, "/proveeduria/ordenes"), null);
  assert.equal(reg.n, 1);
});
