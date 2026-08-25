// Pruebas del payload que reescribe las líneas de un pedido en BC.
// Es la traducción app → BC de CANTIDAD y PRECIO: contra estos números Bodega
// recibe y Contabilidad factura. Si acá sale mal, entra mercadería equivocada al
// inventario y a la contabilidad, y en pantalla todo se ve bien.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { payloadReplaceLines, sinObrasInexistentes, avisoDeSaneo, lineasOrdenParaBc, crearEnBcAlEnviar, type LineaReplaceBc } from "./bc.ts";
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

test("sin unidad se manda vacío y BC pone la del ítem (no se inventa una)", () => {
  const { lines } = payloadReplaceLines([item({})]);
  assert.equal(lines[0].unitOfMeasureCode, "");
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

test("los campos opcionales viajan vacíos, no como undefined", () => {
  const { lines } = payloadReplaceLines([item({ variantCode: undefined, jobNo: undefined, taskNo: undefined, locationCode: undefined })]);
  const l = lines[0] as any;
  assert.equal(l.variantCode, "");
  assert.equal(l.jobNo, "");
  assert.equal(l.taskNo, "");
  assert.equal(l.locationCode, "");
  assert.equal(l.lineDiscountPct, 0);
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
