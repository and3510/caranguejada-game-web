/** Logs estruturados em JSON (uma linha por evento) — prontos para Loki/ELK/CloudWatch. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel = 'info'): Logger {
  const min = LEVELS[level];
  const write = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVELS[lvl] < min) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields });
    (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
