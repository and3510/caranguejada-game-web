import {
  CRAB,
  EROSION,
  ROUND_HARD_LIMIT_SECONDS,
  SCORE,
  SHELLS,
  createBody,
  createRng,
  depthAt,
  generateTerrain,
  heightAt,
  stepBody,
  tideLevel,
  type Body,
  type CrabSnapshot,
  type FxEvent,
  type Rng,
  type ShellSnapshot,
  type Terrain,
} from '@caranguejada/shared';

export interface CrabInput {
  dx: number;
  dy: number;
  /** Toque: fica pendente até o próximo tick consumir. */
  dash: boolean;
  seq: number;
}

export interface Crab extends Body {
  id: string;
  alive: boolean;
  breath: number;
  dashCooldown: number;
  lastShovedBy: string | null;
  lastShovedAt: number;
  diedAt: number;
  input: CrabInput;
  /** Tempo de simulação em que o input atual chegou. */
  inputAt: number;
}

export interface Shell {
  id: number;
  x: number;
  y: number;
  gold: boolean;
}

/** Eventos de pontuação que a sala aplica ao placar da partida. */
export type ScoreEvent = { playerId: string; points: number };

export interface StepResult {
  fx: FxEvent[];
  scores: ScoreEvent[];
}

export interface RoundResult {
  winner: string | null;
  /** Os últimos afundaram juntos e o vencedor saiu pelos pontos da rodada. */
  byPoints: boolean;
}

const emptyInput = (): CrabInput => ({ dx: 0, dy: 0, dash: false, seq: 0 });

/**
 * Uma rodada: terreno, enchente, caranguejos e conchas. Não sabe nada de rede,
 * o que permite testar todas as regras de forma determinística.
 */
export class Simulation {
  readonly terrain: Terrain;
  readonly crabs = new Map<string, Crab>();
  readonly shells: Shell[] = [];
  time = 0;

  private readonly rng: Rng;
  private readonly starters: number;
  private nextShellId = 1;
  /** Pontos feitos nesta rodada (critério de desempate). */
  readonly roundPoints = new Map<string, number>();
  private erosionTimer = 0;
  private readonly dirtyTiles = new Set<number>();

  constructor(
    readonly seed: number,
    playerIds: readonly string[],
    terrain?: Terrain,
  ) {
    this.rng = createRng(seed ^ 0x9e3779b9);
    this.terrain = terrain ?? generateTerrain(seed);
    this.starters = playerIds.length;
    const spawns = this.pickSpawns(playerIds.length);
    playerIds.forEach((id, i) => {
      const spawn = spawns[i] ?? { x: this.terrain.width / 2, y: this.terrain.height / 2 };
      this.crabs.set(id, {
        ...createBody(spawn.x, spawn.y),
        id,
        alive: true,
        breath: 1,
        dashCooldown: 0,
        lastShovedBy: null,
        lastShovedAt: -Infinity,
        diedAt: Infinity,
        input: emptyInput(),
        inputAt: 0,
      });
    });
    for (let i = 0; i < SHELLS.initial; i++) this.trySpawnShell(tideLevel(0), Infinity);
  }

  get level(): number {
    return tideLevel(this.time);
  }

  /**
   * Nasce todo mundo num anel na encosta, espalhado: a enchente empurra
   * todos para o mesmo topo e o encontro é inevitável.
   */
  private pickSpawns(count: number): { x: number; y: number }[] {
    const collect = (min: number, max: number) => {
      const out: { x: number; y: number }[] = [];
      for (let ty = 0; ty < this.terrain.height; ty++) {
        for (let tx = 0; tx < this.terrain.width; tx++) {
          const h = heightAt(this.terrain, tx, ty);
          if (h >= min && h <= max) out.push({ x: tx + 0.5, y: ty + 0.5 });
        }
      }
      return out;
    };
    let candidates = collect(3, 5);
    if (candidates.length < count) candidates = collect(2, 9);

    const chosen: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      let best: { x: number; y: number } | undefined;
      let bestScore = -Infinity;
      for (let attempt = 0; attempt < 60 && candidates.length > 0; attempt++) {
        const c = candidates[Math.floor(this.rng() * candidates.length)]!;
        const nearest = chosen.reduce(
          (min, o) => Math.min(min, Math.hypot(o.x - c.x, o.y - c.y)),
          Infinity,
        );
        const score = Math.min(nearest, 14) + this.rng() * 2;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      chosen.push(best ?? { x: this.terrain.width / 2, y: this.terrain.height / 2 });
    }
    return chosen;
  }

  setInput(id: string, input: Omit<CrabInput, 'dash'> & Partial<CrabInput>) {
    const crab = this.crabs.get(id);
    if (!crab) return;
    const prev = crab.input;
    if (input.seq !== prev.seq) crab.inputAt = this.time;
    crab.input = {
      dx: input.dx,
      dy: input.dy,
      seq: input.seq,
      // Bote acumula até o tick consumir, para não perder um toque rápido.
      dash: prev.dash || input.dash === true,
    };
  }

  /** Jogador saiu da sala no meio da rodada. */
  removeCrab(id: string): void {
    const crab = this.crabs.get(id);
    if (crab && crab.alive) {
      crab.alive = false;
      crab.diedAt = this.time;
    }
  }

  step(dt: number): StepResult {
    const result: StepResult = { fx: [], scores: [] };
    const level = this.level;

    for (const crab of this.crabs.values()) {
      if (!crab.alive) continue;
      crab.dashCooldown = Math.max(0, crab.dashCooldown - dt);
      this.applyActions(crab, result);
      stepBody(crab, crab.input, this.terrain, level, dt);
    }

    this.resolveCollisions(result);

    for (const crab of this.crabs.values()) {
      if (!crab.alive) continue;
      this.updateBreath(crab, level, dt, result);
    }

    this.erosionTimer += dt;
    if (this.erosionTimer >= EROSION.intervalSeconds) {
      this.erosionTimer -= EROSION.intervalSeconds;
      this.erode(level);
    }

    this.collectShells(result);
    this.washAwayShells(level);
    if (this.rng() < SHELLS.spawnPerSecond * dt) this.trySpawnShell(level, SHELLS.beachBand);

    for (const s of result.scores) {
      this.roundPoints.set(s.playerId, (this.roundPoints.get(s.playerId) ?? 0) + s.points);
    }
    this.time += dt;
    return result;
  }

  private applyActions(crab: Crab, result: StepResult): void {
    const { input } = crab;
    if (input.dash && crab.dashCooldown <= 0 && crab.stunT <= 0) {
      // O bote sai na direção pressionada agora, não na última olhada.
      const len = Math.hypot(input.dx, input.dy);
      if (len > 0.01) {
        crab.fx = input.dx / len;
        crab.fy = input.dy / len;
      }
      crab.dashT = CRAB.dashSeconds;
      crab.dashCooldown = CRAB.dashCooldown;
      result.fx.push({ kind: 'dash', x: crab.x, y: crab.y, by: crab.id });
    }
    input.dash = false;
  }

  private erode(level: number): void {
    const { width, height, heights } = this.terrain;
    const wet = (tx: number, ty: number) => heightAt(this.terrain, tx, ty) < level;
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const i = ty * width + tx;
        const h = heights[i] ?? 0;
        if (h === 0 || h < level || h >= level + EROSION.band) continue;
        if (!wet(tx - 1, ty) && !wet(tx + 1, ty) && !wet(tx, ty - 1) && !wet(tx, ty + 1)) continue;
        if (this.rng() >= EROSION.chance) continue;
        heights[i] = h - 1;
        this.dirtyTiles.add(i);
      }
    }
  }

  private resolveCollisions(result: StepResult): void {
    const alive = [...this.crabs.values()].filter((c) => c.alive);
    const minDist = CRAB.radius * 2;
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i]!;
        const b = alive[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const anyDashing = a.dashT > 0 || b.dashT > 0;
        if (dist >= (anyDashing ? CRAB.shoveReach : minDist)) continue;
        if (dist < 1e-4) {
          dx = 1;
          dy = 0;
          dist = 1;
        }
        const nx = dx / dist;
        const ny = dy / dist;

        if (a.dashT > 0) this.shove(a, b, nx, ny, result);
        if (b.dashT > 0) this.shove(b, a, -nx, -ny, result);

        // Separação simples para ninguém atravessar ninguém.
        if (dist < minDist) {
          const overlap = (minDist - dist) / 2;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }
    }
  }

  private shove(attacker: Crab, victim: Crab, nx: number, ny: number, result: StepResult): void {
    // A vítima voa na direção do bote (com um pouco do ângulo do contato): mira importa.
    let px = attacker.fx * 0.65 + nx * 0.35;
    let py = attacker.fy * 0.65 + ny * 0.35;
    const len = Math.hypot(px, py) || 1;
    px /= len;
    py /= len;

    attacker.dashT = 0;
    victim.kx = px * CRAB.shoveImpulse;
    victim.ky = py * CRAB.shoveImpulse;
    victim.stunT = CRAB.stunSeconds;
    victim.dashT = 0;
    victim.lastShovedBy = attacker.id;
    victim.lastShovedAt = this.time;
    // Recuo leve: empurrar também desequilibra.
    attacker.kx -= px * CRAB.shoveImpulse * 0.15;
    attacker.ky -= py * CRAB.shoveImpulse * 0.15;
    result.fx.push({
      kind: 'shove',
      x: (attacker.x + victim.x) / 2,
      y: (attacker.y + victim.y) / 2,
      by: attacker.id,
      target: victim.id,
    });
  }

  private updateBreath(crab: Crab, level: number, dt: number, result: StepResult): void {
    const depth = depthAt(this.terrain, crab.x, crab.y, level);
    if (depth > 0) {
      const drain = depth >= CRAB.deepWater ? CRAB.deepBreathDrain : CRAB.breathDrain;
      crab.breath = Math.max(0, crab.breath - drain * dt);
    } else {
      crab.breath = Math.min(1, crab.breath + CRAB.breathRegen * dt);
    }
    if (crab.breath > 0) return;

    crab.alive = false;
    crab.diedAt = this.time;
    const shover =
      crab.lastShovedBy !== null && this.time - crab.lastShovedAt <= SCORE.fatalShoveWindow
        ? crab.lastShovedBy
        : undefined;
    if (shover && this.crabs.get(shover)) {
      result.scores.push({ playerId: shover, points: SCORE.fatalShove });
    }
    result.fx.push({
      kind: 'drown',
      x: crab.x,
      y: crab.y,
      target: crab.id,
      ...(shover ? { by: shover, value: SCORE.fatalShove } : {}),
    });
  }

  private collectShells(result: StepResult): void {
    for (const crab of this.crabs.values()) {
      if (!crab.alive) continue;
      for (let i = this.shells.length - 1; i >= 0; i--) {
        const shell = this.shells[i]!;
        if (Math.hypot(shell.x - crab.x, shell.y - crab.y) > SHELLS.pickupRadius) continue;
        const points = shell.gold ? SCORE.goldShell : SCORE.shell;
        this.shells.splice(i, 1);
        result.scores.push({ playerId: crab.id, points });
        result.fx.push({ kind: 'shell', x: shell.x, y: shell.y, by: crab.id, value: points });
      }
    }
  }

  /** Concha que ficou no fundo é levada pelo mar: não vale a pena (nem dá) mergulhar atrás. */
  private washAwayShells(level: number): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]!;
      if (depthAt(this.terrain, s.x, s.y, level) >= CRAB.deepWater) this.shells.splice(i, 1);
    }
  }

  /** Conchas aparecem na praia logo acima da água: recompensa quem se arrisca na beira. */
  private trySpawnShell(level: number, band: number): void {
    if (this.shells.length >= SHELLS.max) return;
    for (let attempt = 0; attempt < 30; attempt++) {
      const tx = Math.floor(this.rng() * this.terrain.width);
      const ty = Math.floor(this.rng() * this.terrain.height);
      const h = heightAt(this.terrain, tx, ty);
      if (h < level || h >= level + band) continue;
      this.shells.push({
        id: this.nextShellId++,
        x: tx + 0.2 + this.rng() * 0.6,
        y: ty + 0.2 + this.rng() * 0.6,
        gold: this.rng() < SHELLS.goldChance,
      });
      return;
    }
  }

  aliveIds(): string[] {
    return [...this.crabs.values()].filter((c) => c.alive).map((c) => c.id);
  }

  isOver(): boolean {
    const alive = this.aliveIds().length;
    if (this.time >= ROUND_HARD_LIMIT_SECONDS) return true;
    if (this.starters >= 2) return alive <= 1;
    return alive === 0;
  }

  /**
   * Quem vence a rodada:
   * 1. o último sobrevivente;
   * 2. se todos afundaram, quem afundou por último;
   * 3. se os últimos afundaram no mesmo instante, quem fez mais pontos na rodada;
   * 4. empate também nos pontos: ninguém vence.
   */
  roundResult(): RoundResult {
    const none: RoundResult = { winner: null, byPoints: false };
    if (this.starters < 2) return none;
    const alive = this.aliveIds();
    if (alive.length === 1) return { winner: alive[0]!, byPoints: false };
    if (alive.length > 1) return none;

    const crabs = [...this.crabs.values()];
    const lastDeath = Math.max(...crabs.map((c) => c.diedAt));
    const last = crabs.filter((c) => c.diedAt === lastDeath);
    if (last.length === 1) return { winner: last[0]!.id, byPoints: false };

    const points = (id: string) => this.roundPoints.get(id) ?? 0;
    const best = Math.max(...last.map((c) => points(c.id)));
    const leaders = last.filter((c) => points(c.id) === best);
    return leaders.length === 1 ? { winner: leaders[0]!.id, byPoints: true } : none;
  }

  winner(): string | null {
    return this.roundResult().winner;
  }

  drainDirtyTiles(): [number, number][] {
    const out: [number, number][] = [];
    for (const i of this.dirtyTiles) out.push([i, this.terrain.heights[i] ?? 0]);
    this.dirtyTiles.clear();
    return out;
  }

  crabSnapshots(): CrabSnapshot[] {
    const r = (v: number) => Math.round(v * 100) / 100;
    return [...this.crabs.values()].map((c) => ({
      id: c.id,
      x: r(c.x),
      y: r(c.y),
      fx: r(c.fx),
      fy: r(c.fy),
      alive: c.alive,
      breath: r(c.breath),
      dashing: c.dashT > 0,
      stunned: c.stunT > 0,
      ack: c.input.seq,
      ackAge: r(this.time - c.inputAt),
    }));
  }

  shellSnapshots(): ShellSnapshot[] {
    return this.shells.map((s) => ({
      id: s.id,
      x: Math.round(s.x * 100) / 100,
      y: Math.round(s.y * 100) / 100,
      gold: s.gold,
    }));
  }
}
