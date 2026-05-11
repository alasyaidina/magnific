import React, { useState } from 'react';
import StatusBadge from '../components/StatusBadge.jsx';

export default function History({ tasks }) {
  const [busyId, setBusyId] = useState(null);

  const handleDownload = async (task) => {
    if (!task.resultUrl) return;
    setBusyId(task.id);
    try {
      await window.api.downloadVideo({
        taskId: task.id,
        url: task.resultUrl,
        defaultName: `magnific-${task.id}.mp4`,
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (task) => {
    setBusyId(task.id);
    try {
      await window.api.deleteTask(task.id);
    } finally {
      setBusyId(null);
    }
  };

  const handleResume = async (task) => {
    setBusyId(task.id);
    try {
      await window.api.resumePolling(task.id);
    } finally {
      setBusyId(null);
    }
  };

  if (!tasks || tasks.length === 0) {
    return (
      <div className="card text-center text-gray-400">
        <p>No tasks yet.</p>
        <p className="text-xs mt-1">
          Submit a Motion Control job from the Generator tab to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Task history</h2>
        <span className="text-xs text-gray-400">{tasks.length} total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-400 bg-black/30">
            <tr>
              <th className="text-left px-5 py-3">Date</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="text-left px-5 py-3">Quality</th>
              <th className="text-left px-5 py-3">Duration</th>
              <th className="text-left px-5 py-3">Prompt</th>
              <th className="text-right px-5 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const created = new Date(t.createdAt);
              const updated = t.lastPolledAt ? new Date(t.lastPolledAt) : null;
              const duration =
                t.status === 'COMPLETED' || t.status === 'FAILED'
                  ? humanDuration(
                      (updated ? updated.getTime() : Date.now()) -
                        created.getTime(),
                    )
                  : t.status === 'IN_PROGRESS' || t.status === 'CREATED'
                    ? `${humanDuration(Date.now() - created.getTime())} (running)`
                    : '—';
              return (
                <tr key={t.id} className="border-t border-white/5 align-top">
                  <td className="px-5 py-3 text-gray-300 whitespace-nowrap">
                    {created.toLocaleString()}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-5 py-3 text-gray-300 capitalize">
                    {t.quality === 'std' ? 'Standard 720p' : 'Pro 1080p'}
                  </td>
                  <td className="px-5 py-3 text-gray-400">{duration}</td>
                  <td className="px-5 py-3 text-gray-300 max-w-xs truncate" title={t.prompt}>
                    {t.prompt || <span className="text-gray-500 italic">—</span>}
                    {t.status === 'FAILED' && t.lastError && (
                      <div
                        className="text-xs text-red-300 mt-1 truncate"
                        title={t.lastError}
                      >
                        {t.lastError}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right space-x-2 whitespace-nowrap">
                    {t.status === 'COMPLETED' && t.resultUrl && (
                      <button
                        className="btn-primary"
                        onClick={() => handleDownload(t)}
                        disabled={busyId === t.id}
                      >
                        Download
                      </button>
                    )}
                    {(t.status === 'IN_PROGRESS' || t.status === 'CREATED') && (
                      <button
                        className="btn-secondary"
                        onClick={() => handleResume(t)}
                        disabled={busyId === t.id}
                      >
                        Resume polling
                      </button>
                    )}
                    <button
                      className="btn-danger"
                      onClick={() => handleDelete(t)}
                      disabled={busyId === t.id}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}
