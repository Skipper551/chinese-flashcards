// Handwriting recognition via HanziLookupJS (vendored in public/vendor/hanzilookup, see README there).
// The library is a classic script that defines a global `HanziLookup`; we load it at runtime and fetch its
// Make Me a Hanzi data (mmah.json) ourselves instead of using its XHR-based init.

export type Point = [number, number];
export type Stroke = Point[];

export interface Candidate {
  char: string;
  score: number;
}

// The parts of the HanziLookup global we use.
export interface HanziLookupLib {
  data: Record<string, unknown>;
  decodeCompact(base64: string): Uint8Array;
  AnalyzedCharacter: new (strokes: Stroke[]) => { subStrokeCount: number };
  Matcher: new (dataName: string, looseness?: number) => {
    match(analyzed: unknown, limit: number, ready: (matches: { character: string; score: number }[]) => void): void;
  };
}

export interface MmahData {
  chars: unknown[];
  substrokes: string;
}

// HanziLookup splits strokes into substrokes using fixed pixel thresholds tuned for a 256px drawing box,
// so strokes are scaled to fit that box before matching, whatever size the canvas is.
const BOX = 256;
const MARGIN = 28;
// Pencil samples at up to 240 Hz and hands wobble, and every wobble becomes a substroke, so strokes are simplified
// first. A light pass keeps small hooks that some characters need (大), a stronger one irons out shaky lines; we
// match with both and keep each candidate's better score.
const SIMPLIFY_PASSES = [2, 4];
// HanziLookup's score matrix only holds 64 substrokes. A drawing busier than that is simplified harder, up to a point.
const MAX_SUBSTROKES = 64;
const MAX_SIMPLIFY_TOLERANCE = 32;

/**
 * How forgiving the check is. The target must be among the top `topN` candidates and score within `margin`
 * (a fraction) of the best one. The margin is what stops look-alikes passing: writing 他 puts 她 in the top 5,
 * but well behind 他. Tuned in src/recognize.test.ts with distorted Make Me a Hanzi strokes.
 */
export const RECOGNITION_TOLERANCES = {
  strict: { topN: 1, margin: 0 },
  normal: { topN: 5, margin: 0.1 },
  lenient: { topN: 5, margin: 0.2 },
} as const;

export type RecognitionTolerance = keyof typeof RECOGNITION_TOLERANCES;

export interface CheckResult {
  correct: boolean;
  /** 1-based position of the target among the candidates, or null if it wasn't among them. */
  rank: number | null;
  candidates: Candidate[];
}

/** Scales strokes to fit the 256px box (keeping proportions) and simplifies them within `tolerance` box pixels. */
export function normalizeStrokes(strokes: Stroke[], tolerance = SIMPLIFY_PASSES[0]): Stroke[] {
  const points = strokes.flat();
  if (points.length === 0) return [];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  const side = Math.max(width, height, 1);
  const scale = (BOX - 2 * MARGIN) / side;
  // Center the shorter dimension so a wide or tall character keeps its proportions.
  const offsetX = MARGIN + (side - width) * scale / 2;
  const offsetY = MARGIN + (side - height) * scale / 2;

  return strokes
    .filter((stroke) => stroke.length > 0)
    .map((stroke) => {
      const scaled = stroke.map(([x, y]): Point => [offsetX + (x - left) * scale, offsetY + (y - top) * scale]);
      // A single tap still needs two points to count as a stroke (a dot).
      return scaled.length === 1 ? [scaled[0], scaled[0]] : simplify(scaled, tolerance);
    });
}

/** Ramer–Douglas–Peucker: drops points within `tolerance` of the line between the points kept around them. */
function simplify(points: Stroke, tolerance: number): Stroke {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const length = Math.hypot(bx - ax, by - ay);
    let farthest = -1;
    let maxDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const distance =
        length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Enough candidates for the most lenient setting and for showing "it looked like…" alternatives.
const CANDIDATE_COUNT = 8;

/** Applies a tolerance to candidates from `Recognizer.recognize` (best first). */
export function judge(candidates: Candidate[], target: string, tolerance: RecognitionTolerance): CheckResult {
  const { topN, margin } = RECOGNITION_TOLERANCES[tolerance];
  const index = candidates.findIndex((c) => c.char === target);
  const rank = index === -1 ? null : index + 1;
  const best = candidates[0]?.score ?? 0;
  const correct = rank !== null && rank <= topN && candidates[index].score >= best - margin * Math.abs(best);
  return { correct, rank, candidates };
}

export class Recognizer {
  private readonly matcher: InstanceType<HanziLookupLib['Matcher']>;

  constructor(private readonly lib: HanziLookupLib, data: MmahData) {
    if (!lib.data.mmah) {
      lib.data.mmah = { chars: data.chars, substrokes: lib.decodeCompact(data.substrokes) };
    }
    this.matcher = new lib.Matcher('mmah');
  }

  /** Best candidates first. Strokes are in any coordinate system with y pointing down. */
  recognize(strokes: Stroke[], limit = 8): Candidate[] {
    const best = new Map<string, number>();
    for (const pass of SIMPLIFY_PASSES) {
      for (const match of this.matchOnce(strokes, pass, limit)) {
        best.set(match.char, Math.max(best.get(match.char) ?? -Infinity, match.score));
      }
    }
    return [...best]
      .map(([char, score]) => ({ char, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Whether `strokes` are an acceptable drawing of `target`. */
  check(strokes: Stroke[], target: string, tolerance: RecognitionTolerance = 'normal'): CheckResult {
    return judge(this.recognize(strokes, CANDIDATE_COUNT), target, tolerance);
  }

  private matchOnce(strokes: Stroke[], tolerance: number, limit: number): Candidate[] {
    let analyzed: { subStrokeCount: number } | undefined;
    for (let t = tolerance; t <= MAX_SIMPLIFY_TOLERANCE; t *= 2) {
      const normalized = normalizeStrokes(strokes, t);
      if (normalized.length === 0) return [];
      analyzed = new this.lib.AnalyzedCharacter(normalized);
      if (analyzed.subStrokeCount <= MAX_SUBSTROKES) break;
    }
    // Still too busy to be a character (a scribble): nothing matches.
    if (!analyzed || analyzed.subStrokeCount > MAX_SUBSTROKES) return [];
    let result: Candidate[] = [];
    // Matching is synchronous despite the callback API.
    this.matcher.match(analyzed, limit, (matches) => {
      result = matches.map((m) => ({ char: m.character, score: m.score }));
    });
    return result;
  }
}

let loading: Promise<Recognizer> | undefined;

/** Loads the library and data once (about 830 KB, cached offline by the service worker). */
export function loadRecognizer(): Promise<Recognizer> {
  loading ??= (async () => {
    const base = `${import.meta.env.BASE_URL}vendor/hanzilookup/`;
    const [lib, data] = await Promise.all([loadScript(`${base}hanzilookup.min.js`), fetchJson(`${base}mmah.json`)]);
    return new Recognizer(lib, data);
  })();
  loading.catch(() => (loading = undefined));
  return loading;
}

function loadScript(src: string): Promise<HanziLookupLib> {
  return new Promise((resolve, reject) => {
    const existing = (window as unknown as { HanziLookup?: HanziLookupLib }).HanziLookup;
    if (existing) return resolve(existing);
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve((window as unknown as { HanziLookup: HanziLookupLib }).HanziLookup);
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
}

async function fetchJson(url: string): Promise<MmahData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.json();
}
