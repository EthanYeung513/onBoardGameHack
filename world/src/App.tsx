import { useState } from 'react';
import Title from './components/Title';
import Login from './components/Login';
import CharSelect from './components/CharSelect';
import Game from './components/Game';

export interface Hire { name: string; email: string; sso?: string }

export default function App() {
  const [screen, setScreen] = useState<'title' | 'login' | 'char' | 'game'>('title');
  const [hire, setHire] = useState<Hire | null>(null);
  const [charRow, setCharRow] = useState(0);

  return (
    <>
      {screen === 'title' && <Title onPlay={() => setScreen('login')} />}
      {screen === 'login' && (
        <Login onDone={h => { setHire(h); setScreen('char'); }} />
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
