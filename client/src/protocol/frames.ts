/** Server → client audio frames (PROTOCOL §5): 4-byte header, then PCM s16le mono 24 kHz. */

export const AUDIO_FRAME_MAGIC = 0x41;
export const AUDIO_HEADER_BYTES = 4;
const FLAG_LAST = 0x01;

export interface AudioFrame {
  utterance: number;
  /** Set on the final chunk of a cached clip; live clips end with `speak_end` instead. */
  last: boolean;
  pcm: Uint8Array;
}

export function parseAudioFrame(data: ArrayBuffer): AudioFrame | null {
  if (data.byteLength < AUDIO_HEADER_BYTES) return null;
  const view = new DataView(data);
  if (view.getUint8(0) !== AUDIO_FRAME_MAGIC) return null;
  return {
    utterance: view.getUint16(1, false),
    last: (view.getUint8(3) & FLAG_LAST) !== 0,
    pcm: new Uint8Array(data, AUDIO_HEADER_BYTES),
  };
}

/**
 * Which utterance may be heard right now. A new `speak_start` supersedes everything older, and
 * a `barge_in` silences its utterance for good, so late chunks from either are dropped.
 */
export class UtteranceGate {
  private current: number | null = null;

  start(utterance: number): void {
    this.current = utterance;
  }

  /** Returns true when this silenced the utterance that was playing. */
  cancel(utterance: number): boolean {
    if (this.current !== utterance) return false;
    this.current = null;
    return true;
  }

  reset(): void {
    this.current = null;
  }

  accepts(utterance: number): boolean {
    return this.current === utterance;
  }

  get active(): number | null {
    return this.current;
  }
}
