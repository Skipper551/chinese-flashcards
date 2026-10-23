// Backup and restore of everything in the app's database as one JSON file.

import { db, type Card, type Deck, type ReviewLog, type Settings } from './db';

export interface Backup {
  app: 'chinese-flashcards';
  version: 1;
  exportedAt: string;
  decks: Deck[];
  cards: Card[];
  reviewLogs: ReviewLog[];
  settings?: Settings;
}

export async function createBackup(now = new Date()): Promise<Backup> {
  return db.transaction('r', db.decks, db.cards, db.reviewLogs, db.settings, async () => ({
    app: 'chinese-flashcards' as const,
    version: 1 as const,
    exportedAt: now.toISOString(),
    decks: await db.decks.toArray(),
    cards: await db.cards.toArray(),
    reviewLogs: await db.reviewLogs.toArray(),
    settings: (await db.settings.get('settings'))?.value,
  }));
}

export function backupFileName(now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  return `chinese-flashcards-backup-${date}.json`;
}

/** Checks that `data` looks like a backup from this app; returns a reason if not. */
export function validateBackup(data: unknown): string | null {
  const b = data as Partial<Backup> | null;
  if (!b || typeof b !== 'object' || b.app !== 'chinese-flashcards') return 'This is not a Chinese Flashcards backup file.';
  if (b.version !== 1) return `This backup is from a newer version of the app (format ${String(b.version)}).`;
  if (!Array.isArray(b.decks) || !Array.isArray(b.cards) || !Array.isArray(b.reviewLogs)) return 'The backup file is incomplete.';
  const deckIds = new Set(b.decks.map((d) => d.id));
  const badCard = b.cards.find((c) => !deckIds.has(c.deckId) || typeof c.hanzi !== 'string' || !c.fsrs);
  if (badCard) return `The backup file is damaged (card ${String(badCard.id)}).`;
  return null;
}

/** Replaces everything in the database with the backup's contents. */
export async function restoreBackup(data: unknown): Promise<void> {
  const problem = validateBackup(data);
  if (problem) throw new Error(problem);
  const backup = data as Backup;
  await db.transaction('rw', db.decks, db.cards, db.reviewLogs, db.settings, async () => {
    await Promise.all([db.decks.clear(), db.cards.clear(), db.reviewLogs.clear(), db.settings.clear()]);
    await db.decks.bulkAdd(backup.decks);
    await db.cards.bulkAdd(backup.cards);
    await db.reviewLogs.bulkAdd(backup.reviewLogs);
    if (backup.settings) await db.settings.put({ key: 'settings', value: backup.settings });
  });
}

/**
 * Saves the backup on the iPad. The share sheet ("Save to Files", AirDrop, Mail) is the most natural on iPad;
 * browsers without file sharing get an ordinary download.
 */
export async function saveBackupFile(): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const json = JSON.stringify(await createBackup());
  const name = backupFileName();
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
