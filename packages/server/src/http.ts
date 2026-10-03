import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/**
 * Serve o build do cliente (SPA). Arquivos com hash em /assets recebem cache longo;
 * o index.html nunca é cacheado, para que um deploy novo chegue na hora.
 */
export function createStaticHandler(rootDir: string) {
  const root = path.resolve(rootDir);

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }

    // path.resolve + checagem de prefixo impede path traversal (../../etc/passwd).
    let filePath = path.resolve(root, '.' + pathname);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }

    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info || !info.isFile()) {
      // Fallback de SPA: rotas desconhecidas sem extensão caem no index.
      if (path.extname(pathname) !== '') {
        res.writeHead(404, SECURITY_HEADERS).end('Não encontrado');
        return;
      }
      filePath = path.join(root, 'index.html');
      info = await stat(filePath).catch(() => null);
      if (!info) {
        res.writeHead(404, SECURITY_HEADERS).end('Cliente não compilado (rode npm run build).');
        return;
      }
    }

    const ext = path.extname(filePath);
    const immutable = pathname.startsWith('/assets/');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  };
}
