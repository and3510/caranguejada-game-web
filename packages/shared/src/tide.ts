/**
 * A água só sobe, e cada vez mais rápido: começa lambendo as bordas da ilha e termina
 * cobrindo o topo. É uma função pura do tempo da rodada, então o cliente desenha o
 * nível exato sem esperar o servidor.
 */
export const TIDE = {
  base: 0.6,
  /** Subida inicial (por segundo). */
  risePerSecond: 0.1,
  /** Aceleração: quanto mais tempo passa, mais rápido inunda. */
  acceleration: 0.0035,
  /** A partir daqui o HUD avisa que a enchente disparou. */
  floodAt: 20,
} as const;

export function tideLevel(t: number): number {
  const time = Math.max(0, t);
  return TIDE.base + TIDE.risePerSecond * time + TIDE.acceleration * time * time;
}

/** Velocidade de subida da água (nível por segundo) no instante t. */
export function tideSpeed(t: number): number {
  return TIDE.risePerSecond + 2 * TIDE.acceleration * Math.max(0, t);
}

export function isFlooding(t: number): boolean {
  return t >= TIDE.floodAt;
}
