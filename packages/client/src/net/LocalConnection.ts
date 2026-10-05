import {
  TICK_RATE,
  parseClientMessage,
  type ClientMessage,
  type MapKind,
  type ServerMessage,
} from '@caranguejada/shared';
import { Room, type Logger, type Peer } from '@caranguejada/server/sim';
import type { CloseInfo, GameConnection } from './Connection';

type Handlers = {
  [K in ServerMessage['t']]?: (msg: Extract<ServerMessage, { t: K }>) => void;
};

const SILENT: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const STEP = 1 / TICK_RATE;
/** Aba em segundo plano: em vez de acelerar o jogo pra "recuperar", joga o atraso fora. */
const MAX_CATCHUP_SECONDS = 0.25;

/**
 * Modo solo: o mesmo servidor autoritativo (`Room`) roda aqui dentro, na sua máquina.
 * Não há rede, então não há latência nem correção de posição — a mira responde na hora.
 * As regras são exatamente as do multijogador: é a mesma classe, e os inputs passam pela
 * mesma validação (`parseClientMessage`) antes de chegar na sala.
 */
export class LocalConnection implements GameConnection {
  private readonly handlers: Handlers = {};
  private readonly room: Room;
  private readonly you: string;
  private readonly outbox: ServerMessage[] = [];
  private flushQueued = false;
  private timer = 0;
  private lastAt = 0;
  private carry = 0;
  onClose: (info: CloseInfo) => void = () => {};

  constructor(
    code: string,
    name: string,
    setup: { rounds?: number; maps?: readonly MapKind[] } = {},
  ) {
    const peer: Peer = {
      send: (data: string) => this.queue(JSON.parse(data) as ServerMessage),
      close: () => {},
    };
    this.room = new Room(code, SILENT);
    if (setup.rounds !== undefined) this.room.setRounds(setup.rounds);
    if (setup.maps && setup.maps.length > 0) this.room.setMaps(setup.maps);
    const joined = this.room.addHuman(peer, name);
    if ('error' in joined) {
      // Sala recém-criada só pra esta aba: não tem como estar cheia.
      throw new Error(joined.error);
    }
    this.you = joined.id;
    this.room.startSolo(this.you);

    this.lastAt = performance.now();
    this.timer = window.setInterval(() => this.step(), 1000 / TICK_RATE);
  }

  on<K extends ServerMessage['t']>(type: K, fn: (msg: Extract<ServerMessage, { t: K }>) => void) {
    (this.handlers as Record<string, unknown>)[type] = fn;
    return this;
  }

  send(msg: ClientMessage): void {
    // Mesmo caminho do servidor de verdade: valida e normaliza igual (limites de mira etc.).
    const parsed = parseClientMessage(JSON.stringify(msg));
    if (parsed) this.room.handleMessage(this.you, parsed);
  }

  close(): void {
    this.onClose = () => {};
    window.clearInterval(this.timer);
    this.room.removeMember(this.you);
  }

  /** Passo fixo com acúmulo: a simulação anda igual mesmo se o timer do navegador atrasar. */
  private step(): void {
    const now = performance.now();
    this.carry += Math.min(MAX_CATCHUP_SECONDS, (now - this.lastAt) / 1000);
    this.lastAt = now;
    while (this.carry >= STEP) {
      this.carry -= STEP;
      this.room.tick(STEP);
    }
  }

  /**
   * As mensagens saem num microtask, não no meio do tick: quem chama o construtor ainda
   * está registrando os handlers (o `welcome` sai lá dentro), igualzinho ao WebSocket.
   */
  private queue(msg: ServerMessage): void {
    this.outbox.push(msg);
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      for (const m of this.outbox.splice(0)) {
        (this.handlers[m.t] as ((x: ServerMessage) => void) | undefined)?.(m);
      }
    });
  }
}
