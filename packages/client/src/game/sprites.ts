/**
 * Pixel art desenhada à mão como texto. Cada caractere é um índice de paleta;
 * gerar as texturas em código permite trocar a cor da casca por jogador sem assets extras.
 */

import type { WeaponKind } from '@caranguejada/shared';

export const INK = '#2b1d14';

type Palette = Record<string, string | null>;
type PixelArt = readonly string[];

// Caranguejo visto de frente, andando de lado. Duas poses de perna.
const CRAB_BODY = [
  '................',
  '.oo..........oo.',
  'ohho........ohho',
  'obbo.wo..ow.obbo',
  '.obo.oo..oo.obo.',
  '..oo..o..o..oo..',
  '...oooooooooo...',
  '..obhhbbbbbbbo..',
] as const;

export const CRAB_FRAMES: readonly PixelArt[] = [
  [
    ...CRAB_BODY,
    'o.obhbbbbbbbbo.o',
    '.oobbbbbbbbbdoo.',
    'o.odbbbbbbbbdo.o',
    '.o.oddbbbbddo.o.',
    'o..oooooooooo..o',
    '................',
    '................',
    '................',
  ],
  [
    ...CRAB_BODY,
    '.oobhbbbbbbbboo.',
    'o.obbbbbbbbbdo.o',
    '.oodbbbbbbbbdoo.',
    'o..oddbbbbddo..o',
    '.o.oooooooooo.o.',
    '................',
    '................',
    '................',
  ],
];

/** Estrela de rodada vencida. */
export const STAR_ART: PixelArt = [
  '....o....',
  '...oyo...',
  '...oyo...',
  'oooyyyooo',
  'oyyyhyyyo',
  '.oyyyyyo.',
  '..oyyyo..',
  '.oyyoyyo.',
  '.ooo.ooo.',
];

export const STAR_PALETTE: Palette = { o: INK, y: '#f2c14e', h: '#fff2b0' };

function shade(hex: number, amount: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const f = (c: number) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))
      .toString(16)
      .padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

export function crabPalette(color: number): Palette {
  return {
    o: INK,
    b: shade(color, 0),
    h: shade(color, 0.35),
    d: shade(color, -0.3),
    w: '#f4efe6',
  };
}

export function drawPixelArt(
  ctx: CanvasRenderingContext2D,
  art: PixelArt,
  palette: Palette,
  ox = 0,
  oy = 0,
): void {
  art.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]!];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

export function pixelArtCanvas(art: PixelArt, palette: Palette): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = art[0]!.length;
  canvas.height = art.length;
  drawPixelArt(canvas.getContext('2d')!, art, palette);
  return canvas;
}

export function crabCanvas(color: number, frame = 0): HTMLCanvasElement {
  return pixelArtCanvas(CRAB_FRAMES[frame % CRAB_FRAMES.length]!, crabPalette(color));
}

/**
 * Armas, desenhadas apontando para a direita com o cabo à esquerda
 * (a mão do caranguejo segura no `grip`; nas de fogo o cano termina na borda direita).
 */
export const WEAPON_ART: Record<WeaponKind, PixelArt> = {
  espingarda: [
    '........................',
    '...........oooooooooooo.',
    '..ooooooooowwwwwwwwwwwwo',
    '.ohhhdhhmmmsssssssssssso',
    'ohhhdhhhmmmodhdhdoooooo.',
    'ohhdhhhdmmmoooooo.......',
    'ohdhhhooooo.............',
    '.ooooo..................',
  ],
  revolver: [
    '..omoooo......o.',
    '..omssssooooooso',
    '...omlmmwwwwwwwo',
    '...ommlmssssssso',
    '..ohhdmmooooooo.',
    '.ohhdoomo.......',
    '.ohdhommo.......',
    'ohdho.oo........',
    'odhho...........',
    '.ooo............',
  ],
  submetralhadora: [
    '.................',
    '.................',
    '.ooooooooooo...o.',
    'olllssssssssooowo',
    'oloommmmmmmmsssso',
    'olllmmmmmmmmoooo.',
    '.oooomoomloo.....',
    '....omoomlo......',
    '...ommoomlo......',
    '....oo.omlo......',
    '........oo.......',
  ],
  bazuca: [
    '.........oo.............',
    '.o......ommo.........oo.',
    'oGooooooommooooooooooGGo',
    'oGjjjGjjjjGjjjjyyjjjGGGo',
    'oGgggggggggggggyyggggGGo',
    'oGgggggggggggggyyggggGGo',
    'oGGGGGGGGGGGGGGyyGGGGGGo',
    'oGoooooohhoohooooooooGGo',
    '.o.....ohhooho.......oo.',
    '........oo..o...........',
  ],
};

/** Ponto de pega de cada arma (fração da largura/altura), usado como origem do sprite. */
export const WEAPON_GRIP: Record<WeaponKind, { x: number; y: number }> = {
  espingarda: { x: 0.3, y: 0.55 },
  revolver: { x: 0.25, y: 0.55 },
  submetralhadora: { x: 0.35, y: 0.5 },
  // Bazuca vai no ombro: segura perto do meio do tubo.
  bazuca: { x: 0.42, y: 0.5 },
};

export const WEAPON_PALETTE: Palette = {
  o: INK,
  h: '#a67040',
  d: '#6e4626',
  k: '#c4945c',
  s: '#b9c4cc',
  w: '#eef3f5',
  p: '#d9573b',
  l: '#5a606e',
  m: '#4a4f5a',
  g: '#6b7a3a',
  G: '#4c582a',
  j: '#8c9c54',
  y: '#f2c14e',
};

export function weaponCanvas(kind: WeaponKind): HTMLCanvasElement {
  return pixelArtCanvas(WEAPON_ART[kind], WEAPON_PALETTE);
}

/** Foguete da bazuca, apontando pra direita (gira com a direção do voo). */
export const ROCKET_ART: PixelArt = [
  '.oo......',
  'oGGooooo.',
  'oGgjjjjpo',
  'oGGooooo.',
  '.oo......',
];
