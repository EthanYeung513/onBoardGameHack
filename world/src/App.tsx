import { useEffect, useState } from 'react';
import Title from './components/Title';
import Login from './components/Login';
import CharSelect from './components/CharSelect';
import Game from './components/Game';
import { weatherFor } from './weather';
import { COURSES } from './config';
import { signInHire } from './economy';
import { reportJoin } from './hireSync';

export interface Hire { name: string; email: string; sso?: string }

// dev-only: ?auto=1 skips title/login/char select straight into the town
const AUTO = import.meta.env.DEV && new URLSearchParams(location.search).has('auto');
const DEV_HIRE: Hire = { name: 'Dev', email: 'dev@example.com' };
if (AUTO) signInHire(DEV_HIRE.email, COURSES);

/** Every email is its own hire: its own progress, credits and saves, and its own row on the dashboard. */
function signIn(h: Hire) {
  signInHire(h.email, COURSES);
  reportJoin(h);
}

export default function App() {
  const [screen, setScreen] = useState<'title' | 'login' | 'char' | 'game'>(AUTO ? 'game' : 'title');
  const [hire, setHire] = useState<Hire | null>(AUTO ? DEV_HIRE : null);
  const [charRow, setCharRow] = useState(0);
  // start resolving live weather while the hire is on the title/login screens
  useEffect(() => { void weatherFor(); }, []);

  return (
    <>
      {screen === 'title' && <Title onPlay={() => setScreen('login')} />}
      {screen === 'login' && (
        <Login onDone={h => { signIn(h); setHire(h); setScreen('char'); }} />
      )}
      {screen === 'char' && hire && (
        <CharSelect
          name={hire.name}
          onDone={row => { setCharRow(row); setScreen('game'); }}
        />
      )}
      {screen === 'game' && hire && <Game hire={hire} charRow={charRow} />}
    </>
  );
}
