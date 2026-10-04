import { describe, expect, it } from 'vitest';
import {
  MAX_PLAYERS,
  MAX_TIEBREAK_ROUNDS,
  createRng,
  heightAt,
  type ServerMessage,
} from '@caranguejada/shared';
import { Room, SOLO_BOTS, type Peer } from '../src/game/Room';
import type { Simulation } from '../src/game/Simulation';
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

/** A simulação da rodada em andamento (privada na sala; os testes de desempate mexem nela). */
const simOf = (room: Room) => (room as unknown as { sim: Simulation }).sim;

function tickUntil(room: Room, done: () => boolean, maxSeconds = 120) {
  for (let i = 0; i < maxSeconds * 30 && !done(); i++) room.tick(1 / 30);
  if (!done()) throw new Error('não aconteceu a tempo');
}

/** Coloca o caranguejo no meio de um tile. */
function put(sim: Simulation, id: string, tx: number, ty: number) {
  const crab = sim.crabs.get(id)!;
  crab.x = tx + 0.5;
  crab.y = ty + 0.5;
}

/**
 * Quantas rodadas a partida teve: as combinadas e, se houve empate nas estrelas,
 * as extras de desempate (até o teto).
 */
function expectRounds(rounds: unknown[], combined: number) {
  expect(rounds.length).toBeGreaterThanOrEqual(combined);
  expect(rounds.length).toBeLessThanOrEqual(combined + MAX_TIEBREAK_ROUNDS);
}

/** O tile mais alto do mapa: quem fica ali é o último a afundar. */
function highest(sim: Simulation) {
  let best = { tx: 0, ty: 0, h: -1 };
  for (let ty = 0; ty < sim.terrain.height; ty++) {
    for (let tx = 0; tx < sim.terrain.width; tx++) {
      const h = heightAt(sim.terrain, tx, ty);
      if (h > best.h) best = { tx, ty, h };
    }
  }
  return best;
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
    // O ranking final é por estrelas (os pontos só desempatam a tabela).
    expect(ranking[0]!.stars).toBeGreaterThanOrEqual(ranking.at(-1)!.stars);
  });

  it('empate na rodada: ninguém leva a estrela', () => {
    const room = new Room('BCDF', silentLogger, createRng(1));
    const a = join(room, 'A');
    const b = join(room, 'B');
    room.handleMessage(a.id, { t: 'setRounds', rounds: 3 });
    room.handleMessage(a.id, { t: 'setMaps', maps: ['morro'] });
    room.handleMessage(a.id, { t: 'start' });
    const sim = simOf(room);
    // Os dois no mar aberto, à mesma profundidade: afundam no mesmo instante.
    expect(heightAt(sim.terrain, 0, 0)).toBe(0);
    expect(heightAt(sim.terrain, sim.terrain.width - 1, sim.terrain.height - 1)).toBe(0);
    put(sim, a.id, 0, 0);
    put(sim, b.id, sim.terrain.width - 1, sim.terrain.height - 1);
    tickUntil(room, () => a.peer.last('roundEnd') !== undefined);
    expect(a.peer.last('roundEnd')).toMatchObject({ winner: null, round: 1, next: 'round' });
    expect(a.peer.last('room')!.players.every((p) => p.stars === 0)).toBe(true);
  });

  it('empate nas estrelas no fim: rodada extra de desempate até alguém ficar na frente', () => {
    const room = new Room('BCDF', silentLogger, createRng(1));
    const a = join(room, 'A');
    const b = join(room, 'B');
    room.handleMessage(a.id, { t: 'setRounds', rounds: 1 });
    room.handleMessage(a.id, { t: 'setMaps', maps: ['morro'] });
    room.handleMessage(a.id, { t: 'start' });

    // Rodada 1 (a única combinada): empate, ninguém tem estrela.
    let sim = simOf(room);
    put(sim, a.id, 0, 0);
    put(sim, b.id, sim.terrain.width - 1, sim.terrain.height - 1);
    tickUntil(room, () => a.peer.last('roundEnd')?.round === 1);
    expect(a.peer.last('roundEnd')).toMatchObject({ winner: null, next: 'tiebreak' });

    // Rodada 2: extra, de desempate. Agora o A fica no alto e o B cai no mar.
    tickUntil(room, () => a.peer.last('round')?.round === 2);
    expect(room.currentPhase).not.toBe('matchEnd');
    sim = simOf(room);
    const top = highest(sim);
    put(sim, a.id, top.tx, top.ty);
    put(sim, b.id, 0, 0);
    tickUntil(room, () => a.peer.last('roundEnd')?.round === 2);
    expect(a.peer.last('roundEnd')).toMatchObject({ winner: a.id, next: 'matchEnd' });

    tickUntil(room, () => room.currentPhase === 'matchEnd');
    const ranking = a.peer.last('matchEnd')!.ranking;
    expect(ranking[0]).toMatchObject({ id: a.id, stars: 1 });
    expect(ranking[1]).toMatchObject({ id: b.id, stars: 0 });
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
    // As 5 combinadas sempre acontecem; se houve empate nas estrelas, vêm rodadas extras.
    const played = [...rounds].sort((x, y) => x - y);
    expect(played.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(played).toEqual(played.map((_, i) => i + 1));
    expect(a.peer.last('roundEnd')!.next).toBe('matchEnd');

    const winners = a.peer.messages.filter((m) => m.t === 'roundEnd' && m.winner).length;
    const ranking = a.peer.last('matchEnd')!.ranking;
    expect(ranking.reduce((sum, r) => sum + r.stars, 0)).toBe(winners);
    // Partida termina com um campeão isolado nas estrelas (salvo o teto de desempates).
    if (played.length < 5 + MAX_TIEBREAK_ROUNDS) {
      expect(ranking[0]!.stars).toBeGreaterThan(ranking[1]!.stars);
    }

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
    expectRounds(maps, 7);
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
    expectRounds(maps, 5);
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
    expectRounds(maps, 3);
    expect(maps.every((m) => m === 'castelo')).toBe(true);
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
