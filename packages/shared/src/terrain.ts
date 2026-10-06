import {
  CLIFF_HEIGHT,
  FINAL_REFUGE_TILES,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_TILE_HEIGHT,
} from './constants';
import { createRng, type Rng } from './rng';

export interface Terrain {
  readonly width: number;
  readonly height: number;
  /** Altura de cada tile (0..MAX_TILE_HEIGHT), indexada por y * width + x. */
  readonly heights: Uint8Array;
  /**
   * O que cada tile "é" (só visual): rua, telhado, convés... 0 = decide pela altura.
   * A altura decide a água; o material decide a aparência.
   */
  readonly materials?: Uint8Array;
}

/** Materiais visuais dos mapas construídos. */
export const MATERIAL = {
  auto: 0,
  street: 1,
  roofRed: 2,
  roofSlate: 3,
  deck: 4,
  crate: 5,
  shed: 6,
  wall: 7,
  tower: 8,
  beach: 9,
  rock: 10,
  bridge: 11,
} as const;

export function tileIndex(terrain: Terrain, tx: number, ty: number): number {
  return ty * terrain.width + tx;
}

export function inBounds(terrain: Terrain, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < terrain.width && ty < terrain.height;
}

/** Fora do mapa é sempre oceano (altura 0). */
export function heightAt(terrain: Terrain, tx: number, ty: number): number {
  if (!inBounds(terrain, tx, ty)) return 0;
  return terrain.heights[tileIndex(terrain, tx, ty)] ?? 0;
}

/** Profundidade da água num ponto do mundo; <= 0 significa chão seco. */
export function depthAt(terrain: Terrain, x: number, y: number, level: number): number {
  return level - heightAt(terrain, Math.floor(x), Math.floor(y));
}

export function isDry(height: number, level: number): boolean {
  return height >= level;
}

/** Alturas cabem num dígito, então um mapa inteiro vira uma string curta no protocolo. */
export function encodeHeights(heights: Uint8Array): string {
  let out = '';
  for (const h of heights) out += String.fromCharCode(48 + h);
  return out;
}

export function decodeHeights(encoded: string): Uint8Array {
  const out = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    out[i] = Math.min(MAX_TILE_HEIGHT, Math.max(0, encoded.charCodeAt(i) - 48));
  }
  return out;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Ruído de valor com interpolação bilinear suave. */
function valueNoise(rng: Rng, width: number, height: number, cell: number): Float32Array {
  const gw = Math.ceil(width / cell) + 2;
  const gh = Math.ceil(height / cell) + 2;
  const grid = new Float32Array(gw * gh).map(() => rng());
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = x / cell;
      const gy = y / cell;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = smoothstep(gx - ix);
      const fy = smoothstep(gy - iy);
      const g = (i: number, j: number) => grid[j * gw + i] ?? 0;
      const top = g(ix, iy) * (1 - fx) + g(ix + 1, iy) * fx;
      const bottom = g(ix, iy + 1) * (1 - fx) + g(ix + 1, iy + 1) * fx;
      out[y * width + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}

/** Tipos de mapa: mesma mecânica (água sobe das bordas), geografias diferentes. */
export const MAP_KINDS = [
  'morro',
  'arquipelago',
  'atol',
  'gemeas',
  'espinhaco',
  'porto',
  'navio',
  'cidade',
  'recife',
  'castelo',
  'mangue',
] as const;
export type MapKind = (typeof MAP_KINDS)[number];

export const MAP_NAMES: Record<MapKind, string> = {
  morro: 'Morro',
  arquipelago: 'Arquipélago',
  atol: 'Atol',
  gemeas: 'Ilhas Gêmeas',
  espinhaco: 'Espinhaço',
  porto: 'Cais do Porto',
  navio: 'Navio Naufragado',
  cidade: 'Cidade Submersa',
  recife: 'Recife de Coral',
  castelo: 'Castelo de Areia',
  mangue: 'Manguezal',
};

/** Dica curta mostrada na contagem regressiva. */
export const MAP_HINTS: Record<MapKind, string> = {
  morro: 'a água vem das bordas: corre pro alto!',
  arquipelago: 'as ilhotas afundam primeiro: a ilha do meio é a última',
  atol: 'tem lagoa no meio: a água aperta pelos dois lados',
  gemeas: 'a ponte de areia some cedo: escolhe seu lado',
  espinhaco: 'crista estreita: cuidado com o empurrão',
  porto: 'píer é estreito: um dash e é água',
  navio: 'o casco rachou: não fica no lado errado',
  cidade: 'as ruas viraram canais: pula de telhado em telhado',
  recife: 'coral espalhado: dá pra atravessar no dash',
  castelo: 'o fosso enche primeiro: entra pela ponte',
  mangue: 'canais por todo lado: lama não é chão firme por muito tempo',
};

export function isMapKind(value: unknown): value is MapKind {
  return typeof value === 'string' && (MAP_KINDS as readonly string[]).includes(value);
}

/**
 * Normaliza uma seleção de mapas vinda de fora (rede, URL): só tipos válidos, sem
 * repetição, na ordem oficial. Vazio ou inválido vira null (quem chama decide o padrão).
 */
export function normalizeMapPool(value: unknown): MapKind[] | null {
  if (!Array.isArray(value)) return null;
  const wanted = new Set(value.filter(isMapKind));
  const pool = MAP_KINDS.filter((k) => wanted.has(k));
  return pool.length > 0 ? pool : null;
}

/** Coordenadas normalizadas: o centro do mapa é (0,0) e ~1 é a borda. */
interface ShapeContext {
  rng: Rng;
  /** Ruído grosso (0..1) no ponto: deforma a costa. */
  coarse: number;
  /** Ruído fino (0..1) no ponto. */
  fine: number;
  /** Coordenadas do tile, para mapas "construídos" (quarteirões, tábuas). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Material do tile, se a forma quiser marcar (ver MATERIAL). */
  material: number;
}

/** Marca o material do tile atual e devolve o valor da forma. */
const tag = (ctx: ShapeContext, material: number, value: number) => {
  ctx.material = material;
  return value;
};

/** Formas construídas: valor fixo dentro, bem negativo fora — borda reta, sem ruído. */
const SOLID = (inside: boolean, value: number) => (inside ? value : -1);

/** Ponto dentro de um retângulo (centro e meia-largura/altura). */
const inRect = (u: number, w: number, cx: number, cy: number, hw: number, hh: number) =>
  Math.abs(u - cx) <= hw && Math.abs(w - cy) <= hh;

type Shape = (u: number, w: number, ctx: ShapeContext) => number;

/** Cone de 1 no centro até 0 no raio. */
const cone = (dist: number, radius: number) => 1 - dist / radius;

/** Distância de um ponto a um segmento (para pontes e cristas). */
function segmentDistance(u: number, w: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((u - ax) * dx + (w - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(u - (ax + dx * t), w - (ay + dy * t));
}

/**
 * Cada construtor recebe o rng da seed e devolve a função de forma.
 * A forma retorna ~1 no ponto mais alto e <= 0 no mar.
 */
const SHAPES: Record<MapKind, (rng: Rng) => Shape> = {
  // Uma ilha só, alta no centro.
  morro: (rng) => {
    const ox = (rng() - 0.5) * 0.2;
    const oy = (rng() - 0.5) * 0.2;
    return (u, w, { coarse }) => cone(Math.hypot(u - ox, w - oy) + (coarse - 0.5) * 0.35, 1);
  },

  // Ilha central e um colar de ilhotas mais baixas em volta.
  arquipelago: (rng) => {
    const count = 5 + Math.floor(rng() * 3);
    const turn = rng() * Math.PI * 2;
    const islets = Array.from({ length: count }, (_, i) => {
      const angle = turn + (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.4;
      const dist = 0.74 + rng() * 0.08;
      return {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        r: 0.14 + rng() * 0.06,
        peak: 0.45 + rng() * 0.15,
      };
    });
    return (u, w, { coarse }) => {
      const wobble = (coarse - 0.5) * 0.2;
      let v = cone(Math.hypot(u, w) + wobble, 0.46);
      for (const isl of islets) {
        v = Math.max(v, cone(Math.hypot(u - isl.x, w - isl.y) + wobble * 0.5, isl.r) * isl.peak);
      }
      return v;
    };
  },

  // Anel com lagoa no meio; dois trechos do anel são mais altos (os últimos refúgios).
  atol: (rng) => {
    const phase = rng() * Math.PI * 2;
    return (u, w, { coarse }) => {
      const r = Math.hypot(u, w) + (coarse - 0.5) * 0.25;
      const band = 1 - Math.abs(r - 0.62) / 0.3;
      const ridge = 0.72 + 0.28 * Math.sin(Math.atan2(w, u) * 2 + phase);
      return band * ridge;
    };
  },

  // Duas ilhas ligadas por uma ponte de areia baixa e estreita.
  gemeas: (rng) => {
    const tilt = (rng() - 0.5) * 0.6;
    const ax = -Math.cos(tilt) * 0.52;
    const ay = -Math.sin(tilt) * 0.52;
    const bigFirst = rng() < 0.5;
    return (u, w, { coarse }) => {
      const wobble = (coarse - 0.5) * 0.2;
      const a = cone(Math.hypot(u - ax, w - ay) + wobble, 0.46) * (bigFirst ? 1 : 0.9);
      const b = cone(Math.hypot(u + ax, w + ay) + wobble, 0.46) * (bigFirst ? 0.9 : 1);
      const bridge = cone(segmentDistance(u, w, ax, ay, -ax, -ay), 0.1) * 0.36;
      return Math.max(a, b, bridge);
    };
  },

  // Crista comprida e sinuosa, alta no meio e fina nas pontas.
  espinhaco: (rng) => {
    const angle = (rng() - 0.5) * 0.7;
    const phase = rng() * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return (u, w, { coarse }) => {
      const along = u * cos + w * sin;
      const across = -u * sin + w * cos + Math.sin(along * 4 + phase) * 0.1;
      const taper = Math.max(0, Math.abs(along) - 0.15) * 1.15;
      return 1 - Math.abs(across) / 0.42 - taper + (coarse - 0.5) * 0.15;
    };
  },

  // Calçadão de madeira com píeres saindo para o mar e um galpão numa ponta.
  porto: (rng) => {
    const side = rng() < 0.5 ? 1 : -1; // calçadão embaixo ou em cima
    const deckY = 0.62 * side;
    const piers = Array.from({ length: 5 }, (_, i) => ({
      x: -0.72 + i * 0.36 + (rng() - 0.5) * 0.08,
      reach: 0.55 + rng() * 0.5,
      crate: rng() < 0.6 ? 0.3 + rng() * 0.5 : null,
    }));
    const shedX = rng() < 0.5 ? -0.68 : 0.68;
    return (u, w, ctx) => {
      if (inRect(u, w, shedX, deckY - side * 0.08, 0.24, 0.28)) return tag(ctx, MATERIAL.shed, 1);
      if (inRect(u, w, 0, deckY, 0.92, 0.13)) return tag(ctx, MATERIAL.deck, 0.7); // calçadão
      for (const p of piers) {
        const from = deckY;
        const to = deckY - side * p.reach;
        const top = Math.min(from, to);
        const bottom = Math.max(from, to);
        if (inRect(u, w, p.x, (top + bottom) / 2, 0.065, (bottom - top) / 2)) {
          // Pilha de caixotes: um ponto mais alto no meio do píer.
          if (p.crate !== null && Math.abs(w - (deckY - side * p.reach * p.crate)) < 0.09)
            return tag(ctx, MATERIAL.crate, 0.85);
          return tag(ctx, MATERIAL.deck, 0.45 + 0.2 * (1 - Math.abs(w - deckY) / p.reach));
        }
      }
      return -1;
    };
  },

  // Casco de navio deitado, rachado no meio, com pedras em volta.
  navio: (rng) => {
    const angle = (rng() - 0.5) * 0.5;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const crack = (rng() - 0.5) * 0.3;
    const rocks = Array.from({ length: 6 }, () => {
      const a = rng() * Math.PI * 2;
      return {
        x: Math.cos(a) * (0.8 + rng() * 0.15),
        y: Math.sin(a) * (0.75 + rng() * 0.15),
        r: 0.07 + rng() * 0.05,
      };
    });
    return (u, w, ctx) => {
      const along = u * cos + w * sin;
      const across = -u * sin + w * cos;
      // Proa pontuda à direita, popa reta à esquerda.
      const half = along > 0.25 ? 0.36 * (1 - (along - 0.25) / 0.6) : 0.36;
      if (along > -0.78 && along < 0.85 && Math.abs(across) < half) {
        // Rachadura: um canal estreito que corta metade do casco.
        if (Math.abs(along - crack) < 0.05 && across > -0.05) return -1;
        const deck = 1 - Math.abs(across) / half; // mais alto no meio do convés
        // Borda do casco (amurada) em madeira escura; o resto é convés.
        const rail = Math.abs(across) > half - 0.07;
        return tag(ctx, rail ? MATERIAL.wall : MATERIAL.deck, 0.4 + 0.6 * deck);
      }
      for (const r of rocks) {
        const d = Math.hypot(u - r.x, w - r.y);
        if (d < r.r) return tag(ctx, MATERIAL.rock, 0.3 + 0.3 * (1 - d / r.r));
      }
      return -1;
    };
  },

  // Quarteirões de telhados; as ruas viraram canais e algumas pontes de tábua sobraram.
  cidade: (rng) => {
    const cell = 7; // tiles por quarteirão (5 de prédio + 2 de canal)
    const ox = Math.floor(rng() * cell);
    const oy = Math.floor(rng() * cell);
    const tall = new Map<string, number>();
    const slate = new Map<string, boolean>();
    const bridges = new Map<string, boolean>();
    return (_u, _w, ctx) => {
      const { x, y, width, height } = ctx;
      if (x < 2 || y < 2 || x > width - 3 || y > height - 3) return -1;
      const bx = Math.floor((x + ox) / cell);
      const by = Math.floor((y + oy) / cell);
      const lx = (x + ox) % cell;
      const ly = (y + oy) % cell;
      const key = `${bx},${by}`;
      if (!tall.has(key)) {
        // Uns prédios desabaram (viraram praça alagada); os outros têm alturas variadas.
        tall.set(key, rng() < 0.08 ? -1 : 0.4 + rng() * 0.6);
        slate.set(key, rng() < 0.4);
        bridges.set(key + 'h', rng() < 0.85);
        bridges.set(key + 'v', rng() < 0.85);
      }
      const roof = tall.get(key)!;
      if (lx < 5 && ly < 5) {
        if (roof <= 0) return -1;
        return tag(ctx, slate.get(key) ? MATERIAL.roofSlate : MATERIAL.roofRed, roof);
      }
      // Pontes de 2 tiles atravessando o canal até o vizinho.
      if (lx >= 5 && ly >= 1 && ly <= 2 && bridges.get(key + 'h'))
        return tag(ctx, MATERIAL.bridge, 0.35);
      if (ly >= 5 && lx >= 1 && lx <= 2 && bridges.get(key + 'v'))
        return tag(ctx, MATERIAL.bridge, 0.35);
      // Rua: chão baixo que alaga primeiro e vira canal raso (dá pra atravessar).
      return tag(ctx, MATERIAL.street, 0.12);
    };
  },

  // Galhos de coral crescendo do centro, como um coral ramificado visto de cima.
  recife: (rng) => {
    const blobs: { x: number; y: number; r: number; peak: number }[] = [];
    const branches = 4 + Math.floor(rng() * 2);
    for (let b = 0; b < branches; b++) {
      let angle = (b / branches) * Math.PI * 2 + rng() * 0.6;
      let x = 0;
      let y = 0;
      for (let step = 0; step < 9; step++) {
        blobs.push({ x, y, r: 0.17 - step * 0.007, peak: 1 - step * 0.07 });
        angle += (rng() - 0.5) * 0.9;
        x += Math.cos(angle) * 0.1;
        y += Math.sin(angle) * 0.13;
        // Bifurca de vez em quando.
        if (step === 4 && rng() < 0.6) {
          const fork = angle + (rng() < 0.5 ? 0.9 : -0.9);
          for (let k = 1; k < 4; k++) {
            blobs.push({
              x: x + Math.cos(fork) * 0.1 * k,
              y: y + Math.sin(fork) * 0.13 * k,
              r: 0.12,
              peak: 0.5,
            });
          }
        }
      }
    }
    return (u, w) => {
      let v = -1;
      for (const b of blobs) v = Math.max(v, cone(Math.hypot(u - b.x, w - b.y), b.r) * b.peak);
      return v;
    };
  },

  // Castelo de areia: torre central, muralha com torreões, fosso e a praia em volta.
  castelo: (rng) => {
    const gate = Math.floor(rng() * 4); // lado da ponte levadiça
    return (u, w, ctx) => {
      const au = Math.abs(u);
      const aw = Math.abs(w);
      if (inRect(u, w, 0, 0, 0.2, 0.26)) return tag(ctx, MATERIAL.tower, 1); // torre do meio
      for (const [tx, ty] of [
        [-0.5, -0.56],
        [0.5, -0.56],
        [-0.5, 0.56],
        [0.5, 0.56],
      ] as const) {
        if (Math.hypot(u - tx, (w - ty) * 0.7) < 0.12) return tag(ctx, MATERIAL.tower, 0.85);
      }
      const wall = au <= 0.52 && aw <= 0.58 && (au >= 0.45 || aw >= 0.5);
      if (wall) return tag(ctx, MATERIAL.wall, 0.7); // muralha
      if (au < 0.45 && aw < 0.5) return tag(ctx, MATERIAL.beach, 0.5); // pátio
      // Ponte levadiça atravessando o fosso.
      const bridge =
        (gate === 0 && au < 0.07 && w < -0.5 && w > -0.82) ||
        (gate === 1 && au < 0.07 && w > 0.5 && w < 0.82) ||
        (gate === 2 && aw < 0.1 && u < -0.45 && u > -0.74) ||
        (gate === 3 && aw < 0.1 && u > 0.45 && u < 0.74);
      if (bridge) return tag(ctx, MATERIAL.bridge, 0.45);
      const moat = au < 0.66 && aw < 0.74;
      if (moat) return -1;
      // Praia em volta do fosso.
      return tag(ctx, MATERIAL.beach, SOLID(au < 0.98 && aw < 1, 0.35));
    };
  },

  // Lamaçal grande cortado por canais sinuosos (as curvas de nível do ruído).
  mangue: (rng) => {
    const ox = (rng() - 0.5) * 0.2;
    return (u, w, { coarse, fine }) => {
      const base = cone(Math.hypot(u - ox, w) + (coarse - 0.5) * 0.3, 1.05);
      if (base <= 0) return base;
      // Canais: onde o ruído fino cruza o meio, a lama vira água.
      if (Math.abs(fine - 0.5) < 0.045) return -1;
      return base;
    };
  },
};

/**
 * Mapas "construídos" têm blocos de altura constante (um telhado, um convés). Neles o
 * rumo da enchente pesa mais que o formato, senão um quarteirão inteiro afunda de uma vez.
 */
const BUILT_MAPS = new Set<MapKind>(['porto', 'navio', 'cidade', 'castelo']);

function buildTerrain(seed: number, kind: MapKind, width: number, height: number): Terrain {
  const rng = createRng(seed);
  const coarse = valueNoise(rng, width, height, 6);
  const fine = valueNoise(rng, width, height, 3);
  const shape = SHAPES[kind](rng);
  const rx = width * 0.46;
  const ry = height * 0.46;

  const materials = new Uint8Array(width * height);
  const values = new Float32Array(width * height);
  let peak = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const u = (x + 0.5 - width / 2) / rx;
      const w = (y + 0.5 - height / 2) / ry;
      // Morrinhos espalhados viram ilhotas quando a água passa por eles.
      const lumps = ((fine[i] ?? 0) - 0.5) * 0.18;
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const ctx = {
        rng,
        coarse: coarse[i] ?? 0,
        fine: fine[i] ?? 0,
        x,
        y,
        width,
        height,
        material: MATERIAL.auto as number,
      };
      const v = border ? 0 : shape(u, w, ctx) + lumps;
      materials[i] = ctx.material;
      values[i] = v;
      peak = Math.max(peak, v);
    }
  }

  // Todo mapa alcança o topo (altura 9): as rodadas duram parecido em qualquer geografia.
  const scale = Math.max(10.5, (MAX_TILE_HEIGHT + 0.4) / Math.max(peak, 0.01));
  const heights = new Uint8Array(width * height);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0;
    heights[i] = v <= 0 ? 0 : Math.min(MAX_TILE_HEIGHT, Math.round(v * scale));
  }
  return { width, height, heights, materials };
}

/**
 * Dá um rumo para a enchente: escolhe um ponto final (o último pedaço de terra) numa
 * área alta e inclina o terreno a partir do lado oposto. A água começa por lá,
 * atravessa o mapa e termina num único tile — o ponto final é o único com altura máxima.
 */
function shapeFloodPath(terrain: Terrain, seed: number, shapeWeight: number): void {
  const { width, height, heights } = terrain;
  const rng = createRng(seed ^ 0x5eed1e55);

  // Ponto final: um tile alto, longe da borda.
  const original = heights.slice();
  const maxH = Math.max(...original);
  const candidates: number[] = [];
  for (let ty = 3; ty < height - 3; ty++) {
    for (let tx = 3; tx < width - 3; tx++) {
      const i = ty * width + tx;
      if ((original[i] ?? 0) >= maxH - 2) candidates.push(i);
    }
  }
  const endIndex =
    candidates[Math.floor(rng() * candidates.length)] ?? (height >> 1) * width + (width >> 1);
  const ex = (endIndex % width) + 0.5;
  const ey = Math.floor(endIndex / width) + 0.5;

  // Origem da enchente: do outro lado do mapa em relação ao ponto final.
  const cx = width / 2;
  const cy = height / 2;
  let dx = cx - ex;
  let dy = cy - ey;
  if (Math.hypot(dx, dy) < 2) {
    const angle = rng() * Math.PI * 2;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  }
  const len = Math.hypot(dx, dy);
  const reach = Math.hypot(width, height) * 0.6;
  const sx = cx + (dx / len) * reach;
  const sy = cy + (dy / len) * reach;

  // Quanto cada tile está "perto do fim": mistura o formato do mapa (ilhotas e
  // morrinhos continuam mais baixos) com o rumo da enchente.
  const farthest = Math.hypot(width, height);
  const land: { i: number; score: number; toEnd: number }[] = [];
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx;
      const h = original[i] ?? 0;
      if (h === 0) continue;
      const px = tx + 0.5;
      const py = ty + 0.5;
      const toStart = Math.hypot(px - sx, py - sy);
      const toEnd = Math.hypot(px - ex, py - ey);
      const along = toStart / (toStart + toEnd); // 0 na origem da água, 1 no ponto final
      const near = 1 - toEnd / farthest;
      const score = shapeWeight * (h / maxH) + (1 - shapeWeight) * (0.55 * near + 0.45 * along);
      land.push({ i, score, toEnd });
    }
  }

  // Alturas por ranking: controla quanto de terra some a cada nível, então a ilha
  // encolhe aos poucos até sobrar um tile só — e o ritmo é parecido em qualquer mapa.
  land.sort((a, b) => b.score - a.score || a.toEnd - b.toEnd);
  const bands = [
    { height: 8, share: 0 }, // preenchido abaixo com um número fixo de tiles
    { height: 7, share: 0.05 },
    { height: 6, share: 0.08 },
    { height: 5, share: 0.11 },
    { height: 4, share: 0.14 },
    { height: 3, share: 0.16 },
    { height: 2, share: 0.18 },
  ];
  // O refúgio final: FINAL_REFUGE_TILES tiles de altura máxima (a única que a maré nunca
  // cobre), num bloco só. Cresce a partir do melhor tile, sempre pegando o vizinho de terra
  // mais bem ranqueado — assim a briga final acontece num lugar só, não em ilhotas soltas.
  const rank = new Map<number, number>();
  land.forEach((t, r) => rank.set(t.i, r));
  const refuge = new Set<number>();
  if (land.length > 0) {
    refuge.add(land[0]!.i);
    while (refuge.size < FINAL_REFUGE_TILES) {
      let next = -1;
      let nextRank = Infinity;
      for (const i of refuge) {
        const x = i % width;
        const y = Math.floor(i / width);
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ] as const) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          const r = rank.get(ni);
          if (r !== undefined && !refuge.has(ni) && r < nextRank) {
            next = ni;
            nextRank = r;
          }
        }
      }
      if (next < 0) break; // ilhota pequena demais: completa abaixo pelo ranking
      refuge.add(next);
    }
  }
  for (const i of refuge) heights[i] = MAX_TILE_HEIGHT;

  // O resto, por ranking, pulando o refúgio (que já tem a altura dele).
  let cursor = 0;
  const assign = (count: number, h: number) => {
    for (let k = 0; k < count && cursor < land.length;) {
      const i = land[cursor++]!.i;
      if (refuge.has(i)) continue;
      heights[i] = h;
      k++;
    }
  };
  // Se o crescimento ficou sem vizinhos, completa o refúgio com os melhores do ranking.
  while (refuge.size < Math.min(FINAL_REFUGE_TILES, land.length)) {
    const i = land[cursor++]!.i;
    if (!refuge.has(i)) {
      refuge.add(i);
      heights[i] = MAX_TILE_HEIGHT;
    }
  }
  assign(6, 8);
  for (const band of bands.slice(1)) assign(Math.round(land.length * band.share), band.height);
  assign(land.length, 1);

  if (land.length === 0) heights[endIndex] = MAX_TILE_HEIGHT;
  removeCliffs(terrain);
}

/**
 * Nenhum degrau intransponível entre dois tiles de terra: levanta o mais baixo até
 * dar pra subir. Mapas "construídos" (telhado colado em ponte, muralha e pátio)
 * não viram armadilha. Só levanta, nunca passa da altura máxima: o refúgio final
 * continua sendo só os tiles que já estavam lá.
 */
function removeCliffs(terrain: Terrain): void {
  const { width, height, heights } = terrain;
  const maxStep = CLIFF_HEIGHT - 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const i = ty * width + tx;
        const h = heights[i] ?? 0;
        if (h === 0) continue;
        for (const [nx, ny] of [
          [tx + 1, ty],
          [tx - 1, ty],
          [tx, ty + 1],
          [tx, ty - 1],
        ] as const) {
          const n = heightAt(terrain, nx, ny);
          if (n - h > maxStep) {
            heights[i] = n - maxStep;
            changed = true;
            break;
          }
        }
      }
    }
  }
}

/** O último pedaço de terra: o único tile com a altura máxima do mapa. */
export function lastLand(terrain: Terrain): { tx: number; ty: number } {
  let best = 0;
  for (let i = 1; i < terrain.heights.length; i++) {
    if ((terrain.heights[i] ?? 0) > (terrain.heights[best] ?? 0)) best = i;
  }
  return { tx: best % terrain.width, ty: Math.floor(best / terrain.width) };
}

/** Fração do mapa que está seca num dado nível de água. */
export function landRatio(terrain: Terrain, level = 1): number {
  let land = 0;
  for (const h of terrain.heights) if (h >= level) land++;
  return land / terrain.heights.length;
}

/**
 * Gera o mapa a partir de uma seed. Se a seed produzir pouca terra (ou terra demais),
 * tenta seeds derivadas — sempre de forma determinística.
 */
export function generateTerrain(
  seed: number,
  kind: MapKind = 'morro',
  width = MAP_WIDTH,
  height = MAP_HEIGHT,
): Terrain {
  let best = buildTerrain(seed, kind, width, height);
  for (let attempt = 1; attempt < 12; attempt++) {
    const ratio = landRatio(best);
    if (ratio >= 0.2 && ratio <= 0.65) break;
    best = buildTerrain((seed + attempt * 7919) >>> 0, kind, width, height);
  }
  shapeFloodPath(best, seed, BUILT_MAPS.has(kind) ? 0.15 : 0.35);
  return best;
}

export function cloneTerrain(terrain: Terrain): Terrain {
  return {
    width: terrain.width,
    height: terrain.height,
    heights: terrain.heights.slice(),
    ...(terrain.materials ? { materials: terrain.materials.slice() } : {}),
  };
}
