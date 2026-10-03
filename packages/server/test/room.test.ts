import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, type ServerMessage } from '@caranguejada/shared';
import { Room, SOLO_BOTS, type Peer } from '../src/game/Room';
import { silentLogger } from '../src/logger';

class FakePeer implements Peer {
  messages: ServerMessage[] = [];
  closed = false;
  send(data: string) {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }
  close() {
    this.closed = true;
  }
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    return this.messages.filter((m) => m.t === t).at(-1) as Extract<ServerMessage, { t: T }>;
  }
}

function join(room: Room, name = 'Zé') {
  const peer = new FakePeer();
  const res = room.addHuman(peer, name);
  if ('error' in res) throw new Error(res.error);
  return { peer, id: res.id };
}

describe('Room', () => {
  it('o primeiro a entrar vira host', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    const b = join(room);
    const players = b.peer.last('room')!.players;
    expect(players.find((p) => p.id === a.id)!.host).toBe(true);
    expect(players.find((p) => p.id === b.id)!.host).toBe(false);
  });

  it('passa o host adiante quando o host sai', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    const b = join(room);
    room.removeMember(a.id);
    expect(b.peer.last('room')!.players[0]).toMatchObject({ id: b.id, host: true });
  });

  it('só o host inicia e precisa de 2 caranguejos', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    room.handleMessage(a.id, { t: 'start' });
    expect(a.peer.last('error')!.code).toBe('not_enough_players');

    const b = join(room);
    room.handleMessage(b.id, { t: 'start' });
    expect(b.peer.last('error')!.code).toBe('not_host');

    room.handleMessage(a.id, { t: 'start' });
    expect(room.currentPhase).toBe('countdown');
    expect(b.peer.last('round')!.round).toBe(1);
  });

  it('modo solo começa direto com bots', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    room.startSolo(a.id);
    expect(room.size).toBe(1 + SOLO_BOTS);
    expect(room.currentPhase).toBe('countdown');
  });

  it('humano tira o lugar de um bot quando a sala lota', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    for (let i = 0; i < MAX_PLAYERS; i++) room.handleMessage(a.id, { t: 'addBot' });
    expect(room.size).toBe(MAX_PLAYERS);
    join(room);
    expect(room.size).toBe(MAX_PLAYERS);
    expect(room.humanCount).toBe(2);
  });

  it('roda uma partida inteira de bots até o fim', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    room.startSolo(a.id);
    // O humano fica parado; os bots e a maré decidem a partida.
    for (let i = 0; i < 30 * 60 * 10 && room.currentPhase !== 'matchEnd'; i++) {
      room.tick(1 / 30);
    }
    expect(room.currentPhase).toBe('matchEnd');
    const ranking = a.peer.last('matchEnd')!.ranking;
    expect(ranking).toHaveLength(1 + SOLO_BOTS);
    expect(ranking[0]!.score).toBeGreaterThanOrEqual(ranking.at(-1)!.score);
  });

  it('host escolhe a quantidade de rodadas no lobby; outros não', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    const b = join(room);
    room.handleMessage(b.id, { t: 'setRounds', rounds: 7 });
    expect(b.peer.last('error')!.code).toBe('not_host');
    expect(a.peer.last('room')!.totalRounds).toBe(3);

    room.handleMessage(a.id, { t: 'setRounds', rounds: 5 });
    expect(b.peer.last('room')!.totalRounds).toBe(5);

    room.setRounds(4); // fora das opções: ignorado
    expect(b.peer.last('room')!.totalRounds).toBe(5);
  });

  it('não muda a quantidade de rodadas no meio da partida', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    room.startSolo(a.id);
    room.handleMessage(a.id, { t: 'setRounds', rounds: 7 });
    expect(a.peer.last('room')!.totalRounds).toBe(3);
  });

  it('cada rodada dá no máximo uma estrela, e a partida respeita o total escolhido', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    room.handleMessage(a.id, { t: 'setRounds', rounds: 5 });
    room.startSolo(a.id);
    const rounds = new Set<number>();
    for (let i = 0; i < 30 * 60 * 10 && room.currentPhase !== 'matchEnd'; i++) {
      room.tick(1 / 30);
      const r = a.peer.last('roundEnd');
      if (r) rounds.add(r.round);
    }
    expect(room.currentPhase).toBe('matchEnd');
    expect([...rounds].sort()).toEqual([1, 2, 3, 4, 5]);

    const winners = a.peer.messages.filter((m) => m.t === 'roundEnd' && m.winner).length;
    const ranking = a.peer.last('matchEnd')!.ranking;
    expect(ranking.reduce((sum, r) => sum + r.stars, 0)).toBe(winners);

    // Depois do resultado dá pra trocar e jogar de novo sem sair da sala; estrelas zeram.
    room.handleMessage(a.id, { t: 'setRounds', rounds: 1 });
    room.handleMessage(a.id, { t: 'start' });
    const fresh = a.peer.last('room')!;
    expect(fresh.totalRounds).toBe(1);
    expect(fresh.players.every((p) => p.stars === 0)).toBe(true);
  });

  it('sorteia mapas de rodada a rodada sem repetir o anterior', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    room.handleMessage(a.id, { t: 'setRounds', rounds: 7 });
    room.startSolo(a.id);
    for (let i = 0; i < 30 * 60 * 12 && room.currentPhase !== 'matchEnd'; i++) room.tick(1 / 30);
    const maps = a.peer.messages.flatMap((m) => (m.t === 'round' ? [m.map] : []));
    expect(maps).toHaveLength(7);
    for (let i = 1; i < maps.length; i++) expect(maps[i]).not.toBe(maps[i - 1]);
    expect(new Set(maps).size).toBeGreaterThan(2);
  });

  it('sorteia só entre os mapas escolhidos pelo anfitrião', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    const b = join(room);
    room.handleMessage(b.id, { t: 'setMaps', maps: ['porto'] });
    expect(b.peer.last('error')!.code).toBe('not_host');
    expect(a.peer.last('room')!.maps).toHaveLength(11);

    room.handleMessage(a.id, { t: 'setMaps', maps: ['atol', 'porto'] });
    expect(b.peer.last('room')!.maps).toEqual(['atol', 'porto']);
    room.removeMember(b.id);

    room.handleMessage(a.id, { t: 'setRounds', rounds: 5 });
    room.startSolo(a.id);
    for (let i = 0; i < 30 * 60 * 10 && room.currentPhase !== 'matchEnd'; i++) room.tick(1 / 30);
    const maps = a.peer.messages.flatMap((m) => (m.t === 'round' ? [m.map] : []));
    expect(maps).toHaveLength(5);
    // Dois mapas, sem repetir em seguida: alterna.
    for (let i = 1; i < maps.length; i++) expect(maps[i]).not.toBe(maps[i - 1]);
    expect(new Set(maps)).toEqual(new Set(['atol', 'porto']));
  });

  it('com um mapa só, todas as rodadas usam ele', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    room.setMaps(['castelo']);
    room.startSolo(a.id);
    for (let i = 0; i < 30 * 60 * 6 && room.currentPhase !== 'matchEnd'; i++) room.tick(1 / 30);
    const maps = a.peer.messages.flatMap((m) => (m.t === 'round' ? [m.map] : []));
    expect(maps).toEqual(['castelo', 'castelo', 'castelo']);
  });

  it('ignora seleção vazia ou inválida (mantém a anterior)', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    room.setMaps(['recife']);
    room.setMaps([]);
    room.setMaps(['lua' as never]);
    expect(a.peer.last('room')!.maps).toEqual(['recife']);
  });

  it('jogador que entra no meio da partida assiste até a próxima rodada', () => {
    const room = new Room('BCDF', silentLogger);
    const a = join(room);
    room.startSolo(a.id);
    const late = join(room);
    expect(late.peer.last('round')).toBeDefined();
    const me = late.peer.last('room')!.players.find((p) => p.id === late.id)!;
    expect(me.spectating).toBe(true);
  });
});
