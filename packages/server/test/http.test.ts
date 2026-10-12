import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler, parseRange } from '../src/http';

/** 100 bytes conhecidos: o byte i vale i, então dá pra conferir o pedaço exato. */
const AUDIO = Buffer.from(Array.from({ length: 100 }, (_, i) => i));

let server: Server;
let base = '';

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'caranguejada-http-'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>ok</title>');
  writeFileSync(path.join(dir, 'musica.mp3'), AUDIO);
  server = createServer((req, res) => void createStaticHandler(dir)(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer());

describe('parseRange', () => {
  it('entende início-fim, início- e -últimos', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-5', 100)).toEqual({ start: 95, end: 99 });
    // Fim além do arquivo: corta no último byte.
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
  });

  it('pedido impossível vira 416; o que não entende manda o arquivo inteiro', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=9-3', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange('lixo', 100)).toBeNull();
  });
});

describe('servidor de arquivos: áudio', () => {
  it('serve mp3 como audio/mpeg e avisa que aceita pedaços', async () => {
    const res = await fetch(`${base}/musica.mp3`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(await bytes(res)).toEqual(AUDIO);
  });

  it('responde 206 com o pedaço exato (o Safari só toca mídia assim)', async () => {
    const res = await fetch(`${base}/musica.mp3`, { headers: { Range: 'bytes=10-19' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100');
    expect(res.headers.get('content-length')).toBe('10');
    expect(await bytes(res)).toEqual(AUDIO.subarray(10, 20));
  });

  it('pedaço aberto e "últimos N bytes" também', async () => {
    const aberto = await fetch(`${base}/musica.mp3`, { headers: { Range: 'bytes=95-' } });
    expect(aberto.status).toBe(206);
    expect(await bytes(aberto)).toEqual(AUDIO.subarray(95));
    const fim = await fetch(`${base}/musica.mp3`, { headers: { Range: 'bytes=-3' } });
    expect(fim.headers.get('content-range')).toBe('bytes 97-99/100');
    expect(await bytes(fim)).toEqual(AUDIO.subarray(97));
  });

  it('pedaço depois do fim do arquivo devolve 416', async () => {
    const res = await fetch(`${base}/musica.mp3`, { headers: { Range: 'bytes=500-' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */100');
  });
});
