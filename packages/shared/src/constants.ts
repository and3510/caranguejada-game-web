/**
 * Regras de jogo compartilhadas entre servidor (autoritativo) e cliente (predição).
 * Unidades de distância são "tiles"; tempo em segundos.
 */

export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 15;
export const CLIENT_INPUT_RATE = 20;

export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 28;
export const MAX_TILE_HEIGHT = 9;
/** Diferença de altura que um caranguejo não consegue escalar a pé. */
export const CLIFF_HEIGHT = 3;

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS_TO_START = 2;
/** Quantidades de rodada que dá pra escolher (no menu, ao criar, ou no lobby). */
export const ROUND_OPTIONS = [1, 3, 5, 7] as const;
export const DEFAULT_ROUNDS = 3;

export function isValidRoundCount(value: unknown): value is number {
  return typeof value === 'number' && (ROUND_OPTIONS as readonly number[]).includes(value);
}
export const COUNTDOWN_SECONDS = 3;
/** Tempo do pop-up de fim de rodada (com as estrelas) antes da próxima. */
export const ROUND_END_SECONDS = 5;
export const ROUND_HARD_LIMIT_SECONDS = 120;

export const CRAB = {
  radius: 0.32,
  speed: 4.4,
  waterSpeedFactor: 0.5,
  dashSpeed: 15,
  dashSeconds: 0.2,
  dashCooldown: 0.9,
  /** Alcance do empurrão do dash: mais generoso que o corpo, para o acerto "pegar". */
  shoveReach: 0.95,
  shoveImpulse: 17,
  stunSeconds: 0.35,
  knockbackFriction: 6,
  /** Na água o empurrado desliza mais longe. */
  waterKnockbackFriction: 2.5,
  /** Fôlego perdido por segundo em água rasa / funda. */
  breathDrain: 0.32,
  deepBreathDrain: 0.6,
  deepWater: 1,
  breathRegen: 0.7,
} as const;

export const SHELLS = {
  max: 8,
  initial: 5,
  spawnPerSecond: 0.8,
  /** Conchas aparecem na faixa de praia logo acima da água. */
  beachBand: 1.5,
  pickupRadius: 0.6,
  goldChance: 0.12,
} as const;

/** As ondas comem a areia na linha d'água: a costa fica irregular e buracos viram poças. */
export const EROSION = {
  intervalSeconds: 1,
  /** Chance por segundo de um tile na beira perder 1 de altura. */
  chance: 0.05,
  /** Só erode o que está até esta altura acima da água. */
  band: 1,
} as const;

export const SCORE = {
  shell: 1,
  goldShell: 3,
  /** Quem empurrou alguém que se afogou logo em seguida. */
  fatalShove: 2,
  /** Janela, em segundos, para creditar o empurrão. */
  fatalShoveWindow: 4,
  lastStanding: 5,
} as const;

/** Cores dos caranguejos (casca), em ordem de entrada na sala. */
export const CRAB_COLORS = [
  0xd9573b, // vermelho-tijolo
  0x3fa7a0, // verde-mar
  0xe8b83a, // amarelo-gema
  0x8a5ab8, // roxo-açaí
  0xe07aa0, // rosa-goiaba
  0x7bb03c, // verde-limão
  0xeae0cc, // casca-de-ovo
  0x4f73c9, // azul-anil
] as const;

export const NAME_MAX_LENGTH = 14;
