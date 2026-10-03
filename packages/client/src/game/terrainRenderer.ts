import { CRAB, MATERIAL, hash2, heightAt, type MapKind, type Terrain } from '@caranguejada/shared';

export const TILE = 16;

/** Classes visuais de tile, em ordem de linha no atlas. */
enum TileClass {
  Deep,
  Mid,
  Shallow,
  /** Chão seco colado na linha d'água. */
  Wet,
  /** Chão baixo, médio e alto. */
  Low,
  Middle,
  High,
}

const CLASS_COUNT = 7;
/** Linhas extras no atlas para os materiais (índice = MATERIAL.*). */
const MATERIAL_ROWS = 12;
const VARIANTS = 4;
const FRAMES = 2;

/** Desenho por cima da cor base: é o que transforma "chão" em madeira, telha, coral... */
type Pattern =
  | 'water'
  | 'speckle'
  | 'sand'
  | 'grass'
  | 'rock'
  | 'planks'
  | 'crates'
  | 'roof'
  | 'slate'
  | 'concrete'
  | 'coral'
  | 'brick'
  | 'mud'
  | 'roots'
  | 'canopy';

interface TileStyle {
  base: string;
  dark: string;
  light: string;
  pattern: Pattern;
}

type Theme = Record<TileClass, TileStyle> & {
  /** Material marcado pelo gerador (rua, telhado...) sobrepõe o estilo por altura. */
  materials?: Partial<Record<number, TileStyle>>;
};

const planks = (base: string, dark: string, light: string): TileStyle => ({
  base,
  dark,
  light,
  pattern: 'planks',
});

const ocean = {
  [TileClass.Deep]: { base: '#1b3f66', dark: '#16345a', light: '#2a5a86', pattern: 'water' },
  [TileClass.Mid]: { base: '#24648a', dark: '#1e5679', light: '#3a82a8', pattern: 'water' },
  [TileClass.Shallow]: { base: '#3c95ad', dark: '#33849b', light: '#7cc4cc', pattern: 'water' },
} as const;

/**
 * Cada mapa tem seu material. A mecânica é a mesma (altura → água), só muda o que
 * o chão "é": areia e grama, tábua de píer, telhado, coral, tijolo de castelo, lama.
 */
const THEMES: Record<string, Theme> = {
  natural: {
    ...ocean,
    [TileClass.Wet]: { base: '#b48a55', dark: '#9f784a', light: '#c79d67', pattern: 'speckle' },
    [TileClass.Low]: { base: '#e3c27e', dark: '#d1ad69', light: '#f0d79f', pattern: 'sand' },
    [TileClass.Middle]: { base: '#6aa04a', dark: '#578a3c', light: '#86bb5e', pattern: 'grass' },
    [TileClass.High]: { base: '#8a8378', dark: '#6e685f', light: '#a8a193', pattern: 'rock' },
  },
  porto: {
    ...ocean,
    [TileClass.Wet]: { base: '#5e4630', dark: '#45321f', light: '#71563b', pattern: 'planks' },
    [TileClass.Low]: { base: '#9a7149', dark: '#7a5636', light: '#b08457', pattern: 'planks' },
    [TileClass.Middle]: { base: '#b08457', dark: '#8a6440', light: '#c79a68', pattern: 'planks' },
    [TileClass.High]: { base: '#c49a5c', dark: '#8c6638', light: '#dcb478', pattern: 'crates' },
    materials: {
      [MATERIAL.deck]: planks('#a87b4f', '#80593a', '#bf9263'),
      [MATERIAL.crate]: { base: '#c49a5c', dark: '#8c6638', light: '#dcb478', pattern: 'crates' },
      // Galpão com telhado de zinco.
      [MATERIAL.shed]: { base: '#6f7f8c', dark: '#556370', light: '#8d9ca8', pattern: 'slate' },
    },
  },
  navio: {
    ...ocean,
    [TileClass.Wet]: { base: '#4d3a2a', dark: '#38291c', light: '#5f4834', pattern: 'planks' },
    [TileClass.Low]: { base: '#7a5a3c', dark: '#5c422b', light: '#8f6c4a', pattern: 'planks' },
    [TileClass.Middle]: { base: '#8f6a45', dark: '#6b4d31', light: '#a67f56', pattern: 'planks' },
    [TileClass.High]: { base: '#a87d50', dark: '#7d5a37', light: '#c19563', pattern: 'crates' },
    materials: {
      [MATERIAL.deck]: planks('#8f6a45', '#6b4d31', '#a67f56'),
      [MATERIAL.wall]: planks('#5c422b', '#3f2d1d', '#6f5236'),
      [MATERIAL.rock]: { base: '#7d776d', dark: '#615c54', light: '#9a9488', pattern: 'rock' },
    },
  },
  cidade: {
    ...ocean,
    [TileClass.Wet]: { base: '#6b6a66', dark: '#575652', light: '#7f7e79', pattern: 'concrete' },
    [TileClass.Low]: { base: '#9a978f', dark: '#827f78', light: '#b0ada5', pattern: 'concrete' },
    [TileClass.Middle]: { base: '#b8583a', dark: '#8f3f27', light: '#d0704f', pattern: 'roof' },
    [TileClass.High]: { base: '#5d6470', dark: '#454b55', light: '#757d8a', pattern: 'slate' },
    materials: {
      [MATERIAL.street]: {
        base: '#9a978f',
        dark: '#827f78',
        light: '#b0ada5',
        pattern: 'concrete',
      },
      [MATERIAL.roofRed]: { base: '#b8583a', dark: '#8f3f27', light: '#d0704f', pattern: 'roof' },
      [MATERIAL.roofSlate]: {
        base: '#5d6470',
        dark: '#454b55',
        light: '#757d8a',
        pattern: 'slate',
      },
      [MATERIAL.bridge]: planks('#9a7149', '#7a5636', '#b08457'),
    },
  },
  recife: {
    [TileClass.Deep]: { base: '#1f6b8a', dark: '#1a5c78', light: '#2d84a6', pattern: 'water' },
    [TileClass.Mid]: { base: '#2d93a8', dark: '#267f92', light: '#4aaebf', pattern: 'water' },
    [TileClass.Shallow]: { base: '#56c2c4', dark: '#46acae', light: '#9be0dc', pattern: 'water' },
    [TileClass.Wet]: { base: '#b0605a', dark: '#904a45', light: '#c47670', pattern: 'coral' },
    [TileClass.Low]: { base: '#e8857a', dark: '#c4665c', light: '#f6a99e', pattern: 'coral' },
    [TileClass.Middle]: { base: '#ef9b4c', dark: '#c97a32', light: '#f8bb78', pattern: 'coral' },
    [TileClass.High]: { base: '#9b6bc0', dark: '#7a4f9c', light: '#b98ddb', pattern: 'coral' },
  },
  castelo: {
    ...ocean,
    [TileClass.Wet]: { base: '#b48a55', dark: '#9f784a', light: '#c79d67', pattern: 'speckle' },
    [TileClass.Low]: { base: '#e3c27e', dark: '#d1ad69', light: '#f0d79f', pattern: 'sand' },
    [TileClass.Middle]: { base: '#d9b46e', dark: '#b8924f', light: '#ecc98a', pattern: 'brick' },
    [TileClass.High]: { base: '#c29a58', dark: '#9a763c', light: '#d8b273', pattern: 'brick' },
    materials: {
      [MATERIAL.beach]: { base: '#e3c27e', dark: '#d1ad69', light: '#f0d79f', pattern: 'sand' },
      [MATERIAL.wall]: { base: '#d9b46e', dark: '#b8924f', light: '#ecc98a', pattern: 'brick' },
      [MATERIAL.tower]: { base: '#c29a58', dark: '#8f6c38', light: '#d8b273', pattern: 'brick' },
      [MATERIAL.bridge]: planks('#8a6440', '#6b4d31', '#a67f56'),
    },
  },
  mangue: {
    [TileClass.Deep]: { base: '#2b3f36', dark: '#22332b', light: '#3a5245', pattern: 'water' },
    [TileClass.Mid]: { base: '#3d5a45', dark: '#324b39', light: '#527256', pattern: 'water' },
    [TileClass.Shallow]: { base: '#5d7a55', dark: '#4e6847', light: '#7c9870', pattern: 'water' },
    [TileClass.Wet]: { base: '#5a4632', dark: '#463524', light: '#6e5840', pattern: 'mud' },
    [TileClass.Low]: { base: '#6e573d', dark: '#55422d', light: '#84694b', pattern: 'mud' },
    [TileClass.Middle]: { base: '#6e573d', dark: '#3e2f20', light: '#84694b', pattern: 'roots' },
    [TileClass.High]: { base: '#3f7a3a', dark: '#2f5e2b', light: '#5a9a4f', pattern: 'canopy' },
  },
};

const THEME_OF: Record<MapKind, keyof typeof THEMES> = {
  morro: 'natural',
  arquipelago: 'natural',
  atol: 'natural',
  gemeas: 'natural',
  espinhaco: 'natural',
  porto: 'porto',
  navio: 'navio',
  cidade: 'cidade',
  recife: 'recife',
  castelo: 'castelo',
  mangue: 'mangue',
};

const isWater = (c: TileClass) => c <= TileClass.Shallow;

/** Gera o atlas de um tema: cada classe tem 4 variações x 2 quadros de animação. */
function buildAtlas(theme: Theme): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE * VARIANTS * FRAMES;
  canvas.height = TILE * (CLASS_COUNT + MATERIAL_ROWS);
  const ctx = canvas.getContext('2d')!;

  // Linhas 0..6: classes por altura; depois, uma linha por material do tema.
  for (let c = 0; c < CLASS_COUNT + MATERIAL_ROWS; c++) {
    const style = c < CLASS_COUNT ? theme[c as TileClass] : theme.materials?.[c - CLASS_COUNT];
    if (!style) continue;
    for (let v = 0; v < VARIANTS; v++) {
      for (let f = 0; f < FRAMES; f++) {
        const ox = (v * FRAMES + f) * TILE;
        const oy = c * TILE;
        ctx.fillStyle = style.base;
        ctx.fillRect(ox, oy, TILE, TILE);
        // Textura de fundo comum a todos: pontinhos escuros (e claros, fora d'água).
        for (let y = 0; y < TILE; y++) {
          for (let x = 0; x < TILE; x++) {
            const r = hash2(x, y, c * 31 + v * 7);
            if (r < 0.1) {
              ctx.fillStyle = style.dark;
              ctx.fillRect(ox + x, oy + y, 1, 1);
            } else if (r > 0.94 && style.pattern !== 'water') {
              ctx.fillStyle = style.light;
              ctx.fillRect(ox + x, oy + y, 1, 1);
            }
          }
        }
        drawPattern(ctx, style, ox, oy, v, f, c);
      }
    }
  }
  return canvas;
}

function drawPattern(
  ctx: CanvasRenderingContext2D,
  style: TileStyle,
  ox: number,
  oy: number,
  v: number,
  f: number,
  c: number,
): void {
  const px = (x: number, y: number, color: string, w = 1, h = 1) => {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x, oy + y, w, h);
  };
  const rnd = (i: number, salt: number) => hash2(i, v, salt + c * 13);

  switch (style.pattern) {
    case 'water':
      // Marolas: tracinhos que deslizam entre os quadros.
      for (let i = 0; i < 3; i++) {
        const y = (i * 5 + v * 3) % TILE;
        const x = (Math.floor(rnd(i, 1) * 12) + f * 2) % (TILE - 4);
        px(x, y, style.light, 3, 1);
      }
      break;
    case 'speckle':
      break;
    case 'sand':
      // Um furinho de siri aqui e ali.
      if (v === 0) px(9, 6, style.dark, 2, 2);
      break;
    case 'grass':
      for (let i = 0; i < 4; i++) {
        const x = Math.floor(rnd(i, 91) * 14) + 1;
        const y = Math.floor(rnd(i, 92) * 13) + 2;
        px(x, y, style.light, 1, 2);
        px(x + 1, y + 1, style.light);
      }
      break;
    case 'rock': {
      const x = Math.floor(rnd(3, 77) * 8) + 2;
      for (let i = 0; i < 5; i++) px(x + i, 4 + i + (i > 2 ? 1 : 0), style.dark);
      break;
    }
    case 'planks':
      // Tábuas de 4px com emendas desencontradas e pregos.
      for (let row = 0; row < 4; row++) {
        const y = row * 4;
        px(0, y + 3, style.dark, TILE, 1);
        const seam = (row * 7 + v * 5) % TILE;
        px(seam, y, style.dark, 1, 3);
        px((seam + 2) % TILE, y + 1, style.light);
      }
      break;
    case 'crates':
      // Caixote: moldura e travessa diagonal.
      px(0, 0, style.dark, TILE, 1);
      px(0, TILE - 1, style.dark, TILE, 1);
      px(0, 0, style.dark, 1, TILE);
      px(TILE - 1, 0, style.dark, 1, TILE);
      px(1, 1, style.light, TILE - 2, 1);
      for (let i = 2; i < TILE - 2; i++) px(v % 2 === 0 ? i : TILE - 1 - i, i, style.dark, 2, 1);
      break;
    case 'roof':
      // Telhas de barro: fileiras com "ondinhas" alternadas.
      for (let row = 0; row < 4; row++) {
        const y = row * 4;
        px(0, y + 3, style.dark, TILE, 1);
        for (let x = (row % 2) * 2; x < TILE; x += 4) {
          px(x, y + 1, style.dark, 1, 2);
          px(x + 1, y, style.light, 2, 1);
        }
      }
      break;
    case 'slate':
      // Ardósia: retângulos pequenos e escuros.
      for (let row = 0; row < 5; row++) {
        const y = row * 3 + 1;
        px(0, y + 2, style.dark, TILE, 1);
        for (let x = (row % 2) * 3; x < TILE; x += 6) px(x, y, style.dark, 1, 2);
      }
      break;
    case 'concrete': {
      // Rachadura em zigue-zague.
      let x = Math.floor(rnd(1, 40) * 10) + 3;
      for (let y = 2; y < TILE - 2; y++) {
        px(x, y, style.dark);
        if (hash2(y, v, 41) < 0.4) x += hash2(y, v, 42) < 0.5 ? -1 : 1;
      }
      break;
    }
    case 'coral':
      // Pólipos: bolinhas claras com centro escuro, e um raminho.
      for (let i = 0; i < 4; i++) {
        const x = Math.floor(rnd(i, 50) * 13) + 1;
        const y = Math.floor(rnd(i, 51) * 13) + 1;
        px(x, y, style.light, 2, 2);
        px(x + 1, y + 1, style.dark);
      }
      for (let i = 0; i < 4; i++) px(3 + i, 12 - i, style.dark);
      break;
    case 'brick':
      // Tijolos de areia batida com argamassa clara.
      for (let row = 0; row < 4; row++) {
        const y = row * 4;
        px(0, y + 3, style.light, TILE, 1);
        for (let x = row % 2 === 0 ? 0 : 4; x < TILE; x += 8) px(x, y, style.light, 1, 3);
        px((row * 5 + v * 3) % TILE, y + 1, style.dark, 2, 1);
      }
      break;
    case 'mud':
      // Lama brilhando: poças escuras com reflexo.
      for (let i = 0; i < 3; i++) {
        const x = Math.floor(rnd(i, 60) * 11) + 1;
        const y = Math.floor(rnd(i, 61) * 12) + 1;
        px(x, y, style.dark, 4, 2);
        px(x + 1, y, style.light);
      }
      break;
    case 'roots': {
      // Raízes do mangue: linhas curvas escuras saindo do chão.
      for (let r = 0; r < 2; r++) {
        let x = Math.floor(rnd(r, 70) * 10) + 3;
        for (let y = 1; y < TILE - 1; y++) {
          px(x, y, style.dark);
          if (y % 3 === 0) x += hash2(y, r + v, 71) < 0.5 ? -1 : 1;
          x = Math.max(0, Math.min(TILE - 1, x));
        }
      }
      break;
    }
    case 'canopy':
      // Copa das árvores: tufos de folhas.
      for (let i = 0; i < 5; i++) {
        const x = Math.floor(rnd(i, 80) * 12) + 1;
        const y = Math.floor(rnd(i, 81) * 12) + 1;
        px(x, y, style.light, 3, 2);
        px(x + 1, y + 2, style.dark, 2, 1);
      }
      break;
  }
}

function classify(h: number, level: number): TileClass {
  const depth = level - h;
  if (depth >= CRAB.deepWater + 0.8) return TileClass.Deep;
  if (depth >= 0.6) return TileClass.Mid;
  if (depth > 0) return TileClass.Shallow;
  if (h - level < 0.7) return TileClass.Wet;
  if (h <= 3) return TileClass.Low;
  if (h <= 7) return TileClass.Middle;
  return TileClass.High;
}

/**
 * Desenha o mapa inteiro num canvas (uma textura só). É redesenhado quando a água
 * troca a classe de algum tile, quando o terreno muda ou a cada quadro de animação.
 */
export class TerrainRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly atlases = new Map<string, HTMLCanvasElement>();
  private lastSignature = '';

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * TILE;
    this.canvas.height = height * TILE;
    this.ctx = this.canvas.getContext('2d')!;
  }

  private atlasFor(kind: MapKind): HTMLCanvasElement {
    const name = THEME_OF[kind];
    let atlas = this.atlases.get(name);
    if (!atlas) {
      atlas = buildAtlas(THEMES[name]!);
      this.atlases.set(name, atlas);
    }
    return atlas;
  }

  /** Retorna true se redesenhou (e a textura precisa de refresh). */
  draw(terrain: Terrain, level: number, frame: number, version: number, kind: MapKind): boolean {
    // Assinatura barata: nível quantizado + quadro + versão do terreno + tema.
    const signature = `${Math.round(level * 20)}:${frame}:${version}:${kind}`;
    if (signature === this.lastSignature) return false;
    this.lastSignature = signature;

    const atlas = this.atlasFor(kind);
    const theme = THEMES[THEME_OF[kind]]!;
    const ctx = this.ctx;
    const classes = new Uint8Array(this.width * this.height);
    for (let ty = 0; ty < this.height; ty++) {
      for (let tx = 0; tx < this.width; tx++) {
        classes[ty * this.width + tx] = classify(heightAt(terrain, tx, ty), level);
      }
    }
    const classAt = (tx: number, ty: number): TileClass =>
      tx < 0 || ty < 0 || tx >= this.width || ty >= this.height
        ? TileClass.Deep
        : (classes[ty * this.width + tx] as TileClass);

    for (let ty = 0; ty < this.height; ty++) {
      for (let tx = 0; tx < this.width; tx++) {
        const c = classAt(tx, ty);
        const h = heightAt(terrain, tx, ty);
        const v = Math.floor(hash2(tx, ty, 5) * VARIANTS);
        const f = isWater(c) ? (frame + tx + ty) % FRAMES : 0;
        const dx = tx * TILE;
        const dy = ty * TILE;
        const material = isWater(c) ? 0 : (terrain.materials?.[ty * this.width + tx] ?? 0);
        const row = material && theme.materials?.[material] ? CLASS_COUNT + material : c;
        ctx.drawImage(atlas, (v * FRAMES + f) * TILE, row * TILE, TILE, TILE, dx, dy, TILE, TILE);

        if (isWater(c)) {
          this.drawFoam(classAt, tx, ty, frame);
          continue;
        }
        // Material na beira d'água: escurece como chão molhado.
        if (row !== c && c === TileClass.Wet) {
          ctx.fillStyle = 'rgba(43,29,20,0.28)';
          ctx.fillRect(dx, dy, TILE, TILE);
        }

        // Quanto mais alto, mais claro: dá leitura de relevo.
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.22, h * 0.022)})`;
        ctx.fillRect(dx, dy, TILE, TILE);

        // Face do barranco: o tile de baixo é mais baixo → faixa escura na base.
        const below = heightAt(terrain, tx, ty + 1);
        if (below < h) {
          const drop = Math.min(3, h - below);
          ctx.fillStyle = `rgba(43,29,20,${0.18 + drop * 0.1})`;
          ctx.fillRect(dx, dy + TILE - 1 - drop, TILE, 1 + drop);
        }
        // Sombra projetada por um vizinho mais alto ao norte.
        if (heightAt(terrain, tx, ty - 1) > h) {
          ctx.fillStyle = 'rgba(43,29,20,0.18)';
          ctx.fillRect(dx, dy, TILE, 2);
        }
      }
    }
    return true;
  }

  private drawFoam(
    classAt: (tx: number, ty: number) => TileClass,
    tx: number,
    ty: number,
    frame: number,
  ): void {
    const ctx = this.ctx;
    const dx = tx * TILE;
    const dy = ty * TILE;
    const dry = (x: number, y: number) => !isWater(classAt(x, y));
    ctx.fillStyle = '#f4efe6';
    const off = frame % 2;
    for (let i = off; i < TILE; i += 3) {
      if (dry(tx, ty - 1)) ctx.fillRect(dx + i, dy, 2, 1 + ((i + off) % 2));
      if (dry(tx, ty + 1)) ctx.fillRect(dx + i, dy + TILE - 1 - ((i + off) % 2), 2, 1);
      if (dry(tx - 1, ty)) ctx.fillRect(dx, dy + i, 1 + ((i + off) % 2), 2);
      if (dry(tx + 1, ty)) ctx.fillRect(dx + TILE - 1, dy + i, 1, 2);
    }
  }
}
