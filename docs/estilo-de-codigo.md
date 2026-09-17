# Cómo se escribe código en este proyecto

Pegale esto a quien vaya a programar acá (persona o agente). Es el estilo, no la
arquitectura: lo que hay que hacer al escribir cada línea.

---

Escribí el código así:

**1. El tipo primero.** Antes de tocar nada, definí el tipo del dato en el archivo de
tipos. Interfaces para el dominio, uniones de literales para los estados
(`"abierto" | "lanzado" | …`). Cada campo opcional lleva un comentario que dice
**por qué puede faltar**, no qué es. En las firmas pedí lo mínimo (`Pick<Orden, "estado">`),
no el objeto entero.

**2. La regla de negocio va en una función pura, fuera del componente.** Corta, de una
línea si se puede, exportada, con nombre de frase en el idioma del negocio:
`esLineaCargo`, `puedeImprimir`, `vaAlProveedor`, `ordenEsperaCorreccion`. Nada de
`utils.ts` genérico: un archivo por tema.

**3. Guard clauses arriba, nada de `else`.** Los casos que no aplican se devuelven de
una; el cuerpo de la función es el caso normal.

**4. Lo que viene de afuera (SQL, API, otro sistema) se mapea a mano y con
desconfianza.** Nunca hagas spread de una fila ni de una respuesta: escribí el mapper
campo por campo, con `Number(x ?? 0)`, `String(x ?? "")` y `|| undefined` para que un
NULL no se vuelva `NaN` y un `""` no se vuelva un dato falso.

**5. SQL crudo y parametrizado.** Cero concatenación de valores: todo por parámetros.
El WHERE variable se arma por pedazos, nunca interpolando datos. Todo lo que escribe va
en transacción, con el registro en la bitácora **dentro** de la misma transacción:
o pasó y quedó anotado, o no pasó.

**6. Dos clases de error, y se distinguen.**
- El que se traga: `catch { /* razón concreta de por qué no importa */ }`. Nunca un
  `catch {}` pelado.
- El que sube: mensaje en el idioma del usuario, que diga **qué pasó y qué hacer**, con
  el dato concreto ("Business Central no tiene ningún pedido CP-005148. Confirmá el
  número con Proveeduría antes de apuntarle la orden.").

**7. Degradar, nunca mentir.** Si un servicio externo no contesta, la pantalla lo dice.
Una lista vacía por un error NO se muestra igual que una lista vacía de verdad.

**8. React sin ceremonia.** `useState` y ya: sin gestor de estado, sin `useReducer`, sin
`useCallback` salvo que se mida el problema. El estado vive en la pantalla que lo usa.
`useMemo` solo para listas o columnas que se recalculan. Lo que la persona eligió
(filtro, orden, página, panel) se guarda en `sessionStorage` para que volver de un
detalle no le borre el trabajo.

**9. JSX: `&&` antes que ternario.** Se muestra o no se muestra. Y cuando una celda o un
bloque crece, nace una función en el mismo archivo, **sin exportar**. Se exporta solo lo
que de verdad se reusa en otra pantalla.

**10. CSS plano con tokens.** Cero literales de color: todo sale de variables
(`--ds-*`). Una regla por línea. Nombres `.bloque__elemento`, modificadores
`--variante`, estados `.is-activo`. Verificá en claro y en oscuro antes de dar algo por
terminado. Sin Tailwind, sin librerías de UI ni de íconos: los primitivos se agregan al
archivo de componentes compartidos, no se copian.

**11. Las pruebas se leen como la regla del negocio.** El nombre del test ES la frase:
`test("marcar líneas para nota de crédito es de quien recibe, no de quien compra")`.
Probá funciones puras; si algo no se puede probar sin levantar media app, casi siempre
es señal de que esa lógica tiene que salir del componente.

**12. Los comentarios explican el PORQUÉ, con el caso real.** No describas lo que el
código ya dice. Dejá escrito qué se rompió, cuándo y con qué documento
("así fue como CP-005172 llegó hasta la factura con una línea de menos"). Un comentario
que envejece se borra; uno que explica una decisión cara se defiende.

**13. El commit cuenta el problema, no el diff.** Asunto corto en minúscula
(`fix(area): …`), y cuerpo en párrafos que empieza citando a la persona que lo pidió y
lo que dijo. Si hay varias cosas, van en bloques con un título en mayúsculas.

**14. Nombres:** el dominio en el idioma del negocio (`marcarEnvioProveedor`,
`ordenSubtotal`), lo técnico en inglés (`bcReplaceOrderLines`, `fetch`, `parse`).

**15. Nada de abstracción anticipada.** No hay clases, ni capa de servicios, ni
interfaces "por si acaso". Un archivo por frontera externa, y que crezca: cuando algo
se rompe hay que saber exactamente dónde mirar.

---

**Lo que NO se hace sin preguntar:** desplegar, correr migraciones, escribir en el
sistema externo desde una prueba, o sembrar datos de demo en el modo real.
