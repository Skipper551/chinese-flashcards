import { useEffect, useState } from 'preact/hooks';
import { Home } from './screens/Home';
import { Study } from './screens/Study';
import { Decks } from './screens/Decks';
import { Progress } from './screens/Progress';
import { Settings } from './screens/Settings';

export interface ScreenProps {
  /** Whatever follows the route name in the hash, e.g. the deck id in #decks/3. */
  param?: string;
}

const routes = {
  home: { label: 'Home', screen: Home },
  study: { label: 'Study', screen: Study },
  decks: { label: 'Decks', screen: Decks },
  progress: { label: 'Progress', screen: Progress },
  settings: { label: 'Settings', screen: Settings },
} as const;

export type Route = keyof typeof routes;

function currentLocation(): { route: Route; param?: string } {
  const [name, ...rest] = location.hash.slice(1).split('/');
  const route = name in routes ? (name as Route) : 'home';
  return { route, param: rest.join('/') || undefined };
}

export function navigate(route: Route, param?: string | number) {
  location.hash = param === undefined ? route : `${route}/${param}`;
}

export function App() {
  const [{ route, param }, setLocation] = useState(currentLocation);

  useEffect(() => {
    const onHash = () => setLocation(currentLocation());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const Screen = routes[route].screen;

  return (
    <div class={`shell route-${route}`}>
      <main class="screen">
        <Screen key={`${route}/${param ?? ''}`} param={param} />
      </main>
      <nav class="tabbar">
        {(Object.keys(routes) as Route[]).map((name) => (
          <a key={name} href={`#${name}`} class={name === route ? 'active' : ''}>
            {routes[name].label}
          </a>
        ))}
      </nav>
    </div>
  );
}
