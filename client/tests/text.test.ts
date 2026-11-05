import { describe, expect, it } from 'vitest';
import { nicknameProblem } from '../src/net/api';
import { wrapLines } from '../src/share/card';

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
