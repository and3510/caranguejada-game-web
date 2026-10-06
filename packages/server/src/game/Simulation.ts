import {
  CRAB,
  DAMAGE,
  EROSION,
  LAG_HISTORY_SECONDS,
  MAX_TILE_HEIGHT,
  MAX_LAG_COMP_SECONDS,
  ROUND_HARD_LIMIT_SECONDS,
  SCORE,
  WEAPONS,
  WEAPON_RULES,
  assistAim,
  createBody,
  createRng,
  depthAt,
  generateTerrain,
  heightAt,
  inStrikeZone,
  knockbackMultiplier,
  isFlooding,
  pickWeaponKind,
  stepBody,
  tideLevel,
  weaponMoveMods,
  type Body,
  type CrabSnapshot,
  type FxEvent,
  type Rng,
  type RocketSnapshot,
  type Terrain,
  type WeaponItemSnapshot,
  type WeaponKind,
} from '@caranguejada/shared';

export interface CrabInput {
  dx: number;
  dy: number;
  /** Mira de quem joga com mouse/toque (ausente nos bots). */
  fx?: number;
  fy?: number;
  /** A mira vem do mouse: não há "puxão" de mira em direção a alguém. */
  mouse?: boolean;
  /** Tempo de simulação que o jogador estava vendo (compensação de lag). */
  vt?: number;
  /** Toques: ficam pendentes até o próximo tick consumir. */
  dash: boolean;
  attack: boolean;
  grab: boolean;
  seq: number;
}

export interface Crab extends Body {
  id: string;
  alive: boolean;
  breath: number;
  dashCooldown: number;
  /** Arma na mão; desarmado não atira. */
  weapon: WeaponKind | null;
  uses: number;
  attackCooldown: number;
  /** Rajada da submetralhadora: balas que faltam, tempo até a próxima e direção. */
  burst: { left: number; timer: number; dx: number; dy: number; lag: number };
  lastShovedBy: string | null;
  lastShovedAt: number;
  lastHitWeapon: WeaponKind | null;
  /** Dano acumulado (%): multiplica o empurrão dos próximos acertos. */
  damage: number;
  diedAt: number;
  input: CrabInput;
  /** Tempo de simulação em que o input atual chegou. */
  inputAt: number;
}

/** Foguete da bazuca: voa em linha reta e explode ao tocar alguém ou no fim do alcance. */
export interface Rocket {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  traveled: number;
  owner: string;
}

export interface WeaponItem {
  id: number;
  x: number;
  y: number;
  kind: WeaponKind;
  /** Arma largada guarda o desgaste: não dá pra "recarregar" largando e pegando. */
  uses: number;
  /** Há quanto tempo está boiando (s); zera quando volta a ficar em terra seca. */
  afloat: number;
}

/** Eventos de pontuação que a sala aplica ao placar da partida. */
export type ScoreEvent = { playerId: string; points: number };

export interface StepResult {
  fx: FxEvent[];
  scores: ScoreEvent[];
}

const emptyInput = (): CrabInput => ({
  dx: 0,
  dy: 0,
  dash: false,
  attack: false,
  grab: false,
  seq: 0,
});

/**
 * Uma rodada: terreno, enchente, caranguejos e armas. Não sabe nada de rede,
 * o que permite testar todas as regras de forma determinística.
 */
export class Simulation {
  readonly terrain: Terrain;
  readonly crabs = new Map<string, Crab>();
  readonly weapons: WeaponItem[] = [];
  readonly rockets: Rocket[] = [];
  /** Posições dos últimos ~0,5s: o tiro é decidido onde o atirador viu o alvo. */
  private readonly history: { time: number; pos: Map<string, { x: number; y: number }> }[] = [];
  time = 0;

  private readonly rng: Rng;
  private readonly starters: number;
  private nextWeaponId = 1;
  private nextRocketId = 1;
  private weaponTimer = 0;
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
        weapon: null,
        uses: 0,
        attackCooldown: 0,
        burst: { left: 0, timer: 0, dx: 0, dy: 0, lag: 0 },
        lastShovedBy: null,
        lastShovedAt: -Infinity,
        lastHitWeapon: null,
        damage: 0,
        diedAt: Infinity,
        input: emptyInput(),
        inputAt: 0,
      });
    });
    // Todo mundo começa desarmado: as primeiras armas já estão no mapa, e a corrida
    // até elas é o primeiro conflito da rodada.
    for (let i = 0; i < this.weaponCap(playerIds.length); i++) this.trySpawnWeapon(tideLevel(0));
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

  setInput(id: string, input: Omit<CrabInput, 'dash' | 'attack' | 'grab'> & Partial<CrabInput>) {
    const crab = this.crabs.get(id);
    if (!crab) return;
    const prev = crab.input;
    if (input.seq !== prev.seq) crab.inputAt = this.time;
    crab.input = {
      dx: input.dx,
      dy: input.dy,
      fx: input.fx,
      fy: input.fy,
      mouse: input.mouse === true,
      vt: input.vt,
      seq: input.seq,
      // Toques acumulam até o tick consumir, para não perder um aperto rápido.
      dash: prev.dash || input.dash === true,
      attack: prev.attack || input.attack === true,
      grab: prev.grab || input.grab === true,
    };
  }

  /** Coloca uma arma nova na mão (testes e ferramentas). */
  giveWeapon(id: string, kind: WeaponKind): void {
    const crab = this.crabs.get(id);
    if (!crab) return;
    crab.weapon = kind;
    crab.uses = WEAPONS[kind].uses;
  }

  /** Jogador saiu da sala no meio da rodada: a arma fica no chão para os outros. */
  removeCrab(id: string): void {
    const crab = this.crabs.get(id);
    if (crab && crab.alive) {
      crab.alive = false;
      crab.diedAt = this.time;
      this.dropWeapon(crab);
    }
  }

  step(dt: number): StepResult {
    const result: StepResult = { fx: [], scores: [] };
    const level = this.level;

    for (const crab of this.crabs.values()) {
      if (!crab.alive) continue;
      crab.dashCooldown = Math.max(0, crab.dashCooldown - dt);
      crab.attackCooldown = Math.max(0, crab.attackCooldown - dt);

      this.applyActions(crab, result);
      this.advanceBurst(crab, dt, result);

      // GUARDA A MIRA DO RATO ANTES DO MOVIMENTO
      const savedFx = crab.fx;
      const savedFy = crab.fy;

      stepBody(crab, crab.input, this.terrain, level, dt, weaponMoveMods(crab.weapon));

      // RESTAURA A MIRA PARA OS JOGADORES COM RATO (se não estiverem a dar dash)
      if (crab.dashT <= 0 && crab.input.fx !== undefined && crab.input.fy !== undefined) {
        crab.fx = savedFx;
        crab.fy = savedFy;
      }
    }

    this.resolveCollisions();
    this.advanceRockets(dt, result);

    for (const crab of this.crabs.values()) {
      if (!crab.alive) continue;
      this.updateBreath(crab, level, dt, result);
    }

    this.erosionTimer += dt;
    if (this.erosionTimer >= EROSION.intervalSeconds) {
      this.erosionTimer -= EROSION.intervalSeconds;
      this.erode(level);
    }

    this.washAwayWeapons(level, dt);
    this.weaponTimer += dt;
    const spawnEvery = isFlooding(this.time)
      ? WEAPON_RULES.floodSpawnEverySeconds
      : WEAPON_RULES.spawnEverySeconds;
    if (this.weaponTimer >= spawnEvery) {
      this.weaponTimer = 0;
      if (this.weapons.length < this.weaponCap(this.aliveIds().length)) this.trySpawnWeapon(level);
    }

    this.time += dt;
    this.recordHistory();
    return result;
  }

  private applyActions(crab: Crab, result: StepResult): void {
    const { input } = crab;
    const free = crab.stunT <= 0;
    const isDashing = crab.dashT > 0;

    // 1. Atualiza a mira com o rato recebida pela rede
    if (free && !isDashing && input.fx !== undefined && input.fy !== undefined) {
      const aimLen = Math.hypot(input.fx, input.fy);
      if (aimLen > 0.01) {
        crab.fx = input.fx / aimLen;
        crab.fy = input.fy / aimLen;
      }
    }

    const wasUnarmed = !crab.weapon;
    if ((input.grab || (input.attack && wasUnarmed)) && free) this.grabOrDrop(crab, result);

    // 2. O Dash ignora o rato e foca-se no movimento WASD
    if (input.dash && free && crab.dashCooldown <= 0) {
      const moveLen = Math.hypot(input.dx, input.dy);
      if (moveLen > 0.01) {
        crab.fx = input.dx / moveLen;
        crab.fy = input.dy / moveLen;
      } else if (input.fx === undefined) {
        // Fallback para bots: olha para onde anda
        this.aim(crab);
      }
      crab.dashT = CRAB.dashSeconds;
      crab.dashCooldown = CRAB.dashCooldown;
      result.fx.push({ kind: 'dash', x: crab.x, y: crab.y, by: crab.id });
    }

    if (input.attack && free && !wasUnarmed && crab.weapon && crab.attackCooldown <= 0) {
      this.startAttack(crab, crab.weapon, result);
    }
    input.dash = false;
    input.attack = false;
    input.grab = false;
  }

  /** Dash e tiro saem na direção pressionada agora, não na última olhada. */
  private aim(crab: Crab): void {
    const len = Math.hypot(crab.input.dx, crab.input.dy);
    if (len > 0.01) {
      crab.fx = crab.input.dx / len;
      crab.fy = crab.input.dy / len;
    }
  }

  /** Armas no chão ao mesmo tempo: acompanha quantos ainda estão vivos. */
  private weaponCap(alive: number): number {
    return Math.min(WEAPON_RULES.maxOnGround, Math.max(2, Math.ceil(alive / 2) + 1));
  }

  // ------------------------------------------------------------------ armas

  /** E: pega a arma mais perto; com uma na mão, larga (ou troca pela do chão). */
  private grabOrDrop(crab: Crab, result: StepResult): void {
    let near: WeaponItem | undefined;
    let nearDist: number = WEAPON_RULES.pickupRadius;
    for (const item of this.weapons) {
      const d = Math.hypot(item.x - crab.x, item.y - crab.y);
      if (d <= nearDist) {
        near = item;
        nearDist = d;
      }
    }
    if (crab.weapon) {
      const kind = crab.weapon;
      this.dropWeapon(crab);
      result.fx.push({ kind: 'drop', x: crab.x, y: crab.y, by: crab.id, weapon: kind });
    }
    if (!near) return;
    this.weapons.splice(this.weapons.indexOf(near), 1);
    crab.weapon = near.kind;
    crab.uses = near.uses;
    result.fx.push({ kind: 'pickup', x: near.x, y: near.y, by: crab.id, weapon: near.kind });
  }

  private dropWeapon(crab: Crab): void {
    if (!crab.weapon) return;
    if (crab.uses > 0) {
      this.weapons.push({
        id: this.nextWeaponId++,
        x: crab.x,
        y: crab.y,
        kind: crab.weapon,
        uses: crab.uses,
        afloat: 0,
      });
    }
    crab.weapon = null;
    crab.uses = 0;
    crab.burst.left = 0;
  }

  /** Guarda onde cada caranguejo estava neste instante (pra voltar no tempo ao atirar). */
  private recordHistory(): void {
    const pos = new Map<string, { x: number; y: number }>();
    for (const c of this.crabs.values()) pos.set(c.id, { x: c.x, y: c.y });
    this.history.push({ time: this.time, pos });
    while (this.history.length > 0 && this.time - this.history[0]!.time > LAG_HISTORY_SECONDS) {
      this.history.shift();
    }
  }

  /** Onde o caranguejo estava `lag` segundos atrás (interpola entre dois ticks). */
  private positionAt(crab: Crab, lag: number): { x: number; y: number } {
    if (lag <= 0) return crab;
    const t = this.time - lag;
    const h = this.history;
    for (let i = h.length - 1; i >= 0; i--) {
      const b = h[i]!;
      if (b.time > t) continue;
      const pb = b.pos.get(crab.id);
      const next = h[i + 1];
      const pn = next?.pos.get(crab.id);
      if (!pb) return crab;
      if (!next || !pn) return pb;
      const k = (t - b.time) / Math.max(1e-6, next.time - b.time);
      return { x: pb.x + (pn.x - pb.x) * k, y: pb.y + (pn.y - pb.y) * k };
    }
    // Mais antigo que o histórico: usa o registro mais velho que existe.
    return h[0]?.pos.get(crab.id) ?? crab;
  }

  /**
   * Quanto voltar no tempo pro tiro de `crab`: o que ele estava vendo (vt) no momento
   * do input, limitado (nem lag absurdo nem vt do futuro dão vantagem).
   */
  private lagFor(crab: Crab): number {
    const vt = crab.input.vt;
    if (vt === undefined) return 0;
    return Math.min(MAX_LAG_COMP_SECONDS, Math.max(0, this.time - vt));
  }

  private startAttack(crab: Crab, kind: WeaponKind, result: StepResult): void {
    const spec = WEAPONS[kind];

    // Bots não mandam mira: atiram no sentido em que andam.
    if (crab.input.fx === undefined || crab.input.fy === undefined) {
      this.aim(crab);
    }

    // Os alvos são testados onde o atirador os viu (mouse: mira exata, sem puxão).
    const lag = this.lagFor(crab);
    if (!crab.input.mouse) {
      const seen = [...this.crabs.values()]
        .filter((c) => c.alive && c !== crab)
        .map((c) => this.positionAt(c, lag));
      const aim = assistAim(kind, crab, { x: crab.fx, y: crab.fy }, seen, CRAB.radius);
      crab.fx = aim.x;
      crab.fy = aim.y;
    }
    crab.attackCooldown = spec.cooldown;
    if (spec.style === 'burst') {
      // A primeira bala sai agora; as outras, uma por vez (advanceBurst).
      crab.burst = { left: WEAPON_RULES.burstShots, timer: 0, dx: crab.fx, dy: crab.fy, lag };
      this.advanceBurst(crab, 0, result);
      return;
    }
    crab.uses--;
    if (spec.style === 'rocket') this.launchRocket(crab, result);
    else this.fire(crab, kind, crab.fx, crab.fy, result, lag);
    this.recoil(crab, crab.fx, crab.fy, spec.recoil);
    this.breakIfWorn(crab, result);
  }

  /** Rebote: quem atira vai pra trás (acertando ou não). Cuidado com a água às costas. */
  private recoil(crab: Crab, dx: number, dy: number, amount: number): void {
    if (amount <= 0) return;
    crab.kx -= dx * amount;
    crab.ky -= dy * amount;
    crab.dashT = 0;
  }

  /** Tiro instantâneo numa direção: acerta quem estiver na zona da arma. */
  private fire(
    crab: Crab,
    kind: WeaponKind,
    dx: number,
    dy: number,
    result: StepResult,
    lag = 0,
  ): void {
    const spec = WEAPONS[kind];
    const targets = this.targetsInZone(crab, kind, dx, dy, lag);
    const isBullet = spec.style === 'bullet' || spec.style === 'burst';
    // Tiro: o cliente desenha a bala até onde ela parou (no alvo, ou no fim do alcance).
    const shotLength = isBullet && targets[0] ? targets[0].dist : spec.reach;
    result.fx.push({
      kind: 'swing',
      x: crab.x,
      y: crab.y,
      by: crab.id,
      weapon: kind,
      dx,
      dy,
      value: Math.round(shotLength * 100) / 100,
    });
    for (const t of targets) this.hit(crab, t.victim, kind, t.nx, t.ny, t.dist, dx, dy, result);
  }

  /** Submetralhadora: solta as balas da rajada no ritmo certo, cada uma um pouco torta. */
  private advanceBurst(crab: Crab, dt: number, result: StepResult): void {
    const b = crab.burst;
    if (b.left <= 0) return;
    // Tonto não segura a arma: o resto da rajada se perde.
    if (crab.weapon !== 'submetralhadora' || crab.stunT > 0) {
      b.left = 0;
      return;
    }
    b.timer -= dt;
    while (b.left > 0 && b.timer <= 0 && crab.uses > 0) {
      const jitter = (this.rng() * 2 - 1) * WEAPON_RULES.burstJitter;
      const a = Math.atan2(b.dy, b.dx) + jitter;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      this.fire(crab, 'submetralhadora', dx, dy, result, b.lag);
      this.recoil(crab, dx, dy, WEAPONS.submetralhadora.recoil);
      crab.uses--;
      b.left--;
      b.timer += WEAPON_RULES.burstInterval;
    }
    if (b.left === 0 || crab.uses <= 0) {
      b.left = 0;
      this.breakIfWorn(crab, result);
    }
  }

  private launchRocket(crab: Crab, result: StepResult): void {
    const start = CRAB.radius + 0.35;
    this.rockets.push({
      id: this.nextRocketId++,
      x: crab.x + crab.fx * start,
      y: crab.y + crab.fy * start,
      dx: crab.fx,
      dy: crab.fy,
      traveled: start,
      owner: crab.id,
    });
    result.fx.push({
      kind: 'swing',
      x: crab.x,
      y: crab.y,
      by: crab.id,
      weapon: 'bazuca',
      dx: crab.fx,
      dy: crab.fy,
    });
  }

  /** Foguetes voam por cima de tudo e explodem ao tocar alguém ou no fim do alcance. */
  private advanceRockets(dt: number, result: StepResult): void {
    const step = (WEAPON_RULES.rocketSpeed * dt) / 2;
    const hitDist = WEAPON_RULES.rocketHitRadius + CRAB.radius;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]!;
      let boom = false;
      // Dois subpassos por tick: o foguete não "pula" por cima de ninguém.
      for (let sub = 0; sub < 2 && !boom; sub++) {
        r.x += r.dx * step;
        r.y += r.dy * step;
        r.traveled += step;
        const outside = r.x < 0 || r.y < 0 || r.x > this.terrain.width || r.y > this.terrain.height;
        const touched = [...this.crabs.values()].some(
          (c) => c.alive && c.id !== r.owner && Math.hypot(c.x - r.x, c.y - r.y) <= hitDist,
        );
        boom = outside || touched || r.traveled >= WEAPONS.bazuca.reach;
      }
      if (!boom) continue;
      this.rockets.splice(i, 1);
      this.explode(r, result);
    }
  }

  /**
   * Explosão: empurra todo mundo no raio para longe do centro (inclusive quem atirou)
   * e abre uma cratera no chão.
   */
  private explode(r: Rocket, result: StepResult): void {
    const spec = WEAPONS.bazuca;
    result.fx.push({ kind: 'boom', x: r.x, y: r.y, by: r.owner, weapon: 'bazuca' });
    for (const crab of this.crabs.values()) {
      if (!crab.alive) continue;
      const d = Math.hypot(crab.x - r.x, crab.y - r.y);
      if (d > WEAPON_RULES.blastRadius + CRAB.radius) continue;
      const nx = d > 1e-3 ? (crab.x - r.x) / d : r.dx;
      const ny = d > 1e-3 ? (crab.y - r.y) / d : r.dy;
      // Quem se explode sozinho não ganha dano (dá pra usar de rocket jump).
      if (crab.id !== r.owner) crab.damage = Math.min(DAMAGE.max, crab.damage + spec.damage);
      const impulse =
        spec.impulse *
        knockbackMultiplier(crab.damage) *
        (1 - 0.5 * Math.min(1, d / WEAPON_RULES.blastRadius));
      crab.kx = nx * impulse;
      crab.ky = ny * impulse;
      crab.stunT = Math.max(crab.stunT, spec.stun);
      crab.dashT = 0;
      // Quem se explode sozinho não credita ponto pra ninguém (nem pra si).
      if (crab.id !== r.owner) {
        crab.lastShovedBy = r.owner;
        crab.lastShovedAt = this.time;
        crab.lastHitWeapon = 'bazuca';
      }
      result.fx.push({
        kind: 'hit',
        x: crab.x,
        y: crab.y,
        by: r.owner,
        target: crab.id,
        weapon: 'bazuca',
        dx: nx,
        dy: ny,
      });
    }
    this.crater(r.x, r.y);
  }

  /**
   * Cratera: destrói o bloco atingido e os 8 em volta (o do centro afunda mais).
   * A maré ocupa o buraco.
   */
  private crater(x: number, y: number): void {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let ty = cy - 1; ty <= cy + 1; ty++) {
      for (let tx = cx - 1; tx <= cx + 1; tx++) {
        if (tx < 0 || ty < 0 || tx >= this.terrain.width || ty >= this.terrain.height) continue;
        const i = ty * this.terrain.width + tx;
        const h = this.terrain.heights[i] ?? 0;
        // O refúgio final (altura máxima) é indestrutível: nem a bazuca derruba.
        if (h === 0 || h >= MAX_TILE_HEIGHT) continue;
        const center = tx === cx && ty === cy;
        const depth = center ? WEAPON_RULES.craterCenterDepth : WEAPON_RULES.craterRingDepth;
        this.terrain.heights[i] = Math.max(0, h - depth);
        this.dirtyTiles.add(i);
      }
    }
  }

  private breakIfWorn(crab: Crab, result: StepResult): void {
    if (!crab.weapon || crab.uses > 0) return;
    result.fx.push({ kind: 'break', x: crab.x, y: crab.y, by: crab.id, weapon: crab.weapon });
    crab.weapon = null;
    crab.uses = 0;
    crab.burst.left = 0;
  }

  /**
   * Quem o tiro na direção (dx, dy) pega: todo mundo no leque (espingarda); a bala
   * (revólver, submetralhadora) para no primeiro da linha.
   */
  private targetsInZone(
    attacker: Crab,
    kind: WeaponKind,
    aimX: number,
    aimY: number,
    lag = 0,
  ): { victim: Crab; nx: number; ny: number; dist: number }[] {
    const out: { victim: Crab; nx: number; ny: number; dist: number }[] = [];
    for (const victim of this.crabs.values()) {
      if (victim === attacker || !victim.alive) continue;
      // Onde o atirador viu o alvo (o empurrão, depois, vale no alvo de agora).
      const seen = this.positionAt(victim, lag);
      let dx = seen.x - attacker.x;
      let dy = seen.y - attacker.y;
      let dist = Math.hypot(dx, dy);
      if (dist < 1e-4) {
        dx = aimX;
        dy = aimY;
        dist = 1e-4;
      }
      const nx = dx / Math.hypot(dx, dy);
      const ny = dy / Math.hypot(dx, dy);
      const angle = Math.atan2(aimX * ny - aimY * nx, aimX * nx + aimY * ny);
      if (inStrikeZone(kind, dist, angle, CRAB.radius)) out.push({ victim, nx, ny, dist });
    }
    const style = WEAPONS[kind].style;
    if (style !== 'bullet' && style !== 'burst') return out;
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, 1);
  }

  private hit(
    attacker: Crab,
    victim: Crab,
    kind: WeaponKind,
    nx: number,
    ny: number,
    dist: number,
    aimX: number,
    aimY: number,
    result: StepResult,
  ): void {
    const spec = WEAPONS[kind];
    // O acerto soma dano e já empurra com o total (inclusive este).
    victim.damage = Math.min(DAMAGE.max, victim.damage + spec.damage);
    let impulse = spec.impulse * knockbackMultiplier(victim.damage);
    if (spec.style === 'spread') {
      // Chumbo espalha: de perto empurra mais que no limite do alcance.
      impulse *= 1 - WEAPON_RULES.spreadFalloff * Math.min(1, dist / spec.reach);
    }
    let px: number;
    let py: number;
    if (spec.style === 'bullet' || spec.style === 'burst') {
      // A bala empurra na direção do tiro.
      px = aimX;
      py = aimY;
    } else {
      // Chumbo: voa na direção do tiro, com um pouco do ângulo do contato.
      px = aimX * 0.65 + nx * 0.35;
      py = aimY * 0.65 + ny * 0.35;
      const len = Math.hypot(px, py) || 1;
      px /= len;
      py /= len;
    }

    if (spec.style === 'burst') {
      // Rajada soma: cada bala empurra um pouco mais quem já está voando.
      victim.kx += px * impulse;
      victim.ky += py * impulse;
    } else {
      victim.kx = px * impulse;
      victim.ky = py * impulse;
    }
    victim.stunT = Math.max(victim.stunT, spec.stun);
    victim.dashT = 0;
    victim.lastShovedBy = attacker.id;
    victim.lastShovedAt = this.time;
    victim.lastHitWeapon = kind;
    result.fx.push({
      kind: 'hit',
      x: (attacker.x + victim.x) / 2,
      y: (attacker.y + victim.y) / 2,
      by: attacker.id,
      target: victim.id,
      weapon: kind,
      dx: px,
      dy: py,
    });
  }

  private erode(level: number): void {
    const { width, height, heights } = this.terrain;
    const wet = (tx: number, ty: number) => heightAt(this.terrain, tx, ty) < level;
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const i = ty * width + tx;
        const h = heights[i] ?? 0;
        // Altura máxima = refúgio final: as ondas não comem.
        if (h === 0 || h >= MAX_TILE_HEIGHT || h < level || h >= level + EROSION.band) continue;
        if (!wet(tx - 1, ty) && !wet(tx + 1, ty) && !wet(tx, ty - 1) && !wet(tx, ty + 1)) continue;
        if (this.rng() >= EROSION.chance) continue;
        heights[i] = h - 1;
        this.dirtyTiles.add(i);
      }
    }
  }

  /** Corpo não atravessa corpo. Dash só desloca: esbarrar não empurra ninguém. */
  private resolveCollisions(): void {
    const alive = [...this.crabs.values()].filter((c) => c.alive);
    const minDist = CRAB.radius * 2;
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i]!;
        const b = alive[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;
        if (dist < 1e-4) {
          dx = 1;
          dy = 0;
          dist = 1;
        }
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = (minDist - Math.min(dist, minDist)) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
      }
    }
  }

  private updateBreath(crab: Crab, level: number, dt: number, result: StepResult): void {
    const depth = depthAt(this.terrain, crab.x, crab.y, level);
    if (depth > 0) {
      const deep = depth >= CRAB.deepWater;
      const drain = deep ? CRAB.deepBreathDrain : CRAB.breathDrain;
      // Só a água funda mata: na rasa o fôlego para no piso (a maré, subindo, vira tudo fundo).
      crab.breath = Math.max(deep ? 0 : CRAB.shallowBreathFloor, crab.breath - drain * dt);
    } else {
      crab.breath = Math.min(1, crab.breath + CRAB.breathRegen * dt);
    }
    if (crab.breath > 0) return;

    crab.alive = false;
    crab.diedAt = this.time;
    // A arma afunda junto.
    crab.weapon = null;
    crab.uses = 0;
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
      ...(shover
        ? {
            by: shover,
            value: SCORE.fatalShove,
            ...(crab.lastHitWeapon ? { weapon: crab.lastHitWeapon } : {}),
          }
        : {}),
    });
  }

  /** Arma na água boia um tempo (dá pra pegar nadando) e depois o mar leva. */
  private washAwayWeapons(level: number, dt: number): void {
    for (let i = this.weapons.length - 1; i >= 0; i--) {
      const w = this.weapons[i]!;
      if (depthAt(this.terrain, w.x, w.y, level) <= 0) {
        w.afloat = 0;
        continue;
      }
      w.afloat += dt;
      if (w.afloat >= WEAPON_RULES.floatSeconds) this.weapons.splice(i, 1);
    }
  }

  /**
   * Onde nasce arma nova, em ordem de preferência:
   * 1. terra alta e longe de quem está vivo (pegar uma exige sair do lugar);
   * 2. qualquer terra seca, quando a ilha já encolheu;
   * 3. boiando na água perto de quem ainda está vivo, no fim da enchente:
   *    sempre dá pra se armar e jogar alguém pro fundo.
   */
  private trySpawnWeapon(level: number): void {
    const alive = [...this.crabs.values()].filter((c) => c.alive);
    const clear = (x: number, y: number, fromCrabs: number, fromWeapons: number) =>
      alive.every((c) => Math.hypot(c.x - x, c.y - y) >= fromCrabs) &&
      this.weapons.every((w) => Math.hypot(w.x - x, w.y - y) >= fromWeapons);
    const tiers: ((x: number, y: number, h: number) => boolean)[] = [
      (x, y, h) => h >= level + WEAPON_RULES.spawnMinHeightAboveWater && clear(x, y, 2, 3),
      (x, y, h) => h >= level && clear(x, y, 1, 1.5),
      (x, y, h) =>
        h < level &&
        clear(x, y, 1, 1.5) &&
        alive.some((c) => Math.hypot(c.x - x, c.y - y) <= WEAPON_RULES.floatSpawnNear),
    ];
    for (const fits of tiers) {
      const spots: { x: number; y: number }[] = [];
      for (let ty = 0; ty < this.terrain.height; ty++) {
        for (let tx = 0; tx < this.terrain.width; tx++) {
          const x = tx + 0.5;
          const y = ty + 0.5;
          if (fits(x, y, heightAt(this.terrain, tx, ty))) spots.push({ x, y });
        }
      }
      if (spots.length === 0) continue;
      const spot = spots[Math.floor(this.rng() * spots.length)]!;
      const kind = pickWeaponKind(this.rng());
      this.weapons.push({
        id: this.nextWeaponId++,
        ...spot,
        kind,
        uses: WEAPONS[kind].uses,
        afloat: 0,
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
   * 3. se os últimos afundaram no mesmo instante, é empate: ninguém leva a rodada.
   */
  winner(): string | null {
    if (this.starters < 2) return null;
    const alive = this.aliveIds();
    if (alive.length === 1) return alive[0]!;
    if (alive.length > 1) return null;

    const crabs = [...this.crabs.values()];
    const lastDeath = Math.max(...crabs.map((c) => c.diedAt));
    const last = crabs.filter((c) => c.diedAt === lastDeath);
    return last.length === 1 ? last[0]!.id : null;
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
      damage: Math.round(c.damage),
      dashing: c.dashT > 0,
      stunned: c.stunT > 0,
      weapon: c.weapon,
      uses: c.uses,
      ack: c.input.seq,
      ackAge: r(this.time - c.inputAt),
    }));
  }

  weaponSnapshots(): WeaponItemSnapshot[] {
    const r = (v: number) => Math.round(v * 100) / 100;
    return this.weapons.map((w) => ({
      id: w.id,
      x: r(w.x),
      y: r(w.y),
      kind: w.kind,
      uses: w.uses,
      afloat: r(w.afloat),
    }));
  }

  rocketSnapshots(): RocketSnapshot[] {
    const r = (v: number) => Math.round(v * 100) / 100;
    return this.rockets.map((k) => ({
      id: k.id,
      x: r(k.x),
      y: r(k.y),
      dx: r(k.dx),
      dy: r(k.dy),
      owner: k.owner,
    }));
  }
}
