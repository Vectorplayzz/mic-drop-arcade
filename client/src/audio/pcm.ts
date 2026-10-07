/**
 * PCM plumbing shared by the mic worklet and the voice player. Everything here is streaming:
 * feeding the audio in one piece or in many small blocks gives the same samples, so block
 * boundaries never click.
 */

export const MIC_SAMPLE_RATE = 16000;
/** 20 ms at 16 kHz: 320 samples, 640 bytes (PROTOCOL §4). */
export const MIC_FRAME_SAMPLES = 320;
export const VOICE_SAMPLE_RATE = 24000;

/** Windowed-sinc low-pass, unity gain at DC. `cutoff` is a fraction of the sample rate. */
export function lowPassTaps(count: number, cutoff: number): Float32Array {
  const taps = new Float32Array(count);
  const mid = (count - 1) / 2;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (count - 1));
    taps[i] = sinc * hann;
    sum += taps[i]!;
  }
  for (let i = 0; i < count; i++) taps[i] = taps[i]! / sum;
  return taps;
}

/**
 * Device rate (usually 48 kHz) → 16 kHz. Low-passes below the new Nyquist first, so speech
 * sibilants don't alias into the band Prisma listens to, then picks samples at the new rate.
 */
export class Downsampler {
  private readonly taps: Float32Array;
  private readonly step: number;
  private tail: Float32Array<ArrayBufferLike> = new Float32Array(0);
  /** Position of the next output sample, in input samples from the start of `tail`. */
  private pos = 0;

  constructor(
    readonly inRate: number,
    readonly outRate: number = MIC_SAMPLE_RATE,
    tapCount = 64,
  ) {
    if (!(inRate > 0) || !(outRate > 0)) throw new RangeError('sample rates must be positive');
    this.step = inRate / outRate;
    // Pass speech up to ~6.8 kHz; by the 8 kHz Nyquist the filter is well into its stopband.
    const cutoff = Math.min(0.425 * outRate, 0.45 * inRate) / inRate;
    this.taps = this.step > 1 ? lowPassTaps(tapCount, cutoff) : new Float32Array([1]);
  }

  process(input: Float32Array): Float32Array {
    const { taps, step } = this;
    const data = new Float32Array(this.tail.length + input.length);
    data.set(this.tail);
    data.set(input, this.tail.length);
    // filtered[i] = Σ taps[k]·data[i+k] exists for i < available.
    const available = data.length - taps.length + 1;
    const out = new Float32Array(Math.max(0, Math.ceil((available - this.pos) / step) + 1));
    let n = 0;
    let pos = this.pos;
    for (;;) {
      const i = Math.floor(pos);
      const frac = pos - i;
      if (i >= available || (frac > 1e-9 && i + 1 >= available)) break;
      let a = 0;
      for (let k = 0; k < taps.length; k++) a += taps[k]! * data[i + k]!;
      if (frac > 1e-9) {
        let b = 0;
        for (let k = 0; k < taps.length; k++) b += taps[k]! * data[i + 1 + k]!;
        a += (b - a) * frac;
      }
      out[n++] = a;
      pos += step;
    }
    const keepFrom = Math.max(0, Math.min(Math.floor(pos), data.length));
    this.tail = data.subarray(keepFrom);
    this.pos = pos - keepFrom;
    return out.subarray(0, n);
  }

  reset(): void {
    this.tail = new Float32Array(0);
    this.pos = 0;
  }
}

/** Linear-interpolating resampler for playback (24 kHz voice → the device's output rate). */
export class LinearResampler {
  private readonly step: number;
  /** Next output position in input samples; -1 is the last sample of the previous block. */
  private pos = 0;
  private last = 0;

  constructor(inRate: number, outRate: number) {
    if (!(inRate > 0) || !(outRate > 0)) throw new RangeError('sample rates must be positive');
    this.step = inRate / outRate;
  }

  process(input: Float32Array): Float32Array {
    const n = input.length;
    if (n === 0) return new Float32Array(0);
    const out = new Float32Array(Math.max(0, Math.ceil((n - 1 - this.pos) / this.step) + 1));
    let count = 0;
    let pos = this.pos;
    while (pos <= n - 1) {
      const i = Math.floor(pos);
      const a = i < 0 ? this.last : input[i]!;
      const b = i + 1 < n ? input[i + 1]! : a;
      out[count++] = a + (b - a) * (pos - i);
      pos += this.step;
    }
    this.pos = pos - n;
    this.last = input[n - 1]!;
    return out.subarray(0, count);
  }

  reset(): void {
    this.pos = 0;
    this.last = 0;
  }
}

/** Bytes of PCM s16le → floats in [-1, 1). A sample split across two chunks is carried over. */
export class Pcm16Decoder {
  private carry: number | null = null;

  push(bytes: Uint8Array): Float32Array {
    const total = bytes.length + (this.carry === null ? 0 : 1);
    const out = new Float32Array(total >> 1);
    let i = 0;
    let n = 0;
    if (this.carry !== null && bytes.length > 0) {
      out[n++] = toSigned(this.carry | (bytes[0]! << 8)) / 32768;
      this.carry = null;
      i = 1;
    }
    for (; i + 1 < bytes.length; i += 2) {
      out[n++] = toSigned(bytes[i]! | (bytes[i + 1]! << 8)) / 32768;
    }
    if (i < bytes.length) this.carry = bytes[i]!;
    return out.subarray(0, n);
  }

  reset(): void {
    this.carry = null;
  }
}

function toSigned(u16: number): number {
  return u16 >= 0x8000 ? u16 - 0x10000 : u16;
}

export function floatToInt16(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample));
  return Math.round(s < 0 ? s * 32768 : s * 32767);
}

/** Collects float samples into fixed-size PCM16 LE frames, one ArrayBuffer per frame. */
export class FrameChunker {
  private frame: DataView;
  private filled = 0;

  constructor(readonly frameSamples: number = MIC_FRAME_SAMPLES) {
    this.frame = new DataView(new ArrayBuffer(frameSamples * 2));
  }

  push(samples: Float32Array): ArrayBuffer[] {
    const frames: ArrayBuffer[] = [];
    for (let i = 0; i < samples.length; i++) {
      this.frame.setInt16(this.filled * 2, floatToInt16(samples[i]!), true);
      if (++this.filled === this.frameSamples) {
        frames.push(this.frame.buffer as ArrayBuffer);
        this.frame = new DataView(new ArrayBuffer(this.frameSamples * 2));
        this.filled = 0;
      }
    }
    return frames;
  }

  /** Drops a partly filled frame, so a new listening window never starts with stale audio. */
  reset(): void {
    this.filled = 0;
  }
}

/** Loudness of a PCM16 LE frame as 0..1, for the on-screen mic meter. */
export function frameLevel(frame: ArrayBuffer): number {
  const view = new DataView(frame);
  const n = view.byteLength >> 1;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(i * 2, true) / 32768;
    sum += s * s;
  }
  const db = 10 * Math.log10(sum / n + 1e-10);
  return Math.max(0, Math.min(1, (db + 60) / 50));
}
