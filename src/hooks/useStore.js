import { useEffect, useState } from 'react';

/**
 * Subscribes to the electron-store-backed `keys` and `tasks` collections
 * and re-renders consumers when the main process emits change events.
 */
export function useStore() {
  const [keys, setKeys] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [k, t] = await Promise.all([
          window.api.store.get('keys'),
          window.api.store.get('tasks'),
        ]);
        if (!mounted) return;
        setKeys(Array.isArray(k) ? k : []);
        setTasks(Array.isArray(t) ? t : []);
      } finally {
        if (mounted) setReady(true);
      }
    })();

    const offKeys = window.api.onKeysChanged((next) => {
      setKeys(Array.isArray(next) ? next : []);
    });
    const offTasks = window.api.onTasksChanged((next) => {
      setTasks(Array.isArray(next) ? next : []);
    });

    return () => {
      mounted = false;
      offKeys && offKeys();
      offTasks && offTasks();
    };
  }, []);

  return { keys, tasks, ready };
}
