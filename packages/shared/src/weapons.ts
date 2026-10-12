/**
 * Armas (todas de fogo). Sem arma, o caranguejo só anda e dá dash: para empurrar
 * alguém é preciso achar uma arma no mapa (R ou Espaço) e atirar (Espaço).
 * Cada uma muda o jeito de brigar.
 */

export const WEAPON_KINDS = ['espingarda', 'revolver', 'submetralhadora', 'bazuca'] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];

/**
 * - spread: tiro de chumbo em leque, acerta todo mundo no cone;
 * - bullet: tiro reto, acerta só o primeiro caranguejo na linha;
 * - burst: rajada de balas fracas e espalhadas (cada uma é um `bullet`);
 * - rocket: foguete que voa pelo mapa e explode (empurra em área e destrói os blocos em volta).
 */
export type WeaponStyle = 'spread' | 'bullet' | 'burst' | 'rocket';

export interface WeaponSpec {
  name: string;
  /** Uma linha para o HUD e para o "Como jogar". */
  hint: string;
  style: WeaponStyle;
  /** Unidade do desgaste no HUD (singular, plural). */
  unit: readonly [string, string];
  /**
   * Alcance, do centro de quem bate/atira até a borda de quem é atingido (tiles).
   * Bazuca: até onde o foguete voa antes de explodir sozinho.
   */
  reach: number;
  /** Abertura total do leque na frente do caranguejo (radianos; espingarda). */
  arc: number;
  /** Tempo entre tiros/rajadas (s). */
  cooldown: number;
  /** Velocidade do arremesso da vítima com 0% de dano (por bala, na rajada; no centro, na explosão). */
  impulse: number;
  /** Dano (%) que cada acerto soma na vítima; o dano acumulado aumenta o empurrão. */
  damage: number;
  /** Tempo que a vítima fica tonta (sem andar, sem dash, sem atirar). */
  stun: number;
  /** Golpes até quebrar (arma de fogo: munição; é descartada quando acaba). */
  uses: number;
  /** Rebote em quem atira, para trás (por bala, na rajada; 0 = sem rebote). */
  recoil: number;
  /** Multiplicador de velocidade a pé de quem carrega. */
  speedMul: number;
  /** Multiplicador de velocidade nadando de quem carrega. */
  swimMul: number;
  /**
   * Chance relativa de aparecer no mapa. Da mais comum pra mais rara:
   * revólver (4) > espingarda (3) > submetralhadora (2) > bazuca (1), ou 40/30/20/10%.
   */
  weight: number;
  /** Cor do rastro do tiro. */
  color: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

/** Desgaste: quanto mais fraco cada uso, mais usos a arma aguenta. */
export const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  // Chumbo em leque: alcance curto e arremesso enorme.
  // O rebote joga quem atirou um pouco pra trás (bem menos que a vítima).
  espingarda: {
    name: 'Espingarda',
    hint: 'leque de chumbo: arremessa longe; o rebote te empurra um pouco pra trás',
    style: 'spread',
    unit: ['bala', 'balas'],
    reach: 3.2,
    arc: deg(40),
    cooldown: 1.1,
    impulse: 26,
    damage: 14,
    stun: 0.5,
    uses: 3,
    recoil: 7,
    speedMul: 0.95,
    swimMul: 1,
    weight: 3,
    color: 0xf2c14e,
  },
  // Tiro reto de longe: afasta quem estiver na mira, sem rebote. Só pega o primeiro da linha.
  revolver: {
    name: 'Revólver',
    hint: 'tiro reto de longe: afasta o primeiro da mira, sem rebote',
    style: 'bullet',
    unit: ['bala', 'balas'],
    reach: 7.5,
    arc: 0,
    cooldown: 1,
    impulse: 15,
    damage: 8,
    stun: 0.3,
    uses: 6,
    recoil: 0,
    speedMul: 1,
    swimMul: 1,
    weight: 4,
    color: 0xfff2b0,
  },
  // Rajada: cada bala quase não empurra, mas a rajada inteira na mesma pessoa
  // vai varrendo ela como um jato de mangueira. Cada bala tem um rebote leve.
  submetralhadora: {
    name: 'Submetralhadora',
    hint: 'rajada de 6 balas fracas: a rajada inteira empurra o alvo',
    style: 'burst',
    unit: ['bala', 'balas'],
    reach: 6.5,
    arc: 0,
    cooldown: 1.3,
    impulse: 3.5,
    damage: 3,
    stun: 0.12,
    // 5 rajadas de 6 balas.
    uses: 30,
    recoil: 1.2,
    speedMul: 1,
    swimMul: 1,
    weight: 2,
    color: 0xffd27a,
  },
  // Foguete lento (dá pra desviar) que explode em área, inclusive em quem atirou
  // se estiver perto, e destrói o bloco atingido e os 8 em volta (a água ocupa o buraco).
  bazuca: {
    name: 'Bazuca',
    hint: 'foguete que explode em área e abre cratera; cuidado com a própria explosão',
    style: 'rocket',
    unit: ['foguete', 'foguetes'],
    reach: 9,
    arc: 0,
    cooldown: 1.4,
    impulse: 28,
    damage: 20,
    stun: 0.6,
    uses: 2,
    recoil: 6,
    speedMul: 0.85,
    swimMul: 0.85,
    weight: 1,
    color: 0xf2a03a,
  },
};

/**
 * Dano percentual (estilo Smash): ninguém morre por vida, mas cada acerto soma "%" na
 * vítima e, quanto mais ela acumula, mais longe os próximos acertos a jogam. Zera a cada rodada.
 */
export const DAMAGE = {
  /** Cada 1% de dano aumenta o empurrão em 1% (100% = o dobro). */
  knockbackPerPercent: 0.01,
  /** Teto do acúmulo (empurrão máximo de 3×). */
  max: 200,
} as const;

/** Multiplicador do empurrão pra quem já acumulou `damage`%. */
export function knockbackMultiplier(damage: number): number {
  return 1 + Math.min(DAMAGE.max, Math.max(0, damage)) * DAMAGE.knockbackPerPercent;
}

export const WEAPON_RULES = {
  /** Distância para pegar uma arma do chão com E. */
  pickupRadius: 0.9,
  /**
   * Armas no chão ao mesmo tempo (no máximo): uma por caranguejo vivo, até este teto.
   * Com menos (era até 4, uma pra cada dois), quase metade da rodada a pessoa passava
   * desarmada, e caranguejos se encontravam sem ter com o que atirar.
   */
  maxOnGround: 6,
  /** Intervalo entre uma arma nova e outra (s); na enchente, mais rápido. */
  spawnEverySeconds: 4,
  floodSpawnEverySeconds: 3,
  /** De preferência, nasce em terra que vai demorar a alagar. */
  spawnMinHeightAboveWater: 1.5,
  /**
   * Sem terra sobrando, a arma nasce boiando na água a até esta distância
   * de alguém vivo (tiles): no fim da enchente ainda dá pra se armar.
   */
  floatSpawnNear: 5,
  /** Arma na água boia este tempo (s) antes de o mar levar. */
  floatSeconds: 10,
  /** Espingarda: no limite do alcance o chumbo empurra esta fração a menos. */
  spreadFalloff: 0.2,
  /** Revólver/submetralhadora: folga lateral da bala além do corpo do caranguejo (tiles). */
  bulletWidth: 0.2,
  /**
   * Arma de fogo: no teclado só dá pra apontar em 8 direções, então o tiro "puxa"
   * para quem estiver até este ângulo da direção apertada (radianos).
   */
  aimAssist: deg(18),
  /** Submetralhadora: balas por rajada, intervalo entre elas (s) e espalhamento (radianos). */
  burstShots: 6,
  burstInterval: 0.055,
  burstJitter: deg(7),
  /** Bazuca: velocidade do foguete (tiles/s). */
  rocketSpeed: 10,
  /** Bazuca: o foguete explode ao chegar a esta distância de um caranguejo. */
  rocketHitRadius: 0.45,
  /** Bazuca: raio da explosão (empurra quem estiver dentro). */
  blastRadius: 1.9,
  /**
   * Bazuca: o foguete explode onde o jogador mirou (o cursor), entre este mínimo e o
   * alcance da arma. O mínimo é o raio da explosão e um pouco: mirar colado no próprio pé
   * (ou jogar só no teclado, com o mouse parado em cima do caranguejo) não explode na cara.
   */
  rocketMinRange: 2,
  /** Bazuca: o foguete sai desta distância do centro de quem atira (tiles). */
  rocketStart: 0.67,
  /**
   * Bazuca: a explosão destrói o bloco atingido e os 8 em volta (3×3).
   * Quanto cada um afunda: o do centro mais, os vizinhos um pouco menos.
   */
  craterCenterDepth: 3,
  craterRingDepth: 2,
} as const;

/**
 * Até onde o foguete voa (tiles, do centro de quem atira): até o ponto mirado, dentro dos
 * limites. Sem ponto mirado (toque, teclado puro), voa o alcance inteiro, como antes.
 * Encostar em alguém no caminho continua explodindo antes.
 */
export function rocketRange(aimDistance: number | undefined): number {
  const reach = WEAPONS.bazuca.reach;
  if (aimDistance === undefined || !Number.isFinite(aimDistance)) return reach;
  return Math.min(reach, Math.max(WEAPON_RULES.rocketMinRange, aimDistance));
}

export function isWeaponKind(value: unknown): value is WeaponKind {
  return typeof value === 'string' && (WEAPON_KINDS as readonly string[]).includes(value);
}

/** Sorteia uma arma respeitando o peso de cada uma. */
export function pickWeaponKind(roll: number): WeaponKind {
  const total = WEAPON_KINDS.reduce((sum, k) => sum + WEAPONS[k].weight, 0);
  let acc = roll * total;
  for (const kind of WEAPON_KINDS) {
    acc -= WEAPONS[kind].weight;
    if (acc < 0) return kind;
  }
  return WEAPON_KINDS[0];
}

/** Multiplicadores de movimento de quem carrega a arma (sem arma: 1). */
export function weaponMoveMods(kind: WeaponKind | null): { speed: number; swim: number } {
  if (!kind) return { speed: 1, swim: 1 };
  return { speed: WEAPONS[kind].speedMul, swim: WEAPONS[kind].swimMul };
}

/**
 * O tiro pega quem está a `dist` do atacante e `angle` fora da mira?
 * Para revólver e submetralhadora é a linha da bala; quem está atrás de outro na
 * mesma linha é filtrado por quem resolve o tiro (só o primeiro leva).
 * A bazuca não usa isto: o foguete voa e explode.
 */
export function inStrikeZone(
  kind: WeaponKind,
  dist: number,
  angle: number,
  radius: number,
): boolean {
  const spec = WEAPONS[kind];
  if (spec.style === 'rocket') return false;
  if (spec.style === 'bullet' || spec.style === 'burst') {
    const along = dist * Math.cos(angle);
    const across = Math.abs(dist * Math.sin(angle));
    return along > 0 && along <= spec.reach + radius && across <= radius + WEAPON_RULES.bulletWidth;
  }
  if (dist > spec.reach + radius) return false;
  // Espingarda colada no corpo: o ângulo é ruído, vale tudo que estiver mais ou menos na frente.
  const halfArc = dist <= radius * 2 ? Math.max(spec.arc / 2, Math.PI / 2) : spec.arc / 2;
  return Math.abs(angle) <= halfArc;
}

/**
 * Assistência de mira: devolve a direção do tiro. Se houver alguém no alcance perto
 * da direção apertada, mira nele (o mais alinhado); senão, segue o que foi apertado.
 */
export function assistAim(
  kind: WeaponKind,
  from: { x: number; y: number },
  dir: { x: number; y: number },
  targets: Iterable<{ x: number; y: number }>,
  radius: number,
): { x: number; y: number } {
  const spec = WEAPONS[kind];
  let best = dir;
  let bestAngle: number = WEAPON_RULES.aimAssist;
  for (const t of targets) {
    const dx = t.x - from.x;
    const dy = t.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-3 || dist > spec.reach + radius) continue;
    const angle = Math.abs(Math.atan2(dir.x * dy - dir.y * dx, dir.x * dx + dir.y * dy));
    if (angle <= bestAngle) {
      bestAngle = angle;
      best = { x: dx / dist, y: dy / dist };
    }
  }
  return best;
}
