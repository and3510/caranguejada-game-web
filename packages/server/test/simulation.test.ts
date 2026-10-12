import { describe, expect, it } from 'vitest';
import { CRAB, SCORE, WEAPONS, WEAPON_RULES, tideLevel, type Terrain } from '@caranguejada/shared';
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

/** Arena limpa: sem armas espalhadas, para o teste controlar tudo. */
function arena(seed: number, terrain = islandTerrain()) {
  const sim = new Simulation(seed, ['a', 'b'], terrain);
  sim.weapons.length = 0;
  return sim;
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

  it('dash só desloca: esbarrar não empurra ninguém', () => {
    const sim = arena(2);
    place(sim, 'a', 12.2, 10.5);
    place(sim, 'b', 13.2, 10.5);
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, dash: true });
    const { fx } = run(sim, 0.3);
    expect(fx.some((e) => e.kind === 'dash' && e.by === 'a')).toBe(true);
    expect(fx.some((e) => e.kind === 'hit')).toBe(false);
    expect(sim.crabs.get('b')!.stunT).toBe(0);
    expect(sim.crabs.get('b')!.x).toBeLessThan(15); // continua na ilha
  });

  it('desarmado, o ataque não faz nada', () => {
    const sim = arena(2);
    place(sim, 'a', 13.2, 10.5);
    place(sim, 'b', 14, 10.5);
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const { fx } = run(sim, 0.3);
    expect(fx.some((e) => e.kind === 'swing' || e.kind === 'hit')).toBe(false);
  });

  it('desarmado, o Espaço também pega a arma do chão (sem atirar no mesmo toque)', () => {
    const sim = arena(6);
    const a = place(sim, 'a', 10.5, 10.5);
    sim.weapons.push({ id: 1, x: 10.7, y: 10.5, kind: 'revolver', uses: 4, afloat: 0 });
    sim.setInput('a', { dx: 0, dy: 0, seq: 1, attack: true });
    const { fx } = run(sim, DT);
    expect(a.weapon).toBe('revolver');
    expect(a.uses).toBe(4);
    expect(sim.weapons).toHaveLength(0);
    // Pegou a arma: não atirou no mesmo tick (nem gastou munição).
    expect(fx.some((e) => e.kind === 'swing' || e.kind === 'hit')).toBe(false);
  });

  it('já armado, o Espaço ataca: só R larga ou troca de arma', () => {
    const sim = arena(7);
    const a = place(sim, 'a', 10.5, 10.5);
    sim.giveWeapon('a', 'revolver');
    sim.weapons.push({ id: 1, x: 10.7, y: 10.5, kind: 'espingarda', uses: 3, afloat: 0 });
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const { fx } = run(sim, DT);
    expect(a.weapon).toBe('revolver'); // não trocou
    expect(sim.weapons).toHaveLength(1); // a do chão continua lá
    expect(fx.some((e) => e.kind === 'swing' && e.weapon === 'revolver')).toBe(true);
  });

  it('tiro de revólver joga pro mar e credita o afogamento a quem atirou', () => {
    const sim = arena(2);
    sim.giveWeapon('a', 'revolver');
    place(sim, 'a', 11.5, 10.5);
    place(sim, 'b', 14.5, 10.5); // na beirada leste da ilha
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const first = run(sim, 0.4);
    expect(first.fx).toContainEqual(
      expect.objectContaining({ kind: 'hit', by: 'a', target: 'b', weapon: 'revolver' }),
    );
    expect(sim.crabs.get('b')!.x).toBeGreaterThan(15); // voou pro mar

    sim.setInput('a', { dx: 0, dy: 0, seq: 2 });
    const { scores, fx } = run(sim, 6);
    expect(sim.crabs.get('b')!.alive).toBe(false);
    expect(scores).toContainEqual({ playerId: 'a', points: SCORE.fatalShove });
    expect(fx).toContainEqual(
      expect.objectContaining({ kind: 'drown', by: 'a', weapon: 'revolver' }),
    );
  });

  it('o servidor usa a mira do mouse (fx/fy), não a direção em que anda', () => {
    const sim = arena(2);
    sim.giveWeapon('a', 'revolver');
    place(sim, 'a', 8, 10.5);
    const b = place(sim, 'b', 8, 14); // alvo ao sul
    // Anda pra leste, mas o mouse aponta pro sul.
    sim.setInput('a', { dx: 1, dy: 0, fx: 0, fy: 1, mouse: true, seq: 1, attack: true });
    const { fx } = run(sim, DT);
    expect(fx).toContainEqual(expect.objectContaining({ kind: 'hit', by: 'a', target: 'b' }));
    expect(b.ky).toBeGreaterThan(0);
  });

  it('mouse mira exato: sem o puxão de mira do teclado/toque', () => {
    const shoot = (mouse: boolean) => {
      const sim = arena(2);
      sim.giveWeapon('a', 'revolver');
      place(sim, 'a', 4, 10.5);
      place(sim, 'b', 11, 10.5 + 1.2); // ~10° fora da linha: assist alcança, mouse não
      sim.setInput('a', { dx: 0, dy: 0, fx: 1, fy: 0, mouse, seq: 1, attack: true });
      return run(sim, DT).fx.some((e) => e.kind === 'hit');
    };
    expect(shoot(false)).toBe(true);
    expect(shoot(true)).toBe(false);
  });

  describe('compensação de lag', () => {
    /**
     * O alvo corre pro sul; o atirador (parado a oeste) mira reto pro leste, na linha onde
     * o alvo estava `seconds` atrás. Só acerta se o servidor testar o alvo naquele instante.
     */
    const duel = (seconds: number, vtAgo: number | null) => {
      const sim = arena(2);
      sim.giveWeapon('a', 'revolver');
      place(sim, 'a', 3, 6);
      place(sim, 'b', 8, 6); // na linha de tiro (y = 6)
      sim.setInput('b', { dx: 0, dy: 1, seq: 1 });
      run(sim, seconds);
      sim.setInput('b', { dx: 0, dy: 1, seq: 2 });
      sim.setInput('a', {
        dx: 0,
        dy: 0,
        fx: 1,
        fy: 0,
        mouse: true,
        vt: vtAgo === null ? undefined : sim.time - vtAgo,
        seq: 1,
        attack: true,
      });
      const b = sim.crabs.get('b')!;
      const offLine = b.y - 6;
      const hit = run(sim, DT).fx.some((e) => e.kind === 'hit' && e.target === 'b');
      return { hit, offLine };
    };

    it('acerta quem estava na mira quando o atirador atirou (vt)', () => {
      const { hit, offLine } = duel(0.25, 0.25);
      expect(offLine).toBeGreaterThan(0.9); // hoje o alvo já está bem fora da linha
      expect(hit).toBe(true);
    });

    it('sem vt, o tiro vai contra a posição de agora e erra (o bug do "passou longe")', () => {
      expect(duel(0.25, null).hit).toBe(false);
    });

    it('o limite de rewind impede vantagem de lag absurdo', () => {
      // Pediu 0,45s de volta, mas o servidor só volta MAX_LAG_COMP_SECONDS (0,3s):
      // o alvo, a 0,3s atrás, já estava fora da linha.
      const { hit, offLine } = duel(0.45, 0.45);
      expect(offLine).toBeGreaterThan(1.5);
      expect(hit).toBe(false);
    });
  });

  describe('dano percentual', () => {
    const shoot = (damage: number, weapon: 'revolver' | 'espingarda' = 'revolver') => {
      const sim = arena(2);
      sim.giveWeapon('a', weapon);
      place(sim, 'a', 8, 10.5);
      const b = place(sim, 'b', 10, 10.5);
      b.damage = damage;
      sim.setInput('a', { dx: 0, dy: 0, fx: 1, fy: 0, mouse: true, seq: 1, attack: true });
      sim.step(DT);
      return { sim, b, push: Math.hypot(b.kx, b.ky) };
    };

    it('cada acerto soma o dano da arma, e o snapshot informa', () => {
      const { sim, b } = shoot(0);
      expect(b.damage).toBe(WEAPONS.revolver.damage);
      expect(sim.crabSnapshots().find((c) => c.id === 'b')!.damage).toBe(WEAPONS.revolver.damage);
    });

    it('quanto mais dano acumulado, mais longe o próximo acerto joga', () => {
      const fresh = shoot(0).push;
      const hurt = shoot(100).push;
      expect(hurt).toBeGreaterThan(fresh * 1.7);
      // O teto limita o empurrão a no máximo 3× (não vira míssil).
      expect(shoot(10_000).push).toBeLessThanOrEqual(WEAPONS.revolver.impulse * 3 + 1e-6);
    });

    it('tiro que erra não dá dano', () => {
      const sim = arena(2);
      sim.giveWeapon('a', 'revolver');
      place(sim, 'a', 8, 10.5);
      const b = place(sim, 'b', 10, 14);
      sim.setInput('a', { dx: 0, dy: 0, fx: 1, fy: 0, mouse: true, seq: 1, attack: true });
      sim.step(DT);
      expect(b.damage).toBe(0);
    });

    it('bazuca e espingarda empurram bem mais que o revólver, e as outras armas subiram pouco', () => {
      expect(WEAPONS.espingarda.impulse).toBe(26);
      expect(WEAPONS.bazuca.impulse).toBe(28);
      expect(WEAPONS.revolver.impulse).toBe(15);
      expect(WEAPONS.submetralhadora.impulse).toBe(3.5);
    });

    it('bazuca: quem se explode sozinho não ganha dano; o alvo ganha', () => {
      const sim = arena(2);
      sim.giveWeapon('a', 'bazuca');
      const a = place(sim, 'a', 8, 10.5);
      const b = place(sim, 'b', 9.4, 10.5);
      sim.setInput('a', { dx: 0, dy: 0, fx: 1, fy: 0, mouse: true, seq: 1, attack: true });
      run(sim, 0.3);
      expect(a.damage).toBe(0);
      expect(b.damage).toBe(WEAPONS.bazuca.damage);
    });

    it('zera a cada rodada (simulação nova)', () => {
      const sim = new Simulation(5, ['a', 'b'], islandTerrain());
      expect([...sim.crabs.values()].every((c) => c.damage === 0)).toBe(true);
    });
  });

  it('o tiro só pega quem está na frente', () => {
    const sim = arena(2);
    sim.giveWeapon('a', 'revolver');
    place(sim, 'a', 10, 10.5);
    place(sim, 'b', 9, 10.5); // atrás
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const { fx } = run(sim, 0.2);
    expect(fx.some((e) => e.kind === 'swing')).toBe(true);
    expect(fx.some((e) => e.kind === 'hit')).toBe(false);
  });

  it('espingarda: leque de chumbo arremessa a vítima e o rebote joga quem atirou pra trás', () => {
    const sim = arena(2);
    sim.giveWeapon('a', 'espingarda');
    const a = place(sim, 'a', 9, 10.5);
    const b = place(sim, 'b', 11.5, 10.5); // 2,5 tiles
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const { fx } = run(sim, DT);
    expect(fx).toContainEqual(
      expect.objectContaining({ kind: 'hit', by: 'a', target: 'b', weapon: 'espingarda' }),
    );
    const victim = Math.hypot(b.kx, b.ky);
    const recoil = Math.hypot(a.kx, a.ky);
    expect(a.kx).toBeLessThan(0); // rebote pra trás
    expect(recoil).toBeGreaterThan(0);
    expect(recoil).toBeLessThan(victim); // vai um pouco menos longe que a vítima
  });

  it('espingarda: alcance curto, menor que o do revólver', () => {
    expect(WEAPONS.espingarda.reach).toBeLessThan(WEAPONS.revolver.reach);

    const sim = arena(2);
    sim.giveWeapon('a', 'espingarda');
    const a = place(sim, 'a', 6, 10.5);
    place(sim, 'b', 6 + WEAPONS.espingarda.reach + 1.5, 10.5); // fora do alcance
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const { fx } = run(sim, DT);
    expect(fx.some((e) => e.kind === 'hit')).toBe(false);
    expect(a.kx).toBeLessThan(0); // errou, mas o rebote vem igual
  });

  it('revólver: tiro de longe afasta o primeiro da mira, sem rebote', () => {
    const sim = new Simulation(2, ['a', 'b', 'c'], islandTerrain());
    sim.weapons.length = 0;
    sim.giveWeapon('a', 'revolver');
    const a = place(sim, 'a', 5.5, 10.5);
    const b = place(sim, 'b', 11.5, 10.6); // 6 tiles na linha
    const c = place(sim, 'c', 13, 10.5); // atrás do b: a bala para no primeiro
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const { fx } = run(sim, DT);
    expect(fx).toContainEqual(
      expect.objectContaining({ kind: 'hit', by: 'a', target: 'b', weapon: 'revolver' }),
    );
    expect(fx.some((e) => e.kind === 'hit' && e.target === 'c')).toBe(false);
    expect(b.kx).toBeGreaterThan(0); // afastado na direção do tiro
    expect(c.kx).toBe(0);
    expect(a.kx).toBe(0); // sem rebote
    const swing = fx.find((e) => e.kind === 'swing')!;
    expect(swing.value).toBeCloseTo(6, 0); // a bala foi até o b
  });

  it('arma de fogo tem assistência de mira (teclado só aponta 8 direções)', () => {
    const sim = arena(2);
    sim.giveWeapon('a', 'revolver');
    place(sim, 'a', 5.5, 10.5);
    const b = place(sim, 'b', 11.5, 12); // ~14° abaixo da linha: apertando "direita" pega
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const { fx } = run(sim, DT);
    expect(fx.some((e) => e.kind === 'hit' && e.target === 'b')).toBe(true);
    expect(b.ky).toBeGreaterThan(0);
  });

  it('revólver: quem está longe da linha não leva', () => {
    const sim = arena(2);
    sim.giveWeapon('a', 'revolver');
    place(sim, 'a', 5.5, 10.5);
    place(sim, 'b', 9, 13); // ~35° fora da linha: nem a assistência alcança
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const { fx } = run(sim, DT);
    expect(fx.some((e) => e.kind === 'hit')).toBe(false);
  });

  it.each([
    ['espingarda', 3],
    ['revolver', 6],
  ] as const)('%s quebra quando acaba o carregador (%i tiros)', (kind, shots) => {
    expect(WEAPONS[kind].uses).toBe(shots);
    const sim = arena(4);
    sim.giveWeapon('a', kind);
    place(sim, 'a', 8, 10.5);
    place(sim, 'b', 12, 14);
    const breaks = [];
    for (let i = 0; i < shots; i++) {
      const a = sim.crabs.get('a')!;
      Object.assign(a, { attackCooldown: 0, x: 8, y: 10.5, kx: 0, ky: 0 });
      expect(a.weapon).toBe(kind);
      sim.setInput('a', { dx: 1, dy: 0, seq: i + 1, attack: true });
      breaks.push(...sim.step(DT).fx.filter((e) => e.kind === 'break'));
    }
    expect(breaks).toHaveLength(1);
    expect(sim.crabs.get('a')!.weapon).toBeNull();
  });

  it('quanto mais fraco cada uso, mais usos a arma aguenta', () => {
    const byPower = (['submetralhadora', 'revolver', 'espingarda', 'bazuca'] as const).map(
      (k) => WEAPONS[k],
    );
    for (let i = 1; i < byPower.length; i++) {
      expect(byPower[i]!.impulse).toBeGreaterThan(byPower[i - 1]!.impulse);
      expect(byPower[i]!.uses).toBeLessThan(byPower[i - 1]!.uses);
    }
  });

  it('submetralhadora: um aperto solta uma rajada de balas fracas que somam', () => {
    const sim = arena(2);
    sim.giveWeapon('a', 'submetralhadora');
    place(sim, 'a', 6, 10.5);
    const b = place(sim, 'b', 9, 10.5);
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const first = sim.step(DT);
    expect(first.fx.filter((e) => e.kind === 'swing')).toHaveLength(1); // só a 1ª bala
    const single = Math.hypot(b.kx, b.ky);
    expect(single).toBeGreaterThan(0);
    expect(single).toBeLessThan(WEAPONS.revolver.impulse); // uma bala sozinha é fraca

    sim.setInput('a', { dx: 0, dy: 0, seq: 2 });
    const rest = run(sim, 0.4);
    const shots = 1 + rest.fx.filter((e) => e.kind === 'swing').length;
    expect(shots).toBe(WEAPON_RULES.burstShots);
    expect(sim.crabs.get('a')!.uses).toBe(WEAPONS.submetralhadora.uses - shots);
    expect(b.x).toBeGreaterThan(9 + 1.5); // a rajada inteira varreu pra longe
  });

  it('submetralhadora: o pente de 20 balas acaba em 5 rajadas', () => {
    const sim = arena(2);
    sim.giveWeapon('a', 'submetralhadora');
    place(sim, 'a', 8, 10.5);
    place(sim, 'b', 12, 14);
    const breaks = [];
    for (let i = 0; i < 5; i++) {
      const a = sim.crabs.get('a')!;
      Object.assign(a, { attackCooldown: 0, x: 8, y: 10.5, kx: 0, ky: 0 });
      sim.setInput('a', { dx: 1, dy: 0, seq: i + 1, attack: true });
      breaks.push(...run(sim, 0.5).fx.filter((e) => e.kind === 'break'));
    }
    expect(breaks).toHaveLength(1);
    expect(sim.crabs.get('a')!.weapon).toBeNull();
  });

  it('bazuca: o foguete voa, explode em quem tocar, empurra em área e abre cratera', () => {
    const sim = new Simulation(2, ['a', 'b', 'c'], islandTerrain());
    sim.weapons.length = 0;
    sim.giveWeapon('a', 'bazuca');
    place(sim, 'a', 5.5, 10.5);
    place(sim, 'b', 11, 10.5);
    const c = place(sim, 'c', 11.8, 11.2); // ao lado do b: pega a explosão também
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const launch = sim.step(DT);
    expect(launch.fx.some((e) => e.kind === 'swing' && e.weapon === 'bazuca')).toBe(true);
    expect(launch.fx.some((e) => e.kind === 'hit')).toBe(false); // ainda voando
    expect(sim.rockets).toHaveLength(1);

    sim.setInput('a', { dx: 0, dy: 0, seq: 2 });
    const { fx } = run(sim, 1);
    const boom = fx.find((e) => e.kind === 'boom')!;
    expect(boom).toBeDefined();
    expect(sim.rockets).toHaveLength(0);
    expect(fx.some((e) => e.kind === 'hit' && e.target === 'b')).toBe(true);
    expect(fx.some((e) => e.kind === 'hit' && e.target === 'c')).toBe(true);
    expect(c.lastShovedBy).toBe('a');
    // Destrói o bloco atingido e os 8 em volta; o resto da ilha fica intacto.
    const cx = Math.floor(boom.x);
    const cy = Math.floor(boom.y);
    const height = (tx: number, ty: number) => sim.terrain.heights[ty * sim.terrain.width + tx];
    expect(height(cx, cy)).toBe(8 - WEAPON_RULES.craterCenterDepth);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        expect(height(cx + dx, cy + dy)).toBe(8 - WEAPON_RULES.craterRingDepth);
      }
    }
    expect(height(cx + 2, cy)).toBe(8);
    expect(height(cx, cy - 2)).toBe(8);
  });

  it('bazuca: quem atira colado no alvo leva a própria explosão (rocket jump)', () => {
    const sim = arena(2);
    sim.giveWeapon('a', 'bazuca');
    const a = place(sim, 'a', 8, 10.5);
    place(sim, 'b', 9.2, 10.5);
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const { fx } = run(sim, 0.2);
    expect(fx.some((e) => e.kind === 'hit' && e.target === 'a')).toBe(true);
    expect(a.lastShovedBy).toBeNull(); // se explodir sozinho não dá ponto a ninguém
  });

  it('bazuca: foguete que não acha ninguém explode no fim do alcance', () => {
    const sim = arena(2);
    sim.giveWeapon('a', 'bazuca');
    place(sim, 'a', 2.5, 10.5);
    place(sim, 'b', 10, 2); // fora da linha
    sim.setInput('a', { dx: 1, dy: 0, seq: 1, attack: true });
    const { fx } = run(sim, 1.5);
    const boom = fx.find((e) => e.kind === 'boom')!;
    expect(boom.x).toBeCloseTo(2.5 + WEAPONS.bazuca.reach, 0);
  });

  describe('bazuca: mira livre (explode onde o jogador mirou)', () => {
    /** Atira de (2.5, 10.5) pra direita mirando a `ad` tiles; devolve onde explodiu. */
    const boomAt = (ad: number | undefined, other = { x: 10, y: 2 }) => {
      const sim = arena(2);
      sim.giveWeapon('a', 'bazuca');
      place(sim, 'a', 2.5, 10.5);
      place(sim, 'b', other.x, other.y);
      sim.setInput('a', { dx: 0, dy: 0, fx: 1, fy: 0, mouse: true, ad, seq: 1, attack: true });
      const { fx } = run(sim, 1.5);
      return fx.find((e) => e.kind === 'boom')!;
    };

    it('explode no ponto mirado, não no fim do alcance', () => {
      expect(boomAt(4).x).toBeCloseTo(2.5 + 4, 1);
      expect(boomAt(6.3).x).toBeCloseTo(2.5 + 6.3, 1);
    });

    it('respeita o limite: além do alcance, explode no alcance', () => {
      expect(boomAt(50).x).toBeCloseTo(2.5 + WEAPONS.bazuca.reach, 1);
    });

    it('mirar no próprio pé não explode na cara: vai até o mínimo', () => {
      const boom = boomAt(0.3);
      expect(boom.x).toBeCloseTo(2.5 + WEAPON_RULES.rocketMinRange, 1);
      // Fora do raio da explosão: quem atirou não leva o tranco.
      expect(WEAPON_RULES.rocketMinRange).toBeGreaterThan(WEAPON_RULES.blastRadius);
    });

    it('quem estiver no caminho antes do ponto mirado ainda leva o foguete', () => {
      const boom = boomAt(8, { x: 5.5, y: 10.5 });
      expect(boom.x).toBeLessThan(5.5);
    });

    it('a cratera abre onde o jogador mirou', () => {
      const sim = arena(2);
      sim.giveWeapon('a', 'bazuca');
      place(sim, 'a', 5.5, 10.5);
      place(sim, 'b', 10, 2);
      sim.setInput('a', { dx: 0, dy: 0, fx: 1, fy: 0, mouse: true, ad: 4, seq: 1, attack: true });
      run(sim, 1.5);
      const height = (tx: number, ty: number) => sim.terrain.heights[ty * sim.terrain.width + tx];
      expect(height(9, 10)).toBe(8 - WEAPON_RULES.craterCenterDepth); // 5,5 + 4 = 9,5
      expect(height(12, 10)).toBe(8); // o resto do caminho continua inteiro
    });

    it('o snapshot conta quanto falta (o cliente não desenha o foguete passando do ponto)', () => {
      const sim = arena(2);
      sim.giveWeapon('a', 'bazuca');
      place(sim, 'a', 2.5, 10.5);
      place(sim, 'b', 10, 2);
      sim.setInput('a', { dx: 0, dy: 0, fx: 1, fy: 0, mouse: true, ad: 5, seq: 1, attack: true });
      sim.step(DT);
      const [r] = sim.rocketSnapshots();
      expect(r!.x + r!.rem).toBeCloseTo(2.5 + 5, 1);
    });
  });

  it('R pega a arma do chão, larga, e troca uma pela outra (com o desgaste)', () => {
    const sim = arena(5);
    const a = place(sim, 'a', 10.5, 10.5);
    sim.weapons.push({ id: 1, x: 10.7, y: 10.5, kind: 'revolver', uses: 4, afloat: 0 });
    sim.setInput('a', { dx: 0, dy: 0, seq: 1, grab: true });
    sim.step(DT);
    expect(a.weapon).toBe('revolver');
    expect(a.uses).toBe(4);
    expect(sim.weapons).toHaveLength(0);

    sim.weapons.push({ id: 2, x: 10.3, y: 10.5, kind: 'espingarda', uses: 2, afloat: 0 });
    sim.setInput('a', { dx: 0, dy: 0, seq: 2, grab: true });
    sim.step(DT);
    expect(a.weapon).toBe('espingarda');
    expect(a.uses).toBe(2);
    expect(sim.weapons).toEqual([
      expect.objectContaining({ kind: 'revolver', uses: 4, afloat: 0 }),
    ]);

    a.x = 6.5; // longe de tudo: R só larga
    sim.setInput('a', { dx: 0, dy: 0, seq: 3, grab: true });
    sim.step(DT);
    expect(a.weapon).toBeNull();
    expect(sim.weapons).toHaveLength(2);
  });

  it('sem terra sobrando, arma nasce boiando na água perto de quem está vivo', () => {
    // Tudo plano e baixo: a maré já cobriu, só sobra água rasa.
    const t = islandTerrain();
    t.heights.fill(Math.floor(tideLevel(30))); // tudo já embaixo d'água
    const sim = new Simulation(12, ['a', 'b'], t);
    sim.weapons.length = 0;
    place(sim, 'a', 10.5, 10.5);
    place(sim, 'b', 15.5, 15.5);
    sim.time = 30; // enchente: nasce arma mais rápido
    for (let i = 0; i < (WEAPON_RULES.floodSpawnEverySeconds + DT) / DT; i++) {
      for (const c of sim.crabs.values()) c.breath = 1; // os dois seguem nadando
      sim.step(DT);
    }
    expect(sim.weapons.length).toBeGreaterThan(0);
    for (const w of sim.weapons) {
      const near = Math.min(
        ...['a', 'b'].map((id) => {
          const c = sim.crabs.get(id)!;
          return Math.hypot(c.x - w.x, c.y - w.y);
        }),
      );
      expect(near).toBeLessThanOrEqual(WEAPON_RULES.floatSpawnNear + 1);
    }
  });

  it('arma na água boia um tempo (dá pra pegar nadando) e depois o mar leva', () => {
    const sim = arena(13);
    place(sim, 'a', 10.5, 10.5);
    place(sim, 'b', 12.5, 12.5);
    sim.weapons.push({ id: 1, x: 1.5, y: 1.5, kind: 'revolver', uses: 6, afloat: 0 }); // no mar
    run(sim, WEAPON_RULES.floatSeconds - 1);
    expect(sim.weapons.some((w) => w.id === 1)).toBe(true);

    // Nadando até ela, dá pra pegar.
    const a = place(sim, 'a', 1.6, 1.5);
    a.breath = 1;
    sim.setInput('a', { dx: 0, dy: 0, seq: 1, grab: true });
    sim.step(DT);
    expect(a.weapon).toBe('revolver');

    sim.weapons.push({ id: 2, x: 18.5, y: 1.5, kind: 'submetralhadora', uses: 30, afloat: 0 });
    run(sim, WEAPON_RULES.floatSeconds + 0.5);
    expect(sim.weapons.some((w) => w.id === 2)).toBe(false);
  });

  it('a rodada já começa com armas no chão, em terra', () => {
    const sim = new Simulation(11, ['a', 'b', 'c', 'd'], islandTerrain());
    expect(sim.weapons.length).toBeGreaterThanOrEqual(2);
    for (const w of sim.weapons) {
      expect(sim.terrain.heights[Math.floor(w.y) * sim.terrain.width + Math.floor(w.x)]).toBe(8);
    }
  });

  describe('água rasa não afoga', () => {
    // Na ilha de teste o mar tem altura 0: no começo da rodada o nível é 0,6 (raso)
    // e, com a maré subindo, o mesmo lugar passa de 1 (fundo).
    it('o fôlego para no piso e ninguém morre, por mais que fique lá', () => {
      const sim = arena(20);
      place(sim, 'b', 10.5, 10.5);
      const a = place(sim, 'a', 1.5, 1.5);
      a.breath = 0.2;
      run(sim, 3); // ainda raso (o nível só passa de 1 lá pelos 3,6s)
      expect(sim.crabs.get('a')!.alive).toBe(true);
      expect(a.breath).toBeCloseTo(CRAB.shallowBreathFloor, 5);
    });

    it('quem sai do raso pro fundo morre rápido (o raso só te deixa fraco)', () => {
      const sim = arena(21);
      place(sim, 'b', 10.5, 10.5);
      const a = place(sim, 'a', 1.5, 1.5);
      a.breath = CRAB.shallowBreathFloor;
      sim.time = 10; // maré alta: o mesmo lugar agora é água funda
      run(sim, 1);
      expect(a.alive).toBe(false);
    });

    it('empurrão pro raso não mata (nem credita ponto); pro fundo, mata', () => {
      // Curto o bastante pra maré não transformar o raso em fundo durante o teste.
      const push = (time: number, seconds: number) => {
        const sim = arena(22);
        sim.time = time;
        sim.giveWeapon('a', 'revolver');
        place(sim, 'a', 5.5, 10.5);
        const b = place(sim, 'b', 3, 10.5); // no mar, a oeste
        b.breath = 0.15;
        sim.setInput('a', { dx: 0, dy: 0, fx: -1, fy: 0, mouse: true, seq: 1, attack: true });
        const { scores } = run(sim, seconds);
        return { morreu: !b.alive, creditou: scores.length > 0, folego: b.breath };
      };
      const raso = push(0, 2.5);
      expect(raso.morreu).toBe(false); // raso: aguenta
      expect(raso.folego).toBeCloseTo(CRAB.shallowBreathFloor, 5);
      expect(raso.creditou).toBe(false);
      expect(push(10, 4).morreu).toBe(true); // fundo: afunda
    });
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
    run(sim, 3);
    expect(sim.crabs.get('a')!.alive).toBe(true);
    run(sim, 3);
    expect(sim.crabs.get('a')!.alive).toBe(false);
  });

  it('último sobrevivente vence a rodada', () => {
    const sim = new Simulation(7, ['a', 'b'], islandTerrain());
    place(sim, 'a', 10.5, 10.5);
    place(sim, 'b', 1.5, 1.5);
    run(sim, 6);
    expect(sim.winner()).toBe('a');
  });

  it('se os últimos afundam juntos é empate: ninguém leva a rodada', () => {
    const sim = new Simulation(8, ['a', 'b'], islandTerrain());
    place(sim, 'a', 1.5, 1.5);
    place(sim, 'b', 18.5, 18.5); // mesma profundidade: afundam no mesmo tick
    run(sim, 6);
    expect(sim.crabs.get('a')!.diedAt).toBe(sim.crabs.get('b')!.diedAt);
    expect(sim.isOver()).toBe(true);
    expect(sim.winner()).toBeNull();
  });

  it('a maré eventualmente cobre tudo (rodada sempre termina)', () => {
    const sim = new Simulation(6, ['a', 'b'], islandTerrain());
    place(sim, 'a', 8.5, 8.5);
    place(sim, 'b', 12.5, 12.5);
    run(sim, 175);
    expect(sim.isOver()).toBe(true);
  });
});
