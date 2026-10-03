import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  JOIN_MODES,
  TICK_RATE,
  isValidRoomCode,
  isValidRoundCount,
  normalizeMapPool,
  parseClientMessage,
  type ErrorCode,
  type JoinMode,
  type MapKind,
} from '@caranguejada/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadConfig } from './config';
import type { Room } from './game/Room';
import { createStaticHandler } from './http';
import { createLogger } from './logger';
import { Metrics } from './metrics';
import { RoomManager } from './RoomManager';

const config = loadConfig();
const log = createLogger(config.logLevel);
const metrics = new Metrics();
const rooms = new RoomManager(config.maxRooms, log);
const serveStatic = createStaticHandler(config.staticDir);

let shuttingDown = false;

const MAX_MESSAGES_PER_SECOND = 60;
const HEARTBEAT_MS = 15_000;

// ---------------------------------------------------------------- HTTP

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (url === '/readyz') {
    // Em shutdown o pod sai do Service antes de derrubar conexões.
    res.writeHead(shuttingDown ? 503 : 200, { 'Content-Type': 'text/plain' });
    res.end(shuttingDown ? 'draining' : 'ready');
    return;
  }
  if (url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(metrics.render(rooms.stats()));
    return;
  }
  serveStatic(req, res).catch((err: unknown) => {
    log.error('static_error', { err: String(err) });
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

// ---------------------------------------------------------------- WebSocket

const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 });

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');
  if (shuttingDown) return rejectUpgrade(socket, 503, 'Service Unavailable');

  const origin = req.headers.origin ?? '';
  if (config.allowedOrigins.length > 0 && !config.allowedOrigins.includes(origin)) {
    metrics.inc('ws_rejected_origin');
    return rejectUpgrade(socket, 403, 'Forbidden');
  }

  const code = url.searchParams.get('sala');
  const mode = url.searchParams.get('modo') as JoinMode | null;
  if (!isValidRoomCode(code) || !mode || !JOIN_MODES.includes(mode)) {
    return rejectUpgrade(socket, 400, 'Bad Request');
  }

  // Opcional: quantidade de rodadas escolhida no menu (vale para criar/solo).
  const rounds = Number(url.searchParams.get('rodadas'));
  const initialRounds = isValidRoundCount(rounds) ? rounds : undefined;
  // Opcional: mapas escolhidos no menu, separados por vírgula (ex.: mapas=porto,atol).
  const initialMaps = normalizeMapPool(url.searchParams.get('mapas')?.split(',')) ?? undefined;

  wss.handleUpgrade(req, socket, head, (ws) =>
    onConnection(ws, code, mode, initialRounds, initialMaps),
  );
});

function sendError(ws: WebSocket, code: ErrorCode, message: string): void {
  ws.send(JSON.stringify({ t: 'error', code, message }));
  ws.close(4000, code);
}

const ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  room_not_found: 'Essa sala não existe (ou já acabou). Confira o código.',
  room_exists: 'Esse código já está em uso.',
  room_full: 'A sala está cheia.',
  server_full: 'O servidor está lotado. Tente de novo em instantes.',
};

function onConnection(
  ws: WebSocket,
  code: string,
  mode: JoinMode,
  initialRounds?: number,
  initialMaps?: MapKind[],
): void {
  metrics.inc('ws_connections');

  let room: Room;
  if (mode === 'entrar') {
    const existing = rooms.get(code);
    if (!existing) return sendError(ws, 'room_not_found', ERROR_TEXT.room_not_found!);
    room = existing;
  } else {
    const created = rooms.create(code, initialRounds, initialMaps);
    if ('error' in created) return sendError(ws, created.error, ERROR_TEXT[created.error] ?? '');
    room = created;
  }

  const peer = {
    send: (data: string) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close: (closeCode: number, reason: string) => ws.close(closeCode, reason),
  };
  const joined = room.addHuman(peer, 'Siri');
  if ('error' in joined) return sendError(ws, joined.error, ERROR_TEXT[joined.error] ?? '');
  const playerId = joined.id;
  if (mode === 'solo') room.startSolo(playerId);

  // Rate limit por conexão (janela de 1s): protege o loop do jogo de flood.
  let windowStart = Date.now();
  let messagesInWindow = 0;
  let alive = true;

  ws.on('pong', () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, HEARTBEAT_MS);

  ws.on('message', (data, isBinary) => {
    if (ws.readyState !== ws.OPEN) return;
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      messagesInWindow = 0;
    }
    if (++messagesInWindow > MAX_MESSAGES_PER_SECOND) {
      metrics.inc('ws_rate_limited');
      ws.close(1008, 'rate limit');
      return;
    }
    if (isBinary) return;
    const msg = parseClientMessage(data.toString());
    if (!msg) {
      metrics.inc('ws_bad_messages');
      return;
    }
    room.handleMessage(playerId, msg);
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    room.removeMember(playerId);
  });
  ws.on('error', (err) => log.warn('ws_error', { err: err.message }));
}

// ---------------------------------------------------------------- Game loop

/** Passo fixo: a simulação roda igual não importa o jitter do setInterval. */
const STEP = 1 / TICK_RATE;
let accumulator = 0;
let last = performance.now();

const loop = setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (accumulator >= STEP) {
    const t0 = performance.now();
    rooms.tick(STEP);
    metrics.observeTick(performance.now() - t0);
    accumulator -= STEP;
  }
}, 1000 / TICK_RATE);

// ---------------------------------------------------------------- Lifecycle

server.on('error', (err) => {
  log.error('server_error', { err: err.message });
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  log.info('server_started', { port: config.port, staticDir: config.staticDir });
});

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutdown_started', { signal, ...rooms.stats() });
  // Avisa os jogadores e dá um tempo para o load balancer parar de mandar tráfego.
  setTimeout(() => {
    rooms.closeAll('Servidor reiniciando. Volte em instantes!');
    clearInterval(loop);
    wss.close();
    server.close(() => {
      log.info('shutdown_complete');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  }, config.shutdownGraceMs).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) =>
  log.error('unhandled_rejection', { reason: String(reason) }),
);
