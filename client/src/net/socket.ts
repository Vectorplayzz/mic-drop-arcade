import { type AudioFrame, parseAudioFrame } from '../protocol/frames';
import { PROTOCOL, parseServerMessage, type ServerMessage } from '../protocol/messages';

/** Mic frames queue in the socket while the network stalls; past this we drop, not buffer. */
const MAX_BUFFERED_BYTES = 64_000;

export interface SocketHandlers {
  onMessage(message: ServerMessage): void;
  onAudio(frame: AudioFrame): void;
  /** `code` is the WebSocket close code: 4xxx from PROTOCOL §3, 1006 for a dropped network. */
  onClose(code: number): void;
}

/** The game socket (PROTOCOL §2): same origin, `maata.v1`, `auth` first. */
export class GameSocket {
  private ws: WebSocket | null = null;

  constructor(private readonly handlers: SocketHandlers) {}

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(token: string): void {
    this.close();
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/ws/play`, [PROTOCOL]);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (this.ws !== ws) return;
      if (typeof event.data === 'string') {
        const message = parseServerMessage(event.data);
        if (message) this.handlers.onMessage(message);
      } else {
        const frame = parseAudioFrame(event.data);
        if (frame) this.handlers.onAudio(frame);
      }
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.handlers.onClose(event.code);
    };
  }

  startGame(packId: string, hero: string, wizard: string): void {
    this.send({ type: 'start', pack_id: packId, character: hero, wizard });
  }

  sendAudio(frame: ArrayBuffer): void {
    const ws = this.ws;
    if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED_BYTES) {
      ws.send(frame);
    }
  }

  /** Leave on purpose: no `onClose` callback follows. */
  close(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onopen = ws.onmessage = ws.onclose = null;
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'quit' }));
      } catch {
        // closing anyway
      }
    }
    ws.close(1000);
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }
}
