import { NAME_MAX_LENGTH, isValidRoundCount } from './constants';
import { normalizeMapPool, type MapKind } from './terrain';

/**
 * Protocolo JSON sobre WebSocket. A sala é escolhida na URL de conexão
 * (/ws?sala=ABCD&modo=criar|entrar|solo[&rodadas=3]) para que um ingress possa rotear
 * todos os jogadores da mesma sala para o mesmo pod.
 */

export type JoinMode = 'criar' | 'entrar' | 'solo';
export const JOIN_MODES: readonly JoinMode[] = ['criar', 'entrar', 'solo'];

export type Phase = 'lobby' | 'countdown' | 'playing' | 'roundEnd' | 'matchEnd';

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  bot: boolean;
  score: number;
  /** Rodadas vencidas nesta partida. */
  stars: number;
  host: boolean;
  /** Entrou no meio de uma rodada e está assistindo. */
  spectating: boolean;
}

export interface CrabSnapshot {
  id: string;
  x: number;
  y: number;
  fx: number;
  fy: number;
  alive: boolean;
  /** Fôlego 0..1 */
  breath: number;
  dashing: boolean;
  stunned: boolean;
  /** Último input processado deste jogador (para reconciliação no cliente). */
  ack: number;
  /** Segundos de simulação desde que esse input começou a valer. */
  ackAge: number;
}

export interface ShellSnapshot {
  id: number;
  x: number;
  y: number;
  gold: boolean;
}

export type FxKind = 'shove' | 'drown' | 'shell' | 'dash';

export interface FxEvent {
  kind: FxKind;
  x: number;
  y: number;
  /** Quem causou o evento. */
  by?: string;
  /** Quem sofreu o evento. */
  target?: string;
  value?: number;
}

export type ErrorCode =
  | 'room_not_found'
  | 'room_exists'
  | 'room_full'
  | 'server_full'
  | 'bad_request'
  | 'not_host'
  | 'not_enough_players'
  | 'shutting_down';

export type ServerMessage =
  | { t: 'welcome'; you: string; code: string }
  | {
      t: 'room';
      phase: Phase;
      players: PlayerInfo[];
      round: number;
      totalRounds: number;
      /** Mapas que podem ser sorteados (todos, ou a seleção do anfitrião). */
      maps: MapKind[];
    }
  | {
      t: 'round';
      round: number;
      seed: number;
      /** Geografia sorteada para esta rodada. */
      map: MapKind;
      heights: string;
      countdown: number;
    }
  | {
      t: 'snap';
      /** Tempo da rodada (s) — a maré é função dele. */
      time: number;
      crabs: CrabSnapshot[];
      shells: ShellSnapshot[];
      /** Tiles alterados desde o último snapshot: [índice, altura]. */
      tiles: [number, number][];
      fx: FxEvent[];
    }
  | {
      t: 'roundEnd';
      winner: string | null;
      round: number;
      /** Os últimos afundaram juntos e o desempate foi pelos pontos da rodada. */
      byPoints: boolean;
    }
  | {
      t: 'matchEnd';
      ranking: { id: string; name: string; score: number; stars: number; color: number }[];
    }
  | { t: 'pong'; at: number }
  | { t: 'error'; code: ErrorCode; message: string };

export interface InputMessage {
  t: 'input';
  seq: number;
  dx: number;
  dy: number;
  /** Toque: dispara um dash (que também empurra quem estiver no caminho). */
  dash: boolean;
}

export type ClientMessage =
  | { t: 'hello'; name: string }
  | InputMessage
  | { t: 'start' }
  | { t: 'addBot' }
  | { t: 'removeBot' }
  | { t: 'setRounds'; rounds: number }
  | { t: 'setMaps'; maps: MapKind[] }
  | { t: 'ping'; at: number };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/** Remove caracteres de controle e limita o tamanho; nome vazio vira "Siri". */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Siri';
  const cleaned = raw
    .normalize('NFC')
    .replace(/[\p{C}<>]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : 'Siri';
}

/**
 * Valida qualquer coisa vinda da rede. Nunca confie no cliente:
 * mensagens inválidas retornam null e são descartadas.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Record<string, unknown>;

  switch (msg.t) {
    case 'hello':
      return { t: 'hello', name: sanitizeName(msg.name) };
    case 'input': {
      if (!isFiniteNumber(msg.seq) || !isFiniteNumber(msg.dx) || !isFiniteNumber(msg.dy)) {
        return null;
      }
      return {
        t: 'input',
        seq: Math.max(0, Math.floor(msg.seq)),
        dx: clampUnit(msg.dx),
        dy: clampUnit(msg.dy),
        dash: msg.dash === true,
      };
    }
    case 'start':
    case 'addBot':
    case 'removeBot':
      return { t: msg.t };
    case 'setRounds':
      return isValidRoundCount(msg.rounds) ? { t: 'setRounds', rounds: msg.rounds } : null;
    case 'setMaps': {
      const maps = normalizeMapPool(msg.maps);
      return maps ? { t: 'setMaps', maps } : null;
    }
    case 'ping':
      return isFiniteNumber(msg.at) ? { t: 'ping', at: msg.at } : null;
    default:
      return null;
  }
}
