/** Wire types for docs/PROTOCOL.md (v1) and a parser that trusts nothing the socket sends. */

export const PROTOCOL = 'maata.v1';

export const LANGUAGE_CODES = ['te-IN', 'hi-IN', 'hi-en'] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export const ERROR_CODES = [
  'unauthorized',
  'already_connected',
  'unknown_pack',
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
}
export interface QuestionMsg {
  type: 'question';
  index: number;
  total: number;
  prompt: string;
  kind: 'text' | 'number';
  time_limit_s: number;
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
  | SpeakStartMsg
  | SpeakEndMsg
  | ListenMsg
  | BargeInMsg
  | EosMsg
  | HeardNothingMsg
  | ResultMsg
  | GameOverMsg
  | ErrorMsg
  | PongMsg;

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

export function parsePackSummary(v: unknown): PackSummary | null {
  if (!obj(v)) return null;
  const { id, title, language, topic, questions } = v;
  if (!str(id) || !str(title) || !isLanguageCode(language) || !str(topic) || !count(questions)) {
    return null;
  }
  return { id, title, language, topic, questions };
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
      };
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
