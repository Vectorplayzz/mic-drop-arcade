import { describe, expect, it } from 'vitest';
import { type Effect, type GameState, initialState, reduce } from '../src/game/machine';
import { formatTime } from '../src/i18n-adventure';
import { levelFor, recordRun, type Prefs } from '../src/prefs';
import { parseServerMessage, type ServerMessage } from '../src/protocol/messages';

const parse = (m: unknown) => parseServerMessage(JSON.stringify(m));

const ADVENTURE = {
  id: 'monsoon-express',
  genre: 'action',
  title: 'Monsoon Express',
  tagline: 'A runaway train.',
  cover: 'train-station',
  meter: { label: 'Time', icon: 'clock', max: 3 },
  endings: [
    { id: 'hero', rank: 'gold' },
    { id: 'long_night', rank: 'bronze' },
  ],
  scenes: ['train-station', 'train-coach'],
};

function play(messages: unknown[], from: GameState = initialState()) {
  let state: GameState = { ...from, phase: 'starting' };
  const effects: Effect[] = [];
  for (const raw of messages) {
    const message = parse(raw) as ServerMessage;
    expect(message, JSON.stringify(raw)).not.toBeNull();
    const step = reduce(state, { type: 'message', message });
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

describe('adventure protocol', () => {
  it('parses the adventure messages and rejects junk', () => {
    expect(parse({ type: 'adventure_start', game_id: 'g', adventure: ADVENTURE, time_limit_s: 12, character: 'tara', wizard: 'trickster', meter: 3 })).toMatchObject({
      hero: 'tara',
      wizard: 'trickster',
      meter: 3,
      adventure: { id: 'monsoon-express', meter: { icon: 'clock', max: 3 } },
    });
    // Unknown wizard falls back, unknown scene is refused for nodes.
    expect(parse({ type: 'adventure_start', game_id: 'g', adventure: ADVENTURE, time_limit_s: 12, wizard: 'dragon' })).toMatchObject({ wizard: 'sorceress' });
    expect(parse({ type: 'node', id: 'a', scene: 'mars', mood: 'ask', step: 1, kind: 'choice' })).toBeNull();
    expect(parse({ type: 'choices', choices: [{ label: 'only one' }], attempt: 1 })).toBeNull();
    expect(parse({ type: 'ending', id: 'Bad Id', title: 'x', rank: 'gold', score: 1 })).toBeNull();
    expect(parse({ type: 'ending', id: 'hero', title: 'x', rank: 'platinum', score: 1 })).toBeNull();
    // Item ids and labels are sanitised.
    expect(parse({ type: 'state', meter: 2, meter_delta: -1, items: [{ id: 'torch', label: 'Torch' }, { id: '<b>', label: 'x' }], gained: ['torch'] })).toEqual({
      type: 'state',
      meter: 2,
      meter_delta: -1,
      items: [{ id: 'torch', label: 'Torch' }],
      gained: ['torch'],
    });
  });

  it('runs a whole adventure: choices, an unclear try, a riddle, the ending', () => {
    const { state, effects } = play([
      { type: 'adventure_start', game_id: 'g', adventure: ADVENTURE, time_limit_s: 12, choice_time_limit_s: 15, character: 'tara', wizard: 'owl', meter: 3 },
      { type: 'node', id: 't_start', scene: 'train-coach', mood: 'ask', step: 1, kind: 'choice', meter: 3, items: [] },
      { type: 'choices', choices: [{ label: 'Run' }, { label: 'Pull chain' }], attempt: 1, time_limit_s: 15 },
      { type: 'speak_start', utterance: 4, caption: 'What do you do?', sample_rate: 24000 },
      { type: 'listen', index: 1, barge_in: true },
      { type: 'unclear', heard: 'hmm', attempts_left: 2 },
      { type: 'speak_start', utterance: 5, caption: 'Say one, two or three', sample_rate: 24000 },
      { type: 'listen', index: 1, barge_in: true },
      { type: 'chosen', index: 1, heard: 'two', auto: false },
      { type: 'state', meter: 2, meter_delta: -1, items: [{ id: 'walkie', label: 'Walkie' }], gained: ['walkie'] },
      { type: 'node', id: 't_controls', scene: 'train-engine', mood: 'ask', step: 2, kind: 'puzzle', meter: 2, items: [{ id: 'walkie', label: 'Walkie' }] },
      { type: 'puzzle', prompt: 'Bits in a byte?', options: ['8', '4', '16'], kind: 'number', time_limit_s: 12 },
      { type: 'listen', index: 2, barge_in: true },
      { type: 'puzzle_result', correct: true, timed_out: false, skipped: false, heard: 'eight', answer: '8', points: 150, score: 150, streak: 1 },
      { type: 'ending', id: 'hero', title: 'Hero of the Ghats', rank: 'gold', scene: 'train-station', mood: 'cheer', bonus: 500, score: 650, endings: ADVENTURE.endings },
      { type: 'game_over', game_id: 'g', score: 650, correct: 1, questions: 1, max_score: 1200, score_token: 't', mode: 'adventure', adventure: 'monsoon-express', ending: { id: 'hero', title: 'Hero of the Ghats', rank: 'gold' }, duration_ms: 61000, character: 'tara', wizard: 'owl' },
    ]);
    expect(state.phase).toBe('over');
    expect(state.mode).toBe('adventure');
    expect(state.wizard).toBe('owl');
    expect(state.meter).toBe(2);
    expect(state.items.map((i) => i.id)).toEqual(['walkie']);
    expect(state.trail).toEqual([
      { kind: 'choice', index: 1, auto: false },
      { kind: 'puzzle', correct: true },
    ]);
    expect(state.final?.ending?.rank).toBe('gold');
    expect(state.final?.duration_ms).toBe(61000);
    expect(state.endingInfo?.scene).toBe('train-station');
    expect(state.score).toBe(650);
    // The mic opened for each listen and closed after the unclear try and each verdict.
    const mic = effects.filter((e) => e.type === 'mic').map((e) => (e as { on: boolean }).on);
    expect(mic).toEqual([true, false, true, false, true, false, false]);
    expect(effects).toContainEqual({ type: 'sfx', name: 'item' });
    expect(effects).toContainEqual({ type: 'sfx', name: 'correct' });
  });

  it('a routed adventure keeps the score and trail from the prologue', () => {
    const prologue = { ...ADVENTURE, id: 'prologue', genre: 'prologue', meter: null, endings: [] };
    const { state } = play([
      { type: 'adventure_start', game_id: 'g', adventure: prologue, time_limit_s: 12, meter: null },
      { type: 'choices', choices: [{ label: 'Lab' }, { label: 'Fest' }], attempt: 1 },
      { type: 'listen', index: 1, barge_in: true },
      { type: 'chosen', index: 0, heard: 'lab', auto: false },
      { type: 'adventure_start', game_id: 'g', adventure: ADVENTURE, time_limit_s: 12, meter: 3, routed: true },
    ]);
    expect(state.adventure?.id).toBe('monsoon-express');
    expect(state.trail).toHaveLength(1);
    expect(state.gamesStarted).toBe(1);
    expect(state.meter).toBe(3);
  });
});

describe('progress', () => {
  const fresh = (): Prefs => ({
    language: null,
    voiceVolume: 1,
    sfx: true,
    music: true,
    hero: 'arjun',
    wizard: 'sorceress',
    endings: {},
    best: {},
    nickname: '',
    xp: 0,
  });

  it('levels follow 100·n² XP', () => {
    expect(levelFor(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100)).toEqual({ level: 2, into: 0, need: 300 });
    expect(levelFor(450).level).toBe(3);
  });

  it('records endings, bests and XP, with a bonus for a new ending', () => {
    const prefs = fresh();
    const first = recordRun(prefs, 'fest-night', { id: 'together', title: 'Forever', rank: 'gold' }, 800, 90_000);
    expect(first).toEqual({ newBest: true, newEnding: true, xpGained: 80 + 60 + 40, levelUp: true });
    const slower = recordRun(prefs, 'fest-night', { id: 'together', title: 'Forever', rank: 'gold' }, 800, 95_000);
    expect(slower.newBest).toBe(false);
    expect(slower.newEnding).toBe(false);
    const faster = recordRun(prefs, 'fest-night', { id: 'solo', title: 'Solo', rank: 'bronze' }, 800, 60_000);
    expect(faster.newBest).toBe(true);
    expect(Object.keys(prefs.endings['fest-night']!)).toEqual(['together', 'solo']);
  });

  it('formats run times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(61_400)).toBe('1:01');
    expect(formatTime(600_000)).toBe('10:00');
  });
});
