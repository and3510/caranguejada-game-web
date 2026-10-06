/**
 * A água só sobe, e cada vez mais rápido: começa lambendo as bordas da ilha e termina
 * cobrindo o topo. É uma função pura do tempo da rodada, então o cliente desenha o
 * nível exato sem esperar o servidor.
 */
import { MAX_TILE_HEIGHT } from './constants';

export const TIDE = {
  base: 0.6,
  /** Subida inicial (por segundo). */
  risePerSecond: 0.1,
  /** Aceleração: quanto mais tempo passa, mais rápido inunda. */
  acceleration: 0.0035,
  /** A partir daqui o HUD avisa que a enchente disparou. */
  floodAt: 20,
  /**
   * A água para aqui, logo abaixo da altura máxima: os tiles de altura máxima (o refúgio
   * final, FINAL_REFUGE_TILES deles) nunca alagam. O resto da ilha some no ritmo de sempre.
   */
  maxLevel: MAX_TILE_HEIGHT - 0.5,
} as const;

/** O nível "cru": a parábola de sempre, sem o teto. */
function rawLevel(time: number): number {
  return TIDE.base + TIDE.risePerSecond * time + TIDE.acceleration * time * time;
}

export function tideLevel(t: number): number {
  return Math.min(TIDE.maxLevel, rawLevel(Math.max(0, t)));
}

/** Velocidade de subida da água (nível por segundo) no instante t; 0 depois do teto. */
export function tideSpeed(t: number): number {
  const time = Math.max(0, t);
  if (rawLevel(time) >= TIDE.maxLevel) return 0;
  return TIDE.risePerSecond + 2 * TIDE.acceleration * time;
}

export function isFlooding(t: number): boolean {
  return t >= TIDE.floodAt;
}
