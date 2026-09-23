// La consulta al buzón. Se prueba UNA cosa y es la que rompió en producción:
// Exchange contesta 400 `InefficientFilter` si se filtra por `hasAttachments` y se
// ordena por fecha en la misma consulta. Solo tolera filtrar y ordenar por la MISMA
// propiedad.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { consultaBuzon, idDeMensaje } from "./graph-buzon.ts";

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

// --- el id del correo escondido en el webLink -------------------------------
//
// De esto depende poder abrir el XML de una factura que ya está guardada: la tabla
// guarda el `webLink` y no el id del mensaje, y las miles de filas viejas nunca van a
// tener uno —el marcador del buzón solo avanza y esos correos no se releen—.
//
// La conversión se midió contra el buzón real el 23 de setiembre de 2026: el ItemID
// del webLink es el mismo id del mensaje pero en base64 corriente, o sea que `/` y
// `+` viajan donde el id lleva `-` y `_`. Con los 8 correos con adjunto de esa
// corrida, los 8 ids reconstruidos salieron exactos y los adjuntos se bajaron.
// OJO: el mapeo NO es el de base64url (que sería + → - y / → _); va cruzado.

const LINK = (item: string) =>
  `https://outlook.office365.com/owa/?ItemID=${item}&exvsurl=1&viewmodel=ReadMessageItem`;

test("reconstruye el id del mensaje cambiando / por - y + por _", () => {
  assert.equal(idDeMensaje(LINK("AAMkAG%2FbcD%2BefAAA%3D")), "AAMkAG-bcD_efAAA=");
});

test("el ItemID viene url-encoded y se decodifica antes de convertir", () => {
  assert.equal(idDeMensaje(LINK("AAkALgAAAAA%3D")), "AAkALgAAAAA=");
});

test("un webLink sin ItemID no devuelve un id inventado", () => {
  assert.equal(idDeMensaje("https://outlook.office365.com/owa/"), null);
  assert.equal(idDeMensaje(""), null);
});
