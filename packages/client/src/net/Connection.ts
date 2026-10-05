import type {
  ClientMessage,
  ErrorCode,
  JoinMode,
  MapKind,
  ServerMessage,
} from '@caranguejada/shared';

type Handlers = {
  [K in ServerMessage['t']]?: (msg: Extract<ServerMessage, { t: K }>) => void;
};

export interface CloseInfo {
  /** Erro de aplicação enviado pelo servidor antes de fechar, se houver. */
  error: { code: ErrorCode; message: string } | null;
  wasOpen: boolean;
}

/**
 * O que a partida precisa da conexão. Duas implementações falam o mesmo protocolo:
 * `Connection` (WebSocket, multijogador) e `LocalConnection` (servidor na própria aba, solo).
 */
export interface GameConnection {
  on<K extends ServerMessage['t']>(
    type: K,
    fn: (msg: Extract<ServerMessage, { t: K }>) => void,
  ): this;
  send(msg: ClientMessage): void;
  close(): void;
  onClose: (info: CloseInfo) => void;
}

/** WebSocket tipado: o cliente só fala o protocolo definido em @caranguejada/shared. */
export class Connection implements GameConnection {
  private readonly ws: WebSocket;
  private readonly handlers: Handlers = {};
  private lastError: CloseInfo['error'] = null;
  private opened = false;
  onClose: (info: CloseInfo) => void = () => {};

  constructor(
    code: string,
    mode: JoinMode,
    name: string,
    /** Configuração da sala nova (ignorada ao entrar numa sala existente). */
    setup: { rounds?: number; maps?: readonly MapKind[] } = {},
  ) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({ sala: code, modo: mode });
    if (setup.rounds !== undefined) params.set('rodadas', String(setup.rounds));
    if (setup.maps && setup.maps.length > 0) params.set('mapas', setup.maps.join(','));
    const url = `${proto}//${location.host}/ws?${params}`;
    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => {
      this.opened = true;
      this.send({ t: 'hello', name });
    });
    this.ws.addEventListener('message', (ev) => this.dispatch(ev.data));
    this.ws.addEventListener('close', (ev) =>
      // O servidor fecha com o código do erro como "reason"; erros não fatais são ignorados.
      this.onClose({
        error: this.lastError?.code === ev.reason ? this.lastError : null,
        wasOpen: this.opened,
      }),
    );
  }

  on<K extends ServerMessage['t']>(type: K, fn: (msg: Extract<ServerMessage, { t: K }>) => void) {
    (this.handlers as Record<string, unknown>)[type] = fn;
    return this;
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.onClose = () => {};
    this.ws.close(1000, 'bye');
  }

  private dispatch(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    if (msg.t === 'error') this.lastError = { code: msg.code, message: msg.message };
    const fn = this.handlers[msg.t] as ((m: ServerMessage) => void) | undefined;
    fn?.(msg);
  }
}
