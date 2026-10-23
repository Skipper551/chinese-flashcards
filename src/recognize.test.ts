import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { judge, normalizeStrokes, Recognizer, type Candidate, type HanziLookupLib, type Stroke } from './recognize';
import { distort, handwritingLike, sampleMedians, seededRandom } from './testing/handwriting';

const vendor = new URL('../public/vendor/hanzilookup/', import.meta.url);
const chars = Object.keys(sampleMedians);

let recognizer: Recognizer;

beforeAll(() => {
  // The vendored file is a classic browser script that defines a global. Running it through Function (rather than
  // node:vm, which makes matching ~50x slower) returns that global without leaking it.
  const source = readFileSync(new URL('hanzilookup.min.js', vendor), 'utf8');
  const lib = new Function(`${source}; return HanziLookup;`)() as HanziLookupLib;
  const data = JSON.parse(readFileSync(new URL('mmah.json', vendor), 'utf8'));
  recognizer = new Recognizer(lib, data);
});

describe('normalizeStrokes', () => {
  it('fits strokes into the 256px box and keeps proportions', () => {
    const wide: Stroke[] = [[[1000, 500], [2000, 500]], [[1000, 600], [2000, 600]]];
    const [a, b] = normalizeStrokes(wide);
    expect(a[0][0]).toBeCloseTo(28);
    expect(a[a.length - 1][0]).toBeCloseTo(228);
    // 100px apart in a 1000px-wide drawing is 20px in a 200px-wide box, centered vertically on 128.
    expect(b[0][1] - a[0][1]).toBeCloseTo(20);
    expect((a[0][1] + b[0][1]) / 2).toBeCloseTo(128);
  });

  it('simplifies dense points to the corners of the stroke', () => {
    // An L shape drawn as 2001 dense points with a slight wobble.
    const dense: Stroke[] = [
      Array.from({ length: 2001 }, (_, i): [number, number] =>
        i <= 1000 ? [i / 10 + Math.sin(i) * 0.1, 0] : [100, (i - 1000) / 10 + Math.sin(i) * 0.1],
      ),
    ];
    const [stroke] = normalizeStrokes(dense);
    expect(stroke).toHaveLength(3);
    expect(stroke[1][0]).toBeCloseTo(228, 0);
    expect(stroke[2][1]).toBeCloseTo(228, 0);
  });

  it('keeps a single tap as a two-point stroke and drops empty strokes', () => {
    const strokes = normalizeStrokes([[[10, 10], [90, 90]], [], [[50, 20]]]);
    expect(strokes).toHaveLength(2);
    expect(strokes[1]).toHaveLength(2);
  });

  it('returns nothing for no strokes', () => {
    expect(normalizeStrokes([])).toEqual([]);
  });
});

describe('Recognizer', () => {
  it('returns no candidates for an empty drawing', () => {
    expect(recognizer.recognize([])).toEqual([]);
    expect(recognizer.check([], '我').correct).toBe(false);
  });

  it('copes with a very wobbly scribble instead of overflowing the matcher', () => {
    const random = seededRandom(1);
    const scribble: Stroke[] = Array.from({ length: 12 }, () =>
      Array.from({ length: 400 }, (_, i): [number, number] => [i + random() * 30, random() * 300]),
    );
    expect(() => recognizer.recognize(scribble)).not.toThrow();
  });

  it('accepts every sample character drawn from its exact stroke medians', () => {
    const misses = chars.filter((c) => !recognizer.check(sampleMedians[c], c).correct);
    expect(misses).toEqual([]);
  });

  it('gives the same answer whatever size and position the character was drawn at', () => {
    for (const c of chars) {
      const big = sampleMedians[c].map((s) => s.map(([x, y]): [number, number] => [x * 4 + 300, y * 4 + 50]));
      expect(recognizer.recognize(big, 1)[0]?.char, c).toBe(recognizer.recognize(sampleMedians[c], 1)[0]?.char);
    }
  });

  describe('with handwriting-like strokes', () => {
    // Four distorted drawings of each sample character, the same every run, each recognized once up front.
    let drawings: { char: string; candidates: Candidate[] }[];

    beforeAll(() => {
      const random = seededRandom(20261024);
      drawings = chars.flatMap((char) =>
        Array.from({ length: 4 }, () => ({
          char,
          candidates: recognizer.recognize(distort(sampleMedians[char], handwritingLike, random), 8),
        })),
      );
    }, 60_000);

    it('accepts at least 95% of them as the right character', () => {
      const misses = drawings.filter((d) => !judge(d.candidates, d.char, 'normal').correct).map((d) => d.char);
      console.log(`accepted ${drawings.length - misses.length}/${drawings.length}; missed ${misses.join(' ') || 'none'}`);
      expect(misses.length / drawings.length).toBeLessThanOrEqual(0.05);
    });

    it('rarely accepts them as a different sample character', () => {
      const falseAccepts = drawings.flatMap((d) =>
        chars
          .filter((other) => other !== d.char && judge(d.candidates, other, 'normal').correct)
          .map((other) => `${d.char}→${other}`),
      );
      console.log(`false accepts ${falseAccepts.length}/${drawings.length}: ${falseAccepts.join(' ') || 'none'}`);
      expect(falseAccepts.length / drawings.length).toBeLessThanOrEqual(0.03);
    });

    it('tells apart look-alikes that plain top-5 matching would accept', () => {
      for (const [written, target] of [['他', '她'], ['二', '三'], ['么', '什'], ['什', '么']]) {
        for (const d of drawings.filter((d) => d.char === written)) {
          expect(judge(d.candidates, target, 'normal').correct, `${written} written, ${target} expected`).toBe(false);
        }
      }
    });

    it('is stricter at "strict" and more forgiving at "lenient"', () => {
      const accepted = (tolerance: 'strict' | 'normal' | 'lenient') =>
        drawings.filter((d) => judge(d.candidates, d.char, tolerance).correct).length;
      expect(accepted('strict')).toBeLessThan(accepted('normal'));
      expect(accepted('normal')).toBeLessThanOrEqual(accepted('lenient'));
    });
  });
});
