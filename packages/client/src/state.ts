import {
  decodeHeights,
  generateTerrain,
  MAP_HEIGHT,
  MAP_KINDS,
  MAP_WIDTH,
  DEFAULT_ROUNDS,
  type CrabSnapshot,
  type FxEvent,
  type MapKind,
  type Phase,
  type PlayerInfo,
  type Terrain,
  type RocketSnapshot,
  type WeaponItemSnapshot,
} from '@caranguejada/shared';

export interface TimedSnapshot {
  /** performance.now() de quando chegou. */
  at: number;
  time: number;
  crabs: Map<string, CrabSnapshot>;
}

/**
 * Estado do cliente alimentado pela rede. A cena lê daqui a cada quadro;
 * a UI reage às mudanças via callbacks no main.
 */
export class Store {
  you = '';
  code = '';
  phase: Phase = 'lobby';
  players: PlayerInfo[] = [];
  round = 0;
  totalRounds = DEFAULT_ROUNDS;
  /** Mapas sorteáveis da sala. */
  maps: MapKind[] = [...MAP_KINDS];

  terrain: Terrain | null = null;
  /** Incrementa a cada alteração de tile, para o renderer saber quando redesenhar. */
  terrainVersion = 0;
  roundId = 0;
  mapKind: MapKind = 'morro';

  snapshots: TimedSnapshot[] = [];
  /** Armas caídas no chão. */
  weapons: WeaponItemSnapshot[] = [];
  /** Foguetes da bazuca em voo. */
  rockets: RocketSnapshot[] = [];
  fxQueue: FxEvent[] = [];
  countdownEndsAt = 0;

  player(id: string): PlayerInfo | undefined {
    return this.players.find((p) => p.id === id);
  }

  latest(): TimedSnapshot | undefined {
    return this.snapshots.at(-1);
  }

  /** Tempo da rodada estimado agora, extrapolando a partir do último snapshot. */
  roundTime(now = performance.now()): number {
    const last = this.latest();
    if (!last) return 0;
    if (this.phase !== 'playing') return last.time;
    return last.time + Math.min(0.5, (now - last.at) / 1000);
  }

  startRound(round: number, seed: number, map: MapKind, heights: string, countdown: number): void {
    this.round = round;
    this.mapKind = map;
    this.terrain = {
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      // Alturas vêm do servidor (fonte da verdade); os materiais são só visuais e
      // saem da mesma seed, sem custar banda.
      heights: decodeHeights(heights),
      materials: generateTerrain(seed, map).materials,
    };
    this.terrainVersion++;
    this.roundId++;
    this.snapshots = [];
    this.weapons = [];
    this.rockets = [];
    this.countdownEndsAt = performance.now() + countdown * 1000;
  }

  pushSnapshot(
    time: number,
    crabs: CrabSnapshot[],
    weapons: WeaponItemSnapshot[],
    rockets: RocketSnapshot[],
  ): void {
    this.snapshots.push({
      at: performance.now(),
      time,
      crabs: new Map(crabs.map((c) => [c.id, c])),
    });
    if (this.snapshots.length > 30) this.snapshots.shift();
    this.weapons = weapons;
    this.rockets = rockets;
  }

  applyTiles(tiles: [number, number][]): void {
    if (!this.terrain || tiles.length === 0) return;
    for (const [i, h] of tiles) this.terrain.heights[i] = h;
    this.terrainVersion++;
  }

  reset(): void {
    this.you = '';
    this.code = '';
    this.phase = 'lobby';
    this.players = [];
    this.terrain = null;
    this.snapshots = [];
    this.weapons = [];
    this.rockets = [];
    this.fxQueue = [];
  }
}

/** Ilha de fundo para o menu: o jogo já "vive" antes de você entrar. */
export function attractTerrain(): Terrain {
  return generateTerrain(20261003);
}
