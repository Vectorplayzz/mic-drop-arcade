import { describe, expect, it } from 'vitest';
import { parseAudioFrame, UtteranceGate } from '../src/protocol/frames';
import { parseServerMessage } from '../src/protocol/messages';

function frame(utterance: number, flags: number, pcm: number[] = [1, 2, 3, 4]): ArrayBuffer {
  return new Uint8Array([0x41, utterance >> 8, utterance & 0xff, flags, ...pcm]).buffer;
}

describe('parseAudioFrame', () => {
  it('reads the header: magic, big-endian utterance id, last flag', () => {
    const parsed = parseAudioFrame(frame(0x1234, 1));
    expect(parsed).toMatchObject({ utterance: 0x1234, last: true });
    expect([...parsed!.pcm]).toEqual([1, 2, 3, 4]);
    expect(parseAudioFrame(frame(7, 0))?.last).toBe(false);
  });

  it('ignores flag bits it does not know', () => {
    expect(parseAudioFrame(frame(1, 0b1111_1110))?.last).toBe(false);
  });

  it('accepts a header with no audio', () => {
    expect(parseAudioFrame(frame(9, 1, []))?.pcm.length).toBe(0);
  });

  it('rejects short frames and a wrong magic byte', () => {
    expect(parseAudioFrame(new Uint8Array([0x41, 0, 1]).buffer)).toBeNull();
    expect(parseAudioFrame(new Uint8Array([0x42, 0, 1, 0, 9, 9]).buffer)).toBeNull();
  });
});

describe('UtteranceGate', () => {
  it('accepts only the utterance that started last', () => {
    const gate = new UtteranceGate();
    expect(gate.accepts(1)).toBe(false);
    gate.start(1);
    expect(gate.accepts(1)).toBe(true);
    gate.start(2);
    expect(gate.accepts(1)).toBe(false); // late chunks of a superseded line are dropped
    expect(gate.accepts(2)).toBe(true);
  });

  it('drops the rest of an utterance after barge-in', () => {
    const gate = new UtteranceGate();
    gate.start(5);
    expect(gate.cancel(5)).toBe(true);
    expect(gate.accepts(5)).toBe(false);
  });

  it('ignores a barge-in for an utterance that is no longer current', () => {
    const gate = new UtteranceGate();
    gate.start(5);
    gate.start(6);
    expect(gate.cancel(5)).toBe(false);
    expect(gate.accepts(6)).toBe(true);
  });

  it('handles utterance ids wrapping at 16 bits', () => {
    const gate = new UtteranceGate();
    gate.start(0xffff);
    gate.start(0);
    expect(gate.accepts(0xffff)).toBe(false);
    expect(gate.accepts(0)).toBe(true);
  });
});

describe('parseServerMessage', () => {
  const parse = (value: unknown) => parseServerMessage(JSON.stringify(value));

  it('parses every message type in PROTOCOL §3', () => {
    const pack = { id: 'te-01', title: 'T', language: 'te-IN', topic: 'x', questions: 10 };
    const messages = [
      { type: 'ready', protocol: 'maata.v1', max_games: 5 },
      { type: 'game_start', game_id: 'g', pack, questions: 10, time_limit_s: 12, max_score: 1750 },
      { type: 'question', index: 0, total: 10, prompt: 'Q?', kind: 'number', time_limit_s: 12 },
      { type: 'speak_start', utterance: 3, caption: 'Q?', sample_rate: 24000 },
      { type: 'speak_end', utterance: 3, duration_ms: 900, interrupted: false },
      { type: 'listen', index: 0, barge_in: true },
      { type: 'barge_in', utterance: 3 },
      { type: 'eos' },
      { type: 'heard_nothing' },
      {
        type: 'result',
        index: 0,
        correct: true,
        timed_out: false,
        heard: '7',
        answer: 'ఏడు',
        explanation: null,
        points: 140,
        score: 140,
        streak: 1,
      },
      { type: 'game_over', game_id: 'g', score: 140, correct: 1, questions: 10, max_score: 1750, score_token: 't' },
      { type: 'error', code: 'busy', message: 'Try again', fatal: false },
      { type: 'pong', t: 12 },
    ];
    for (const message of messages) {
      expect(parse(message), message.type).toMatchObject({ type: message.type });
    }
  });

  it('parses a skipped round, which carries no verdict', () => {
    expect(parse({ type: 'result', index: 2, skipped: true, score: 300, streak: 2 })).toMatchObject({
      skipped: true,
      correct: false,
      points: 0,
      score: 300,
      streak: 2,
      explanation: null,
    });
  });

  it('rejects malformed input instead of throwing', () => {
    expect(parseServerMessage('not json')).toBeNull();
    expect(parseServerMessage('[]')).toBeNull();
    expect(parseServerMessage('null')).toBeNull();
    expect(parse({ type: 'launch_missiles' })).toBeNull();
    expect(parse({ type: 'question', index: '0', total: 10, prompt: 'Q', kind: 'text', time_limit_s: 12 })).toBeNull();
    expect(parse({ type: 'question', index: 0, total: 10, prompt: 'Q', kind: 'essay', time_limit_s: 12 })).toBeNull();
    expect(parse({ type: 'speak_start', utterance: 70000, caption: '', sample_rate: 24000 })).toBeNull();
    expect(parse({ type: 'speak_start', utterance: 1, caption: '', sample_rate: 1e9 })).toBeNull();
    expect(parse({ type: 'result', index: 0, score: 10, streak: 0 })).toBeNull();
    expect(parse({ type: 'game_over', game_id: 'g', score: -5, correct: 0, questions: 1, max_score: 1, score_token: 't' })).toBeNull();
  });

  it('maps an unknown error code to "internal" and keeps the fatal flag', () => {
    expect(parse({ type: 'error', code: 'new_code', message: 'x', fatal: true })).toMatchObject({
      code: 'internal',
      fatal: true,
    });
  });
});

describe('wizard quest messages', () => {
  const parse = (value: unknown) => parseServerMessage(JSON.stringify(value));
  const pack = { id: 'en-comet-01', title: 'The Comet Clock', language: 'en-IN', topic: 'space', questions: 10, story: true };

  it('reads hero, story and the two new languages from game_start', () => {
    expect(
      parse({
        type: 'game_start',
        game_id: 'g',
        pack,
        questions: 10,
        time_limit_s: 12,
        max_score: 1750,
        character: 'sana',
        story: { wizard: 'Professor Hoot', wizard_sprite: 'owl', scene: 'observatory', chapters: 8 },
      }),
    ).toMatchObject({
      pack: { language: 'en-IN', story: true },
      hero: 'sana',
      story: { wizard: 'Professor Hoot', sprite: 'owl', scene: 'observatory', chapters: 8 },
    });
    expect(parse({ type: 'game_start', game_id: 'g', pack: { ...pack, language: 'te-en' }, questions: 1, time_limit_s: 12, max_score: 1 })).toMatchObject({
      hero: 'arjun',
      story: null,
    });
  });

  it('never trusts asset names from the wire', () => {
    const msg = parse({
      type: 'game_start',
      game_id: 'g',
      pack,
      questions: 1,
      time_limit_s: 12,
      max_score: 1,
      character: '../../etc/passwd',
      story: { wizard: 'W', wizard_sprite: '<img onerror>', scene: 'javascript:alert(1)', chapters: 3 },
    });
    expect(msg).toMatchObject({ hero: 'arjun', story: { sprite: 'sage', scene: 'library-a' } });
  });

  it('parses story lines and question options', () => {
    expect(parse({ type: 'story', kind: 'chapter', text: 'Gear one!', mood: 'happy', chapter: 1 })).toEqual({
      type: 'story',
      kind: 'chapter',
      text: 'Gear one!',
      mood: 'happy',
      chapter: 1,
      band: null,
    });
    expect(parse({ type: 'story', kind: 'ending', text: 'Done', mood: 'cheer', band: 'great' })).toMatchObject({ band: 'great' });
    expect(parse({ type: 'story', kind: 'monologue', text: 'x', mood: 'happy' })).toBeNull();
    expect(parse({ type: 'story', kind: 'intro', text: 'x', mood: 'furious' })).toMatchObject({ mood: 'ask' });

    const q = { type: 'question', index: 0, total: 10, prompt: 'Q?', kind: 'text', time_limit_s: 12 };
    expect(parse({ ...q, options: ['Mars', 'Venus', 'Saturn'] })).toMatchObject({ options: ['Mars', 'Venus', 'Saturn'] });
    expect(parse({ ...q, options: ['only', 'two'] })).toMatchObject({ options: null });
    expect(parse({ ...q, options: [1, 2, 3] })).toMatchObject({ options: null });
  });

  it('carries the hero to game_over and knows unknown_character', () => {
    expect(parse({ type: 'game_over', game_id: 'g', score: 1, correct: 1, questions: 1, max_score: 1, score_token: 't', character: 'priya' })).toMatchObject({ hero: 'priya' });
    expect(parse({ type: 'error', code: 'unknown_character', message: 'x', fatal: false })).toMatchObject({ code: 'unknown_character' });
  });
});
