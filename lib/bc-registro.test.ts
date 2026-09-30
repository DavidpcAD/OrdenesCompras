// Cuando BC rechaza un registro, la app tiene que saber si REINTENTAR sirve o no.
// Durante meses la respuesta fue siempre "la orden queda por recibir para
// reintentar", y contra estos dos "no" reintentar no sirve nunca: el material ya
// entró en BC y la orden se quedaba trabada para siempre en la app.
//
// Los textos de acá son los REALES del 28 ago 2026 (CP-005148 y la factura 586265),
// tal como llegan: el mensaje de BC envuelto por bcPostear.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { clasificarFalloBc, cotejoProveedor, estadoLanzamientoBc, conflictoDeDimensiones, explicarConflictoDimensiones, faltaConfigContable, explicarFaltaConfigContable, campoVacioEnBc, explicarCampoVacioEnBc, nombreRealizadoPor, tipoLineaBc } from "./bc.ts";

const envuelto = (mensaje: string) =>
  `BC registrar 400: {"error":{"code":"Application_DialogException","message":"${mensaje} CorrelationId: 5ad0cc6c-2ef8-49b6-8f26-c9893727c69f."}}`;

test("factura del proveedor ya registrada en BC", () => {
  assert.equal(
    clasificarFalloBc(envuelto("Purchase Invoice 586265 already exists for this vendor.")),
    "factura-duplicada",
  );
});

test("misma cosa con BC en español", () => {
  assert.equal(
    clasificarFalloBc(envuelto("La factura de compra 586265 ya existe para este proveedor.")),
    "factura-duplicada",
  );
});

test("el pedido ya no está en BC (se completó y BC lo borró)", () => {
  assert.equal(
    clasificarFalloBc(envuelto("Pedido de compra CP-005148 no encontrado en BC.")),
    "pedido-no-existe",
  );
});

test("otra forma de decir lo mismo", () => {
  assert.equal(clasificarFalloBc("El pedido de compra CP-005148 no existe."), "pedido-no-existe");
});

test("un artículo que no existe NO es el pedido que no existe", () => {
  // Si esto se leyera como "pedido-no-existe", la app le ofrecería a Bodega
  // conciliar una recepción que en BC nunca ocurrió.
  assert.equal(
    clasificarFalloBc(envuelto("The Item does not exist. Identification fields and values: No.='M99-9999'")),
    "reintentable",
  );
});

test("pedido lanzado (lo arregla el reintento reabriéndolo) sigue siendo reintentable", () => {
  assert.equal(
    clasificarFalloBc("BC registrar 400: Status must be equal to 'Open' in Purchase Header"),
    "reintentable",
  );
});

test("periodo contable cerrado: reintentable (se cambia la fecha y va)", () => {
  assert.equal(
    clasificarFalloBc(envuelto("Posting Date is not within your range of allowed posting dates.")),
    "reintentable",
  );
});

test("sin mensaje no se inventa un motivo", () => {
  assert.equal(clasificarFalloBc(""), "reintentable");
  assert.equal(clasificarFalloBc(undefined as unknown as string), "reintentable");
});

// ── EL PROVEEDOR DEL PEDIDO ──────────────────────────────────────────────────
// El caso real: CP-005183. La orden era de FERRETERIA EPA S.A (PROV-000522) y para
// cuando Bodega recibió, el pedido en BC había pasado a PROV-000163 (Corazón de
// Papel). Nadie lo comparó y la factura 15403 de EPA quedó cargada a otro proveedor.
// Estas pruebas fijan las tres respuestas que importan: calza, NO calza, y "no se
// pudo mirar" — que NO es lo mismo que "está bien", pero tampoco frena.
test("el proveedor del pedido de BC calza con el de la orden", () => {
  const r = cotejoProveedor("CP-005183", { vendorNo: "PROV-000522", vendorName: "FERRETERIA EPA S.A" }, "PROV-000522");
  assert.equal(r.ok, true);
  assert.equal(r.verificado, true);
});

test("no calza: frena y dice los dos proveedores por su nombre", () => {
  const r = cotejoProveedor("CP-005183", { vendorNo: "PROV-000163", vendorName: "3-101-739774 Sociedad Anonima/Corazón de Papel" }, "PROV-000522");
  assert.equal(r.ok, false);
  assert.equal(r.verificado, true);
  assert.match(r.mensaje ?? "", /PROV-000163/);
  assert.match(r.mensaje ?? "", /Corazón de Papel/);
  assert.match(r.mensaje ?? "", /PROV-000522/);
});

test("mayúsculas y espacios no son un desajuste", () => {
  const r = cotejoProveedor("CP-005183", { vendorNo: " prov-000522 ", vendorName: "" }, "PROV-000522");
  assert.equal(r.ok, true);
});

test("BC no contestó (o el pedido ya no está): no se frena, pero queda sin verificar", () => {
  const r = cotejoProveedor("CP-005183", null, "PROV-000522");
  assert.equal(r.ok, true);
  assert.equal(r.verificado, false);
});

test("sin proveedor en la orden no hay nada que cotejar", () => {
  const r = cotejoProveedor("CP-005183", { vendorNo: "PROV-000163", vendorName: "" }, "");
  assert.equal(r.ok, true);
  assert.equal(r.verificado, false);
});

// ── EL ESTADO DEL PEDIDO EN BC ───────────────────────────────────────────────
// CP-005143: la app decía "lanzado" y en BC el pedido seguía Abierto, porque quien
// lanza es la app de Aprobación. `Format(PurchHeader.Status)` viaja en el IDIOMA DE
// LA SESIÓN del web service, así que el estado llega en inglés o en español según
// quién pregunte: comparar contra un solo texto era un freno con fecha de
// vencimiento. La API estándar no sirve para esto (devuelve "Open" hasta para los
// lanzados); el único que dice la verdad es AdelantePO_GetOrderLines.
test("el estado de BC se entiende en los dos idiomas", () => {
  assert.equal(estadoLanzamientoBc("Open"), "abierto");
  assert.equal(estadoLanzamientoBc("Abierto"), "abierto");
  assert.equal(estadoLanzamientoBc("Released"), "lanzado");
  assert.equal(estadoLanzamientoBc("Lanzado"), "lanzado");
  assert.equal(estadoLanzamientoBc("Pending Approval"), "pendiente-aprobacion");
  assert.equal(estadoLanzamientoBc("Pendiente de aprobación"), "pendiente-aprobacion");
});

test("sin estado no se inventa uno: es 'desconocido', y desconocido NO frena", () => {
  assert.equal(estadoLanzamientoBc(undefined), "desconocido");
  assert.equal(estadoLanzamientoBc(""), "desconocido");
  assert.equal(estadoLanzamientoBc("   "), "desconocido");
  assert.equal(estadoLanzamientoBc("Pending Prepayment"), "desconocido");
});

// ── EL CHOQUE DE DIMENSIONES (CP-005293, 3 sep 2026) ─────────────────────────
// El CC de la obra (VN-L.34) contra el que la ubicación F-MUEBLES amarra en BC con
// "Igual código". BC no revisa esa combinación al crear la línea ni al lanzar el
// pedido, solo AL REGISTRAR: el pedido se creó bien, Aprobación lo lanzó bien, y el
// "no" le salió a Bodega con el camión afuera. Texto REAL, tal como llegó.
const DIM_REAL = envuelto(
  "The dimensions used in Order CP-005293, line no. 10000 are invalid "
  + "The Dimension Value Code must be F-MUEBLES for Dimension Code CC for Location F-MUEBLES. "
  + "Currently it's VN-L.34.",
);

test("el choque de dimensiones se reconoce, y el mensaje se desarma entero", () => {
  const c = conflictoDeDimensiones(DIM_REAL);
  assert.ok(c, "no lo reconoció como choque de dimensiones");
  assert.equal(c.lineNo, "10000");
  assert.equal(c.dimension, "CC");
  assert.equal(c.debeSer, "F-MUEBLES");
  // El punto del código NO parte el valor: las obras (VN-L.34) y las bodegas de
  // obra (VN-M.28) llevan punto adentro.
  assert.equal(c.actual, "VN-L.34");
  assert.equal(c.porQue, "Location F-MUEBLES");
});

test("lo mismo con BC contestando en español", () => {
  const c = conflictoDeDimensiones(envuelto(
    "Las dimensiones utilizadas en Pedido CP-005293, n.º de línea 10000 no son válidas "
    + "El código de valor de dimensión debe ser F-MUEBLES para el código de dimensión CC "
    + "para Ubicación F-MUEBLES. Actualmente es VN-L.34.",
  ));
  assert.ok(c, "no lo reconoció en español");
  assert.equal(c.lineNo, "10000");
  assert.equal(c.dimension, "CC");
  assert.equal(c.debeSer, "F-MUEBLES");
  assert.equal(c.actual, "VN-L.34");
});

// ── FALTA CONFIGURACIÓN CONTABLE (CP-005759, 28 sep 2026) ────────────────────
// Una FAJA INDUSTRIAL (grupo REPUESTOS) hacia el almacén F-MAD-NUE: esa pareja
// nunca se configuró en BC. Texto REAL, tal como le llegó a Bodega — con el
// "Invt. Posting Group Code" que lleva punto adentro y el CorrelationId pegado.
const CFG_REAL = envuelto(
  "Inventory Account is missing in Inventory Posting Setup Location Code: F-MAD-NUE, "
  + "Invt. Posting Group Code: REPUESTOS. CorrelationId: 70050bd8-2d7d-41c0-8d37-c6a053cd3028.",
);

test("la configuración contable que falta se reconoce y se desarma", () => {
  const c = faltaConfigContable(CFG_REAL);
  assert.ok(c, "no lo reconoció como configuración faltante");
  assert.equal(c.cuenta, "Inventory Account");
  assert.equal(c.tabla, "Inventory Posting Setup");
  assert.deepEqual(c.claves, [
    { etiqueta: "el almacén", valor: "F-MAD-NUE" },
    { etiqueta: "el grupo de registro de inventario", valor: "REPUESTOS" },
  ]);
});

test("el aviso dice la combinación, que no se reintenta y a quién avisarle", () => {
  const texto = explicarFaltaConfigContable(faltaConfigContable(CFG_REAL)!, "CP-005759");
  assert.match(texto, /el almacén F-MAD-NUE y el grupo de registro de inventario REPUESTOS/);
  assert.match(texto, /NO se arregla reintentando/);
  assert.match(texto, /Contabilidad/);
  assert.match(texto, /Nada se guardó/);
  // El que se equivocó NO es quien está en la pantalla: el aviso lo dice.
  assert.match(texto, /No es un error tuyo/);
});

test("también la de registro general y la de IVA, que son el mismo Text001", () => {
  const gen = faltaConfigContable(envuelto(
    "Purch. Account is missing in General Posting Setup Gen. Bus. Posting Group: NACIONAL, "
    + "Gen. Prod. Posting Group: INVENTARIO.",
  ));
  assert.ok(gen);
  assert.equal(gen.tabla, "General Posting Setup");
  assert.deepEqual(gen.claves.map((k) => k.valor), ["NACIONAL", "INVENTARIO"]);
  const iva = faltaConfigContable(envuelto(
    "Purchase VAT Account is missing in VAT Posting Setup VAT Bus. Posting Group: NAC, "
    + "VAT Prod. Posting Group: IVA13.",
  ));
  assert.ok(iva);
  assert.deepEqual(iva.claves.map((k) => k.etiqueta), ["el grupo de IVA del negocio", "el grupo de IVA del producto"]);
});

test("sin pares que desarmar el aviso sigue sirviendo", () => {
  const c = faltaConfigContable(envuelto("Inventory Account is missing in Inventory Posting Setup."));
  assert.ok(c);
  assert.deepEqual(c.claves, []);
  assert.match(explicarFaltaConfigContable(c), /NO se arregla reintentando/);
});

// Las dos familias NO se pisan: cada una tiene su aviso y su destinatario
// (Proveeduría corrige dimensiones, Contabilidad agrega la cuenta).
test("la configuración faltante y el choque de dimensiones no se confunden", () => {
  assert.equal(faltaConfigContable(DIM_REAL), null);
  assert.equal(conflictoDeDimensiones(CFG_REAL), null);
  assert.equal(faltaConfigContable(envuelto("Purchase Invoice 586265 already exists for this vendor.")), null);
  assert.equal(faltaConfigContable(""), null);
});

// ── FICHA A MEDIO LLENAR EN BC (PROV-000477, 30 sep 2026) ────────────────────
// CARMIOL INDUSTRIAL se creó ese día en BC sin "Gen. Bus. Posting Group", y BC se
// negó a crear el pedido. Texto REAL, tal como lo vio Proveeduría.
const CAMPO_REAL = envuelto(
  "Gen. Bus. Posting Group must have a value in Vendor: No.=PROV-000477. "
  + "It cannot be zero or empty.  CorrelationId:  b1e529a6-c2a0-4ff6-bc1a-407958292dcd.",
);

test("la ficha incompleta se reconoce y dice qué campo y cuál registro", () => {
  const c = campoVacioEnBc(CAMPO_REAL);
  assert.ok(c, "no lo reconoció como campo obligatorio vacío");
  assert.equal(c.campo, "Gen. Bus. Posting Group");
  assert.equal(c.ficha, "Vendor");
  // El "No.=" se saca, y el punto de "No." NO parte el código del proveedor.
  assert.equal(c.cual, "PROV-000477");
});

test("el aviso nombra la ficha en castellano y a quién avisarle", () => {
  const texto = explicarCampoVacioEnBc(campoVacioEnBc(CAMPO_REAL)!);
  assert.match(texto, /ficha del proveedor PROV-000477/);
  assert.match(texto, /Gen\. Bus\. Posting Group/);
  assert.match(texto, /NO se arregla reintentando/);
  assert.match(texto, /Nada se guardó/);
});

test("otra ficha maestra también, con su propio nombre en castellano", () => {
  const c = campoVacioEnBc(envuelto("Base Unit of Measure must have a value in Item: No.=M20-0611. It cannot be zero or empty."));
  assert.ok(c);
  assert.equal(c.ficha, "Item");
  assert.equal(c.cual, "M20-0611");
  assert.match(explicarCampoVacioEnBc(c), /ficha del artículo M20-0611/);
});

// El MISMO TestField sale sobre el documento, y ahí no hay ficha que completar ni
// nadie a quien mandar: ese se deja pasar al diagnóstico de siempre antes que dar
// una instrucción falsa.
test("el campo vacío del DOCUMENTO no se disfraza de ficha incompleta", () => {
  assert.equal(campoVacioEnBc(envuelto("Posting Date must have a value in Purchase Header: Document Type=Order, No.=CP-005492. It cannot be zero or empty.")), null);
  assert.equal(campoVacioEnBc(envuelto("Job Task No. must have a value in Purchase Line: Document Type=Order, Document No.=CP-005492, Line No.=10000. It cannot be zero or empty.")), null);
});

test("las tres familias de 'no' de BC no se pisan entre ellas", () => {
  assert.equal(campoVacioEnBc(DIM_REAL), null);
  assert.equal(campoVacioEnBc(CFG_REAL), null);
  assert.equal(faltaConfigContable(CAMPO_REAL), null);
  assert.equal(conflictoDeDimensiones(CAMPO_REAL), null);
  assert.equal(campoVacioEnBc(envuelto("Purchase Invoice 586265 already exists for this vendor.")), null);
  assert.equal(campoVacioEnBc(""), null);
});

test("cualquier otro 'no' de BC no es un choque de dimensiones", () => {
  assert.equal(conflictoDeDimensiones(envuelto("Purchase Invoice 586265 already exists for this vendor.")), null);
  assert.equal(conflictoDeDimensiones(envuelto("Pedido de compra CP-005148 no encontrado en BC.")), null);
  assert.equal(conflictoDeDimensiones(""), null);
});

// Esto es lo que NO puede pasar: si el choque de dimensiones se clasificara como
// "ya está hecho allá", la pantalla abriría el diálogo de conciliación y Bodega
// podría guardar acá una recepción que en BC NO existe. BC no registró nada.
test("el choque de dimensiones NO se cuela por el camino de la conciliación", () => {
  assert.equal(clasificarFalloBc(DIM_REAL), "reintentable");
});

test("el aviso dice qué chocó, con qué, y que reintentar no sirve", () => {
  const texto = explicarConflictoDimensiones(conflictoDeDimensiones(DIM_REAL)!, "CP-005293");
  for (const esperado of ["línea 10000", "CP-005293", "CC", "F-MUEBLES", "VN-L.34", "NO se arregla reintentando"]) {
    assert.ok(texto.includes(esperado), `el aviso no menciona ${esperado}: ${texto}`);
  }
});

test("si el mensaje de BC no se puede desarmar, el aviso sirve igual", () => {
  const c = conflictoDeDimensiones(envuelto("The dimensions used in Order CP-005293 are invalid."));
  assert.ok(c, "tiene que reconocerlo aunque no traiga los detalles");
  const texto = explicarConflictoDimensiones(c, "CP-005293");
  assert.ok(texto.includes("CP-005293"));
  assert.ok(texto.includes("NO se arregla reintentando"));
});

// "Realizado por" en BC es Text[50]: el nombre se recorta ACÁ para que el tope no
// viva solo del otro lado (BC lo cortaría igual, pero sin decirlo).
test("el nombre que firma el movimiento en BC se limpia y se recorta a 50", () => {
  assert.equal(nombreRealizadoPor("  Jessie Corrales  "), "Jessie Corrales");
  assert.equal(nombreRealizadoPor(undefined), "");
  assert.equal(nombreRealizadoPor("A".repeat(80)).length, 50);
});

// ── EL TIPO DE LÍNEA QUE DEVUELVE BC ────────────────────────────────────────────
// El 10 sep 2026 las dos primeras órdenes de ACTIVO FIJO (CP-005454 y CP-005476)
// salieron en rojo: "Business Central NO tiene 1 línea(s) de esta orden" con la
// línea sentada en BC, bien creada. La causa no estaba en el cotejo sino acá: en
// OData, BC escapa los espacios del valor del enum y "Fixed Asset" llega
// "Fixed_x0020_Asset", que no calzaba con nada y caía en "otro" — o sea, la línea
// se caía del cotejo Y del freno de recepción de Bodega.
test("activo fijo: BC manda el enum escapado y hay que entenderlo igual", () => {
  assert.equal(tipoLineaBc("Fixed_x0020_Asset"), "activo_fijo");   // API custom (page 50174), el caso real
  assert.equal(tipoLineaBc("Fixed Asset"), "activo_fijo");
  assert.equal(tipoLineaBc("Activo fijo"), "activo_fijo");          // caption del codeunit en español
  assert.equal(tipoLineaBc("Fixed_x0020_Asset", 4), "activo_fijo"); // con typeNo manda el número
});

test("los demás tipos siguen igual, escapados o no", () => {
  assert.equal(tipoLineaBc("Item"), "articulo");
  assert.equal(tipoLineaBc("Producto"), "articulo");
  assert.equal(tipoLineaBc("Resource"), "recurso");
  assert.equal(tipoLineaBc("Charge_x0020__x0028_Item_x0029_"), "cargo");
  assert.equal(tipoLineaBc("Cargo (prod.)"), "cargo");
  assert.equal(tipoLineaBc("G_x002F_L_x0020_Account"), "otro");     // cuenta contable: esta app no la arma
  assert.equal(tipoLineaBc("_x0020_"), "otro");                     // línea en blanco (comentario)
  assert.equal(tipoLineaBc(""), "otro");
});
