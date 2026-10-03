import type { LogLevel } from './logger';

/** Configuração 12-factor: tudo via variáveis de ambiente, com padrões seguros. */
export interface Config {
  port: number;
  host: string;
  logLevel: LogLevel;
  staticDir: string;
  maxRooms: number;
  /** Origens permitidas no handshake do WebSocket; vazio = qualquer uma (dev). */
  allowedOrigins: string[];
  /** Tempo para esvaziar conexões no SIGTERM antes de encerrar. */
  shutdownGraceMs: number;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const logLevel = (env.LOG_LEVEL ?? 'info') as LogLevel;
  return {
    port: int(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    logLevel: ['debug', 'info', 'warn', 'error'].includes(logLevel) ? logLevel : 'info',
    staticDir: env.STATIC_DIR ?? 'public',
    maxRooms: int(env.MAX_ROOMS, 500),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    shutdownGraceMs: int(env.SHUTDOWN_GRACE_MS, 5000),
  };
}
