import { useEffect, useState } from 'react';

/**
 * Subscribes to the electron-store-backed `keys`, `tasks`, and
 * `outputFolder` values and re-renders consumers when the main process
 * emits change events.
 */
export function useStore() {
  const [keys, setKeys] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [outputFolder, setOutputFolder] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [k, t, f] = await Promise.all([
          window.api.store.get('keys'),
          window.api.store.get('tasks'),
          window.api.getOutputFolder(),
        ]);
        if (!mounted) return;
        setKeys(Array.isArray(k) ? k : []);
        setTasks(Array.isArray(t) ? t : []);
        setOutputFolder(f || null);
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
    const offFolder = window.api.onOutputFolderChanged((next) => {
      setOutputFolder(next || null);
    });

    return () => {
      mounted = false;
      offKeys && offKeys();
      offTasks && offTasks();
      offFolder && offFolder();
    };
  }, []);

  return { keys, tasks, outputFolder, ready };
}
