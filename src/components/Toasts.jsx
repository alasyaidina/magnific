import React, { useEffect, useState } from 'react';

let nextId = 1;

export default function Toasts() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const off = window.api.onToast((payload) => {
      const id = nextId++;
      const toast = { id, type: payload?.type || 'info', message: payload?.message || '' };
      setToasts((curr) => [...curr, toast]);
      setTimeout(() => {
        setToasts((curr) => curr.filter((t) => t.id !== id));
      }, 5000);
    });
    return () => off && off();
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-2 rounded-md shadow-lg text-sm border ${
            t.type === 'warning'
              ? 'bg-amber-900/80 border-amber-500/40 text-amber-100'
              : t.type === 'error'
                ? 'bg-red-900/80 border-red-500/40 text-red-100'
                : t.type === 'success'
                  ? 'bg-emerald-900/80 border-emerald-500/40 text-emerald-100'
                  : 'bg-card border-white/10 text-gray-100'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
