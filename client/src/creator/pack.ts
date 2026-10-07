/**
 * Creator Mode's pack model. The checks mirror `server/app/game/packs.py`, so a draft that is
 * valid here loads on the server unchanged. The server (and a human reviewer) still has the last
 * word: nothing made here is playable until it has been reviewed.
 */
import { isLanguageCode, type LanguageCode } from '../protocol/messages';

export const MAX_PACK_BYTES = 256 * 1024;
export const MIN_QUESTIONS = 5;
export const MAX_QUESTIONS = 50;
export const MAX_ANSWERS = 10;

export interface DraftQuestion {
  id: string;
  prompt: string;
  /** Every spelling or wording that should count as correct. */
  answers: string[];
  display_answer: string;
  kind: 'text' | 'number';
  explanation: string;
}

export interface DraftPack {
  id: string;
  title: string;
  language: LanguageCode;
  topic: string;
  version: number;
  questions: DraftQuestion[];
}

export interface Issue {
  /** Where the problem is: `title`, or `questions.3.answers`. */
  path: string;
  message: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]{2,47}$/;
const QUESTION_ID = /^[a-z0-9-]{1,32}$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
// Control characters and bidi overrides: stripped by the server as spoofing vectors.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;

export function cleanText(value: string): string {
  return value.normalize('NFC').replace(CONTROL, '').trim().split(/\s+/u).join(' ');
}

const length = (value: string): number => [...value].length;

export function emptyQuestion(number: number): DraftQuestion {
  return {
    id: `q${number}`,
    prompt: '',
    answers: [],
    display_answer: '',
    kind: 'text',
    explanation: '',
  };
}

export function emptyDraft(language: LanguageCode): DraftPack {
  return {
    id: '',
    title: '',
    language,
    topic: '',
    version: 1,
    questions: Array.from({ length: MIN_QUESTIONS }, (_, i) => emptyQuestion(i + 1)),
  };
}

/** Suggests a pack id from the title's Latin letters and digits, e.g. "te-solar-system". */
export function slugify(language: LanguageCode, title: string): string {
  const words = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prefix = language.slice(0, 2);
  return `${prefix}-${words || 'pack'}`.slice(0, 48).replace(/-+$/, '');
}

function cleanQuestion(q: DraftQuestion): DraftQuestion {
  return {
    id: q.id.trim(),
    prompt: cleanText(q.prompt),
    answers: q.answers.map(cleanText).filter((a) => a !== ''),
    display_answer: cleanText(q.display_answer),
    kind: q.kind,
    explanation: cleanText(q.explanation),
  };
}

export function cleanDraft(draft: DraftPack): DraftPack {
  return {
    id: draft.id.trim(),
    title: cleanText(draft.title),
    language: draft.language,
    topic: cleanText(draft.topic),
    version: draft.version,
    questions: draft.questions.map(cleanQuestion),
  };
}

export function validatePack(input: DraftPack): Issue[] {
  const draft = cleanDraft(input);
  const issues: Issue[] = [];
  const add = (path: string, message: string): void => void issues.push({ path, message });

  if (!SLUG.test(draft.id)) {
    add('id', 'Use 3 to 48 lowercase letters, digits or hyphens, starting with a letter or digit.');
  }
  if (length(draft.title) < 3 || length(draft.title) > 60) add('title', 'Use 3 to 60 characters.');
  if (length(draft.topic) < 2 || length(draft.topic) > 40) add('topic', 'Use 2 to 40 characters.');
  if (!Number.isInteger(draft.version) || draft.version < 1) {
    add('version', 'Use a whole number, 1 or higher.');
  }
  if (draft.questions.length < MIN_QUESTIONS || draft.questions.length > MAX_QUESTIONS) {
    add('questions', `A pack needs ${MIN_QUESTIONS} to ${MAX_QUESTIONS} questions.`);
  }

  const seen = new Set<string>();
  draft.questions.forEach((q, i) => {
    const at = `questions.${i}`;
    if (!QUESTION_ID.test(q.id)) {
      add(`${at}.id`, 'Use 1 to 32 lowercase letters, digits or hyphens.');
    } else if (seen.has(q.id)) {
      add(`${at}.id`, 'Each question needs its own id.');
    }
    seen.add(q.id);
    if (length(q.prompt) < 3 || length(q.prompt) > 300) {
      add(`${at}.prompt`, 'Write the question in 3 to 300 characters.');
    }
    if (q.answers.length < 1 || q.answers.length > MAX_ANSWERS) {
      add(`${at}.answers`, `Give 1 to ${MAX_ANSWERS} accepted answers, one per line.`);
    } else if (q.answers.some((a) => length(a) > 80)) {
      add(`${at}.answers`, 'Each answer can be at most 80 characters.');
    } else if (q.kind === 'number' && q.answers.some((a) => !NUMBER.test(a.replaceAll(',', '')))) {
      add(`${at}.answers`, 'Number questions need answers in digits, like 7 or 3.14.');
    }
    if (length(q.display_answer) < 1 || length(q.display_answer) > 80) {
      add(`${at}.display_answer`, 'Write the answer to show and speak, up to 80 characters.');
    }
    if (length(q.explanation) > 200) {
      add(`${at}.explanation`, 'Keep the explanation under 200 characters.');
    }
  });

  if (issues.length === 0 && new TextEncoder().encode(serializePack(draft)).length > MAX_PACK_BYTES) {
    add('questions', 'This pack is larger than 256 KB.');
  }
  return issues;
}

/**
 * The pack file, in the server's schema. `source` is always `creator`, and the review fields
 * are left out: only a named human reviewer can add them.
 */
export function serializePack(input: DraftPack): string {
  const draft = cleanDraft(input);
  const pack = {
    schema: 1,
    id: draft.id,
    title: draft.title,
    language: draft.language,
    topic: draft.topic,
    version: draft.version,
    source: 'creator',
    questions: draft.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      answers: q.answers,
      display_answer: q.display_answer,
      ...(q.kind === 'number' ? { kind: q.kind } : {}),
      ...(q.explanation ? { explanation: q.explanation } : {}),
    })),
  };
  return `${JSON.stringify(pack, null, 2)}\n`;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Reads a pack file back into a draft. Throws on anything that isn't a pack-shaped object. */
export function parseDraft(json: string): DraftPack {
  if (new TextEncoder().encode(json).length > MAX_PACK_BYTES) throw new Error('pack too large');
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('not a pack');
  const pack = raw as Record<string, unknown>;
  if (!isLanguageCode(pack.language) || !Array.isArray(pack.questions)) {
    throw new Error('not a pack');
  }
  const questions = pack.questions.slice(0, MAX_QUESTIONS).map((item, i): DraftQuestion => {
    const q = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    return {
      id: text(q.id) || `q${i + 1}`,
      prompt: text(q.prompt),
      answers: Array.isArray(q.answers) ? q.answers.filter((a) => typeof a === 'string') : [],
      display_answer: text(q.display_answer),
      kind: q.kind === 'number' ? 'number' : 'text',
      explanation: text(q.explanation),
    };
  });
  return {
    id: text(pack.id),
    title: text(pack.title),
    language: pack.language,
    topic: text(pack.topic),
    version: typeof pack.version === 'number' && pack.version >= 1 ? Math.floor(pack.version) : 1,
    questions,
  };
}
