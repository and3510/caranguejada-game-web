import {
  COUNTDOWN_SECONDS,
  CRAB_COLORS,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  ROUND_END_SECONDS,
  DEFAULT_ROUNDS,
  SCORE,
  SNAPSHOT_RATE,
  isValidRoundCount,
  normalizeMapPool,
  createRng,
  MAP_KINDS,
  encodeHeights,
  generateTerrain,
  type ClientMessage,
  type ErrorCode,
  type FxEvent,
  type MapKind,
  type Phase,
  type PlayerInfo,
  type Rng,
  type ServerMessage,
} from '@caranguejada/shared';
import type { Logger } from '../logger';
import { Bot, botName } from './Bot';
import { Simulation } from './Simulation';

/** Abstração da conexão: a sala não conhece WebSocket, o que facilita testes. */
export interface Peer {
  send(data: string): void;
  close(code: number, reason: string): void;
}

interface Member {
  id: string;
  name: string;
  color: number;
  score: number;
  /** Rodadas vencidas nesta partida. */
  stars: number;
  peer: Peer | null;
  bot: Bot | null;
  spectating: boolean;
}

export const SOLO_BOTS = 3;

export class Room {
  private readonly members = new Map<string, Member>();
  private hostId: string | null = null;
  private phase: Phase = 'lobby';
  private round = 0;
  private totalRounds = DEFAULT_ROUNDS;
  private mapKind: MapKind = 'morro';
  /** Mapas sorteáveis nesta sala. */
  private mapPool: MapKind[] = [...MAP_KINDS];
  private sim: Simulation | null = null;
  private phaseTimer = 0;
  private snapshotTimer = 0;
  private pendingFx: FxEvent[] = [];
  private nextId = 1;
  private botsCreated = 0;

  constructor(
    readonly code: string,
    private readonly log: Logger,
    private readonly rng: Rng = Math.random,
  ) {}

  get humanCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.peer) n++;
    return n;
  }

  get size(): number {
    return this.members.size;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  isEmpty(): boolean {
    return this.humanCount === 0;
  }

  addHuman(peer: Peer, name: string): { id: string } | { error: ErrorCode } {
    if (this.members.size >= MAX_PLAYERS) {
      // Sala cheia de bots? Um humano tem prioridade sobre um bot.
      if (!this.dropOneBot()) return { error: 'room_full' };
    }
    const id = `p${this.nextId++}`;
    const inMatch = this.phase !== 'lobby' && this.phase !== 'matchEnd';
    this.members.set(id, {
      id,
      name,
      color: this.freeColor(),
      score: 0,
      stars: 0,
      peer,
      bot: null,
      spectating: inMatch,
    });
    this.hostId ??= id;
    this.sendTo(id, { t: 'welcome', you: id, code: this.code });
    if (this.sim) {
      this.sendTo(id, {
        t: 'round',
        round: this.round,
        seed: this.sim.seed,
        map: this.mapKind,
        heights: encodeHeights(this.sim.terrain.heights),
        countdown: this.phase === 'countdown' ? this.phaseTimer : 0,
      });
    }
    this.broadcastRoom();
    this.log.info('player_joined', { room: this.code, player: id });
    return { id };
  }

  removeMember(id: string): void {
    const member = this.members.get(id);
    if (!member) return;
    this.members.delete(id);
    this.sim?.removeCrab(id);
    if (this.hostId === id) {
      this.hostId = [...this.members.values()].find((m) => m.peer)?.id ?? null;
    }
    this.broadcastRoom();
    this.log.info('player_left', { room: this.code, player: id });
  }

  handleMessage(id: string, msg: ClientMessage): void {
    const member = this.members.get(id);
    if (!member) return;
    switch (msg.t) {
      case 'hello':
        member.name = msg.name;
        this.broadcastRoom();
        break;
      case 'input':
        if (this.phase === 'playing') this.sim?.setInput(id, msg);
        break;
      case 'ping':
        this.sendTo(id, { t: 'pong', at: msg.at });
        break;
      case 'addBot':
        if (this.requireHost(id) && this.canEditRoster()) this.addBot();
        break;
      case 'removeBot':
        if (this.requireHost(id) && this.canEditRoster()) this.dropOneBot();
        break;
      case 'start':
        if (this.requireHost(id)) this.startMatch(id);
        break;
      case 'setRounds':
        if (this.requireHost(id) && this.canEditRoster()) this.setRounds(msg.rounds);
        break;
      case 'setMaps':
        if (this.requireHost(id) && this.canEditRoster()) this.setMaps(msg.maps);
        break;
    }
  }

  /** Quantidade de rodadas da próxima partida (só no lobby / após o resultado). */
  /** Mapas sorteáveis da próxima partida (só no lobby / após o resultado). */
  setMaps(maps: readonly MapKind[]): void {
    const pool = normalizeMapPool(maps);
    if (!pool) return;
    this.mapPool = pool;
    this.broadcastRoom();
  }

  setRounds(rounds: number): void {
    if (!isValidRoundCount(rounds) || rounds === this.totalRounds) return;
    this.totalRounds = rounds;
    this.broadcastRoom();
  }

  /** Modo solo: o jogador começa direto contra bots. */
  startSolo(hostId: string): void {
    for (let i = 0; i < SOLO_BOTS; i++) this.addBot();
    this.startMatch(hostId);
  }

  private requireHost(id: string): boolean {
    if (id === this.hostId) return true;
    this.sendTo(id, {
      t: 'error',
      code: 'not_host',
      message: 'Só quem criou a sala pode fazer isso.',
    });
    return false;
  }

  private canEditRoster(): boolean {
    return this.phase === 'lobby' || this.phase === 'matchEnd';
  }

  private addBot(): boolean {
    if (this.members.size >= MAX_PLAYERS) return false;
    const id = `b${this.nextId++}`;
    const seed = Math.floor(this.rng() * 2 ** 32);
    this.members.set(id, {
      id,
      name: botName(this.botsCreated++),
      color: this.freeColor(),
      score: 0,
      stars: 0,
      peer: null,
      bot: new Bot(id, createRng(seed)),
      spectating: false,
    });
    this.broadcastRoom();
    return true;
  }

  private dropOneBot(): boolean {
    const bot = [...this.members.values()].reverse().find((m) => m.bot);
    if (!bot) return false;
    this.members.delete(bot.id);
    this.sim?.removeCrab(bot.id);
    this.broadcastRoom();
    return true;
  }

  private freeColor(): number {
    const used = new Set([...this.members.values()].map((m) => m.color));
    return CRAB_COLORS.find((c) => !used.has(c)) ?? CRAB_COLORS[0];
  }

  private startMatch(byId: string): void {
    if (this.phase !== 'lobby' && this.phase !== 'matchEnd') return;
    if (this.members.size < MIN_PLAYERS_TO_START) {
      this.sendTo(byId, {
        t: 'error',
        code: 'not_enough_players',
        message: 'Precisa de pelo menos 2 caranguejos. Chame alguém ou adicione um bot.',
      });
      return;
    }
    for (const m of this.members.values()) {
      m.score = 0;
      m.stars = 0;
    }
    this.log.info('match_started', { room: this.code, players: this.members.size });
    this.startRound(1);
  }

  private startRound(round: number): void {
    this.round = round;
    for (const m of this.members.values()) m.spectating = false;
    const seed = Math.floor(this.rng() * 2 ** 32);
    this.mapKind = this.pickMap();
    this.sim = new Simulation(seed, [...this.members.keys()], generateTerrain(seed, this.mapKind));
    this.phase = 'countdown';
    this.phaseTimer = COUNTDOWN_SECONDS;
    this.snapshotTimer = 0;
    this.pendingFx = [];
    this.broadcast({
      t: 'round',
      round,
      seed,
      map: this.mapKind,
      heights: encodeHeights(this.sim.terrain.heights),
      countdown: COUNTDOWN_SECONDS,
    });
    this.broadcastRoom();
  }

  /** Mapa aleatório a cada rodada, sem repetir o da rodada anterior. */
  /** Sorteia entre os mapas escolhidos; com 2 ou mais, nunca repete o da rodada anterior. */
  private pickMap(): MapKind {
    const pool = this.mapPool;
    const options =
      pool.length > 1 && this.round > 1 ? pool.filter((k) => k !== this.mapKind) : pool;
    return options[Math.floor(this.rng() * options.length)] ?? pool[0] ?? 'morro';
  }

  tick(dt: number): void {
    switch (this.phase) {
      case 'lobby':
      case 'matchEnd':
        return;
      case 'countdown':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.phase = 'playing';
          this.broadcastRoom();
        }
        break;
      case 'playing':
        this.stepPlaying(dt);
        break;
      case 'roundEnd':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          if (this.round < this.totalRounds) this.startRound(this.round + 1);
          else this.endMatch();
          return;
        }
        break;
    }
    this.snapshotTimer -= dt;
    if (this.snapshotTimer <= 0) {
      this.snapshotTimer += 1 / SNAPSHOT_RATE;
      this.broadcastSnapshot();
    }
  }

  private stepPlaying(dt: number): void {
    const sim = this.sim;
    if (!sim) return;
    for (const m of this.members.values()) {
      if (!m.bot) continue;
      const input = m.bot.update(sim, dt);
      if (input) sim.setInput(m.id, input);
    }
    const result = sim.step(dt);
    for (const s of result.scores) {
      const m = this.members.get(s.playerId);
      if (m) m.score += s.points;
    }
    this.pendingFx.push(...result.fx);
    if (result.scores.length > 0) this.broadcastRoom();

    if (sim.isOver()) {
      const { winner, byPoints } = sim.roundResult();
      const wm = winner ? this.members.get(winner) : undefined;
      if (wm) {
        wm.score += SCORE.lastStanding;
        wm.stars++;
      }
      this.phase = 'roundEnd';
      this.phaseTimer = ROUND_END_SECONDS;
      this.broadcastSnapshot();
      // Placar/estrelas primeiro: o cliente monta o pop-up da rodada já atualizado.
      this.broadcastRoom();
      this.broadcast({
        t: 'roundEnd',
        winner: wm ? wm.id : null,
        round: this.round,
        byPoints: wm ? byPoints : false,
      });
    }
  }

  private endMatch(): void {
    this.phase = 'matchEnd';
    this.sim = null;
    const ranking = [...this.members.values()]
      .sort((a, b) => b.score - a.score || b.stars - a.stars)
      .map((m) => ({ id: m.id, name: m.name, score: m.score, stars: m.stars, color: m.color }));
    this.broadcast({ t: 'matchEnd', ranking });
    this.broadcastRoom();
    this.log.info('match_ended', { room: this.code, winner: ranking[0]?.id });
  }

  private broadcastSnapshot(): void {
    const sim = this.sim;
    if (!sim) return;
    this.broadcast({
      t: 'snap',
      time: Math.round(sim.time * 1000) / 1000,
      crabs: sim.crabSnapshots(),
      shells: sim.shellSnapshots(),
      tiles: sim.drainDirtyTiles(),
      fx: this.pendingFx,
    });
    this.pendingFx = [];
  }

  playerInfos(): PlayerInfo[] {
    return [...this.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      bot: m.bot !== null,
      score: m.score,
      stars: m.stars,
      host: m.id === this.hostId,
      spectating: m.spectating,
    }));
  }

  private broadcastRoom(): void {
    this.broadcast({
      t: 'room',
      phase: this.phase,
      players: this.playerInfos(),
      round: this.round,
      totalRounds: this.totalRounds,
      maps: this.mapPool,
    });
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) m.peer?.send(data);
  }

  private sendTo(id: string, msg: ServerMessage): void {
    this.members.get(id)?.peer?.send(JSON.stringify(msg));
  }

  closeAll(code: number, reason: string): void {
    const data = JSON.stringify({ t: 'error', code: 'shutting_down', message: reason });
    for (const m of this.members.values()) {
      m.peer?.send(data);
      m.peer?.close(code, 'shutting_down');
    }
  }
}
