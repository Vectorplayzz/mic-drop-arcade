/** Wire types for docs/PROTOCOL.md (v1) and a parser that trusts nothing the socket sends. */

export const PROTOCOL = 'maata.v1';

export const LANGUAGE_CODES = ['te-IN', 'hi-IN', 'hi-en', 'te-en', 'en-IN'] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export const ERROR_CODES = [
  'unauthorized',
  'already_connected',
  'unknown_pack',
  'unknown_adventure',
  'unknown_language',
  'unknown_character',
  'busy',
  'closed_for_today',
  'session_limit',
  'audio_limit',
  'idle',
  'protocol',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const CLOSE = {
  protocol: 4400,
  auth: 4401,
  origin: 4403,
  idle: 4408,
  duplicate: 4409,
  limit: 4429,
  closedForToday: 4503,
} as const;

export interface PackSummary {
  id: string;
  title: string;
  language: LanguageCode;
  topic: string;
  questions: number;
  /** Wizard, scene and length for quest packs (PROTOCOL §9); null for a plain quiz. */
  story: StoryInfo | null;
}

/** Pickable heroes (server/app/game/characters.py). Sprites: src/assets/art/sprites/heroes. */
export const HEROES = [
  'arjun',
  'kabir',
  'sai',
  'rohan',
  'aditya',
  'imran',
  'diya',
  'meera',
  'zara',
  'ananya',
  'priya',
  'sana',
  'vikas',
  'arnav',
  'harpreet',
  'dhruv',
  'aisha',
  'kavya',
  'nila',
  'tara',
] as const;
export type Hero = (typeof HEROES)[number];
export const DEFAULT_HERO: Hero = 'arjun';

export const WIZARDS = ['sorceress', 'sage', 'owl', 'enchantress', 'trickster'] as const;
export type Wizard = (typeof WIZARDS)[number];

/** Painted scenes the client ships (src/assets/art/backgrounds), matching the server's list. */
export const SCENES = [
  'crystal-cave',
  'fest-arena',
  'fest-dawn',
  'fest-garden',
  'fest-gate',
  'fest-lab',
  'fest-library',
  'fest-rain',
  'fest-rooftop',
  'fest-stage',
  'fest-stalls',
  'forest-temple',
  'hack-alley',
  'hack-cafe',
  'hack-datacenter',
  'hack-dawn',
  'hack-hall',
  'hack-metro',
  'hack-netroom',
  'hack-rooftop',
  'hack-stage',
  'hack-van',
  'hampi-bazaar',
  'hampi-camp',
  'hampi-cave',
  'hampi-chariot',
  'hampi-cliff',
  'hampi-gate',
  'hampi-hall',
  'hampi-river',
  'hampi-stepwell',
  'hampi-vault',
  'hostel-basement',
  'hostel-corridor',
  'hostel-dawn',
  'hostel-mess',
  'hostel-outside',
  'hostel-room',
  'hostel-stairs',
  'hostel-terrace',
  'hostel-warden',
  'hostel-well',
  'lab-canteen',
  'lab-cctv',
  'lab-corridor',
  'lab-dawn',
  'lab-electronics',
  'lab-library',
  'lab-office',
  'lab-rooftop',
  'lab-server',
  'lab-workshop',
  'library-a',
  'library-b',
  'loop-bedroom',
  'loop-bus',
  'loop-canteen',
  'loop-clocktower',
  'loop-corridor',
  'loop-ground',
  'loop-rewind',
  'loop-sunset',
  'loop-viva',
  'loop-xerox',
  'night-bazaar',
  'observatory',
  'orbit-ai',
  'orbit-alarm',
  'orbit-core',
  'orbit-deck',
  'orbit-garden',
  'orbit-ocean',
  'orbit-pods',
  'orbit-reentry',
  'orbit-spacewalk',
  'orbit-storm',
  'portals',
  'sky-islands',
  'train-bridge',
  'train-coach',
  'train-dawn',
  'train-engine',
  'train-landslide',
  'train-river',
  'train-roof',
  'train-signal',
  'train-station',
  'train-tunnel',
] as const;
export type Scene = (typeof SCENES)[number];

export const MOODS = ['ask', 'happy', 'sad', 'cheer'] as const;
export type Mood = (typeof MOODS)[number];

export interface StoryInfo {
  /** The wizard's display name, e.g. "Professor Hoot". */
  wizard: string;
  sprite: Wizard;
  scene: Scene;
  chapters: number;
}

export interface ReadyMsg {
  type: 'ready';
  protocol: string;
  max_games: number;
}
export interface GameStartMsg {
  type: 'game_start';
  game_id: string;
  pack: PackSummary;
  questions: number;
  time_limit_s: number;
  max_score: number;
  hero: Hero;
  story: StoryInfo | null;
}
export interface QuestionMsg {
  type: 'question';
  index: number;
  total: number;
  prompt: string;
  kind: 'text' | 'number';
  time_limit_s: number;
  /** Three on-screen choices in display order, or null for open-answer packs. */
  options: string[] | null;
}
export type StoryKind = 'intro' | 'chapter' | 'setback' | 'ending';
export type EndingBand = 'great' | 'good' | 'try_again';
export interface StoryMsg {
  type: 'story';
  kind: StoryKind;
  text: string;
  mood: Mood;
  /** On `chapter`: how many chapters are done (1-based). */
  chapter: number | null;
  /** On `ending`. */
  band: EndingBand | null;
}
export interface SpeakStartMsg {
  type: 'speak_start';
  utterance: number;
  caption: string;
  sample_rate: number;
}
export interface SpeakEndMsg {
  type: 'speak_end';
  utterance: number;
  duration_ms: number;
  interrupted: boolean;
}
export interface ListenMsg {
  type: 'listen';
  index: number;
  barge_in: boolean;
}
export interface BargeInMsg {
  type: 'barge_in';
  utterance: number;
}
export interface EosMsg {
  type: 'eos';
}
export interface HeardNothingMsg {
  type: 'heard_nothing';
}
export interface ResultMsg {
  type: 'result';
  index: number;
  /** A provider error voided the round: no verdict and no penalty. */
  skipped: boolean;
  correct: boolean;
  timed_out: boolean;
  heard: string;
  answer: string;
  explanation: string | null;
  points: number;
  score: number;
  streak: number;
}
export interface GameOverMsg {
  type: 'game_over';
  game_id: string;
  score: number;
  correct: number;
  questions: number;
  max_score: number;
  score_token: string;
  hero: Hero;
  mode: 'quiz' | 'adventure';
  wizard: Wizard | null;
  /** Adventure runs only. */
  adventure: string | null;
  ending: FinalEnding | null;
  duration_ms: number | null;
}
// ---------------------------------------------------------------- adventures (§10) ---
export const GENRES = [
  'prologue',
  'action',
  'romance',
  'mystery',
  'scifi',
  'horror',
  'fantasy',
  'riddle',
  'comedy',
  'thriller',
] as const;
export type Genre = (typeof GENRES)[number];

export const RANKS = ['gold', 'silver', 'bronze'] as const;
export type Rank = (typeof RANKS)[number];

export const METER_ICONS = ['clock', 'heart', 'search', 'bolt', 'nerve', 'flame', 'star'] as const;
export type MeterIcon = (typeof METER_ICONS)[number];

export interface MeterInfo {
  label: string;
  icon: MeterIcon;
  max: number;
}
export interface EndingRef {
  id: string;
  rank: Rank;
}
export interface AdventureSummary {
  id: string;
  genre: Genre;
  title: string;
  tagline: string;
  cover: Scene;
  meter: MeterInfo | null;
  endings: EndingRef[];
  scenes: Scene[];
}
export interface Item {
  id: string;
  label: string;
}
export type NodeKind = 'choice' | 'puzzle' | 'story';

export interface AdventureStartMsg {
  type: 'adventure_start';
  game_id: string;
  adventure: AdventureSummary;
  /** True when the wizard's prologue just picked this adventure. */
  routed: boolean;
  hero: Hero;
  wizard: Wizard;
  meter: number | null;
  time_limit_s: number;
  choice_time_limit_s: number;
}
export interface StateFields {
  meter: number | null;
  meter_delta: number;
  items: Item[];
  gained: string[];
}
export interface NodeMsg extends StateFields {
  type: 'node';
  id: string;
  scene: Scene;
  mood: Mood;
  step: number;
  kind: NodeKind;
}
export interface StateMsg extends StateFields {
  type: 'state';
}
export interface ChoicesMsg {
  type: 'choices';
  choices: string[];
  attempt: number;
  time_limit_s: number;
}
export interface UnclearMsg {
  type: 'unclear';
  heard: string;
  attempts_left: number;
}
export interface ChosenMsg {
  type: 'chosen';
  index: number;
  heard: string;
  /** The wizard picked because nothing clear was heard. */
  auto: boolean;
}
export interface PuzzleMsg {
  type: 'puzzle';
  prompt: string;
  options: string[];
  kind: 'text' | 'number';
  time_limit_s: number;
}
export interface PuzzleResultMsg {
  type: 'puzzle_result';
  correct: boolean;
  timed_out: boolean;
  skipped: boolean;
  heard: string;
  answer: string;
  points: number;
  score: number;
  streak: number;
}
export interface WizardMsg {
  type: 'wizard';
  key: string;
  mood: Mood | null;
}
export interface EndingMsg {
  type: 'ending';
  id: string;
  title: string;
  rank: Rank;
  scene: Scene;
  mood: Mood;
  bonus: number;
  score: number;
  endings: EndingRef[];
}
export interface FinalEnding {
  id: string;
  title: string;
  rank: Rank;
}

export interface ErrorMsg {
  type: 'error';
  code: ErrorCode;
  message: string;
  fatal: boolean;
}
export interface PongMsg {
  type: 'pong';
  t: number | null;
}

export type ServerMessage =
  | ReadyMsg
  | GameStartMsg
  | QuestionMsg
  | StoryMsg
  | SpeakStartMsg
  | SpeakEndMsg
  | ListenMsg
  | BargeInMsg
  | EosMsg
  | HeardNothingMsg
  | ResultMsg
  | GameOverMsg
  | ErrorMsg
  | PongMsg
  | AdventureStartMsg
  | NodeMsg
  | StateMsg
  | ChoicesMsg
  | UnclearMsg
  | ChosenMsg
  | PuzzleMsg
  | PuzzleResultMsg
  | WizardMsg
  | EndingMsg;

type Json = Record<string, unknown>;

const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown): v is number => num(v) && Number.isInteger(v) && v >= 0;
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const obj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const utteranceId = (v: unknown): v is number => count(v) && v <= 0xffff;

export function isLanguageCode(v: unknown): v is LanguageCode {
  return str(v) && (LANGUAGE_CODES as readonly string[]).includes(v);
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  str(v) && (list as readonly string[]).includes(v);

export const isHero = (v: unknown): v is Hero => oneOf(HEROES, v);
export const isWizard = (v: unknown): v is Wizard => oneOf(WIZARDS, v);
export const isScene = (v: unknown): v is Scene => oneOf(SCENES, v);
export const isRank = (v: unknown): v is Rank => oneOf(RANKS, v);
const slug = (v: unknown): v is string => str(v) && /^[a-z][a-z0-9_-]{0,47}$/.test(v);
const text = (v: unknown, max: number): string => (str(v) ? v.slice(0, max) : '');

function parseEndingRefs(v: unknown): EndingRef[] {
  if (!Array.isArray(v)) return [];
  const out: EndingRef[] = [];
  for (const e of v.slice(0, 12)) {
    if (obj(e) && slug(e.id) && isRank(e.rank)) out.push({ id: e.id, rank: e.rank });
  }
  return out;
}

function parseMeterInfo(v: unknown): MeterInfo | null {
  if (!obj(v) || !str(v.label) || !oneOf(METER_ICONS, v.icon) || !count(v.max)) return null;
  return { label: v.label.slice(0, 30), icon: v.icon, max: Math.min(v.max, 9) };
}

export function parseAdventureSummary(v: unknown): AdventureSummary | null {
  if (!obj(v) || !slug(v.id) || !oneOf(GENRES, v.genre) || !str(v.title)) return null;
  return {
    id: v.id,
    genre: v.genre,
    title: v.title.slice(0, 60),
    tagline: text(v.tagline, 160),
    cover: isScene(v.cover) ? v.cover : 'library-a',
    meter: parseMeterInfo(v.meter),
    endings: parseEndingRefs(v.endings),
    scenes: Array.isArray(v.scenes) ? v.scenes.filter(isScene).slice(0, 40) : [],
  };
}

function parseItems(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  const out: Item[] = [];
  for (const i of v.slice(0, 12)) {
    if (obj(i) && slug(i.id) && str(i.label)) out.push({ id: i.id, label: i.label.slice(0, 40) });
  }
  return out;
}

function parseStateFields(m: Json): StateFields {
  return {
    meter: count(m.meter) ? Math.min(m.meter, 9) : null,
    meter_delta: num(m.meter_delta) ? Math.trunc(m.meter_delta) : 0,
    items: parseItems(m.items),
    gained: Array.isArray(m.gained) ? m.gained.filter(slug).slice(0, 8) : [],
  };
}

function parseFinalEnding(v: unknown): FinalEnding | null {
  if (!obj(v) || !slug(v.id) || !str(v.title) || !isRank(v.rank)) return null;
  return { id: v.id, title: v.title.slice(0, 60), rank: v.rank };
}

/** Unknown or missing hero ids fall back to the default rather than breaking the screen. */
export function heroOr(v: unknown, fallback: Hero = DEFAULT_HERO): Hero {
  return isHero(v) ? v : fallback;
}

export function parsePackSummary(v: unknown): PackSummary | null {
  if (!obj(v)) return null;
  const { id, title, language, topic, questions } = v;
  if (!str(id) || !str(title) || !isLanguageCode(language) || !str(topic) || !count(questions)) {
    return null;
  }
  return { id, title, language, topic, questions, story: parseStoryInfo(v.story) };
}

function parseStoryInfo(v: unknown): StoryInfo | null {
  if (!obj(v) || !str(v.wizard) || !count(v.chapters)) return null;
  return {
    wizard: v.wizard.slice(0, 40),
    sprite: oneOf(WIZARDS, v.wizard_sprite) ? v.wizard_sprite : 'sage',
    scene: oneOf(SCENES, v.scene) ? v.scene : 'library-a',
    chapters: Math.min(v.chapters, 50),
  };
}

function parseOptions(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(str)) return null;
  return v.map((o) => o.slice(0, 80));
}

/** Returns the typed message, or null for anything malformed or unknown (which is ignored). */
export function parseServerMessage(raw: string): ServerMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj(m) || !str(m.type)) return null;
  switch (m.type) {
    case 'ready':
      if (!str(m.protocol) || !count(m.max_games)) return null;
      return { type: 'ready', protocol: m.protocol, max_games: m.max_games };
    case 'game_start': {
      const pack = parsePackSummary(m.pack);
      if (!str(m.game_id) || !pack || !count(m.questions)) return null;
      if (!num(m.time_limit_s) || !count(m.max_score)) return null;
      return {
        type: 'game_start',
        game_id: m.game_id,
        pack,
        questions: m.questions,
        time_limit_s: m.time_limit_s,
        max_score: m.max_score,
        hero: heroOr(m.character),
        story: parseStoryInfo(m.story),
      };
    }
    case 'question':
      if (!count(m.index) || !count(m.total) || !str(m.prompt) || !num(m.time_limit_s)) return null;
      if (m.kind !== 'text' && m.kind !== 'number') return null;
      return {
        type: 'question',
        index: m.index,
        total: m.total,
        prompt: m.prompt,
        kind: m.kind,
        time_limit_s: m.time_limit_s,
        options: parseOptions(m.options),
      };
    case 'story': {
      const kinds = ['intro', 'chapter', 'setback', 'ending'] as const;
      const bands = ['great', 'good', 'try_again'] as const;
      if (!oneOf(kinds, m.kind) || !str(m.text)) return null;
      return {
        type: 'story',
        kind: m.kind,
        text: m.text,
        mood: oneOf(MOODS, m.mood) ? m.mood : 'ask',
        chapter: count(m.chapter) ? m.chapter : null,
        band: oneOf(bands, m.band) ? m.band : null,
      };
    }
    case 'speak_start':
      if (!utteranceId(m.utterance) || !str(m.caption) || !num(m.sample_rate)) return null;
      if (m.sample_rate < 8000 || m.sample_rate > 48000) return null;
      return {
        type: 'speak_start',
        utterance: m.utterance,
        caption: m.caption,
        sample_rate: m.sample_rate,
      };
    case 'speak_end':
      if (!utteranceId(m.utterance)) return null;
      return {
        type: 'speak_end',
        utterance: m.utterance,
        duration_ms: num(m.duration_ms) ? m.duration_ms : 0,
        interrupted: m.interrupted === true,
      };
    case 'listen':
      if (!count(m.index)) return null;
      return { type: 'listen', index: m.index, barge_in: m.barge_in === true };
    case 'barge_in':
      if (!utteranceId(m.utterance)) return null;
      return { type: 'barge_in', utterance: m.utterance };
    case 'eos':
      return { type: 'eos' };
    case 'heard_nothing':
      return { type: 'heard_nothing' };
    case 'result': {
      if (!count(m.index) || !count(m.score) || !count(m.streak)) return null;
      const skipped = m.skipped === true;
      if (!skipped && (!bool(m.correct) || !bool(m.timed_out) || !count(m.points))) return null;
      return {
        type: 'result',
        index: m.index,
        skipped,
        correct: m.correct === true,
        timed_out: m.timed_out === true,
        heard: str(m.heard) ? m.heard : '',
        answer: str(m.answer) ? m.answer : '',
        explanation: str(m.explanation) && m.explanation ? m.explanation : null,
        points: count(m.points) ? m.points : 0,
        score: m.score,
        streak: m.streak,
      };
    }
    case 'game_over':
      if (!str(m.game_id) || !count(m.score) || !count(m.correct) || !count(m.questions)) {
        return null;
      }
      if (!count(m.max_score) || !str(m.score_token)) return null;
      return {
        type: 'game_over',
        game_id: m.game_id,
        score: m.score,
        correct: m.correct,
        questions: m.questions,
        max_score: m.max_score,
        score_token: m.score_token,
        hero: heroOr(m.character),
        mode: m.mode === 'adventure' ? 'adventure' : 'quiz',
        wizard: isWizard(m.wizard) ? m.wizard : null,
        adventure: slug(m.adventure) ? m.adventure : null,
        ending: parseFinalEnding(m.ending),
        duration_ms: count(m.duration_ms) ? m.duration_ms : null,
      };
    case 'adventure_start': {
      const adventure = parseAdventureSummary(m.adventure);
      if (!str(m.game_id) || !adventure || !num(m.time_limit_s)) return null;
      return {
        type: 'adventure_start',
        game_id: m.game_id,
        adventure,
        routed: m.routed === true,
        hero: heroOr(m.character),
        wizard: isWizard(m.wizard) ? m.wizard : 'sorceress',
        meter: count(m.meter) ? Math.min(m.meter, 9) : null,
        time_limit_s: m.time_limit_s,
        choice_time_limit_s: num(m.choice_time_limit_s) ? m.choice_time_limit_s : m.time_limit_s,
      };
    }
    case 'node': {
      const kinds = ['choice', 'puzzle', 'story'] as const;
      if (!slug(m.id) || !isScene(m.scene) || !count(m.step) || !oneOf(kinds, m.kind)) return null;
      return {
        type: 'node',
        id: m.id,
        scene: m.scene,
        mood: oneOf(MOODS, m.mood) ? m.mood : 'ask',
        step: m.step,
        kind: m.kind,
        ...parseStateFields(m),
      };
    }
    case 'state':
      return { type: 'state', ...parseStateFields(m) };
    case 'choices': {
      if (!Array.isArray(m.choices) || m.choices.length < 2 || m.choices.length > 4) return null;
      const labels = m.choices.map((c) => (obj(c) && str(c.label) ? c.label.slice(0, 60) : null));
      if (labels.some((l) => l === null) || !count(m.attempt)) return null;
      return {
        type: 'choices',
        choices: labels as string[],
        attempt: m.attempt,
        time_limit_s: num(m.time_limit_s) ? m.time_limit_s : 15,
      };
    }
    case 'unclear':
      if (!count(m.attempts_left)) return null;
      return { type: 'unclear', heard: text(m.heard, 200), attempts_left: m.attempts_left };
    case 'chosen':
      if (!count(m.index) || m.index > 3) return null;
      return { type: 'chosen', index: m.index, heard: text(m.heard, 200), auto: m.auto === true };
    case 'puzzle': {
      const options = parseOptions(m.options);
      if (!str(m.prompt) || !options || !num(m.time_limit_s)) return null;
      return {
        type: 'puzzle',
        prompt: m.prompt.slice(0, 300),
        options,
        kind: m.kind === 'number' ? 'number' : 'text',
        time_limit_s: m.time_limit_s,
      };
    }
    case 'puzzle_result':
      if (!bool(m.correct) || !count(m.points) || !count(m.score) || !count(m.streak)) return null;
      return {
        type: 'puzzle_result',
        correct: m.correct,
        timed_out: m.timed_out === true,
        skipped: m.skipped === true,
        heard: text(m.heard, 200),
        answer: text(m.answer, 80),
        points: m.points,
        score: m.score,
        streak: m.streak,
      };
    case 'wizard':
      if (!str(m.key)) return null;
      return { type: 'wizard', key: m.key.slice(0, 30), mood: oneOf(MOODS, m.mood) ? m.mood : null };
    case 'ending':
      if (!slug(m.id) || !str(m.title) || !isRank(m.rank) || !count(m.score)) return null;
      return {
        type: 'ending',
        id: m.id,
        title: m.title.slice(0, 60),
        rank: m.rank,
        scene: isScene(m.scene) ? m.scene : 'library-a',
        mood: oneOf(MOODS, m.mood) ? m.mood : 'happy',
        bonus: count(m.bonus) ? m.bonus : 0,
        score: m.score,
        endings: parseEndingRefs(m.endings),
      };
    case 'error': {
      const code = (ERROR_CODES as readonly string[]).includes(m.code as string)
        ? (m.code as ErrorCode)
        : 'internal';
      return {
        type: 'error',
        code,
        message: str(m.message) ? m.message : '',
        fatal: m.fatal === true,
      };
    }
    case 'pong':
      return { type: 'pong', t: num(m.t) ? m.t : null };
    default:
      return null;
  }
}
