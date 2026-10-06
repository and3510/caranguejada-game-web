/**
 * Onde desenhar os outros jogadores entre dois snapshots.
 *
 * O normal é interpolar: desenhar o passado (entre dois snapshots que já chegaram) é
 * suave e nunca erra. Quando um snapshot atrasa, porém, o alvo a interpolar acaba e o
 * caranguejo congela — e depois pula quando a rede volta.
 *
 * Aí entra a extrapolação (dead reckoning): seguir o movimento que vinha acontecendo,
 * por pouco tempo. É um chute: se a pessoa mudou de direção no meio do engasgo, ela
 * "escorrega" de volta quando a verdade chega. Por isso o teto é curto, e quem está
 * sendo arremessado não entra nessa (muda de direção demais: congelar erra menos).
 */
export interface Blend {
  /** Interpolação normal, de 0 (no snapshot `a`) a 1 (no snapshot `b`). */
  k: number;
  /** Quanto passar de `b` quando o snapshot atrasou. 0 = sem chute. */
  extra: number;
}

export function blendBetween(
  aAt: number,
  bAt: number,
  renderAt: number,
  maxExtrapolateMs: number,
): Blend {
  const span = bAt - aAt;
  if (span <= 0) return { k: 1, extra: 0 };
  const raw = (renderAt - aAt) / span;
  const lateMs = Math.max(0, raw - 1) * span;
  return {
    k: Math.max(0, Math.min(1, raw)),
    extra: Math.min(maxExtrapolateMs, lateMs) / span,
  };
}
