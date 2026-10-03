import { describe, expect, it } from 'vitest';
import { MAP_KINDS } from '@caranguejada/shared';
import { mapsSummary, toggleMap } from '../src/ui/ui';

describe('seletor de mapas', () => {
  const all = [...MAP_KINDS];

  it('"Todos" volta pro aleatório total', () => {
    expect(toggleMap(['porto'], 'all')).toEqual(all);
  });

  it('com tudo marcado, tocar num mapa escolhe só ele', () => {
    expect(toggleMap(all, 'atol')).toEqual(['atol']);
  });

  it('depois, cada toque liga/desliga, na ordem oficial', () => {
    expect(toggleMap(['porto'], 'atol')).toEqual(['atol', 'porto']);
    expect(toggleMap(['atol', 'porto'], 'porto')).toEqual(['atol']);
  });

  it('nunca deixa a seleção vazia', () => {
    expect(toggleMap(['atol'], 'atol')).toEqual(['atol']);
  });

  it('resume a seleção', () => {
    expect(mapsSummary(all)).toBe('todos (aleatório)');
    expect(mapsSummary(['castelo'])).toBe('Castelo de Areia');
    expect(mapsSummary(['morro', 'atol', 'porto', 'navio'])).toBe('4 escolhidos');
  });
});
