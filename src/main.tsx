import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import './styles.css';

registerSW({ immediate: true });

// Ask Safari not to evict IndexedDB (decks and review history) when storage runs low.
navigator.storage?.persist?.().catch(() => {});

render(<App />, document.getElementById('app')!);
