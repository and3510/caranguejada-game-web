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
  /** Tela de toque em uso (aparelho de toque, ou alguém já tocou na tela). */
  touchMode = false;
  /** Avisado quando o modo toque liga (a UI se redesenha). */
  onTouchMode: () => void = () => {};

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

  /**
   * Modo toque: liga se o aparelho for de toque, ou no primeiro toque na tela (tablet
   * com teclado, navegador de celular em "modo desktop"). Marca o body com `.touch`
   * para o CSS esconder o que é de teclado e mostrar os botões.
   */
  private enableTouchMode(): void {
    if (this.touchMode) return;
    this.touchMode = true;
    document.body.classList.add('touch');
    const touchUi = document.getElementById('touch');
    if (touchUi) touchUi.dataset.enabled = 'true';
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

    // Direcional flutuante: o centro vai pra onde o dedo encostou na metade esquerda,
    // então dá pra andar sem mirar num botão pequeno. Solto, ele volta pro canto.
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
      // Mantém o direcional inteiro dentro da área, mesmo tocando na beirada.
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
