import { navigate } from '../app';
import { GoalRing } from '../components/charts';
import { db, getSettings, useLive } from '../db';
import { buildQueue, State } from '../srs';
import { countStages, newIntroducedToday, reviewsToday, streak } from '../stats';

export function Home() {
  const data = useLive(async () => ({
    decks: await db.decks.orderBy('name').toArray(),
    cards: await db.cards.toArray(),
    logs: await db.reviewLogs.toArray(),
    settings: await getSettings(),
  }));
  if (!data) return null;

  const { decks, cards, logs, settings } = data;
  const now = Date.now();
  const newLeft = settings.dailyNewLimit - newIntroducedToday(logs, now);
  const queue = buildQueue(cards, newLeft, now);
  const dueReviews = queue.filter((c) => c.fsrs.state !== State.New).length;
  const dueNew = queue.length - dueReviews;
  const today = reviewsToday(logs, now).length;
  const days = streak(logs, now);

  return (
    <section class="home">
      <h1>Today</h1>

      {decks.length === 0 ? (
        <div class="card empty">
          <h2>Welcome!</h2>
          <p>
            Practise writing Chinese characters from memory with your Apple Pencil. Start by adding a deck: import your
            vocabulary list, or try the HSK 1 sample deck.
          </p>
          <button class="primary" onClick={() => navigate('decks')}>
            Add a deck
          </button>
        </div>
      ) : (
        <>
          <div class="today">
            <div class="card stat-tile">
              <span class="label">To study now</span>
              <span class="value">{queue.length}</span>
              <span class="muted small">
                {dueReviews} {dueReviews === 1 ? 'review' : 'reviews'} · {dueNew} new
              </span>
            </div>
            <div class="card stat-tile">
              <span class="label">Streak</span>
              <span class="value">{days}</span>
              <span class="muted small">{days === 1 ? 'day' : 'days'} in a row</span>
            </div>
            <div class="card stat-tile ring-tile">
              <GoalRing done={today} goal={settings.dailyGoal} />
              <span class="muted small">{today >= settings.dailyGoal ? 'Daily goal reached!' : 'Daily goal'}</span>
            </div>
          </div>

          <button class="primary study-button" disabled={queue.length === 0} onClick={() => navigate('study')}>
            {queue.length ? `Study ${queue.length} ${queue.length === 1 ? 'card' : 'cards'}` : 'All caught up for now'}
          </button>

          <h2>Decks</h2>
          <ul class="deck-list">
            {decks.map((deck) => {
              const deckCards = cards.filter((c) => c.deckId === deck.id);
              const stages = countStages(deckCards);
              const due = deckCards.filter((c) => c.fsrs.state !== State.New && c.due <= now).length;
              return (
                <li key={deck.id} class="card deck-row">
                  <a href={`#decks/${deck.id}`} class="deck-name">
                    <strong>{deck.name}</strong>
                    <span class="deck-counts">
                      <span class="count new">{stages.new} new</span>
                      <span class="count learning">{stages.learning} learning</span>
                      <span class="count mature">{stages.mature} mature</span>
                      {stages.young > 0 && <span class="count young">{stages.young} young</span>}
                    </span>
                  </a>
                  <button class={due ? 'primary' : ''} disabled={!deckCards.length} onClick={() => navigate('study', deck.id)}>
                    {due ? `${due} due` : 'Study'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
