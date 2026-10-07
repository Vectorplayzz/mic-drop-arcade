import workletUrl from './mic-worklet.ts?worker&url';
import { frameLevel } from './pcm';

/** Echo cancellation matters most: barge-in keeps the mic open while the question plays. */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

export type MicFailure = 'denied' | 'missing' | 'busy' | 'unsupported';

export class MicError extends Error {
  constructor(readonly reason: MicFailure) {
    super(`microphone ${reason}`);
  }
}

export function micSupported(): boolean {
  return (
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof AudioWorkletNode === 'function'
  );
}

/**
 * Owns the mic stream and the capture worklet. Frames reach `onFrame` only while streaming is
 * on, which the game switches between `listen` and `result`.
 */
export class MicCapture {
  onFrame: (frame: ArrayBuffer) => void = () => {};
  onLevel: (level: number) => void = () => {};
  /** The OS or browser took the mic away mid-game (unplugged, permission revoked). */
  onLost: () => void = () => {};

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private streaming = false;
  private moduleLoaded = false;

  constructor(private readonly ctx: AudioContext) {}

  get isOpen(): boolean {
    return this.stream !== null;
  }

  async open(): Promise<void> {
    if (this.stream) return;
    if (!micSupported()) throw new MicError('unsupported');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS, video: false });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('denied');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicError('missing');
      throw new MicError('busy');
    }
    try {
      if (!this.moduleLoaded) {
        await this.ctx.audioWorklet.addModule(workletUrl);
        this.moduleLoaded = true;
      }
      const node = new AudioWorkletNode(this.ctx, 'pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!this.streaming) return;
        this.onLevel(frameLevel(event.data));
        this.onFrame(event.data);
      };
      // A silent path to the output keeps the worklet pulled on every browser.
      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      const source = this.ctx.createMediaStreamSource(stream);
      source.connect(node).connect(sink).connect(this.ctx.destination);
      for (const track of stream.getAudioTracks()) {
        track.addEventListener('ended', () => {
          if (this.stream === stream) {
            this.close();
            this.onLost();
          }
        });
      }
      this.stream = stream;
      this.source = source;
      this.node = node;
      this.sink = sink;
    } catch {
      for (const track of stream.getTracks()) track.stop();
      throw new MicError('unsupported');
    }
  }

  setStreaming(on: boolean): void {
    if (this.streaming === on) return;
    this.streaming = on;
    this.node?.port.postMessage({ streaming: on });
    if (!on) this.onLevel(0);
  }

  /** Releases the microphone, so the browser's recording indicator goes off. */
  close(): void {
    this.setStreaming(false);
    this.source?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.source = null;
    this.node = null;
    this.sink = null;
  }
}
