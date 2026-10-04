import './style.css';
import Phaser from 'phaser';
import {
  DEFAULT_ROUNDS,
  isValidRoomCode,
  isValidRoundCount,
  MAP_KINDS,
  normalizeMapPool,
  normalizeRoomCode,
  randomRoomCode,
  sanitizeName,
  type JoinMode,
  type MapKind,
} from '@caranguejada/shared';
import { Sfx } from './game/audio';
import { GameScene } from './game/GameScene';
import { InputController } from './game/input';
import { Connection } from './net/Connection';
import { Store } from './state';
import { Ui, renderMapsPicker, renderRoundsPicker, toggleMap } from './ui/ui';

const store = new Store();
const ui = new Ui();
const input = new InputController();
const sfx = new Sfx();
let conn: Connection | null = null;

// localStorage pode falhar (aba anônima, bloqueio de cookies): nunca é crítico.
const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignora */
    }
  },
};

// ---------------------------------------------------------------- conexão

function connect(mode: JoinMode, code = randomRoomCode()): void {
  sfx.unlock();
  const name = sanitizeName(ui.nameInput.value);
  ui.nameInput.value = name;
  storage.set('caranguejada:name', name);
  ui.setMenuBusy(true);
  let retries = 0;

  const open = (roomCode: string) => {
    // Quem entra numa sala existente usa o que o anfitrião escolheu.
    const setup = mode === 'entrar' ? {} : { rounds: menuRounds, maps: menuMaps };
    const c = new Connection(roomCode, mode, name, setup);
    conn = c;
    c.on('welcome', (m) => {
      store.you = m.you;
      store.code = m.code;
      history.replaceState(null, '', `?sala=${m.code}`);
      input.enabled = true;
      ui.setLobbyError('');
    })
      .on('room', (m) => {
        store.phase = m.phase;
        store.players = m.players;
        store.round = m.round;
        store.totalRounds = m.totalRounds;
        store.maps = m.maps;
        // Acabou a partida com o menu aberto: fecha e devolve os controles.
        if (ui.isPauseOpen && (m.phase === 'lobby' || m.phase === 'matchEnd')) closePause();
        ui.render(store);
      })
      .on('round', (m) => {
        store.startRound(m.round, m.seed, m.map, m.heights, m.countdown);
      })
      .on('snap', (m) => {
        store.pushSnapshot(m.time, m.crabs, m.weapons, m.rockets);
        store.applyTiles(m.tiles);
        store.fxQueue.push(...m.fx);
        for (const fx of m.fx) ui.narrate(fx, store);
        if (m.fx.some((f) => f.kind === 'drown')) ui.render(store);
      })
      .on('roundEnd', (m) => {
        // O servidor manda o placar (com a estrela nova) logo antes deste aviso.
        ui.showRoundSummary(store, m.winner, m.next);
        if (m.winner === store.you) sfx.win();
      })
      .on('matchEnd', (m) => {
        ui.renderRanking(m.ranking);
        if (m.ranking[0]?.id === store.you) sfx.win();
      })
      .on('error', (m) => ui.setLobbyError(m.message));

    c.onClose = ({ error, wasOpen }) => {
      conn = null;
      input.enabled = false;
      // Código gerado colidiu com uma sala existente: tenta outro.
      if (error?.code === 'room_exists' && mode !== 'entrar' && retries++ < 3) {
        open(randomRoomCode());
        return;
      }
      store.reset();
      history.replaceState(null, '', location.pathname);
      ui.showMenu(
        error?.message ??
          (wasOpen ? 'A conexão caiu. Tente de novo.' : 'Não consegui falar com o servidor.'),
      );
    };
  };
  open(code);
}

function leave(): void {
  conn?.close();
  conn = null;
  input.enabled = false;
  store.reset();
  history.replaceState(null, '', location.pathname);
  ui.showMenu();
}

// ---------------------------------------------------------------- UI

ui.nameInput.value = storage.get('caranguejada:name') ?? '';

// Rodadas escolhidas no menu (valem para "Jogar sozinho" e "Criar sala").
const savedRounds = Number(storage.get('caranguejada:rounds'));
let menuRounds = isValidRoundCount(savedRounds) ? savedRounds : DEFAULT_ROUNDS;
renderRoundsPicker(ui.menuRounds, menuRounds);
ui.menuRounds.addEventListener('click', (e) => {
  const value = Number(
    (e.target as HTMLElement).closest<HTMLElement>('[data-rounds]')?.dataset.rounds,
  );
  if (!isValidRoundCount(value)) return;
  menuRounds = value;
  storage.set('caranguejada:rounds', String(value));
  renderRoundsPicker(ui.menuRounds, menuRounds);
});
// No lobby (inclusive depois do resultado), o anfitrião troca sem sair da sala.
// Mapas escolhidos no menu (também valem para solo e criar sala).
const savedMaps = normalizeMapPool(storage.get('caranguejada:maps')?.split(','));
let menuMaps: MapKind[] = savedMaps ?? [...MAP_KINDS];
const setMenuMaps = (maps: MapKind[]) => {
  menuMaps = maps;
  storage.set('caranguejada:maps', maps.join(','));
  renderMapsPicker(ui.menuMaps, ui.menuMapsSummary, menuMaps);
};
setMenuMaps(menuMaps);
const clickedMap = (e: Event) =>
  (e.target as HTMLElement).closest<HTMLElement>('[data-map]')?.dataset.map;
ui.menuMaps.addEventListener('click', (e) => {
  const clicked = clickedMap(e);
  if (clicked) setMenuMaps(toggleMap(menuMaps, clicked));
});
// No lobby o anfitrião troca os mapas sem sair da sala (inclusive após o resultado).
ui.lobbyMaps.addEventListener('click', (e) => {
  const clicked = clickedMap(e);
  if (!clicked) return;
  const next = toggleMap(store.maps, clicked);
  conn?.send({ t: 'setMaps', maps: next });
  setMenuMaps(next);
});

ui.lobbyRounds.addEventListener('click', (e) => {
  const value = Number(
    (e.target as HTMLElement).closest<HTMLElement>('[data-rounds]')?.dataset.rounds,
  );
  if (!isValidRoundCount(value)) return;
  conn?.send({ t: 'setRounds', rounds: value });
  menuRounds = value;
  storage.set('caranguejada:rounds', String(value));
  renderRoundsPicker(ui.menuRounds, menuRounds);
});
const fromUrl = new URLSearchParams(location.search).get('sala');
if (fromUrl) ui.codeInput.value = normalizeRoomCode(fromUrl);

ui.btnSolo.addEventListener('click', () => connect('solo'));
ui.btnCreate.addEventListener('click', () => connect('criar'));
ui.joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeRoomCode(ui.codeInput.value);
  if (!isValidRoomCode(code)) {
    ui.showMenu('Código inválido: são 4 letras, tipo BRKZ.');
    return;
  }
  connect('entrar', code);
});
ui.btnStart.addEventListener('click', () => conn?.send({ t: 'start' }));
ui.btnAddBot.addEventListener('click', () => conn?.send({ t: 'addBot' }));
ui.btnRemoveBot.addEventListener('click', () => conn?.send({ t: 'removeBot' }));
ui.btnLeave.addEventListener('click', leave);
ui.btnCopy.addEventListener('click', () => {
  const link = `${location.origin}/?sala=${store.code}`;
  navigator.clipboard?.writeText(link).then(
    () => {
      ui.btnCopy.textContent = 'copiado!';
      window.setTimeout(() => (ui.btnCopy.textContent = 'Copiar link'), 1500);
    },
    () => window.prompt('Copie o link:', link),
  );
});

// ---------------------------------------------------------------- menu da partida
// Não pausa a simulação (é multiplayer): só abre por cima e solta os controles.

const savedVolume = Number.parseFloat(storage.get('caranguejada:volume') ?? '');
sfx.setVolume(Number.isFinite(savedVolume) ? savedVolume : 0.7);
ui.setVolumeLabel(sfx.volume);

function openPause(): void {
  if (!ui.canPause) return;
  input.release();
  input.enabled = false;
  ui.openPause();
}

function closePause(): void {
  ui.closePause();
  input.enabled = conn !== null;
}

ui.btnPause.addEventListener('click', openPause);
ui.btnResume.addEventListener('click', closePause);
ui.btnQuit.addEventListener('click', leave);
ui.pause.addEventListener('click', (e) => {
  // Clique fora da placa fecha.
  if (e.target === ui.pause) closePause();
});
ui.volumeInput.addEventListener('input', () => {
  sfx.unlock();
  sfx.setVolume(Number(ui.volumeInput.value) / 100);
  ui.setVolumeLabel(sfx.volume);
  storage.set('caranguejada:volume', String(sfx.volume));
});
// Toque de teste ao soltar o slider, para ouvir o volume escolhido.
ui.volumeInput.addEventListener('change', () => sfx.pickup());
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (ui.isPauseOpen) closePause();
  else openPause();
});

// ---------------------------------------------------------------- jogo

const scene = new GameScene({
  store,
  input,
  sfx,
  send: (msg) => conn?.send(msg),
  onFrame: (info) => ui.frame(store, info, (final) => sfx.countdown(final)),
});

async function boot(): Promise<void> {
  // Textos do Phaser usam a fonte pixelada: espera carregar (com teto de tempo).
  await Promise.race([
    Promise.all([
      document.fonts.load('8px Silkscreen'),
      document.fonts.load('16px "Pixelify Sans"'),
    ]),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).catch(() => undefined);

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    pixelArt: true,
    backgroundColor: '#1b3f66',
    banner: false,
    audio: { noAudio: true },
    input: { keyboard: false, gamepad: false },
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [scene],
  });
  ui.showMenu();
}

void boot();
