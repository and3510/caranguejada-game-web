import { describe, expect, it } from 'vitest';
import { SCORE, type Terrain } from '@caranguejada/shared';
import { Simulation } from '../src/game/Simulation';

const DT = 1 / 30;

/** Ilha plana alta no meio, cercada de oceano — cenário controlado para testes. */
function islandTerrain(): Terrain {
  const w = 20;
  const h = 20;
  const heights = new Uint8Array(w * h);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) heights[y * w + x] = 8;
  return { width: w, height: h, heights };
}

/** Ilha com uma praia baixa a leste: dá pra sair do mar por ali. */
function beachTerrain(): Terrain {
  const t = islandTerrain();
  for (let y = 5; y < 15; y++) for (let x = 15; x < 17; x++) t.heights[y * t.width + x] = 2;
  return t;
}

function place(sim: Simulation, id: string, x: number, y: number) {
  const crab = sim.crabs.get(id)!;
  crab.x = x;
  crab.y = y;
  return crab;
}

function run(sim: Simulation, seconds: number) {
  const fx = [];
  const scores = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const r = sim.step(DT);
    fx.push(...r.fx);
    scores.push(...r.scores);
  }
  return { fx, scores };
}

describe('Simulation', () => {
  it('afoga quem fica na água e encerra a rodada com um vencedor', () => {
    const sim = new Simulation(1, ['a', 'b'], islandTerrain());
    place(sim, 'a', 10.5, 10.5);
    place(sim, 'b', 1.5, 1.5); // oceano
    const { fx } = run(sim, 6);
    expect(sim.crabs.get('b')!.alive).toBe(false);
    expect(sim.crabs.get('a')!.alive).toBe(true);
    expect(fx.some((e) => e.kind === 'drown' && e.target === 'b')).toBe(true);
    expect(sim.isOver()).toBe(true);
    expect(sim.winner()).toBe('a');
  });

  it('empurrão com bote derruba e credita afogamento a quem empurrou', () => {
    const sim = new Simulation(2, ['a', 'b'], islandTerrain());
    place(sim, 'a', 13.2, 10.5);
    place(sim, 'b', 14.2, 10.5); // na beirada leste da ilha
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, dash: true });
    const first = run(sim, 0.3);
    expect(first.fx.some((e) => e.kind === 'shove' && e.by === 'a' && e.target === 'b')).toBe(true);
    expect(sim.crabs.get('b')!.x).toBeGreaterThan(16); // voou pro mar

    sim.setInput('a', { dx: 0, dy: 0, seq: 2 });
    const { scores } = run(sim, 4);
    expect(sim.crabs.get('b')!.alive).toBe(false);
    expect(scores).toContainEqual({ playerId: 'a', points: SCORE.fatalShove });
  });

  it('quem cai perto da costa consegue voltar nadando', () => {
    const sim = new Simulation(3, ['a', 'b'], beachTerrain());
    place(sim, 'b', 10.5, 10.5);
    place(sim, 'a', 18.5, 10.5); // 1,5 tile mar adentro (a praia vai até x=17)
    sim.setInput('a', { dx: -1, dy: 0, seq: 1 });
    run(sim, 2);
    expect(sim.crabs.get('a')!.alive).toBe(true);
    expect(sim.crabs.get('a')!.x).toBeLessThan(17);
  });

  it('quem fica parado no mar afunda em poucos segundos', () => {
    const sim = new Simulation(4, ['a', 'b'], islandTerrain());
    place(sim, 'b', 10.5, 10.5);
    place(sim, 'a', 1.5, 1.5);
    run(sim, 1.5);
    expect(sim.crabs.get('a')!.alive).toBe(true);
    run(sim, 2.5);
    expect(sim.crabs.get('a')!.alive).toBe(false);
  });

  it('último sobrevivente vence mesmo com menos pontos', () => {
    const sim = new Simulation(7, ['a', 'b'], islandTerrain());
    place(sim, 'a', 10.5, 10.5);
    place(sim, 'b', 1.5, 1.5);
    sim.roundPoints.set('b', 10);
    run(sim, 5);
    expect(sim.roundResult()).toEqual({ winner: 'a', byPoints: false });
  });

  it('se os dois últimos afundam juntos, vence quem tem mais pontos na rodada', () => {
    const sim = new Simulation(8, ['a', 'b'], islandTerrain());
    place(sim, 'a', 1.5, 1.5);
    place(sim, 'b', 18.5, 18.5); // mesma profundidade: afundam no mesmo tick
    sim.roundPoints.set('b', 3);
    sim.roundPoints.set('a', 1);
    run(sim, 5);
    expect(sim.crabs.get('a')!.diedAt).toBe(sim.crabs.get('b')!.diedAt);
    expect(sim.roundResult()).toEqual({ winner: 'b', byPoints: true });
  });

  it('afundam juntos e empatam nos pontos: ninguém vence', () => {
    const sim = new Simulation(9, ['a', 'b'], islandTerrain());
    place(sim, 'a', 1.5, 1.5);
    place(sim, 'b', 18.5, 18.5);
    sim.shells.length = 0;
    run(sim, 5);
    expect(sim.roundResult()).toEqual({ winner: null, byPoints: false });
  });

  it('coleta conchas e pontua', () => {
    const sim = new Simulation(5, ['a', 'b'], islandTerrain());
    sim.shells.length = 0;
    sim.shells.push({ id: 99, x: 10.5, y: 10.5, gold: true });
    place(sim, 'a', 10.4, 10.5);
    const { scores } = run(sim, DT);
    expect(scores).toContainEqual({ playerId: 'a', points: SCORE.goldShell });
    expect(sim.shells).toHaveLength(0);
  });

  it('a maré eventualmente cobre tudo (rodada sempre termina)', () => {
    const sim = new Simulation(6, ['a', 'b'], islandTerrain());
    place(sim, 'a', 8.5, 8.5);
    place(sim, 'b', 12.5, 12.5);
    run(sim, 175);
    expect(sim.isOver()).toBe(true);
  });
});
