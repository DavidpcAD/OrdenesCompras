"use client";

import { useMemo } from "react";
import { Sparkline, Donut, BarRanking, SerieMensual } from "@/components/charts";
import { money, num, todayISO, formatDate } from "@/lib/helpers";
import { variacion, diasDesde, MESES_CORTOS } from "@/lib/compras-kpis";
import type { KpisCompras } from "@/lib/compras-kpis";
import { usePanoramaBc } from "@/lib/use-sin-facturar";
import { loQueEstaEnTuCancha } from "@/lib/compras-cancha";
import { useStore } from "@/lib/store";
import { escribirFiltro } from "@/lib/memoria-tabla";
import type { FilaProv } from "@/lib/compras-proveedores";

// La pestaña "Resumen" de Órdenes de compra: el panorama en paneles, al estilo del
// tablero que pidió David. Cuatro tarjetas KPI arriba (rótulo, número grande, chip de
// variación y chispa), y debajo tres paneles: dónde está trabada la plata (anillo), a
// quién hay que corretearle el material (ranking) y cómo viene el año (serie mensual).
//
// Lo que NO hace, a propósito: no es un tablero ejecutivo. Esta pantalla es la
// herramienta con la que Angie trabaja todo el día, así que el Resumen es una pestaña
// más —no un techo que hay que pasar para llegar a la tabla— y cada panel lleva a algún
// lado en vez de quedarse en la contemplación.

const compacto = (v: number, moneda: string) => {
  // ₡186 471 165,81 no cabe en una tarjeta KPI y tampoco se lee de un vistazo; lo que
  // se lee es "186,5 M". El monto exacto queda en el title y en las tablas.
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${moneda === "CRC" ? "₡" : "$"}${num.format(Math.round(v / 1e5) / 10)} M`;
  if (abs >= 1e3) return `${moneda === "CRC" ? "₡" : "$"}${num.format(Math.round(v / 100) / 10)} K`;
  return money(v, moneda);
};

// `k` llega hecho desde la pantalla a propósito: la barra de plata del encabezado usa
// los MISMOS números, y dos cálculos separados para el mismo rótulo es como se empieza
// a desconfiar de un tablero.
export function ComprasResumen({ k, filas, onVerProveedores, onConciliacion, onIrA }: {
  k: KpisCompras; filas: FilaProv[]; onVerProveedores: () => void; onConciliacion: () => void;
  onIrA: (vista: "solicitudes" | "ordenes") => void;
}) {
  const { ordenes, pedidos } = useStore();
  const bc = usePanoramaBc();
  const hoy = todayISO();
  const cancha = useMemo(() => loQueEstaEnTuCancha(ordenes, pedidos, k.moneda), [ordenes, pedidos, k.moneda]);

  // Al tocar una fila, la lista de destino tiene que aterrizar YA filtrada. El chip se
  // deja escrito en la misma llave de sesión que usa `useFiltroPantalla`, que es el
  // mecanismo que esas pestañas ya tienen para recordar dónde estabas.
  const irFiltrado = (vista: "solicitudes" | "ordenes", filtro: string) => {
    try {
      const llave = vista === "ordenes" ? "adelante_oc_kpi_ordenes-prov" : "adelante_oc_kpi_solicitudes-prov";
      sessionStorage.setItem(llave, escribirFiltro(filtro, Date.now()));
    } catch { /* sin sessionStorage: cae en la pestaña sin filtrar, que no rompe nada */ }
    onIrA(vista);
  };
  const fmt = (v: number) => money(v, k.moneda);
  const corto = (v: number) => compacto(v, k.moneda);

  const topProveedores = useMemo(
    () => filas.filter((f) => f.pendiente > 0).slice(0, 8).map((f) => ({
      clave: f.proveedorId,
      nombre: f.nombre,
      valor: f.pendiente,
      texto: corto(f.pendiente),
      // "hace N días" y no "N días tarde": ver el comentario de `desdeISO`. Solo sale
      // si la orden más vieja ya pasó la semana — antes de eso no dice nada.
      nota: [
        `${f.nOrdenes} ${f.nOrdenes === 1 ? "orden" : "órdenes"}`,
        `${f.pct}% entregado`,
        ...(() => { const d = diasDesde(f.desdeISO, hoy); return d && d > 7 ? [`hace ${num.format(d)} días`] : []; })(),
      ].join(" · "),
    })),
    [filas, hoy], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="resumen">
      {/* Los montos van TODOS en colones. Lo que venía en otra moneda se pasó con el
          tipo de cambio de BC —el mismo con el que se registran las facturas allá— y
          acá se dice a cómo y de qué día, porque un total convertido en silencio es
          un total que nadie puede cuadrar. Lo que no se pudo convertir se declara
          aparte: sumarlo 1 a 1 sería peor que dejarlo afuera. */}
      {(k.convertido.length > 0 || k.otrasMonedas.length > 0) && (
        <p className="ds-body-sm ds-muted resumen__aviso">
          Los montos están en colones.
          {k.convertido.length > 0 && (
            <>
              {" "}{k.convertido.map((c) => `${c.ordenes} ${c.ordenes === 1 ? "orden" : "órdenes"} en ${c.moneda}`).join(" y ")}
              {" "}{k.convertido.length === 1 && k.convertido[0].ordenes === 1 ? "se pasó" : "se pasaron"} al tipo de cambio de Business Central
              {" "}({k.convertido.map((c) => `${fmt(c.factor)} por ${c.moneda}${c.fecha ? `, del ${formatDate(c.fecha)}` : ""}`).join(" · ")}).
            </>
          )}
          {k.otrasMonedas.length > 0 && (
            <>
              {" "}Quedan fuera {k.otrasMonedas.map((m) => `${m.ordenes} ${m.ordenes === 1 ? "orden" : "órdenes"} en ${m.moneda}`).join(" y ")}:
              {" "}Business Central no tiene tipo de cambio para {k.otrasMonedas.length === 1 ? "esa moneda" : "esas monedas"}.
            </>
          )}
        </p>
      )}

      <div className="kpis">
        <TarjetaKpi
          rotulo={`Pedido ${k.anio}`} nota="sin IVA"
          valor={corto(k.total.pedido)} exacto={fmt(k.total.pedido)}
          delta={variacion(k.total.pedido, k.totalPrevio.pedido)} anioPrevio={k.anioPrevio}
          serie={k.meses.map((m) => m.pedido)} color="var(--ds-color-green-100)"
        />
        <TarjetaKpi
          rotulo={`Entregado ${k.anio}`} nota="de lo pedido este año"
          valor={corto(k.total.recibido)} exacto={fmt(k.total.recibido)}
          delta={variacion(k.total.recibido, k.totalPrevio.recibido)} anioPrevio={k.anioPrevio}
          serie={k.meses.map((m) => m.recibido)} color="var(--ds-color-green-200)"
        />
        <TarjetaKpi
          rotulo={`Órdenes ${k.anio}`} nota="emitidas"
          valor={num.format(k.total.ordenes)} exacto={`${num.format(k.total.ordenes)} órdenes`}
          delta={variacion(k.total.ordenes, k.totalPrevio.ordenes)} anioPrevio={k.anioPrevio}
          serie={k.meses.map((m) => m.ordenes)} color="var(--ds-color-yellow)"
        />
        {/* La cuarta no es del año: es el SALDO VIVO de toda la historia, y por eso no
            lleva chip de variación —no hay foto de ayer con qué compararlo— sino la
            barra de la parte entregada, que es lo que dice si va bien o mal. */}
        <TarjetaKpi
          rotulo="Pendiente por entregar" nota="de todas las órdenes abiertas"
          valor={corto(k.vivo.pendiente)} exacto={fmt(k.vivo.pendiente)}
          delta={null} anioPrevio={k.anioPrevio}
          barra={{ pct: k.vivo.pct, texto: `${k.vivo.pct}% ya entregado` }}
          acento="var(--ds-color-red-200)"
          // NO dice "vencido". En BC ninguna de las 644 líneas con pendiente tiene una
          // fecha de entrega puesta por una persona (576 la tienen igual a la fecha de
          // la orden, 68 vacía), así que no hay contra qué medir un atraso. Lo que sí
          // existe, y es lo que hay que ir a preguntar, es cuánto de eso NADIE sabe
          // cuándo llega. Mientras BC no contesta se muestra la antigüedad, que sale de
          // la base de la app y está disponible de una.
          alerta={bc.datos
            ? (bc.datos.sinFecha.total > 0
              ? `${corto(bc.datos.sinFecha.total)} sin fecha de entrega · ${bc.datos.sinFecha.proveedores} proveedores a los que preguntarle`
              : null)
            : (() => { const d = diasDesde(k.vivo.masViejoISO, hoy); return d && d > 30 ? `lo más viejo lleva ${num.format(d)} días esperando` : null; })()}
          alertaTitulo={bc.datos && bc.datos.sinFecha.total > 0
            ? `${bc.datos.sinFecha.lineas} líneas en ${bc.datos.sinFecha.ordenes} órdenes con la fecha de entrega en blanco en Business Central. `
              + `Las demás traen la fecha de la orden, que BC rellena solo: tampoco es una fecha que alguien haya prometido.`
            : undefined}
        />
        <TarjetaSinFacturar datos={bc.datos?.sinFacturar ?? null} error={bc.error} cargando={bc.cargando}
          onClick={onConciliacion} corto={corto} fmt={fmt} />
      </div>

      <div className="resumen__grid">
        <section className="ds-card panel">
          <header className="panel__head">
            <div>
              <h2 className="ds-subtitle">Lo que está en tu cancha</h2>
              <p className="ds-body-sm ds-muted">Dónde se quedó quieto el trabajo. Tocá una fila para ir a la lista.</p>
            </div>
          </header>
          {cancha.length > 0 ? (
            <ul className="cancha">
              {cancha.map((i) => (
                <li key={i.clave}>
                  <button type="button" className="cancha__fila" onClick={() => irFiltrado(i.vista, i.filtro)}
                    title={i.monto !== null ? fmt(i.monto) : undefined}>
                    <i className="cancha__marca" style={{ background: i.color }} aria-hidden />
                    <span className="cancha__texto">
                      <span className="cancha__etiqueta">{i.etiqueta}</span>
                      <span className="ds-body-sm ds-muted">{i.detalle}</span>
                    </span>
                    <span className="cancha__cifras">
                      <span className="cancha__cuenta">{i.cuenta}</span>
                      {i.monto !== null && <span className="ds-body-sm ds-muted">{corto(i.monto)}</span>}
                    </span>
                    {/* La única que NO depende de Angie va marcada: sin esto se lee como
                        una tarea suya y se queda mirándola. */}
                    {i.deQuien === "ingeniero" && <span className="cancha__ajeno ds-body-sm">no es tuya</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ds-muted panel__vacio">Nada detenido: todo lo que llegó de Ingeniería ya está comprado y enviado.</p>
          )}
        </section>

        <section className="ds-card panel">
          <header className="panel__head">
            <div>
              <h2 className="ds-subtitle">Dónde está trabada la plata</h2>
              <p className="ds-body-sm ds-muted">Órdenes que todavía no se completan, por estado.</p>
            </div>
          </header>
          {k.enCurso > 0 ? (
            <div className="panel__anillo">
              <Donut
                segmentos={k.porEstado}
                etiqueta={`${fmt(k.enCurso)} en órdenes sin completar, repartido por estado`}
                centro={
                  <>
                    <span className="donut__monto" title={fmt(k.enCurso)}>{corto(k.enCurso)}</span>
                    <span className="donut__pie ds-body-sm ds-muted">en curso</span>
                  </>
                }
              />
              <ul className="leyenda">
                {k.porEstado.map((s) => (
                  <li key={s.clave} className="leyenda__fila">
                    <i className="leyenda__marca" style={{ background: s.color }} aria-hidden />
                    <span className="leyenda__texto">
                      <span className="ds-body-sm ds-muted">{s.etiqueta}</span>
                      <span className="leyenda__monto" title={fmt(s.monto)}>{corto(s.monto)}</span>
                    </span>
                    <span className="leyenda__pct ds-body-sm ds-muted">{Math.round((s.monto / k.enCurso) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="ds-muted panel__vacio">No hay órdenes en curso: todo lo pedido ya se completó.</p>
          )}
        </section>

        <section className="ds-card panel">
          <header className="panel__head">
            <div>
              <h2 className="ds-subtitle">A quién hay que corretearle</h2>
              <p className="ds-body-sm ds-muted">Proveedores con material pendiente, de mayor a menor.</p>
            </div>
            {topProveedores.length > 0 && (
              <button type="button" className="link-btn" onClick={onVerProveedores}>Ver todos</button>
            )}
          </header>
          {topProveedores.length > 0
            ? <BarRanking filas={topProveedores} color="var(--ds-color-red-100)" onFila={onVerProveedores} />
            : <p className="ds-muted panel__vacio">Ningún proveedor debe material.</p>}
        </section>

        <section className="ds-card panel panel--ancho">
          <header className="panel__head">
            <div>
              <h2 className="ds-subtitle">Cómo viene el año</h2>
              {/* El subtítulo dice qué se está viendo Y qué le falta. Con uno o dos
                  meses de movimiento son barras, y decirlo evita que alguien lea una
                  tendencia donde todavía no hay con qué trazarla. */}
              <p className="ds-body-sm ds-muted">
                {(() => {
                  const conDato = k.meses.filter((m) => m.pedido > 0).length;
                  if (conDato < 3) return `Pedido por mes. Con ${conDato === 0 ? "ningún mes" : conDato === 1 ? "un solo mes" : "dos meses"} de movimiento todavía no hay tendencia que trazar.`;
                  return `Pedido por mes${k.hayAnioPrevio ? `, ${k.anio} contra ${k.anioPrevio}.` : `. Todavía no hay ${k.anioPrevio} con qué comparar.`}`;
                })()}
              </p>
            </div>
            {k.hayAnioPrevio && (
              <div className="serie__leyenda ds-body-sm">
                <span className="serie__leg"><i className="serie__marca serie__marca--cy" aria-hidden />{k.anio}</span>
                <span className="serie__leg"><i className="serie__marca serie__marca--py" aria-hidden />{k.anioPrevio}</span>
              </div>
            )}
          </header>
          <SerieMensual
            actual={k.meses.map((m) => m.pedido)}
            previo={k.hayAnioPrevio ? k.mesesPrevio.map((m) => m.pedido) : null}
            etiquetasX={MESES_CORTOS}
            formato={fmt}
            etiqueta={`Pedido por mes en ${k.anio}${k.hayAnioPrevio ? `, comparado con ${k.anioPrevio}` : ""}`}
          />
        </section>
      </div>
    </div>
  );
}

// Una tarjeta KPI: rótulo, número grande, chip de variación y chispa al pie.
function TarjetaKpi({
  rotulo, nota, valor, exacto, delta, anioPrevio, serie, color, barra, acento, alerta, alertaTitulo,
}: {
  rotulo: string;
  nota: string;
  valor: string;
  exacto: string;
  delta: number | null;
  anioPrevio: number;
  serie?: number[];
  color?: string;
  barra?: { pct: number; texto: string };
  acento?: string;
  alerta?: string | null;
  alertaTitulo?: string;
}) {
  return (
    <article className="kpi" style={acento ? ({ "--kpi-acento": acento } as React.CSSProperties) : undefined}>
      <div className="kpi__rotulo">{rotulo}</div>
      <div className="kpi__fila">
        <div className="kpi__valor" title={exacto}>{valor}</div>
        {/* Sin año anterior no va chip: un "+100 %" porque el año pasado estaba en cero
            es una mentira con flecha verde, y acá se lee y se cree. */}
        {delta !== null && (
          <span className={`kpi__delta ${delta >= 0 ? "is-sube" : "is-baja"}`}
            title={`Contra el mismo período de ${anioPrevio}`}>
            <span aria-hidden>{delta >= 0 ? "▲" : "▼"}</span>
            {Math.abs(delta) >= 1000 ? ">999" : num.format(Math.abs(Math.round(delta * 10) / 10))}%
          </span>
        )}
      </div>
      <div className="kpi__nota ds-body-sm">{delta !== null ? `${nota} · vs ${anioPrevio}` : nota}</div>
      {serie && <Sparkline valores={serie} color={color} etiqueta={`${rotulo} mes a mes`} />}
      {barra && (
        <div className="kpi__barra" title={barra.texto}>
          <span className="kpi__barra-pista"><span className="kpi__barra-fill" style={{ width: `${barra.pct}%` }} /></span>
          <span className="ds-body-sm ds-muted">{barra.texto}</span>
        </div>
      )}
      {alerta && <div className="kpi__alerta ds-body-sm" title={alertaTitulo}>{alerta}</div>}
    </article>
  );
}

// "Llegó pero nadie lo facturó": material que Bodega ya recibió y que sigue sin factura
// registrada en BC. Es la única tarjeta que NO sale de la base de la app —viene de BC en
// vivo—, así que llega después y tiene sus tres estados: cargando, error y dato.
//
// El error se DICE. Un ₡0 en rojo porque BC no contestó manda a alguien a celebrar algo
// que no pasó, o peor, a dejar de revisarlo.
function TarjetaSinFacturar({ datos, error, cargando, onClick, corto, fmt }: {
  datos: import("@/lib/bc").BcSinFacturar | null;
  error: string | null;
  cargando: boolean;
  onClick: () => void;
  corto: (v: number) => string;
  fmt: (v: number) => string;
}) {
  const cuerpo = (
    <>
      <div className="kpi__rotulo">Llegó pero nadie lo facturó</div>
      {cargando && <div className="kpi__valor kpi__valor--esperando" aria-busy>…</div>}
      {error && <div className="kpi__valor kpi__valor--error">—</div>}
      {datos && <div className="kpi__valor" title={fmt(datos.total)}>{corto(datos.total)}</div>}
      <div className="kpi__nota ds-body-sm">
        {error ? "No se pudo consultar Business Central." : "Material recibido en bodega sin factura registrada en BC"}
      </div>
      {datos && datos.total > 0 && (
        <ul className="kpi__tramos">
          {/* Solo las franjas CON algo. Hoy todo cae en "más de 30 días" (lo más nuevo
              tiene 407), y dos franjas en cero permanente hacen que la tarjeta se lea
              como rota. Cuando limpien el atraso, las otras aparecen solas. */}
          {datos.tramos.map((t) => (
            <li key={t.etiqueta} className="kpi__tramo">
              <span className="ds-muted">{t.etiqueta}</span>
              <span className="kpi__tramo-monto" title={fmt(t.monto)}>{corto(t.monto)}</span>
            </li>
          ))}
          {datos.masViejoDias !== null && (
            <li className="kpi__tramo kpi__tramo--viejo">
              <span>lo más viejo</span>
              <span className="kpi__tramo-monto">{num.format(datos.masViejoDias)} días</span>
            </li>
          )}
        </ul>
      )}
      {datos && datos.total > 0 && (
        <div className="kpi__pie ds-body-sm ds-muted">
          {datos.lineas} {datos.lineas === 1 ? "línea" : "líneas"} en {datos.ordenes} {datos.ordenes === 1 ? "orden" : "órdenes"} · {datos.proveedores} {datos.proveedores === 1 ? "proveedor" : "proveedores"}
        </div>
      )}
      {datos && datos.total === 0 && <div className="kpi__pie ds-body-sm ds-muted">Todo lo recibido está facturado.</div>}
    </>
  );

  if (error) return <article className="kpi kpi--sinfac kpi--error">{cuerpo}</article>;
  return (
    <button type="button" className="kpi kpi--sinfac kpi--click" onClick={onClick}
      title="Abrir Conciliación BC">
      {cuerpo}
    </button>
  );
}
