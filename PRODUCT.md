# Compras Adelante — verdad de producto

## Qué es

Herramienta interna **en producción** de Adelante Desarrollos (constructora, Costa Rica) para
el ciclo de compra de material de obra: armar la orden a partir de las solicitudes que manda
Ingeniería, recibir el material en bodega, registrar la factura y manejar notas de crédito.
Integrada con **Microsoft Dynamics 365 Business Central** (el ERP donde vive la contabilidad
real) y con SQL Server (`AdelantePRO`) como base propia compartida con la app de Producción.

No es un producto que se venda ni que alguien elija usar. Es la vía por la que la empresa
compra: si la pantalla estorba, el material no llega a la obra.

## Para quién

Tres personas reales, un rol cada una, cada una en su módulo:

- **Angie — proveeduría.** Arma las órdenes de compra desde las solicitudes de Ingeniería, y
  las compras directas (material sin solicitud). Es quien más tiempo pasa en la app y la que
  maneja más volumen: trabaja de escritorio, con muchas líneas, comparando precios y proveedores.
- **Pedro — bodega.** Recibe el material y registra la factura. **Trabaja desde el celular, de
  pie, en la bodega o en obra**, con el camión esperando. Soporta entregas parciales y marca
  líneas para nota de crédito. Su pantalla es la que más castiga un diseño pensado en escritorio.
- **Kattya — contabilidad.** Emite las notas de crédito, registra facturas que quedaron en
  revisión y aplica cargos sobre factura (flete de un tercero). Volumen bajo, exactitud alta:
  cada acción suya tiene consecuencia fiscal.

Ingeniería y Aprobación **no viven acá** — están en la app de Producción, que escribe en la
misma base.

## Contexto de operación

- Español de Costa Rica. Vocabulario del oficio, no de software: solicitud, orden, pedido de BC,
  recepción, nota de crédito, obra, partida, insumo, estañón, variante.
- Colones y dólares conviven; todo precio viaja con su moneda **y con su unidad**. Un material
  se consume en gramos y se compra por estañón (1 EST = 255.000 GR): la unidad se corrige al leer.
- Conectividad de obra: intermitente. Hay borrador local (`localStorage`) que se rescata, y la
  sesión se renueva sola.
- Se usa en celular tanto como en escritorio. Bodega es mayoritariamente celular.
- Tema claro y oscuro, ambos reales y en uso.

## Restricciones duras

- **El sistema visual es el Adelante Design System** y no se rediseña desde esta app.
  Ver [DESIGN.md](DESIGN.md). Refinar sí; reemplazar el mundo visual, no.
- Stack fijo: Next.js 14 (App Router), React 18, TypeScript, **CSS plano con tokens `--ds-*`**.
  Sin Tailwind, sin shadcn/ui, sin CSS-in-JS, sin librerías de UI ni de íconos.
- Cada acción tiene consecuencia contable en BC. Un botón que dispara dos veces crea dos
  pedidos. Los guards de recepción/factura duplicada existen por incidentes reales, no por
  precaución teórica.
- Hay auditoría: la bitácora está atada a la cookie firmada de sesión y el nombre de quien
  registra viaja hasta el "Realizado por" del movimiento de proyecto en BC.
- **Prohibido sembrar datos de demo en modo API.** Lo que se ve es lo que hay en la base.

## Voz

Directa, en segunda persona, sin jerga técnica y sin entusiasmo de marketing. Los mensajes de
error dicen **qué pasó y qué hacer**, con el dato concreto (número de orden, proveedor, línea).
Nada de "¡Ups!" ni "Algo salió mal". Cuando BC rechaza algo, se dice por qué lo rechazó BC.

## Evidencia (por qué el diseño es como es)

Decisiones que salieron de incidentes reales y no se re-litigan:

- Órdenes que nacieron con el proveedor equivocado (CP-005183 / CP-005249 / CP-005289) →
  el proveedor y la moneda del encabezado se sincronizan a BC al editar, y hay freno al lanzar.
- Líneas perdidas entre SQL y BC (CP-005172 / CP-005157) → pared y detector.
- Un pedido borrado en BC dejaba la orden huérfana → "Corregir N.º de BC" + guard de almacén.
- El ⚠ de stock en el modal de factura era falso para consumo directo de obra (línea con
  Job No.) → ahora se muestra por obra.
- Se devuelven líneas sueltas, no el pedido entero.
- Hay ayuda contextual por pantalla (botón ⓘ en la topbar, texto en `lib/help.ts`) porque la
  app la usan tres personas con tres modelos mentales distintos.
