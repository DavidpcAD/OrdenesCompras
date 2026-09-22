// La consulta al buzón. Se prueba UNA cosa y es la que rompió en producción:
// Exchange contesta 400 `InefficientFilter` si se filtra por `hasAttachments` y se
// ordena por fecha en la misma consulta. Solo tolera filtrar y ordenar por la MISMA
// propiedad.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { consultaBuzon } from "./graph-buzon.ts";

const BUZON = "facturacion@adelantedesarrollos.com";

test("NUNCA mezcla el filtro de adjuntos con el orden por fecha", () => {
  const u = decodeURIComponent(consultaBuzon(BUZON, "2026-09-22T12:00:00Z"));
  assert.ok(!u.includes("hasAttachments eq"), "el filtro de adjuntos no puede ir en $filter");
  assert.ok(u.includes("$orderby=receivedDateTime"), "tiene que ordenar por fecha");
  assert.ok(u.includes("receivedDateTime gt"), "y filtrar por la MISMA propiedad");
});

test("pide hasAttachments en el $select para poder descartar en código", () => {
  assert.ok(consultaBuzon(BUZON, null).includes("hasAttachments"));
});

test("sin marcador arranca 30 días atrás, no desde el principio del buzón", () => {
  // La bandeja tiene 31.932 correos; ordenar de viejo a nuevo empezaría en 2019.
  const hoy = new Date("2026-09-22T18:00:00Z");
  const u = decodeURIComponent(consultaBuzon(BUZON, null, hoy));
  assert.ok(u.includes("receivedDateTime gt 2026-08-23"), `arrancó en otra fecha: ${u}`);
});

test("con marcador arranca justo después de él", () => {
  const u = decodeURIComponent(consultaBuzon(BUZON, "2026-09-22T19:05:07Z"));
  assert.ok(u.includes("receivedDateTime gt 2026-09-22T19:05:07Z"));
});

test("escapa la dirección del buzón en la ruta", () => {
  assert.ok(consultaBuzon(BUZON, null).includes("facturacion%40adelantedesarrollos.com"));
});
