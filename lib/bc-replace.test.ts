// Pruebas del payload que reescribe las líneas de un pedido en BC.
// Es la traducción app → BC de CANTIDAD y PRECIO: contra estos números Bodega
// recibe y Contabilidad factura. Si acá sale mal, entra mercadería equivocada al
// inventario y a la contabilidad, y en pantalla todo se ve bien.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { payloadReplaceLines, sinObrasInexistentes, avisoDeSaneo, lineasOrdenParaBc, obrasSinTarea, lineasSinUnidad, lineasSinAlmacen, centroCostoDeOrden, centroCostoDeLinea, decidirVariantes, crearEnBcAlEnviar, bcPideAbierto, ccForzadoDelAlmacen, type LineaReplaceBc } from "./bc.ts";
import type { OrdenLinea } from "./types.ts";

const item = (p: Partial<LineaReplaceBc> = {}): LineaReplaceBc => ({
  tipo: "articulo", itemNo: "M01-0147", descripcion: "VARILLA DEFORME #3",
  cantidad: 6, precio: 1100, locationCode: "ALM-GRAL", ...p,
});

test("una línea de artículo viaja con el shape que espera el codeunit", () => {
  const { lines, omitidas } = payloadReplaceLines([item({
    variantCode: "AZUL", descuentoPct: 5, jobNo: "VB-5.01", taskNo: "1000", unidad: "UND",
  })]);
  assert.equal(omitidas.length, 0);
  assert.deepEqual(lines[0], {
    type: "Item", itemNo: "M01-0147", variantCode: "AZUL", locationCode: "ALM-GRAL",
    unitOfMeasureCode: "UND",
    quantity: 6, directUnitCost: 1100, lineDiscountPct: 5, jobNo: "VB-5.01", taskNo: "1000",
  });
});

// El flete NO va como artículo: BC lo necesita como Item Charge o lo rechaza.
// La unidad de COMPRA es parte del contrato: cantidad y precio están expresados en
// ella. Un estañón de adhesivo son 255.000 gramos, así que mandar la unidad
// equivocada es un error de 255.000×.
test("la línea de artículo lleva la unidad de compra, en mayúscula y sin espacios", () => {
  const { lines } = payloadReplaceLines([item({ unidad: " est " })]);
  assert.equal(lines[0].unitOfMeasureCode, "EST");
});

// Antes esto mandaba `unitOfMeasureCode: ""` creyendo que BC pondría la del ítem.
// No: la vacía BORRA la que BC ya había puesto al validar el N.º de artículo, y el
// pedido revienta al LANZARLO ("Unit of Measure Code must have a value"), o sea en
// manos del aprobador. Probado con CP-003884 en Sandbox. Mismo caso la variante.
test("sin unidad NO se manda la clave, así sobrevive la que BC pone sola", () => {
  const { lines } = payloadReplaceLines([item({})]);
  assert.ok(!("unitOfMeasureCode" in lines[0]));
});

test("sin variante NO se manda la clave (mandarla vacía borra la del ítem)", () => {
  const { lines } = payloadReplaceLines([item({})]);
  assert.ok(!("variantCode" in lines[0]));
});

test("la variante viaja sin espacios cuando la línea la trae", () => {
  const { lines } = payloadReplaceLines([item({ variantCode: " AZUL " })]);
  assert.equal(lines[0].variantCode, "AZUL");
});

test("el cargo viaja como Charge con su tipo y método", () => {
  const { lines } = payloadReplaceLines([{
    tipo: "cargo", chargeNo: "FLETE", descripcion: "FLETE / TRANSPORTE",
    cantidad: 1, precio: 45000, chargeMethod: "Weight",
  }]);
  assert.deepEqual(lines[0], {
    type: "Charge", itemChargeNo: "FLETE", description: "FLETE / TRANSPORTE",
    quantity: 1, directUnitCost: 45000, chargeMethod: "Weight",
  });
});

test("un cargo sin método usa Amount, que es el reparto por defecto", () => {
  const { lines } = payloadReplaceLines([{ tipo: "cargo", chargeNo: "FLETE", cantidad: 1, precio: 100 }]);
  assert.equal((lines[0] as any).chargeMethod, "Amount");
  assert.equal((lines[0] as any).description, "FLETE");   // sin descripción, cae al código
});

// Un cargo sin tipo de Item Charge real hace que BC rechace la línea. Se omite y se
// REPORTA, en vez de inventar un código (el bug que ya se arregló al crear órdenes).
test("un cargo sin tipo se omite y se reporta con nombre", () => {
  const { lines, omitidas } = payloadReplaceLines([
    item(),
    { tipo: "cargo", descripcion: "FLETE SIN TIPO", cantidad: 1, precio: 100 },
  ]);
  assert.equal(lines.length, 1);
  assert.match(omitidas[0], /FLETE SIN TIPO/);
  assert.match(omitidas[0], /cargo sin tipo/);
});

test("una línea sin Nº de artículo se omite y se reporta", () => {
  const { lines, omitidas } = payloadReplaceLines([item({ itemNo: "", descripcion: "MATERIAL LIBRE" })]);
  assert.equal(lines.length, 0);
  assert.match(omitidas[0], /MATERIAL LIBRE/);
  assert.match(omitidas[0], /sin Nº de artículo/);
});

// Cantidad 0 o negativa no puede llegar a BC: el codeunit la omitiría igual, pero
// acá se captura para poder decirle al usuario QUÉ línea se cayó.
test("cantidad 0 o negativa se omite y se reporta", () => {
  const { lines, omitidas } = payloadReplaceLines([
    item({ cantidad: 0, descripcion: "CERO" }),
    item({ cantidad: -3, descripcion: "NEGATIVA" }),
    item({ descripcion: "BUENA" }),
  ]);
  assert.equal(lines.length, 1);
  assert.equal(omitidas.length, 2);
  assert.match(omitidas.join(" "), /CERO/);
  assert.match(omitidas.join(" "), /NEGATIVA/);
});

// El precio puede llegar como string desde el input. "1,234.56" (en-US) y
// "1.234,56" (es-CR) son el MISMO monto: si se lee mal, el costo va 1000× abajo
// (es el bug IT-722, que ya costó una corrección en producción).
test("normaliza el precio en cualquiera de los dos formatos", () => {
  assert.equal((payloadReplaceLines([item({ precio: "1,234.56" })]).lines[0] as any).directUnitCost, 1234.56);
  assert.equal((payloadReplaceLines([item({ precio: "1.234,56" })]).lines[0] as any).directUnitCost, 1234.56);
  assert.equal((payloadReplaceLines([item({ precio: "₡5 752,22" })]).lines[0] as any).directUnitCost, 5752.22);
});

// Un precio ilegible NO debe convertirse en 0 silencioso... pero tampoco reventar:
// queda en 0 y BC va a rechazar la línea con su propio error, que es visible.
test("un precio basura queda en 0 (BC lo rechaza y se ve el error)", () => {
  assert.equal((payloadReplaceLines([item({ precio: "abc" })]).lines[0] as any).directUnitCost, 0);
});

// Los que SÍ viajan vacíos son los que BC no rellena solo: obra, tarea, almacén y
// descuento. Vacío ahí significa "no tiene", y no borra nada.
// Unidad y variante son la excepción y por eso se OMITEN (ver más arriba): BC las
// pone al validar el N.º de artículo y mandarlas vacías las borraría.
test("los campos opcionales viajan vacíos, no como undefined", () => {
  const { lines } = payloadReplaceLines([item({ variantCode: undefined, jobNo: undefined, taskNo: undefined, locationCode: undefined })]);
  const l = lines[0] as any;
  assert.ok(!("variantCode" in l));
  assert.equal(l.jobNo, "");
  assert.equal(l.taskNo, "");
  assert.equal(l.locationCode, "");
  assert.equal(l.lineDiscountPct, 0);
  // Ninguna clave puede llegar como undefined: JSON.stringify la borraría y el
  // codeunit leería un token ausente donde esperaba un valor.
  for (const [k, v] of Object.entries(l)) assert.notEqual(v, undefined, k);
});

test("sin líneas devuelve vacío sin reventar", () => {
  assert.deepEqual(payloadReplaceLines([]), { lines: [], omitidas: [] });
});

// --- La obra (Project No.) que viaja a BC ---------------------------------
// Una obra que no existe en BC no tumba SU línea: tumba el pedido ENTERO. BC
// contesta "The field Project No. of table Purchase Line contains a value
// (ALM-GRAL) that cannot be found in the related table (Project)" y se queda con las
// líneas viejas — contra ésas recibe Bodega y factura Contabilidad.
const obrasBc = new Set(["VB-5.01", "VN-M.28"]);

test("un almacén metido de obra se descarta (y se lleva la tarea)", () => {
  const { lineas, descartadas } = sinObrasInexistentes(
    [{ jobNo: "ALM-GRAL", taskNo: "1000" }, { jobNo: "VB-5.01", taskNo: "2000" }], obrasBc);
  assert.deepEqual(lineas[0], { jobNo: undefined, taskNo: undefined });
  assert.deepEqual(lineas[1], { jobNo: "VB-5.01", taskNo: "2000" });   // la obra real no se toca
  assert.deepEqual(descartadas, ["ALM-GRAL"]);
});

test("la obra se reconoce con espacios o en minúscula", () => {
  const { lineas, descartadas } = sinObrasInexistentes([{ jobNo: " vb-5.01 " }], obrasBc);
  assert.equal(lineas[0].jobNo, " vb-5.01 ");   // se deja tal cual: BC la valida igual
  assert.deepEqual(descartadas, []);
});

// Sin catálogo (BC caído, extensión sin publicar) NO se borra nada: quitarle la obra
// a una línea que sí la tiene cambia dónde se costea el material.
test("sin catálogo de obras no se toca ninguna línea", () => {
  const ls = [{ jobNo: "ALM-GRAL", taskNo: "1000" }];
  const { lineas, descartadas } = sinObrasInexistentes(ls, null);
  assert.equal(lineas[0].jobNo, "ALM-GRAL");
  assert.deepEqual(descartadas, []);
});

test("líneas sin obra pasan intactas", () => {
  const ls = [{ jobNo: undefined }, { jobNo: "" }];
  assert.deepEqual(sinObrasInexistentes(ls, obrasBc), { lineas: ls, descartadas: [], catalogo: "ok" });
});

// "No se descartó nada" significa cosas MUY distintas según se haya podido leer el
// catálogo: sin esto, el llamador no puede avisarle a nadie que no verificó nada.
test("el saneo dice si pudo leer el catálogo o no", () => {
  assert.equal(sinObrasInexistentes([{ jobNo: "VB-5.01" }], obrasBc).catalogo, "ok");
  assert.equal(sinObrasInexistentes([{ jobNo: "VB-5.01" }], null).catalogo, "sin-leer");
});

test("el aviso nombra la obra que se quitó, y avisa cuando no se pudo verificar", () => {
  assert.match(avisoDeSaneo({ descartadas: ["ALM-GRAL"], catalogo: "ok" }), /ALM-GRAL/);
  assert.equal(avisoDeSaneo({ descartadas: [], catalogo: "ok" }), "");
  assert.match(avisoDeSaneo({ descartadas: [], catalogo: "sin-leer" }), /no se verificó/);
});

// ---- app → BC: las líneas de la orden tal como salen de getOrden ----------
// Es la MISMA traducción para crear el pedido al enviar a aprobación y para
// reescribirlo al editar. Si los dos caminos dejan de coincidir, guardar una orden
// le cambia a BC algo que crearla no le había puesto.
const lineaApp = (p: Partial<OrdenLinea> = {}): OrdenLinea => ({
  id: "1", tipo: "articulo", articuloId: "M01-0147", descripcion: "VARILLA DEFORME #3",
  cantidad: 6, unidad: "UND", almacen: "ALM-GRAL", precioUnitario: 1100, ivaPct: 13,
  cantidadRecibida: 0, cantidadFacturada: 0, ...p,
});

test("la línea de la orden llega a BC con obra, tarea, unidad y descuento", () => {
  const [l] = lineasOrdenParaBc([lineaApp({ proyecto: "VB-5.01", taskNo: "1000", descuentoPct: 5, variantCode: "AZUL" })]);
  assert.equal(l.tipo, "articulo");
  assert.equal(l.itemNo, "M01-0147");
  assert.equal(l.jobNo, "VB-5.01");
  assert.equal(l.taskNo, "1000");
  assert.equal(l.unidad, "UND");
  assert.equal(l.descuentoPct, 5);
  assert.equal(l.variantCode, "AZUL");
  assert.equal(l.locationCode, "ALM-GRAL");
});

// Sin locationCode el material no entra a ningún almacén y el stock no sube.
test("una línea sin almacén cae al almacén de recepción por defecto", () => {
  process.env.BC_RECEPCION_LOCATION = "ALM-GRAL";
  assert.equal(lineasOrdenParaBc([lineaApp({ almacen: "" })])[0].locationCode, "ALM-GRAL");
  delete process.env.BC_RECEPCION_LOCATION;
  assert.equal(lineasOrdenParaBc([lineaApp({ almacen: "" })])[0].locationCode, "");
});

test("el flete viaja como cargo, con su tipo y su método", () => {
  const [l] = lineasOrdenParaBc([lineaApp({ tipo: "cargo", articuloId: undefined, chargeNo: "TRANSPORTE", chargeMethod: "Amount", descripcion: "FLETE" })]);
  assert.equal(l.tipo, "cargo");
  assert.equal(l.chargeNo, "TRANSPORTE");
  assert.equal(l.chargeMethod, "Amount");
});

// El interruptor existe para apagar la creación en BC desde Azure sin desplegar (si
// la app de Producción volviera a crear el pedido, quedarían dos por orden).
test("crear en BC al enviar viene prendido y se apaga con 0/false/no", () => {
  delete process.env.BC_CREAR_AL_ENVIAR;
  assert.equal(crearEnBcAlEnviar(), true);
  for (const v of ["0", "false", "NO", " 0 "]) {
    process.env.BC_CREAR_AL_ENVIAR = v;
    assert.equal(crearEnBcAlEnviar(), false, v);
  }
  process.env.BC_CREAR_AL_ENVIAR = "1";
  assert.equal(crearEnBcAlEnviar(), true);
  delete process.env.BC_CREAR_AL_ENVIAR;
});

// ---- obra sin tarea: el pedido se crea en BC pero NO se puede lanzar -----------
// El codeunit no se niega: deja la línea con Job No. y sin Job Task No. y solo
// avisa. El error sale mucho después, cuando el aprobador le da lanzar. Por eso
// se corta antes de tocar BC.
test("una línea con obra y sin tarea se detecta antes de mandar nada a BC", () => {
  const malas = obrasSinTarea([
    item({ jobNo: "INF-HDAII", descripcion: "REMACHADORA" }),
    item({ jobNo: "VN-L.20", taskNo: "2.2" }),
    item({}),
  ]);
  assert.deepEqual(malas, ["REMACHADORA (obra INF-HDAII)"]);
});

test("el cargo no cuenta: el flete nunca lleva obra", () => {
  assert.deepEqual(obrasSinTarea([{ tipo: "cargo", chargeNo: "TRANSPORTE", cantidad: 1, precio: 5000, jobNo: "VN-L.20" }]), []);
});

// ---- línea sin unidad de compra ------------------------------------------------
// Igual que la tarea: BC crea el pedido y revienta al lanzarlo. Y acá NO se puede
// "dejar que BC ponga la del ítem": la cantidad y el precio están expresados en la
// unidad de COMPRA, así que caer a la unidad BASE convierte 1 estañón en 1 gramo.
test("una línea de artículo sin unidad se detecta antes de mandar nada a BC", () => {
  const malas = lineasSinUnidad([
    item({ unidad: "EST" }),
    item({ descripcion: "ADHESIVO EPÓXICO" }),
    item({ unidad: "   ", descripcion: "SELLADOR" }),
  ]);
  assert.deepEqual(malas, ["ADHESIVO EPÓXICO", "SELLADOR"]);
});

test("el cargo no cuenta: un Item Charge no lleva unidad de medida", () => {
  assert.deepEqual(lineasSinUnidad([{ tipo: "cargo", chargeNo: "TRANSPORTE", cantidad: 1, precio: 5000 }]), []);
});

// ---- línea sin almacén ---------------------------------------------------------
// El único de los tres que BC no castiga: crea el pedido, lo lanza y el material no
// entra a ningún lado. Se descubre semanas después, y se "arregla" rehaciendo el
// pedido en BC — que es lo que deja la orden de la app apuntando a un número muerto.
test("una línea de artículo sin almacén se detecta antes de mandar nada a BC", () => {
  const malas = lineasSinAlmacen([
    item({ locationCode: "VN-L.30" }),
    item({ locationCode: "", descripcion: "INODORO ONE PIECE" }),
    item({ locationCode: "   ", descripcion: "LAVAMANOS PEDESTAL" }),
  ]);
  assert.deepEqual(malas, ["INODORO ONE PIECE", "LAVAMANOS PEDESTAL"]);
});

test("el cargo no cuenta: un Item Charge no entra a ningún almacén", () => {
  assert.deepEqual(lineasSinAlmacen([{ tipo: "cargo", chargeNo: "TRANSPORTE", cantidad: 1, precio: 5000 }]), []);
});

// ---- Centro de Costo del encabezado -------------------------------------------
// El workflow de aprobación de BC (MS-POAPW-01) dispara por la dimensión CC del
// ENCABEZADO con valor *VN*/*VB*. Con el CC ya puesto en cada línea, el del
// encabezado es solo eso: el disparador. OJO: sale del `centroCosto`, NO del jobNo —
// una compra para stock tiene obra (el material queda apartado para ella) y no tiene
// Job No., y ese era justo el caso que se iba sin centro de costo.
test("el Centro de Costo del encabezado sale de la primera línea que tenga", () => {
  assert.equal(centroCostoDeOrden([item({}), item({ centroCosto: "VN-I.36" }), item({ centroCosto: "VB-5.01" })]).cc, "VN-I.36");
});

test("una compra sin obra en ninguna línea no lleva Centro de Costo", () => {
  assert.equal(centroCostoDeOrden([item({}), item({})]).cc, "");
});

test("el cargo no define el Centro de Costo", () => {
  assert.equal(centroCostoDeOrden([{ tipo: "cargo", chargeNo: "TRANSPORTE", cantidad: 1, precio: 5000, centroCosto: "VN-L.20" }]).cc, "");
});

// ---- variante requerida --------------------------------------------------------
// BC exige la variante al LANZAR, no al crear. Y hoy nueva/editar orden no tienen
// selector de variante: la línea llega con la que puso Ingeniería, o sin ninguna.
// Con una sola opción no hay nada que elegir; con varias, elegir el color/medida no
// es una decisión del servidor.
test("con UNA sola variante posible se pone sola: no hay nada que elegir", () => {
  const { lineas, ambiguas } = decidirVariantes(
    [item({ itemNo: "M17-0297" })],
    new Map([["M17-0297", ["STD"]]]),
  );
  assert.equal(lineas[0].variantCode, "STD");
  assert.deepEqual(ambiguas, []);
});

test("con VARIAS variantes se frena el envío y se listan las opciones", () => {
  const { lineas, ambiguas } = decidirVariantes(
    [item({ itemNo: "M17-0297", descripcion: "TUBO PVC" })],
    new Map([["M17-0297", ["AZUL", "BLANCO"]]]),
  );
  assert.equal(lineas[0].variantCode, undefined);
  assert.match(ambiguas[0], /TUBO PVC/);
  assert.match(ambiguas[0], /AZUL, BLANCO/);
});

test("el ítem sin variantes, o cuyo catálogo no contestó, pasa igual", () => {
  // Lista vacía = BC dijo "no tiene". Ausente del mapa = no se pudo consultar.
  const conVacia = decidirVariantes([item({ itemNo: "M01-0147" })], new Map([["M01-0147", []]]));
  const ausente = decidirVariantes([item({ itemNo: "M01-0147" })], new Map());
  for (const r of [conVacia, ausente]) {
    assert.deepEqual(r.ambiguas, []);
    assert.equal(r.lineas[0].variantCode, undefined);
  }
});

test("la variante que ya trae la línea no se toca ni se cuestiona", () => {
  const { lineas, ambiguas } = decidirVariantes(
    [item({ itemNo: "M17-0297", variantCode: "BLANCO" })],
    new Map([["M17-0297", ["AZUL", "BLANCO"]]]),
  );
  assert.equal(lineas[0].variantCode, "BLANCO");
  assert.deepEqual(ambiguas, []);
});

test("un cargo nunca lleva variante", () => {
  const { lineas, ambiguas } = decidirVariantes(
    [{ tipo: "cargo", chargeNo: "TRANSPORTE", cantidad: 1, precio: 5000 }],
    new Map([["TRANSPORTE", ["A", "B"]]]),
  );
  assert.equal((lineas[0] as any).variantCode, undefined);
  assert.deepEqual(ambiguas, []);
});

// ---- "el pedido tiene que estar Abierto" ---------------------------------------
// Registrar una factura empieza tocando el encabezado del pedido. En moneda
// extranjera, validar la fecha recalcula el tipo de cambio del día y BC reescribe
// los importes de las líneas — y eso exige el documento abierto. Este es el texto
// EXACTO con el que se cayó CP-005156 (USD) el 25 ago 2026; la app lo reconoce
// para reabrir y reintentar sola.
test("se reconoce el error de BC que pide el pedido abierto", () => {
  const real = `{"error":{"code":"Application_FieldValidationException","message":"Status must be equal to 'Open' in Purchase Header: Document Type=Order, No.=CP-005156. Current value is 'Released'. CorrelationId: 2c862382-d441-49d4-8fd0-b2450762c96e."}}`;
  assert.equal(bcPideAbierto(real), true);
  assert.equal(bcPideAbierto("El estado debe ser igual a 'Abierto' en Cabecera compra"), true);
  // Un error cualquiera NO puede disparar la reapertura del pedido.
  assert.equal(bcPideAbierto(`{"error":{"message":"The field Vendor Invoice No. of table Purchase Header contains a value that cannot be found"}}`), false);
  assert.equal(bcPideAbierto(""), false);
});

// ---- centro de costo: los DOS tipos de pedido ----------------------------------
// Consumo inmediato: la obra viaja como Job No. (BC lo carga contra el proyecto).
// Para stock: el material entra a bodega APARTADO para esa obra, así que no puede
// llevar Job No. —BC exige tarea con él— pero sí tiene que llevar su centro de costo.
// Antes se sacaba el CC del Job No., o sea que el segundo caso se iba sin nada.
const ordLinea = (p: Partial<import("./types.ts").OrdenLinea> = {}): import("./types.ts").OrdenLinea => ({
  id: p.id ?? "ol1", tipo: p.tipo ?? "articulo", articuloId: p.articuloId ?? "M01-0147",
  descripcion: p.descripcion ?? "VARILLA", cantidad: p.cantidad ?? 5, unidad: p.unidad ?? "UND",
  almacen: p.almacen ?? "ALM-GRAL", precioUnitario: p.precioUnitario ?? 100, ivaPct: 13,
  cantidadRecibida: 0, cantidadFacturada: 0,
  proyecto: p.proyecto, taskNo: p.taskNo, pedidoLineaId: p.pedidoLineaId,
});

test("consumo directo: el centro de costo es su propia obra", () => {
  assert.equal(centroCostoDeLinea(ordLinea({ proyecto: "VN-L.20", taskNo: "2.2" })), "VN-L.20");
});

test("para stock: el centro de costo sale de la obra de la solicitud", () => {
  const l = ordLinea({ pedidoLineaId: "77" });          // sin obra propia (va al almacén)
  assert.equal(centroCostoDeLinea(l, new Map([["77", "VN-K.26"]])), "VN-K.26");
  assert.equal(centroCostoDeLinea(l), "");              // sin el mapa no se inventa nada
});

test("compra directa sin obra: no hay centro de costo que mandar", () => {
  assert.equal(centroCostoDeLinea(ordLinea({ pedidoLineaId: undefined })), "");
});

test("lineasOrdenParaBc: el CC viaja por línea, junto al jobNo cuando lo hay", () => {
  const ls = lineasOrdenParaBc(
    [ordLinea({ id: "a", proyecto: "VN-L.20", taskNo: "2.2" }), ordLinea({ id: "b", pedidoLineaId: "77" })],
    new Map([["77", "VN-K.26"]]),
  );
  assert.equal(ls[0].jobNo, "VN-L.20");
  assert.equal(ls[0].centroCosto, "VN-L.20");
  assert.equal(ls[1].jobNo, undefined);                 // stock: NUNCA como Job No.
  assert.equal(ls[1].centroCosto, "VN-K.26");
});

test("el payload manda la dimensión por línea (código + valor), y nada si no hay", () => {
  const { lines } = payloadReplaceLines([
    item({ centroCosto: "VN-K.26" }),
    item({ itemNo: "M02" }),
  ]);
  assert.equal(lines[0].ccValue, "VN-K.26");
  assert.equal(lines[0].ccCode, "CC");                  // BC_DIMENSION_CC, default CC
  // Sin centro de costo NO se manda la clave: mandarla vacía borraría la dimensión
  // que BC pone sola por el ítem o el almacén.
  assert.ok(!("ccValue" in lines[1]));
  assert.ok(!("ccCode" in lines[1]));
});

test("el encabezado toma un CC y avisa cuando la orden mezcla obras", () => {
  const uno = centroCostoDeOrden([item({ centroCosto: "VN-K.26" }), item({ centroCosto: "VN-K.26" })]);
  assert.equal(uno.cc, "VN-K.26");
  assert.deepEqual(uno.mezcla, []);
  const varias = centroCostoDeOrden([item({ centroCosto: "VN-K.26" }), item({ centroCosto: "VB-5.01" })]);
  assert.equal(varias.cc, "VN-K.26");                   // el primero: dispara el workflow
  assert.deepEqual(varias.mezcla, ["VN-K.26", "VB-5.01"]);
  assert.equal(centroCostoDeOrden([item({})]).cc, "");
});

// ── ALMACENES CON EL CC AMARRADO (CP-005293) ─────────────────────────────────
// La ubicación F-MUEBLES tiene en BC una dimensión predeterminada CC = F-MUEBLES
// con "Igual código": la línea que entre ahí NO puede llevar el CC de la obra, y BC
// se da cuenta recién al registrar. Cuál almacén amarra qué es configuración de BC
// —la API estándar no la expone— así que se declara con BC_CC_POR_ALMACEN.
// Vacía (el default) = no se fuerza nada.
test("BC_CC_POR_ALMACEN: sin la env, ningún almacén fuerza nada", () => {
  delete process.env.BC_CC_POR_ALMACEN;
  assert.equal(ccForzadoDelAlmacen("F-MUEBLES"), "");
  assert.equal(ccForzadoDelAlmacen(""), "");
  assert.equal(ccForzadoDelAlmacen(undefined), "");
});

test("BC_CC_POR_ALMACEN: mapea almacén → valor forzado, y el atajo repite el código", () => {
  process.env.BC_CC_POR_ALMACEN = "F-MUEBLES=F-MUEBLES,VN-M.28";
  try {
    assert.equal(ccForzadoDelAlmacen("F-MUEBLES"), "F-MUEBLES");
    assert.equal(ccForzadoDelAlmacen(" f-muebles "), "F-MUEBLES");   // no importa cómo venga escrito
    assert.equal(ccForzadoDelAlmacen("VN-M.28"), "VN-M.28");         // atajo: sin "=", el valor es el mismo código
    assert.equal(ccForzadoDelAlmacen("ALM-GRAL"), "");               // el resto sigue igual
  } finally { delete process.env.BC_CC_POR_ALMACEN; }
});

test("en un almacén con CC amarrado, gana el CC del almacén y no el de la obra", () => {
  process.env.BC_CC_POR_ALMACEN = "F-MUEBLES=F-MUEBLES";
  try {
    const { lines } = payloadReplaceLines([
      item({ locationCode: "F-MUEBLES", centroCosto: "VN-L.34" }),
      item({ locationCode: "ALM-GRAL", centroCosto: "VN-L.34" }),
    ]);
    // La línea que va a F-MUEBLES viaja con el valor que BC exige: mandarle el de la
    // obra hace que el pedido se cree y se lance bien y reviente AL REGISTRAR.
    assert.equal(lines[0].ccValue, "F-MUEBLES");
    // El almacén que no amarra nada sigue llevando el CC de la obra, como siempre.
    assert.equal(lines[1].ccValue, "VN-L.34");
  } finally { delete process.env.BC_CC_POR_ALMACEN; }
});

test("el almacén amarrado pone el CC incluso si la línea no traía ninguno", () => {
  process.env.BC_CC_POR_ALMACEN = "F-MUEBLES";
  try {
    const { lines } = payloadReplaceLines([item({ locationCode: "F-MUEBLES" })]);
    assert.equal(lines[0].ccValue, "F-MUEBLES");
    assert.equal(lines[0].ccCode, "CC");
  } finally { delete process.env.BC_CC_POR_ALMACEN; }
});
