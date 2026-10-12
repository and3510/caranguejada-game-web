/**
 * Trilha da partida: cada rodada toca uma música diferente, sem repetir dentro da partida.
 * A troca acontece quando a rodada nova começa (na contagem), com uma música sumindo
 * enquanto a outra entra; no resumo entre rodadas a música da rodada que acabou continua.
 * Sair da sala apaga a música.
 *
 * As músicas são as de `src/assets/musicas/`: o Vite acha sozinho tudo o que estiver lá
 * (basta soltar um .mp3 na pasta) e publica com nome versionado, que o navegador guarda
 * em cache de vez.
 *
 * Cada faixa toca num <audio> (vai baixando enquanto toca; 3 minutos decodificados de uma
 * vez ocupariam ~60 MB de memória no celular), mas o som passa pelo WebAudio dos efeitos:
 * o mesmo controle de volume vale pros dois, e o volume funciona no iPhone, que ignora
 * `audio.volume`. São dois tocadores revezando: enquanto um toca, o outro já baixa a
 * próxima faixa, e a troca de rodada é um cruzamento entre eles.
 */

const FILES = import.meta.glob<string>('../assets/musicas/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** As músicas da pasta, em ordem alfabética (a ordem de tocar é sorteada). */
export const TRACKS: readonly string[] = Object.keys(FILES)
  .sort()
  .map((k) => FILES[k]!);

/** Altura da música em relação aos efeitos (os arquivos são mixados bem alto). */
const MUSIC_LEVEL = 0.3;
const FADE_IN_SECONDS = 1;
const FADE_OUT_SECONDS = 1.2;

/**
 * A ordem das músicas. Sorteia a lista inteira e vai tocando uma de cada vez: numa partida
 * com até tantas rodadas quantas músicas, nenhuma se repete. Se acabar a lista (partida
 * longa, desempates), sorteia de novo — sem deixar a primeira da lista nova ser igual à
 * última que tocou. Partida nova também sorteia de novo, pela mesma regra.
 */
export class Playlist {
  private order: string[] = [];
  private pos = 0;
  private last: string | null = null;

  constructor(
    private readonly tracks: readonly string[],
    private readonly rng: () => number = Math.random,
  ) {
    this.shuffle();
  }

  /** Recomeça a lista (partida nova). */
  shuffle(): void {
    const order = [...this.tracks];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    if (order.length > 1 && order[0] === this.last) [order[0], order[1]] = [order[1]!, order[0]!];
    this.order = order;
    this.pos = 0;
  }

  /** A próxima música (e já conta como tocada). */
  next(): string | null {
    if (this.order.length === 0) return null;
    if (this.pos >= this.order.length) this.shuffle();
    const track = this.order[this.pos++]!;
    this.last = track;
    return track;
  }

  /** A música que vem depois, sem tirar da fila (pra já ir baixando). Null se for sortear de novo. */
  peek(): string | null {
    return this.order[this.pos] ?? null;
  }
}

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
  /** É o tocador que deveria estar soando agora. */
  live: boolean;
  track: string;
  timer: number;
}

export class Music {
  private ctx: AudioContext | null = null;
  private readonly decks: Deck[] = [];
  private current: Deck | null = null;
  private readonly playlist: Playlist;

  constructor(tracks: readonly string[] = TRACKS) {
    this.playlist = new Playlist(tracks);
  }

  /**
   * Chamado dentro do clique que entra na partida. Cria os dois tocadores, começa a baixar
   * e "destrava" a mídia: o iPhone só deixa tocar áudio que deu play dentro de um gesto,
   * então dá um play mudo em cada um aqui e pausa (a menos que já esteja em uso).
   */
  prime(ctx: AudioContext, out: AudioNode): void {
    if (this.decks.length > 0) return;
    const first = this.playlist.peek();
    if (!first) return;
    this.ctx = ctx;
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.loop = true; // rodada mais longa que a música: recomeça a mesma, sem silêncio
      el.preload = 'auto';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(out);
      const deck: Deck = { el, gain, live: false, track: '', timer: 0 };
      // O primeiro já fica com a música que vai abrir a partida.
      if (i === 0) this.load(deck, first);
      this.decks.push(deck);
      if (el.src) {
        el.play()
          .then(() => {
            if (!deck.live) el.pause();
          })
          .catch(() => {});
      }
    }
  }

  /** Partida nova: sorteia a ordem de novo e toca a primeira. */
  startMatch(): void {
    if (this.decks.length === 0) return;
    // Já baixando a que abriria a partida? Mantém a ordem pra aproveitar (só na primeira).
    if (!this.current) this.playNext();
    else {
      this.playlist.shuffle();
      this.playNext();
    }
  }

  /** Rodada nova (ou entrou numa partida já rolando): troca de música. */
  nextRound(): void {
    if (this.decks.length === 0) return;
    this.playNext();
  }

  /** Saiu da sala: abaixa devagar e pausa. */
  stop(): void {
    for (const deck of this.decks) if (deck.live) this.fadeOut(deck);
  }

  private playNext(): void {
    const track = this.playlist.next();
    if (!track) return;
    const old = this.current;
    // De preferência o tocador que já baixou esta música; senão, o que está livre.
    const deck =
      this.decks.find((d) => d !== old && d.track === track) ?? this.decks.find((d) => d !== old)!;
    window.clearTimeout(deck.timer);
    this.load(deck, track);
    deck.el.currentTime = 0;
    deck.live = true;
    this.ramp(deck, 0, 0);
    this.ramp(deck, MUSIC_LEVEL, FADE_IN_SECONDS);
    deck.el.play().catch(() => {});
    this.current = deck;
    // A outra some; quando terminar de sumir, já começa a baixar a da próxima rodada.
    if (old && old !== deck && old.live) {
      this.fadeOut(old, () => {
        const following = this.playlist.peek();
        if (following) this.load(old, following);
      });
    } else {
      const other = this.decks.find((d) => d !== deck);
      const following = this.playlist.peek();
      if (other && !other.live && following) this.load(other, following);
    }
  }

  private load(deck: Deck, track: string): void {
    if (deck.track === track) return;
    deck.track = track;
    deck.el.src = track;
  }

  private fadeOut(deck: Deck, after?: () => void): void {
    deck.live = false;
    this.ramp(deck, 0, FADE_OUT_SECONDS);
    window.clearTimeout(deck.timer);
    deck.timer = window.setTimeout(() => {
      if (deck.live) return;
      deck.el.pause();
      after?.();
    }, FADE_OUT_SECONDS * 1000);
  }

  private ramp(deck: Deck, to: number, seconds: number): void {
    const { ctx } = this;
    if (!ctx) return;
    const g = deck.gain.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    if (seconds <= 0) {
      g.setValueAtTime(to, now);
      return;
    }
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(to, now + seconds);
  }
}
