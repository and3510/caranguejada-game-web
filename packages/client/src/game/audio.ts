import type { WeaponKind } from '@caranguejada/shared';

/**
 * Efeitos sonoros sintetizados na hora (WebAudio): zero arquivos de áudio,
 * timbre próprio e carregamento instantâneo.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Volume de 0 a 1 (escolhido pelo jogador). */
  volume = 0.7;

  /** Navegadores só liberam áudio depois de um gesto do usuário. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.gain();
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Curva quadrática: o controle soa mais natural ao ouvido do que linear. */
  private gain(): number {
    return this.volume * this.volume * 0.6;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this.gain();
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    volume = 0.5,
    delay = 0,
  ): void {
    const { ctx, master } = this;
    if (!ctx || !master || this.volume === 0) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private hiss(duration: number, volume: number, filterFreq: number): void {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise || this.volume === 0) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + duration);
  }

  /** Pancada: grave seco + estalo agudo. */
  shove(): void {
    this.tone('square', 220, 45, 0.18, 0.55);
    this.tone('sawtooth', 1200, 300, 0.05, 0.2);
    this.hiss(0.12, 0.4, 1100);
  }

  /** Golpe no ar (cada arma corta o vento de um jeito) ou estampido do tiro. */
  swing(kind: WeaponKind): void {
    switch (kind) {
      case 'espingarda':
        // Estrondo grave e longo, com o chumbo chiando.
        this.hiss(0.45, 0.7, 600);
        this.hiss(0.2, 0.5, 2500);
        this.tone('square', 140, 35, 0.35, 0.6);
        break;
      case 'revolver':
        // Estalo seco e agudo.
        this.hiss(0.18, 0.6, 1800);
        this.tone('square', 520, 90, 0.12, 0.45);
        break;
      case 'submetralhadora':
        // Cada bala da rajada: estalo curtinho (seis seguidos viram o "ra-ta-ta").
        this.hiss(0.05, 0.4, 2200);
        this.tone('square', 700, 200, 0.04, 0.25);
        break;
      case 'bazuca':
        // Lançamento: "fuuu" do foguete saindo do tubo.
        this.hiss(0.45, 0.45, 1200);
        this.tone('sawtooth', 160, 420, 0.4, 0.2);
        break;
    }
  }

  /** Explosão do foguete: estrondo grave e longo. */
  boom(): void {
    this.hiss(0.5, 0.9, 300);
    this.hiss(0.3, 0.5, 1400);
    this.tone('square', 110, 25, 0.5, 0.7);
  }

  /** Acerto: a pancada de sempre, com o timbre da arma por cima. */
  hit(kind: WeaponKind): void {
    // Bala da rajada: tapinha leve (o som forte já é o do tiro).
    if (kind === 'submetralhadora') {
      this.tone('square', 260, 90, 0.05, 0.25);
      return;
    }
    this.shove();
  }

  pickup(): void {
    this.tone('square', 660, 660, 0.05, 0.15);
    this.tone('square', 990, 990, 0.08, 0.15, 0.05);
  }

  drop(): void {
    this.tone('square', 440, 300, 0.08, 0.12);
  }

  /** Arma de fogo sem munição: o "clique" do gatilho vazio. */
  click(): void {
    this.tone('square', 1800, 1700, 0.025, 0.2);
    this.tone('square', 1200, 1100, 0.03, 0.15, 0.06);
  }

  /** Dash: "fuuf" de vento subindo. */
  dash(): void {
    this.hiss(0.16, 0.22, 1800);
    this.tone('triangle', 200, 520, 0.12, 0.18);
  }

  splash(): void {
    this.hiss(0.35, 0.35, 500);
    this.tone('sine', 420, 120, 0.3, 0.25);
  }

  countdown(final: boolean): void {
    this.tone('square', final ? 784 : 392, final ? 784 : 392, final ? 0.25 : 0.09, 0.2);
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.12, 0.18, i * 0.1));
  }
}
