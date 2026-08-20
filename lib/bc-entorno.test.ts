// El entorno de Business Central (Sandbox vs Production) decide contra QUÉ base de
// datos de BC trabaja toda la app. Antes se asumía "Sandbox" cuando faltaba la
// config, así que una variable borrada mandaba la app al entorno de pruebas sin un
// solo error visible. Estas pruebas fijan que eso no vuelva a pasar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolverEntornoBc } from "./bc.ts";

const TENANT = "27272476-d569-411c-ab78-6d3f3b7596e5";

test("saca tenant y entorno de BC_BASE_URL con sufijo /api/adelante", () => {
  const r = resolverEntornoBc({ baseUrl: `https://api.businesscentral.dynamics.com/v2.0/${TENANT}/Production/api/adelante` });
  assert.deepEqual(r, { tenant: TENANT, environment: "Production" });
});

test("también cuando la URL termina en el entorno (sin /api)", () => {
  const r = resolverEntornoBc({ baseUrl: `https://api.businesscentral.dynamics.com/v2.0/${TENANT}/Production` });
  assert.deepEqual(r, { tenant: TENANT, environment: "Production" });
});

test("la URL manda sobre BC_ENVIRONMENT", () => {
  const r = resolverEntornoBc({
    baseUrl: `https://api.businesscentral.dynamics.com/v2.0/${TENANT}/Production/api/adelante`,
    tenantId: "otro", environment: "Sandbox",
  });
  assert.deepEqual(r, { tenant: TENANT, environment: "Production" });
});

test("sin URL usable, usa BC_TENANT_ID + BC_ENVIRONMENT", () => {
  const r = resolverEntornoBc({ baseUrl: "", tenantId: TENANT, environment: "Production" });
  assert.deepEqual(r, { tenant: TENANT, environment: "Production" });
});

test("NO asume Sandbox: sin entorno por ningún lado, falla", () => {
  assert.throws(() => resolverEntornoBc({ tenantId: TENANT }), /BC_ENVIRONMENT/);
  assert.throws(() => resolverEntornoBc({ baseUrl: "https://api.businesscentral.dynamics.com/v2.0", tenantId: TENANT }), /BC_ENVIRONMENT/);
  // Ni con la URL a medias (solo el tenant, sin el segmento del entorno).
  assert.throws(() => resolverEntornoBc({ baseUrl: `https://api.businesscentral.dynamics.com/v2.0/${TENANT}`, tenantId: TENANT }), /BC_ENVIRONMENT/);
});

test("sin tenant, también falla (y lo dice)", () => {
  assert.throws(() => resolverEntornoBc({ environment: "Production" }), /BC_TENANT_ID/);
});
