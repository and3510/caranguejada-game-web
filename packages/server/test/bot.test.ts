import { describe, expect, it } from 'vitest';
import { CRAB, createRng, generateTerrain } from '@caranguejada/shared';
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
