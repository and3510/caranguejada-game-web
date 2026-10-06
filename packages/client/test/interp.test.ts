import { describe, expect, it } from 'vitest';
import { blendBetween } from '../src/game/interp';

/** Dois snapshots a 50ms de distância (a taxa real: 20 por segundo). */
const A = 1000;
const B = 1050;
const MAX = 150;

describe('interpolação dos outros jogadores', () => {
  it('no meio dos dois snapshots, interpola e não chuta nada', () => {
    expect(blendBetween(A, B, 1025, MAX)).toEqual({ k: 0.5, extra: 0 });
  });

  it('antes do primeiro snapshot, gruda nele (não volta no tempo)', () => {
    expect(blendBetween(A, B, 900, MAX)).toEqual({ k: 0, extra: 0 });
  });

  it('snapshot atrasado: segue o movimento em vez de congelar', () => {
    // 20ms de atraso = 0,4 do intervalo além do último snapshot.
    const { k, extra } = blendBetween(A, B, 1070, MAX);
    expect(k).toBe(1);
    expect(extra).toBeCloseTo(0.4, 6);
  });

  it('o chute tem teto: engasgo longo não manda o caranguejo pro outro lado do mapa', () => {
    const { k, extra } = blendBetween(A, B, 1000 + 50 + 2000, MAX);
    expect(k).toBe(1);
    expect(extra).toBe(MAX / 50); // 150ms de chute, nem um a mais
  });

  it('teto zero desliga o chute (volta a congelar)', () => {
    expect(blendBetween(A, B, 1070, 0)).toEqual({ k: 1, extra: 0 });
  });

  it('dois snapshots no mesmo instante não quebram a conta', () => {
    expect(blendBetween(A, A, 1070, MAX)).toEqual({ k: 1, extra: 0 });
  });
});
