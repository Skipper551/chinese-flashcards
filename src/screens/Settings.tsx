import { useEffect, useState } from 'preact/hooks';
import { restoreBackup, saveBackupFile } from '../backup';
import { db, getSettings, saveSettings, useLive, type Settings as SettingsData } from '../db';
import type { RecognitionTolerance } from '../recognize';

const TOLERANCES: { value: RecognitionTolerance; label: string; description: string }[] = [
  { value: 'strict', label: 'Strict', description: 'Your character must be the recognizer’s first guess.' },
  { value: 'normal', label: 'Normal', description: 'Close to the first guess is fine; look-alikes like 他 for 她 still count as wrong.' },
  { value: 'lenient', label: 'Lenient', description: 'Accepts messier writing, but sometimes lets a similar character pass.' },
];

export function Settings() {
  const settings = useLive(getSettings);
  const counts = useLive(async () => ({ decks: await db.decks.count(), cards: await db.cards.count(), logs: await db.reviewLogs.count() }));
  const [message, setMessage] = useState<string>();
  const [persisted, setPersisted] = useState<boolean>();

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => {});
  }, []);

  if (!settings) return null;
  const update = (changes: Partial<SettingsData>) => saveSettings(changes);

  async function backup() {
    const result = await saveBackupFile();
    if (result !== 'cancelled') setMessage(result === 'shared' ? 'Backup saved.' : 'Backup downloaded.');
  }

  async function restore(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!confirm('Restoring replaces all decks, cards and progress on this iPad with the backup. Continue?')) return;
    try {
      await restoreBackup(JSON.parse(await file.text()));
      setMessage('Backup restored.');
    } catch (err) {
      setMessage(err instanceof SyntaxError ? 'That file isn’t a backup (not valid JSON).' : (err as Error).message);
    }
  }

  return (
    <section class="settings">
      <h1>Settings</h1>

      <div class="card">
        <h2>Studying</h2>
        <div class="setting">
          <span>
            New cards per day
            <small>How many new words to introduce each day.</small>
          </span>
          <NumberStepper value={settings.dailyNewLimit} min={0} max={100} step={5} onChange={(v) => update({ dailyNewLimit: v })} />
        </div>
        <div class="setting">
          <span>
            Daily goal
            <small>Reviews per day that fill the ring on Home.</small>
          </span>
          <NumberStepper value={settings.dailyGoal} min={5} max={300} step={5} onChange={(v) => update({ dailyGoal: v })} />
        </div>
        <label class="setting">
          <span>
            Show English hint
            <small>You can still switch it on or off during a session.</small>
          </span>
          <input type="checkbox" class="switch" checked={settings.showEnglish} onChange={(e) => update({ showEnglish: e.currentTarget.checked })} />
        </label>
      </div>

      <div class="card">
        <h2>Handwriting check</h2>
        <div class="segmented" role="radiogroup">
          {TOLERANCES.map((t) => (
            <button key={t.value} role="radio" aria-checked={settings.tolerance === t.value} onClick={() => update({ tolerance: t.value })}>
              {t.label}
            </button>
          ))}
        </div>
        <p class="muted small">{TOLERANCES.find((t) => t.value === settings.tolerance)?.description}</p>
      </div>

      <div class="card">
        <h2>Backup</h2>
        <p class="muted small">
          Everything is stored on this iPad only
          {counts && ` (${counts.decks} decks, ${counts.cards} words, ${counts.logs} reviews)`}. Save a backup now and then,
          for example to Files or iCloud Drive.
          {persisted === false && ' Safari may clear website data that hasn’t been used for a while, so add the app to your Home Screen and keep a backup.'}
        </p>
        <div class="row">
          <button class="primary" onClick={backup}>
            Save backup
          </button>
          <label class="button">
            Restore from backup…
            <input type="file" accept=".json,application/json" onChange={restore} hidden />
          </label>
        </div>
        {message && <p class="notice">{message}</p>}
      </div>

      <div class="card about">
        <h2>About</h2>
        <p class="muted small">
          Handwriting recognition: HanziLookupJS (GNU GPL v3) with Make Me a Hanzi data (Arphic Public License). Stroke order:
          Hanzi Writer (MIT) and hanzi-writer-data (Arphic Public License). Scheduling: ts-fsrs (MIT). Storage: Dexie
          (Apache 2.0).
        </p>
      </div>
    </section>
  );
}

function NumberStepper({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange(v: number): void }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <span class="stepper">
      <button aria-label="Fewer" disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        −
      </button>
      <span class="stepper-value">{value}</span>
      <button aria-label="More" disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
        +
      </button>
    </span>
  );
}
