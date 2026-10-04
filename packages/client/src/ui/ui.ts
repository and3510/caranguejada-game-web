import {
  MAP_HINTS,
  MAP_KINDS,
  MAP_NAMES,
  WEAPONS,
  isFlooding,
  type FxEvent,
  type MapKind,
  type PlayerInfo,
  type RoundNext,
  type WeaponKind,
} from '@caranguejada/shared';
import type { FrameInfo } from '../game/GameScene';
import { STAR_ART, STAR_PALETTE, crabCanvas, pixelArtCanvas, weaponCanvas } from '../game/sprites';
import type { Store } from '../state';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} não encontrado`);
  return el as T;
}

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/** Rodapé do pop-up de fim de rodada: o que vem a seguir. */
const NEXT_TEXT: Record<RoundNext, string> = {
  round: 'próxima rodada já já…',
  tiebreak: 'empate nas estrelas: vem uma rodada extra de desempate!',
  matchEnd: 'resultado final já já…',
};

/** Artigo de cada arma, para a narração ("com a bazuca", "seu revólver"). */
const ARTICLE: Record<WeaponKind, 'o' | 'a'> = {
  espingarda: 'a',
  revolver: 'o',
  submetralhadora: 'a',
  bazuca: 'a',
};

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
  /** Evita mexer no DOM do slot da arma, da maré e dos botões de toque a cada quadro. */
  private weaponSlotKey = '';
  private tideKey = '';
  private touchKey = '';

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
    // Controles de toque só enquanto dá pra jogar: na contagem e no fim de rodada só poluem.
    const touchEnabled = this.touch.dataset.enabled === 'true';
    this.touch.classList.toggle('hidden', store.phase !== 'playing' || !touchEnabled);
    if (inLobby) this.renderLobby(store);
    else this.renderScoreboard(store);
    const extra = store.round - store.totalRounds;
    $('hud-round-label').textContent =
      extra > 0 ? `desempate ${extra}` : `rodada ${store.round}/${store.totalRounds}`;
    // O nome do mapa some em tela pequena (CSS): o número da rodada é o que importa.
    $('hud-map').textContent = ` · ${MAP_NAMES[store.mapKind]}`;
  }

  private renderLobby(store: Store): void {
    $('room-code').textContent = store.code;
    $('results').classList.toggle('hidden', store.phase !== 'matchEnd');
    // Com o resultado na tela, em celular deitado a placa vira duas colunas (CSS).
    this.lobby
      .querySelector('.lobby-board')!
      .classList.toggle('with-results', store.phase === 'matchEnd');
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

    // Quem está na sala agora (inclusive depois do resultado final, pra ver os bots
    // que o anfitrião põe ou tira antes de jogar de novo).
    const bots = store.players.filter((p) => p.bot).length;
    const total = store.players.length;
    const crabs = `${total} ${total === 1 ? 'caranguejo' : 'caranguejos'}`;
    const botsText = bots === 0 ? 'nenhum bot' : `${bots} ${bots === 1 ? 'bot' : 'bots'}`;
    $('roster').textContent =
      store.phase === 'matchEnd'
        ? `Na sala pra próxima partida: ${crabs} (${botsText})`
        : `Na sala: ${crabs} (${botsText})`;
    $('players').replaceChildren(...store.players.map((p) => this.playerRow(p, store.you)));
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
    // Mesma ordem do resultado final: estrelas primeiro, pontos desempatam.
    const sorted = [...store.players].sort((a, b) => b.stars - a.stars || b.score - a.score);
    $('scoreboard').replaceChildren(
      ...sorted.map((p) => {
        const li = document.createElement('li');
        if (p.id === store.you) li.classList.add('me');
        if (store.phase === 'playing' && !alive.has(p.id)) li.classList.add('out');
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = hex(p.color);
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = p.name;
        // Versão compacta (tela pequena): uma estrela e o número, no lugar da fileira.
        const starNum = document.createElement('span');
        starNum.className = 'star-num';
        if (p.stars > 0) starNum.append(starIcon(), String(p.stars));
        const pts = document.createElement('span');
        pts.className = 'pts';
        pts.textContent = String(p.score);
        li.title = p.name;
        li.append(sw, name, starRow(p.stars), starNum, pts);
        return li;
      }),
    );
  }

  /**
   * Pop-up de fim de rodada: todos os caranguejos, com as estrelas acumuladas.
   * Quem venceu agora ganha a estrela nova com animação.
   */
  showRoundSummary(store: Store, winnerId: string | null, next: RoundNext): void {
    const winner = winnerId ? store.player(winnerId) : undefined;
    const extra = store.round - store.totalRounds;
    $('summary-title').textContent =
      extra > 0 ? `Rodada extra de desempate` : `Rodada ${store.round} de ${store.totalRounds}`;
    let sub: string;
    if (!winner) sub = 'Empate: ninguém levou a estrela.';
    else sub = `${winner.id === store.you ? 'Você' : winner.name} foi o último de pé`;
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
    $('summary-next').textContent = NEXT_TEXT[next];
    this.roundSummary.classList.remove('hidden');
  }

  hideRoundSummary(): void {
    this.roundSummary.classList.add('hidden');
  }

  /** Atualizações por quadro: ilha restante, recargas, arma na mão, contagem regressiva. */
  frame(store: Store, info: FrameInfo, onBeep: (final: boolean) => void): void {
    const { roundTime, land, dashReady } = info;
    const fill = $('tide-fill');
    // A barra mostra quanto da ilha a água já engoliu.
    fill.style.width = `${Math.round((1 - land) * 100)}%`;
    const tide = fill.closest('.tide')!;
    const flooding = isFlooding(roundTime) && store.phase === 'playing';
    tide.classList.toggle('flood', flooding);
    const landPct = Math.max(0, Math.round(land * 100));
    const tideKey = `${flooding}:${landPct}`;
    if (tideKey !== this.tideKey) {
      this.tideKey = tideKey;
      // "ilha:" some em tela pequena (CSS); o aviso de enchente e o número ficam.
      const word = document.createElement('span');
      word.className = 'tide-word';
      word.textContent = 'ilha: ';
      $('tide-label').replaceChildren(...(flooding ? ['ENCHENTE! '] : []), word, `${landPct}%`);
    }

    $('dash-fill').style.width = `${Math.round(Math.max(0, Math.min(1, dashReady)) * 100)}%`;
    $('dash-fill')
      .closest('.dash-meter')!
      .classList.toggle('ready', dashReady >= 1);
    this.renderWeaponSlot(info);
    if (this.touch.dataset.enabled === 'true') this.renderTouchButtons(info);

    if (store.phase === 'countdown') {
      const left = Math.ceil((store.countdownEndsAt - performance.now()) / 1000);
      if (left !== this.lastCountdown && left > 0) {
        this.lastCountdown = left;
        // Desempate avisa primeiro; depois a dica do mapa; no último segundo, o mistério.
        const tiebreak = store.round > store.totalRounds;
        const sub =
          left === 1
            ? 'o último pedaço de terra é surpresa: fica de olho na água'
            : tiebreak && left >= 3
              ? 'rodada extra de desempate: quem vencer fica na frente!'
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

  /**
   * Botões de toque carregam a informação dos painéis (que somem no celular):
   * ATACAR mostra a arma, a munição e a recarga; DASH, a recarga; o terceiro botão
   * só aparece armado (largar, ou trocar se houver outra arma perto).
   */
  private renderTouchButtons({
    weapon,
    uses,
    attackReady,
    dashReady,
    nearWeapon,
  }: FrameInfo): void {
    const pct = (ready: number) => `${Math.round((1 - Math.max(0, Math.min(1, ready))) * 100)}%`;
    $('tbtn-dash-fill').style.height = pct(dashReady);
    $('tbtn-dash').classList.toggle('cooling', dashReady < 1);
    $('tbtn-attack-fill').style.height = weapon ? pct(attackReady) : '0%';

    const key = `${weapon ?? '-'}:${uses}:${nearWeapon ?? '-'}`;
    if (key === this.touchKey) return;
    const kindChanged = this.touchKey.split(':')[0] !== (weapon ?? '-');
    this.touchKey = key;
    const attack = $('tbtn-attack');
    attack.classList.toggle('armed', weapon !== null);
    attack.classList.toggle('pick', !weapon && nearWeapon !== null);
    attack.classList.toggle('idle', !weapon && nearWeapon === null);
    if (kindChanged) {
      const icon = weapon ? weaponCanvas(weapon) : document.createElement('canvas');
      icon.id = 'tbtn-weapon';
      icon.className = 'tbtn-weapon';
      icon.setAttribute('aria-hidden', 'true');
      $('tbtn-weapon').replaceWith(icon);
    }
    $('tbtn-attack-label').textContent = weapon ? String(uses) : nearWeapon ? 'pegar' : 'sem arma';
    attack.setAttribute(
      'aria-label',
      weapon ? `atirar (${uses} de munição)` : nearWeapon ? 'pegar a arma' : 'sem arma',
    );
    const grab = $('tbtn-grab');
    grab.classList.toggle('hidden', !weapon);
    grab.textContent = nearWeapon ? 'trocar' : 'largar';
  }

  /** Slot da arma: ícone, nome, munição, recarga e o que ela faz de especial. */
  private renderWeaponSlot({ weapon, uses, attackReady }: FrameInfo): void {
    const slot = $('weapon-slot');
    const ready = Math.max(0, Math.min(1, attackReady));
    $('attack-fill').style.width = `${Math.round(ready * 100)}%`;
    slot.classList.toggle('ready', weapon !== null && ready >= 1);

    const key = `${weapon ?? '-'}:${uses}`;
    if (key === this.weaponSlotKey) return;
    const kindChanged = this.weaponSlotKey.split(':')[0] !== (weapon ?? '-');
    this.weaponSlotKey = key;
    slot.classList.toggle('empty', weapon === null);
    if (kindChanged) {
      const icon = weapon ? weaponCanvas(weapon) : document.createElement('canvas');
      icon.id = 'weapon-icon';
      icon.setAttribute('aria-hidden', 'true');
      $('weapon-icon').replaceWith(icon);
    }
    if (!weapon) {
      $('weapon-name').textContent = 'sem arma';
      $('weapon-uses').textContent = '';
      $('weapon-hint').textContent = 'só dash: ache uma arma no mapa e aperte E';
      return;
    }
    const spec = WEAPONS[weapon];
    $('weapon-name').textContent = spec.name;
    $('weapon-uses').textContent = `${uses} ${uses === 1 ? spec.unit[0] : spec.unit[1]}`;
    $('weapon-hint').textContent = spec.hint;
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
    if (fx.kind === 'break' && fx.by === store.you && fx.weapon) {
      const own = ARTICLE[fx.weapon] === 'a' ? 'Sua' : 'Seu';
      this.toast(`${own} ${WEAPONS[fx.weapon].name.toLowerCase()} ficou sem munição!`);
      return;
    }
    if (fx.kind !== 'drown') return;
    if (fx.by) {
      const how = fx.weapon
        ? ` com ${ARTICLE[fx.weapon]} ${WEAPONS[fx.weapon].name.toLowerCase()}`
        : '';
      this.toast(
        `${cap(name(fx.by))} jogou ${name(fx.target)} pro fundo${how} (+${fx.value ?? 2})`,
      );
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
