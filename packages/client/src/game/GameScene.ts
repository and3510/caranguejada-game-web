import Phaser from 'phaser';
import {
  CLIENT_INPUT_RATE,
  CRAB,
  CRAB_COLORS,
  createBody,
  createRng,
  depthAt,
  heightAt,
  stepBody,
  tideLevel,
  type Body,
  type CrabSnapshot,
  type FxEvent,
  type InputMessage,
  type MapKind,
  type Terrain,
} from '@caranguejada/shared';
import { attractTerrain, type Store } from '../state';
import type { Sfx } from './audio';
import type { InputController } from './input';
import {
  CRAB_FRAMES,
  GOLD_SHELL_PALETTE,
  SHELL_ART,
  SHELL_PALETTE,
  crabCanvas,
  pixelArtCanvas,
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
}

interface LocalCrab {
  body: Body;
  dashCooldown: number;
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
  color: number;
  name: string;
}

/** Atraso de interpolação: ~2 snapshots, absorve jitter de rede. */
const INTERP_DELAY_MS = 110;
const SEND_INTERVAL = 1 / CLIENT_INPUT_RATE;
const MIN_SEND_INTERVAL = 1 / 30;
const SHOVE_WORDS = ['PÁ!', 'TUM!', 'POF!', 'CRAU!', 'TOMA!'];

const crabKey = (color: number, frame: number) => `crab-${color.toString(16)}-${frame}`;

export class GameScene extends Phaser.Scene {
  private terrainRenderer!: TerrainRenderer;
  private terrainTexture!: Phaser.Textures.CanvasTexture;
  private overlay!: Phaser.GameObjects.Graphics;
  private readonly crabViews = new Map<string, CrabView>();
  private readonly shellViews = new Map<number, Phaser.GameObjects.Image>();

  private local: LocalCrab | null = null;
  private seenRoundId = -1;
  private seenSnapshotAt = 0;
  private cam = { x: 0, y: 0, ready: false };
  private spectateId: string | null = null;
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
    this.textures.addCanvas('shell', pixelArtCanvas(SHELL_ART, SHELL_PALETTE));
    this.textures.addCanvas('shell-gold', pixelArtCanvas(SHELL_ART, GOLD_SHELL_PALETTE));

    const { width, height } = this.demo.terrain;
    this.terrainRenderer = new TerrainRenderer(width, height);
    this.terrainTexture = this.textures.addCanvas('terrain', this.terrainRenderer.canvas)!;
    this.add.image(0, 0, 'terrain').setOrigin(0).setDepth(-1000);
    this.overlay = this.add.graphics().setDepth(10_000);

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
    this.renderCrabs(crabs, terrain, level, dt);
    this.renderShells();
    this.drawOverlay(crabs, terrain, level);
    this.updateCamera(crabs, terrain, dt);

    if (now >= this.land.nextAt) {
      this.land.nextAt = now + 250;
      this.land.current = this.countLand(terrain, level) / this.land.initial;
    }
    const dashReady = this.local ? 1 - this.local.dashCooldown / CRAB.dashCooldown : 1;
    this.deps.onFrame({ level, roundTime, dashReady, land: this.land.current });
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
    for (const v of this.shellViews.values()) v.destroy();
    this.shellViews.clear();
    this.clearDemoCrabs();
  }

  private countLand(terrain: Terrain, level: number): number {
    let n = 0;
    for (const h of terrain.heights) if (h >= level) n++;
    return n;
  }

  private drawTerrain(terrain: Terrain, level: number, version: number, kind: MapKind): void {
    const frame = Math.floor(performance.now() / 450) % 2;
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
        seq: 0,
        sendTimer: 0,
        sentAt: new Map(),
        history: [],
      };
    }
    const local = this.local;
    const dir = input.direction();
    const actions = input.peekActions();

    local.dashCooldown = Math.max(0, local.dashCooldown - dt);
    if (actions.dash && local.dashCooldown <= 0 && local.body.stunT <= 0) {
      const len = Math.hypot(dir.dx, dir.dy);
      if (len > 0.01) {
        local.body.fx = dir.dx / len;
        local.body.fy = dir.dy / len;
      }
      local.body.dashT = CRAB.dashSeconds;
      local.dashCooldown = CRAB.dashCooldown;
      // Efeito na hora, sem esperar o servidor: o bote tem que "sair da mão".
      this.dashStartFx(store.you, local.body.x, local.body.y, local.body.fx, local.body.fy);
    }
    stepBody(local.body, dir, terrain, level, dt);

    const now = performance.now();
    local.history.push({ t: now, x: local.body.x, y: local.body.y });
    while (local.history.length > 0 && now - local.history[0]!.t > 1500) local.history.shift();

    local.sendTimer += dt;
    if (
      local.sendTimer >= SEND_INTERVAL ||
      (actions.dash && local.sendTimer >= MIN_SEND_INTERVAL)
    ) {
      local.sendTimer = 0;
      const sent = input.consumeActions();
      local.seq++;
      local.sentAt.set(local.seq, now);
      send({ t: 'input', seq: local.seq, dx: dir.dx, dy: dir.dy, ...sent });
    }
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
    const renderAt = now - INTERP_DELAY_MS;
    let a = snaps[0]!;
    let b = snaps.at(-1)!;
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1]!.at <= renderAt) {
        a = snaps[i - 1]!;
        b = snaps[i]!;
        break;
      }
    }
    const k = b.at === a.at ? 1 : Math.max(0, Math.min(1, (renderAt - a.at) / (b.at - a.at)));

    const out: CrabRender[] = [];
    for (const cb of b.crabs.values()) {
      const ca = a.crabs.get(cb.id) ?? cb;
      const info = store.player(cb.id);
      const latest = store.latest()!.crabs.get(cb.id) ?? cb;
      const render: CrabRender = {
        id: cb.id,
        x: ca.x + (cb.x - ca.x) * k,
        y: ca.y + (cb.y - ca.y) * k,
        fx: cb.fx,
        fy: cb.fy,
        alive: latest.alive,
        breath: latest.breath,
        dashing: cb.dashing,
        stunned: latest.stunned,
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
    }
    for (const [id, view] of this.crabViews) {
      if (seen.has(id)) continue;
      view.sprite.destroy();
      view.label.destroy();
      this.crabViews.delete(id);
    }
  }

  /**
   * Texto pixelado de 8px ampliado pela câmera: renderizar na mesma escala do zoom
   * mapeia 1:1 com os pixels da tela, sem letras "comidas" pelo filtro nearest.
   */
  private textResolution(): number {
    return Math.max(1, Math.round(this.cameras.main.zoom));
  }

  private crabView(id: string, color: number, name: string): CrabView {
    let view = this.crabViews.get(id);
    if (view && view.color !== color) {
      view.sprite.destroy();
      view.label.destroy();
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
      };
      this.crabViews.set(id, view);
    }
    if (view.label.text !== name) view.label.setText(name);
    return view;
  }

  private renderShells(): void {
    const { shells } = this.deps.store;
    const ids = new Set<number>();
    for (const s of shells) {
      ids.add(s.id);
      if (this.shellViews.has(s.id)) continue;
      const img = this.add
        .image(Math.round(s.x * TILE), Math.round(s.y * TILE), s.gold ? 'shell-gold' : 'shell')
        .setDepth(Math.round(s.y * TILE) - 8);
      this.tweens.add({ targets: img, y: img.y - 2, duration: 600, yoyo: true, repeat: -1 });
      this.shellViews.set(s.id, img);
    }
    for (const [id, img] of this.shellViews) {
      if (ids.has(id)) continue;
      img.destroy();
      this.shellViews.delete(id);
    }
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
      case 'shove':
        this.impact(x, y, involvesMe);
        if (fx.target) {
          const victim = this.crabViews.get(fx.target);
          if (victim) {
            const now = performance.now();
            victim.spinUntil = now + 280;
            victim.flashUntil = now + 60;
          }
        }
        sfx.shove();
        break;
      case 'drown':
        this.splash(x, y);
        this.floatText(x, y - 8, fx.target === you ? 'glub…' : 'glub', '#cfe9f2', 9);
        sfx.splash();
        break;
      case 'shell': {
        const value = fx.value ?? 1;
        this.puff(x, y, value > 1 ? 0xf2c14e : 0xfbe7d3, 6, 6);
        this.floatText(
          x,
          y - 8,
          `+${value}`,
          value > 1 ? '#f2c14e' : '#fbe7d3',
          value > 1 ? 10 : 8,
        );
        if (fx.by === you) sfx.shell(value > 1);
        break;
      }
      case 'dash':
        // O próprio bote já foi desenhado na hora (predição); os dos outros, no render.
        if (fx.by !== you) sfx.dash();
        break;
    }
  }

  private dashStartFx(id: string, x: number, y: number, fx: number, fy: number): void {
    const px = x * TILE;
    const py = y * TILE;
    // Poeira levantada para trás.
    for (let i = 0; i < 7; i++) {
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
      this.cameras.main.shake(70, 0.0025);
    }
  }

  /** Cópia translúcida do sprite que some: rastro de velocidade. */
  private ghost(sprite: Phaser.GameObjects.Image): void {
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

  private impact(x: number, y: number, involvesMe: boolean): void {
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

    const word = SHOVE_WORDS[Math.floor(Math.random() * SHOVE_WORDS.length)]!;
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
      this.cameras.main.shake(120, 0.005);
      this.hitStopUntil = performance.now() + 45;
    } else {
      this.cameras.main.shake(60, 0.0015);
    }
  }

  private splash(x: number, y: number): void {
    for (let i = 0; i < 2; i++) {
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
    for (let i = 0; i < 10; i++) {
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
    for (let i = 0; i < count; i++) {
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

    for (const c of crabs) {
      if (!c.alive) continue;
      const px = Math.round(c.x * TILE);
      const py = Math.round(c.y * TILE);
      const swimming = depthAt(terrain, c.x, c.y, level) > 0;
      if (swimming) {
        // Ondinha em volta de quem está nadando.
        g.lineStyle(1, 0xf4efe6, 0.8);
        const r = 7 + Math.sin(now / 200 + c.x) * 1;
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
  }

  // ------------------------------------------------------------------ câmera

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

    let target = crabs.find((c) => c.id === store.you && c.alive);
    if (!target) {
      const alive = crabs.filter((c) => c.alive);
      target = alive.find((c) => c.id === this.spectateId) ?? alive[0];
      this.spectateId = target?.id ?? null;
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
      view.sprite.destroy();
      view.label.destroy();
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

    for (const v of this.shellViews.values()) v.destroy();
    this.shellViews.clear();

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
        color: c.color,
        name: '',
      };
    });
    // Remove caranguejos de partida que sobraram.
    for (const [id, view] of this.crabViews) {
      if (id.startsWith('demo')) continue;
      view.sprite.destroy();
      view.label.destroy();
      this.crabViews.delete(id);
    }
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
