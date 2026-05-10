import React from 'react';

const STYLES = {
  CREATED: 'bg-blue-900/40 text-blue-300 border border-blue-500/30',
  IN_PROGRESS: 'bg-amber-900/40 text-amber-300 border border-amber-500/30',
  COMPLETED: 'bg-emerald-900/40 text-emerald-300 border border-emerald-500/30',
  FAILED: 'bg-red-900/40 text-red-300 border border-red-500/30',
  IDLE: 'bg-white/5 text-gray-400 border border-white/10',
};

export default function StatusBadge({ status }) {
  const cls = STYLES[status] || STYLES.IDLE;
  return <span className={`badge ${cls}`}>{status || 'IDLE'}</span>;
}
