/**
 * Every sound effect is synthesised here from oscillators, chip-style; nothing is sampled. The
 * background music lives in music.ts.
 */

export type SfxName = 'select' | 'start' | 'correct' | 'wrong' | 'timeout' | 'fanfare' | 'item';

type Wave = 'square' | 'triangle' | 'sawtooth';
interface Note {
  /** Frequency in Hz; 0 is a rest. */
  hz: number;
  /** Start offset and length in seconds. */
  at: number;
  len: number;
  wave?: Wave;
  /** Glide to this frequency over the note. */
  to?: number;
}

const SFX: Record<SfxName, Note[]> = {
  select: [{ hz: 660, at: 0, len: 0.06 }],
  start: [
    { hz: 392, at: 0, len: 0.08 },
    { hz: 523, at: 0.08, len: 0.08 },
    { hz: 784, at: 0.16, len: 0.16 },
  ],
  correct: [
    { hz: 659, at: 0, len: 0.09 },
    { hz: 988, at: 0.09, len: 0.22 },
  ],
  wrong: [
    { hz: 196, at: 0, len: 0.12, wave: 'sawtooth' },
    { hz: 147, at: 0.12, len: 0.26, wave: 'sawtooth', to: 110 },
  ],
  timeout: [
    { hz: 330, at: 0, len: 0.12, wave: 'triangle' },
    { hz: 262, at: 0.14, len: 0.12, wave: 'triangle' },
    { hz: 196, at: 0.28, len: 0.24, wave: 'triangle' },
  ],
  item: [
    { hz: 880, at: 0, len: 0.05, wave: 'triangle' },
    { hz: 1175, at: 0.05, len: 0.05, wave: 'triangle' },
    { hz: 1568, at: 0.1, len: 0.12, wave: 'triangle' },
  ],
  fanfare: [
    { hz: 523, at: 0, len: 0.1 },
    { hz: 659, at: 0.1, len: 0.1 },
    { hz: 784, at: 0.2, len: 0.1 },
    { hz: 1047, at: 0.3, len: 0.3 },
    { hz: 784, at: 0.3, len: 0.3, wave: 'triangle' },
  ],
};

export class Sfx {
  private readonly out: GainNode;
  private sfxOn = true;

  constructor(private readonly ctx: AudioContext) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.16;
    this.out.connect(ctx.destination);
  }

  configure(options: { sfx: boolean }): void {
    this.sfxOn = options.sfx;
  }

  play(name: SfxName): void {
    if (!this.sfxOn || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime + 0.01;
    for (const note of SFX[name]) this.tone(this.out, note, t0);
  }

  private tone(out: AudioNode, note: Note, t0: number, level = 1): void {
    if (note.hz <= 0) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    const start = t0 + note.at;
    const end = start + note.len;
    osc.type = note.wave ?? 'square';
    osc.frequency.setValueAtTime(note.hz, start);
    if (note.to) osc.frequency.linearRampToValueAtTime(note.to, end);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(level, start + 0.005);
    env.gain.setValueAtTime(level, Math.max(start + 0.005, end - 0.03));
    env.gain.linearRampToValueAtTime(0, end);
    osc.connect(env).connect(out);
    osc.start(start);
    osc.stop(end + 0.02);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }
}
