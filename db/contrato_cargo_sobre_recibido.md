# Contrato BC — Cargo de producto sobre factura/recepción ya registrada

Caso de negocio: un proveedor factura los materiales, pero **un tercero** (p. ej. el
transportista) factura aparte el flete de esos materiales **ya recibidos**. En BC eso
se registra creando un **pedido de compra al proveedor del cargo con UNA sola línea
"Cargo (Prod.)"**, trayendo las líneas de la(s) **recepción(es) ya registrada(s)**
(albarán, `Purch. Rcpt. Line`), asignando el cargo con un método de reparto, poniendo
el **Nº factura del proveedor** y **registrando**.

La app (rol Bodega/Kattya → pantalla **"Cargo sobre factura"**) ya consume este contrato;
mientras no se publique, la pantalla degrada con gracia (avisa "API no publicada").

> Es funcionalidad DISTINTA del cargo que ya existe. El `AdelantePO_AssignItemCharges`
> actual asigna el cargo a las líneas del MISMO pedido. Aquí el pedido **no tiene líneas
> de artículo**; el cargo se asigna a líneas de documentos **ya registrados**. NO reutilizar
> el codeunit de registrar-al-crear-pedido.

---

## 1) Lectura — API custom `postedReceiptLines` (grupo `purchasing`)

Nueva page/API custom Adelante sobre **`Purch. Rcpt. Line` (tabla 121)**, en el mismo
estilo que `itemCharges` / `lastPurchasePrices` ya publicadas.

```
GET api/adelante/purchasing/v1.0/companies({id})/postedReceiptLines
    ?$filter=buyFromVendorNo eq '<prov>' and no eq '<item>' and documentNo eq '<CR-xxxx>'
    &$orderby=documentNo desc,lineNo
```

La app filtra por cualquier combinación de: **proveedor del material** (`buyFromVendorNo`),
**artículo** (`no`) y **Nº de recepción** (`documentNo`). Devuelve al menos:

| Campo API (camelCase) | Purch. Rcpt. Line | Uso en la app |
|---|---|---|
| `documentNo`       | Document No. (2)         | Nº recepción registrada (albarán), p.ej. CR-000003 |
| `lineNo`           | Line No. (4)             | identifica la línea destino del cargo |
| `buyFromVendorNo`  | Buy-from Vendor No. (6)  | filtro por proveedor del material |
| `no`               | No. (6→Item) (6)         | artículo recibido |
| `description`      | Description (11)         | |
| `locationCode`     | Location Code (7)        | |
| `quantity`         | Quantity (15)            | cantidad recibida |
| `directUnitCost`   | Direct Unit Cost (22)    | |
| `lineAmount`       | Line Amount / Amount     | base del reparto **Por importe** |
| `grossWeight`      | (del ítem) Gross Weight  | base del reparto **Por peso** |
| `unitVolume`       | (del ítem) Unit Volume   | base del reparto **Por volumen** |
| `postingDate`      | Posting Date (5)         | |

Solo tiene sentido devolver líneas de tipo **Artículo** (Type = Item). Idealmente
excluir/filtrar las que ya tengan el cargo totalmente asignado (opcional).

---

## 2) Registro — codeunit `AdelantePO_PostChargeOnReceipts`

Web service OData (igual estilo que `AdelantePO_PostInvoice`). Hace TODO server-side y
devuelve texto (el Nº de la factura de compra registrada).

**Request** (`POST ODataV4/AdelantePO_PostChargeOnReceipts?company={id}`) — contrato FINAL,
tal como quedó publicado (el JSON mapea 1:1 a los parámetros del codeunit):

```jsonc
{
  "chargeVendorNo":   "PROV-000XXX",       // proveedor del cargo (transportista)
  "itemChargeNo":     "01",                // Item Charge (tipo de cargo)
  "chargeAmount":     1000000,             // importe TOTAL del cargo
  "vendorInvoiceNo":  "FE-000123",         // OBLIGATORIO (Vendor Invoice No.)
  "metodo":           "Amount",            // Amount | Equally | Weight | Volume
  "receiptLinesJson": "[{\"documentNo\":\"CR-000003\",\"lineNo\":30000}]",
  "postingDate":      "2026-06-30"         // Posting/Document Date. "" → BC usa Today()
}
```

> **`postingDate` (resuelto):** el dev agregó `postingDate` a los CUATRO métodos de posteo
> (`PostInvoice`, `PostReceipt`, `PostInvoiceOfReceived`, `PostChargeOnReceipts`). Con
> fecha → setea `Posting Date` + `Document Date`; vacío `""` → `Today()`. Así una factura
> de un período anterior queda en el período correcto. La app ya reenvía la fecha que
> captura Kattya (cargo → fecha de emisión; registrar → fecha de registro contable;
> recibir → fecha de recepción). La moneda la resuelve BC por el proveedor del cargo.

**Lógica AL esperada:**

1. Crear **Purchase Header** tipo `Order`, `Buy-from Vendor No. = chargeVendorNo`,
   `Vendor Invoice No. = vendorInvoiceNo`, `Document Date = documentDate` (o WorkDate),
   `Currency Code = currencyCode`. Serie de pedido normal (queda como el CP del ejemplo).
2. Crear **UNA** Purchase Line `Type = "Charge (Item)"`, `No. = chargeNo`,
   `Description = chargeDescription`, `Quantity = cantidad`, `Direct Unit Cost = precio`.
3. Por cada elemento de `receiptLinesJson`, crear un **Item Charge Assignment (Purch.)
   (5805)** que apunte a esa línea de recepción registrada
   (`Applies-to Doc. Type = Receipt`, `Applies-to Doc. No. = documentNo`,
   `Applies-to Doc. Line No. = lineNo`) — equivale a **"Traer líns. recep."**.
4. Ejecutar la **sugerencia de asignación** con el método `metodo` (equivale a
   **"Sugerir asignación cargo prod."** → Igualmente / Por importe / Por peso / Por
   volumen). Reusar el mismo mapeo de métodos que `AdelantePO_AssignItemCharges`.
5. Validar que lo asignado cuadre con el importe del cargo (`Qty. to Assign` completo).
6. **Registrar** el pedido (Receive+Invoice) → devolver el Nº de la factura registrada.
   Si algo falla, revertir/no dejar el pedido a medias (idealmente en una transacción).

**Response:** `value` = string con el Nº de factura registrada (o mensaje de estado).

---

## Cómo lo llama la app (ya implementado)

| App | Archivo |
|---|---|
| Lector | `lib/bc.ts` → `bcPostedReceiptLines()` |
| Writer | `lib/bc.ts` → `bcPostChargeOnReceipts()` |
| API GET | `app/api/bc/recepciones-registradas/route.ts` |
| API POST | `app/api/bc/cargo-recibido/route.ts` |
| Pantalla | `app/facturacion/cargo/page.tsx` (rol Bodega) |

Métodos de reparto usan los MISMOS literales que el cargo actual: `Amount` (default),
`Equally`, `Weight`, `Volume`. Peso/Volumen solo reparten si los ítems tienen
`Gross Weight` / `Unit Volume` en BC.
