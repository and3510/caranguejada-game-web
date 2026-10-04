import { CLIFF_HEIGHT, CRAB } from './constants';
import { depthAt, heightAt, type Terrain } from './terrain';

/** Estado físico de um caranguejo. Mutável de propósito: roda a 30Hz. */
export interface Body {
  x: number;
  y: number;
  /** Velocidade de empurrão (knockback), decai com atrito. */
  kx: number;
  ky: number;
  /** Direção para onde o caranguejo está virado (vetor unitário). */
  fx: number;
  fy: number;
  dashT: number;
  stunT: number;
}

export interface MoveInput {
  dx: number;
  dy: number;
}

/** Multiplicadores de velocidade (arma carregada). */
export interface MoveMods {
  speed: number;
  swim: number;
}

const NO_MODS: MoveMods = { speed: 1, swim: 1 };

export function createBody(x: number, y: number): Body {
  return { x, y, kx: 0, ky: 0, fx: 0, fy: 1, dashT: 0, stunT: 0 };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Um tile seco bloqueia a passagem quando é alto demais em relação a onde o caranguejo está.
 * Nadando, a "altura" atual é a superfície da água — dá pra subir num píer baixo.
 */
export function isBlocked(
  terrain: Terrain,
  fromTx: number,
  fromTy: number,
  toTx: number,
  toTy: number,
  level: number,
): boolean {
  const target = heightAt(terrain, toTx, toTy);
  if (target < level) return false;
  const current = heightAt(terrain, fromTx, fromTy);
  // Nadando, o caranguejo sempre escala pra sair da água: paredão à beira d'água
  // (telhado, muralha, casco) não pode virar armadilha mortal.
  if (current < level) return false;
  return target - current >= CLIFF_HEIGHT;
}

function moveAxis(b: Body, mx: number, my: number, terrain: Terrain, level: number): void {
  const nx = clamp(b.x + mx, CRAB.radius, terrain.width - CRAB.radius);
  const ny = clamp(b.y + my, CRAB.radius, terrain.height - CRAB.radius);
  const ftx = Math.floor(b.x);
  const fty = Math.floor(b.y);
  const ttx = Math.floor(nx);
  const tty = Math.floor(ny);
  if ((ftx !== ttx || fty !== tty) && isBlocked(terrain, ftx, fty, ttx, tty, level)) {
    if (mx !== 0) b.kx = 0;
    if (my !== 0) b.ky = 0;
    return;
  }
  b.x = nx;
  b.y = ny;
}

/** Integra um passo de movimento. Usado pelo servidor e pela predição do cliente. */
export function stepBody(
  b: Body,
  input: MoveInput,
  terrain: Terrain,
  level: number,
  dt: number,
  mods: MoveMods = NO_MODS,
): void {
  const swimming = depthAt(terrain, b.x, b.y, level) > 0;
  const walkFactor = swimming ? CRAB.waterSpeedFactor * mods.swim : mods.speed;
  let vx = 0;
  let vy = 0;

  if (b.stunT > 0) {
    b.stunT = Math.max(0, b.stunT - dt);
  } else if (b.dashT > 0) {
    // O dash rende igual nadando: é a rota de fuga de quem caiu ou foi pego pela enchente.
    vx = b.fx * CRAB.dashSpeed;
    vy = b.fy * CRAB.dashSpeed;
    b.dashT = Math.max(0, b.dashT - dt);
  } else {
    const len = Math.hypot(input.dx, input.dy);
    if (len > 0.01) {
      const nx = input.dx / Math.max(1, len);
      const ny = input.dy / Math.max(1, len);
      b.fx = input.dx / len;
      b.fy = input.dy / len;
      vx = nx * CRAB.speed * walkFactor;
      vy = ny * CRAB.speed * walkFactor;
    }
  }

  vx += b.kx;
  vy += b.ky;
  const friction = swimming ? CRAB.waterKnockbackFriction : CRAB.knockbackFriction;
  const decay = Math.exp(-friction * dt);
  b.kx *= decay;
  b.ky *= decay;
  if (Math.abs(b.kx) < 0.01) b.kx = 0;
  if (Math.abs(b.ky) < 0.01) b.ky = 0;

  moveAxis(b, vx * dt, 0, terrain, level);
  moveAxis(b, 0, vy * dt, terrain, level);
}
