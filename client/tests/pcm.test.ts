import { describe, expect, it } from 'vitest';
import {
  Downsampler,
  floatToInt16,
  FrameChunker,
  frameLevel,
  LinearResampler,
  MIC_FRAME_SAMPLES,
  Pcm16Decoder,
} from '../src/audio/pcm';

function sine(hz: number, rate: number, seconds: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

function rms(samples: Float32Array, skip = 0): number {
  let sum = 0;
  for (let i = skip; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (samples.length - skip));
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Feeds `input` in worklet-sized blocks of 128 samples. */
function inBlocks(input: Float32Array, process: (block: Float32Array) => Float32Array) {
  const parts: Float32Array[] = [];
  for (let at = 0; at < input.length; at += 128) parts.push(process(input.subarray(at, at + 128)));
  return concat(parts);
}

describe('Downsampler', () => {
  it.each([48000, 44100, 32000, 96000])('turns %d Hz into 16 kHz', (rate) => {
    const down = new Downsampler(rate, 16000);
    const out = inBlocks(sine(440, rate, 1), (b) => down.process(b));
    // One second in gives one second out, less the filter's start-up delay.
    expect(out.length).toBeGreaterThan(16000 - 40);
    expect(out.length).toBeLessThanOrEqual(16000);
  });

  it('keeps speech-band tones at full level', () => {
    for (const hz of [200, 1000, 3000]) {
      const down = new Downsampler(48000, 16000);
      const out = down.process(sine(hz, 48000, 0.5));
      expect(rms(out, 200) / (0.5 / Math.SQRT2), `${hz} Hz`).toBeCloseTo(1, 1);
    }
  });

  it('removes tones above the new Nyquist instead of aliasing them', () => {
    for (const hz of [10000, 12000, 15000, 20000]) {
      const down = new Downsampler(48000, 16000);
      const out = down.process(sine(hz, 48000, 0.5));
      const attenuationDb = 20 * Math.log10(rms(out, 200) / (0.5 / Math.SQRT2));
      expect(attenuationDb, `${hz} Hz`).toBeLessThan(-40);
    }
  });

  it('gives the same samples whether fed whole or in 128-sample blocks', () => {
    const input = sine(700, 44100, 0.25);
    const whole = new Downsampler(44100, 16000).process(input);
    const blocks = new Downsampler(44100, 16000);
    const pieced = inBlocks(input, (b) => blocks.process(b));
    expect(pieced.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(pieced[i]).toBeCloseTo(whole[i]!, 6);
  });

  it('passes 16 kHz input straight through', () => {
    const input = sine(300, 16000, 0.05);
    expect([...new Downsampler(16000, 16000).process(input)]).toEqual([...input]);
  });

  it('starts clean after reset', () => {
    const down = new Downsampler(48000, 16000);
    const first = down.process(sine(500, 48000, 0.1));
    down.process(sine(900, 48000, 0.033));
    down.reset();
    expect([...down.process(sine(500, 48000, 0.1))]).toEqual([...first]);
  });
});

describe('FrameChunker', () => {
  it('emits 20 ms frames of exactly 640 bytes, little-endian', () => {
    const chunker = new FrameChunker();
    const frames = chunker.push(new Float32Array(MIC_FRAME_SAMPLES * 2 + 100).fill(0.5));
    expect(frames).toHaveLength(2);
    expect(frames.every((f) => f.byteLength === 640)).toBe(true);
    const bytes = new Uint8Array(frames[0]!);
    expect(bytes[0]! | (bytes[1]! << 8)).toBe(floatToInt16(0.5));
    // The 100 left-over samples complete the next frame once 220 more arrive.
    expect(chunker.push(new Float32Array(219))).toHaveLength(0);
    expect(chunker.push(new Float32Array(1))).toHaveLength(1);
  });

  it('hands out a fresh buffer per frame, safe to transfer', () => {
    const [a, b] = new FrameChunker(4).push(new Float32Array(8));
    expect(a).not.toBe(b);
  });

  it('drops a partial frame on reset', () => {
    const chunker = new FrameChunker(4);
    chunker.push(new Float32Array([1, 1, 1]));
    chunker.reset();
    const [frame] = chunker.push(new Float32Array(4));
    expect([...new Int16Array(frame!)]).toEqual([0, 0, 0, 0]);
  });

  it('clips out-of-range samples instead of wrapping', () => {
    expect(floatToInt16(2)).toBe(32767);
    expect(floatToInt16(-2)).toBe(-32768);
    expect(floatToInt16(0)).toBe(0);
    expect(floatToInt16(Number.NaN)).toBeNaN();
  });
});

describe('Pcm16Decoder', () => {
  it('decodes signed little-endian samples', () => {
    const out = new Pcm16Decoder().push(new Uint8Array([0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f]));
    expect([...out]).toEqual([0.5, -0.5, 32767 / 32768]);
  });

  it('carries a sample split across two chunks', () => {
    const decoder = new Pcm16Decoder();
    expect(decoder.push(new Uint8Array([0x00, 0x40, 0x00])).length).toBe(1);
    expect([...decoder.push(new Uint8Array([0xc0, 0x00, 0x40]))]).toEqual([-0.5, 0.5]);
  });

  it('forgets a dangling byte when a new utterance starts', () => {
    const decoder = new Pcm16Decoder();
    decoder.push(new Uint8Array([0x12]));
    decoder.reset();
    expect([...decoder.push(new Uint8Array([0x00, 0x40]))]).toEqual([0.5]);
  });
});

describe('LinearResampler', () => {
  it('doubles 24 kHz to 48 kHz with interpolated samples in between', () => {
    const out = new LinearResampler(24000, 48000).process(new Float32Array([0, 1, 0]));
    expect([...out]).toEqual([0, 0.5, 1, 0.5, 0]);
  });

  it('is continuous across chunk boundaries', () => {
    const input = sine(440, 24000, 0.1);
    const whole = new LinearResampler(24000, 44100).process(input);
    const streaming = new LinearResampler(24000, 44100);
    const pieced = concat([
      streaming.process(input.subarray(0, 777)),
      streaming.process(input.subarray(777, 778)),
      streaming.process(input.subarray(778)),
    ]);
    expect(Math.abs(pieced.length - whole.length)).toBeLessThanOrEqual(1);
    for (let i = 0; i < Math.min(pieced.length, whole.length); i++) {
      expect(pieced[i]).toBeCloseTo(whole[i]!, 5);
    }
  });

  it('keeps the duration when the rates match or differ', () => {
    const input = sine(300, 24000, 0.5);
    expect(new LinearResampler(24000, 24000).process(input).length).toBe(input.length);
    const up = new LinearResampler(24000, 48000).process(input).length;
    expect(Math.abs(up - input.length * 2)).toBeLessThanOrEqual(2);
  });
});

describe('frameLevel', () => {
  it('reads silence as 0 and loud speech near 1', () => {
    const silent = new ArrayBuffer(640);
    expect(frameLevel(silent)).toBe(0);
    const loud = new FrameChunker().push(sine(300, 16000, 0.02, 0.8))[0]!;
    expect(frameLevel(loud)).toBeGreaterThan(0.8);
    expect(frameLevel(new ArrayBuffer(0))).toBe(0);
  });
});
