import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, restoreBackup, validateBackup } from './backup';
import { db, getSettings, saveSettings } from './db';
import { commitImport, parseImport, previewImport } from './import';
import { Rating, schedule } from './srs';

async function reset() {
  await Promise.all([db.decks.clear(), db.cards.clear(), db.reviewLogs.clear(), db.settings.clear()]);
}

async function seed() {
  await commitImport(parseImport('deck,hanzi,pinyin,english\nL1,你好,nǐ hǎo,hello\nL1,谢谢,xièxie,thanks\nL2,水,shuǐ,water', 'x'));
  const card = (await db.cards.where({ hanzi: '你好' }).first())!;
  const fsrs = schedule(card.fsrs, Rating.Good, Date.now());
  await db.cards.update(card.id, { fsrs, due: fsrs.due });
  await db.reviewLogs.add({
    cardId: card.id,
    deckId: card.deckId,
    at: Date.now(),
    rating: Rating.Good,
    recognizedRank: 1,
    overridden: false,
    wasNew: true,
    durationMs: 4000,
  } as never);
  await saveSettings({ dailyNewLimit: 15, tolerance: 'strict' });
}

describe('import into the database', () => {
  beforeEach(reset);

  it('creates decks by name and skips words already in that deck', async () => {
    expect(await commitImport(await previewImport(parseImport('deck,hanzi,english\nL1,好,good\nL1,人,person', 'x')))).toBe(2);
    const again = await previewImport(parseImport('deck,hanzi,english\nL1,好,good\nL2,好,good\nL1,大,big', 'x'));
    expect(again.map((r) => r.status)).toEqual(['exists', 'new', 'new']);
    await commitImport(again);
    expect((await db.decks.toArray()).map((d) => d.name).sort()).toEqual(['L1', 'L2']);
    expect(await db.cards.count()).toBe(4);
  });

  it('keeps file order for new cards', async () => {
    await commitImport(parseImport('hanzi,english\n三,three\n一,one\n二,two', 'D'));
    const cards = await db.cards.orderBy('id').toArray();
    expect(cards.sort((a, b) => a.createdAt - b.createdAt).map((c) => c.hanzi).join('')).toBe('三一二');
  });
});

describe('backup', () => {
  beforeEach(reset);

  it('round-trips decks, cards, review history and settings through JSON', async () => {
    await seed();
    const before = await createBackup();
    const json = JSON.parse(JSON.stringify(before));

    await reset();
    await commitImport(parseImport('hanzi,english\n错,wrong', 'Other'));
    await restoreBackup(json);

    const after = await createBackup(new Date(before.exportedAt));
    expect(after).toEqual(before);
    expect((await getSettings()).tolerance).toBe('strict');
    expect(await db.cards.where({ hanzi: '错' }).count()).toBe(0);
  });

  it('rejects files that are not backups, and leaves the data alone', async () => {
    await seed();
    const count = await db.cards.count();
    await expect(restoreBackup({ hello: 'world' })).rejects.toThrow('not a Chinese Flashcards backup');
    await expect(restoreBackup(null)).rejects.toThrow();
    expect(await db.cards.count()).toBe(count);
  });

  it('spots damaged or newer backups', async () => {
    await seed();
    const backup = JSON.parse(JSON.stringify(await createBackup()));
    expect(validateBackup(backup)).toBeNull();
    expect(validateBackup({ ...backup, version: 2 })).toMatch(/newer version/);
    expect(validateBackup({ ...backup, cards: undefined })).toMatch(/incomplete/);
    expect(validateBackup({ ...backup, decks: [] })).toMatch(/damaged/);
  });
});
