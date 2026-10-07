/**
 * Every sound effect and the title tune are synthesised here from oscillators, chip-style.
 * Nothing is sampled or downloaded, so there are no audio assets to license (see ASSETS.md).
 */

export type SfxName = 'select' | 'start' | 'correct' | 'wrong' | 'timeout' | 'fanfare';

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
  fanfare: [
    { hz: 523, at: 0, len: 0.1 },
    { hz: 659, at: 0.1, len: 0.1 },
    { hz: 784, at: 0.2, len: 0.1 },
    { hz: 1047, at: 0.3, len: 0.3 },
    { hz: 784, at: 0.3, len: 0.3, wave: 'triangle' },
  ],
};

// The title loop: an original eight-bar tune in A minor (Am, F, C, G, twice), as semitones
// from A3. Lead and bass are written out per eighth note; -1 is a rest.
const STEP_S = 0.2;
const LEAD = [
  12, -1, 15, 19, 24, 19, 15, 19, 8, -1, 12, 15, 20, 15, 12, 15, 15, -1, 19, 22, 27, 22, 19, 22,
  14, -1, 17, 22, 26, 22, 19, 17, 12, 15, 19, 24, 27, 24, 19, 15, 8, 12, 15, 20, 24, 20, 15, 12,
  15, 19, 22, 27, 31, 27, 22, 19, 14, 17, 22, 26, 29, 26, 22, -1,
];
const BASS = [0, -4, 3, -2, 0, -4, 3, -2];
const LOOKAHEAD_S = 0.3;

const semitone = (n: number): number => 220 * 2 ** (n / 12);

export class Sfx {
  private readonly out: GainNode;
  private readonly musicOut: GainNode;
  private sfxOn = true;
  private musicOn = true;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicNextAt = 0;

  constructor(private readonly ctx: AudioContext) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.16;
    this.out.connect(ctx.destination);
    this.musicOut = ctx.createGain();
    this.musicOut.gain.value = 0.07;
    this.musicOut.connect(ctx.destination);
  }

  configure(options: { sfx: boolean; music: boolean }): void {
    this.sfxOn = options.sfx;
    this.musicOn = options.music;
    if (!this.musicOn) this.stopMusic();
  }

  play(name: SfxName): void {
    if (!this.sfxOn || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime + 0.01;
    for (const note of SFX[name]) this.tone(this.out, note, t0);
  }

  /** The tune only plays on menu screens: never while the mic may be open. */
  startMusic(): void {
    if (!this.musicOn || this.musicTimer !== null || this.ctx.state !== 'running') return;
    this.musicStep = 0;
    this.musicNextAt = this.ctx.currentTime + 0.1;
    this.musicOut.gain.setTargetAtTime(0.07, this.ctx.currentTime, 0.05);
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 100);
    this.scheduleMusic();
  }

  stopMusic(): void {
    if (this.musicTimer === null) return;
    window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    // Notes already scheduled fade out rather than cut.
    this.musicOut.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
  }

  private scheduleMusic(): void {
    while (this.musicNextAt < this.ctx.currentTime + LOOKAHEAD_S) {
      const step = this.musicStep % LEAD.length;
      const lead = LEAD[step]!;
      if (lead >= 0) {
        this.tone(this.musicOut, { hz: semitone(lead), at: 0, len: STEP_S * 0.9 }, this.musicNextAt);
      }
      if (step % 4 === 0) {
        const bass = semitone(BASS[Math.floor(step / 8)]! - 12);
        const note: Note = { hz: bass, at: 0, len: STEP_S * 3.6, wave: 'triangle' };
        this.tone(this.musicOut, note, this.musicNextAt, 1.8);
      }
      this.musicNextAt += STEP_S;
      this.musicStep++;
    }
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
