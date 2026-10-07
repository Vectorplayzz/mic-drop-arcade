/**
 * AudioWorklet: device-rate mic audio → 16 kHz mono PCM16 LE in 20 ms frames (PROTOCOL §4).
 * Runs on the audio thread and posts each finished frame to the page, which decides whether
 * the server is listening.
 */
import { Downsampler, FrameChunker, MIC_FRAME_SAMPLES, MIC_SAMPLE_RATE } from './pcm';

// The AudioWorkletGlobalScope isn't in TypeScript's DOM library.
declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly downsampler = new Downsampler(sampleRate, MIC_SAMPLE_RATE);
  private readonly chunker = new FrameChunker(MIC_FRAME_SAMPLES);
  private streaming = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ streaming: boolean }>) => {
      this.streaming = event.data.streaming === true;
      if (this.streaming) {
        this.downsampler.reset();
        this.chunker.reset();
      }
    };
  }

  override process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!this.streaming || !channel) return true;
    for (const frame of this.chunker.push(this.downsampler.process(channel))) {
      this.port.postMessage(frame, [frame]);
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
