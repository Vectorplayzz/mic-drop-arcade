import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cleanText,
  type DraftPack,
  emptyDraft,
  parseDraft,
  serializePack,
  slugify,
  validatePack,
} from '../src/creator/pack';
import { nicknameProblem } from '../src/net/api';
import { wrapLines } from '../src/share/card';

function validDraft(): DraftPack {
  return {
    id: 'te-solar-01',
    title: 'సౌర కుటుంబం',
    language: 'te-IN',
    topic: 'space',
    version: 1,
    questions: Array.from({ length: 5 }, (_, i) => ({
      id: `q${i + 1}`,
      prompt: `ప్రశ్న ${i + 1}?`,
      answers: ['సూర్యుడు', 'sun'],
      display_answer: 'సూర్యుడు',
      kind: 'text' as const,
      explanation: '',
    })),
  };
}

const paths = (draft: DraftPack) => validatePack(draft).map((issue) => issue.path);

describe('pack validation (mirrors server/app/game/packs.py)', () => {
  it('accepts a well-formed pack', () => {
    expect(validatePack(validDraft())).toEqual([]);
  });

  it('flags every empty field of a new draft', () => {
    const found = paths(emptyDraft('hi-IN'));
    expect(found).toContain('id');
    expect(found).toContain('title');
    expect(found).toContain('topic');
    expect(found).toContain('questions.0.prompt');
    expect(found).toContain('questions.4.answers');
    expect(found).toContain('questions.4.display_answer');
  });

  it('enforces the id, question-count and length rules', () => {
    const draft = validDraft();
    draft.id = 'Bad Id';
    draft.title = 'x'.repeat(61);
    draft.questions = draft.questions.slice(0, 4);
    draft.questions[0]!.prompt = 'x'.repeat(301);
    draft.questions[1]!.answers = Array.from({ length: 11 }, (_, i) => `a${i}`);
    draft.questions[2]!.answers = ['x'.repeat(81)];
    draft.questions[3]!.explanation = 'x'.repeat(201);
    expect(paths(draft)).toEqual([
      'id',
      'title',
      'questions',
      'questions.0.prompt',
      'questions.1.answers',
      'questions.2.answers',
      'questions.3.explanation',
    ]);
  });

  it('requires unique question ids', () => {
    const draft = validDraft();
    draft.questions[1]!.id = 'q1';
    expect(paths(draft)).toEqual(['questions.1.id']);
  });

  it('requires digits for number questions, as the server does', () => {
    const draft = validDraft();
    draft.questions[0] = { ...draft.questions[0]!, kind: 'number', answers: ['seven'] };
    expect(paths(draft)).toEqual(['questions.0.answers']);
    draft.questions[0]!.answers = ['7', '7.0', '-3', '1,000'];
    expect(validatePack(draft)).toEqual([]);
  });

  it('counts characters, not UTF-16 units, like the server', () => {
    const draft = validDraft();
    draft.title = '😀'.repeat(60);
    expect(validatePack(draft)).toEqual([]);
  });

  it('strips control and bidi-override characters and collapses whitespace', () => {
    expect(cleanText('  ab‮c\u0007  d\n\te  ')).toBe('abc d e');
  });
});

describe('pack files', () => {
  it('serialises in the server schema, as an unreviewed creator pack', () => {
    const draft = validDraft();
    draft.questions[0] = { ...draft.questions[0]!, kind: 'number', answers: [' 8 ', ''], explanation: ' ok ' };
    const pack = JSON.parse(serializePack(draft));
    expect(pack).toMatchObject({ schema: 1, id: 'te-solar-01', source: 'creator', version: 1 });
    expect(pack).not.toHaveProperty('reviewed_by');
    expect(pack).not.toHaveProperty('reviewed_at');
    expect(pack.questions[0]).toEqual({
      id: 'q1',
      prompt: 'ప్రశ్న 1?',
      answers: ['8'],
      display_answer: 'సూర్యుడు',
      kind: 'number',
      explanation: 'ok',
    });
    expect(pack.questions[1]).not.toHaveProperty('kind');
    expect(pack.questions[1]).not.toHaveProperty('explanation');
  });

  it('round-trips through a file', () => {
    const draft = validDraft();
    expect(parseDraft(serializePack(draft))).toEqual(draft);
  });

  it("opens the server's own fixture pack and finds it valid", () => {
    const fixture = readFileSync(
      new URL('../../server/tests/fixtures/packs/hi-test-01.json', import.meta.url),
      'utf8',
    );
    const draft = parseDraft(fixture);
    expect(draft.questions).toHaveLength(5);
    expect(draft.questions[1]).toMatchObject({ kind: 'number', answers: ['7'] });
    expect(validatePack(draft)).toEqual([]);
  });

  it('rejects files that are not packs', () => {
    expect(() => parseDraft('[]')).toThrow();
    expect(() => parseDraft('{"language":"xx-XX","questions":[]}')).toThrow();
    expect(() => parseDraft('{nope')).toThrow();
    expect(() => parseDraft(`{"pad":"${'x'.repeat(300_000)}"}`)).toThrow('too large');
  });

  it('suggests an id from the title', () => {
    expect(slugify('te-IN', 'Solar System!')).toBe('te-solar-system');
    expect(slugify('hi-en', 'सामान्य ज्ञान')).toBe('hi-pack');
    expect(slugify('hi-IN', 'x'.repeat(80)).length).toBeLessThanOrEqual(48);
  });
});

describe('nicknameProblem (mirrors PROTOCOL §7)', () => {
  it.each(['Vector', 'వెక్టర్', 'राहुल_07', 'Ali Khan'])('accepts %s', (nick) => {
    expect(nicknameProblem(nick)).toBeNull();
  });

  it('explains what is wrong', () => {
    expect(nicknameProblem('ab')).toBe('length');
    expect(nicknameProblem('x'.repeat(17))).toBe('length');
    expect(nicknameProblem('<script>')).toBe('characters');
    expect(nicknameProblem('hi@x.com')).toBe('characters');
    expect(nicknameProblem('1234')).toBe('letter');
  });
});

describe('wrapLines', () => {
  const measure = (text: string) => text.length;

  it('breaks on spaces to fit the width', () => {
    expect(wrapLines(measure, 'I scored 8/10 in Telugu, beat me', 12)).toEqual([
      'I scored',
      '8/10 in',
      'Telugu, beat',
      'me',
    ]);
  });

  it('keeps an over-long word on its own line', () => {
    expect(wrapLines(measure, 'a supercalifragilistic b', 5)).toEqual(['a', 'supercalifragilistic', 'b']);
  });

  it('returns nothing for blank text', () => {
    expect(wrapLines(measure, '   ', 10)).toEqual([]);
  });
});
