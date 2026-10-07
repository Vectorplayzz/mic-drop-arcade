import { type AudioFrame, UtteranceGate } from '../protocol/frames';
import { LinearResampler, Pcm16Decoder, VOICE_SAMPLE_RATE } from './pcm';

/** Lead time before the first chunk of a line, so the next chunk has time to arrive. */
const START_DELAY_S = 0.06;

/**
 * Plays the server's question and feedback audio (PROTOCOL §5). Chunks of the current utterance
 * are scheduled back to back on one AudioContext; anything older is dropped, and a `speak_start`
 * or `barge_in` silences what is already queued.
 */
export class VoicePlayer {
  private readonly gate = new UtteranceGate();
  private readonly gain: GainNode;
  private readonly decoder = new Pcm16Decoder();
  private resampler: LinearResampler;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  /** The server has sent everything for the current utterance. */
  private complete = false;
  private waiters: Array<{ utterance: number; done: () => void }> = [];

  constructor(
    private readonly ctx: AudioContext,
    volume: number,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(ctx.destination);
    this.resampler = new LinearResampler(VOICE_SAMPLE_RATE, ctx.sampleRate);
  }

  setVolume(volume: number): void {
    this.gain.gain.value = volume;
  }

  speakStart(utterance: number, sampleRate: number): void {
    this.silence();
    this.gate.start(utterance);
    this.resampler = new LinearResampler(sampleRate, this.ctx.sampleRate);
    this.decoder.reset();
    this.complete = false;
    this.nextTime = 0;
  }

  push(frame: AudioFrame): void {
    if (!this.gate.accepts(frame.utterance)) return;
    const samples = this.resampler.process(this.decoder.push(frame.pcm));
    if (samples.length > 0) {
      const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);
      const at = Math.max(this.nextTime, this.ctx.currentTime + START_DELAY_S);
      source.start(at);
      this.nextTime = at + buffer.duration;
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        this.settleIfDrained(frame.utterance);
      };
    }
    if (frame.last) this.speakEnd(frame.utterance);
  }

  speakEnd(utterance: number): void {
    if (!this.gate.accepts(utterance)) return;
    this.complete = true;
    this.settleIfDrained(utterance);
  }

  bargeIn(utterance: number): void {
    if (this.gate.cancel(utterance)) this.silence();
  }

  stopAll(): void {
    this.gate.reset();
    this.silence();
  }

  /**
   * Calls `done` once `utterance` can no longer be heard: it finished playing, was interrupted
   * or superseded, or was never the current one.
   */
  afterUtterance(utterance: number, done: () => void): void {
    if (!this.gate.accepts(utterance) || (this.complete && this.sources.size === 0)) {
      done();
      return;
    }
    this.waiters.push({ utterance, done });
  }

  private settleIfDrained(utterance: number): void {
    if (this.gate.accepts(utterance) && this.complete && this.sources.size === 0) {
      this.settle();
    }
  }

  private silence(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
    }
    this.sources.clear();
    this.settle();
  }

  private settle(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter.done();
  }
}
