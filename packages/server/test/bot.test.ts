import { describe, expect, it } from 'vitest';
import {
  CRAB,
  MAX_TILE_HEIGHT,
  createRng,
  generateTerrain,
  type Terrain,
} from '@caranguejada/shared';
import { Bot, BOT } from '../src/game/Bot';
import { Simulation } from '../src/game/Simulation';

const DT = 1 / 30;

/** Bot afiado (skill 1) com revólver, e um alvo em terra alta à distância escolhida. */
function duelo(skill = 1, dist = 3) {
  const sim = new Simulation(3, ['b', 'alvo'], generateTerrain(3, 'morro'));
  sim.weapons.length = 0;
  sim.giveWeapon('b', 'revolver');
  const bot = new Bot('b', createRng(9), skill);
  const alvo = sim.crabs.get('alvo')!;
  const eu = sim.crabs.get('b')!;
  let distancia = dist;
  // Mantém a geometria fixa: o teste é sobre a decisão do bot, não sobre o passeio dele.
  const fixa = () => {
    eu.x = 20;
    eu.y = 14;
    eu.breath = 1;
    alvo.x = 20 + distancia;
    alvo.y = 14;
    alvo.breath = 1;
  };
  const tick = () => {
    fixa();
    const input = bot.update(sim, DT);
    if (input) sim.setInput('b', input);
    sim.step(DT);
    fixa();
    return input;
  };
  /** Aproxima (ou afasta) o alvo: é o que acontece quando o jogador chega perto. */
  const aproxima = (d: number) => {
    distancia = d;
    fixa();
  };
  return { sim, bot, tick, aproxima };
}

/** Quantos ticks até o bot puxar o gatilho (com teto, pra não travar o teste). */
function ticksAteAtirar(tick: () => { attack: boolean } | null, maxTicks = 600): number {
  for (let i = 0; i < maxTicks; i++) if (tick()?.attack) return i;
  return maxTicks;
}

describe('Bot: handicaps', () => {
  it('não atira no mesmo instante em que o alvo aparece: precisa mirar antes', () => {
    const { tick } = duelo(1);
    // O bot mais afiado ainda leva BOT.miraBom segundos pra fixar o alvo.
    const ticksMirando = Math.floor(BOT.miraBom / DT);
    for (let i = 0; i < ticksMirando; i++) {
      expect(tick()?.attack ?? false).toBe(false);
    }
  });

  it('erra de propósito: os tiros não saem todos na direção exata do alvo', () => {
    const { tick } = duelo(1);
    const angulos: number[] = [];
    for (let i = 0; i < 3000 && angulos.length < 12; i++) {
      const input = tick();
      // O alvo está exatamente a leste: a direção perfeita seria (1, 0).
      if (input?.attack && input.fx !== undefined && input.fy !== undefined) {
        angulos.push(Math.atan2(input.fy, input.fx));
      }
    }
    expect(angulos.length).toBeGreaterThan(5);
    expect(new Set(angulos).size).toBeGreaterThan(1); // não é sempre o mesmo ângulo
    const maior = Math.max(...angulos.map(Math.abs));
    expect(maior).toBeGreaterThan(0.02); // erra de verdade
    expect(maior).toBeLessThan(BOT.erroRuim * 3); // mas não atira pro lado oposto
  });

  it('manda a mira pronta (fx/fy + mouse): o servidor não "puxa" o tiro pro alvo', () => {
    const { tick } = duelo(1);
    for (let i = 0; i < 3000; i++) {
      const input = tick();
      if (input?.attack) {
        expect(input.fx).toBeDefined();
        expect(input.mouse).toBe(true);
        return;
      }
    }
    throw new Error('o bot nunca atirou');
  });

  it('o bot ruim erra mais que o afiado', () => {
    const erroMedio = (skill: number) => {
      const { tick } = duelo(skill);
      const erros: number[] = [];
      for (let i = 0; i < 6000 && erros.length < 25; i++) {
        const input = tick();
        if (input?.attack && input.fx !== undefined && input.fy !== undefined) {
          erros.push(Math.abs(Math.atan2(input.fy, input.fx)));
        }
      }
      return erros.reduce((a, b) => a + b, 0) / erros.length;
    };
    expect(erroMedio(0)).toBeGreaterThan(erroMedio(1));
  });

  it('anda abaixo da velocidade máxima (o jogador consegue escapar)', () => {
    const sim = new Simulation(4, ['b', 'alvo'], generateTerrain(4, 'morro'));
    const bot = new Bot('b', createRng(2), 1);
    let maior = 0;
    for (let i = 0; i < 200; i++) {
      const input = bot.update(sim, DT);
      if (input) {
        maior = Math.max(maior, Math.hypot(input.dx, input.dy));
        sim.setInput('b', input);
      }
      sim.step(DT);
    }
    expect(maior).toBeGreaterThan(0); // ele anda
    expect(maior).toBeLessThanOrEqual(BOT.paceBom + 1e-9); // mas nunca no talo
    expect(BOT.paceBom).toBeLessThan(1);
  });

  it('alguém colando nele faz hesitar de novo, mesmo já estando de olho de longe', () => {
    const { tick, aproxima } = duelo(1, 6);
    // Deixa ele rastrear à vontade de longe: já está pronto pra atirar.
    for (let i = 0; i < 120; i++) tick();
    // Agora o jogador cola nele: tem que hesitar antes de engatar o tiro.
    aproxima(1);
    const minimo = Math.floor(((BOT.miraBom + BOT.sustoMiraBom) / DT) * 0.8);
    for (let i = 0; i < minimo; i++) {
      expect(tick()?.attack ?? false).toBe(false);
    }
  });

  it('demora mais pra atirar em quem chegou perto do que em quem está longe', () => {
    const perto = ticksAteAtirar(duelo(1, 1.5).tick);
    const longe = ticksAteAtirar(duelo(1, 6).tick);
    expect(perto).toBeGreaterThan(longe);
  });

  it('encostado nele não tem hesitação: atira rápido (hesitar aí seria burrice)', () => {
    const encostado = ticksAteAtirar(duelo(1, 0.6).tick);
    const perto = ticksAteAtirar(duelo(1, 1.5).tick);
    expect(encostado).toBeLessThan(perto);
    // E rápido de verdade, não só "menos lento".
    expect(encostado * DT).toBeLessThan(BOT.miraBom + BOT.sustoMiraBom);
  });

  it('encostado ele acerta: a mira sai quase em cima do alvo', () => {
    const { tick } = duelo(1, 0.6);
    const erros: number[] = [];
    for (let i = 0; i < 3000 && erros.length < 15; i++) {
      const input = tick();
      if (input?.attack && input.fx !== undefined && input.fy !== undefined) {
        erros.push(Math.abs(Math.atan2(input.fy, input.fx)));
      }
    }
    expect(erros.length).toBeGreaterThan(5);
    // O alvo encostado ocupa uns 40 graus de ângulo: esse erro sempre acerta.
    expect(Math.max(...erros)).toBeLessThan(0.35);
  });

  it('levar tiro faz o bot perder a mira (quem atira primeiro leva vantagem)', () => {
    const { sim, tick } = duelo(1);
    const eu = sim.crabs.get('b')!;
    // Deixa ele mirar à vontade e confirma que chegou a atirar.
    let atirou = false;
    for (let i = 0; i < 300 && !atirou; i++) atirou = tick()?.attack === true;
    expect(atirou).toBe(true);
    // Agora toma um tiro: enquanto está tonto, não atira.
    eu.stunT = CRAB.dashSeconds;
    for (let i = 0; i < 3; i++) expect(tick()?.attack ?? false).toBe(false);
  });
});

/** Planície de terra na altura `h`, 40×28, pra montar cenários na mão. */
function plain(h: number): Terrain {
  const width = 40;
  const height = 28;
  return { width, height, heights: new Uint8Array(width * height).fill(h) };
}
const at = (t: Terrain, x: number, y: number, h: number) => {
  t.heights[y * t.width + x] = h;
};

/** Roda o bot por `seconds` com o alvo preso no lugar; diz se atirou e onde terminou. */
function runWithPinnedTarget(
  sim: Simulation,
  bot: Bot,
  target: { x: number; y: number },
  seconds: number,
) {
  const alvo = sim.crabs.get('alvo')!;
  let atirou = false;
  for (let i = 0; i < seconds / DT; i++) {
    alvo.x = target.x;
    alvo.y = target.y;
    alvo.breath = 1;
    const input = bot.update(sim, DT);
    if (input) {
      sim.setInput('b', input);
      if (input.attack) atirou = true;
    }
    sim.step(DT);
  }
  return { atirou, eu: sim.crabs.get('b')! };
}

describe('Bot: não fica parado na frente do outro', () => {
  it('espingarda numa ilhota cercada de água funda: atira daqui (antes travava)', () => {
    // Ilhota 3×3, como o refúgio no fim da enchente: água funda em volta toda. O alvo está
    // na outra beira. O rebote só empurra ~1,2 tile, então do meio da ilhota dá pra atirar;
    // a regra antiga (qualquer água a 2 tiles das costas) deixava o bot parado ali pra sempre.
    const t = plain(0);
    for (let y = 13; y <= 15; y++) for (let x = 19; x <= 21; x++) at(t, x, y, MAX_TILE_HEIGHT);
    const sim = new Simulation(1, ['b', 'alvo'], t);
    sim.time = 10; // nível ~1,95: tudo em volta é água funda
    sim.weapons.length = 0;
    sim.giveWeapon('b', 'espingarda');
    const eu = sim.crabs.get('b')!;
    eu.x = 19.5;
    eu.y = 14.5;
    const bot = new Bot('b', createRng(3), 1);
    const { atirou } = runWithPinnedTarget(sim, bot, { x: 21.5, y: 14.5 }, 4);
    expect(atirou).toBe(true);
    expect(eu.alive).toBe(true);
  });

  it('bazuca com o alvo colado: recua pra não se explodir e atira', () => {
    const sim = new Simulation(1, ['b', 'alvo'], plain(5));
    sim.weapons.length = 0;
    sim.giveWeapon('b', 'bazuca');
    const eu = sim.crabs.get('b')!;
    eu.x = 20;
    eu.y = 14;
    const bot = new Bot('b', createRng(4), 1);
    const { atirou, eu: depois } = runWithPinnedTarget(sim, bot, { x: 21.2, y: 14 }, 5);
    expect(atirou).toBe(true);
    // Atirou de longe o bastante pra explosão não pegar nele.
    expect(Math.hypot(depois.x - 21.2, depois.y - 14)).toBeGreaterThan(2);
  });
});

describe('Bot: atravessa o mapa até o refúgio', () => {
  it('com a água chegando, vai até o refúgio do outro lado da ilha (antes só via 9 tiles)', () => {
    // Planície que vai alagar e o refúgio (altura máxima) a ~30 tiles de distância.
    const t = plain(5);
    for (let y = 12; y < 16; y++) for (let x = 35; x < 37; x++) at(t, x, y, MAX_TILE_HEIGHT);
    const sim = new Simulation(1, ['b', 'alvo'], t);
    sim.time = 14; // a planície vai alagar em poucos segundos
    sim.weapons.length = 0;
    const eu = sim.crabs.get('b')!;
    eu.x = 4.5;
    eu.y = 14;
    const outro = sim.crabs.get('alvo')!;
    const bot = new Bot('b', createRng(5), 1);
    let usouDash = false;
    let chegou = false;
    for (let i = 0; i < 12 / DT && !chegou; i++) {
      outro.alive = false; // sozinho no mapa: o teste é só o caminho
      const input = bot.update(sim, DT);
      if (input) {
        sim.setInput('b', input);
        if (input.dash) usouDash = true;
      }
      sim.step(DT);
      chegou = eu.x >= 34;
    }
    expect(chegou).toBe(true);
    expect(eu.alive).toBe(true);
    expect(usouDash).toBe(true);
  });

  it('armado, não larga o seco pra perseguir quem caiu na água em volta', () => {
    // Refúgio seco no meio; o alvo boiando na água rasa ao lado.
    const t = plain(0);
    for (let y = 12; y < 16; y++) for (let x = 18; x < 22; x++) at(t, x, y, MAX_TILE_HEIGHT);
    const sim = new Simulation(1, ['b', 'alvo'], t);
    sim.time = 60; // a água já está no teto
    sim.weapons.length = 0;
    sim.giveWeapon('b', 'revolver');
    const eu = sim.crabs.get('b')!;
    eu.x = 20;
    eu.y = 14;
    let saiu = false;
    const bot = new Bot('b', createRng(6), 1);
    const alvo = sim.crabs.get('alvo')!;
    for (let i = 0; i < 4 / DT; i++) {
      alvo.x = 27; // fora do alcance? não: 7 tiles, dentro do revólver; mas na água
      alvo.y = 14;
      alvo.breath = 1;
      const input = bot.update(sim, DT);
      if (input) sim.setInput('b', input);
      sim.step(DT);
      if (eu.x < 18 || eu.x > 22 || eu.y < 12 || eu.y > 16) saiu = true;
    }
    expect(saiu).toBe(false);
  });
});
