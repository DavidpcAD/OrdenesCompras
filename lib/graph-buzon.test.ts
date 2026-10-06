// La consulta al buzón. Se prueba UNA cosa y es la que rompió en producción:
// Exchange contesta 400 `InefficientFilter` si se filtra por `hasAttachments` y se
// ordena por fecha en la misma consulta. Solo tolera filtrar y ordenar por la MISMA
// propiedad.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { consultaBuzon, esperaDeThrottle, idDeMensaje } from "./graph-buzon.ts";

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

// --- el freno de Microsoft (429) --------------------------------------------
//
// Graph no deja más de CUATRO peticiones simultáneas por app y por buzón. El 5 de
// octubre de 2026 la sincronización se caía entera con
// `ApplicationThrottled / Application is over its MailboxConcurrency limit`: los
// adjuntos se pedían de a cinco y el 429 ni siquiera se reintentaba.
//
// Lo que se prueba acá es la decisión de cuánto esperar. Hacerle caso al `Retry-After`
// es la diferencia entre salir del freno y alimentarlo.

test("le hace caso al Retry-After de Microsoft, que viene en segundos", () => {
  assert.equal(esperaDeThrottle("5", 0), 5000);
  assert.equal(esperaDeThrottle("12", 2), 12_000);
});

test("sin Retry-After sube de a poco y no reintenta de una", () => {
  assert.equal(esperaDeThrottle(null, 0), 2000);
  assert.equal(esperaDeThrottle(null, 1), 4000);
  assert.equal(esperaDeThrottle(undefined, 2), 8000);
});

test("una cabecera basura no deja la espera en cero ni en NaN", () => {
  // Un `Retry-After` con fecha HTTP en vez de segundos existe en el estándar y
  // Number() lo vuelve NaN; sin esto la espera sería 0 y el reintento inmediato.
  for (const basura of ["", "   ", "mañana", "Wed, 21 Oct 2026 07:28:00 GMT", "-3", "0"]) {
    assert.equal(esperaDeThrottle(basura, 0), 2000, `con ${JSON.stringify(basura)}`);
  }
});

test("por largo que sea el Retry-After, la pantalla no se cuelga esperando", () => {
  // Del otro lado hay alguien mirando la barra de avance: mejor decirle que lo
  // intente otra vez que dejarlo cinco minutos con el botón en "Revisando…".
  assert.equal(esperaDeThrottle("600", 0), 20_000);
  assert.equal(esperaDeThrottle(null, 20), 20_000);
});
