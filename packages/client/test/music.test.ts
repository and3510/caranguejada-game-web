import { describe, expect, it } from 'vitest';
import { Playlist } from '../src/game/music';

const FAIXAS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

/** Gerador determinístico simples (o teste não pode depender da sorte). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('Playlist: uma música por rodada, sem repetir', () => {
  it('numa partida de 7 rodadas, toca as 7 músicas sem repetir nenhuma', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const p = new Playlist(FAIXAS, rng(seed));
      const tocadas = Array.from({ length: 7 }, () => p.next());
      expect(new Set(tocadas).size).toBe(7);
    }
  });

  it('partida longa (desempates): sorteia de novo sem repetir a mesma em seguida', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const p = new Playlist(FAIXAS, rng(seed));
      const tocadas = Array.from({ length: 30 }, () => p.next());
      for (let i = 1; i < tocadas.length; i++) expect(tocadas[i]).not.toBe(tocadas[i - 1]);
    }
  });

  it('partida nova não abre com a música que fechou a anterior', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const p = new Playlist(FAIXAS, rng(seed));
      for (let partida = 0; partida < 5; partida++) {
        const ultima = Array.from({ length: 3 }, () => p.next()).at(-1);
        p.shuffle();
        expect(p.next()).not.toBe(ultima);
      }
    }
  });

  it('peek mostra a próxima sem gastar (é o que fica baixando no outro tocador)', () => {
    const p = new Playlist(FAIXAS, rng(7));
    const proxima = p.peek();
    expect(p.next()).toBe(proxima);
  });

  it('a ordem muda de uma partida pra outra', () => {
    const p = new Playlist(FAIXAS, rng(3));
    const primeira = Array.from({ length: 7 }, () => p.next()).join();
    p.shuffle();
    const segunda = Array.from({ length: 7 }, () => p.next()).join();
    expect(segunda).not.toBe(primeira);
  });

  it('com uma música só, toca ela; sem nenhuma, não quebra', () => {
    const uma = new Playlist(['x'], rng(1));
    expect([uma.next(), uma.next(), uma.next()]).toEqual(['x', 'x', 'x']);
    expect(new Playlist([], rng(1)).next()).toBeNull();
  });
});
