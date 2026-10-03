import {
  MAP_HINTS,
  MAP_KINDS,
  MAP_NAMES,
  isFlooding,
  type FxEvent,
  type MapKind,
  type PlayerInfo,
} from '@caranguejada/shared';
import { STAR_ART, STAR_PALETTE, crabCanvas, pixelArtCanvas } from '../game/sprites';
import type { Store } from '../state';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} não encontrado`);
  return el as T;
}

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

function crabIcon(color: number): HTMLCanvasElement {
  const canvas = crabCanvas(color, 0);
  canvas.classList.add('crab');
  return canvas;
}

function starIcon(isNew = false): HTMLCanvasElement {
  const canvas = pixelArtCanvas(STAR_ART, STAR_PALETTE);
  canvas.className = isNew ? 'star new' : 'star';
  return canvas;
}

/** Fileira de estrelas (rodadas vencidas). A última pode entrar animada. */
function starRow(count: number, animateLast = false): HTMLSpanElement {
  const row = document.createElement('span');
  row.className = 'stars';
  row.setAttribute('aria-label', `${count} ${count === 1 ? 'rodada vencida' : 'rodadas vencidas'}`);
  for (let i = 0; i < count; i++) row.append(starIcon(animateLast && i === count - 1));
  return row;
}

/** Resumo curto da seleção de mapas: "todos", o nome de um, ou a contagem. */
export function mapsSummary(maps: readonly MapKind[]): string {
  if (maps.length >= MAP_KINDS.length) return 'todos (aleatório)';
  if (maps.length === 1) return MAP_NAMES[maps[0]!];
  if (maps.length <= 3) return maps.map((m) => MAP_NAMES[m]).join(', ');
  return `${maps.length} escolhidos`;
}

/**
 * Seletor de mapas: botão "Todos" + um botão por mapa. Os botões são criados uma vez;
 * depois só muda quem está marcado.
 */
export function renderMapsPicker(
  group: HTMLElement,
  summary: HTMLElement,
  selected: readonly MapKind[],
  enabled = true,
): void {
  if (group.childElementCount === 0) {
    const all = document.createElement('button');
    all.type = 'button';
    all.dataset.map = 'all';
    all.textContent = 'Todos (aleatório)';
    group.append(all);
    for (const kind of MAP_KINDS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.map = kind;
      btn.textContent = MAP_NAMES[kind];
      group.append(btn);
    }
  }
  const isAll = selected.length >= MAP_KINDS.length;
  group.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((btn) => {
    const on = btn.dataset.map === 'all' ? isAll : selected.includes(btn.dataset.map as MapKind);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.disabled = !enabled;
  });
  summary.textContent = mapsSummary(selected);
}

/**
 * Regra de clique no seletor: "Todos" volta pro aleatório total; com tudo marcado,
 * tocar num mapa escolhe só ele; depois, cada toque liga/desliga (nunca fica vazio).
 */
export function toggleMap(current: readonly MapKind[], clicked: string): MapKind[] {
  if (clicked === 'all') return [...MAP_KINDS];
  const kind = clicked as MapKind;
  if (!MAP_KINDS.includes(kind)) return [...current];
  if (current.length >= MAP_KINDS.length) return [kind];
  const next = current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind];
  if (next.length === 0) return [...current];
  return MAP_KINDS.filter((k) => next.includes(k));
}

/** Marca o botão da quantidade escolhida num grupo de rodadas. */
export function renderRoundsPicker(group: HTMLElement, selected: number, enabled = true): void {
  group.querySelectorAll<HTMLButtonElement>('[data-rounds]').forEach((btn) => {
    const on = Number(btn.dataset.rounds) === selected;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-checked', String(on));
    btn.disabled = !enabled;
  });
}

/** Toda a manipulação de DOM fica aqui; a lógica de jogo não toca no HTML. */
export class Ui {
  readonly menu = $('menu');
  readonly lobby = $('lobby');
  readonly menuRounds = $('menu-rounds');
  readonly lobbyRounds = $('lobby-rounds');
  readonly menuMaps = $('menu-maps');
  readonly menuMapsSummary = $('menu-maps-summary');
  readonly lobbyMaps = $('lobby-maps');
  readonly roundSummary = $('round-summary');
  readonly hud = $('hud');
  readonly touch = $('touch');

  readonly nameInput = $<HTMLInputElement>('name');
  readonly codeInput = $<HTMLInputElement>('code');
  readonly btnSolo = $<HTMLButtonElement>('btn-solo');
  readonly btnCreate = $<HTMLButtonElement>('btn-create');
  readonly joinForm = $<HTMLFormElement>('join-form');
  readonly btnStart = $<HTMLButtonElement>('btn-start');
  readonly btnAddBot = $<HTMLButtonElement>('btn-add-bot');
  readonly btnRemoveBot = $<HTMLButtonElement>('btn-remove-bot');
  readonly btnLeave = $<HTMLButtonElement>('btn-leave');
  readonly btnCopy = $<HTMLButtonElement>('btn-copy');
  readonly btnPause = $<HTMLButtonElement>('btn-pause');
  readonly pause = $('pause');
  readonly btnResume = $<HTMLButtonElement>('btn-resume');
  readonly btnQuit = $<HTMLButtonElement>('btn-quit');
  readonly volumeInput = $<HTMLInputElement>('volume');

  private bannerTimer = 0;
  private lastCountdown = -1;

  constructor() {
    const title = $<HTMLCanvasElement>('title-crab');
    title.getContext('2d')!.drawImage(crabIcon(0xd9573b), 0, 0);
  }

  showMenu(error = ''): void {
    this.closePause();
    this.hideRoundSummary();
    this.menu.classList.remove('hidden');
    this.lobby.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.touch.classList.add('hidden');
    $('menu-error').textContent = error;
    this.setMenuBusy(false);
  }

  setMenuBusy(busy: boolean): void {
    for (const b of [this.btnSolo, this.btnCreate]) b.disabled = busy;
    this.joinForm.querySelector('button')!.disabled = busy;
  }

  /** Mostra lobby ou HUD conforme a fase da sala. */
  render(store: Store): void {
    const inLobby = store.phase === 'lobby' || store.phase === 'matchEnd';
    if (store.phase !== 'roundEnd') this.hideRoundSummary();
    this.menu.classList.add('hidden');
    this.lobby.classList.toggle('hidden', !inLobby);
    this.hud.classList.toggle('hidden', inLobby);
    const touchEnabled = this.touch.dataset.enabled === 'true';
    this.touch.classList.toggle('hidden', inLobby || !touchEnabled);
    if (inLobby) this.renderLobby(store);
    else this.renderScoreboard(store);
    $('hud-round').textContent =
      `rodada ${store.round}/${store.totalRounds} · ${MAP_NAMES[store.mapKind]}`;
  }

  private renderLobby(store: Store): void {
    $('room-code').textContent = store.code;
    $('results').classList.toggle('hidden', store.phase !== 'matchEnd');
    const me = store.player(store.you);
    const isHost = me?.host === true;
    $('host-controls').classList.toggle('hidden', !isHost);
    $('wait-host').classList.toggle('hidden', isHost);
    this.btnStart.textContent = store.phase === 'matchEnd' ? 'Jogar de novo' : 'Começar!';
    this.btnStart.disabled = store.players.length < 2;
    this.btnRemoveBot.disabled = !store.players.some((p) => p.bot);
    this.btnAddBot.disabled = store.players.length >= 8;

    // Só quem criou a sala escolhe; os outros só veem.
    this.lobbyRounds.classList.toggle('hidden', !isHost);
    renderRoundsPicker(this.lobbyRounds, store.totalRounds, isHost);
    const label = $('lobby-rounds-label');
    label.classList.toggle('hidden', isHost);
    label.textContent = String(store.totalRounds);

    // Mapas: o anfitrião escolhe; os outros veem o resumo.
    $('lobby-maps-box').classList.toggle('hidden', !isHost);
    renderMapsPicker(this.lobbyMaps, $('lobby-maps-summary'), store.maps, isHost);
    const mapsLabel = $('lobby-maps-label');
    mapsLabel.classList.toggle('hidden', isHost);
    mapsLabel.textContent = `Mapas: ${mapsSummary(store.maps)}`;

    // No resultado final o ranking já mostra todo mundo: a lista repetida só ocupa espaço.
    const list = $('players');
    list.classList.toggle('hidden', store.phase === 'matchEnd');
    list.replaceChildren(...store.players.map((p) => this.playerRow(p, store.you)));
  }

  private playerRow(p: PlayerInfo, you: string): HTMLLIElement {
    const li = document.createElement('li');
    li.append(crabIcon(p.color));
    const name = document.createElement('span');
    name.textContent = p.name + (p.id === you ? ' (você)' : '');
    li.append(name);
    const tagText = p.host ? 'anfitrião' : p.bot ? 'bot' : '';
    if (tagText) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tagText;
      li.append(tag);
    }
    return li;
  }

  renderRanking(
    ranking: { id: string; name: string; score: number; stars: number; color: number }[],
  ): void {
    const medals = ['1º', '2º', '3º'];
    $('ranking').replaceChildren(
      ...ranking.map((r, i) => {
        const li = document.createElement('li');
        const pos = document.createElement('span');
        pos.textContent = medals[i] ?? `${i + 1}º`;
        const name = document.createElement('span');
        name.textContent = r.name;
        const pts = document.createElement('span');
        pts.className = 'pts';
        pts.textContent = `${r.score} pts`;
        li.append(pos, crabIcon(r.color), name, starRow(r.stars), pts);
        return li;
      }),
    );
  }

  private renderScoreboard(store: Store): void {
    const alive = new Set(
      [...(store.latest()?.crabs.values() ?? [])].filter((c) => c.alive).map((c) => c.id),
    );
    const sorted = [...store.players].sort((a, b) => b.score - a.score);
    $('scoreboard').replaceChildren(
      ...sorted.map((p) => {
        const li = document.createElement('li');
        if (p.id === store.you) li.classList.add('me');
        if (store.phase === 'playing' && !alive.has(p.id)) li.classList.add('out');
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = hex(p.color);
        const name = document.createElement('span');
        name.textContent = p.name;
        const pts = document.createElement('span');
        pts.className = 'pts';
        pts.textContent = String(p.score);
        li.append(sw, name, starRow(p.stars), pts);
        return li;
      }),
    );
  }

  /**
   * Pop-up de fim de rodada: todos os caranguejos, com as estrelas acumuladas.
   * Quem venceu agora ganha a estrela nova com animação.
   */
  showRoundSummary(store: Store, winnerId: string | null, byPoints: boolean): void {
    const winner = winnerId ? store.player(winnerId) : undefined;
    const isLast = store.round >= store.totalRounds;
    $('summary-title').textContent = `Rodada ${store.round} de ${store.totalRounds}`;
    let sub: string;
    if (!winner) sub = 'Ninguém levou: afundaram juntos e empataram nos pontos.';
    else {
      const who = winner.id === store.you ? 'Você' : winner.name;
      sub = byPoints
        ? `${who} venceu no desempate (mais pontos na rodada)`
        : `${who} foi o último de pé`;
    }
    $('summary-sub').textContent = sub;

    // Aqui só importam as estrelas: quem venceu mais rodadas aparece em cima.
    const sorted = [...store.players].sort((a, b) => b.stars - a.stars);
    $('summary-list').replaceChildren(
      ...sorted.map((p) => {
        const li = document.createElement('li');
        if (p.id === winnerId) li.classList.add('winner');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = p.name + (p.id === store.you ? ' (você)' : '');
        const count = document.createElement('span');
        count.className = 'star-count';
        count.textContent = `×${p.stars}`;
        li.append(crabIcon(p.color), name, starRow(p.stars, p.id === winnerId), count);
        return li;
      }),
    );
    $('summary-next').textContent = isLast ? 'resultado final já já…' : 'próxima rodada já já…';
    this.roundSummary.classList.remove('hidden');
  }

  hideRoundSummary(): void {
    this.roundSummary.classList.add('hidden');
  }

  /** Atualizações por quadro: ilha restante, recarga do dash, contagem regressiva. */
  frame(
    store: Store,
    roundTime: number,
    land: number,
    dashReady: number,
    onBeep: (final: boolean) => void,
  ): void {
    const fill = $('tide-fill');
    // A barra mostra quanto da ilha a água já engoliu.
    fill.style.width = `${Math.round((1 - land) * 100)}%`;
    const tide = fill.closest('.tide')!;
    const flooding = isFlooding(roundTime) && store.phase === 'playing';
    tide.classList.toggle('flood', flooding);
    const landPct = Math.max(0, Math.round(land * 100));
    $('tide-label').textContent = flooding ? `ENCHENTE! ilha: ${landPct}%` : `ilha: ${landPct}%`;

    $('dash-fill').style.width = `${Math.round(Math.max(0, Math.min(1, dashReady)) * 100)}%`;
    $('dash-fill')
      .closest('.dash-meter')!
      .classList.toggle('ready', dashReady >= 1);

    if (store.phase === 'countdown') {
      const left = Math.ceil((store.countdownEndsAt - performance.now()) / 1000);
      if (left !== this.lastCountdown && left > 0) {
        this.lastCountdown = left;
        // Primeiro a dica do mapa; no último segundo, o mistério.
        const sub =
          left === 1
            ? 'o último pedaço de terra é surpresa: fica de olho na água'
            : `${MAP_NAMES[store.mapKind]}: ${MAP_HINTS[store.mapKind]}`;
        this.banner(String(left), sub, 1100);
        onBeep(false);
      }
    } else if (this.lastCountdown !== -1) {
      if (store.phase === 'playing') {
        this.banner('Vai!', '', 700);
        onBeep(true);
      }
      this.lastCountdown = -1;
    }
  }

  banner(text: string, sub = '', ms = 2500): void {
    const el = $('banner');
    el.replaceChildren(document.createTextNode(text));
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      el.append(small);
    }
    el.classList.remove('hidden');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => el.classList.add('hidden'), ms);
  }

  toast(text: string): void {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    box.prepend(el);
    while (box.children.length > 4) box.lastElementChild?.remove();
    window.setTimeout(() => el.remove(), 3500);
  }

  /** Narra os acontecimentos importantes no feed. */
  narrate(fx: FxEvent, store: Store): void {
    const name = (id?: string) =>
      id === store.you ? 'você' : (store.player(id ?? '')?.name ?? '?');
    if (fx.kind !== 'drown') return;
    if (fx.by) {
      this.toast(`${cap(name(fx.by))} jogou ${name(fx.target)} pro fundo (+${fx.value ?? 2})`);
    } else {
      this.toast(`${cap(name(fx.target))} afundou. glub.`);
    }
  }

  setLobbyError(text: string): void {
    $('lobby-error').textContent = text;
  }

  get isPauseOpen(): boolean {
    return !this.pause.classList.contains('hidden');
  }

  /** O menu só faz sentido durante a partida (o HUD está visível). */
  get canPause(): boolean {
    return !this.hud.classList.contains('hidden');
  }

  openPause(): void {
    this.pause.classList.remove('hidden');
    this.btnResume.focus();
  }

  closePause(): void {
    this.pause.classList.add('hidden');
  }

  setVolumeLabel(volume: number): void {
    this.volumeInput.value = String(Math.round(volume * 100));
    $('volume-value').textContent = `${Math.round(volume * 100)}%`;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
