/**
 * Haptic vocabulary — semántico, no decorativo.
 * Copiado del Adelante Design System (react/haptic.ts).
 * Elegí por significado (.complete, .delete, .select, .drag), nunca por "feel".
 *
 * Nota: solo dispara en Android Chrome. iOS Safari no expone la Vibration API.
 * No-op silencioso cuando no está disponible, así los llamadores no necesitan guardas.
 */
const vibrate = (pattern: number | number[]) => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
};

export const haptic = {
  /** Acción exitosa — confirmar, check, terminado */
  complete: () => vibrate([10, 30, 10]),
  /** Tap, selección, feedback ligero */
  select: () => vibrate(5),
  /** Hito de arrastre — umbral alcanzado, snap */
  drag: () => vibrate(8),
  /** Remoción, acción destructiva */
  delete: () => vibrate([15, 10, 15]),
};
