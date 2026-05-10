import React, { useEffect, useMemo, useState } from 'react';
import Generator from './pages/Generator.jsx';
import History from './pages/History.jsx';
import Settings from './pages/Settings.jsx';
import Toasts from './components/Toasts.jsx';
import { useStore } from './hooks/useStore.js';

const TABS = [
  { id: 'generator', label: 'Generator' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const { keys, tasks, ready } = useStore();
  const [tab, setTab] = useState('generator');

  // First-launch: if no keys are configured, route the user to Settings.
  useEffect(() => {
    if (ready && keys.length === 0) setTab('settings');
  }, [ready, keys.length]);

  const activeKey = useMemo(
    () => keys.find((k) => k.isActive) || keys[0] || null,
    [keys],
  );

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-white/5 bg-card/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center text-white font-bold">
              M
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">
                Magnific Kling 2.6
              </h1>
              <p className="text-xs text-gray-400 leading-tight">
                Motion Control Generator
              </p>
            </div>
          </div>
          <nav className="flex gap-1 bg-black/40 p-1 rounded-md border border-white/5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 text-sm rounded transition-colors ${
                  tab === t.id
                    ? 'bg-accent text-white'
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="text-xs text-gray-400 min-w-[140px] text-right">
            {activeKey ? (
              <span>
                Active key:{' '}
                <span className="text-accent font-medium">
                  {activeKey.label}
                </span>
              </span>
            ) : (
              <span className="text-amber-400">No API key set</span>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-6">
        {!ready ? (
          <div className="text-gray-400 text-sm">Loading…</div>
        ) : tab === 'generator' ? (
          <Generator
            keys={keys}
            activeKey={activeKey}
            onGoToSettings={() => setTab('settings')}
            onGoToHistory={() => setTab('history')}
          />
        ) : tab === 'history' ? (
          <History tasks={tasks} />
        ) : (
          <Settings keys={keys} />
        )}
      </main>

      <Toasts />
    </div>
  );
}
