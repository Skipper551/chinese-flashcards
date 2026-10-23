// Vocabulary import: CSV/TSV or JSON, one row per word with deck, hanzi, pinyin, english, notes.
// Parsing is pure (and tested); `previewImport` checks rows against the database and `commitImport` saves them.

import { db, type Card } from './db';
import { numberedToMarks } from './pinyin';
import { newFsrsState } from './srs';

export interface ImportRow {
  /** Line (CSV) or item (JSON) number in the file, starting at 1. */
  line: number;
  deck: string;
  hanzi: string;
  pinyin: string;
  english: string;
  notes: string;
  status: 'new' | 'duplicate' | 'exists' | 'error';
  message?: string;
}

const FIELDS = ['deck', 'hanzi', 'pinyin', 'english', 'notes'] as const;
type Field = (typeof FIELDS)[number];

// Header names people (or Word tables) commonly use for each column.
const ALIASES: Record<string, Field> = {
  deck: 'deck', lesson: 'deck', '课': 'deck',
  hanzi: 'hanzi', character: 'hanzi', characters: 'hanzi', chinese: 'hanzi', word: 'hanzi', '汉字': 'hanzi', '词语': 'hanzi', '生词': 'hanzi',
  pinyin: 'pinyin', '拼音': 'pinyin',
  english: 'english', meaning: 'english', definition: 'english', translation: 'english', '英文': 'english',
  notes: 'notes', note: 'notes', example: 'notes', '备注': 'notes',
};

// CJK Unified Ideographs plus Extension A, and the compatibility block.
const HANZI = /^[㐀-䶿一-鿿豈-﫿]+$/;

/** Splits CSV/TSV text into rows of cells, handling quotes, escaped quotes, and newlines inside quotes. */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(',') || !firstLine.includes(';') ? ',' : ';';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

type RawRow = { line: number } & Partial<Record<Field, string>>;

function rowsFromDelimited(text: string): RawRow[] {
  const table = parseDelimited(text);
  const header = table[0]?.map((h) => ALIASES[h.trim().toLowerCase()]);
  const hasHeader = header?.includes('hanzi');
  // Without a header the order is deck, hanzi, pinyin, english, notes, unless the deck column was left out
  // (four columns or fewer, starting with the word itself).
  const first = table[0] ?? [];
  const noDeck = !hasHeader && first.length <= 4 && HANZI.test(first[0]?.trim() ?? '');
  const columns: (Field | undefined)[] = hasHeader ? header : noDeck ? FIELDS.slice(1) : [...FIELDS];
  return table
    .map((cells, index) => ({ cells, line: index + 1 }))
    .slice(hasHeader ? 1 : 0)
    .filter(({ cells }) => cells.some((c) => c.trim() !== ''))
    .map(({ cells, line }) => {
      const row: RawRow = { line };
      columns.forEach((field, i) => {
        if (field && cells[i] !== undefined) row[field] = cells[i];
      });
      return row;
    });
}

function rowsFromJson(text: string): RawRow[] {
  const data = JSON.parse(text);
  // Either an array of rows, or { deck, cards: [...] } / an array of those.
  const groups: { deck?: string; cards: unknown[] }[] = Array.isArray(data)
    ? data.some((d) => d && Array.isArray(d.cards))
      ? data
      : [{ cards: data }]
    : [data];
  let line = 0;
  return groups.flatMap((group) =>
    (group.cards ?? []).map((item) => {
      line++;
      const raw = (item ?? {}) as Record<string, unknown>;
      const row: RawRow = { line };
      for (const [key, value] of Object.entries(raw)) {
        const field = ALIASES[key.toLowerCase()];
        if (field && value != null) row[field] = String(value);
      }
      row.deck ??= group.deck;
      return row;
    }),
  );
}

/**
 * Parses an import file into rows, marking bad rows and duplicates within the file.
 * `fallbackDeck` names the deck for rows that don't say (typically the file name).
 */
export function parseImport(text: string, fallbackDeck: string): ImportRow[] {
  const trimmed = text.trim();
  const raw = trimmed.startsWith('[') || trimmed.startsWith('{') ? rowsFromJson(trimmed) : rowsFromDelimited(text);
  const seen = new Set<string>();
  return raw.map((r) => {
    const row: ImportRow = {
      line: r.line,
      deck: r.deck?.trim() || fallbackDeck,
      hanzi: (r.hanzi ?? '').replace(/\s+/g, ''),
      pinyin: numberedToMarks((r.pinyin ?? '').trim().replace(/\s+/g, ' ')),
      english: (r.english ?? '').trim(),
      notes: (r.notes ?? '').trim(),
      status: 'new',
    };
    const key = `${row.deck}\u0000${row.hanzi}`;
    if (!row.hanzi) Object.assign(row, { status: 'error', message: 'No characters' });
    else if (!HANZI.test(row.hanzi)) Object.assign(row, { status: 'error', message: 'Characters column has non-Chinese text' });
    else if (!row.pinyin && !row.english) Object.assign(row, { status: 'error', message: 'Needs pinyin or English' });
    else if (seen.has(key)) Object.assign(row, { status: 'duplicate', message: 'Already earlier in this file' });
    seen.add(key);
    return row;
  });
}

/** Marks rows whose word is already in the deck of the same name. */
export async function previewImport(rows: ImportRow[]): Promise<ImportRow[]> {
  const decks = await db.decks.toArray();
  const existing = new Set<string>();
  for (const deck of decks) {
    const cards = await db.cards.where({ deckId: deck.id }).toArray();
    for (const card of cards) existing.add(`${deck.name}\u0000${card.hanzi}`);
  }
  return rows.map((row) =>
    row.status === 'new' && existing.has(`${row.deck}\u0000${row.hanzi}`)
      ? { ...row, status: 'exists', message: 'Already in this deck' }
      : row,
  );
}

/** Adds the rows marked new, creating decks by name as needed. Returns how many cards were added. */
export async function commitImport(rows: ImportRow[], now = Date.now()): Promise<number> {
  const toAdd = rows.filter((r) => r.status === 'new');
  await db.transaction('rw', db.decks, db.cards, async () => {
    const deckIds = new Map((await db.decks.toArray()).map((d) => [d.name, d.id]));
    for (const [i, row] of toAdd.entries()) {
      let deckId = deckIds.get(row.deck);
      if (deckId === undefined) {
        deckId = (await db.decks.add({ name: row.deck, createdAt: now } as never)) as number;
        deckIds.set(row.deck, deckId);
      }
      const fsrs = newFsrsState(now);
      // createdAt is offset per row so new cards are introduced in file order.
      const card: Omit<Card, 'id'> = {
        deckId,
        hanzi: row.hanzi,
        pinyin: row.pinyin,
        english: row.english,
        notes: row.notes || undefined,
        createdAt: now + i,
        due: fsrs.due,
        fsrs,
      };
      await db.cards.add(card as Card);
    }
  });
  return toAdd.length;
}
