// Pruebas de cuánto le dura a la tabla lo que uno estaba buscando.
// De acá cuelga el bug que Angie reportó dos veces: abrir Órdenes y ver 5 de 465
// porque la barra traía todavía la búsqueda del viernes.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { VENTANA_BUSQUEDA_MS, VENTANA_PANTALLA_MS, conservaBusqueda, escribirFiltro, escribirMarcaFila, leerFiltro, leerMarcaFila } from "./memoria-tabla.ts";

const AHORA = Date.parse("2026-09-21T09:57:00-06:00");   // el lunes, a la hora del mensaje
const VIERNES = Date.parse("2026-09-18T09:00:00-06:00");
const HACE_UN_MINUTO = AHORA - 60_000;

// La vuelta del detalle. No se cuentan los saltos a propósito: de una orden se sale a
// Editar y a Imprimir, y volver de ahí son cuatro cambios de pantalla — el camino más
// común de Proveeduría. Lo que frena es la hora.
test("volver del detalle conserva la búsqueda", () => {
  assert.equal(conservaBusqueda({
    guardado: { visita: 3, t: HACE_UN_MINUTO },
    marca: { id: "OC-1", t: HACE_UN_MINUTO },
    visita: 5, ahora: AHORA,
  }), true);
});

test("volver después de pasar por Editar (cuatro pantallas) también la conserva", () => {
  assert.equal(conservaBusqueda({
    guardado: { visita: 3, t: HACE_UN_MINUTO },
    marca: { id: "OC-1", t: HACE_UN_MINUTO },
    visita: 7, ahora: AHORA,
  }), true);
});

test("seguir en la misma visita la conserva (tocar un panel, F5)", () => {
  assert.equal(conservaBusqueda({
    guardado: { visita: 4, t: HACE_UN_MINUTO },
    marca: null,
    visita: 4, ahora: AHORA,
  }), true);
});

test("entrar de nuevo a la pantalla abre la lista completa", () => {
  assert.equal(conservaBusqueda({
    guardado: { visita: 3, t: HACE_UN_MINUTO },
    marca: null,
    visita: 5, ahora: AHORA,
  }), false);
});

// El caso de Angie: la pestaña quedó abierta desde el viernes y nunca se salió de
// Órdenes, así que "sigo en la misma visita" seguía siendo cierto el lunes.
test("la búsqueda del viernes no llega al lunes, aunque nadie haya salido de la pantalla", () => {
  assert.equal(conservaBusqueda({
    guardado: { visita: 4, t: VIERNES },
    marca: null,
    visita: 4, ahora: AHORA,
  }), false);
});

// Y tampoco por la otra puerta: la marca de una fila que se abrió el viernes y a la
// que nadie volvió se queda en sessionStorage hasta la próxima visita.
test("una marca de fila vieja tampoco resucita la búsqueda", () => {
  assert.equal(conservaBusqueda({
    guardado: { visita: 4, t: VIERNES },
    marca: { id: "OC-1", t: VIERNES },
    visita: 6, ahora: AHORA,
  }), false);
});

test("justo en el borde de la ventana ya no se conserva", () => {
  const justoAdentro = AHORA - VENTANA_BUSQUEDA_MS + 1000;
  const justoAfuera = AHORA - VENTANA_BUSQUEDA_MS;
  assert.equal(conservaBusqueda({ guardado: { visita: 1, t: justoAdentro }, marca: null, visita: 1, ahora: AHORA }), true);
  assert.equal(conservaBusqueda({ guardado: { visita: 1, t: justoAfuera }, marca: null, visita: 1, ahora: AHORA }), false);
});

// Un estado escrito "en el futuro" (cambio de hora, reloj que se sincroniza) se trata
// como vencido: abrir la lista completa nunca esconde trabajo.
test("un reloj hacia atrás no deja la búsqueda pegada", () => {
  assert.equal(conservaBusqueda({ guardado: { visita: 1, t: AHORA + 3_600_000 }, marca: null, visita: 1, ahora: AHORA }), false);
});

test("estado sin hora (de la versión anterior) abre la lista completa", () => {
  assert.equal(conservaBusqueda({ guardado: { visita: 1 }, marca: null, visita: 1, ahora: AHORA }), false);
  assert.equal(conservaBusqueda({ guardado: {}, marca: null, visita: 0, ahora: AHORA }), false);
});

test("la marca de fila se lee con su hora, y la basura no la tumba", () => {
  assert.deepEqual(leerMarcaFila(escribirMarcaFila("OC-7", AHORA)), { id: "OC-7", t: AHORA });
  assert.equal(leerMarcaFila(null), null);
  assert.equal(leerMarcaFila(""), null);
  // El id pelado que dejó la versión anterior: sirve para volver a la fila, no para
  // heredar la búsqueda.
  assert.deepEqual(leerMarcaFila("OC-7"), { id: "OC-7", t: 0 });
  assert.deepEqual(leerMarcaFila('{"id":"OC-7","t":123}'), { id: "OC-7", t: 123 });
  assert.deepEqual(leerMarcaFila("{roto"), { id: "{roto", t: 0 });
  assert.deepEqual(leerMarcaFila('{"id":"OC-7"}'), { id: '{"id":"OC-7"}', t: 0 });
});

// El panel se VE (recuadro encendido, rótulo, "Ver todas" al lado), así que aguanta la
// jornada y no la media hora de la búsqueda: lo que se corta es el que cruzó la noche.
test("el panel elegido aguanta la jornada, no hasta el otro día", () => {
  const raw = escribirFiltro("lanzado", HACE_UN_MINUTO);
  assert.equal(leerFiltro(raw, AHORA), "lanzado");
  assert.equal(leerFiltro(escribirFiltro("lanzado", AHORA - VENTANA_BUSQUEDA_MS - 1000), AHORA), "lanzado");
  assert.equal(leerFiltro(escribirFiltro("lanzado", AHORA - VENTANA_PANTALLA_MS), AHORA), null);
  assert.equal(leerFiltro(escribirFiltro("lanzado", VIERNES), AHORA), null);
  assert.equal(leerFiltro(null, AHORA), null);
  assert.equal(leerFiltro("lanzado", AHORA), null);           // valor pelado de la versión anterior
  // Un panel que ya no existe (o que no se está dibujando) dejaba la tabla vacía sin
  // nada en qué hacer clic para salir.
  assert.equal(leerFiltro(raw, AHORA, (v) => v === "todas"), null);
  assert.equal(leerFiltro(raw, AHORA, (v) => v === "lanzado"), "lanzado");
});
