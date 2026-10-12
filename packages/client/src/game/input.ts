/**
 * Entrada unificada (teclado + toque). Direção é estado contínuo (segurar);
 * dash, tiro e pegar/largar são toques acumulados até o envio de rede/predição consumir.
 */
export interface Actions {
  /** Shift ou Espaço: dash (só desloca). */
  dash: boolean;
  /** Clique (mouse) ou botão de atacar (toque): tiro; desarmado, pega a arma do chão. */
  attack: boolean;
  /** F: pega, larga ou troca de arma. */
  grab: boolean;
}

type ActionName = keyof Actions;
type Move = 'up' | 'down' | 'left' | 'right';

const KEYMAP: Record<string, ActionName | Move> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  Space: 'dash',
  KeyF: 'grab',
};

const isAction = (a: string): a is ActionName => a === 'dash' || a === 'attack' || a === 'grab';

const noActions = (): Actions => ({ dash: false, attack: false, grab: false });

export class InputController {
  private readonly held = new Set<string>();
  private pending: Actions = noActions();
  private stick = { x: 0, y: 0 };

  /** Posição do mouse na tela (começa no centro: sem isso o bicho olha pro canto). */
  private mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  /** Pedidos de trocar a câmera de quem assiste (+1 próximo, -1 anterior); a cena consome. */
  private spectate = 0;
  enabled = false;
  /** Tela de toque em uso (aparelho de toque, ou alguém já tocou na tela). */
  touchMode = false;
  /** Avisado quando o modo toque liga (a UI se redesenha). */
  onTouchMode: () => void = () => {};
  /**
   * Em partida (fora do menu e da pausa): o mouse fica preso na tela do jogo (Pointer Lock),
   * a seta do sistema some e a mira passa a ser desenhada pelo jogo. Assim o mouse não sai
   * da janela no meio da briga, nem clica sem querer em outra coisa.
   */
  private aiming = false;
  /** Fomos nós que soltamos o mouse (pausa, fim da partida): não é pra abrir o menu. */
  private releasing = false;
  /** O navegador recusou prender o mouse (às vezes recusa logo depois do Esc): espera um pouco. */
  private lockFailedAt = -Infinity;
  /** O navegador soltou o mouse sem a gente pedir (Esc, trocou de janela). */
  onLockLost: () => void = () => {};
  private readonly lockTarget = document.getElementById('game');
  private readonly crosshair = document.getElementById('crosshair');

  constructor() {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.held.clear());

    // Posição do mouse. Preso (Pointer Lock), o navegador só manda o deslocamento: a mira
    // anda por ele e fica dentro da tela.
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.mouse.x = Math.min(window.innerWidth - 1, Math.max(0, this.mouse.x + e.movementX));
        this.mouse.y = Math.min(window.innerHeight - 1, Math.max(0, this.mouse.y + e.movementY));
      } else {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      }
      this.moveCrosshair();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement !== null;
      document.body.classList.toggle('mouse-locked', locked);
      if (locked) return;
      if (this.releasing) {
        this.releasing = false;
        return;
      }
      if (this.aiming) this.onLockLost();
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailedAt = performance.now();
    });
    // Mouse de verdade (não o toque): quem tem os dois volta pra mira do mouse.
    window.addEventListener(
      'pointermove',
      (e) => {
        if (
          e.pointerType === 'mouse' &&
          this.touchMode &&
          matchMedia('(any-pointer: fine)').matches
        ) {
          this.disableTouchMode();
        }
      },
      { passive: true },
    );

    // Registra o clique do mouse (M1) para atacar
    window.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'BUTTON' || this.touchMode) return;
      if (!this.enabled) return;

      // Em partida com o mouse solto (trocou de janela, o navegador recusou antes): este
      // clique só prende o mouse de novo. O tiro vem no próximo, sem disparar sem querer.
      if (
        e.button === 0 &&
        this.aiming &&
        !document.pointerLockElement &&
        this.canLock() &&
        performance.now() - this.lockFailedAt > 2000
      ) {
        this.lockPointer();
        return;
      }

      // Botão esquerdo do mouse (0)
      if (e.button === 0) {
        this.pending.attack = true;
        this.spectate++; // morto, o clique passa pro próximo jogador
      }
    });

    this.setupTouch();
  }

  /** Tab/E/→ passam pro próximo jogador; Q/← voltam. Só vale pra quem já caiu (a cena decide). */
  consumeSpectate(): number {
    const step = this.spectate;
    this.spectate = 0;
    return step;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'INPUT') return;
    if (down && !e.repeat && this.enabled) {
      if (e.code === 'Tab' || e.code === 'KeyE') this.spectate++;
      else if (e.code === 'KeyQ') this.spectate--;
      else if (e.code === 'ArrowRight') this.spectate++;
      else if (e.code === 'ArrowLeft') this.spectate--;
      if (e.code === 'Tab') e.preventDefault();
    }
    const action = KEYMAP[e.code];
    if (!action || !this.enabled) return;
    if (e.code !== 'F5' && e.code !== 'F12') e.preventDefault(); // Permite F5/F12
    if (down) {
      if (!e.repeat && isAction(action)) this.pending[action] = true;
      this.held.add(action);
    } else {
      this.held.delete(action);
    }
  }

  release(): void {
    this.held.clear();
    this.pending = noActions();
  }

  direction(): { dx: number; dy: number } {
    let dx = this.stick.x;
    let dy = this.stick.y;
    if (this.held.has('left')) dx -= 1;
    if (this.held.has('right')) dx += 1;
    if (this.held.has('up')) dy -= 1;
    if (this.held.has('down')) dy += 1;
    const len = Math.hypot(dx, dy);
    return len > 1 ? { dx: dx / len, dy: dy / len } : { dx, dy };
  }

  aimPosition(): { x: number; y: number } {
    return { x: this.mouse.x, y: this.mouse.y };
  }

  peekActions(): Actions {
    return { ...this.pending };
  }

  hasPending(): boolean {
    return this.pending.dash || this.pending.attack || this.pending.grab;
  }

  consumeActions(): Actions {
    const out = this.peekActions();
    this.pending = noActions();
    return out;
  }

  /** Liga/desliga o modo partida (ver `aiming`). Desligar solta o mouse. */
  setAiming(on: boolean): void {
    this.aiming = on;
    this.syncAimingClass();
    if (!on) this.unlockPointer();
  }

  /**
   * Prende o mouse na tela do jogo. Só funciona dentro de um clique ou tecla do jogador
   * (regra do navegador), então é chamado nos botões que começam ou voltam pra partida.
   */
  lockPointer(): void {
    if (!this.canLock() || document.pointerLockElement) return;
    try {
      const pending = this.lockTarget!.requestPointerLock() as Promise<void> | undefined;
      pending?.catch?.(() => {
        this.lockFailedAt = performance.now();
      });
    } catch {
      this.lockFailedAt = performance.now();
    }
  }

  private unlockPointer(): void {
    if (!document.pointerLockElement) return;
    this.releasing = true;
    document.exitPointerLock();
  }

  private canLock(): boolean {
    return !this.touchMode && !!this.lockTarget && 'requestPointerLock' in this.lockTarget;
  }

  /** Esconde a seta e mostra a mira do jogo (no toque não há mira de mouse). */
  private syncAimingClass(): void {
    document.body.classList.toggle('aiming', this.aiming && !this.touchMode);
    this.moveCrosshair();
  }

  private moveCrosshair(): void {
    if (this.crosshair) {
      this.crosshair.style.transform = `translate(${this.mouse.x}px, ${this.mouse.y}px)`;
    }
  }

  private disableTouchMode(): void {
    this.touchMode = false;
    document.body.classList.remove('touch');
    const touchUi = document.getElementById('touch');
    if (touchUi) touchUi.dataset.enabled = 'false';
    this.syncAimingClass();
    this.onTouchMode();
  }

  private enableTouchMode(): void {
    if (this.touchMode) return;
    this.touchMode = true;
    document.body.classList.add('touch');
    const touchUi = document.getElementById('touch');
    if (touchUi) touchUi.dataset.enabled = 'true';
    this.syncAimingClass();
    this.unlockPointer();
    this.onTouchMode();
  }

  private setupTouch(): void {
    const touchUi = document.getElementById('touch');
    const zone = document.getElementById('stick-zone');
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    if (!touchUi || !zone || !stick || !knob) return;
    if (matchMedia('(pointer: coarse)').matches) this.enableTouchMode();
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') this.enableTouchMode();
      },
      { capture: true },
    );

    let pointerId: number | null = null;
    let center = { x: 0, y: 0 };
    const move = (e: PointerEvent) => {
      const max = stick.offsetWidth / 2;
      let x = e.clientX - center.x;
      let y = e.clientY - center.y;
      const len = Math.hypot(x, y);
      if (len > max) {
        x = (x / len) * max;
        y = (y / len) * max;
      }
      knob.style.transform = `translate(${x}px, ${y}px)`;
      const dead = len < max * 0.2;
      this.stick = dead ? { x: 0, y: 0 } : { x: x / max, y: y / max };
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      this.stick = { x: 0, y: 0 };
      knob.style.transform = '';
      stick.style.left = '';
      stick.style.top = '';
      stick.style.bottom = '';
      stick.classList.remove('on');
    };
    zone.addEventListener('pointerdown', (e) => {
      if (pointerId !== null) return;
      e.preventDefault();
      pointerId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const area = zone.getBoundingClientRect();
      const half = stick.offsetWidth / 2;
      const cx = Math.min(Math.max(e.clientX, area.left + half), area.right - half);
      const cy = Math.min(Math.max(e.clientY, area.top + half), area.bottom - half);
      center = { x: cx, y: cy };
      stick.style.left = `${cx - area.left - half}px`;
      stick.style.top = `${cy - area.top - half}px`;
      stick.style.bottom = 'auto';
      stick.classList.add('on');
      move(e);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointerId) move(e);
    });
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    touchUi.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
      const action = btn.dataset.action ?? '';
      if (!isAction(action)) return;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (!this.enabled) return;
        this.pending[action] = true;
        btn.classList.add('on');
      });
      const off = () => btn.classList.remove('on');
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    });
  }
}
