import { NAME_MAX_LENGTH, isValidRoundCount } from './constants';
import { normalizeMapPool, type MapKind } from './terrain';
import type { WeaponKind } from './weapons';

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
  /** Dano acumulado na rodada (%): quanto maior, mais longe os acertos jogam. */
  damage: number;
  dashing: boolean;
  stunned: boolean;
  /** Arma na mão (null = desarmado: só anda e dá dash). */
  weapon: WeaponKind | null;
  /** Golpes que a arma ainda aguenta. */
  uses: number;
  /** Último input processado deste jogador (para reconciliação no cliente). */
  ack: number;
  /** Segundos de simulação desde que esse input começou a valer. */
  ackAge: number;
}

/** Foguete da bazuca em voo. */
export interface RocketSnapshot {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Quem atirou: o cliente usa pra casar o foguete com o palpite que já desenhou. */
  owner: string;
  /** Quanto falta pra ele explodir (tiles): o cliente não desenha o foguete passando do ponto. */
  rem: number;
}

export interface WeaponItemSnapshot {
  id: number;
  x: number;
  y: number;
  kind: WeaponKind;
  uses: number;
  /** Há quanto tempo está boiando (s); o mar leva em WEAPON_RULES.floatSeconds. */
  afloat: number;
}

/**
 * - swing: tiro disparado (`value` = até onde a bala/o chumbo foi, em tiles);
 * - hit: o tiro/explosão pegou alguém;
 * - boom: o foguete da bazuca explodiu;
 * - pickup / drop / break: arma pegada, largada ou quebrada (de fogo: acabou a munição).
 */
export type FxKind = 'swing' | 'hit' | 'boom' | 'pickup' | 'drop' | 'break' | 'drown' | 'dash';

export interface FxEvent {
  kind: FxKind;
  x: number;
  y: number;
  /** Quem causou o evento. */
  by?: string;
  /** Quem sofreu o evento. */
  target?: string;
  value?: number;
  /** Arma envolvida (tiro, acerto, afogamento creditado...). */
  weapon?: WeaponKind;
  /** Direção do tiro. */
  dx?: number;
  dy?: number;
}

/** Depois do fim de uma rodada: a próxima normal, uma extra de desempate, ou o fim. */
export type RoundNext = 'round' | 'tiebreak' | 'matchEnd';

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
      /** Armas caídas no chão. */
      weapons: WeaponItemSnapshot[];
      /** Foguetes da bazuca em voo. */
      rockets: RocketSnapshot[];
      /** Tiles alterados desde o último snapshot: [índice, altura]. */
      tiles: [number, number][];
      fx: FxEvent[];
    }
  | {
      t: 'roundEnd';
      /** null: empate (afundaram juntos) ou o tempo acabou com mais de um de pé. */
      winner: string | null;
      round: number;
      /** O que vem depois: outra rodada, rodada extra de desempate ou o resultado final. */
      next: RoundNext;
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
  /** Mira (vetor unitário) de quem joga com mouse ou toque; ausente = bot/teclado puro. */
  fx?: number;
  fy?: number;
  /** A mira vem do mouse (precisa): o servidor não "puxa" o tiro pra perto de alguém. */
  mouse?: boolean;
  /**
   * Distância (tiles) do caranguejo até o ponto mirado. A bazuca explode ali (dentro dos
   * limites, ver `rocketRange`); ausente = alcance inteiro.
   */
  ad?: number;
  /**
   * Tempo de simulação (s) que o jogador estava vendo quando mandou o input: os outros
   * são desenhados ~110ms no passado. O servidor volta os alvos a esse instante pra
   * decidir o tiro (compensação de lag), em vez de testar contra onde eles estão agora.
   */
  vt?: number;
  /** Toque (Shift/Espaço): dispara um dash. Só desloca: não empurra ninguém. */
  dash: boolean;
  /** Toque (clique): tiro com a arma na mão. Desarmado, pega a arma do chão. */
  attack: boolean;
  /** Toque (F): pega a arma do chão, larga a da mão ou troca uma pela outra. */
  grab: boolean;
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
      const out: InputMessage = {
        t: 'input',
        seq: Math.max(0, Math.floor(msg.seq)),
        dx: clampUnit(msg.dx),
        dy: clampUnit(msg.dy),
        dash: msg.dash === true,
        attack: msg.attack === true,
        grab: msg.grab === true,
      };
      // Mira: só vale se vier completa e finita (o servidor normaliza).
      if (isFiniteNumber(msg.fx) && isFiniteNumber(msg.fy)) {
        out.fx = clampUnit(msg.fx);
        out.fy = clampUnit(msg.fy);
        if (msg.mouse === true) out.mouse = true;
        // Distância da mira: o servidor ainda limita ao alcance; aqui só barra lixo.
        if (isFiniteNumber(msg.ad) && msg.ad >= 0) out.ad = Math.min(100, msg.ad);
      }
      if (isFiniteNumber(msg.vt) && msg.vt >= 0) out.vt = msg.vt;
      return out;
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
