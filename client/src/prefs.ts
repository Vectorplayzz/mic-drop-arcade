/**
 * Player preferences kept across visits. Only harmless settings live in localStorage; the
 * session token never does (it stays in memory, PROTOCOL §1).
 */
import {
  DEFAULT_HERO,
  type Hero,
  heroOr,
  isLanguageCode,
  isRank,
  type LanguageCode,
  type Rank,
  type Wizard,
  WIZARDS,
} from './protocol/messages';

/** An ending the player has reached, with its title in the language they played. */
export interface FoundEnding {
  title: string;
  rank: Rank;
}
/** The player's best run of one adventure. */
export interface BestRun {
  score: number;
  ms: number;
}

export interface Prefs {
  language: LanguageCode | null;
  /** 0..1 */
  voiceVolume: number;
  sfx: boolean;
  music: boolean;
  /** The hero picked in the lobby; it rides along with every game and shows on the score card. */
  hero: Hero;
  /** The wizard who narrates every quest; the green sorceress unless the player picks another. */
  wizard: Wizard;
  /** Endings collected per adventure: the "collect them all" shelf in the lobby. */
  endings: Record<string, Record<string, FoundEnding>>;
  /** Personal bests per adventure. */
  best: Record<string, BestRun>;
  /** Last leaderboard name, pre-filled next time and printed on the score card. */
  nickname: string;
  /** Experience from every finished run; it sets the player's level. */
  xp: number;
}

export const DEFAULT_WIZARD: Wizard = 'sorceress';

const KEY = 'maata.prefs.v1';
const DEFAULTS: Prefs = {
  language: null,
  voiceVolume: 1,
  sfx: true,
  music: true,
  hero: DEFAULT_HERO,
  wizard: DEFAULT_WIZARD,
  endings: {},
  best: {},
  nickname: '',
  xp: 0,
};

const ID = /^[a-z][a-z0-9_-]{0,47}$/;

function loadEndings(v: unknown): Prefs['endings'] {
  const out: Prefs['endings'] = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [adv, found] of Object.entries(v as Record<string, unknown>).slice(0, 40)) {
    if (!ID.test(adv) || typeof found !== 'object' || found === null) continue;
    const shelf: Record<string, FoundEnding> = {};
    for (const [id, e] of Object.entries(found as Record<string, unknown>).slice(0, 12)) {
      const rec = e as Record<string, unknown> | null;
      if (ID.test(id) && rec && typeof rec.title === 'string' && isRank(rec.rank)) {
        shelf[id] = { title: rec.title.slice(0, 60), rank: rec.rank };
      }
    }
    out[adv] = shelf;
  }
  return out;
}

function loadBest(v: unknown): Prefs['best'] {
  const out: Prefs['best'] = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [adv, b] of Object.entries(v as Record<string, unknown>).slice(0, 40)) {
    const rec = b as Record<string, unknown> | null;
    if (ID.test(adv) && rec && Number.isFinite(rec.score) && Number.isFinite(rec.ms)) {
      out[adv] = { score: Number(rec.score), ms: Number(rec.ms) };
    }
  }
  return out;
}

export function loadPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const saved = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const volume = saved.voiceVolume;
    return {
      language: isLanguageCode(saved.language) ? saved.language : null,
      voiceVolume:
        typeof volume === 'number' && volume >= 0 && volume <= 1 ? volume : DEFAULTS.voiceVolume,
      sfx: typeof saved.sfx === 'boolean' ? saved.sfx : DEFAULTS.sfx,
      music: typeof saved.music === 'boolean' ? saved.music : DEFAULTS.music,
      hero: heroOr(saved.hero),
      wizard: (WIZARDS as readonly unknown[]).includes(saved.wizard)
        ? (saved.wizard as Wizard)
        : DEFAULT_WIZARD,
      endings: loadEndings(saved.endings),
      best: loadBest(saved.best),
      nickname: typeof saved.nickname === 'string' ? saved.nickname.slice(0, 16) : '',
      xp:
        typeof saved.xp === 'number' && Number.isFinite(saved.xp) && saved.xp >= 0
          ? Math.min(Math.floor(saved.xp), 10_000_000)
          : 0,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing or a full disk: the choice just won't be remembered.
  }
}

const RANK_XP: Record<Rank, number> = { gold: 60, silver: 35, bronze: 15 };
const NEW_ENDING_XP = 40;

/** Level n needs 100·n² XP in total: quick early levels, slower later ones. */
export function levelFor(xp: number): { level: number; into: number; need: number } {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
  const floor = 100 * (level - 1) ** 2;
  const next = 100 * level ** 2;
  return { level, into: xp - floor, need: next - floor };
}

export interface RunRecord {
  newBest: boolean;
  newEnding: boolean;
  xpGained: number;
  levelUp: boolean;
}

/** Record a finished adventure run: the ending on the shelf, personal best and XP. */
export function recordRun(
  prefs: Prefs,
  adventure: string,
  ending: { id: string; title: string; rank: Rank },
  score: number,
  ms: number,
): RunRecord {
  const shelf = (prefs.endings[adventure] ??= {});
  const newEnding = !shelf[ending.id];
  shelf[ending.id] = { title: ending.title, rank: ending.rank };
  const best = prefs.best[adventure];
  const newBest = !best || score > best.score || (score === best.score && ms < best.ms);
  if (newBest) prefs.best[adventure] = { score, ms };
  const xpGained = Math.round(score / 10) + RANK_XP[ending.rank] + (newEnding ? NEW_ENDING_XP : 0);
  const before = levelFor(prefs.xp).level;
  prefs.xp += xpGained;
  savePrefs(prefs);
  return { newBest, newEnding, xpGained, levelUp: levelFor(prefs.xp).level > before };
}
