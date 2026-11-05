/**
 * Background music: four calm, seamless lofi loops generated for this game with ACE-Step 1.5
 * (MIT). See client/ASSETS.md. A loop is fetched only when it is first needed, decoded once and
 * played with Web Audio, so it repeats without a gap and crossfades into the next track.
 *
 * The music never competes with the game. It sits low under the wizard's voice and fades out
 * completely while the mic is open, so Prisma only ever hears the player.
 */
import type { Genre } from '../protocol/messages';

export type Track = 'menu' | 'calm' | 'tension' | 'spooky';

const urls = import.meta.glob<string>('../assets/music/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
});

const trackUrl = (track: Track): string => {
  const found = urls[`../assets/music/${track}.mp3`];
  if (!found) throw new Error(`missing music: ${track}`);
  return found;
};

/** Which loop suits each kind of story. */
export const TRACK_FOR_GENRE: Record<Genre, Track> = {
  prologue: 'calm',
  action: 'tension',
  thriller: 'tension',
  mystery: 'tension',
  horror: 'spooky',
  romance: 'calm',
  comedy: 'calm',
  fantasy: 'calm',
  riddle: 'calm',
  scifi: 'calm',
};

/** Loudness per situation: full on menus, a bed under the voice, silent while listening. */
const LEVEL = { menu: 0.32, story: 0.1, listening: 0 } as const;
export type MusicLevel = keyof typeof LEVEL;

const FADE_S = 0.6;

export class Music {
  private readonly out: GainNode;
  private enabled = true;
  private current: { track: Track; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wanted: Track | null = null;
  private level: MusicLevel = 'menu';
  private readonly buffers = new Map<Track, Promise<AudioBuffer | null>>();

  constructor(private readonly ctx: AudioContext) {
    this.out = ctx.createGain();
    this.out.gain.value = LEVEL.menu;
    this.out.connect(ctx.destination);
  }

  configure(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
    else if (this.wanted) this.play(this.wanted, this.level);
  }

  /** Start (or keep playing) ``track`` at ``level``; a different track crossfades in. */
  play(track: Track, level: MusicLevel = 'menu'): void {
    this.wanted = track;
    this.setLevel(level);
    if (!this.enabled || this.current?.track === track) return;
    void this.load(track).then((buffer) => {
      if (!buffer || this.wanted !== track || !this.enabled) return;
      if (this.current?.track === track) return;
      this.fadeOutCurrent();
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + FADE_S);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain).connect(this.out);
      source.start();
      this.current = { track, source, gain };
    });
  }

  setLevel(level: MusicLevel): void {
    this.level = level;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(LEVEL[level], t, level === 'listening' ? 0.08 : 0.4);
  }

  stop(): void {
    this.wanted = null;
    this.fadeOutCurrent();
  }

  /** Fetch ahead of time (e.g. the adventure's loop while the lobby is open). */
  prefetch(track: Track): void {
    void this.load(track);
  }

  private fadeOutCurrent(): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    const t = this.ctx.currentTime;
    cur.gain.gain.cancelScheduledValues(t);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
    cur.gain.gain.linearRampToValueAtTime(0, t + FADE_S);
    cur.source.stop(t + FADE_S + 0.05);
    cur.source.onended = () => {
      cur.source.disconnect();
      cur.gain.disconnect();
    };
  }

  private load(track: Track): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(track);
    if (!pending) {
      pending = fetch(trackUrl(track))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => this.ctx.decodeAudioData(data))
        .catch(() => {
          // Offline or a decode failure: the game simply plays without music.
          this.buffers.delete(track);
          return null;
        });
      this.buffers.set(track, pending);
    }
    return pending;
  }
}
