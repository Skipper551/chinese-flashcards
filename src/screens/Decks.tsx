import { useState } from 'preact/hooks';
import sampleCsv from '../../samples/hsk1-sample.csv?raw';
import { navigate, type ScreenProps } from '../app';
import { db, deleteCard, deleteDeck, useLive, type Card } from '../db';
import { prefetchHanziData } from '../hanziData';
import { commitImport, parseImport, previewImport, type ImportRow } from '../import';
import { numberedToMarks } from '../pinyin';
import { formatInterval, newFsrsState, State } from '../srs';
import { countStages, stageOf } from '../stats';

export function Decks({ param }: ScreenProps) {
  return param ? <DeckDetail deckId={Number(param)} /> : <DeckList />;
}

function DeckList() {
  const data = useLive(async () => ({ decks: await db.decks.orderBy('name').toArray(), cards: await db.cards.toArray() }));
  const [importing, setImporting] = useState(false);

  if (!data) return null;
  const { decks, cards } = data;
  const hasSample = decks.some((d) => d.name === 'HSK 1 sample');

  async function newDeck() {
    const name = prompt('Name for the new deck:')?.trim();
    if (!name) return;
    if (decks.some((d) => d.name === name)) return alert('There is already a deck with that name.');
    const id = await db.decks.add({ name, createdAt: Date.now() } as never);
    navigate('decks', id as number);
  }

  async function addSample() {
    const rows = await previewImport(parseImport(sampleCsv, 'HSK 1 sample'));
    await commitImport(rows);
    prefetchHanziData(rows.map((r) => r.hanzi));
  }

  return (
    <section>
      <div class="title-row">
        <h1>Decks</h1>
        <div class="row">
          <button onClick={newDeck}>New deck</button>
          <button class="primary" onClick={() => setImporting(!importing)}>
            {importing ? 'Close import' : 'Import'}
          </button>
        </div>
      </div>

      {importing && <ImportPanel onDone={() => setImporting(false)} />}

      {decks.length === 0 && !importing && (
        <div class="card empty">
          <p>No decks yet. Import your vocabulary, or start with a small sample deck of HSK 1 words.</p>
          <button class="primary" onClick={addSample}>
            Add sample deck
          </button>
        </div>
      )}

      <ul class="deck-list">
        {decks.map((deck) => {
          const deckCards = cards.filter((c) => c.deckId === deck.id);
          const stages = countStages(deckCards);
          const due = deckCards.filter((c) => c.fsrs.state !== State.New && c.due <= Date.now()).length;
          return (
            <li key={deck.id} class="card deck-row">
              <a href={`#decks/${deck.id}`} class="deck-name">
                <strong>{deck.name}</strong>
                <span class="muted">
                  {deckCards.length} words · {stages.new} new · {stages.learning} learning · {stages.young + stages.mature} learned
                  {stages.mature ? ` (${stages.mature} mature)` : ''}
                </span>
              </a>
              <button class={due ? 'primary' : ''} disabled={!deckCards.length} onClick={() => navigate('study', deck.id)}>
                {due ? `Study (${due} due)` : 'Study'}
              </button>
            </li>
          );
        })}
      </ul>

      {decks.length > 0 && !hasSample && (
        <p class="muted small">
          <button class="link" onClick={addSample}>
            Add the HSK 1 sample deck
          </button>
        </p>
      )}
    </section>
  );
}

const STATUS_LABEL: Record<ImportRow['status'], string> = {
  new: 'Add',
  duplicate: 'Skip',
  exists: 'Skip',
  error: 'Error',
};

function ImportPanel({ onDone }: { onDone(): void }) {
  const [text, setText] = useState('');
  const [deckName, setDeckName] = useState('Imported');
  const [rows, setRows] = useState<ImportRow[]>();
  const [error, setError] = useState<string>();

  async function readFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    setText(await file.text());
    setDeckName(file.name.replace(/\.[^.]+$/, ''));
    setRows(undefined);
  }

  async function preview() {
    setError(undefined);
    try {
      setRows(await previewImport(parseImport(text, deckName.trim() || 'Imported')));
    } catch (e) {
      setError(`Couldn’t read that: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function save() {
    if (!rows) return;
    await commitImport(rows);
    prefetchHanziData(rows.filter((r) => r.status === 'new').map((r) => r.hanzi));
    onDone();
  }

  const adding = rows?.filter((r) => r.status === 'new').length ?? 0;
  const skipped = rows?.filter((r) => r.status === 'duplicate' || r.status === 'exists').length ?? 0;
  const errors = rows?.filter((r) => r.status === 'error').length ?? 0;

  return (
    <div class="card import-panel">
      <h2>Import vocabulary</h2>
      <p class="muted small">
        CSV or JSON with columns deck, hanzi, pinyin, english, notes (a header row is optional). Choose a file or paste the
        text.
      </p>
      <p class="muted small">
        Have lecture slides or handouts (PDF, Word, PowerPoint)?{' '}
        <a href={`${import.meta.env.BASE_URL}lecture-to-deck.zip`} download>
          Download the lecture-to-deck skill
        </a>{' '}
        and add it to Claude (Customize → Skills → + → Upload a skill). Then give Claude the files and ask for a deck: it
        makes a CSV to import here.
      </p>
      <div class="row">
        <input type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json,text/plain" onChange={readFile} />
      </div>
      <textarea
        rows={6}
        placeholder={'hanzi,pinyin,english\n你好,nǐ hǎo,hello'}
        value={text}
        onInput={(e) => {
          setText(e.currentTarget.value);
          setRows(undefined);
        }}
      />
      <label class="field">
        Deck for rows without one
        <input value={deckName} onInput={(e) => setDeckName(e.currentTarget.value)} />
      </label>
      <div class="row">
        <button disabled={!text.trim()} onClick={preview}>
          Preview
        </button>
        {rows && (
          <button class="primary" disabled={!adding} onClick={save}>
            Import {adding} {adding === 1 ? 'word' : 'words'}
          </button>
        )}
      </div>
      {error && <p class="error">{error}</p>}
      {rows && (
        <>
          <p class="small">
            {adding} to add · {skipped} already there or repeated · {errors} with problems
          </p>
          <div class="table-wrap">
            <table class="preview">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Deck</th>
                  <th>Hanzi</th>
                  <th>Pinyin</th>
                  <th>English</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} class={`status-${r.status}`}>
                    <td>{r.line}</td>
                    <td>{r.deck}</td>
                    <td class="hanzi">{r.hanzi}</td>
                    <td>{r.pinyin}</td>
                    <td>{r.english}</td>
                    <td>
                      <span class="tag">{STATUS_LABEL[r.status]}</span> {r.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function DeckDetail({ deckId }: { deckId: number }) {
  const data = useLive(
    async () => ({ deck: await db.decks.get(deckId), cards: await db.cards.where({ deckId }).sortBy('createdAt') }),
    [deckId],
  );
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  if (!data) return null;
  const { deck, cards } = data;
  if (!deck)
    return (
      <section>
        <p>This deck no longer exists.</p>
        <a href="#decks">Back to decks</a>
      </section>
    );

  async function rename() {
    const name = prompt('Rename deck:', deck!.name)?.trim();
    if (name && name !== deck!.name) await db.decks.update(deckId, { name });
  }

  async function remove() {
    if (!confirm(`Delete “${deck!.name}” and its ${cards.length} words, including their review history?`)) return;
    await deleteDeck(deckId);
    navigate('decks');
  }

  const q = search.trim().toLowerCase();
  const shown = q
    ? cards.filter((c) => c.hanzi.includes(q) || c.pinyin.toLowerCase().includes(q) || c.english.toLowerCase().includes(q))
    : cards;

  return (
    <section>
      <a href="#decks" class="back">
        ‹ Decks
      </a>
      <div class="title-row">
        <h1>{deck.name}</h1>
        <div class="row">
          <button onClick={rename}>Rename</button>
          <button class="danger" onClick={remove}>
            Delete
          </button>
          <button class="primary" disabled={!cards.length} onClick={() => navigate('study', deckId)}>
            Study
          </button>
        </div>
      </div>
      <div class="row">
        <input type="search" placeholder="Search hanzi, pinyin or English" value={search} onInput={(e) => setSearch(e.currentTarget.value)} />
        <button onClick={() => setEditing('new')}>Add word</button>
      </div>
      {editing === 'new' && <CardEditor deckId={deckId} onClose={() => setEditing(null)} />}
      <ul class="card-list">
        {shown.map((card) =>
          editing === card.id ? (
            <li key={card.id}>
              <CardEditor deckId={deckId} card={card} onClose={() => setEditing(null)} />
            </li>
          ) : (
            <li key={card.id} class="card-row" onClick={() => setEditing(card.id)}>
              <span class="hanzi">{card.hanzi}</span>
              <span class="pinyin">{card.pinyin}</span>
              <span class="english">{card.english}</span>
              <span class={`tag stage-${stageOf(card)}`}>
                {stageOf(card)}
                {card.fsrs.state !== State.New && ` · ${card.due <= Date.now() ? 'due' : formatInterval(card.due)}`}
              </span>
            </li>
          ),
        )}
      </ul>
      {cards.length === 0 && <p class="muted">No words yet. Add one, or import a file from the Decks page.</p>}
    </section>
  );
}

function CardEditor({ deckId, card, onClose }: { deckId: number; card?: Card; onClose(): void }) {
  const [hanzi, setHanzi] = useState(card?.hanzi ?? '');
  const [pinyin, setPinyin] = useState(card?.pinyin ?? '');
  const [english, setEnglish] = useState(card?.english ?? '');
  const [notes, setNotes] = useState(card?.notes ?? '');
  const [error, setError] = useState<string>();

  async function save(e: Event) {
    e.preventDefault();
    const [row] = parseImport(JSON.stringify([{ hanzi, pinyin, english, notes }]), 'x');
    if (row.status === 'error') return setError(row.message);
    const fields = { hanzi: row.hanzi, pinyin: numberedToMarks(row.pinyin), english: row.english, notes: row.notes || undefined };
    if (card) await db.cards.update(card.id, fields);
    else {
      const exists = await db.cards.where({ deckId, hanzi: row.hanzi }).count();
      if (exists) return setError('That word is already in this deck.');
      const fsrs = newFsrsState();
      await db.cards.add({ ...fields, deckId, createdAt: Date.now(), due: fsrs.due, fsrs } as never);
      prefetchHanziData([row.hanzi]);
    }
    onClose();
  }

  async function remove() {
    if (card && confirm(`Delete ${card.hanzi} and its review history?`)) {
      await deleteCard(card.id);
      onClose();
    }
  }

  return (
    <form class="card editor" onSubmit={save}>
      <label class="field">
        Hanzi
        <input value={hanzi} onInput={(e) => setHanzi(e.currentTarget.value)} lang="zh-CN" required />
      </label>
      <label class="field">
        Pinyin
        <input value={pinyin} onInput={(e) => setPinyin(e.currentTarget.value)} placeholder="nǐ hǎo or ni3 hao3" />
      </label>
      <label class="field">
        English
        <input value={english} onInput={(e) => setEnglish(e.currentTarget.value)} />
      </label>
      <label class="field">
        Notes
        <input value={notes} onInput={(e) => setNotes(e.currentTarget.value)} />
      </label>
      {error && <p class="error">{error}</p>}
      <div class="row">
        <button type="submit" class="primary">
          Save
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        {card && (
          <button type="button" class="danger" onClick={remove}>
            Delete word
          </button>
        )}
      </div>
    </form>
  );
}
