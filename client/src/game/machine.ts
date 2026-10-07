/**
 * The Quick Quiz loop as a pure state machine. Server messages go in; the next state and a list
 * of side effects (open the mic, stop an utterance, play a sound) come out. Scores, streaks and
 * verdicts are copied from the server and never computed here.
 */
import type {
  ErrorMsg,
  GameOverMsg,
  PackSummary,
  ResultMsg,
  ServerMessage,
} from '../protocol/messages';

export type Phase =
  /** Socket open and authenticated; no game running. */
  | 'lobby'
  /** `start` sent, waiting for `game_start`. */
  | 'starting'
  /** The host is talking (intro, question, feedback) and the mic is closed. */
  | 'speaking'
  /** The server is listening; mic frames are being streamed. */
  | 'listening'
  /** The player stopped talking and the answer is being judged. */
  | 'checking'
  /** Verdict on screen. */
  | 'result'
  /** `game_over` received. */
  | 'over'
  /** The socket is gone. */
  | 'closed';

export interface GameState {
  phase: Phase;
  maxGames: number;
  gamesStarted: number;
  pack: PackSummary | null;
  total: number;
  /** Zero-based index of the current question; -1 before the first one. */
  index: number;
  prompt: string;
  kind: 'text' | 'number';
  timeLimitS: number;
  score: number;
  streak: number;
  maxScore: number;
  caption: string;
  /** Utterance carrying the current question's audio, once its `speak_start` arrives. */
  questionUtterance: number | null;
  awaitingQuestionAudio: boolean;
  /** Goes up on every `heard_nothing`, so the UI can nudge the player each time. */
  heardNothing: number;
  result: ResultMsg | null;
  final: GameOverMsg | null;
  error: ErrorMsg | null;
  closeCode: number | null;
}

export type Effect =
  | { type: 'voice_start'; utterance: number; sampleRate: number }
  | { type: 'voice_end'; utterance: number }
  | { type: 'voice_cut'; utterance: number }
  | { type: 'voice_stop' }
  | { type: 'mic'; on: boolean }
  | { type: 'mic_release' }
  /** Start the display timer once `after` has finished playing (or straight away if null). */
  | { type: 'timer_start'; seconds: number; after: number | null }
  | { type: 'timer_stop' }
  | { type: 'sfx'; name: 'correct' | 'wrong' | 'timeout' | 'fanfare' };

export type GameEvent =
  | { type: 'message'; message: ServerMessage }
  | { type: 'start_requested' }
  | { type: 'closed'; code: number };

export interface Step {
  state: GameState;
  effects: Effect[];
}

export function initialState(): GameState {
  return {
    phase: 'lobby',
    maxGames: 0,
    gamesStarted: 0,
    pack: null,
    total: 0,
    index: -1,
    prompt: '',
    kind: 'text',
    timeLimitS: 0,
    score: 0,
    streak: 0,
    maxScore: 0,
    caption: '',
    questionUtterance: null,
    awaitingQuestionAudio: false,
    heardNothing: 0,
    result: null,
    final: null,
    error: null,
    closeCode: null,
  };
}

const IN_GAME: readonly Phase[] = ['speaking', 'listening', 'checking', 'result'];

export function inGame(state: GameState): boolean {
  return IN_GAME.includes(state.phase);
}

export function gamesLeft(state: GameState): number {
  return Math.max(0, state.maxGames - state.gamesStarted);
}

export function reduce(state: GameState, event: GameEvent): Step {
  if (state.phase === 'closed') return { state, effects: [] };
  switch (event.type) {
    case 'start_requested':
      if (state.phase !== 'lobby' && state.phase !== 'over') return { state, effects: [] };
      return { state: { ...state, phase: 'starting', error: null }, effects: [] };
    case 'closed':
      return {
        state: { ...state, phase: 'closed', closeCode: event.code },
        effects: [{ type: 'mic', on: false }, { type: 'mic_release' }, { type: 'timer_stop' }, { type: 'voice_stop' }],
      };
    case 'message':
      return onMessage(state, event.message);
  }
}

function onMessage(state: GameState, m: ServerMessage): Step {
  switch (m.type) {
    case 'ready':
      return { state: { ...state, phase: 'lobby', maxGames: m.max_games }, effects: [] };

    case 'game_start':
      return {
        state: {
          ...state,
          phase: 'speaking',
          gamesStarted: state.gamesStarted + 1,
          pack: m.pack,
          total: m.questions,
          index: -1,
          prompt: '',
          timeLimitS: m.time_limit_s,
          score: 0,
          streak: 0,
          maxScore: m.max_score,
          caption: '',
          questionUtterance: null,
          awaitingQuestionAudio: false,
          heardNothing: 0,
          result: null,
          final: null,
          error: null,
        },
        effects: [{ type: 'timer_stop' }],
      };

    case 'question':
      return {
        state: {
          ...state,
          phase: 'speaking',
          index: m.index,
          total: m.total,
          prompt: m.prompt,
          kind: m.kind,
          timeLimitS: m.time_limit_s,
          questionUtterance: null,
          awaitingQuestionAudio: true,
          heardNothing: 0,
          result: null,
        },
        effects: [{ type: 'timer_stop' }],
      };

    case 'speak_start':
      return {
        state: {
          ...state,
          caption: m.caption,
          questionUtterance: state.awaitingQuestionAudio ? m.utterance : state.questionUtterance,
          awaitingQuestionAudio: false,
        },
        effects: [{ type: 'voice_start', utterance: m.utterance, sampleRate: m.sample_rate }],
      };

    case 'speak_end':
      return { state, effects: [{ type: 'voice_end', utterance: m.utterance }] };

    case 'listen':
      if (!inGame(state)) return { state, effects: [] };
      return {
        state: { ...state, phase: 'listening' },
        effects: [
          { type: 'mic', on: true },
          { type: 'timer_start', seconds: state.timeLimitS, after: state.questionUtterance },
        ],
      };

    case 'barge_in':
      return { state, effects: [{ type: 'voice_cut', utterance: m.utterance }] };

    case 'eos':
      if (state.phase !== 'listening') return { state, effects: [] };
      return { state: { ...state, phase: 'checking' }, effects: [] };

    case 'heard_nothing':
      if (state.phase !== 'listening' && state.phase !== 'checking') return { state, effects: [] };
      return {
        state: { ...state, phase: 'listening', heardNothing: state.heardNothing + 1 },
        effects: [],
      };

    case 'result': {
      if (!inGame(state)) return { state, effects: [] };
      const effects: Effect[] = [{ type: 'mic', on: false }, { type: 'timer_stop' }];
      if (!m.skipped) {
        effects.push({ type: 'sfx', name: m.correct ? 'correct' : m.timed_out ? 'timeout' : 'wrong' });
      }
      return {
        state: { ...state, phase: 'result', result: m, score: m.score, streak: m.streak },
        effects,
      };
    }

    case 'game_over':
      return {
        state: { ...state, phase: 'over', final: m, score: m.score, maxScore: m.max_score },
        effects: [
          { type: 'mic', on: false },
          { type: 'mic_release' },
          { type: 'timer_stop' },
          { type: 'sfx', name: 'fanfare' },
        ],
      };

    case 'error': {
      const next: GameState = { ...state, error: m };
      // A refused start (unknown_pack, busy) leaves the player in the lobby to try again.
      if (!m.fatal && state.phase === 'starting') next.phase = 'lobby';
      const effects: Effect[] = m.fatal ? [{ type: 'mic', on: false }, { type: 'timer_stop' }] : [];
      return { state: next, effects };
    }

    case 'pong':
      return { state, effects: [] };
  }
}
