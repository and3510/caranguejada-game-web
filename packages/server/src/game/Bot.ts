import {
  CRAB,
  WEAPONS,
  WEAPON_RULES,
  heightAt,
  isBlocked,
  tideLevel,
  type Rng,
  type WeaponSpec,
} from '@caranguejada/shared';
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

const deg = (d: number) => (d * Math.PI) / 180;
/** Entre o bot distraído (skill 0) e o afiado (skill 1). */
const bySkill = (ruim: number, bom: number, skill: number) => ruim + (bom - ruim) * skill;

/**
 * Handicaps do bot. Sem eles o bot mira perfeito (o servidor ainda "puxava" o tiro pro
 * alvo), reage no mesmo tick em que alguém entra no alcance e anda sempre no talo —
 * três vantagens que nenhum humano tem.
 */
export const BOT = {
  /** Fração da velocidade do jogador que ele usa pra andar. */
  paceRuim: 0.78,
  paceBom: 0.92,
  /** Tempo entre uma decisão e outra (s): é o "tempo de pensar". */
  pensaRuim: 0.75,
  pensaBom: 0.4,
  /** Tempo olhando pro mesmo alvo antes de conseguir atirar (s). */
  miraRuim: 0.75,
  miraBom: 0.35,
  /** Erro de mira no meio do alcance; cresce com a distância e nunca zera de perto. */
  erroRuim: deg(20),
  erroBom: deg(9),
  /**
   * Arma de cone (espingarda) é quase impossível de errar: parte da abertura entra no
   * erro, senão o bot acerta 99% dos tiros só por apontar na direção certa.
   */
  erroDoCone: 0.4,
  /** Chance por tick de puxar o gatilho quando já está mirado. */
  gatilhoRuim: 0.07,
  gatilhoBom: 0.16,
  /** Respiro depois de cada tiro, além da recarga da arma (s). */
  pausaRuim: 0.7,
  pausaBom: 0.3,
  /**
   * Susto: alguém chegando perto atrapalha o bot — até esta distância (tiles) ele precisa
   * de mais tempo pra engatar o tiro e erra mais.
   */
  sustoAte: 2.5,
  /**
   * Mas encostado mesmo não tem susto: aí ele atira rápido e certeiro. Hesitar com alguém
   * grudado nele seria burrice, não dificuldade.
   */
  coladoAte: 0.9,
  /** Quanto da espera normal ele ainda cumpre quando o alvo está encostado. */
  coladoMira: 0.35,
  sustoMiraRuim: 0.9,
  sustoMiraBom: 0.45,
  sustoErro: deg(12),
} as const;

interface Goal {
  x: number;
  y: number;
  dash?: boolean;
}

/**
 * IA simples e um pouco desastrada de propósito: pensa em intervalos
 * (tempo de reação), foge da maré, corre atrás de arma e atira em quem
 * está na beirada. Desarmada, foge de quem está armado.
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
  /** Alvo que está sendo mirado agora e desde quando (o bot demora pra "fixar"). */
  private aimingAt: string | null = null;
  private aimingSince = 0;
  /** O alvo já estava colado no tick passado? (entrar na zona de susto zera a mira) */
  private wasClose = false;
  /** Tempo de simulação em que ele pode atirar de novo (respiro além da recarga). */
  private nextShotAt = 0;

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
      this.thinkTimer = bySkill(BOT.pensaRuim, BOT.pensaBom, this.skill) + this.rng() * 0.15;
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

    // Anda abaixo do talo: o jogador dá uma esticada nele quando precisa.
    const pace = bySkill(BOT.paceRuim, BOT.paceBom, this.skill);
    const input: CrabInput = {
      dx: dx * pace,
      dy: dy * pace,
      dash: goal?.dash === true,
      attack: false,
      grab: false,
      seq: ++this.seq,
    };
    // O dash é disparado uma vez por decisão.
    if (goal) goal.dash = false;
    this.reflexes(sim, me, input);
    return input;
  }

  /**
   * Reflexos, checados a cada tick: pegar a arma em que está pisando e atirar em quem
   * está no alcance — depois de passar um tempo mirando, e errando um pouco de propósito.
   */
  private reflexes(sim: Simulation, me: Crab, input: CrabInput): void {
    if (me.stunT > 0) {
      // Levou tiro: perde a mira e começa de novo. Quem atira primeiro leva vantagem.
      this.aimingAt = null;
      this.wasClose = false;
      return;
    }
    if (!me.weapon) {
      input.grab = sim.weapons.some(
        (w) => Math.hypot(w.x - me.x, w.y - me.y) < WEAPON_RULES.pickupRadius * 0.8,
      );
      this.aimingAt = null;
      return;
    }
    const spec = WEAPONS[me.weapon];
    const alvo = this.pickShotTarget(sim, me, spec);
    if (!alvo) {
      this.aimingAt = null;
      this.wasClose = false;
      return;
    }
    const colado = alvo.d <= BOT.coladoAte;
    // Encostado não assusta: o susto é de quem vem chegando, não de quem já está em cima.
    const perto = !colado && alvo.d < BOT.sustoAte;
    // Trocou de alvo? Recomeça a mirar: ninguém acerta de primeira em quem acabou de aparecer.
    if (this.aimingAt !== alvo.id) {
      this.aimingAt = alvo.id;
      this.aimingSince = sim.time;
    } else if (perto && !this.wasClose) {
      // Alguém que estava longe colou em você: susto, perde a mira e recomeça. Sem isto,
      // um bot que já vinha rastreando de longe atirava no mesmo instante em que você chegava.
      this.aimingSince = sim.time;
    }
    this.wasClose = perto;
    if (me.attackCooldown > 0 || sim.time < this.nextShotAt) return;
    // Quanto mais colado o alvo, mais tempo ele leva pra engatar. Como isso é recalculado
    // a cada tick, chegar perto de um bot que já estava mirando faz ele hesitar de novo.
    const susto = colado ? 0 : Math.max(0, 1 - alvo.d / BOT.sustoAte);
    const base = bySkill(BOT.miraRuim, BOT.miraBom, this.skill);
    const precisaMirar = colado
      ? base * BOT.coladoMira
      : base + bySkill(BOT.sustoMiraRuim, BOT.sustoMiraBom, this.skill) * susto;
    if (sim.time - this.aimingSince < precisaMirar) return;
    if (this.rng() > bySkill(BOT.gatilhoRuim, BOT.gatilhoBom, this.skill)) return;
    // Além da recarga da arma: o bot não emenda um tiro no outro como uma torreta.
    this.nextShotAt = sim.time + spec.cooldown + bySkill(BOT.pausaRuim, BOT.pausaBom, this.skill);

    // Mira torta de propósito: erra mais de longe e quanto pior o bot. Vai em fx/fy
    // (mira própria, separada do andar) e com `mouse` ligado, senão o servidor "puxava"
    // o tiro de volta pro alvo e o erro não valia de nada.
    const reach = spec.reach + CRAB.radius;
    const erro =
      bySkill(BOT.erroRuim, BOT.erroBom, this.skill) * (0.8 + alvo.d / reach) +
      spec.arc * BOT.erroDoCone +
      BOT.sustoErro * susto;
    const ang = Math.atan2(alvo.dy, alvo.dx) + (this.rng() * 2 - 1) * erro;
    input.fx = Math.cos(ang);
    input.fy = Math.sin(ang);
    input.mouse = true;
    input.attack = true;
  }

  /** Quem dá pra acertar daqui sem se machucar (rebote nas costas, explosão colada). */
  private pickShotTarget(
    sim: Simulation,
    me: Crab,
    spec: WeaponSpec,
  ): { id: string; dx: number; dy: number; d: number } | null {
    const reach = spec.reach + CRAB.radius - 0.1;
    for (const other of sim.crabs.values()) {
      if (other.id === me.id || !other.alive) continue;
      const dx = other.x - me.x;
      const dy = other.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d > reach || d < 1e-3) continue;
      // Bazuca colada no alvo: a explosão pegaria o próprio bot.
      if (spec.style === 'rocket' && d < WEAPON_RULES.blastRadius + 0.8) continue;
      // Rebote forte (espingarda, bazuca) com água às costas jogaria o próprio bot no mar.
      if (spec.style === 'spread' || spec.style === 'rocket') {
        const behind = heightAt(
          sim.terrain,
          Math.floor(me.x - (dx / d) * 2),
          Math.floor(me.y - (dy / d) * 2),
        );
        if (behind < sim.level + 0.5) continue;
      }
      return { id: other.id, dx, dy, d };
    }
    return null;
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

    // 1) Briga (só armado): persegue alguém perto. Prefere quem está mais perto da água.
    if (me.weapon && this.rng() < 0.45 + this.skill * 0.45) {
      let target: Crab | null = null;
      let bestScore = -Infinity;
      for (const other of sim.crabs.values()) {
        if (other.id === me.id || !other.alive) continue;
        const d = Math.hypot(other.x - me.x, other.y - me.y);
        // Com arma de fogo dá pra escolher alvo mais longe.
        if (d > Math.max(4.5, WEAPONS[me.weapon].reach + 1)) continue;
        const otherFloor = heightAt(sim.terrain, Math.floor(other.x), Math.floor(other.y));
        const score = -d - (otherFloor - level) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          target = other;
        }
      }
      if (target) {
        const d = Math.hypot(target.x - me.x, target.y - me.y);
        const reach = WEAPONS[me.weapon].reach;
        // Dash só para encurtar a distância: quem bate é a arma.
        const close = me.dashCooldown <= 0 && d > reach + 0.8 && d < 3.5 && this.rng() < 0.35;
        // Mira um pouco à frente: o alvo também se mexe.
        return { x: target.x + target.fx * 0.3, y: target.y + target.fy * 0.3, dash: close };
      }
    }

    // 1b) Desarmado com alguém armado colado: sai de perto (às vezes no dash).
    if (!me.weapon) {
      const threat = [...sim.crabs.values()].find(
        (o) => o.id !== me.id && o.alive && o.weapon && Math.hypot(o.x - me.x, o.y - me.y) < 2.2,
      );
      if (threat && this.rng() < 0.3 + this.skill * 0.4) {
        const d = Math.hypot(me.x - threat.x, me.y - threat.y) || 1;
        const away = {
          x: me.x + ((me.x - threat.x) / d) * 3,
          y: me.y + ((me.y - threat.y) / d) * 3,
        };
        const awayFloor = heightAt(sim.terrain, Math.floor(away.x), Math.floor(away.y));
        // Fugir pra água é pior que apanhar: nesse caso deixa o resto da cabeça decidir.
        if (awayFloor >= level + 0.5) {
          return { ...away, dash: me.dashCooldown <= 0 && this.rng() < 0.35 };
        }
      }
    }

    // 1c) Desarmado com arma bem perto (até boiando no raso, no fim da enchente): pega antes
    //     de fugir da água. Com ela dá pra jogar os outros pro fundo.
    if (!me.weapon) {
      const near = sim.weapons.find((w) => {
        const floor = heightAt(sim.terrain, Math.floor(w.x), Math.floor(w.y));
        return Math.hypot(w.x - me.x, w.y - me.y) < 3.5 && level - floor < CRAB.deepWater;
      });
      if (near) return { x: near.x, y: near.y };
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

    // 3) Desarmado: vai buscar a arma mais perto que ainda esteja em terra.
    if (!me.weapon) {
      let bestWeapon: Goal | null = null;
      let bestWeaponDist = 8 + this.skill * 6;
      for (const w of sim.weapons) {
        const d = Math.hypot(w.x - me.x, w.y - me.y);
        const floor = heightAt(sim.terrain, Math.floor(w.x), Math.floor(w.y));
        if (d < bestWeaponDist && floor >= level + 0.3) {
          bestWeaponDist = d;
          bestWeapon = { x: w.x, y: w.y };
        }
      }
      if (bestWeapon) return bestWeapon;
    }

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
