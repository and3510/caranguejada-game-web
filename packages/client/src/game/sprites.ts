/**
 * Pixel art desenhada à mão como texto. Cada caractere é um índice de paleta;
 * gerar as texturas em código permite trocar a cor da casca por jogador sem assets extras.
 */

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

export const SHELL_ART: PixelArt = [
  '..oooo..',
  '.ohhhho.',
  'ohwhwhwo',
  'ohwhwhwo',
  '.ohhhho.',
  '..oddo..',
  '...oo...',
  '........',
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

export const SHELL_PALETTE: Palette = { o: INK, h: '#f0a39a', w: '#fbe7d3', d: '#c47b70' };
export const GOLD_SHELL_PALETTE: Palette = { o: INK, h: '#f2c14e', w: '#fff2b0', d: '#b8862d' };

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
