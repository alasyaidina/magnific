import React, { useMemo } from 'react';
import StatusBadge from '../components/StatusBadge.jsx';

function maskKey(value) {
  if (!value) return '—';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

const ACTIVE_STATUSES = new Set([
  'PREPARING',
  'SUBMITTING',
  'CREATED',
  'IN_PROGRESS',
  'DOWNLOADING',
]);

export default function ApiManagement({ keys, tasks }) {
  const stats = useMemo(() => {
    const byKey = new Map();
    for (const k of keys) {
      byKey.set(k.id, {
        running: 0,
        runningTask: null,
        completed: k.completedCount || 0,
        failed: k.failedCount || 0,
      });
    }
    for (const t of tasks) {
      if (t.assignedKeyId && ACTIVE_STATUSES.has(t.status)) {
        const e = byKey.get(t.assignedKeyId);
        if (e) {
          e.running += 1;
          if (!e.runningTask) e.runningTask = t;
        }
      }
    }
    return byKey;
  }, [keys, tasks]);

  const queuedCount = useMemo(
    () => tasks.filter((t) => t.status === 'QUEUED').length,
    [tasks],
  );
  const availableKeys = keys.filter((k) => !k.exhausted).length;
  const exhaustedKeys = keys.filter((k) => k.exhausted).length;

  if (keys.length === 0) {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold">No API keys yet</h2>
        <p className="text-sm text-gray-400 mt-1">
          Add a Magnific API key in Settings to enable the queue.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">API Management</h2>
            <p className="text-sm text-gray-400 mt-1">
              Each non-Habis key handles one task at a time in parallel.
              Extra tasks queue up and are assigned as keys free up.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Stat label="Available keys" value={availableKeys} accent="text-emerald-300" />
            <Stat label="Habis" value={exhaustedKeys} accent="text-red-300" />
            <Stat label="In queue" value={queuedCount} accent="text-slate-300" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        {keys.map((k) => {
          const s = stats.get(k.id) || { running: 0, completed: 0, failed: 0 };
          const status = k.exhausted
            ? 'HABIS'
            : s.running > 0
              ? 'WORKING'
              : 'IDLE';
          return (
            <div
              key={k.id}
              className={`card !p-4 flex flex-col gap-3 ${
                k.exhausted
                  ? 'border-red-500/40 bg-red-950/10'
                  : s.running > 0
                    ? 'border-emerald-500/30'
                    : ''
              }`}
            >
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`badge ${
                      status === 'HABIS'
                        ? 'bg-red-900/40 text-red-300 border border-red-500/30'
                        : status === 'WORKING'
                          ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-500/30'
                          : 'bg-white/5 text-gray-400 border border-white/10'
                    }`}
                  >
                    {status}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-100 truncate">
                      {k.label}
                    </div>
                    <div className="text-xs font-mono text-gray-400">
                      {maskKey(k.value)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {k.exhausted ? (
                    <button
                      className="btn-secondary"
                      onClick={() => window.api.resetExhausted(k.id)}
                      title="Mark this key as available again (e.g. after topping up credits)."
                    >
                      Mark available
                    </button>
                  ) : (
                    <button
                      className="btn-secondary"
                      onClick={() => window.api.markExhausted(k.id)}
                      title="Manually pause this key — useful while you investigate."
                    >
                      Mark Habis
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Stat
                  label="Currently running"
                  value={s.running}
                  accent={s.running > 0 ? 'text-emerald-300' : 'text-gray-300'}
                />
                <Stat label="Completed" value={s.completed} accent="text-emerald-300" />
                <Stat label="Failed" value={s.failed} accent="text-red-300" />
                <Stat
                  label="Last assigned"
                  value={s.runningTask ? new Date(s.runningTask.startedAt || s.runningTask.createdAt).toLocaleTimeString() : '—'}
                  accent="text-gray-300"
                />
              </div>

              {s.runningTask && (
                <div className="text-xs border border-white/5 rounded-md bg-black/30 px-3 py-2 flex items-center gap-2">
                  <StatusBadge status={s.runningTask.status} />
                  <span className="text-gray-400 truncate" title={s.runningTask.prompt || ''}>
                    {s.runningTask.prompt || '(no prompt)'}
                  </span>
                  {s.runningTask.magnificTaskId && (
                    <span className="text-gray-500 font-mono ml-auto">
                      {s.runningTask.magnificTaskId.slice(0, 8)}
                    </span>
                  )}
                </div>
              )}

              {k.exhausted && k.exhaustedReason && (
                <div className="text-xs text-red-300 bg-red-900/20 border border-red-500/20 rounded-md px-3 py-2">
                  <span className="text-red-200 font-medium">Reason:</span>{' '}
                  {k.exhaustedReason}
                  {k.exhaustedAt && (
                    <span className="text-red-400/80">
                      {' · '}
                      {new Date(k.exhaustedAt).toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Stat({ label, value, accent = 'text-gray-200' }) {
  return (
    <div className="rounded-md border border-white/5 bg-black/30 px-3 py-2">
      <div className="text-gray-500 text-[10px] uppercase tracking-wide">
        {label}
      </div>
      <div className={`text-base font-semibold ${accent}`}>{value}</div>
    </div>
  );
}
