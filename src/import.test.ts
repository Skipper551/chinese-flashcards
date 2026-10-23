import { describe, expect, it } from 'vitest';
import { parseDelimited, parseImport } from './import';
import { numberedToMarks } from './pinyin';

describe('numberedToMarks', () => {
  it.each([
    ['ni3 hao3', 'nǐ hǎo'],
    ['Zhong1guo2', 'Zhōngguó'],
    ['xue2sheng5', 'xuésheng'],
    ['lv4', 'lǜ'],
    ['nu:3', 'nǚ'],
    ['gou3', 'gǒu'],
    ['liu2', 'liú'],
    ['gui4', 'guì'],
    ['er4', 'èr'],
    ['Ai4', 'Ài'],
    ['nǐ hǎo', 'nǐ hǎo'],
  ])('%s → %s', (input, expected) => {
    expect(numberedToMarks(input)).toBe(expected);
  });
});

describe('parseDelimited', () => {
  it('handles quotes, escaped quotes, commas and newlines inside quotes, CRLF and a BOM', () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n';
    expect(parseDelimited(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'two\nlines'],
    ]);
  });

  it('detects tab-separated text', () => {
    expect(parseDelimited('你好\tnǐ hǎo\thello, hi')).toEqual([['你好', 'nǐ hǎo', 'hello, hi']]);
  });
});

describe('parseImport', () => {
  it('reads CSV with a header in any column order', () => {
    const rows = parseImport('english,hanzi,pinyin,deck\nhello,你好,ni3 hao3,Lesson 1', 'Fallback');
    expect(rows).toEqual([
      { line: 2, deck: 'Lesson 1', hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello', notes: '', status: 'new' },
    ]);
  });

  it('recognises header aliases', () => {
    const [row] = parseImport('Character,拼音,Meaning\n谢谢,xièxie,thank you', 'Fallback');
    expect(row).toMatchObject({ hanzi: '谢谢', pinyin: 'xièxie', english: 'thank you', deck: 'Fallback' });
  });

  it('uses deck, hanzi, pinyin, english, notes without a header', () => {
    const [row] = parseImport('Lesson 2,朋友,péngyou,friend,a note', 'Fallback');
    expect(row).toMatchObject({ deck: 'Lesson 2', hanzi: '朋友', english: 'friend', notes: 'a note' });
  });

  it('drops the deck column when headerless rows start with the word', () => {
    const [row] = parseImport('朋友,péngyou,friend', 'Fallback');
    expect(row).toMatchObject({ deck: 'Fallback', hanzi: '朋友', pinyin: 'péngyou', english: 'friend' });
  });

  it('skips blank lines and strips spaces inside the word', () => {
    const rows = parseImport('hanzi,english\n\n你 好,hello\n  \n', 'D');
    expect(rows).toHaveLength(1);
    expect(rows[0].hanzi).toBe('你好');
  });

  it('marks bad rows and duplicates within the file', () => {
    const rows = parseImport(
      ['hanzi,pinyin,english', ',nǐ,you', 'hello,,hi', '你,,', '好,hǎo,good', '好,hǎo,good again'].join('\n'),
      'D',
    );
    expect(rows.map((r) => [r.status, r.message])).toEqual([
      ['error', 'No characters'],
      ['error', 'Characters column has non-Chinese text'],
      ['error', 'Needs pinyin or English'],
      ['new', undefined],
      ['duplicate', 'Already earlier in this file'],
    ]);
  });

  it('treats the same word in different decks as different cards', () => {
    const rows = parseImport('deck,hanzi,english\nA,好,good\nB,好,good', 'D');
    expect(rows.map((r) => r.status)).toEqual(['new', 'new']);
  });

  it('reads a JSON array of rows', () => {
    const rows = parseImport('[{"hanzi":"水","pinyin":"shui3","english":"water"},{"Chinese":"书","meaning":"book"}]', 'D');
    expect(rows).toMatchObject([
      { line: 1, deck: 'D', hanzi: '水', pinyin: 'shuǐ', english: 'water', status: 'new' },
      { line: 2, deck: 'D', hanzi: '书', english: 'book', status: 'new' },
    ]);
  });

  it('reads JSON decks with cards', () => {
    const rows = parseImport(
      JSON.stringify([
        { deck: 'L1', cards: [{ hanzi: '一', english: 'one' }] },
        { deck: 'L2', cards: [{ hanzi: '二', english: 'two', deck: 'Override' }] },
      ]),
      'D',
    );
    expect(rows.map((r) => [r.deck, r.hanzi])).toEqual([
      ['L1', '一'],
      ['Override', '二'],
    ]);
  });

  it('throws on broken JSON so the preview can say so', () => {
    expect(() => parseImport('[{"hanzi": ', 'D')).toThrow();
  });

  it('parses the bundled sample deck without problems', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../samples/hsk1-sample.csv', import.meta.url), 'utf8');
    const rows = parseImport(text, 'x');
    expect(rows.length).toBeGreaterThan(25);
    expect(rows.filter((r) => r.status !== 'new')).toEqual([]);
    expect(rows.find((r) => r.hanzi === '他')?.notes).toBe('Person radical 亻: 他 is "he"');
  });
});
