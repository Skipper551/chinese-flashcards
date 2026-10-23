import Dexie, { liveQuery, type EntityTable } from 'dexie';
import { useEffect, useState } from 'preact/hooks';
import type { RecognitionTolerance } from './recognize';

export interface Deck {
  id: number;
  name: string;
  createdAt: number;
}

/** ts-fsrs's Card with dates stored as epoch milliseconds, so backups are plain JSON. */
export interface FsrsState {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  /** ts-fsrs State: 0 New, 1 Learning, 2 Review, 3 Relearning. */
  state: number;
  last_review?: number;
}

/** One word. Words with several characters are written one character at a time. */
export interface Card {
  id: number;
  deckId: number;
  hanzi: string;
  pinyin: string;
  english: string;
  notes?: string;
  createdAt: number;
  /** Copy of fsrs.due, indexed. */
  due: number;
  fsrs: FsrsState;
}

export interface ReviewLog {
  id: number;
  cardId: number;
  deckId: number;
  at: number;
  /** ts-fsrs Rating: 1 Again, 2 Hard, 3 Good, 4 Easy. */
  rating: number;
  /** Worst recognizer rank across the word's characters on their last try (null if one wasn't recognized). */
  recognizedRank: number | null;
  /** Whether Sophie changed the automatic grade. */
  overridden: boolean;
  /** The card had never been studied before this review. */
  wasNew: boolean;
  durationMs: number;
}

export interface Settings {
  dailyNewLimit: number;
  /** Reviews per day that fill the goal ring on Home. */
  dailyGoal: number;
  showEnglish: boolean;
  tolerance: RecognitionTolerance;
}

export const defaultSettings: Settings = {
  dailyNewLimit: 10,
  dailyGoal: 20,
  showEnglish: true,
  tolerance: 'normal',
};

export const db = new Dexie('chinese-flashcards') as Dexie & {
  decks: EntityTable<Deck, 'id'>;
  cards: EntityTable<Card, 'id'>;
  reviewLogs: EntityTable<ReviewLog, 'id'>;
  settings: EntityTable<{ key: string; value: Settings }, 'key'>;
};

db.version(1).stores({
  decks: '++id, name',
  cards: '++id, deckId, due, hanzi',
  reviewLogs: '++id, cardId, deckId, at',
  settings: 'key',
});

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('settings');
  return { ...defaultSettings, ...row?.value };
}

export async function saveSettings(changes: Partial<Settings>) {
  await db.settings.put({ key: 'settings', value: { ...(await getSettings()), ...changes } });
}

export async function deleteDeck(deckId: number) {
  await db.transaction('rw', db.decks, db.cards, db.reviewLogs, async () => {
    await db.reviewLogs.where({ deckId }).delete();
    await db.cards.where({ deckId }).delete();
    await db.decks.delete(deckId);
  });
}

export async function deleteCard(cardId: number) {
  await db.transaction('rw', db.cards, db.reviewLogs, async () => {
    await db.reviewLogs.where({ cardId }).delete();
    await db.cards.delete(cardId);
  });
}

/** Re-runs `query` whenever the tables it reads change. Undefined until the first result arrives. */
export function useLive<T>(query: () => Promise<T> | T, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<{ v: T }>();
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (v) => setValue({ v }),
      error: (e) => console.error(e),
    });
    return () => subscription.unsubscribe();
  }, deps);
  return value?.v;
}
