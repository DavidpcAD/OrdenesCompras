# Compras Adelante — Solicitud de material a proveedores

App web (Next.js) para solicitar material a proveedores, pensada para conectarse con
**Microsoft Dynamics 365 Business Central** y mantener un espejo de los datos en **SQL**.

> Estado actual: **prototipo de frontend / UX-UI** con datos de ejemplo en memoria
> (se guardan en `localStorage` del navegador). Las integraciones con Business Central
> y SQL están encapsuladas para conectarse después sin reescribir las pantallas.

## El flujo en 3 módulos

La app reproduce el proceso real de Adelante con un login que permite elegir el módulo:

1. **Ingeniería** — el ingeniero crea un **pedido de compra** (solicitud de material por
   proyecto). Se guarda y se aprueba para pasar a proveeduría.
2. **Proveeduría** — toma los pedidos aprobados y genera la **orden de compra** que se
   envía al proveedor: asigna proveedor, precios y flete. La orden pasa por los estados
   *abierto → pendiente de aprobación → lanzado*.
3. **Facturación** — cuando el material llega a bodega se registra la **factura/recepción**.
   Soporta **entregas parciales**: se indica la *cantidad a recibir* por línea; las líneas
   faltantes quedan **pendientes (en rojo)** y la orden permanece **abierta** hasta recibir
   el 100%. Al completarse, la orden pasa a *completado* y se archiva.

### Reglas de negocio incluidas (de la reunión con proveeduría)

- **Entregas parciales**: `cantidad a recibir` editable; `cantidad a facturar` se calcula
  en automático; el saldo pendiente se conserva.
- **Flete / cargo de producto**: corresponde a toda la orden. En una entrega parcial el
  flete **no** se factura todavía; se distribuye proporcionalmente solo cuando se recibe la
  orden completa (se muestra una advertencia, igual que en Business Central).
- **Fechas**: `fecha de factura` y `fecha de registro` deben coincidir (la fecha de
  registro es la que "vale" al buscar y cuadrar contra el estado de cuenta del proveedor).
  La UI las sincroniza y avisa si no coinciden.
- **Vista previa** del asiento antes de registrar, para verificar el total físico.

## Correr en local

```bash
npm install
npm run dev
```

Abrí <http://localhost:3000>. Para una build de producción: `npm run build && npm start`.

Requisitos: Node.js 18.18+ (probado con Node 22).

## Estructura

```
app/
  page.tsx                      Login + selección de rol
  ingenieria/                   Módulo Ingeniería (pedidos)
  proveeduria/                  Módulo Proveeduría (órdenes)
  facturacion/                  Módulo Facturación (recepciones)
components/                     UI del design system (Button, Field, Card, Badge…)
lib/
  types.ts                      Modelo de datos (mapea a SQL / Purchase Header & Line de BC)
  store.tsx                     Estado en memoria + acciones (capa a reemplazar por API)
  seed.ts                       Datos de ejemplo
  helpers.ts                    Cálculos: saldos, % recibido, distribución de flete…
```

## Design system

La interfaz replica el **Adelante Design System**
(<https://davidpcad.github.io/adelante-design-system>): tipografía Roboto, color primario
verde `#add010`, rojo `#c96c6c`, inputs tipo píldora (radio 32px), botones redondeados y
sombras suaves. Los tokens viven como variables CSS en `app/globals.css`.

## Próximos pasos (integración real)

- **SQL**: el modelo en `lib/types.ts` se traslada 1:1 a tablas
  (`pedidos`, `pedido_lineas`, `ordenes`, `orden_lineas`, `recepciones`). Recomendado
  **SQL Server** por afinidad con el ecosistema Microsoft/Business Central.
- **Business Central**: exponer las APIs de `Purchase Header` / `Purchase Line` y mapear
  `Orden ↔ Pedido (BC)` y `Recepción ↔ Purch. Rcpt.`. Reemplazar las acciones de
  `lib/store.tsx` por llamadas a una API route de Next.js que sincronice BC + SQL.
```
