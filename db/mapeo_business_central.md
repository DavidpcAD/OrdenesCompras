# Mapeo App ↔ Business Central ↔ SQL

Cómo se corresponden las pantallas de la app, los documentos de Business Central
(Purchase Header tabla 38 / Purchase Line tabla 39) y las tablas del espejo SQL.

## Flujo de documentos

| Etapa en la app | Documento en BC | Document Type | Serie No. | Ejemplo |
|---|---|---|---|---|
| Ingeniería — pedido de material | **Oferta de compra** (Purchase Quote) | `Oferta` | `C COTIZA` | CCT-000038 |
| Proveeduría — orden al proveedor | **Pedido de compra** (Purchase Order) | `Pedido` | `C PED` | CP-000357 |
| Facturación — recepción + factura | **Purch. Receipt** + **Purchase Invoice** | `Factura` | `C RECEPC` / `C FAC R` | — |

> La Oferta (CCT) se vuelve Pedido (CP) con **Convertir en pedido**. El enlace queda
> en `Quote No.` (header) y `GomCtm Quote No./Quote Line No.` (líneas). Al registrar la
> recepción/factura, BC llena `Vendor Invoice No.`, `Posting Date` y las cantidades recibidas.

---

## Cabecera — Purchase Header (38)

Campos de BC que el espejo SQL debe guardar (No. de campo entre paréntesis):

| Columna SQL (compras) | Campo Business Central | Notas |
|---|---|---|
| `BcDocumentType` | Document Type (1) | Oferta / Pedido / Factura / Abono… |
| `Numero` / `BcNo` | No. (3) | CCT- (oferta) o CP- (pedido) |
| `ProveedorId` → `BcBuyFromVendorNo` | Buy-from Vendor No. (2) | y Pay-to Vendor No. (4) |
| `ProveedorNombre` | Buy-from Vendor Name (79) | cache del nombre |
| `Fecha` | Order Date (19) | fecha de emisión / pedido |
| `FechaDocumento` | Document Date (99) | |
| `FechaRegistro` | Posting Date (20) | la que “vale” contablemente |
| `FechaVencimiento` | Due Date (24) | según términos del proveedor |
| `FechaRecepEsperada` | Expected/Requested/Promised Receipt Date (21/5790/5791) | |
| `FechaRecepFactura` | Invoice Received Date (175) | |
| `NumeroFacturaProveedor` | Vendor Invoice No. (68) | clave al facturar |
| `VendorOrderNo` / `VendorShipmentNo` | Vendor Order No. (66) / Vendor Shipment No. (67) | |
| `Estado` | Status (120) | Abierto / Pendiente aprobación / Lanzado |
| `QuoteNo` | Quote No. (151) | enlace oferta→pedido |
| `NoSeries` | No. Series (107) | C COTIZA |
| `PostingNoSeries` / `ReceivingNoSeries` | (108) / (109) | C FAC R / C RECEPC |
| `VersionesArchivadas` | No. of Archived Versions (5043) | |
| `CompletelyReceived` | Completely Received (5752) | |
| `PartiallyInvoiced` / `ReceivedNotInvoiced` | (5751) / (5755) | |
| `Locationdefault` | Location Code (28) | almacén |
| `CurrencyCode` / `CurrencyFactor` | Currency Code (32) / Currency Factor (33) | vacío = CRC; si USD se guarda factor + montos LCY |
| `PaymentTermsCode` / `PaymentMethodCode` | Payment Terms Code (23) / Payment Method Code (104) | CONTADO / TRANSFER |
| `ShortcutDimension1/2Code` / `DimensionSetId` | (29) / (30) / Dimension Set ID (480) | dimensiones contables |
| `MontoSinIVA` / `MontoConIVA` | Amount (60) / Amount Including VAT (61) | |
| `DescripcionDoc` | GomCtm Description (50000) | campo Adelante (“Calentador D.17”) |
| `JobNo` (proyecto) | GomJob PB Code (70720585) / Job en líneas | obra / proyecto |
| `AssignedUserId` | Assigned User ID (9000) | |
| `BcSystemId` | $systemId (2000000000) | GUID del registro en BC |
| `BcCreatedBy` / `BcCreatedAt` | SystemCreatedBy/At (2000000002/1) | ej. LAURA |
| `BcModifiedBy` / `BcModifiedAt` | SystemModifiedBy/At (2000000004/3) | ej. LUISROBERTO |

**Localización Costa Rica (CR) — guardar para fiscal/retenciones:**
`LLB Type Of Tax Regime (70830818)`, `LLB VAT Withholding (70830820)`,
`LLB Tax Withholding (70830821)`, `LLB Fiscal Invoice No. PAC GS (95101)`,
`LLB Numeric Key GS (95108)`, `Tax Area Code (114)`, `VAT Bus. Posting Group (116)`,
`Gen. Bus. Posting Group (74)`, `Vendor Posting Group (31)`.

---

## Líneas — Purchase Line (39)

| Columna SQL (compras) | Campo Business Central | Notas |
|---|---|---|
| `LineNo` | Line No. (4) | 10000, 20000… |
| `Tipo` | Type (5) | Artículo / Cargo / **Comentario** / Cuenta / Recurso / Activo fijo |
| `PostingGroup` | Posting Group (8) | ej. MATERIALES |
| `GenProdPostingGroup` | Gen. Prod. Posting Group (75) | ej. BIENES |
| `VatProdPostingGroup` | VAT Prod. Posting Group (90) | ej. EXENTO-BIENES |
| `ItemCategoryCode` | Item Category Code (5709) | ej. ACCES_EQUIPOS |
| `ShortcutDimension1/2Code` | Shortcut Dimension 1/2 Code (40/41) | dimensiones (MAQ, MAQ VAR) |
| `UnitCostLcy` / `AmountLcy` | Unit Cost (LCY) (23) / Outstanding Amount (LCY) (92) | montos en colones |
| `ArticuloId` → `BcNo` | No. (6) | código de artículo (M13-0044) |
| `Almacen` | Location Code (7) | ALM-GRAL, VN-D.17… |
| `Descripcion` / `Descripcion2` | Description (11) / Description 2 (12) | |
| `Unidad` | Unit of Measure Code (5407) | UND, PAR… |
| `Cantidad` | Quantity (15) | |
| `CantidadPendiente` | Outstanding Quantity (16) | calculada |
| `QtyToReceive` / `QtyToInvoice` | Qty. to Receive (18) / Qty. to Invoice (17) | cantidad a recibir / facturar |
| `CantidadRecibida` / `CantidadFacturada` | Quantity Received (60) / Quantity Invoiced (61) | |
| `QtyRcdNotInvoiced` | Qty. Rcd. Not Invoiced (58) | recibido sin facturar |
| `PrecioUnitario` | Direct Unit Cost (22) | |
| `Importe` | Line Amount (103) / Amount (29) | |
| `IvaPct` | VAT % (25) | |
| `DescuentoPct` / `DescuentoMonto` | Line Discount % (27) / Amount (28) | |
| `JobNo` / `JobTaskNo` | Job No. (45) / Job Task No. (1001) | proyecto / obra |
| **Cargo (flete):** `PermiteAsignacionCargo` | Allow Item Charge Assignment (5800) | |
| `QtyToAssign` / `QtyAssigned` | Qty. to Assign (5801) / Qty. Assigned (5802) | distribución del flete |
| **Trazabilidad:** `ReceiptNo` / `ReceiptLineNo` | Receipt No. (63) / Receipt Line No. (64) | |
| `OrderNo` / `OrderLineNo` | Order No. (65) / Order Line No. (66) | pedido origen |
| `QuoteNo` / `QuoteLineNo` | GomCtm Quote No. (50001) / Quote Line No. (50002) | oferta origen |
| `VariantCode` / `BinCode` | Variant Code (5402) / Bin Code (5403) | |

---

## Notas de integración

1. **Una sola tabla en BC, varias en SQL.** En BC todo es `Purchase Header` + `Purchase Line`
   distinguido por `Document Type`. En SQL los separamos por etapa (Pedidos/Ordenes/Recepciones)
   para la app, pero cada fila guarda `BcDocumentType` + `BcSystemId` para reconciliar 1:1.
2. **Clave de sincronización:** `BcSystemId` (GUID) es el ancla. `SyncedToBc` marca lo ya enviado.
3. **El flete es una línea `Type = Cargo`**; su distribución vive en `Qty. to Assign / Qty. Assigned`
   y solo se asigna/factura cuando la orden se recibe completa (regla confirmada en la reunión).
4. **Auditoría:** además de la bitácora `Movimientos` (interna), guardamos los campos
   `SystemCreatedBy/ModifiedBy` de BC para saber quién tocó el documento allá (Laura, Luis Roberto…).
5. **Multimoneda.** Los pedidos pueden estar en USD (ej. CP-000357: `Currency Code = USD`,
   `Currency Factor`). Guardar moneda + factor y montos en moneda del documento **y** en LCY
   (colones) — no asumir CRC. La UI muestra el símbolo según `CurrencyCode`.
6. **El Pedido (CP) no siempre nace de una Oferta.** El `Quote No.` puede venir vacío cuando
   proveeduría crea el CP directo. La app debe permitir ambos caminos: convertir una oferta o
   crear la orden desde cero.
7. **Tipos de línea reales:** Artículo, Cargo (flete), Comentario, Cuenta, Recurso, Activo fijo.
   Las líneas de Comentario no tienen cantidad ni precio (solo texto), igual que en BC.
8. **Dimensiones y grupos contables** (Dimension 1/2, Posting/Gen.Prod./VAT Prod. Posting Group,
   Item Category) viajan en cada línea y son necesarios para que el asiento cuadre en BC.

---

## Catálogos para selección (lookups vía API de BC)

Al crear una oferta/orden se **selecciona el proveedor** y luego se **buscan y seleccionan
materiales**. Esos datos **viven en Business Central** y se consultan EN VIVO por API
(`GET vendors?search=`, `GET items?search=`). **No se almacenan en SQL** como catálogo;
solo se persiste la selección dentro de los documentos (proveedorNo, itemNo, obra, maquinaNo,
nombres y grupos contables como snapshot en texto al momento de elegir).

### Proveedor ← Vendor (tabla 23, Vendor Lookup 34)

| Columna SQL | Campo BC | |
|---|---|---|
| `no` | No. (1) | PROV-000001 |
| `nombre` / `searchName` | Name (2) / Search Name (3) | |
| `direccion` / `ciudad` / `codigoPostal` / `provincia` | Address (5) / City (7) / Post Code (91) / County (92) | |
| `vatRegistrationNo` / `vatRegistrationType` | VAT Registration No. (86) / LLB VAT registration Type | cédula jurídica |
| `vendorPostingGroup` / `genBusPostingGroup` / `vatBusPostingGroup` | (21) / (88) / (110) | se heredan a la orden |
| `paymentTermsCode` / `paymentMethodCode` / `currencyCode` | (27) / (47) / (22) | autollenan la orden |
| `blocked` / `privacyBlocked` | Blocked (39) / Privacy Blocked (150) | no mostrar bloqueados |

### Material ← Item (tabla 27, Item Lookup 32)

| Columna SQL | Campo BC | |
|---|---|---|
| `no` / `descripcion` / `searchDescription` | No. (1) / Description (3) / Search Description (4) | |
| `tipo` | Type (10) | Inventario / Servicio / No inventariable |
| `baseUnitOfMeasure` / `purchUnitOfMeasure` | (8) / (5426) | UND |
| `inventory` / `unitCost` / `lastDirectCost` | Inventory (68) / Unit Cost (22) / Last Direct Cost (25) | mostrar stock y costo |
| `genProdPostingGroup` / `vatProdPostingGroup` / `itemCategoryCode` | (91) / (99) / (5702) | se heredan a la línea |
| `blocked` / `purchasingBlocked` | Blocked (54) / Purchasing Blocked (8004) | no mostrar bloqueados |

**APIs necesarias:** `GET vendors?search=` (Vendor Lookup) y `GET items?search=` (Item Lookup),
idealmente la API estándar de BC (`/api/v2.0/.../vendors`, `.../items`) o un endpoint propio que
las espeje. La app filtra `blocked = false`.

---

## Roles y responsabilidades (personas reales)

| Módulo | Persona | Qué hace |
|---|---|---|
| **Ingeniería** | **Laura** | Crea la **solicitud** de material. Pone ítems, almacén, cantidad y el **destino**. NO pone proveedor ni precio. Dos tipos: **material** → selecciona **obra**; **repuesto** → selecciona **máquina**. |
| **Proveeduría** | **Angie** | Ve **todos los materiales solicitados** (de varios pedidos) en una tabla; **selecciona líneas de distintos pedidos** y arma **una sola orden** para el proveedor. Aquí elige proveedor, fechas, IVA, tipo de línea, etc. |
| **Bodega** | **Kattya** | Recibe el material y **registra la factura**: mete las cantidades reales que llegaron. Esto genera los **movimientos contables** y alimenta el **inventario**. |

## Tipo de solicitud (Ingeniería)

- `tipoSolicitud = 'material'` → destino **Obra** (`obra` / catálogo `Obra`).
- `tipoSolicitud = 'repuesto'` → destino **Máquina** (`maquinaNo` / catálogo `Maquina`, espejo de GomEqp Parque Maquinaria).

## Cardinalidad del flujo (confirmada)

```
PedidoCompra  N >───< N  OrdenCompra  1 ───< N  RecepcionCompra
  (Laura)                 (Angie)                 (Kattya)
```

- **Pedido ↔ Orden es N:M**: una orden puede combinar líneas de **varios pedidos**, y un pedido
  puede repartirse en **varias órdenes**. El enlace vive **a nivel de línea** en
  `OrdenCompraDet.idPedidoCompraDet` (no hay FK de cabecera a un solo pedido).
- Una **orden** tiene **muchas recepciones** (entregas parciales del proveedor),
  por `RecepcionCompra.idOrdenCompra` y `RecepcionCompraDet.idOrdenCompraDet`.
- Las vistas `vw_PedidoCompraSaldo` y `vw_OrdenCompraSaldo` dicen cuánto falta y el %
  completado hasta llegar al **100% del pedido**.
