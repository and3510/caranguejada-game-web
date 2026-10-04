import { describe, expect, it } from 'vitest';
import { WEAPON_KINDS } from '@caranguejada/shared';
import { WEAPON_ART, WEAPON_GRIP, WEAPON_PALETTE } from '../src/game/sprites';

describe('sprites das armas', () => {
  it.each(WEAPON_KINDS)('%s: linhas do mesmo tamanho e só cores da paleta', (kind) => {
    const art = WEAPON_ART[kind];
    const width = art[0]!.length;
    for (const row of art) {
      expect(row).toHaveLength(width);
      for (const ch of row) expect(ch === '.' || ch in WEAPON_PALETTE).toBe(true);
    }
  });

  it.each(WEAPON_KINDS)('%s: ponto de pega dentro do desenho', (kind) => {
    const { x, y } = WEAPON_GRIP[kind];
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(1);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(1);
  });
});
