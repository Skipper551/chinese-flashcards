import { useEffect, useState } from 'preact/hooks';
import { Home } from './screens/Home';
import { Study } from './screens/Study';
import { Decks } from './screens/Decks';
import { Progress } from './screens/Progress';
import { Settings } from './screens/Settings';

const routes = {
  home: { label: 'Home', screen: Home },
  study: { label: 'Study', screen: Study },
  decks: { label: 'Decks', screen: Decks },
  progress: { label: 'Progress', screen: Progress },
  settings: { label: 'Settings', screen: Settings },
} as const;

export type Route = keyof typeof routes;

function currentRoute(): Route {
  const name = location.hash.slice(1);
  return name in routes ? (name as Route) : 'home';
}

export function navigate(route: Route) {
  location.hash = route;
}

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const Screen = routes[route].screen;

  return (
    <div class="shell">
      <main class="screen">
        <Screen />
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
