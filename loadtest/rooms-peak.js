// Teste de pico: simula N salas cheias (8 jogadores cada) conectando via WebSocket,
// jogando uma partida completa (todas as rodadas, até matchEnd), sem rodar o jogo real
// no navegador. Segue o protocolo em packages/shared/src/protocol.ts,
// packages/shared/src/roomCode.ts e o fluxo de fases em packages/server/src/game/Room.ts.
//
// O ritmo da partida é ditado pelo próprio servidor (mensagens 'round' -> aguarda o
// countdown -> manda input durante a fase 'playing' -> pausa no 'roundEnd' -> repete até
// 'matchEnd'), igual a um cliente real faria. Cada rodada tem um teto rígido de
// ROUND_HARD_LIMIT_SECONDS=120s no servidor (packages/shared/src/constants.ts), então a
// partida sempre termina mesmo com inputs aleatórios.
//
// Instalar o k6 (Ubuntu/Debian):
//   sudo gpg -k
//   sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
//   echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
//   sudo apt-get update && sudo apt-get install k6
//
// Rodar (depois de subir o servidor com `docker compose -f docker/docker-compose.yml up --build`):
//   k6 run -e ROOMS=700 -e WS_URL=ws://localhost:3000/ws loadtest/rooms-peak.js
//
// Variáveis de ambiente (todas opcionais, valores abaixo são o padrão):
//   ROOMS=700            quantidade de salas a criar
//   PLAYERS_PER_ROOM=8   jogadores por sala (máximo do jogo é 8)
//   WS_URL=ws://localhost:3000/ws
//   RAMP_UP_S=90         janela em que as salas vão sendo criadas (evita todas abrirem no mesmo instante)
//   ROUNDS=3             rodadas por partida (padrão do jogo é 3; pedido na criação da sala)
//   INPUT_INTERVAL_MS=150
//   MAX_MATCH_S=420       teto de segurança: fecha a conexão se a partida não acabar nesse tempo
//                          (3 rodadas * (120s de jogo + ~8s de countdown/pausa) ≈ 384s + folga)

import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const ROOM_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const ROOM_CODE_LENGTH = 4;

const ROOMS = Number(__ENV.ROOMS || 700);
const PLAYERS_PER_ROOM = Math.min(8, Number(__ENV.PLAYERS_PER_ROOM || 8));
const WS_URL = __ENV.WS_URL || 'ws://localhost:3000/ws';
const RAMP_UP_S = Number(__ENV.RAMP_UP_S || 90);
const ROUNDS = Number(__ENV.ROUNDS || 3);
const INPUT_INTERVAL_MS = Number(__ENV.INPUT_INTERVAL_MS || 150);
const MAX_MATCH_S = Number(__ENV.MAX_MATCH_S || 420);
const INTRA_ROOM_STAGGER_S = 0.2;
const ROOM_FILL_BUFFER_S = 3;

const TOTAL_VUS = ROOMS * PLAYERS_PER_ROOM;

export const options = {
  scenarios: {
    rooms: {
      executor: 'per-vu-iterations',
      vus: TOTAL_VUS,
      iterations: 1,
      maxDuration: `${RAMP_UP_S + ROOM_FILL_BUFFER_S + MAX_MATCH_S + 60}s`,
    },
  },
};

const connectErrors = new Counter('connect_errors');
const roomErrors = new Counter('room_errors');
const welcomeOk = new Rate('welcome_ok');
const connectTime = new Trend('connect_time_ms');
const snapshotsReceived = new Counter('snapshots_received');
const inputsSent = new Counter('inputs_sent');
const roundsPlayed = new Counter('rounds_played');
const matchesCompleted = new Counter('matches_completed');
const matchTimedOut = new Counter('match_timed_out');

function roomCodeFromIndex(i) {
  let code = '';
  let n = i;
  for (let k = 0; k < ROOM_CODE_LENGTH; k++) {
    code = ROOM_CODE_ALPHABET[n % ROOM_CODE_ALPHABET.length] + code;
    n = Math.floor(n / ROOM_CODE_ALPHABET.length);
  }
  return code;
}

export default function () {
  const vu0 = __VU - 1; // __VU é 1-indexado
  const roomIndex = Math.floor(vu0 / PLAYERS_PER_ROOM);
  const playerIndex = vu0 % PLAYERS_PER_ROOM;
  const isHost = playerIndex === 0;
  const code = roomCodeFromIndex(roomIndex);

  // Espalha a criação das salas ao longo de RAMP_UP_S e garante que o host
  // conecta antes dos demais jogadores da mesma sala.
  const roomDelay = (roomIndex / ROOMS) * RAMP_UP_S;
  const myDelay = roomDelay + playerIndex * INTRA_ROOM_STAGGER_S;
  sleep(myDelay);

  const mode = isHost ? 'criar' : 'entrar';
  const url = isHost
    ? `${WS_URL}?sala=${code}&modo=${mode}&rodadas=${ROUNDS}`
    : `${WS_URL}?sala=${code}&modo=${mode}`;
  const name = `Bot${vu0}`;

  const startedAt = Date.now();
  const res = ws.connect(url, {}, (socket) => {
    connectTime.add(Date.now() - startedAt);

    let seq = 0;
    let playing = false;
    let finished = false;

    socket.on('open', () => {
      socket.send(JSON.stringify({ t: 'hello', name }));

      if (isHost) {
        // Dá tempo dos outros PLAYERS_PER_ROOM-1 jogadores da sala entrarem antes de começar.
        socket.setTimeout(() => {
          socket.send(JSON.stringify({ t: 'start' }));
        }, (ROOM_FILL_BUFFER_S + (PLAYERS_PER_ROOM - 1) * INTRA_ROOM_STAGGER_S) * 1000);
      }
    });

    // Manda input continuamente enquanto `playing` estiver ligado; a própria
    // sala no servidor ignora inputs fora da fase 'playing' (Room.ts:143-144),
    // então o filtro aqui só evita tráfego inútil, a flag no servidor é quem manda.
    socket.setInterval(() => {
      if (!playing) return;
      socket.send(
        JSON.stringify({
          t: 'input',
          seq: seq++,
          dx: Math.random() * 2 - 1,
          dy: Math.random() * 2 - 1,
          dash: Math.random() < 0.05,
        }),
      );
      inputsSent.add(1);
    }, INPUT_INTERVAL_MS);

    socket.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      if (msg.t === 'welcome') {
        welcomeOk.add(true);
      } else if (msg.t === 'error') {
        roomErrors.add(1, { code: msg.code });
      } else if (msg.t === 'snap') {
        snapshotsReceived.add(1);
      } else if (msg.t === 'round') {
        // Countdown começou; a física só roda (e aceita input) depois de `countdown` segundos.
        // Jogador que entra depois do countdown já ido recebe countdown=0 (Room.ts:112-121):
        // a rodada já está em andamento, pode mandar input na hora. Limiar de 10ms em vez de
        // só ">0": o servidor manda o phaseTimer no instante exato em que o jogador entrou,
        // podendo ser um resto de poucos milissegundos que o k6 trunca pra 0 e rejeita.
        roundsPlayed.add(1);
        if (msg.countdown >= 0.01) {
          playing = false;
          socket.setTimeout(() => {
            playing = true;
          }, msg.countdown * 1000);
        } else {
          playing = true;
        }
      } else if (msg.t === 'roundEnd') {
        // Pausa entre rodadas; o servidor inicia a próxima sozinho (ou manda matchEnd).
        playing = false;
      } else if (msg.t === 'matchEnd') {
        playing = false;
        finished = true;
        matchesCompleted.add(1);
        socket.close();
      }
    });

    socket.on('error', () => connectErrors.add(1));

    // Rede de segurança: se a partida não terminar sozinha (matchEnd) dentro do teto,
    // força o fechamento pra não deixar o VU pendurado até o maxDuration do cenário.
    socket.setTimeout(() => {
      if (finished) return;
      matchTimedOut.add(1);
      socket.close();
    }, MAX_MATCH_S * 1000);
  });

  check(res, { 'conexão WS estabelecida (status 101)': (r) => r && r.status === 101 });
  if (!res || res.status !== 101) connectErrors.add(1);
}
