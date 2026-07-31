import { describe, it, expect } from 'vitest';
import { countWords, countLines } from './stats.ts';

/* ------------------------------------------------------------------ */
/*  Tests — countWords                                                */
/* ------------------------------------------------------------------ */

describe('countWords', () => {
  it('counts simple english words', () => {
    expect(countWords('Hello world')).toBe(2);
  });

  it('attaches english punctuation to words without extra count', () => {
    expect(countWords('Hello, world!')).toBe(2);
  });

  it('counts each han character as one word', () => {
    expect(countWords('你好世界')).toBe(4);
  });

  it('ignores CJK punctuation', () => {
    expect(countWords('你好，世界！')).toBe(4);
  });

  it('mixes han characters and english words', () => {
    expect(countWords('Hello世界')).toBe(3);
  });

  it('mixes han, CJK punctuation and english words', () => {
    expect(countWords('好的，let me check')).toBe(5);
  });

  it('counts numbers as words', () => {
    expect(countWords('123 456')).toBe(2);
  });

  it('counts a url as a single word', () => {
    expect(countWords('Visit https://example.com now')).toBe(3);
  });

  // 文档用例表期望 3，但按口径（/\s+/ 分词）为 `const / x / = / 1;` 共 4 段，
  // 4 与伪代码口径一致（无空格连续串计 1 词），此处遵循口径。
  it('counts code spans by whitespace segments', () => {
    expect(countWords('`const x = 1;`')).toBe(4);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   ')).toBe(0);
  });

  it('counts a bare url as one word', () => {
    expect(countWords('https://example.com')).toBe(1);
  });

  it('treats newlines as whitespace', () => {
    expect(countWords('hello\nworld')).toBe(2);
  });

  it('returns 0 for CJK punctuation only', () => {
    expect(countWords('。！？，')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Tests — countLines                                                */
/* ------------------------------------------------------------------ */

describe('countLines', () => {
  it('returns 0 for empty string', () => {
    expect(countLines('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countLines('   ')).toBe(0);
  });

  it('counts a single line', () => {
    expect(countLines('a')).toBe(1);
  });

  it('counts two lines', () => {
    expect(countLines('a\nb')).toBe(2);
  });

  it('counts blank middle lines as real lines', () => {
    expect(countLines('a\n\nb')).toBe(3);
  });

  it('trims trailing newlines before counting', () => {
    expect(countLines('a\n\n')).toBe(1);
  });

  it('returns 0 for newline-only string', () => {
    expect(countLines('\n')).toBe(0);
  });
});
