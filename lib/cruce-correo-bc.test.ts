// El cruce correo ↔ Business Central. Lo que se defiende acá es que NO calce de más:
// cada falso positivo es una factura que se da por registrada sin estarlo.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  partirClave, leerComprobanteXml, leerLineasXml, leerResumenXml, cruzar, colasDelConsecutivo,
  CEDULA_ADELANTE, type Comprobante,
} from "./cruce-correo-bc.ts";
import type { FacturaBc, ProveedorBc } from "./vigilancia-facturas.ts";

const fac = (
  numero: string, numeroProveedor: string, proveedorCodigo: string, proveedorNombre: string,
  fecha: string, total: number, moneda = "CRC",
): FacturaBc => ({ numero, numeroProveedor, proveedorCodigo, proveedorNombre, fecha, total, moneda });

const prov = (codigo: string, nombre: string, cedula = ""): ProveedorBc => ({ codigo, nombre, cedula });

const comp = (
  consecutivo: string, cedulaEmisor: string, nombreEmisor: string,
  fecha: string, total: number, moneda = "CRC", cedulaReceptor = CEDULA_ADELANTE,
): Comprobante => ({
  clave: "", consecutivo, tipo: consecutivo.slice(8, 10), cedulaEmisor, nombreEmisor,
  cedulaReceptor, fecha, total, moneda,
});

// --- la clave de 50 dígitos ------------------------------------------------

test("parte la clave real de Buen Precio en sus pedazos", () => {
  // Es la del adjunto BUEN PRECIO506...590464134288884.xml del 22 de setiembre.
  const r = partirClave("50622092600310129978800100001010000590464134288884");
  assert.deepEqual(r, {
    cedulaEmisor: "3101299788",
    consecutivo: "00100001010000590464",
    tipo: "01",
    fecha: "2026-09-22",
  });
});

test("reconoce una nota de crédito por el tipo del consecutivo", () => {
  // EPA: 00800090 | 03 | 0000001789 → el 03 es nota de crédito.
  const r = partirClave("50601092600310112345600800090030000001789100000001");
  assert.equal(r?.tipo, "03");
});

test("una clave que no tiene 50 dígitos no se inventa", () => {
  assert.equal(partirClave("506010926"), null);
  assert.equal(partirClave(""), null);
});

// --- leer el XML -----------------------------------------------------------

const XML_FACTURA = `<?xml version="1.0" encoding="utf-8"?>
<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/facturaElectronica">
  <Clave>50622092600310129978800100001010000590464134288884</Clave>
  <NumeroConsecutivo>00100001010000590464</NumeroConsecutivo>
  <FechaEmision>2026-09-22T08:52:12-06:00</FechaEmision>
  <Emisor><Nombre>MADERAS Y FERRETERIA BUEN PRECIO S.A</Nombre>
    <Identificacion><Tipo>02</Tipo><Numero>3101299788</Numero></Identificacion></Emisor>
  <Receptor><Nombre>ADELANTE DESARROLLOS S.A.</Nombre>
    <Identificacion><Tipo>02</Tipo><Numero>3101621790</Numero></Identificacion></Receptor>
  <ResumenFactura><CodigoMoneda>CRC</CodigoMoneda><TotalComprobante>106013.82</TotalComprobante></ResumenFactura>
</FacturaElectronica>`;

test("saca del XML lo que hace falta para cruzar", () => {
  const c = leerComprobanteXml(XML_FACTURA, "BUEN PRECIO.xml");
  assert.equal(c?.cedulaEmisor, "3101299788");
  assert.equal(c?.cedulaReceptor, "3101621790");
  assert.equal(c?.consecutivo, "00100001010000590464");
  assert.equal(c?.total, 106013.82);
  assert.equal(c?.moneda, "CRC");
  assert.equal(c?.fecha, "2026-09-22");
  assert.equal(c?.nombreEmisor, "MADERAS Y FERRETERIA BUEN PRECIO S.A");
  assert.equal(c?.archivo, "BUEN PRECIO.xml");
});

test("lee igual un XML con prefijo de espacio de nombres", () => {
  const conPrefijo = XML_FACTURA
    .replace(/<Clave>/g, "<ns:Clave>").replace(/<\/Clave>/g, "</ns:Clave>")
    .replace(/<TotalComprobante>/g, "<ns:TotalComprobante>").replace(/<\/TotalComprobante>/g, "</ns:TotalComprobante>");
  assert.equal(leerComprobanteXml(conPrefijo)?.total, 106013.82);
});

test("el acuse de Hacienda NO es un comprobante", () => {
  // Cada factura llega con su XML y con el de respuesta. Si el acuse se colara, toda
  // factura aparecería dos veces y la mitad saldría como "no está en BC".
  const acuse = `<MensajeReceptor><Clave>50622092600310129978800100001010000590464134288884</Clave>
    <Mensaje>1</Mensaje></MensajeReceptor>`;
  assert.equal(leerComprobanteXml(acuse), null);
});

test("el euro del XML se traduce al código que usa BC", () => {
  const eur = XML_FACTURA.replace("<CodigoMoneda>CRC</CodigoMoneda>", "<CodigoMoneda>EUR</CodigoMoneda>");
  assert.equal(leerComprobanteXml(eur)?.moneda, "EURO");
});

// --- las colas del consecutivo ---------------------------------------------

test("prueba las colas con que se pudo haber tecleado, de la larga a la corta", () => {
  const c = colasDelConsecutivo("00100001010000590464");
  assert.ok(c.includes("590464"), "debería probar la cola de 6");
  assert.ok(c.includes("10000590464"), "y colas más largas");
  assert.ok(!c.includes(""), "sin vacíos");
});

// --- el cruce --------------------------------------------------------------

const PROVEEDORES = [
  prov("PROV-001717", "Multisuministros de Costa Rica CR S.A.", "3101629776"),
  prov("PROV-001023", "MADERAS Y FERRETERIA BUEN PRECIO S.A", "3101299788"),
  prov("PROV-000400", "DISTRIBUIDORA TECNICA, S.A. (DITESA)"),   // sin cédula en BC
  prov("PROV-000096", "EASYBOX S.A.", "3101111111"),
];

test("calza por cédula del emisor, que es la llave que no miente", () => {
  const r = cruzar(
    [comp("00100001010000590464", "3101299788", "BUEN PRECIO", "2026-09-22", 106013.82)],
    [fac("CFR-1", "590464", "PROV-001023", "MADERAS Y FERRETERIA BUEN PRECIO S.A", "2026-09-22", 106013.82)],
    PROVEEDORES,
  );
  assert.equal(r.calzadas.length, 1);
  assert.equal(r.calzadas[0].por, "cedula");
  assert.equal(r.calzadas[0].diferencia, 0);
  assert.deepEqual(r.soloEnCorreo, []);
  assert.deepEqual(r.soloEnBc, []);
});

test("NO calza con otro proveedor aunque el número sea idéntico", () => {
  // El caso real que rompió el primer intento: el 81239 de Multisuministros calzaba
  // con una factura de EASYBOX por el mismo número.
  const r = cruzar(
    [comp("00100001010000081239", "3101629776", "MULTISUMINISTROS", "2026-09-01", 6961.6)],
    [fac("CFR-010084", "81239", "PROV-000096", "EASYBOX S.A.", "2026-09-01", 6961.6)],
    PROVEEDORES,
  );
  assert.equal(r.calzadas.length, 0);
  assert.equal(r.soloEnCorreo.length, 1);
  assert.equal(r.soloEnBc.length, 1);
});

test("si el proveedor de BC no tiene cédula, cae al nombre y lo deja marcado", () => {
  const r = cruzar(
    [comp("00100002010000129690", "3101038605", "DISTRIBUIDORA TECNICA DITESA", "2026-09-01", 50000)],
    [fac("CFR-009771", "129690", "PROV-000400", "DISTRIBUIDORA TECNICA, S.A. (DITESA)", "2026-09-01", 50000)],
    PROVEEDORES,
  );
  assert.equal(r.calzadas.length, 1);
  assert.equal(r.calzadas[0].por, "nombre");
});

test("el monto que no cuadra sale aparte, no como faltante", () => {
  // Consultoría e Inversiones Esmeralda: ₡140.698,44 en el comprobante, ₡140.702,38 en BC.
  const r = cruzar(
    [comp("00100002010000046606", "3101299788", "BUEN PRECIO", "2026-09-01", 140698.44)],
    [fac("CFR-009983", "46606", "PROV-001023", "MADERAS Y FERRETERIA BUEN PRECIO S.A", "2026-09-01", 140702.38)],
    PROVEEDORES,
  );
  assert.equal(r.calzadas.length, 0);
  assert.equal(r.descuadradas.length, 1);
  assert.equal(r.descuadradas[0].diferencia, 3.94);
  assert.deepEqual(r.soloEnCorreo, []);
});

test("los céntimos de redondeo no cuentan como descuadre", () => {
  const r = cruzar(
    [comp("00100001010000000001", "3101299788", "BUEN PRECIO", "2026-09-01", 1000.00)],
    [fac("CFR-1", "1", "PROV-001023", "BUEN PRECIO", "2026-09-01", 1000.30)],
    PROVEEDORES,
  );
  assert.equal(r.calzadas.length, 1);
  assert.equal(r.descuadradas.length, 0);
});

test("lo que viene a nombre de otra empresa del grupo se aparta", () => {
  const r = cruzar(
    [comp("00100001010000000001", "3101299788", "BUEN PRECIO", "2026-09-01", 100, "CRC", "3101999999")],
    [],
    PROVEEDORES,
  );
  assert.equal(r.otrasEmpresas.length, 1);
  assert.deepEqual(r.soloEnCorreo, []);
});

test("un comprobante sin cédula de receptor legible no se descarta", () => {
  const r = cruzar(
    [comp("00100001010000000001", "3101299788", "BUEN PRECIO", "2026-09-01", 100, "CRC", "")],
    [],
    PROVEEDORES,
  );
  assert.deepEqual(r.otrasEmpresas, []);
  assert.equal(r.soloEnCorreo.length, 1);
});

test("la ventana evita acusar a BC por correo que no se cargó", () => {
  // Se carga UN día de correo. Las facturas de BC de otros meses no pueden salir como
  // "no llegó comprobante": simplemente no se cargó ese correo.
  const r = cruzar(
    [comp("00100001010000000001", "3101299788", "BUEN PRECIO", "2026-09-01", 100)],
    [
      fac("CFR-VIEJA", "777", "PROV-001023", "BUEN PRECIO", "2026-03-15", 5000),
      fac("CFR-NUEVA", "888", "PROV-001023", "BUEN PRECIO", "2026-12-20", 5000),
      fac("CFR-DENTRO", "999", "PROV-001023", "BUEN PRECIO", "2026-09-02", 5000),
    ],
    PROVEEDORES,
  );
  assert.deepEqual(r.soloEnBc.map((f) => f.numero), ["CFR-DENTRO"]);
  assert.equal(r.ventana?.desde, "2026-08-27");
  assert.equal(r.ventana?.hasta, "2026-09-06");
});

test("una factura de BC no se reparte entre dos comprobantes", () => {
  const r = cruzar(
    [
      comp("00100001010000000123", "3101299788", "BUEN PRECIO", "2026-09-01", 100),
      comp("00100001010000000123", "3101299788", "BUEN PRECIO", "2026-09-01", 100),
    ],
    [fac("CFR-1", "123", "PROV-001023", "BUEN PRECIO", "2026-09-01", 100)],
    PROVEEDORES,
  );
  assert.equal(r.calzadas.length, 1);
  assert.equal(r.soloEnCorreo.length, 1, "el segundo comprobante queda sin factura, no se duplica");
});

test("sin comprobantes no hay ventana y nada se acusa", () => {
  const r = cruzar([], [fac("CFR-1", "1", "PROV-001023", "BUEN PRECIO", "2026-09-01", 100)], PROVEEDORES);
  assert.equal(r.ventana, null);
  // Sin correo cargado no se puede decir que a una factura le falte comprobante.
  assert.equal(r.soloEnBc.length, 1);
  assert.equal(r.calzadas.length, 0);
});

// --- entidades XML ---------------------------------------------------------

test("deshace las entidades: PIMMSA MACA & MONTENEGRO, no &amp;", () => {
  // Salió en pantalla el 23 de setiembre de 2026: la tabla mostraba
  // "PIMMSA PINTURAS MACA &amp; MONTENEGRO SOCIEDAD ANONIMA".
  const xml = XML_FACTURA.replace(
    "<Nombre>MADERAS Y FERRETERIA BUEN PRECIO S.A</Nombre>",
    "<Nombre>PIMMSA PINTURAS MACA &amp; MONTENEGRO SOCIEDAD ANONIMA</Nombre>",
  );
  assert.equal(leerComprobanteXml(xml)?.nombreEmisor, "PIMMSA PINTURAS MACA & MONTENEGRO SOCIEDAD ANONIMA");
});

test("deshace comillas, ángulos y códigos numéricos", () => {
  const xml = XML_FACTURA.replace(
    "<Nombre>MADERAS Y FERRETERIA BUEN PRECIO S.A</Nombre>",
    "<Nombre>&quot;EL&quot; &lt;A&gt; &apos;B&apos; CA&#209;AS</Nombre>",
  );
  assert.equal(leerComprobanteXml(xml)?.nombreEmisor, `"EL" <A> 'B' CAÑAS`);
});

test("un &amp;lt; del origen no se convierte en <", () => {
  // Por eso `&amp;` se deshace de último: al revés, &amp;lt; terminaría en "<" y
  // cambiaría el texto que mandó el proveedor.
  const xml = XML_FACTURA.replace(
    "<Nombre>MADERAS Y FERRETERIA BUEN PRECIO S.A</Nombre>",
    "<Nombre>A&amp;lt;B</Nombre>",
  );
  assert.equal(leerComprobanteXml(xml)?.nombreEmisor, "A&lt;B");
});

// --- las líneas del comprobante --------------------------------------------
//
// Las formas son las que mandan de verdad los proveedores de Adelante: unos escriben
// el XML con saltos de línea y otros todo de corrido, unos ponen `ImpuestoNeto` y
// otros solo el bloque `Impuesto`. Lo que se defiende es que ninguna de esas
// diferencias cambie un monto: lo que se ve en pantalla se compara contra BC.

const XML_LINEAS = `<FacturaElectronica>
  <Clave>50622092600310129978800100001010000590464134288884</Clave>
  <DetalleServicio>
    <LineaDetalle>
      <NumeroLinea>1</NumeroLinea>
      <Codigo>3110100000100</Codigo>
      <CodigoComercial><Tipo>01</Tipo><Codigo>8843419</Codigo></CodigoComercial>
      <Cantidad>55.00000</Cantidad>
      <UnidadMedida>Unid</UnidadMedida>
      <Detalle>Mad. Probosque 1 x 3 x 3,20 C4C PINO SH G-1</Detalle>
      <PrecioUnitario>3743.06000</PrecioUnitario>
      <MontoTotal>205868.30000</MontoTotal>
      <SubTotal>205868.30000</SubTotal>
      <Impuesto><Codigo>01</Codigo><Tarifa>13.00000</Tarifa><Monto>26762.87900</Monto></Impuesto>
      <ImpuestoNeto>26762.87900</ImpuestoNeto>
      <MontoTotalLinea>232631.17900</MontoTotalLinea>
    </LineaDetalle>
    <LineaDetalle><NumeroLinea>2</NumeroLinea><Codigo>4621205009900</Codigo><Cantidad>1.00</Cantidad><UnidadMedida>Sp</UnidadMedida><Detalle>Acarreo</Detalle><PrecioUnitario>54.35</PrecioUnitario><MontoTotal>54.30</MontoTotal><SubTotal>54.30</SubTotal><Impuesto><Codigo>01</Codigo><Monto>7.10</Monto></Impuesto><MontoTotalLinea>61.40</MontoTotalLinea></LineaDetalle>
  </DetalleServicio>
  <ResumenFactura>
    <CodigoTipoMoneda><CodigoMoneda>CRC</CodigoMoneda><TipoCambio>1.00</TipoCambio></CodigoTipoMoneda>
    <TotalVenta>205922.60000</TotalVenta>
    <TotalDescuentos>0.00000</TotalDescuentos>
    <TotalVentaNeta>205922.60000</TotalVentaNeta>
    <TotalImpuesto>26769.97900</TotalImpuesto>
    <TotalOtrosCargos>0.00000</TotalOtrosCargos>
    <TotalComprobante>232692.57900</TotalComprobante>
  </ResumenFactura>
</FacturaElectronica>`;

test("saca TODAS las líneas, con o sin saltos de línea en el XML", () => {
  const l = leerLineasXml(XML_LINEAS);
  assert.equal(l.length, 2);
  assert.equal(l[0].detalle, "Mad. Probosque 1 x 3 x 3,20 C4C PINO SH G-1");
  assert.equal(l[1].detalle, "Acarreo");
});

test("cantidad, precio unitario y total salen tal cual los mandó el proveedor", () => {
  const [a] = leerLineasXml(XML_LINEAS);
  assert.equal(a.cantidad, 55);
  assert.equal(a.precioUnitario, 3743.06);
  assert.equal(a.total, 232631.179);
  assert.equal(a.unidad, "Unid");
});

test("el código que se muestra es el del proveedor, y el CABYS va aparte", () => {
  // El 8843419 es el que aparece en la factura de papel; el 3110100000100 es el de
  // Hacienda. Confundirlos hace imposible cotejar contra el artículo de BC.
  const [a] = leerLineasXml(XML_LINEAS);
  assert.equal(a.codigo, "8843419");
  assert.equal(a.cabys, "3110100000100");
});

test("una línea sin CABYS no se inventa uno con el código del impuesto", () => {
  // `Codigo` a secas también existe dentro de <Impuesto> (el "01" del IVA). Sin el
  // filtro de 13 dígitos, esa línea mostraría "CABYS 01".
  const sinCabys = XML_LINEAS.replace("<Codigo>3110100000100</Codigo>", "");
  assert.equal(leerLineasXml(sinCabys)[0].cabys, "");
});

test("sin ImpuestoNeto, el impuesto se suma de los bloques Impuesto", () => {
  const [, b] = leerLineasXml(XML_LINEAS);
  assert.equal(b.impuesto, 7.1);
});

test("dos impuestos en una línea se suman, no se toma el primero", () => {
  // Pasa con el IVA más un específico (bebidas, cemento). Quedarse con el primero le
  // quitaría plata a la línea y la haría ver como que BC cobró de más.
  const dos = XML_LINEAS.replace(
    "<Impuesto><Codigo>01</Codigo><Monto>7.10</Monto></Impuesto>",
    "<Impuesto><Codigo>01</Codigo><Monto>7.10</Monto></Impuesto><Impuesto><Codigo>08</Codigo><Monto>2.90</Monto></Impuesto>",
  );
  assert.equal(leerLineasXml(dos)[1].impuesto, 10);
});

test("si el emisor omite MontoTotalLinea, la línea no queda en cero", () => {
  const sinTotal = XML_LINEAS.replace("<MontoTotalLinea>61.40</MontoTotalLinea>", "");
  assert.equal(leerLineasXml(sinTotal)[1].total, 61.4);   // 54.30 + 7.10
});

test("un comprobante sin líneas devuelve una lista vacía, no revienta", () => {
  assert.deepEqual(leerLineasXml("<FacturaElectronica></FacturaElectronica>"), []);
  assert.deepEqual(leerLineasXml(""), []);
});

test("el resumen trae subtotal, impuesto y total del comprobante", () => {
  const r = leerResumenXml(XML_LINEAS);
  assert.equal(r.subtotal, 205922.6);
  assert.equal(r.impuesto, 26769.979);
  assert.equal(r.total, 232692.579);
  assert.equal(r.moneda, "CRC");
});

test("el euro del XML se guarda como lo llama BC", () => {
  // El XML dice EUR (ISO) y BC dice EURO. Si no se normaliza, los totales se
  // comparan entre monedas distintas y todo sale descuadrado.
  const eur = XML_LINEAS.replace("<CodigoMoneda>CRC</CodigoMoneda>", "<CodigoMoneda>EUR</CodigoMoneda>");
  assert.equal(leerResumenXml(eur).moneda, "EURO");
});

test("un descuento de línea se lee y no se pierde", () => {
  const conDesc = XML_LINEAS.replace(
    "<SubTotal>54.30</SubTotal>",
    "<Descuento><MontoDescuento>5.00</MontoDescuento><NaturalezaDescuento>Promoción</NaturalezaDescuento></Descuento><SubTotal>54.30</SubTotal>",
  );
  assert.equal(leerLineasXml(conDesc)[1].descuento, 5);
});
