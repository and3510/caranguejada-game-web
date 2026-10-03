import type { Rng } from './rng';

/** Só consoantes sem ambiguidade visual: evita palavrões acidentais e confusão I/1, O/0. */
export const ROOM_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const ROOM_CODE_LENGTH = 4;

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function isValidRoomCode(code: unknown): code is string {
  return typeof code === 'string' && ROOM_CODE_PATTERN.test(code);
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function randomRoomCode(rng: Rng = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}
