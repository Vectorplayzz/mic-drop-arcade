/** Same-origin HTTP API (PROTOCOL §1 and §7). Nothing here ever talks to another host. */
import {
  type AdventureSummary,
  type Hero,
  heroOr,
  isLanguageCode,
  isRank,
  isWizard,
  type LanguageCode,
  type PackSummary,
  parseAdventureSummary,
  parsePackSummary,
  type Rank,
  type Wizard,
} from '../protocol/messages';

export interface Language {
  code: LanguageCode;
  label: string;
}

export interface Status {
  open: boolean;
  reason: 'closed_for_today' | 'maintenance' | null;
  languages: Language[];
}

export interface Session {
  token: string;
  /** Unix seconds. */
  expiresAt: number;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  correct: number;
  questions: number;
  hero: Hero;
  wizard: Wizard | null;
  adventure: string | null;
  /** Server-timed run length; ties on score go to the faster run. */
  durationMs: number | null;
  endingRank: Rank | null;
}

export interface Adventures {
  /** The wizard's prologue is available: "let the wizard choose". */
  auto: boolean;
  adventures: AdventureSummary[];
}

export type Period = 'today' | 'all';

/** `code` is the server's error string, or `offline` / `bad_response` for transport failures. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterS: number | null = null,
  ) {
    super(code);
  }
}

const TIMEOUT_MS = 12_000;

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An error page from the proxy, not JSON: the status code decides below.
  }
  if (!response.ok) {
    const record = (body ?? {}) as Record<string, unknown>;
    const detail = record.detail ?? record.error;
    const retry = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
    throw new ApiError(
      response.status,
      typeof detail === 'string' ? detail : `http_${response.status}`,
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }
  if (typeof body !== 'object' || body === null) throw new ApiError(response.status, 'bad_response');
  return body;
}

function post(path: string, payload: unknown): Promise<unknown> {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getStatus(): Promise<Status> {
  const body = (await request('/api/status')) as Record<string, unknown>;
  const languages: Language[] = [];
  for (const item of Array.isArray(body.languages) ? body.languages : []) {
    const entry = item as Record<string, unknown> | null;
    if (entry && isLanguageCode(entry.code) && typeof entry.label === 'string') {
      languages.push({ code: entry.code, label: entry.label });
    }
  }
  const open = body.open === true;
  return {
    open,
    reason: open ? null : body.reason === 'maintenance' ? 'maintenance' : 'closed_for_today',
    languages,
  };
}

export async function getPacks(language: LanguageCode): Promise<PackSummary[]> {
  const body = (await request(`/api/packs?language=${encodeURIComponent(language)}`)) as {
    packs?: unknown;
  };
  const packs = Array.isArray(body.packs) ? body.packs.map(parsePackSummary) : [];
  return packs.filter((p): p is PackSummary => p !== null);
}

export async function getAdventures(language: LanguageCode): Promise<Adventures> {
  const body = (await request(`/api/adventures?language=${encodeURIComponent(language)}`)) as {
    auto?: unknown;
    adventures?: unknown;
  };
  const list = Array.isArray(body.adventures) ? body.adventures.map(parseAdventureSummary) : [];
  return {
    auto: body.auto === true,
    adventures: list.filter((a): a is AdventureSummary => a !== null),
  };
}

export async function createSession(turnstileToken: string): Promise<Session> {
  const body = (await post('/api/session', { turnstile_token: turnstileToken })) as Record<
    string,
    unknown
  >;
  if (typeof body.token !== 'string' || typeof body.expires_at !== 'number') {
    throw new ApiError(200, 'bad_response');
  }
  return { token: body.token, expiresAt: body.expires_at };
}

/** Returns the run's place on the all-time board for adventures (null for quiz games). */
export async function postScore(scoreToken: string, nickname: string): Promise<number | null> {
  const body = (await post('/api/scores', { score_token: scoreToken, nickname })) as Record<
    string,
    unknown
  >;
  return typeof body.rank === 'number' && body.rank > 0 ? body.rank : null;
}

export async function getLeaderboard(
  language: LanguageCode,
  period: Period,
  adventure: string | null = null,
): Promise<LeaderboardEntry[]> {
  const query = new URLSearchParams({ language, period, mode: 'adventure' });
  if (adventure) query.set('adventure', adventure);
  const body = (await request(`/api/leaderboard?${query.toString()}`)) as { entries?: unknown };
  const entries: LeaderboardEntry[] = [];
  for (const item of Array.isArray(body.entries) ? body.entries : []) {
    const e = item as Record<string, unknown> | null;
    if (
      e &&
      typeof e.rank === 'number' &&
      typeof e.nickname === 'string' &&
      typeof e.score === 'number' &&
      typeof e.correct === 'number' &&
      typeof e.questions === 'number'
    ) {
      entries.push({
        rank: e.rank,
        nickname: e.nickname,
        score: e.score,
        correct: e.correct,
        questions: e.questions,
        hero: heroOr(e.character),
        wizard: isWizard(e.wizard) ? e.wizard : null,
        adventure: typeof e.adventure === 'string' ? e.adventure.slice(0, 48) : null,
        durationMs:
          typeof e.duration_ms === 'number' && e.duration_ms >= 0 ? e.duration_ms : null,
        endingRank: isRank((e.ending as Record<string, unknown> | null)?.rank)
          ? ((e.ending as Record<string, unknown>).rank as Rank)
          : null,
      });
    }
  }
  return entries;
}

/**
 * Mirrors the server's nickname rule (PROTOCOL §7) so the form can explain a problem before
 * posting. The server stays the judge; its blocklist isn't copied here.
 */
export function nicknameProblem(raw: string): 'length' | 'characters' | 'letter' | null {
  const nick = raw.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const length = [...nick].length;
  if (length < 3 || length > 16) return 'length';
  if (!/^[\p{L}\p{N}\p{Mn}\p{Mc} _-]+$/u.test(nick)) return 'characters';
  if (!/\p{L}/u.test(nick)) return 'letter';
  return null;
}
