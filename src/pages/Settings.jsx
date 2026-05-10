import React, { useState } from 'react';

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function maskKey(value) {
  if (!value) return '—';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export default function Settings({ keys }) {
  const [adding, setAdding] = useState(keys.length === 0);
  const [newLabel, setNewLabel] = useState(`Key ${keys.length + 1}`);
  const [newValue, setNewValue] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [error, setError] = useState(null);

  const persist = async (next) => {
    await window.api.store.set('keys', next);
  };

  const setActive = async (id) => {
    const next = keys.map((k) => ({ ...k, isActive: k.id === id }));
    await persist(next);
  };

  const addKey = async () => {
    setError(null);
    if (!newValue.trim()) {
      setError('Key value is required');
      return;
    }
    const label = newLabel.trim() || `Key ${keys.length + 1}`;
    const newKey = {
      id: uuid(),
      label,
      value: newValue.trim(),
      isActive: keys.length === 0, // first key becomes active
    };
    const next = [...keys, newKey];
    await persist(next);
    setAdding(false);
    setNewLabel(`Key ${next.length + 1}`);
    setNewValue('');
  };

  const deleteKey = async (id) => {
    if (keys.length <= 1) return;
    let next = keys.filter((k) => k.id !== id);
    if (!next.some((k) => k.isActive) && next.length > 0) {
      next = next.map((k, i) => ({ ...k, isActive: i === 0 }));
    }
    await persist(next);
  };

  const startEditLabel = (k) => {
    setEditingId(k.id);
    setEditLabel(k.label);
  };

  const saveLabel = async () => {
    const next = keys.map((k) =>
      k.id === editingId ? { ...k, label: editLabel.trim() || k.label } : k,
    );
    await persist(next);
    setEditingId(null);
    setEditLabel('');
  };

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">API Keys</h2>
            <p className="text-sm text-gray-400 mt-1">
              The active key is used for all Magnific API calls. If a request is
              rejected for credit reasons, the next saved key is tried
              automatically.
            </p>
          </div>
          <button
            className="btn-primary"
            onClick={() => {
              setAdding(true);
              setNewLabel(`Key ${keys.length + 1}`);
              setNewValue('');
              setError(null);
            }}
          >
            Add Key
          </button>
        </div>

        {adding && (
          <div className="mt-5 border border-white/10 rounded-md p-4 bg-black/30 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="label">Label</label>
                <input
                  className="input"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Production key"
                />
              </div>
              <div className="md:col-span-2">
                <label className="label">API key</label>
                <input
                  className="input font-mono"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="mag_xxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </div>
            </div>
            {error && (
              <div className="text-xs text-red-300">{error}</div>
            )}
            <div className="flex gap-2">
              <button className="btn-primary" onClick={addKey}>
                Save
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <ul className="mt-5 space-y-3">
          {keys.length === 0 && !adding && (
            <li className="text-sm text-gray-400">No keys yet. Click “Add Key”.</li>
          )}
          {keys.map((k) => (
            <li
              key={k.id}
              className={`rounded-md p-4 bg-black/30 border ${
                k.isActive ? 'border-accent' : 'border-white/10'
              }`}
            >
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <div className="flex-1 min-w-[220px]">
                  {editingId === k.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        className="input max-w-xs"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                      />
                      <button className="btn-primary" onClick={saveLabel}>
                        Save
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        className="text-sm font-medium text-gray-100 hover:text-accent"
                        onClick={() => startEditLabel(k)}
                        title="Click to rename"
                      >
                        {k.label}
                      </button>
                      {k.isActive && (
                        <span className="badge bg-accent/20 text-accent border border-accent/40">
                          ACTIVE
                        </span>
                      )}
                    </div>
                  )}
                  <div className="text-xs font-mono text-gray-400 mt-1">
                    {maskKey(k.value)}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!k.isActive && (
                    <button
                      className="btn-secondary"
                      onClick={() => setActive(k.id)}
                    >
                      Set Active
                    </button>
                  )}
                  <button
                    className="btn-danger"
                    disabled={keys.length <= 1}
                    title={
                      keys.length <= 1
                        ? 'Cannot delete the only key'
                        : 'Delete this key'
                    }
                    onClick={() => deleteKey(k.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3 className="text-sm font-semibold">About this app</h3>
        <p className="text-xs text-gray-400 mt-2 leading-relaxed">
          All Magnific API requests are made from the Electron main process.
          Local files are uploaded to a temporary public URL via{' '}
          <span className="font-mono">transfer.sh</span> before being sent to
          the API. Tasks and keys are persisted via{' '}
          <span className="font-mono">electron-store</span>; in-progress tasks
          resume polling on app restart.
        </p>
      </section>
    </div>
  );
}
