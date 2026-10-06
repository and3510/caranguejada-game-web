import Phaser from 'phaser';
import {
  CLIENT_INPUT_RATE,
  SNAPSHOT_RATE,
  CRAB,
  CRAB_COLORS,
  DAMAGE,
  WEAPONS,
  WEAPON_KINDS,
  WEAPON_RULES,
  assistAim,
  createBody,
  createRng,
  depthAt,
  heightAt,
  inStrikeZone,
  stepBody,
  tideLevel,
  weaponMoveMods,
  type Body,
  type CrabSnapshot,
  type FxEvent,
  type InputMessage,
  type MapKind,
  type Terrain,
  type WeaponKind,
} from '@caranguejada/shared';
import { attractTerrain, settings, type Store } from '../state';
import { blendBetween } from './interp';
import type { Sfx } from './audio';
import type { InputController } from './input';
import {
  CRAB_FRAMES,
  ROCKET_ART,
  WEAPON_GRIP,
  WEAPON_PALETTE,
  crabCanvas,
  pixelArtCanvas,
  weaponCanvas,
} from './sprites';
import { TILE, TerrainRenderer } from './terrainRenderer';

export interface SceneDeps {
  store: Store;
  input: InputController;
  sfx: Sfx;
  send: (msg: InputMessage) => void;
  /** Chamado a cada quadro com dados para o HUD. */
  onFrame: (info: FrameInfo) => void;
}

export interface FrameInfo {
  level: number;
  roundTime: number;
  /** 0..1: quanto do dash já recarregou. */
  dashReady: number;
  /** 0..1: fração da ilha original que ainda está seca. */
  land: number;
  /** Arma na mão (null = desarmado: só anda e dá dash). */
  weapon: WeaponKind | null;
  /** Golpes que a arma ainda aguenta. */
  uses: number;
  /** 0..1: recarga do tiro. */
  attackReady: number;
  /** Arma do chão ao alcance (o botão de toque vira "pegar"/"trocar"). */
  nearWeapon: WeaponKind | null;
  /** Nome de quem você está assistindo (só depois de cair); null = jogando. */
  spectating: string | null;
}

interface CrabView {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  labelResolution: number;
  color: number;
  walk: number;
  lastX: number;
  lastY: number;
  /** Timestamps (performance.now) até quando cada efeito dura. */
  spinUntil: number;
  flashUntil: number;
  nextGhostAt: number;
  wasDashing: boolean;
  /** Arma na mão, desenhada ao lado do caranguejo. */
  weapon: Phaser.GameObjects.Image | null;
  weaponKind: WeaponKind | null;
  /** Início do coice do último tiro (performance.now). */
  swingAt: number;
}

/**
 * Rastro do tiro: fica parado onde saiu (o rebote leva o atirador, mas a bala não
 * vai junto). Origem e alcance em tiles.
 */
interface Shot {
  kind: WeaponKind;
  x: number;
  y: number;
  fx: number;
  fy: number;
  length: number;
  start: number;
}

interface LocalCrab {
  body: Body;
  dashCooldown: number;
  attackCooldown: number;
  /** Rajada da submetralhadora desenhada na hora (o servidor confirma os acertos). */
  burst: { left: number; timer: number; dx: number; dy: number };
  seq: number;
  sendTimer: number;
  sentAt: Map<number, number>;
  history: { t: number; x: number; y: number }[];
}

interface CrabRender {
  id: string;
  x: number;
  y: number;
  fx: number;
  fy: number;
  alive: boolean;
  breath: number;
  dashing: boolean;
  stunned: boolean;
  weapon: WeaponKind | null;
  /** Dano acumulado (%). */
  damage: number;
  color: number;
  name: string;
}

interface RocketView {
  img: Phaser.GameObjects.Image;
  smokeAt: number;
  /** Erro (tiles) entre o palpite e o foguete do servidor; some suave, sem tranco. */
  offX: number;
  offY: number;
}

/**
 * Foguete desenhado no instante do clique, antes de o servidor confirmar: só enfeite.
 * Quando o foguete de verdade chega, este vira a imagem dele (sem dois foguetes na tela).
 */
interface GuessedRocket {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  dx: number;
  dy: number;
  start: number;
  smokeAt: number;
}

/** Quanto tempo o erro do palpite leva pra sumir (s). */
const ROCKET_BLEND_SECONDS = 0.2;
/** Sem confirmação do servidor nesse tempo, o palpite some caladinho. */
const ROCKET_GUESS_TIMEOUT_MS = 700;

/** Atraso de interpolação: ~2 snapshots, absorve jitter de rede. */
const INTERP_DELAY_MS = 100;
/**
 * Snapshot atrasado: segue o movimento por no máximo este tempo em vez de congelar.
 * Curto de propósito — caranguejo muda de direção demais pra chutar muito à frente.
 */
const EXTRAPOLATE_MAX_MS = 150;
/** Servidor local (solo): os snapshots chegam no relógio certo, basta um intervalo. */
const LOCAL_INTERP_DELAY_MS = 1000 / SNAPSHOT_RATE + 5;
const SEND_INTERVAL = 1 / CLIENT_INPUT_RATE;
/**
 * Toque de ação (tiro, dash, pegar) não espera o próximo pacote: sai no dobro da taxa.
 * Tira até ~17ms do caminho do tiro, sem dobrar o tráfego (só acontece quando se aperta algo).
 */
const MIN_SEND_INTERVAL = 1 / 60;
const HIT_WORDS: Record<WeaponKind, readonly string[]> = {
  espingarda: ['BUM!', 'KABUM!', 'POW!'],
  revolver: ['BANG!', 'PEI!', 'PÁ!'],
  submetralhadora: ['TA-TA!', 'RA-TA-TA!', 'TÁ!'],
  bazuca: ['BUUM!', 'KABUM!', 'CABRUM!'],
};
/** Duração do rastro do tiro (clarão, bala, chumbo). */
const SHOT_MS = 280;
/** Laser de alcance: vermelho vivo (o amarelo/laranja sumia na areia), com contorno escuro. */
const LASER_COLOR = 0xff2a2a;
const LASER_STROKES: readonly [number, number, number][] = [
  [3, 0x2b1d14, 0.55],
  [1.5, LASER_COLOR, 1],
];
/** Duração do coice da arma na mão. */
const SWING_MS = 220;
const isTouch = () => matchMedia('(pointer: coarse)').matches;

const crabKey = (color: number, frame: number) => `crab-${color.toString(16)}-${frame}`;

export class GameScene extends Phaser.Scene {
  private terrainRenderer!: TerrainRenderer;
  private terrainTexture!: Phaser.Textures.CanvasTexture;
  private overlay!: Phaser.GameObjects.Graphics;
  private readonly crabViews = new Map<string, CrabView>();
  private readonly weaponViews = new Map<number, Phaser.GameObjects.Image>();
  private readonly shots: Shot[] = [];
  /** Foguetes da bazuca em voo (do servidor). */
  private readonly rocketViews = new Map<number, RocketView>();
  /** Palpites de foguete já desenhados, esperando o servidor confirmar. */
  private readonly guessedRockets: GuessedRocket[] = [];
  /** Caranguejos como estão na tela (a mira do tiro local usa essas posições). */
  private lastCrabs: CrabRender[] = [];
  /** Tempo do servidor que os outros caranguejos mostram na tela (compensação de lag). */
  private viewTime = 0;
  /** "F: pegar Bazuca" em cima da arma mais perto. */
  private prompt!: Phaser.GameObjects.Text;

  private local: LocalCrab | null = null;
  private seenRoundId = -1;
  private seenSnapshotAt = 0;
  private cam = { x: 0, y: 0, ready: false };
  private spectateId: string | null = null;
  /** Nome de quem está sendo assistido (null enquanto você joga). */
  private spectatingName: string | null = null;
  /** Troca pedida pelos botões da tela (a do teclado vem do InputController). */
  private spectateRequest = 0;
  /** Congela o quadro por um instante no acerto: dá peso ao golpe. */
  private hitStopUntil = 0;
  private land = { initial: 1, current: 1, nextAt: 0 };

  private readonly demo = {
    terrain: attractTerrain(),
    crabs: [] as { body: Body; dir: { dx: number; dy: number }; until: number; color: number }[],
    time: 0,
  };

  constructor(private readonly deps: SceneDeps) {
    super('game');
  }

  create(): void {
    for (const color of CRAB_COLORS) {
      CRAB_FRAMES.forEach((_, f) =>
        this.textures.addCanvas(crabKey(color, f), crabCanvas(color, f)),
      );
    }
    for (const kind of WEAPON_KINDS) this.textures.addCanvas(`weapon-${kind}`, weaponCanvas(kind));
    this.textures.addCanvas('rocket', pixelArtCanvas(ROCKET_ART, WEAPON_PALETTE));

    const { width, height } = this.demo.terrain;
    this.terrainRenderer = new TerrainRenderer(width, height);
    this.terrainTexture = this.textures.addCanvas('terrain', this.terrainRenderer.canvas)!;
    this.add.image(0, 0, 'terrain').setOrigin(0).setDepth(-1000);
    this.overlay = this.add.graphics().setDepth(10_000);
    this.prompt = this.add
      .text(0, 0, '', {
        fontFamily: 'Silkscreen',
        fontSize: '8px',
        color: '#ffe9a8',
        stroke: '#2b1d14',
        strokeThickness: 2,
        resolution: this.textResolution(),
      })
      .setOrigin(0.5, 1)
      .setDepth(9_900)
      .setVisible(false);

    this.setupDemo();
  }

  // ------------------------------------------------------------------ loop

  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    const { store } = this.deps;
    const inMatch =
      store.terrain !== null &&
      (store.phase === 'countdown' || store.phase === 'playing' || store.phase === 'roundEnd');

    if (inMatch) this.updateMatch(dt, store.terrain!);
    else this.updateDemo(dt);
  }

  private updateMatch(dt: number, terrain: Terrain): void {
    const { store } = this.deps;
    const now = performance.now();

    if (store.roundId !== this.seenRoundId) this.onNewRound(terrain);
    const roundTime = store.roundTime(now);
    const level = tideLevel(roundTime);
    this.drawTerrain(terrain, level, store.terrainVersion, store.mapKind);
    this.drainFx();

    if (now < this.hitStopUntil) return;

    const latest = store.latest();
    if (latest && latest.at !== this.seenSnapshotAt) {
      this.seenSnapshotAt = latest.at;
      this.reconcile(latest.crabs.get(store.you));
    }

    if (store.phase === 'playing') this.predictLocal(dt, terrain, level);

    const crabs = this.collectCrabs(now);
    this.lastCrabs = crabs;
    this.renderCrabs(crabs, terrain, level, dt);
    this.renderWeaponItems(terrain, level);
    this.renderRockets(now, dt);
    this.drawOverlay(crabs, terrain, level);
    this.updatePrompt();
    this.updateCamera(crabs, terrain, dt);

    if (now >= this.land.nextAt) {
      this.land.nextAt = now + 250;
      this.land.current = this.countLand(terrain, level) / this.land.initial;
    }
    const local = this.local;
    const mine = latest?.crabs.get(store.you);
    const weapon = local && mine?.alive ? mine.weapon : null;
    const dashReady = local ? 1 - local.dashCooldown / CRAB.dashCooldown : 1;
    const attackReady =
      local && weapon ? 1 - local.attackCooldown / WEAPONS[weapon].cooldown : weapon ? 1 : 0;
    this.deps.onFrame({
      level,
      roundTime,
      dashReady,
      land: this.land.current,
      weapon,
      uses: mine?.uses ?? 0,
      attackReady,
      nearWeapon: this.nearestWeapon()?.kind ?? null,
      spectating: this.spectatingName,
    });
  }

  private onNewRound(terrain: Terrain): void {
    this.seenRoundId = this.deps.store.roundId;
    this.local = null;
    this.cam.ready = false;
    this.spectateId = null;
    this.land = {
      initial: Math.max(1, this.countLand(terrain, tideLevel(0))),
      current: 1,
      nextAt: 0,
    };
    for (const v of this.weaponViews.values()) v.destroy();
    this.weaponViews.clear();
    this.shots.length = 0;
    this.clearRockets();
    this.clearDemoCrabs();
  }

  private countLand(terrain: Terrain, level: number): number {
    let n = 0;
    for (const h of terrain.heights) if (h >= level) n++;
    return n;
  }

  private drawTerrain(terrain: Terrain, level: number, version: number, kind: MapKind): void {
    // Efeitos reduzidos: água parada (sem isso o mapa todo é redesenhado a cada 450ms).
    const frame = settings.lowFx ? 0 : Math.floor(performance.now() / 450) % 2;
    if (this.terrainRenderer.draw(terrain, level, frame, version, kind))
      this.terrainTexture.refresh();
  }

  // ------------------------------------------------------------------ predição

  private predictLocal(dt: number, terrain: Terrain, level: number): void {
    const { store, input, send } = this.deps;
    const server = store.latest()?.crabs.get(store.you);
    if (!server || !server.alive) {
      this.local = null;
      return;
    }
    if (!this.local) {
      this.local = {
        body: { ...createBody(server.x, server.y), fx: server.fx, fy: server.fy },
        dashCooldown: 0,
        attackCooldown: 0,
        burst: { left: 0, timer: 0, dx: 0, dy: 0 },
        seq: 0,
        sendTimer: 0,
        sentAt: new Map(),
        history: [],
      };
    }
    const local = this.local;
    const dir = input.direction();
    const actions = input.peekActions();
    const body = local.body;

    const free = body.stunT <= 0;
    const isDashing = body.dashT > 0;

    // --- 1. MIRA DO RATO ---
    if (free && !isDashing && !input.touchMode) {
      const aimPos = input.aimPosition();
      const worldPoint = this.cameras.main.getWorldPoint(aimPos.x, aimPos.y);
      const crabX = body.x * TILE;
      const crabY = body.y * TILE;

      const aimDx = worldPoint.x - crabX;
      const aimDy = worldPoint.y - crabY;
      const len = Math.hypot(aimDx, aimDy);

      if (len > 0.01) {
        body.fx = aimDx / len;
        body.fy = aimDy / len;
      }
    } else if (free && !isDashing && input.touchMode) {
      // Fallback pro telemóvel/touch
      const len = Math.hypot(dir.dx, dir.dy);
      if (len > 0.01) {
        body.fx = dir.dx / len;
        body.fy = dir.dy / len;
      }
    }

    local.dashCooldown = Math.max(0, local.dashCooldown - dt);
    local.attackCooldown = Math.max(0, local.attackCooldown - dt);

    // --- 2. DASH ---
    if (actions.dash && free && local.dashCooldown <= 0) {
      const moveLen = Math.hypot(dir.dx, dir.dy);
      if (moveLen > 0.01) {
        body.fx = dir.dx / moveLen;
        body.fy = dir.dy / moveLen;
      }

      body.dashT = CRAB.dashSeconds;
      local.dashCooldown = CRAB.dashCooldown;
      this.dashStartFx(store.you, body.x, body.y, body.fx, body.fy);
    }

    // --- 3. ATAQUE ---
    const weapon = server.weapon;
    if (actions.attack && free && weapon && local.attackCooldown <= 0) {
      const spec = WEAPONS[weapon];
      const others = this.lastCrabs.filter((c) => c.alive && c.id !== store.you);
      // Mouse mira exato; só o toque (e o teclado) ganha o "puxão" de mira.
      if (input.touchMode) {
        const shot = assistAim(weapon, body, { x: body.fx, y: body.fy }, others, CRAB.radius);
        body.fx = shot.x;
        body.fy = shot.y;
      }
      local.attackCooldown = spec.cooldown;
      if (spec.style === 'burst') {
        local.burst = {
          left: Math.min(WEAPON_RULES.burstShots, server.uses),
          timer: 0,
          dx: body.fx,
          dy: body.fy,
        };
      } else {
        this.startSwing(store.you, weapon, body.fx, body.fy, this.shotLength(weapon, body, others));
        // O foguete sai do cano na hora: esperar o servidor faria ele "nascer" adiantado.
        if (spec.style === 'rocket') this.guessRocket(body);
        this.localRecoil(body, body.fx, body.fy, spec.recoil);
      }
    }

    this.advanceLocalBurst(local, dt);

    // GUARDA A MIRA ANTES DO MOVIMENTO (NOVIDADE AQUI)
    const savedFx = body.fx;
    const savedFy = body.fy;

    // A função partilhada que estragava a mira move a personagem
    stepBody(body, dir, terrain, level, dt, weaponMoveMods(weapon));

    // RESTAURA A MIRA DO RATO DEPOIS DE ANDAR (desde que não esteja a meio de um dash)
    if (body.dashT <= 0 && !input.touchMode) {
      body.fx = savedFx;
      body.fy = savedFy;
    }

    const now = performance.now();
    local.history.push({ t: now, x: local.body.x, y: local.body.y });
    while (local.history.length > 0 && now - local.history[0]!.t > 1500) local.history.shift();

    local.sendTimer += dt;
    if (
      local.sendTimer >= SEND_INTERVAL ||
      (input.hasPending() && local.sendTimer >= MIN_SEND_INTERVAL)
    ) {
      local.sendTimer = 0;
      const sent = input.consumeActions();
      local.seq++;
      local.sentAt.set(local.seq, now);
      send({
        t: 'input',
        seq: local.seq,
        dx: dir.dx,
        dy: dir.dy,
        fx: Math.round(body.fx * 1000) / 1000,
        fy: Math.round(body.fy * 1000) / 1000,
        mouse: !input.touchMode,
        // O instante (do servidor) que está na tela: o tiro é decidido ali.
        vt: this.viewTime,
        ...sent,
      });
    }
  }

  private localRecoil(body: Body, dx: number, dy: number, amount: number): void {
    if (amount <= 0) return;
    body.kx -= dx * amount;
    body.ky -= dy * amount;
    body.dashT = 0;
  }

  /** Rajada local: cada bala com o mesmo ritmo e espalhamento do servidor (o sorteio é visual). */
  private advanceLocalBurst(local: LocalCrab, dt: number): void {
    const b = local.burst;
    if (b.left <= 0) return;
    if (local.body.stunT > 0) {
      b.left = 0;
      return;
    }
    b.timer -= dt;
    const you = this.deps.store.you;
    const others = this.lastCrabs.filter((c) => c.alive && c.id !== you);
    while (b.left > 0 && b.timer <= 0) {
      const a = Math.atan2(b.dy, b.dx) + (Math.random() * 2 - 1) * WEAPON_RULES.burstJitter;
      const dir = { fx: Math.cos(a), fy: Math.sin(a) };
      const from = { ...local.body, ...dir };
      this.startSwing(
        you,
        'submetralhadora',
        dir.fx,
        dir.fy,
        this.shotLength('submetralhadora', from, others),
      );
      this.localRecoil(local.body, dir.fx, dir.fy, WEAPONS.submetralhadora.recoil);
      b.left--;
      b.timer += WEAPON_RULES.burstInterval;
    }
  }

  /** Até onde o tiro vai (bala: para no primeiro da linha). Outras armas: alcance. */
  private shotLength(kind: WeaponKind, from: Body, others: CrabRender[]): number {
    const spec = WEAPONS[kind];
    if (spec.style !== 'bullet' && spec.style !== 'burst') return spec.reach;
    let length: number = spec.reach;
    for (const c of others) {
      const dx = c.x - from.x;
      const dy = c.y - from.y;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(from.fx * dy - from.fy * dx, from.fx * dx + from.fy * dy);
      if (dist < length && inStrikeZone(kind, dist, angle, CRAB.radius)) length = dist;
    }
    return length;
  }

  /**
   * Compara a posição do servidor com onde *nós* estávamos quando ele aplicou
   * nosso input — assim a latência não vira erro. Corrige aos poucos para não tremer.
   */
  private reconcile(server: CrabSnapshot | undefined): void {
    const local = this.local;
    if (!local || !server) return;
    if (!server.alive) {
      this.local = null;
      return;
    }
    if (server.stunned && local.body.stunT <= 0) {
      local.body.stunT = 0.25;
      local.body.dashT = 0;
    }

    const sentAt = local.sentAt.get(server.ack);
    for (const seq of local.sentAt.keys()) if (seq < server.ack) local.sentAt.delete(seq);
    if (sentAt === undefined) {
      if (server.ack === 0) Object.assign(local.body, { x: server.x, y: server.y });
      return;
    }
    const sample = this.sampleHistory(local.history, sentAt + server.ackAge * 1000);
    if (!sample) return;
    const ex = server.x - sample.x;
    const ey = server.y - sample.y;
    const err = Math.hypot(ex, ey);
    if (err < 0.05) return;
    // Empurrão vem do servidor: segue rápido para a vítima sentir o tranco na hora.
    const k = err > 2 || server.stunned ? 0.8 : 0.4;
    local.body.x += ex * k;
    local.body.y += ey * k;
    for (const h of local.history) {
      h.x += ex * k;
      h.y += ey * k;
    }
  }

  private sampleHistory(history: LocalCrab['history'], t: number): { x: number; y: number } | null {
    if (history.length === 0) return null;
    if (t <= history[0]!.t) return history[0]!;
    for (let i = 1; i < history.length; i++) {
      const b = history[i]!;
      if (b.t >= t) {
        const a = history[i - 1]!;
        const k = (t - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    return history.at(-1)!;
  }

  // ------------------------------------------------------------------ caranguejos

  private collectCrabs(now: number): CrabRender[] {
    const { store } = this.deps;
    const snaps = store.snapshots;
    if (snaps.length === 0) return [];
    const renderAt = now - (store.local ? LOCAL_INTERP_DELAY_MS : INTERP_DELAY_MS);
    let a = snaps[0]!;
    let b = snaps.at(-1)!;
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1]!.at <= renderAt) {
        a = snaps[i - 1]!;
        b = snaps[i]!;
        break;
      }
    }
    // Snapshot atrasado: segue o movimento um pouco em vez de congelar (ver interp.ts).
    const { k, extra } = blendBetween(a.at, b.at, renderAt, EXTRAPOLATE_MAX_MS);
    this.viewTime = Math.round((a.time + (b.time - a.time) * (k + extra)) * 1000) / 1000;

    const out: CrabRender[] = [];
    for (const cb of b.crabs.values()) {
      const ca = a.crabs.get(cb.id) ?? cb;
      const info = store.player(cb.id);
      const latest = store.latest()!.crabs.get(cb.id) ?? cb;
      // Quem está voando de empurrão muda de direção demais: aí congelar erra menos
      // que chutar, então ele não extrapola.
      const kk = latest.stunned ? k : k + extra;
      const render: CrabRender = {
        id: cb.id,
        x: ca.x + (cb.x - ca.x) * kk,
        y: ca.y + (cb.y - ca.y) * kk,
        fx: cb.fx,
        fy: cb.fy,
        alive: latest.alive,
        breath: latest.breath,
        dashing: cb.dashing,
        stunned: latest.stunned,
        weapon: latest.alive ? latest.weapon : null,
        damage: latest.damage,
        color: info?.color ?? CRAB_COLORS[0],
        name: info?.name ?? '?',
      };
      if (cb.id === store.you && this.local) {
        const body = this.local.body;
        render.x = body.x;
        render.y = body.y;
        render.fx = body.fx;
        render.fy = body.fy;
        render.dashing = body.dashT > 0;
      }
      out.push(render);
    }
    return out;
  }

  private renderCrabs(crabs: CrabRender[], terrain: Terrain, level: number, dt: number): void {
    const now = performance.now();
    const seen = new Set<string>();
    for (const c of crabs) {
      if (!c.alive) continue;
      seen.add(c.id);
      const view = this.crabView(c.id, c.color, c.name);
      this.updateDamageLabel(view, c);
      const moved = Math.hypot(c.x - view.lastX, c.y - view.lastY);
      if (moved > 0.002) view.walk += dt * (c.dashing ? 20 : 8);
      view.lastX = c.x;
      view.lastY = c.y;

      const swimming = depthAt(terrain, c.x, c.y, level) > 0;
      const bob = swimming ? Math.round(Math.sin(now / 180 + c.x) * 1) : 0;
      const px = Math.round(c.x * TILE);
      const py = Math.round(c.y * TILE);
      const sprite = view.sprite;
      sprite
        .setTexture(crabKey(c.color, Math.floor(view.walk) % 2))
        .setPosition(px, py + bob)
        .setFlipX(c.fx < -0.1)
        .setDepth(py);
      if (swimming) sprite.setCrop(0, 0, 16, 9);
      else sprite.setCrop();

      // Bote: estica na direção do movimento e deixa rastro.
      if (c.dashing) {
        const horizontal = Math.abs(c.fx) >= Math.abs(c.fy);
        sprite.setScale(horizontal ? 1.45 : 0.75, horizontal ? 0.72 : 1.4);
        if (now >= view.nextGhostAt) {
          view.nextGhostAt = now + 22;
          this.ghost(sprite);
        }
        if (!view.wasDashing && c.id !== this.deps.store.you) {
          this.dashStartFx(c.id, c.x, c.y, c.fx, c.fy);
        }
      } else if (view.wasDashing) {
        // Freada: achata e volta com elástico.
        sprite.setScale(0.8, 1.2);
        this.tweens.add({
          targets: sprite,
          scaleX: 1,
          scaleY: 1,
          duration: 160,
          ease: 'Back.easeOut',
        });
        this.puff(px - c.fx * 5, py + 4, 0xe3c27e, 4, 5);
      }
      view.wasDashing = c.dashing;

      // Levou bote: rodopia e pisca branco.
      if (now < view.spinUntil) sprite.setRotation(sprite.rotation + dt * 22);
      else sprite.setRotation(0);
      if (now < view.flashUntil) sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      else sprite.clearTint();
      sprite.setAlpha(1);

      const res = this.textResolution();
      if (view.labelResolution !== res) {
        view.label.setResolution(res);
        view.labelResolution = res;
      }
      view.label.setPosition(px, py - 11).setDepth(9_000);
      this.renderHeldWeapon(view, c, px, py + bob, now);
    }
    for (const [id, view] of this.crabViews) {
      if (seen.has(id)) continue;
      this.destroyCrabView(view);
      this.crabViews.delete(id);
    }
  }

  /**
   * Imagem que gira livremente (arma na mão, foguete). O arredondamento de vértices do
   * pixelArt ("safeAuto" no Phaser 4.2) corta sprites longos rotacionados pela diagonal,
   * então ele fica desligado só nelas.
   */
  private rotatingImage(key: string): Phaser.GameObjects.Image {
    const img = this.add.image(0, 0, key);
    img.vertexRoundMode = 'off';
    return img;
  }

  private destroyCrabView(view: CrabView): void {
    view.sprite.destroy();
    view.label.destroy();
    view.weapon?.destroy();
  }

  /**
   * Arma ao lado do caranguejo, apontando pra mira; dá coice a cada tiro.
   */
  private renderHeldWeapon(
    view: CrabView,
    c: CrabRender,
    px: number,
    py: number,
    now: number,
  ): void {
    if (view.weaponKind !== c.weapon) {
      view.weapon?.destroy();
      view.weapon = c.weapon ? this.rotatingImage(`weapon-${c.weapon}`) : null;
      view.weaponKind = c.weapon;
    }
    const img = view.weapon;
    if (!img || !c.weapon) return;
    const left = c.fx < -0.1;
    const grip = WEAPON_GRIP[c.weapon];
    const k = (now - view.swingAt) / SWING_MS;
    // Aponta pra mira (radianos, positivo = horário com y pra baixo).
    let angle = Math.atan2(c.fy, Math.abs(c.fx));
    // Coice: o cano sobe e volta.
    if (k >= 0 && k < 1) angle -= 0.6 * (1 - k);
    img
      .setOrigin(left ? 1 - grip.x : grip.x, grip.y)
      .setFlipX(left)
      .setRotation(left ? -angle : angle)
      .setPosition(px + (left ? -5 : 5), py - 2)
      .setDepth(view.sprite.depth + 1)
      .setScale(view.sprite.scaleY)
      .setAlpha(view.sprite.alpha);
  }

  /**
   * Texto pixelado de 8px ampliado pela câmera: renderizar na mesma escala do zoom
   * mapeia 1:1 com os pixels da tela, sem letras "comidas" pelo filtro nearest.
   */
  private textResolution(): number {
    return Math.max(1, Math.round(this.cameras.main.zoom));
  }

  /**
   * Seu dano acumulado ao lado do seu nome ("Teste 46%"): quanto mais alto, mais longe os
   * tiros te jogam. A cor esquenta de branco a vermelho.
   */
  private updateDamageLabel(view: CrabView, c: CrabRender): void {
    // Só o seu próprio dano aparece: o dos outros é segredo (ninguém sabe quem está "no ponto").
    const mine = c.id === this.deps.store.you;
    const shown = mine ? c.damage : 0;
    const text = shown > 0 ? `${c.name} ${shown}%` : c.name;
    if (view.label.text !== text) view.label.setText(text);
    const hot = Math.min(1, shown / DAMAGE.max);
    const base = mine ? [0xff, 0xe9, 0xa8] : [0xf4, 0xef, 0xe6];
    const rgb = base.map((v, i) => Math.round(v + ([0xff, 0x3b, 0x30][i]! - v) * hot));
    const color = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    if (view.label.style.color !== color) view.label.setColor(color);
  }

  private crabView(id: string, color: number, name: string): CrabView {
    let view = this.crabViews.get(id);
    if (view && view.color !== color) {
      this.destroyCrabView(view);
      view = undefined;
    }
    if (!view) {
      const isMe = id === this.deps.store.you;
      view = {
        sprite: this.add.image(0, 0, crabKey(color, 0)).setOrigin(0.5, 0.7),
        label: this.add
          .text(0, 0, name, {
            fontFamily: 'Silkscreen',
            fontSize: '8px',
            color: isMe ? '#ffe9a8' : '#f4efe6',
            stroke: '#2b1d14',
            strokeThickness: 2,
            resolution: this.textResolution(),
          })
          .setOrigin(0.5, 1),
        labelResolution: this.textResolution(),
        color,
        walk: 0,
        lastX: 0,
        lastY: 0,
        spinUntil: 0,
        flashUntil: 0,
        nextGhostAt: 0,
        wasDashing: false,
        weapon: null,
        weaponKind: null,
        swingAt: -Infinity,
      };
      this.crabViews.set(id, view);
    }
    return view;
  }

  /** Armas no chão: aparecem com um "pop", flutuam e brilham (o anel vem no overlay). */
  private renderWeaponItems(terrain: Terrain, level: number): void {
    const ids = new Set<number>();
    for (const w of this.deps.store.weapons) {
      ids.add(w.id);
      let img = this.weaponViews.get(w.id);
      if (!img) {
        const px = Math.round(w.x * TILE);
        const py = Math.round(w.y * TILE);
        img = this.add
          .image(px, py - 2, `weapon-${w.kind}`)
          .setRotation(-0.35)
          .setDepth(py - 6)
          .setScale(0);
        this.tweens.add({ targets: img, scale: 1, duration: 260, ease: 'Back.easeOut' });
        if (!settings.lowFx) {
          this.tweens.add({ targets: img, y: py - 5, duration: 700, yoyo: true, repeat: -1 });
        }
        this.weaponViews.set(w.id, img);
      }
      // Na água a arma boia balançando; nos últimos segundos pisca: o mar já vai levar.
      const floating = depthAt(terrain, w.x, w.y, level) > 0;
      const now = performance.now();
      const leaving = w.afloat > WEAPON_RULES.floatSeconds - 3 && Math.floor(now / 120) % 2 === 0;
      img
        .setRotation(
          floating && !settings.lowFx ? -0.35 + Math.sin(now / 300 + w.id) * 0.25 : -0.35,
        )
        .setAlpha(leaving ? 0.35 : 1);
    }
    for (const [id, img] of this.weaponViews) {
      if (ids.has(id)) continue;
      img.destroy();
      this.weaponViews.delete(id);
    }
  }

  /** A arma do chão que o R pegaria agora (a mesma regra do servidor). */
  private nearestWeapon(): { x: number; y: number; kind: WeaponKind } | null {
    const local = this.local;
    if (!local || this.deps.store.phase !== 'playing') return null;
    let best: { x: number; y: number; kind: WeaponKind } | null = null;
    let bestDist: number = WEAPON_RULES.pickupRadius;
    for (const w of this.deps.store.weapons) {
      const d = Math.hypot(w.x - local.body.x, w.y - local.body.y);
      if (d <= bestDist) {
        best = w;
        bestDist = d;
      }
    }
    return best;
  }

  private updatePrompt(): void {
    const near = this.nearestWeapon();
    if (!near) {
      this.prompt.setVisible(false);
      return;
    }
    const mine = this.deps.store.latest()?.crabs.get(this.deps.store.you)?.weapon;
    // Desarmado dá pra pegar com F ou clique; já armado, só F troca (o clique atira).
    const key = isTouch() ? '' : mine ? 'F: ' : 'F/clique: ';
    // O alcance da arma do chão aparece antes de pegar.
    const range = `${WEAPONS[near.kind].reach.toString().replace('.', ',')}`;
    const verb = mine ? 'trocar por' : 'pegar';
    const text = `${key}${verb} ${WEAPONS[near.kind].name} (alcance ${range})`;
    if (this.prompt.text !== text) this.prompt.setText(text);
    this.prompt
      .setResolution(this.textResolution())
      .setPosition(Math.round(near.x * TILE), Math.round(near.y * TILE) - 12)
      .setVisible(true);
  }

  // ------------------------------------------------------------------ efeitos

  private drainFx(): void {
    const { store } = this.deps;
    const queue = store.fxQueue.splice(0);
    for (const fx of queue) this.playFx(fx, store.you);
  }

  private playFx(fx: FxEvent, you: string): void {
    const { sfx } = this.deps;
    const x = fx.x * TILE;
    const y = fx.y * TILE;
    const involvesMe = fx.by === you || fx.target === you;
    switch (fx.kind) {
      case 'swing':
        // O próprio tiro já saiu na hora (predição); os dos outros, aqui.
        if (fx.by !== you && fx.by && fx.weapon) {
          this.startSwing(fx.by, fx.weapon, fx.dx ?? 1, fx.dy ?? 0, fx.value);
        }
        break;
      case 'hit': {
        const kind = fx.weapon ?? 'revolver';
        const words = HIT_WORDS[kind];
        const word = words[Math.floor(Math.random() * words.length)]!;
        if (kind === 'submetralhadora') {
          // Bala de rajada: acerto miúdo; a palavra só de vez em quando, senão vira poluição.
          this.puff(x, y, 0xfff2b0, 3, 6);
          if (Math.random() < 0.2) this.floatText(x, y - 10, word, '#fff2b0', 8);
        } else if (kind !== 'bazuca') {
          // Bazuca: a explosão ('boom') já é o efeito; aqui só o rodopio de quem voou.
          this.impact(x, y, involvesMe, word);
        }
        if (fx.target) {
          const victim = this.crabViews.get(fx.target);
          if (victim) {
            const now = performance.now();
            const spin = kind === 'bazuca' ? 650 : kind === 'espingarda' ? 520 : 280;
            victim.spinUntil = Math.max(victim.spinUntil, now + spin);
            victim.flashUntil = now + 60;
          }
        }
        if (kind !== 'bazuca') sfx.hit(kind);
        break;
      }
      case 'boom':
        this.explosion(x, y);
        break;
      case 'pickup':
        this.puff(x, y, 0xffe9a8, 8, 9);
        if (fx.weapon) this.floatText(x, y - 10, WEAPONS[fx.weapon].name, '#ffe9a8', 8);
        if (fx.by === you) sfx.pickup();
        break;
      case 'drop':
        this.puff(x, y + 3, 0xe3c27e, 5, 6);
        if (fx.by === you) sfx.drop();
        break;
      case 'break':
        // Acabou a munição: a arma é jogada fora.
        this.puff(x, y, 0x4a4f5a, 6, 8);
        this.floatText(x, y - 12, 'sem bala!', '#f4efe6', 8);
        if (fx.by === you) sfx.click();
        break;
      case 'drown':
        this.splash(x, y);
        this.floatText(x, y - 8, fx.target === you ? 'glub…' : 'glub', '#cfe9f2', 9);
        sfx.splash();
        break;
      case 'dash':
        // O próprio bote já foi desenhado na hora (predição); os dos outros, no render.
        if (fx.by !== you) sfx.dash();
        break;
    }
  }

  /** Tremor de câmera (some nos efeitos reduzidos). */
  private shake(duration: number, intensity: number): void {
    if (!settings.lowFx) this.cameras.main.shake(duration, intensity);
  }

  private dashStartFx(id: string, x: number, y: number, fx: number, fy: number): void {
    const px = x * TILE;
    const py = y * TILE;
    // Poeira levantada para trás.
    for (let i = 0; i < (settings.lowFx ? 2 : 7); i++) {
      const spread = (Math.random() - 0.5) * 1.4;
      const dx = -fx + -fy * spread;
      const dy = -fy + fx * spread;
      const p = this.add
        .rectangle(px, py + 3, Math.random() < 0.4 ? 2 : 1, 1, 0xe3c27e)
        .setDepth(py - 1);
      this.tweens.add({
        targets: p,
        x: px + dx * (6 + Math.random() * 6),
        y: py + 3 + dy * (6 + Math.random() * 6) - 2,
        alpha: 0,
        duration: 250 + Math.random() * 150,
        onComplete: () => p.destroy(),
      });
    }
    const view = this.crabViews.get(id);
    if (view) {
      // Antecipação: agacha antes de esticar.
      view.sprite.setScale(0.8, 1.2);
    }
    if (id === this.deps.store.you) {
      this.deps.sfx.dash();
      this.shake(70, 0.0025);
    }
  }

  /** Cópia translúcida do sprite que some: rastro de velocidade. */
  private ghost(sprite: Phaser.GameObjects.Image): void {
    if (settings.lowFx) return;
    const g = this.add
      .image(sprite.x, sprite.y, sprite.texture.key)
      .setOrigin(0.5, 0.7)
      .setFlipX(sprite.flipX)
      .setScale(sprite.scaleX, sprite.scaleY)
      .setTint(0xffffff)
      .setTintMode(Phaser.TintModes.FILL)
      .setAlpha(0.45)
      .setDepth(sprite.depth - 1);
    this.tweens.add({ targets: g, alpha: 0, duration: 180, onComplete: () => g.destroy() });
  }

  /**
   * Tiro saiu: coice da arma, fumaça e rastro. O tiro sai de onde o atirador está agora
   * e vai até `length` tiles (a bala para no primeiro que pegar).
   */
  private startSwing(id: string, kind: WeaponKind, fx: number, fy: number, length?: number): void {
    const view = this.crabViews.get(id);
    if (!view) return;
    view.swingAt = performance.now();
    const len = Math.hypot(fx, fy) || 1;
    const shot: Shot = {
      kind,
      x: view.lastX,
      y: view.lastY,
      fx: fx / len,
      fy: fy / len,
      length: length ?? WEAPONS[kind].reach,
      start: performance.now(),
    };
    const mx = (shot.x + shot.fx * 0.7) * TILE;
    const my = (shot.y + shot.fy * 0.7) * TILE;
    const heavy = kind === 'espingarda' || kind === 'bazuca';
    if (kind !== 'submetralhadora') this.puff(mx, my, 0xd8d2c4, heavy ? 10 : 5, 8); // fumaça
    if (kind === 'bazuca') {
      // Contrafogo: a bazuca cospe fumaça e fogo pra trás do ombro.
      const bx = (shot.x - shot.fx * 0.8) * TILE;
      const by = (shot.y - shot.fy * 0.8) * TILE;
      this.puff(bx, by, 0xf2a03a, 8, 10);
      this.puff(bx, by, 0xd8d2c4, 12, 16);
    }
    if (id === this.deps.store.you) {
      // Rebote sentido na câmera: as pesadas chacoalham bem mais.
      this.shake(heavy ? 150 : 50, heavy ? 0.008 : 0.002);
    }
    this.shots.push(shot);
    if (id === this.deps.store.you || this.isNear(id)) this.deps.sfx.swing(kind);
  }

  /** Som dos tiros alheios só quando dá pra ver: senão a briga do outro lado vira barulho. */
  private isNear(id: string): boolean {
    const view = this.crabViews.get(id);
    return view !== undefined && this.cameras.main.worldView.contains(view.sprite.x, view.sprite.y);
  }

  /** Foguetes em voo: posição do servidor, empurrada pra frente pelo tempo desde o snapshot. */
  /** Palpite local do foguete: mesma posição, direção e velocidade que o servidor vai usar. */
  private guessRocket(body: Body): void {
    const start = CRAB.radius + 0.35;
    this.guessedRockets.push({
      img: this.rotatingImage('rocket'),
      x: body.x + body.fx * start,
      y: body.y + body.fy * start,
      dx: body.fx,
      dy: body.fy,
      start: performance.now(),
      smokeAt: 0,
    });
  }

  private renderRockets(now: number, dt: number): void {
    const { store } = this.deps;
    const since = Math.min(0.15, (now - (store.latest()?.at ?? now)) / 1000);
    const ids = new Set<number>();
    for (const r of store.rockets) {
      ids.add(r.id);
      let view = this.rocketViews.get(r.id);
      if (!view) {
        // Foguete meu que eu já estava desenhando? Então o palpite vira este foguete,
        // e o errinho de posição (o tempo que o clique levou pra subir) some suave.
        const guess = r.owner === store.you ? this.guessedRockets.shift() : undefined;
        view = {
          img: guess?.img ?? this.rotatingImage('rocket'),
          smokeAt: guess?.smokeAt ?? 0,
          offX: guess ? guess.x - r.x : 0,
          offY: guess ? guess.y - r.y : 0,
        };
        this.rocketViews.set(r.id, view);
      }
      const fade = Math.exp(-dt / ROCKET_BLEND_SECONDS);
      view.offX *= fade;
      view.offY *= fade;
      const x = (r.x + view.offX + r.dx * WEAPON_RULES.rocketSpeed * since) * TILE;
      const y = (r.y + view.offY + r.dy * WEAPON_RULES.rocketSpeed * since) * TILE;
      view.img.setPosition(x, y).setRotation(Math.atan2(r.dy, r.dx)).setDepth(9_400);
      if (now >= view.smokeAt) {
        // Rastro de fumaça atrás do foguete.
        view.smokeAt = now + 35;
        this.puff(x - r.dx * 5, y - r.dy * 5, 0xd8d2c4, 2, 3);
      }
    }
    for (const [id, view] of this.rocketViews) {
      if (ids.has(id)) continue;
      view.img.destroy();
      this.rocketViews.delete(id);
    }
    this.renderGuessedRockets(now, dt);
  }

  /** Palpites ainda não confirmados: voam sozinhos e somem se o servidor não trouxer nada. */
  private renderGuessedRockets(now: number, dt: number): void {
    for (let i = this.guessedRockets.length - 1; i >= 0; i--) {
      const g = this.guessedRockets[i]!;
      if (now - g.start > ROCKET_GUESS_TIMEOUT_MS) {
        g.img.destroy();
        this.guessedRockets.splice(i, 1);
        continue;
      }
      g.x += g.dx * WEAPON_RULES.rocketSpeed * dt;
      g.y += g.dy * WEAPON_RULES.rocketSpeed * dt;
      const px = g.x * TILE;
      const py = g.y * TILE;
      g.img.setPosition(px, py).setRotation(Math.atan2(g.dy, g.dx)).setDepth(9_400);
      if (now >= g.smokeAt) {
        g.smokeAt = now + 35;
        this.puff(px - g.dx * 5, py - g.dy * 5, 0xd8d2c4, 2, 3);
      }
    }
  }

  private clearRockets(): void {
    for (const view of this.rocketViews.values()) view.img.destroy();
    this.rocketViews.clear();
    for (const g of this.guessedRockets) g.img.destroy();
    this.guessedRockets.length = 0;
  }

  /**
   * Os 9 blocos destruídos (o atingido e os 8 em volta): o contorno pisca e cada um
   * solta pedaços de terra que voam pra fora e caem. O buraco em si vem do servidor.
   */
  private blastBlocks(x: number, y: number): void {
    const cx = Math.floor(x / TILE);
    const cy = Math.floor(y / TILE);
    const outline = this.add.graphics().setDepth(9_550);
    outline
      .lineStyle(2, 0xfff2b0, 1)
      .strokeRect((cx - 1) * TILE, (cy - 1) * TILE, TILE * 3, TILE * 3);
    this.tweens.add({
      targets: outline,
      alpha: 0,
      duration: 350,
      onComplete: () => outline.destroy(),
    });
    const colors = [0x8a5a34, 0x6e4626, 0xe3c27e, 0x7b6a58];
    for (let ty = cy - 1; ty <= cy + 1; ty++) {
      for (let tx = cx - 1; tx <= cx + 1; tx++) {
        const bx = (tx + 0.5) * TILE;
        const by = (ty + 0.5) * TILE;
        // Pra fora do centro (o bloco do meio espalha pra todo lado).
        const out = Math.atan2(by - y, bx - x);
        for (let i = 0; i < (settings.lowFx ? 1 : 4); i++) {
          const size = Math.random() < 0.5 ? 3 : 2;
          const chunk = this.add
            .rectangle(bx, by, size, size, colors[(tx + ty + i) & 3]!)
            .setDepth(9_550);
          const a =
            tx === cx && ty === cy ? Math.random() * Math.PI * 2 : out + (Math.random() - 0.5);
          const dist = 6 + Math.random() * 12;
          const up = 10 + Math.random() * 10;
          const p = { t: 0 };
          this.tweens.add({
            targets: p,
            t: 1,
            duration: 450 + Math.random() * 250,
            onUpdate: () => {
              // Arco: sobe e cai enquanto se afasta.
              chunk.x = bx + Math.cos(a) * dist * p.t;
              chunk.y = by + Math.sin(a) * dist * p.t - up * 4 * p.t * (1 - p.t);
              chunk.rotation = p.t * 6;
              chunk.alpha = 1 - p.t * 0.7;
            },
            onComplete: () => chunk.destroy(),
          });
        }
      }
    }
  }

  /** Explosão do foguete: clarão, onda de choque, terra voando e fumaça. */
  private explosion(x: number, y: number): void {
    const flash = this.add.circle(x, y, 10, 0xfff2b0).setDepth(9_700);
    this.tweens.add({
      targets: flash,
      scale: 2.6,
      alpha: 0,
      duration: 220,
      onComplete: () => flash.destroy(),
    });
    const fire = this.add.circle(x, y, 8, 0xf2a03a).setDepth(9_650);
    this.tweens.add({
      targets: fire,
      scale: 2.2,
      alpha: 0,
      duration: 380,
      ease: 'Quad.easeOut',
      onComplete: () => fire.destroy(),
    });
    const radius = WEAPON_RULES.blastRadius * TILE;
    const ring = this.add.circle(x, y, radius).setStrokeStyle(2, 0xfff2b0).setDepth(9_600);
    ring.setScale(0.2);
    this.tweens.add({
      targets: ring,
      scale: 1,
      alpha: 0,
      duration: 320,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
    this.puff(x, y, 0x8a5a34, 16, radius);
    this.puff(x, y, 0xd8d2c4, 14, radius * 1.2);
    this.blastBlocks(x, y);
    // Tremor proporcional à distância de quem está assistindo.
    const me = this.local?.body;
    const near = me ? Math.hypot(me.x * TILE - x, me.y * TILE - y) < radius * 3 : false;
    this.shake(near ? 260 : 120, near ? 0.012 : 0.004);
    if (near || this.cameras.main.worldView.contains(x, y)) this.deps.sfx.boom();
  }

  private impact(x: number, y: number, involvesMe: boolean, word: string): void {
    // Estrela de impacto: raios que crescem e somem.
    const g = this.add.graphics({ x, y }).setDepth(9_700);
    g.lineStyle(2, 0xfff2b0, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
      const r1 = 3;
      const r2 = i % 2 === 0 ? 11 : 7;
      g.lineBetween(Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(a) * r2, Math.sin(a) * r2);
    }
    g.fillStyle(0xffffff, 1).fillCircle(0, 0, 3);
    g.setScale(0.4);
    this.tweens.add({
      targets: g,
      scale: 1.5,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => g.destroy(),
    });
    this.puff(x, y, 0xf4efe6, 10, 14);

    const t = this.add
      .text(x, y - 10, word, {
        fontFamily: 'Silkscreen',
        fontSize: '10px',
        color: '#fff2b0',
        stroke: '#2b1d14',
        strokeThickness: 3,
        resolution: this.textResolution(),
      })
      .setOrigin(0.5)
      .setDepth(9_800)
      .setScale(0.2)
      .setRotation((Math.random() - 0.5) * 0.4);
    this.tweens.chain({
      targets: t,
      tweens: [
        { scale: 1.3, duration: 90, ease: 'Back.easeOut' },
        { scale: 1, duration: 80 },
        { y: y - 20, alpha: 0, duration: 500, delay: 150 },
      ],
      onComplete: () => t.destroy(),
    });

    if (involvesMe) {
      this.shake(120, 0.005);
      this.hitStopUntil = performance.now() + 45;
    } else {
      this.shake(60, 0.0015);
    }
  }

  private splash(x: number, y: number): void {
    for (let i = 0; i < (settings.lowFx ? 1 : 2); i++) {
      const ring = this.add
        .ellipse(x, y + 2, 6, 3)
        .setStrokeStyle(1, 0xf4efe6)
        .setDepth(9_500);
      this.tweens.add({
        targets: ring,
        scaleX: 5,
        scaleY: 5,
        alpha: 0,
        delay: i * 150,
        duration: 600,
        onComplete: () => ring.destroy(),
      });
    }
    // Gotas que sobem e caem.
    for (let i = 0; i < (settings.lowFx ? 3 : 10); i++) {
      const d = this.add.rectangle(x, y, 1, 2, 0xcfe9f2).setDepth(9_600);
      const vx = (Math.random() - 0.5) * 22;
      const h = 8 + Math.random() * 10;
      const progress = { t: 0 };
      this.tweens.add({
        targets: progress,
        t: 1,
        duration: 450 + Math.random() * 150,
        onUpdate: () => {
          d.x = x + vx * progress.t;
          d.y = y - h * 4 * progress.t * (1 - progress.t);
          d.alpha = 1 - progress.t * 0.6;
        },
        onComplete: () => d.destroy(),
      });
    }
    this.bubbles(x, y);
  }

  private puff(x: number, y: number, color: number, count: number, spread: number): void {
    const n = settings.lowFx ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i++) {
      const size = Math.random() < 0.3 ? 2 : 1;
      const p = this.add.rectangle(x, y, size, size, color).setDepth(9_500);
      const angle = Math.random() * Math.PI * 2;
      const dist = spread * (0.4 + Math.random() * 0.6);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist - 2,
        alpha: 0,
        duration: 260 + Math.random() * 200,
        onComplete: () => p.destroy(),
      });
    }
  }

  private bubbles(x: number, y: number): void {
    if (settings.lowFx) return;
    for (let i = 0; i < 6; i++) {
      const b = this.add
        .circle(x + (Math.random() - 0.5) * 8, y, 1 + Math.random() * 1.5)
        .setStrokeStyle(1, 0xf4efe6)
        .setDepth(9_500);
      this.tweens.add({
        targets: b,
        y: y - 10 - Math.random() * 10,
        alpha: 0,
        delay: 100 + i * 70,
        duration: 600,
        onComplete: () => b.destroy(),
      });
    }
  }

  private floatText(x: number, y: number, text: string, color: string, size = 8): void {
    const t = this.add
      .text(x, y, text, {
        fontFamily: 'Silkscreen',
        fontSize: `${size}px`,
        color,
        stroke: '#2b1d14',
        strokeThickness: 2,
        resolution: this.textResolution(),
      })
      .setOrigin(0.5)
      .setDepth(9_800);
    this.tweens.add({
      targets: t,
      y: y - 14,
      alpha: 0,
      duration: 850,
      ease: 'Quad.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  // ------------------------------------------------------------------ overlay

  private drawOverlay(crabs: CrabRender[], terrain: Terrain, level: number): void {
    const g = this.overlay;
    g.clear();
    const now = performance.now();
    const { store } = this.deps;

    // Anel sob as armas do chão: dá pra achar de longe; a mais perto de você pulsa.
    const near = this.nearestWeapon();
    for (const w of store.weapons) {
      const px = Math.round(w.x * TILE);
      const py = Math.round(w.y * TILE);
      const isNear = near !== null && near.x === w.x && near.y === w.y;
      const pulse = 0.5 + 0.3 * Math.sin(now / 220 + w.id);
      if (depthAt(terrain, w.x, w.y, level) > 0) {
        // Boiando: ondinha em volta, como a de quem está nadando.
        const r = 9 + (settings.lowFx ? 0 : Math.sin(now / 200 + w.id) * 1.5);
        g.lineStyle(1, 0xf4efe6, 0.8).strokeEllipse(px, py + 2, r * 2, r * 0.8);
      }
      g.lineStyle(1, WEAPONS[w.kind].color, isNear ? 1 : pulse);
      g.strokeEllipse(px, py + 4, isNear ? 20 : 16, isNear ? 8 : 6);
    }

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i]!;
      const t = (now - shot.start) / SHOT_MS;
      if (t >= 1) this.shots.splice(i, 1);
      else this.drawShot(g, shot, t);
    }

    for (const c of crabs) {
      if (!c.alive) continue;
      const px = Math.round(c.x * TILE);
      const py = Math.round(c.y * TILE);
      const swimming = depthAt(terrain, c.x, c.y, level) > 0;
      if (swimming) {
        // Ondinha em volta de quem está nadando.
        g.lineStyle(1, 0xf4efe6, 0.8);
        const r = 7 + (settings.lowFx ? 0 : Math.sin(now / 200 + c.x));
        g.strokeEllipse(px, py + 2, r * 2, r * 0.8);
      } else {
        // Sombra no chão: "gruda" o caranguejo no terreno.
        g.fillStyle(0x2b1d14, 0.25).fillEllipse(px, py + 4, 13, 4);
      }
      if (c.dashing) {
        // Linhas de velocidade atrás do bote.
        g.lineStyle(1, 0xffffff, 0.7);
        for (let i = -1; i <= 1; i++) {
          const ox = -c.fy * i * 4;
          const oy = c.fx * i * 4;
          const len = 8 + (i === 0 ? 6 : 0);
          g.lineBetween(
            px - c.fx * 8 + ox,
            py - c.fy * 8 + oy,
            px - c.fx * (8 + len) + ox,
            py - c.fy * (8 + len) + oy,
          );
        }
      }
      if (c.breath < 0.99) {
        const w = 14;
        g.fillStyle(0x2b1d14, 1).fillRect(px - w / 2 - 1, py - 22, w + 2, 4);
        const color = c.breath > 0.5 ? 0x7cc4cc : c.breath > 0.25 ? 0xf2c14e : 0xd9573b;
        g.fillStyle(color, 1).fillRect(px - w / 2, py - 21, Math.ceil(w * c.breath), 2);
      }
      if (c.stunned) {
        const a = now / 90;
        g.fillStyle(0xf2c14e, 1);
        g.fillRect(px + Math.cos(a) * 5, py - 14 + Math.sin(a) * 2, 2, 2);
        g.fillRect(px - Math.cos(a) * 5, py - 14 - Math.sin(a) * 2, 2, 2);
      }
    }

    const me = this.local;
    if (!me || store.phase !== 'playing') return;
    const px = Math.round(me.body.x * TILE);
    const py = Math.round(me.body.y * TILE);

    // Anel de recarga do bote sob o seu caranguejo.
    const ready = 1 - me.dashCooldown / CRAB.dashCooldown;
    if (ready < 1) {
      g.lineStyle(1, 0x2b1d14, 0.5);
      g.strokeEllipse(px, py + 4, 18, 8);
      g.lineStyle(2, 0xffe9a8, 0.9);
      g.beginPath();
      g.arc(px, py + 4, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ready);
      g.strokePath();
    }

    const weapon = store.latest()?.crabs.get(store.you)?.weapon;
    if (weapon) this.drawAimGuide(g, me, weapon, now);
  }

  /**
   * "Laser" da arma na mão: mostra até onde o tiro chega, na direção da mira.
   * Linha reta (revólver, submetralhadora) que para no primeiro alvo; cone (espingarda);
   * linha com o raio da explosão no fim (bazuca). Mais forte quando a arma está pronta.
   */
  private drawAimGuide(
    g: Phaser.GameObjects.Graphics,
    me: LocalCrab,
    weapon: WeaponKind,
    now: number,
  ): void {
    const spec = WEAPONS[weapon];
    const body = me.body;
    const ox = body.x * TILE;
    const oy = body.y * TILE;
    const dx = body.fx;
    const dy = body.fy;
    const muzzle = 0.7 * TILE;
    const sx = ox + dx * muzzle;
    const sy = oy + dy * muzzle;
    const ready = me.attackCooldown <= 0;
    const alpha = ready ? 0.85 + 0.15 * Math.sin(now / 150) : 0.4;
    const others = this.lastCrabs.filter((c) => c.alive && c.id !== this.deps.store.you);

    if (spec.style === 'spread') {
      // Cone do leque de chumbo.
      const base = Math.atan2(dy, dx);
      const half = spec.arc / 2;
      const r = (spec.reach + CRAB.radius) * TILE;
      g.fillStyle(LASER_COLOR, alpha * 0.22);
      g.beginPath();
      g.moveTo(sx, sy);
      g.arc(ox, oy, r, base - half, base + half);
      g.closePath();
      g.fillPath();
      for (const [width, color, a] of LASER_STROKES) {
        g.lineStyle(width, color, a * alpha);
        g.lineBetween(sx, sy, ox + Math.cos(base - half) * r, oy + Math.sin(base - half) * r);
        g.lineBetween(sx, sy, ox + Math.cos(base + half) * r, oy + Math.sin(base + half) * r);
        g.beginPath();
        g.arc(ox, oy, r, base - half, base + half);
        g.strokePath();
      }
      return;
    }

    // Linha: até o fim do alcance, ou até o primeiro alvo (bala) / contato (foguete).
    let length: number = spec.reach;
    if (spec.style === 'rocket') {
      const hit = WEAPON_RULES.rocketHitRadius + CRAB.radius;
      for (const c of others) {
        const along = (c.x - body.x) * dx + (c.y - body.y) * dy;
        const across = Math.abs((c.x - body.x) * dy - (c.y - body.y) * dx);
        if (along > 0 && along < length && across <= hit) length = along;
      }
    } else {
      length = this.shotLength(weapon, body, others);
    }
    const ex = ox + dx * length * TILE;
    const ey = oy + dy * length * TILE;
    // Tracejado: dá noção de distância (um traço por meio tile).
    const total = Math.hypot(ex - sx, ey - sy);
    const dash = TILE / 2;
    for (const [width, color, a] of LASER_STROKES) {
      g.lineStyle(width, color, a * alpha);
      for (let d = 0; d < total; d += dash * 2) {
        const t0 = d / total;
        const t1 = Math.min(1, (d + dash) / total);
        g.lineBetween(
          sx + (ex - sx) * t0,
          sy + (ey - sy) * t0,
          sx + (ex - sx) * t1,
          sy + (ey - sy) * t1,
        );
      }
    }
    g.fillStyle(0x2b1d14, alpha).fillCircle(ex, ey, 3);
    g.fillStyle(LASER_COLOR, 1).fillCircle(ex, ey, 2);
    if (spec.style === 'rocket') {
      for (const [width, color, a] of LASER_STROKES) {
        g.lineStyle(width, color, a * alpha);
        g.strokeCircle(ex, ey, WEAPON_RULES.blastRadius * TILE);
      }
    }
  }

  /** Tiro: clarão no cano e rastro da bala (revólver) ou do leque de chumbo (espingarda). */
  private drawShot(g: Phaser.GameObjects.Graphics, shot: Shot, t: number): void {
    const spec = WEAPONS[shot.kind];
    const ox = shot.x * TILE;
    const oy = shot.y * TILE;
    const muzzle = 0.7 * TILE;
    const mx = ox + shot.fx * muzzle;
    const my = oy + shot.fy * muzzle;
    const alpha = 1 - t;
    if (t < 0.4) {
      const flash = 1 - t / 0.4;
      g.fillStyle(0xf2a03a, flash).fillCircle(mx, my, 3 + 5 * flash);
      g.fillStyle(0xfff2b0, flash).fillCircle(mx, my, 2 + 3 * flash);
    }
    const base = Math.atan2(shot.fy, shot.fx);
    // Bazuca: só o clarão; o foguete em si vem do servidor e voa sozinho.
    if (spec.style === 'rocket') return;
    if (spec.style === 'bullet' || spec.style === 'burst') {
      const end = shot.length * TILE;
      const burst = spec.style === 'burst';
      g.lineStyle(burst ? 2 : 3, 0x2b1d14, alpha * 0.5);
      g.lineBetween(mx, my, ox + shot.fx * end, oy + shot.fy * end);
      g.lineStyle(burst ? 1 : 2, spec.color, alpha);
      g.lineBetween(mx, my, ox + shot.fx * end, oy + shot.fy * end);
      return;
    }
    // Chumbo: bolinhas que se espalham pelo leque, deixando um risco fraco.
    const travel = Math.min(1, t * 2) * shot.length * TILE;
    for (let i = 0; i < 7; i++) {
      const a = base + (i / 6 - 0.5) * spec.arc;
      const d = travel * (0.85 + (0.15 * ((i * 37) % 7)) / 6);
      const px = ox + Math.cos(a) * d;
      const py = oy + Math.sin(a) * d;
      g.lineStyle(1, spec.color, alpha * 0.8);
      g.lineBetween(mx, my, px, py);
      g.fillStyle(0x2b1d14, alpha).fillRect(px - 2, py - 2, 4, 4);
      g.fillStyle(0xfff2b0, alpha).fillRect(px - 1, py - 1, 2, 2);
    }
  }

  // ------------------------------------------------------------------ câmera

  /** Botões ◀ ▶ da tela (celular/tablet): troca quem a câmera acompanha. */
  spectateStep(step: number): void {
    this.spectateRequest += step;
  }

  private gameplayZoom(): number {
    const { width, height } = this.scale;
    const z = Math.floor(Math.min(width / (22 * TILE), height / (14 * TILE)));
    return Math.max(1.5, Math.min(5, z));
  }

  private fitZoom(terrain: Terrain, cover: boolean): number {
    const { width, height } = this.scale;
    const zx = width / (terrain.width * TILE);
    const zy = height / (terrain.height * TILE);
    return cover ? Math.max(zx, zy) : Math.min(zx, zy) * 0.95;
  }

  private updateCamera(crabs: CrabRender[], terrain: Terrain, dt: number): void {
    const camera = this.cameras.main;
    const { store } = this.deps;
    const mapW = terrain.width * TILE;
    const mapH = terrain.height * TILE;

    if (store.phase === 'countdown') {
      // Contagem: mostra o mapa inteiro para todo mundo planejar.
      camera.setZoom(this.fitZoom(terrain, false));
      camera.centerOn(mapW / 2, mapH / 2);
      this.cam.ready = false;
      return;
    }

    // Os pedidos de troca se acumulam o tempo todo; só valem pra quem já caiu.
    const step = this.deps.input.consumeSpectate() + this.spectateRequest;
    this.spectateRequest = 0;
    let target = crabs.find((c) => c.id === store.you && c.alive);
    this.spectatingName = null;
    if (!target) {
      const alive = crabs.filter((c) => c.alive);
      let i = alive.findIndex((c) => c.id === this.spectateId);
      if (step !== 0 && alive.length > 0) {
        i = i < 0 ? 0 : (((i + step) % alive.length) + alive.length) % alive.length;
      }
      target = alive[Math.max(0, i)];
      this.spectateId = target?.id ?? null;
      if (target && store.phase === 'playing') this.spectatingName = target.name;
    }
    const zoom = this.gameplayZoom();
    if (camera.zoom !== zoom)
      camera.setZoom(Phaser.Math.Linear(camera.zoom, zoom, Math.min(1, dt * 5)));
    if (Math.abs(camera.zoom - zoom) < 0.01) camera.setZoom(zoom);

    if (target) {
      const tx = target.x * TILE;
      const ty = target.y * TILE;
      if (!this.cam.ready) {
        this.cam.x = mapW / 2;
        this.cam.y = mapH / 2;
        this.cam.ready = true;
      }
      const k = Math.min(1, dt * 6);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }
    const halfW = this.scale.width / 2 / camera.zoom;
    const halfH = this.scale.height / 2 / camera.zoom;
    const cx = mapW > halfW * 2 ? Phaser.Math.Clamp(this.cam.x, halfW, mapW - halfW) : mapW / 2;
    const cy = mapH > halfH * 2 ? Phaser.Math.Clamp(this.cam.y, halfH, mapH - halfH) : mapH / 2;
    camera.centerOn(Math.round(cx), Math.round(cy));
  }

  // ------------------------------------------------------------------ demo (menu)

  private setupDemo(): void {
    const rng = createRng(7);
    const t = this.demo.terrain;
    for (let i = 0; i < 5; i++) {
      let x = 0;
      let y = 0;
      for (let tries = 0; tries < 200; tries++) {
        x = Math.floor(rng() * t.width) + 0.5;
        y = Math.floor(rng() * t.height) + 0.5;
        if (heightAt(t, Math.floor(x), Math.floor(y)) >= 5) break;
      }
      this.demo.crabs.push({
        body: createBody(x, y),
        dir: { dx: 0, dy: 0 },
        until: 0,
        color: CRAB_COLORS[i % CRAB_COLORS.length]!,
      });
    }
  }

  private clearDemoCrabs(): void {
    for (const [id, view] of this.crabViews) {
      if (!id.startsWith('demo')) continue;
      this.destroyCrabView(view);
      this.crabViews.delete(id);
    }
  }

  private updateDemo(dt: number): void {
    const demo = this.demo;
    demo.time += dt;
    // Água do menu: sobe e desce devagar, nunca afoga a ilha.
    const level = 1.6 + 1.2 * (0.5 - 0.5 * Math.cos(demo.time / 4));
    this.drawTerrain(demo.terrain, level, -1, 'morro');
    this.local = null;
    this.seenRoundId = -1;

    const crabs: CrabRender[] = demo.crabs.map((c, i) => {
      if (demo.time > c.until) {
        const angle = Math.random() * Math.PI * 2;
        const stop = Math.random() < 0.35;
        c.dir = stop ? { dx: 0, dy: 0 } : { dx: Math.cos(angle) * 0.5, dy: Math.sin(angle) * 0.5 };
        c.until = demo.time + 0.6 + Math.random() * 1.6;
        // De vez em quando um bote, só para exibir.
        if (!stop && Math.random() < 0.2) c.body.dashT = CRAB.dashSeconds * 0.6;
      }
      const prev = { x: c.body.x, y: c.body.y };
      stepBody(c.body, c.dir, demo.terrain, level, dt);
      // Caranguejo de menu não entra na água.
      if (depthAt(demo.terrain, c.body.x, c.body.y, level + 0.6) > 0) {
        c.body.x = prev.x;
        c.body.y = prev.y;
        c.body.dashT = 0;
        c.until = 0;
      }
      return {
        id: `demo${i}`,
        x: c.body.x,
        y: c.body.y,
        fx: c.body.fx,
        fy: c.body.fy,
        alive: true,
        breath: 1,
        dashing: c.body.dashT > 0,
        stunned: false,
        // Os caranguejos do menu já desfilam com as armas.
        weapon: WEAPON_KINDS[i % WEAPON_KINDS.length]!,
        damage: 0,
        color: c.color,
        name: '',
      };
    });
    // Remove caranguejos de partida que sobraram.
    for (const [id, view] of this.crabViews) {
      if (id.startsWith('demo')) continue;
      this.destroyCrabView(view);
      this.crabViews.delete(id);
    }
    for (const v of this.weaponViews.values()) v.destroy();
    this.weaponViews.clear();
    this.clearRockets();
    this.prompt.setVisible(false);
    this.renderCrabs(crabs, demo.terrain, level, dt);
    this.overlay.clear();

    const camera = this.cameras.main;
    const t = demo.terrain;
    camera.setZoom(Math.max(1, this.fitZoom(t, true) * 1.4));
    const halfW = this.scale.width / 2 / camera.zoom;
    const halfH = this.scale.height / 2 / camera.zoom;
    const mapW = t.width * TILE;
    const mapH = t.height * TILE;
    const cx = mapW / 2 + Math.sin(demo.time / 9) * Math.max(0, mapW / 2 - halfW);
    const cy = mapH / 2 + Math.cos(demo.time / 13) * Math.max(0, mapH / 2 - halfH);
    camera.centerOn(Math.round(cx), Math.round(cy));
  }
}
