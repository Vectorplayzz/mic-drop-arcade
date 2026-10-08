import { describe, expect, it } from 'vitest';
import {
  type Effect,
  type GameState,
  gamesLeft,
  initialState,
  reduce,
} from '../src/game/machine';
import type { ServerMessage } from '../src/protocol/messages';

const PACK = { id: 'te-01', title: 'T', language: 'te-IN', topic: 'x', questions: 10, story: null } as const;

const READY: ServerMessage = { type: 'ready', protocol: 'maata.v1', max_games: 5 };
const GAME_START: ServerMessage = {
  type: 'game_start',
  game_id: 'g1',
  pack: PACK,
  questions: 2,
  time_limit_s: 12,
  max_score: 310,
  hero: 'arjun',
  story: null,
};
const question = (index: number): ServerMessage => ({
  type: 'question',
  index,
  total: 2,
  prompt: `Q${index}?`,
  kind: 'text',
  time_limit_s: 12,
  options: null,
});
const speak = (utterance: number, caption = 'line'): ServerMessage => ({
  type: 'speak_start',
  utterance,
  caption,
  sample_rate: 24000,
});
const result = (over: Partial<Extract<ServerMessage, { type: 'result' }>> = {}): ServerMessage => ({
  type: 'result',
  index: 0,
  skipped: false,
  correct: true,
  timed_out: false,
  heard: 'x',
  answer: 'x',
  explanation: null,
  points: 150,
  score: 150,
  streak: 1,
  ...over,
});
const GAME_OVER: ServerMessage = {
  type: 'game_over',
  game_id: 'g1',
  score: 150,
  correct: 1,
  questions: 2,
  max_score: 310,
  score_token: 'tok',
  hero: 'arjun',
  mode: 'quiz',
  wizard: null,
  adventure: null,
  ending: null,
  duration_ms: null,
};

/** Feeds messages through the machine, collecting every effect. */
function play(messages: ServerMessage[], from: GameState = initialState()) {
  let state = from;
  const effects: Effect[] = [];
  for (const message of messages) {
    const step = reduce(state, { type: 'message', message });
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

const micEffects = (effects: Effect[]) =>
  effects.filter((e): e is Extract<Effect, { type: 'mic' }> => e.type === 'mic').map((e) => e.on);

describe('quiz state machine', () => {
  it('walks question → speak → listen → eos → result → game_over', () => {
    let { state, effects } = play([READY]);
    expect(state.phase).toBe('lobby');
    expect(state.maxGames).toBe(5);

    state = reduce(state, { type: 'start_requested' }).state;
    expect(state.phase).toBe('starting');

    ({ state, effects } = play([GAME_START, speak(1, 'intro')], state));
    expect(state).toMatchObject({ phase: 'speaking', total: 2, maxScore: 310, caption: 'intro' });
    expect(state.questionUtterance).toBeNull(); // the intro is not question audio

    ({ state, effects } = play([question(0), speak(2, 'Q0?')], state));
    expect(state).toMatchObject({ phase: 'speaking', index: 0, prompt: 'Q0?', questionUtterance: 2 });
    expect(effects).toContainEqual({ type: 'voice_start', utterance: 2, sampleRate: 24000 });

    ({ state, effects } = play([{ type: 'listen', index: 0, barge_in: true }], state));
    expect(state.phase).toBe('listening');
    expect(effects).toEqual([
      { type: 'mic', on: true },
      { type: 'timer_start', seconds: 12, after: 2 },
    ]);

    ({ state } = play([{ type: 'eos' }], state));
    expect(state.phase).toBe('checking');

    ({ state, effects } = play([result()], state));
    expect(state).toMatchObject({ phase: 'result', score: 150, streak: 1 });
    expect(effects).toEqual([
      { type: 'mic', on: false },
      { type: 'timer_stop' },
      { type: 'sfx', name: 'correct' },
    ]);

    ({ state, effects } = play([speak(3, 'correct!'), GAME_OVER], state));
    expect(state.phase).toBe('over');
    expect(state.final?.score_token).toBe('tok');
    expect(effects).toContainEqual({ type: 'mic_release' });
  });

  it('streams the mic only between listen and result', () => {
    const { effects } = play([
      READY,
      GAME_START,
      speak(1),
      question(0),
      speak(2),
      { type: 'listen', index: 0, barge_in: true },
      { type: 'heard_nothing' },
      { type: 'eos' },
      result(),
      speak(3),
      question(1),
      speak(4),
      { type: 'listen', index: 1, barge_in: true },
      result({ index: 1, correct: false, timed_out: true, points: 0, streak: 0 }),
    ]);
    expect(micEffects(effects)).toEqual([true, false, true, false]);
  });

  it('copies score and streak from the server and never computes them', () => {
    const { state } = play([
      READY,
      GAME_START,
      question(0),
      { type: 'listen', index: 0, barge_in: true },
      result({ points: 1, score: 9999, streak: 42 }),
    ]);
    expect(state.score).toBe(9999);
    expect(state.streak).toBe(42);
  });

  it('keeps listening after heard_nothing and counts the nudges', () => {
    const { state } = play([
      READY,
      GAME_START,
      question(0),
      speak(2),
      { type: 'listen', index: 0, barge_in: true },
      { type: 'eos' },
      { type: 'heard_nothing' },
      { type: 'eos' },
      { type: 'heard_nothing' },
    ]);
    expect(state.phase).toBe('listening');
    expect(state.heardNothing).toBe(2);
  });

  it('cuts the voice on barge_in and starts a new one on speak_start', () => {
    const { effects } = play([READY, GAME_START, question(0), speak(2), { type: 'barge_in', utterance: 2 }]);
    expect(effects).toContainEqual({ type: 'voice_cut', utterance: 2 });
  });

  it('plays the right sound for wrong and timed-out answers, and none for a skipped round', () => {
    const base = [READY, GAME_START, question(0), { type: 'listen', index: 0, barge_in: true }] as ServerMessage[];
    const sfx = (m: ServerMessage) => play([...base, m]).effects.filter((e) => e.type === 'sfx');
    expect(sfx(result({ correct: false, points: 0 }))).toEqual([{ type: 'sfx', name: 'wrong' }]);
    expect(sfx(result({ correct: false, timed_out: true, points: 0 }))).toEqual([{ type: 'sfx', name: 'timeout' }]);
    expect(sfx(result({ skipped: true, correct: false, points: 0 }))).toEqual([]);
  });

  it('a skipped round keeps the score and still closes the mic', () => {
    const { state, effects } = play([
      READY,
      GAME_START,
      question(0),
      { type: 'listen', index: 0, barge_in: true },
      result({ skipped: true, correct: false, points: 0, score: 0, streak: 0 }),
    ]);
    expect(state.phase).toBe('result');
    expect(state.result?.skipped).toBe(true);
    expect(micEffects(effects)).toEqual([true, false]);
  });

  it('returns to the lobby when a start is refused', () => {
    let { state } = play([READY]);
    state = reduce(state, { type: 'start_requested' }).state;
    ({ state } = play([{ type: 'error', code: 'busy', message: 'Lots of players', fatal: false }], state));
    expect(state.phase).toBe('lobby');
    expect(state.error?.code).toBe('busy');
  });

  it('stops everything when the socket closes mid-question', () => {
    const { state: listening } = play([
      READY,
      GAME_START,
      question(0),
      speak(2),
      { type: 'listen', index: 0, barge_in: true },
    ]);
    const { state, effects } = reduce(listening, { type: 'closed', code: 1006 });
    expect(state).toMatchObject({ phase: 'closed', closeCode: 1006 });
    expect(effects).toEqual([
      { type: 'mic', on: false },
      { type: 'mic_release' },
      { type: 'timer_stop' },
      { type: 'voice_stop' },
    ]);
    // Nothing that arrives afterwards can reopen the mic.
    expect(reduce(state, { type: 'message', message: { type: 'listen', index: 0, barge_in: true } }).effects).toEqual([]);
  });

  it('closes the mic on a fatal error before the socket goes away', () => {
    const { state: listening } = play([READY, GAME_START, question(0), { type: 'listen', index: 0, barge_in: true }]);
    const { state, effects } = play(
      [{ type: 'error', code: 'audio_limit', message: 'limit', fatal: true }],
      listening,
    );
    expect(state.error?.fatal).toBe(true);
    expect(micEffects(effects)).toEqual([false]);
  });

  it('ignores listen and result outside a game', () => {
    const { state, effects } = play([READY, { type: 'listen', index: 0, barge_in: true }, result()]);
    expect(state.phase).toBe('lobby');
    expect(effects).toEqual([]);
  });

  it('counts games against the session limit and resets the HUD for a new game', () => {
    let { state } = play([READY, GAME_START, question(0), { type: 'listen', index: 0, barge_in: true }, result(), GAME_OVER]);
    expect(gamesLeft(state)).toBe(4);
    state = reduce(state, { type: 'start_requested' }).state;
    ({ state } = play([GAME_START], state));
    expect(state).toMatchObject({ phase: 'speaking', score: 0, streak: 0, index: -1, final: null });
    expect(gamesLeft(state)).toBe(3);
  });
});

describe('wizard quest', () => {
  const STORY_START: ServerMessage = {
    type: 'game_start',
    game_id: 'g2',
    pack: { ...PACK, id: 'en-comet-01', language: 'en-IN', story: { wizard: 'Professor Hoot', sprite: 'owl', scene: 'observatory', chapters: 8 } },
    questions: 2,
    time_limit_s: 12,
    max_score: 310,
    hero: 'priya',
    story: { wizard: 'Professor Hoot', sprite: 'owl', scene: 'observatory', chapters: 8 },
  };
  const story = (
    kind: 'intro' | 'chapter' | 'setback' | 'ending',
    mood: 'ask' | 'happy' | 'sad' | 'cheer',
    extra: { chapter?: number; band?: 'great' | 'good' | 'try_again' } = {},
  ): ServerMessage => ({
    type: 'story',
    kind,
    text: `${kind} line`,
    mood,
    chapter: extra.chapter ?? null,
    band: extra.band ?? null,
  });

  it('keeps the hero, wizard and scene the server confirmed', () => {
    const { state } = play([READY, STORY_START]);
    expect(state).toMatchObject({ hero: 'priya', mood: 'ask', chaptersDone: 0, ending: null });
    expect(state.story).toEqual({ wizard: 'Professor Hoot', sprite: 'owl', scene: 'observatory', chapters: 8 });
  });

  it('follows the wizard mood and counts chapters, without touching the phase', () => {
    let { state } = play([READY, STORY_START, story('intro', 'ask')]);
    expect(state.phase).toBe('speaking');
    ({ state } = play([question(0), { type: 'listen', index: 0, barge_in: true }, result()], state));
    ({ state } = play([story('chapter', 'happy', { chapter: 1 })], state));
    expect(state).toMatchObject({ phase: 'result', mood: 'happy', chaptersDone: 1 });
    ({ state } = play([question(1)], state));
    expect(state.mood).toBe('ask'); // every new question resets the pose
    ({ state } = play([story('setback', 'sad')], state));
    expect(state).toMatchObject({ mood: 'sad', chaptersDone: 1 });
    ({ state } = play([story('ending', 'cheer', { band: 'great' })], state));
    expect(state).toMatchObject({ mood: 'cheer', ending: 'great' });
  });

  it('shows the three choices for the current question only', () => {
    const withOptions: ServerMessage = { ...(question(0) as object), options: ['Mars', 'Venus', 'Saturn'] } as ServerMessage;
    let { state } = play([READY, STORY_START, withOptions]);
    expect(state.options).toEqual(['Mars', 'Venus', 'Saturn']);
    ({ state } = play([question(1)], state));
    expect(state.options).toBeNull();
  });

  it('starts every new game from a clean quest', () => {
    let { state } = play([READY, STORY_START, story('chapter', 'happy', { chapter: 3 }), story('ending', 'sad', { band: 'try_again' }), GAME_OVER]);
    ({ state } = play([STORY_START], state));
    expect(state).toMatchObject({ chaptersDone: 0, ending: null, mood: 'ask', options: null });
  });
});
