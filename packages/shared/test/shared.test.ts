import { describe, expect, it } from 'vitest';
import {
  CLIFF_HEIGHT,
  CRAB,
  FINAL_REFUGE_TILES,
  MAP_HEIGHT,
  MAP_KINDS,
  MAP_WIDTH,
  MAX_TILE_HEIGHT,
  TIDE,
  WEAPONS,
  WEAPON_RULES,
  WEAPON_KINDS,
  createBody,
  knockbackMultiplier,
  decodeHeights,
  encodeHeights,
  generateTerrain,
  heightAt,
  isBlocked,
  isDry,
  isValidRoomCode,
  landRatio,
  lastLand,
  parseClientMessage,
  rocketRange,
  pickWeaponKind,
  randomRoomCode,
  sanitizeName,
  stepBody,
  tideLevel,
  tideSpeed,
  type Terrain,
} from '../src';

function flatTerrain(height: number, w = 10, h = 10): Terrain {
  return { width: w, height: h, heights: new Uint8Array(w * h).fill(height) };
}

describe('terrain', () => {
  it('é determinístico para a mesma seed', () => {
    const a = generateTerrain(1234);
    const b = generateTerrain(1234);
    expect(encodeHeights(a.heights)).toBe(encodeHeights(b.heights));
  });

  it('gera mapas diferentes para seeds diferentes', () => {
    expect(encodeHeights(generateTerrain(1).heights)).not.toBe(
      encodeHeights(generateTerrain(2).heights),
    );
  });

  it.each(MAP_KINDS)('mapa %s: termina num refúgio de 8 blocos juntos, alcançável a pé', (kind) => {
    for (let seed = 0; seed < 15; seed++) {
      const t = generateTerrain(seed * 97 + 1, kind);
      const top: number[] = [];
      for (let i = 0; i < t.heights.length; i++) if (t.heights[i] === MAX_TILE_HEIGHT) top.push(i);
      expect(top).toHaveLength(FINAL_REFUGE_TILES);

      // Um bloco só: todos alcançáveis uns dos outros andando pelos vizinhos (4 direções).
      const set = new Set(top);
      const seen = new Set<number>([top[0]!]);
      const stack = [top[0]!];
      while (stack.length > 0) {
        const c = stack.pop()!;
        const x = c % t.width;
        const y = Math.floor(c / t.width);
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ] as const) {
          const ni = ny * t.width + nx;
          if (nx >= 0 && ny >= 0 && nx < t.width && ny < t.height && set.has(ni) && !seen.has(ni)) {
            seen.add(ni);
            stack.push(ni);
          }
        }
      }
      expect(seen.size).toBe(FINAL_REFUGE_TILES);

      // Dá pra subir até o refúgio sem paredão: algum vizinho de fora do bloco é transponível.
      const outside = top.flatMap((c) => {
        const x = c % t.width;
        const y = Math.floor(c / t.width);
        return [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ]
          .filter(([nx, ny]) => !set.has(ny! * t.width + nx!))
          .map(([nx, ny]) => heightAt(t, nx!, ny!));
      });
      expect(Math.max(...outside)).toBeGreaterThan(MAX_TILE_HEIGHT - CLIFF_HEIGHT);
      // lastLand continua apontando pra um deles.
      const { tx, ty } = lastLand(t);
      expect(heightAt(t, tx, ty)).toBe(MAX_TILE_HEIGHT);
    }
  });

  it.each(MAP_KINDS)('mapa %s: nenhum degrau intransponível entre terras', (kind) => {
    for (let seed = 0; seed < 10; seed++) {
      const t = generateTerrain(seed * 41 + 3, kind);
      for (let ty = 0; ty < t.height; ty++) {
        for (let tx = 0; tx < t.width - 1; tx++) {
          const a = heightAt(t, tx, ty);
          const b = heightAt(t, tx + 1, ty);
          const c = heightAt(t, tx, ty + 1);
          if (a > 0 && b > 0) expect(Math.abs(a - b)).toBeLessThan(CLIFF_HEIGHT);
          if (a > 0 && c > 0) expect(Math.abs(a - c)).toBeLessThan(CLIFF_HEIGHT);
        }
      }
    }
  });

  it('a terra encolhe aos poucos: cada nível de água leva só uma faixa', () => {
    const t = generateTerrain(2026, 'morro');
    const land = (lvl: number) => t.heights.filter((h) => h >= lvl).length;
    for (let lvl = 2; lvl <= MAX_TILE_HEIGHT; lvl++) {
      expect(land(lvl)).toBeLessThan(land(lvl - 1));
      expect(land(lvl)).toBeGreaterThan(0);
    }
    // O anel de altura 8 (6 tiles) cerca o refúgio (8 tiles de altura máxima).
    expect(land(8)).toBeLessThanOrEqual(FINAL_REFUGE_TILES + 6);
    // No fim sobra só o refúgio.
    expect(land(MAX_TILE_HEIGHT)).toBe(FINAL_REFUGE_TILES);
  });

  it.each(MAP_KINDS)(
    'mapa %s: determinístico, mar na borda, alcança o topo, terra jogável',
    (kind) => {
      expect(encodeHeights(generateTerrain(77, kind).heights)).toBe(
        encodeHeights(generateTerrain(77, kind).heights),
      );
      for (let seed = 0; seed < 15; seed++) {
        const t = generateTerrain(seed * 313, kind);
        expect(t.heights.length).toBe(MAP_WIDTH * MAP_HEIGHT);
        for (let x = 0; x < t.width; x++) {
          expect(heightAt(t, x, 0)).toBe(0);
          expect(heightAt(t, x, t.height - 1)).toBe(0);
        }
        expect(Math.max(...t.heights)).toBe(MAX_TILE_HEIGHT);
        expect(landRatio(t)).toBeGreaterThanOrEqual(0.15);
      }
    },
  );

  it('atol tem lagoa no meio', () => {
    const t = generateTerrain(5, 'atol');
    expect(heightAt(t, Math.floor(t.width / 2), Math.floor(t.height / 2))).toBe(0);
  });

  it('codifica e decodifica alturas sem perda', () => {
    const t = generateTerrain(99);
    expect(decodeHeights(encodeHeights(t.heights))).toEqual(t.heights);
  });
});

describe('tide', () => {
  /** Instante em que a água chega no teto. */
  const tempoDoTeto = () => {
    let t = 0;
    while (tideLevel(t) < TIDE.maxLevel && t < 600) t += 0.05;
    return t;
  };

  it('só sobe e cada vez mais rápido, até chegar no teto', () => {
    const fim = tempoDoTeto();
    let prev = tideLevel(0);
    let prevRise = 0;
    for (let t = 1; t < fim - 1; t++) {
      const level = tideLevel(t);
      expect(level).toBeGreaterThan(prev);
      expect(level - prev).toBeGreaterThan(prevRise);
      prevRise = level - prev;
      prev = level;
    }
  });

  it('o ritmo da subida é exatamente o de sempre (só ganhou um teto no fim)', () => {
    for (const t of [0, 5, 15, 25, 33]) {
      expect(tideLevel(t)).toBeCloseTo(
        TIDE.base + TIDE.risePerSecond * t + TIDE.acceleration * t * t,
        9,
      );
    }
  });

  it('para no teto, logo abaixo da altura máxima: o refúgio nunca alaga', () => {
    expect(TIDE.maxLevel).toBeLessThan(MAX_TILE_HEIGHT);
    expect(TIDE.maxLevel).toBeGreaterThan(MAX_TILE_HEIGHT - 1);
    const fim = tempoDoTeto();
    for (const extra of [0, 1, 10, 100, 1000]) {
      expect(tideLevel(fim + extra)).toBe(TIDE.maxLevel);
    }
    expect(tideSpeed(fim + 5)).toBe(0);
    expect(tideSpeed(10)).toBeGreaterThan(0);
  });

  it('todo o resto da ilha ainda some: o teto cobre tudo menos a altura máxima', () => {
    // Um tile de altura 8 fica debaixo d'água; um de altura 9 continua seco.
    expect(isDry(MAX_TILE_HEIGHT - 1, TIDE.maxLevel)).toBe(false);
    expect(isDry(MAX_TILE_HEIGHT, TIDE.maxLevel)).toBe(true);
  });

  it('a água chega no teto em cerca de 35s (mesmo ritmo de antes)', () => {
    expect(tideLevel(0)).toBeCloseTo(TIDE.base);
    expect(tideLevel(20)).toBeLessThan(MAX_TILE_HEIGHT / 2);
    expect(tempoDoTeto()).toBeLessThan(40);
  });
});

describe('physics', () => {
  it('anda mais devagar na água', () => {
    const terrain = flatTerrain(5);
    const dry = createBody(2, 5);
    const wet = createBody(2, 5);
    for (let i = 0; i < 10; i++) {
      stepBody(dry, { dx: 1, dy: 0 }, terrain, 1, 1 / 30);
      stepBody(wet, { dx: 1, dy: 0 }, terrain, 6, 1 / 30);
    }
    expect(dry.x - 2).toBeCloseTo((CRAB.speed * 10) / 30, 3);
    expect(wet.x - 2).toBeCloseTo((CRAB.speed * CRAB.waterSpeedFactor * 10) / 30, 3);
  });

  it('não sobe paredões, mas nadando passa por cima de muro baixo', () => {
    const terrain = flatTerrain(1);
    terrain.heights[5 * 10 + 3] = 1 + CLIFF_HEIGHT;
    expect(isBlocked(terrain, 2, 5, 3, 5, 0)).toBe(true);
    // Maré acima do muro: é tudo água.
    expect(isBlocked(terrain, 2, 5, 3, 5, 5)).toBe(false);

    const body = createBody(2.5, 5.5);
    for (let i = 0; i < 30; i++) stepBody(body, { dx: 1, dy: 0 }, terrain, 0, 1 / 30);
    expect(body.x).toBeLessThan(3);
  });

  it('nadando, escala qualquer paredão pra sair da água', () => {
    const terrain = flatTerrain(0);
    for (let y = 0; y < 10; y++) for (let x = 5; x < 10; x++) terrain.heights[y * 10 + x] = 8;
    expect(isBlocked(terrain, 4, 5, 5, 5, 1)).toBe(false);
    const body = createBody(4.5, 5.5);
    for (let i = 0; i < 15; i++) stepBody(body, { dx: 1, dy: 0 }, terrain, 1, 1 / 30);
    expect(body.x).toBeGreaterThan(5);
  });

  it('não sai do mapa', () => {
    const body = createBody(0.5, 0.5);
    for (let i = 0; i < 30; i++) stepBody(body, { dx: -1, dy: -1 }, flatTerrain(3), 0, 1 / 30);
    expect(body.x).toBeGreaterThanOrEqual(CRAB.radius);
    expect(body.y).toBeGreaterThanOrEqual(CRAB.radius);
  });
});

describe('protocol', () => {
  it('rejeita lixo e mensagens desconhecidas', () => {
    expect(parseClientMessage('não é json')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
    expect(parseClientMessage('{"t":"hack"}')).toBeNull();
    expect(parseClientMessage('{"t":"input","seq":1,"dx":"a","dy":0}')).toBeNull();
  });

  it('normaliza input fora da faixa', () => {
    expect(parseClientMessage('{"t":"input","seq":3.7,"dx":50,"dy":-9,"dash":1}')).toEqual({
      t: 'input',
      seq: 3,
      dx: 1,
      dy: -1,
      dash: false,
      attack: false,
      grab: false,
    });
    expect(
      parseClientMessage(
        '{"t":"input","seq":1,"dx":0,"dy":0,"dash":true,"attack":true,"grab":true}',
      ),
    ).toMatchObject({ dash: true, attack: true, grab: true });
  });

  it('mantém a mira, a flag de mouse e o tempo visto; descarta o que é inválido', () => {
    const ok = parseClientMessage(
      '{"t":"input","seq":1,"dx":0,"dy":0,"fx":0.6,"fy":0.8,"mouse":true,"vt":12.5,"attack":true}',
    );
    expect(ok).toMatchObject({ fx: 0.6, fy: 0.8, mouse: true, vt: 12.5, attack: true });
    // Mira incompleta ou lixo: ignorada (o input em si continua valendo).
    expect(parseClientMessage('{"t":"input","seq":1,"dx":0,"dy":0,"fx":0.6}')).not.toHaveProperty(
      'fx',
    );
    expect(
      parseClientMessage('{"t":"input","seq":1,"dx":0,"dy":0,"fx":"a","fy":1,"vt":-3}'),
    ).not.toHaveProperty('fx');
    expect(parseClientMessage('{"t":"input","seq":1,"dx":0,"dy":0,"vt":-3}')).not.toHaveProperty(
      'vt',
    );
    // Valores enormes são limitados a [-1, 1].
    expect(
      parseClientMessage('{"t":"input","seq":1,"dx":0,"dy":0,"fx":99,"fy":-99}'),
    ).toMatchObject({ fx: 1, fy: -1 });
  });

  it('aceita só quantidades de rodada válidas', () => {
    expect(parseClientMessage('{"t":"setRounds","rounds":5}')).toEqual({
      t: 'setRounds',
      rounds: 5,
    });
    expect(parseClientMessage('{"t":"setRounds","rounds":4}')).toBeNull();
    expect(parseClientMessage('{"t":"setRounds","rounds":"7"}')).toBeNull();
    expect(parseClientMessage('{"t":"setRounds","rounds":99}')).toBeNull();
  });

  it('valida a seleção de mapas', () => {
    expect(parseClientMessage('{"t":"setMaps","maps":["porto","atol","porto"]}')).toEqual({
      t: 'setMaps',
      maps: ['atol', 'porto'],
    });
    expect(parseClientMessage('{"t":"setMaps","maps":[]}')).toBeNull();
    expect(parseClientMessage('{"t":"setMaps","maps":["lua"]}')).toBeNull();
    expect(parseClientMessage('{"t":"setMaps","maps":"porto"}')).toBeNull();
  });

  it('sanitiza nomes', () => {
    expect(sanitizeName('  <b>Zé</b>\u0000  ')).toBe('bZé/b');
    expect(sanitizeName('')).toBe('Siri');
    expect(sanitizeName(42)).toBe('Siri');
    expect(sanitizeName('a'.repeat(50))).toHaveLength(14);
  });
});

describe('armas', () => {
  it('raridade: revólver > espingarda > submetralhadora > bazuca', () => {
    const order = ['revolver', 'espingarda', 'submetralhadora', 'bazuca'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(WEAPONS[order[i]!].weight).toBeLessThan(WEAPONS[order[i - 1]!].weight);
    }
  });

  it('o sorteio respeita os pesos (40/30/20/10%)', () => {
    const n = 10_000;
    const count = Object.fromEntries(WEAPON_KINDS.map((k) => [k, 0])) as Record<string, number>;
    // Rolagens espalhadas por igual em [0, 1): mede a fatia de cada arma.
    for (let i = 0; i < n; i++) count[pickWeaponKind((i + 0.5) / n)]!++;
    expect(count.revolver! / n).toBeCloseTo(0.4, 2);
    expect(count.espingarda! / n).toBeCloseTo(0.3, 2);
    expect(count.submetralhadora! / n).toBeCloseTo(0.2, 2);
    expect(count.bazuca! / n).toBeCloseTo(0.1, 2);
  });
});

describe('dano percentual', () => {
  it('multiplica o empurrão: 0% = 1×, 100% = 2×, com teto de 3×', () => {
    expect(knockbackMultiplier(0)).toBe(1);
    expect(knockbackMultiplier(100)).toBe(2);
    expect(knockbackMultiplier(10_000)).toBe(3);
    expect(knockbackMultiplier(-50)).toBe(1);
  });
});

describe('room codes', () => {
  it('gera códigos válidos', () => {
    for (let i = 0; i < 50; i++) expect(isValidRoomCode(randomRoomCode())).toBe(true);
  });

  it('rejeita códigos inválidos', () => {
    for (const bad of ['abcd', 'AEIO', 'BCD', 'BCDFG', '', null, 1234]) {
      expect(isValidRoomCode(bad)).toBe(false);
    }
  });
});

describe('bazuca: alcance mirado', () => {
  it('vai até o ponto mirado, dentro dos limites', () => {
    expect(rocketRange(5)).toBe(5);
    expect(rocketRange(undefined)).toBe(WEAPONS.bazuca.reach); // toque/teclado: alcance todo
    expect(rocketRange(99)).toBe(WEAPONS.bazuca.reach);
    expect(rocketRange(0)).toBe(WEAPON_RULES.rocketMinRange);
    expect(rocketRange(Number.NaN)).toBe(WEAPONS.bazuca.reach);
  });

  it('o protocolo aceita a distância da mira e barra lixo', () => {
    const base = { t: 'input', seq: 1, dx: 0, dy: 0, fx: 1, fy: 0, mouse: true };
    const ok = parseClientMessage(JSON.stringify({ ...base, ad: 4.5 }));
    expect(ok && ok.t === 'input' && ok.ad).toBe(4.5);
    const negativo = parseClientMessage(JSON.stringify({ ...base, ad: -3 }));
    expect(negativo && negativo.t === 'input' && negativo.ad).toBeUndefined();
    const enorme = parseClientMessage(JSON.stringify({ ...base, ad: 1e9 }));
    expect(enorme && enorme.t === 'input' && enorme.ad).toBe(100);
    // Sem mira (fx/fy), a distância não vale nada.
    const semMira = parseClientMessage(JSON.stringify({ t: 'input', seq: 1, dx: 0, dy: 0, ad: 4 }));
    expect(semMira && semMira.t === 'input' && semMira.ad).toBeUndefined();
  });
});
