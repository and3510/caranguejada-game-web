/**
 * Entrada unificada (teclado + toque). Direção é estado contínuo (segurar);
 * dash, tiro e pegar/largar são toques acumulados até o envio de rede/predição consumir.
 */
export interface Actions {
  /** C: dash (só desloca). */
  dash: boolean;
  /** Espaço: tiro com a arma na mão (desarmado, pega a arma do chão). */
  attack: boolean;
  /** R: pega, larga ou troca de arma. */
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
  KeyC: 'dash',
  Space: 'attack',
  KeyR: 'grab',
};

const isAction = (a: string): a is ActionName => a === 'dash' || a === 'attack' || a === 'grab';

const noActions = (): Actions => ({ dash: false, attack: false, grab: false });

export class InputController {
  private readonly held = new Set<string>();
  private pending: Actions = noActions();
  private stick = { x: 0, y: 0 };
  enabled = false;

  constructor() {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.held.clear());
    this.setupTouch();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'INPUT') return;
    const action = KEYMAP[e.code];
    if (!action || !this.enabled) return;
    e.preventDefault();
    if (down) {
      if (!e.repeat && isAction(action)) this.pending[action] = true;
      this.held.add(action);
    } else {
      this.held.delete(action);
    }
  }

  /** Solta tudo (ex.: ao abrir o menu), para o caranguejo não sair andando sozinho. */
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

  /** Lê sem consumir (para a predição local). */
  peekActions(): Actions {
    return { ...this.pending };
  }

  /** Algum toque esperando envio? (manda na hora em vez de esperar o próximo pacote) */
  hasPending(): boolean {
    return this.pending.dash || this.pending.attack || this.pending.grab;
  }

  consumeActions(): Actions {
    const out = this.peekActions();
    this.pending = noActions();
    return out;
  }

  private setupTouch(): void {
    const touchUi = document.getElementById('touch');
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    if (!touchUi || !stick || !knob) return;
    if (!matchMedia('(pointer: coarse)').matches) return;
    touchUi.dataset.enabled = 'true';

    let pointerId: number | null = null;
    const move = (e: PointerEvent) => {
      const rect = stick.getBoundingClientRect();
      const max = rect.width / 2;
      let x = e.clientX - (rect.left + max);
      let y = e.clientY - (rect.top + max);
      const len = Math.hypot(x, y);
      if (len > max) {
        x = (x / len) * max;
        y = (y / len) * max;
      }
      knob.style.transform = `translate(${x}px, ${y}px)`;
      const dead = len < max * 0.2;
      this.stick = dead ? { x: 0, y: 0 } : { x: x / max, y: y / max };
    };
    const release = () => {
      pointerId = null;
      this.stick = { x: 0, y: 0 };
      knob.style.transform = '';
    };
    stick.addEventListener('pointerdown', (e) => {
      pointerId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      move(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointerId) move(e);
    });
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

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
