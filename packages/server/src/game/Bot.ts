import { heightAt, isBlocked, tideLevel, type Rng } from '@caranguejada/shared';
import type { Crab, CrabInput, Simulation } from './Simulation';

const BOT_NAMES = [
  'Guaiamum',
  'Siri Mole',
  'Aratu',
  'Maria Farinha',
  'Uçá',
  'Chama-Maré',
  'Ermitão',
  'Caranguejo-Rei',
  'Sirizinho',
  'Dona Pinça',
];

export function botName(index: number): string {
  return BOT_NAMES[index % BOT_NAMES.length]!;
}

interface Goal {
  x: number;
  y: number;
  dash?: boolean;
}

/**
 * IA simples e um pouco desastrada de propósito: pensa em intervalos
 * (tempo de reação), foge da maré, cata conchas e empurra quem está na beirada.
 */
export class Bot {
  private thinkTimer = 0;
  private goal: Goal | null = null;
  private stuckTimer = 0;
  private lastPos = { x: 0, y: 0 };
  private wanderUntil = 0;
  private wanderDir = { x: 0, y: 0 };
  private seq = 0;
  /** Sorteado ao cair na água; null quando está em terra. */
  private calmInWater: boolean | null = null;

  constructor(
    readonly id: string,
    private readonly rng: Rng,
    /** 0 = distraído, 1 = afiado. */
    private readonly skill = 0.5 + rng() * 0.4,
  ) {}

  update(sim: Simulation, dt: number): CrabInput | null {
    const me = sim.crabs.get(this.id);
    if (!me || !me.alive) return null;

    this.trackStuck(me, sim.time, dt);
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.35 - this.skill * 0.2 + this.rng() * 0.1;
      this.goal = this.think(sim, me);
    }

    const goal = this.goal;
    let dx = 0;
    let dy = 0;
    if (sim.time < this.wanderUntil) {
      dx = this.wanderDir.x;
      dy = this.wanderDir.y;
    } else if (goal) {
      const gx = goal.x - me.x;
      const gy = goal.y - me.y;
      const len = Math.hypot(gx, gy);
      if (len > 0.2) {
        dx = gx / len;
        dy = gy / len;
      }
    }

    const input: CrabInput = {
      dx,
      dy,
      dash: goal?.dash === true,
      seq: ++this.seq,
    };
    // O bote é disparado uma vez por decisão.
    if (goal) goal.dash = false;
    return input;
  }

  private trackStuck(me: Crab, time: number, dt: number): void {
    const moved = Math.hypot(me.x - this.lastPos.x, me.y - this.lastPos.y);
    this.lastPos = { x: me.x, y: me.y };
    if (this.goal && moved < 0.01 && Math.hypot(this.goal.x - me.x, this.goal.y - me.y) > 0.6) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = 0;
    }
    if (this.stuckTimer > 0.8) {
      const angle = this.rng() * Math.PI * 2;
      this.wanderDir = { x: Math.cos(angle), y: Math.sin(angle) };
      this.wanderUntil = time + 0.5 + this.rng() * 0.5;
      this.stuckTimer = 0;
    }
  }

  private think(sim: Simulation, me: Crab): Goal | null {
    const level = sim.level;
    const soon = tideLevel(sim.time + 5);
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    const here = heightAt(sim.terrain, tx, ty);

    // 0) Caiu na água: tenta voltar pra terra. Bot afobado nem sempre lembra do dash
    //    (senão ninguém afunda e a rodada perde a graça).
    if (here < level) {
      // Decide uma vez por queda: ou mantém a calma (e usa o dash), ou entra em pânico.
      this.calmInWater ??= this.rng() < 0.2 + this.skill * 0.25;
      const shore = this.findNearestDry(sim, me, level);
      if (shore) {
        const d = Math.hypot(shore.x - me.x, shore.y - me.y);
        return { ...shore, dash: me.dashCooldown <= 0 && d > 1.2 && this.calmInWater };
      }
    } else {
      this.calmInWater = null;
    }

    // 1) Briga: alguém ao alcance. Prefere quem está mais perto da água.
    if (me.dashCooldown <= 0 && this.rng() < 0.45 + this.skill * 0.45) {
      let target: Crab | null = null;
      let bestScore = -Infinity;
      for (const other of sim.crabs.values()) {
        if (other.id === me.id || !other.alive) continue;
        const d = Math.hypot(other.x - me.x, other.y - me.y);
        if (d > 3.5) continue;
        const otherFloor = heightAt(sim.terrain, Math.floor(other.x), Math.floor(other.y));
        const score = -d - (otherFloor - level) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          target = other;
        }
      }
      if (target) {
        const d = Math.hypot(target.x - me.x, target.y - me.y);
        // Mira um pouco à frente: o alvo também se mexe.
        return { x: target.x + target.fx * 0.3, y: target.y + target.fy * 0.3, dash: d < 2.4 };
      }
    }

    // 2) Perigo: a água vai pegar onde estou. Longe do refúgio? Dash pra chegar antes.
    if (here < soon + 0.5) {
      const refuge = this.findHighGround(sim, me, soon);
      if (refuge) {
        const d = Math.hypot(refuge.x - me.x, refuge.y - me.y);
        const hurry = me.dashCooldown <= 0 && d > 3 && this.rng() < 0.3 + this.skill * 0.4;
        return { ...refuge, dash: hurry };
      }
    }

    // 3) Conchas próximas e seguras o bastante.
    let bestShell: Goal | null = null;
    let bestDist = 7 + this.skill * 4;
    for (const shell of sim.shells) {
      const d = Math.hypot(shell.x - me.x, shell.y - me.y);
      const floor = heightAt(sim.terrain, Math.floor(shell.x), Math.floor(shell.y));
      if (d < bestDist && floor >= level - 0.5) {
        bestDist = d;
        bestShell = { x: shell.x, y: shell.y };
      }
    }
    if (bestShell) return bestShell;

    // 4) Passear pelo alto.
    return this.findHighGround(sim, me, level) ?? { x: me.x, y: me.y };
  }

  /** Terra seca mais perta: na água, distância importa mais que altura. */
  private findNearestDry(sim: Simulation, me: Crab, level: number): Goal | null {
    const cx = Math.floor(me.x);
    const cy = Math.floor(me.y);
    let best: Goal | null = null;
    let bestScore = -Infinity;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const h = heightAt(sim.terrain, cx + dx, cy + dy);
        if (h < level + 0.5) continue;
        const score = -Math.hypot(dx, dy) + h * 0.05;
        if (score > bestScore) {
          bestScore = score;
          best = { x: cx + dx + 0.5, y: cy + dy + 0.5 };
        }
      }
    }
    return best ?? this.findHighGround(sim, me, level);
  }

  private findHighGround(sim: Simulation, me: Crab, mustBeAbove: number): Goal | null {
    const cx = Math.floor(me.x);
    const cy = Math.floor(me.y);
    let best: Goal | null = null;
    let bestScore = -Infinity;
    const radius = 9;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        const h = heightAt(sim.terrain, tx, ty);
        if (h < mustBeAbove + 0.3) continue;
        const dist = Math.hypot(dx, dy);
        // Evita mirar num paredão logo ao lado.
        if (dist < 1.5 && isBlocked(sim.terrain, cx, cy, tx, ty, sim.level)) continue;
        const score = h - dist * 0.45 + this.rng() * 0.8;
        if (score > bestScore) {
          bestScore = score;
          best = { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    return best;
  }
}
