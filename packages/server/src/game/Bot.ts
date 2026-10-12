import {
  CRAB,
  WEAPONS,
  WEAPON_RULES,
  heightAt,
  isBlocked,
  TIDE,
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
  miraRuim: 0.6,
  miraBom: 0.28,
  /** Erro de mira no meio do alcance; cresce com a distância e nunca zera de perto. */
  erroRuim: deg(13),
  erroBom: deg(5),
  /**
   * Arma de cone (espingarda) é quase impossível de errar: parte da abertura entra no
   * erro, senão o bot acerta 99% dos tiros só por apontar na direção certa.
   */
  erroDoCone: 0.28,
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
  /** Até onde o bot armado vai atrás de briga (tiles). Antes: só o alcance da arma + 1. */
  cacaAte: 12,
  /** Chance de, mesmo armado e com alguém por perto, preferir dar uma volta (bot distraído). */
  distraidoRuim: 0.15,
  distraidoBom: 0.02,
  /** Terra "segura": ainda vai estar seca por este tempo depois que ele chegar lá (s). */
  folgaSeca: 6,
  /** Rebote da espingarda/bazuca empurra uns 1,2 tile em terra: é isso que ele confere atrás. */
  reboteAte: 1.3,
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
  /** Quem já deu o susto nele: o mesmo alvo não assusta duas vezes seguidas. */
  private startledBy: string | null = null;
  /** Lugar seguro escolhido da última vez: mantém, em vez de sortear outro a cada decisão. */
  private safeSpot: Goal | null = null;
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
      this.startledBy = null;
      return;
    }
    const colado = alvo.d <= BOT.coladoAte;
    // Encostado não assusta: o susto é de quem vem chegando, não de quem já está em cima.
    const perto = !colado && alvo.d < BOT.sustoAte;
    // Trocou de alvo? Recomeça a mirar: ninguém acerta de primeira em quem acabou de aparecer.
    if (this.aimingAt !== alvo.id) {
      this.aimingAt = alvo.id;
      this.aimingSince = sim.time;
    } else if (perto && !this.wasClose && this.startledBy !== alvo.id) {
      // Alguém que estava longe colou em você: susto, perde a mira e recomeça. Sem isto,
      // um bot que já vinha rastreando de longe atirava no mesmo instante em que você chegava.
      // Só uma vez por alvo: quem fica indo e vindo na borda não trava o bot pra sempre.
      this.aimingSince = sim.time;
      this.startledBy = alvo.id;
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

  /**
   * Em quem atirar: o mais perto que dá pra acertar sem se machucar. Se o alvo de agora
   * ainda vale, fica nele (trocar de alvo recomeça a mira) — a menos que outro esteja bem
   * mais perto.
   */
  private pickShotTarget(
    sim: Simulation,
    me: Crab,
    spec: WeaponSpec,
  ): { id: string; dx: number; dy: number; d: number } | null {
    const reach = spec.reach + CRAB.radius - 0.1;
    type Target = { id: string; dx: number; dy: number; d: number };
    let best: Target | null = null;
    let current: Target | null = null;
    for (const other of sim.crabs.values()) {
      if (other.id === me.id || !other.alive) continue;
      const dx = other.x - me.x;
      const dy = other.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d > reach || d < 1e-3) continue;
      // Bazuca colada no alvo: a explosão pegaria o próprio bot.
      if (spec.style === 'rocket' && d < WEAPON_RULES.blastRadius + 0.8) continue;
      // Rebote forte (espingarda, bazuca): não atira se o tranco o jogaria em água funda.
      // Água rasa não mata, então ela não segura o tiro (antes qualquer água segurava, e no
      // fim da enchente, com água atrás de todo mundo, ele ficava parado na frente do outro).
      if (
        (spec.style === 'spread' || spec.style === 'rocket') &&
        this.recoilIntoDeep(sim, me, dx / d, dy / d)
      ) {
        continue;
      }
      const t = { id: other.id, dx, dy, d };
      if (other.id === this.aimingAt) current = t;
      if (!best || d < best.d) best = t;
    }
    if (current && best && best.d > current.d * 0.6) return current;
    return best;
  }

  /** O rebote de um tiro nesta direção, saindo de (x, y), levaria o bot pra água funda? */
  private recoilIntoDeep(
    sim: Simulation,
    from: { x: number; y: number },
    dirX: number,
    dirY: number,
  ): boolean {
    const h = heightAt(
      sim.terrain,
      Math.floor(from.x - dirX * BOT.reboteAte),
      Math.floor(from.y - dirY * BOT.reboteAte),
    );
    return sim.level - h >= CRAB.deepWater;
  }

  /**
   * Espingarda e bazuca têm restrição: o rebote não pode jogá-lo em água funda, e a bazuca
   * não pode explodir colada nele. Se daqui não dá pra atirar no alvo, procura um lugar
   * perto de onde dê (dando a volta pra ficar com terra nas costas, ou recuando pra ganhar
   * distância). Sem isto ele ficava parado na frente do outro, sem atirar.
   * Devolve null se daqui já dá (ou se não achou lugar melhor).
   */
  private firingSpot(sim: Simulation, me: Crab, target: Crab, spec: WeaponSpec): Goal | null {
    const minD = spec.style === 'rocket' ? WEAPON_RULES.blastRadius + 1 : 0;
    const maxD = spec.reach * 0.85;
    const ok = (x: number, y: number) => {
      const dx = target.x - x;
      const dy = target.y - y;
      const d = Math.hypot(dx, dy);
      return (
        d >= minD && d <= maxD && d > 1e-3 && !this.recoilIntoDeep(sim, { x, y }, dx / d, dy / d)
      );
    };
    if (ok(me.x, me.y)) return null;
    const cx = Math.floor(me.x);
    const cy = Math.floor(me.y);
    let best: Goal | null = null;
    let bestDist = Infinity;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (heightAt(sim.terrain, tx, ty) < sim.level + 0.3) continue;
        const px = tx + 0.5;
        const py = ty + 0.5;
        if (!ok(px, py)) continue;
        const dist = Math.hypot(px - me.x, py - me.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = { x: px, y: py };
        }
      }
    }
    return best;
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
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    const here = heightAt(sim.terrain, tx, ty);

    // 0) Caiu na água: volta pra terra. Com fôlego sobrando, mira num lugar que ainda vai
    //    estar seco quando chegar (no fim da enchente, o refúgio, mesmo do outro lado do
    //    mapa); com pouco fôlego, a terra mais perto, seja qual for. Bot afobado nem sempre
    //    lembra do dash (senão ninguém afunda e a rodada perde a graça).
    if (here < level) {
      // Decide uma vez por queda: ou mantém a calma (e usa o dash), ou entra em pânico.
      this.calmInWater ??= this.rng() < 0.2 + this.skill * 0.25;
      // Água rasa não mata: dá pra nadar com calma até um lugar que vai continuar seco
      // (no fim, o refúgio). Na funda, só se der pra chegar antes de o fôlego acabar;
      // senão, a terra mais perto, seja qual for. Antes ele sempre ia pra mais perta, que no
      // fim da enchente alagava logo depois, e ficava nadando de um lado pro outro.
      const deep = level - here >= CRAB.deepWater;
      const safe = this.findSafeGround(sim, me);
      const swim =
        CRAB.speed * CRAB.waterSpeedFactor * bySkill(BOT.paceRuim, BOT.paceBom, this.skill);
      const breathLeft = me.breath / CRAB.deepBreathDrain;
      const reachable = safe && Math.hypot(safe.x - me.x, safe.y - me.y) / swim < breathLeft * 0.8;
      const shore =
        safe && (!deep || reachable) ? safe : (this.findNearestDry(sim, me, level) ?? safe);
      if (shore) {
        const d = Math.hypot(shore.x - me.x, shore.y - me.y);
        return { ...shore, dash: me.dashCooldown <= 0 && d > 1.2 && this.calmInWater };
      }
    } else {
      this.calmInWater = null;
    }

    // 1) Perigo: a água vai chegar aqui logo. Vai pra um lugar que ainda vai estar seco
    //    quando ele chegar — no fim, o refúgio, nem que seja atravessando o mapa no dash.
    //    Vem antes da briga: correr atrás de alguém com a água subindo afogava o bot.
    const safe = this.isSafe(sim, here, 0);
    if (!safe) {
      const spot = this.findSafeGround(sim, me);
      if (spot) {
        const d = Math.hypot(spot.x - me.x, spot.y - me.y);
        return { ...spot, dash: me.dashCooldown <= 0 && d > 2.5 };
      }
    }

    // 2) Briga (só armado): vai atrás de alguém, até do outro lado da ilha. Prefere quem
    //    está perto e perto da água. Só o bot distraído às vezes deixa passar.
    if (me.weapon && this.rng() >= bySkill(BOT.distraidoRuim, BOT.distraidoBom, this.skill)) {
      let target: Crab | null = null;
      let bestScore = -Infinity;
      for (const other of sim.crabs.values()) {
        if (other.id === me.id || !other.alive) continue;
        const d = Math.hypot(other.x - me.x, other.y - me.y);
        if (d > BOT.cacaAte) continue;
        const otherFloor = heightAt(sim.terrain, Math.floor(other.x), Math.floor(other.y));
        const score = -d - (otherFloor - level) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          target = other;
        }
      }
      if (target) {
        const d = Math.hypot(target.x - me.x, target.y - me.y);
        const spec = WEAPONS[me.weapon];
        const reach = spec.reach;
        // Espingarda/bazuca sem condição de atirar daqui: vai pra um lugar de onde dê.
        if (d <= reach + 1 && (spec.style === 'spread' || spec.style === 'rocket')) {
          const spot = this.firingSpot(sim, me, target, spec);
          if (spot) return spot;
        }
        // Dash só pra encurtar a distância: quem bate é a arma.
        const close = me.dashCooldown <= 0 && d > reach + 0.8 && d < 6 && this.rng() < 0.35;
        // Alvo na água e eu em terra: não vou atrás dele pro mar. Chego o mais perto que der
        // sem sair do seco e atiro de lá (no fim da enchente, sem isto o bot largava o
        // refúgio pra perseguir quem tinha caído em volta).
        const targetFloor = heightAt(sim.terrain, Math.floor(target.x), Math.floor(target.y));
        if (targetFloor < level + 0.3) {
          return this.dryApproach(sim, me, target) ?? { x: me.x, y: me.y };
        }
        // Já no alcance: chega só um pouco mais perto, sem trombar (de frente, quem resolve
        // é o tiro). Fora do alcance: vai até ele, mirando um pouco à frente.
        if (d <= reach * 0.8) {
          return { x: me.x + (target.x - me.x) * 0.15, y: me.y + (target.y - me.y) * 0.15 };
        }
        return { x: target.x + target.fx * 0.3, y: target.y + target.fy * 0.3, dash: close };
      }
    }

    // 2b) Desarmado com alguém armado colado: sai de perto (às vezes no dash).
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

    // 2c) Desarmado com arma bem perto (até boiando no raso, no fim da enchente): pega.
    if (!me.weapon) {
      const near = sim.weapons.find((w) => {
        const floor = heightAt(sim.terrain, Math.floor(w.x), Math.floor(w.y));
        return Math.hypot(w.x - me.x, w.y - me.y) < 3.5 && level - floor < CRAB.deepWater;
      });
      if (near) return { x: near.x, y: near.y };
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

    // 4) Nada pra fazer: vai pro lugar seguro (e fica lá, sem ficar sorteando outro).
    return this.findSafeGround(sim, me) ?? { x: me.x, y: me.y };
  }

  /** O ponto seco aqui perto (4 tiles) mais perto do alvo: pra chegar nele sem cair no mar. */
  private dryApproach(sim: Simulation, me: Crab, target: Crab): Goal | null {
    const cx = Math.floor(me.x);
    const cy = Math.floor(me.y);
    let best: Goal | null = null;
    let bestScore = Infinity;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const h = heightAt(sim.terrain, cx + dx, cy + dy);
        if (!this.isSafe(sim, h, 0)) continue;
        const px = cx + dx + 0.5;
        const py = cy + dy + 0.5;
        // Perto do alvo; desempata pelo que dá menos volta.
        const score = Math.hypot(px - target.x, py - target.y) + Math.hypot(dx, dy) * 0.1;
        if (score < bestScore) {
          bestScore = score;
          best = { x: px, y: py };
        }
      }
    }
    return best;
  }

  /** O chão de altura `h` ainda vai estar seco daqui a `travel` segundos + a folga? */
  private isSafe(sim: Simulation, h: number, travel: number): boolean {
    const future = Math.min(TIDE.maxLevel, tideLevel(sim.time + travel + BOT.folgaSeca));
    return h >= future + 0.3;
  }

  /**
   * O lugar seco mais perto que ainda vai estar seco quando ele chegar, no mapa todo.
   * No começo é qualquer morrinho do lado; no fim da enchente só sobra o refúgio (que a água
   * nunca cobre), e o bot vai até ele mesmo que esteja do outro lado da ilha.
   * Antes ele só olhava 9 tiles em volta e, sem achar nada, ficava parado esperando a água.
   * Mantém o lugar escolhido enquanto ele continuar seguro: sem isso o destino mudava a cada
   * decisão e o bot ficava indo e voltando.
   */
  private findSafeGround(sim: Simulation, me: Crab): Goal | null {
    const { width, height } = sim.terrain;
    const speed = CRAB.speed * bySkill(BOT.paceRuim, BOT.paceBom, this.skill);
    const cx = Math.floor(me.x);
    const cy = Math.floor(me.y);
    const kept = this.safeSpot;
    if (kept) {
      const h = heightAt(sim.terrain, Math.floor(kept.x), Math.floor(kept.y));
      const travel = Math.hypot(kept.x - me.x, kept.y - me.y) / speed;
      if (this.isSafe(sim, h, travel)) return { x: kept.x, y: kept.y };
    }
    let best: Goal | null = null;
    let bestScore = -Infinity;
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const h = heightAt(sim.terrain, tx, ty);
        if (h <= 0) continue;
        const dist = Math.hypot(tx - cx, ty - cy);
        if (!this.isSafe(sim, h, dist / speed)) continue;
        // Evita mirar num paredão logo ao lado.
        if (dist < 1.5 && isBlocked(sim.terrain, cx, cy, tx, ty, sim.level)) continue;
        // Perto vale mais; mais alto, um pouco (dura mais); um tiquinho de sorte pra os bots
        // não escolherem todos exatamente o mesmo tile.
        const score = -dist + h * 0.35 + this.rng() * 0.6;
        if (score > bestScore) {
          bestScore = score;
          best = { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    this.safeSpot = best;
    return best ? { x: best.x, y: best.y } : null;
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
