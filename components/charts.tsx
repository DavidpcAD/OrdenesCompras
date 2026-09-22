"use client";

// GRÁFICOS DEL DS — SVG a mano, sin librerías (CLAUDE.md: cero Tailwind, cero librerías
// de UI, de íconos o de gráficos). Son cuatro formas y nada más: chispa, anillo, barras
// de ranking y serie mensual. Todo el color entra por prop desde un token `--ds-*`, y
// las rejillas/ejes usan la capa semántica, que es la que remapea el tema oscuro.
//
// Regla común: ningún gráfico dibuja texto adentro del SVG salvo los ejes. Los números
// van en HTML al lado, porque el texto en SVG no hereda la tipografía del DS ni se deja
// seleccionar, y porque un lector de pantalla no debería tener que leer una gráfica: a
// cada uno se le pone `role="img"` con su `aria-label`, y el detalle vive en la leyenda.

// ---------------------------------------------------------------- Sparkline
// La chispa del pie de una tarjeta KPI: la forma de los últimos 12 meses, sin ejes ni
// números. No se lee, se ojea — dice "viene subiendo" o "se cayó en agosto".
export function Sparkline({
  valores,
  color = "var(--ds-color-green-100)",
  alto = 40,
  etiqueta,
}: {
  valores: number[];
  color?: string;
  alto?: number;
  etiqueta: string;
}) {
  const W = 200;
  const H = alto;
  const n = valores.length;
  if (n < 2) return <div className="spark spark--vacio" aria-hidden />;

  const max = Math.max(...valores, 0);
  const min = Math.min(...valores, 0);
  // Rango cero (todos los meses iguales, o todos en 0): sin esto la división deja NaN
  // y el path sale vacío. Con rango 1 la línea queda plana en el medio, que es la
  // verdad: no hubo variación.
  const rango = max - min || 1;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - 3 - ((v - min) / rango) * (H - 6);

  const linea = valores.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${linea} L${W},${H} L0,${H} Z`;
  const ultimo = { cx: x(n - 1), cy: y(valores[n - 1]) };

  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={etiqueta}>
      <path d={area} fill={color} opacity="0.16" />
      {/* vector-effect: el viewBox se estira en horizontal (preserveAspectRatio="none")
          y sin esto el trazo se deformaría con él. */}
      <path d={linea} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={ultimo.cx} cy={ultimo.cy} r="2.5" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------------------------------------------------------------- Donut
// Anillo de composición con el total al centro. El centro es HTML (no SVG) para que el
// monto salga con la tipografía y los números tabulares del DS.
export function Donut({
  segmentos,
  centro,
  etiqueta,
  activo,
  onSegmento,
}: {
  segmentos: { clave: string; etiqueta: string; monto: number; color: string }[];
  centro: React.ReactNode;
  etiqueta: string;
  activo?: string | null;
  onSegmento?: (clave: string) => void;
}) {
  const total = segmentos.reduce((s, x) => s + x.monto, 0);
  const R = 54;          // radio de la circunferencia sobre la que se dibuja
  const GROSOR = 22;
  const C = 2 * Math.PI * R;
  let acumulado = 0;

  return (
    <div className="donut">
      <svg className="donut__svg" viewBox="0 0 140 140" role="img" aria-label={etiqueta}>
        <g transform="rotate(-90 70 70)">
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--ds-color-gray-100)" strokeWidth={GROSOR} />
          {total > 0 && segmentos.map((s) => {
            const frac = s.monto / total;
            // 1,5 px de respiro entre tajadas. Sin esto, dos colores contiguos de la
            // misma familia (el verde lima y el verde oscuro) se leen como uno solo.
            const largo = Math.max(0, frac * C - 1.5);
            const desfase = -acumulado * C;
            acumulado += frac;
            const atenuado = activo && activo !== s.clave;
            return (
              <circle
                key={s.clave}
                cx="70" cy="70" r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={activo === s.clave ? GROSOR + 4 : GROSOR}
                strokeDasharray={`${largo} ${C}`}
                strokeDashoffset={desfase}
                opacity={atenuado ? 0.3 : 1}
                className={onSegmento ? "donut__tajada donut__tajada--click" : "donut__tajada"}
                onClick={onSegmento ? () => onSegmento(s.clave) : undefined}
              />
            );
          })}
        </g>
      </svg>
      <div className="donut__centro">{centro}</div>
    </div>
  );
}

// ---------------------------------------------------------------- BarRanking
// El ranking del tablero de referencia: nombre, barra proporcional al mayor y monto.
// La barra se mide contra el PRIMERO, no contra el total: contra el total, con 40
// proveedores, todas las barras quedan en un hilo y el ranking deja de leerse.
export function BarRanking({
  filas,
  color = "var(--ds-color-green-100)",
  onFila,
}: {
  filas: { clave: string; nombre: string; valor: number; texto: string; nota?: string }[];
  color?: string;
  onFila?: (clave: string) => void;
}) {
  const tope = Math.max(...filas.map((f) => f.valor), 0) || 1;
  return (
    <ol className="rank">
      {filas.map((f, i) => {
        const Cont = onFila ? "button" : "div";
        return (
          <li key={f.clave} className="rank__fila">
            <span className="rank__pos" aria-hidden>{i + 1}</span>
            <Cont
              className="rank__cuerpo"
              {...(onFila ? { type: "button" as const, onClick: () => onFila(f.clave) } : {})}
            >
              <span className="rank__nombre ds-truncate" title={f.nombre}>{f.nombre}</span>
              <span className="rank__pista" aria-hidden>
                <span className="rank__barra" style={{ width: `${(f.valor / tope) * 100}%`, background: color }} />
              </span>
              <span className="rank__valor">{f.texto}</span>
            </Cont>
            {f.nota && <span className="rank__nota ds-body-sm ds-muted">{f.nota}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- SerieMensual
// Este año contra el anterior: el año pasado como área gris de fondo (referencia) y el
// año en curso como línea con puntos (lo que se mira). Si no hay año anterior se dibuja
// solo la línea — no una banda en cero, que se leería como "el año pasado no compramos".
//
// Con MENOS DE TRES MESES con movimiento se cambia a barras. Una línea necesita al
// menos dos puntos para decir algo, y con uno solo dibuja un pico que sale de cero y
// vuelve a cero: parece una caída brutal cuando lo único que pasa es que el año recién
// empezó. Una barra en enero no finge una tendencia que nadie midió.
const MESES_MINIMOS_PARA_LINEA = 3;
export function SerieMensual({
  actual,
  previo,
  etiquetasX,
  formato,
  color = "var(--ds-color-green-200)",
  etiqueta,
}: {
  actual: number[];
  previo?: number[] | null;
  etiquetasX: string[];
  formato: (v: number) => string;
  color?: string;
  etiqueta: string;
}) {
  const W = 620;
  const H = 180;
  const PAD_I = 8;      // izquierda: la escala va arriba, no en un eje vertical
  const PAD_D = 8;
  const PAD_S = 16;
  const PAD_B = 22;     // abajo: los meses

  const todos = [...actual, ...(previo ?? [])];
  const max = Math.max(...todos, 0) || 1;
  const n = actual.length;
  const x = (i: number) => PAD_I + (i / Math.max(1, n - 1)) * (W - PAD_I - PAD_D);
  const y = (v: number) => PAD_S + (1 - v / max) * (H - PAD_S - PAD_B);

  const camino = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const hayPrevio = !!previo && previo.some((v) => v > 0);
  const conDato = actual.filter((v) => v > 0).length;
  const barras = conDato < MESES_MINIMOS_PARA_LINEA;
  const anchoBarra = Math.min(28, ((W - PAD_I - PAD_D) / n) * 0.55);

  return (
    <div className="serie">
      <svg className="serie__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={etiqueta}>
        {/* Cuatro líneas de rejilla. Más que eso y la rejilla compite con el dato. */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD_I} x2={W - PAD_D} y1={y(max * f)} y2={y(max * f)}
            stroke="var(--ds-color-gray-100)" strokeWidth="1" />
        ))}

        {hayPrevio && (
          <>
            <path d={`${camino(previo!)} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="var(--ds-color-gray-200)" opacity="0.5" />
            <path d={camino(previo!)} fill="none" stroke="var(--ds-color-gray-300)" strokeWidth="1.5" />
          </>
        )}

        {barras
          ? actual.map((v, i) => (
            // Los meses en cero no dibujan barra: una barra de alto 0 es una rayita
            // pegada al eje que se lee como un dato diminuto y no como "no hubo nada".
            v > 0 ? (
              <rect key={i} x={x(i) - anchoBarra / 2} y={y(v)} width={anchoBarra} height={Math.max(2, y(0) - y(v))}
                rx="3" fill={color}>
                <title>{`${etiquetasX[i]}: ${formato(v)}`}</title>
              </rect>
            ) : null
          ))
          : (
            <>
              <path d={camino(actual)} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {actual.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="var(--ds-surface)" stroke={color} strokeWidth="2">
                  <title>{`${etiquetasX[i]}: ${formato(v)}`}</title>
                </circle>
              ))}
            </>
          )}

        {etiquetasX.map((m, i) => (
          <text key={m} x={x(i)} y={H - 6} textAnchor="middle" className="serie__mes">{m}</text>
        ))}
      </svg>
    </div>
  );
}
