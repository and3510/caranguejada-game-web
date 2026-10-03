/**
 * Entrada unificada (teclado + toque). Direção é estado contínuo (segurar);
 * o dash é um toque acumulado até ser consumido pelo envio de rede/predição.
 */
export interface Actions {
  dash: boolean;
}

const KEYMAP: Record<string, 'dash' | 'up' | 'down' | 'left' | 'right'> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'dash',
  ShiftLeft: 'dash',
  KeyJ: 'dash',
};

export class InputController {
  private readonly held = new Set<string>();
  private pendingDash = false;
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
      if (!e.repeat && action === 'dash') this.pendingDash = true;
      this.held.add(action);
    } else {
      this.held.delete(action);
    }
  }

  /** Solta tudo (ex.: ao abrir o menu), para o caranguejo não sair andando sozinho. */
  release(): void {
    this.held.clear();
    this.pendingDash = false;
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
    return { dash: this.pendingDash };
  }

  consumeActions(): Actions {
    const out = this.peekActions();
    this.pendingDash = false;
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

    touchUi.querySelectorAll<HTMLButtonElement>('[data-action="dash"]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (!this.enabled) return;
        this.pendingDash = true;
        btn.classList.add('on');
      });
      const off = () => btn.classList.remove('on');
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    });
  }
}
