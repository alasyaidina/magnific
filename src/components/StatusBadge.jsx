import React from 'react';

const STYLES = {
  QUEUED: 'bg-slate-800/60 text-slate-300 border border-slate-500/40',
  PREPARING: 'bg-purple-900/30 text-purple-200 border border-purple-500/30',
  SUBMITTING: 'bg-purple-900/30 text-purple-200 border border-purple-500/30',
  CREATED: 'bg-blue-900/40 text-blue-300 border border-blue-500/30',
  IN_PROGRESS: 'bg-amber-900/40 text-amber-300 border border-amber-500/30',
  COMPLETED: 'bg-emerald-900/40 text-emerald-300 border border-emerald-500/30',
  DOWNLOADING: 'bg-cyan-900/40 text-cyan-300 border border-cyan-500/30',
  DONE: 'bg-emerald-900/40 text-emerald-300 border border-emerald-500/30',
  FAILED: 'bg-red-900/40 text-red-300 border border-red-500/30',
  IDLE: 'bg-white/5 text-gray-400 border border-white/10',
};

const LABELS = {
  QUEUED: 'QUEUED',
  PREPARING: 'PREPARING',
  SUBMITTING: 'SUBMITTING',
  CREATED: 'CREATED',
  IN_PROGRESS: 'IN PROGRESS',
  COMPLETED: 'COMPLETED',
  DOWNLOADING: 'DOWNLOADING',
  DONE: 'DONE',
  FAILED: 'FAILED',
  IDLE: 'IDLE',
};

export default function StatusBadge({ status }) {
  const cls = STYLES[status] || STYLES.IDLE;
  const label = LABELS[status] || status || 'IDLE';
  return <span className={`badge ${cls}`}>{label}</span>;
}
