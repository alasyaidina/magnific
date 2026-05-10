import React, { useEffect, useMemo, useState } from 'react';
import StatusBadge from '../components/StatusBadge.jsx';

const PHASES = {
  IDLE: 'IDLE',
  UPLOADING_IMAGE: 'UPLOADING_IMAGE',
  UPLOADING_VIDEO: 'UPLOADING_VIDEO',
  SUBMITTING: 'SUBMITTING',
  POLLING: 'POLLING',
  DONE: 'DONE',
  ERROR: 'ERROR',
};

const PHASE_LABEL = {
  IDLE: 'Idle',
  UPLOADING_IMAGE: 'Uploading image…',
  UPLOADING_VIDEO: 'Uploading video…',
  SUBMITTING: 'Submitting task…',
  POLLING: 'Polling status…',
  DONE: 'Completed',
  ERROR: 'Error',
};

export default function Generator({ keys, activeKey, onGoToSettings, onGoToHistory }) {
  const [imageFile, setImageFile] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [quality, setQuality] = useState('pro'); // 'pro' | 'std'
  const [orientation, setOrientation] = useState('video'); // 'video' | 'image'
  const [cfgScale, setCfgScale] = useState(0.5);

  const [phase, setPhase] = useState(PHASES.IDLE);
  const [error, setError] = useState(null);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [activeTask, setActiveTask] = useState(null);

  const [pollSecondsLeft, setPollSecondsLeft] = useState(0);

  const canSubmit =
    keys.length > 0 &&
    !!imageFile &&
    !!videoFile &&
    phase !== PHASES.UPLOADING_IMAGE &&
    phase !== PHASES.UPLOADING_VIDEO &&
    phase !== PHASES.SUBMITTING;

  // Subscribe to task changes so we can render live status from the store.
  useEffect(() => {
    if (!activeTaskId) return undefined;
    const off = window.api.onTasksChanged((tasks) => {
      const t = (tasks || []).find((x) => x.id === activeTaskId);
      if (t) {
        setActiveTask(t);
        if (t.status === 'COMPLETED') setPhase(PHASES.DONE);
        else if (t.status === 'FAILED') {
          setPhase(PHASES.ERROR);
          setError(t.lastError || 'Task failed');
        }
      }
    });
    return () => off && off();
  }, [activeTaskId]);

  // Show countdown to next poll while in progress.
  useEffect(() => {
    if (phase !== PHASES.POLLING) {
      setPollSecondsLeft(0);
      return undefined;
    }
    setPollSecondsLeft(5);
    const interval = setInterval(() => {
      setPollSecondsLeft((s) => (s <= 1 ? 5 : s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, activeTask?.lastPolledAt]);

  const handlePickImage = async () => {
    const f = await window.api.selectFile('image');
    if (f) setImageFile(f);
  };
  const handlePickVideo = async () => {
    const f = await window.api.selectFile('video');
    if (f) setVideoFile(f);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);

    try {
      setPhase(PHASES.UPLOADING_IMAGE);
      const imageUrl = await window.api.uploadFile(imageFile.path);

      setPhase(PHASES.UPLOADING_VIDEO);
      const videoUrl = await window.api.uploadFile(videoFile.path);

      setPhase(PHASES.SUBMITTING);
      const task = await window.api.submitTask({
        quality,
        image_url: imageUrl,
        video_url: videoUrl,
        prompt: prompt || undefined,
        character_orientation: orientation,
        cfg_scale: Number(cfgScale),
      });
      setActiveTaskId(task.id);
      setActiveTask(task);
      setPhase(PHASES.POLLING);
    } catch (err) {
      setPhase(PHASES.ERROR);
      setError(err?.message || String(err));
    }
  };

  const handleReset = () => {
    setImageFile(null);
    setVideoFile(null);
    setPrompt('');
    setActiveTaskId(null);
    setActiveTask(null);
    setPhase(PHASES.IDLE);
    setError(null);
  };

  const handleDownload = async () => {
    if (!activeTask?.resultUrl) return;
    const safe = `magnific-${activeTask.id}.mp4`;
    try {
      await window.api.downloadVideo({ url: activeTask.resultUrl, defaultName: safe });
    } catch (err) {
      setError(err?.message || 'Download failed');
    }
  };

  const phaseStatus = useMemo(() => {
    if (phase === PHASES.POLLING && activeTask?.status) return activeTask.status;
    if (phase === PHASES.DONE) return 'COMPLETED';
    if (phase === PHASES.ERROR) return 'FAILED';
    return 'IDLE';
  }, [phase, activeTask?.status]);

  if (keys.length === 0) {
    return (
      <div className="card flex flex-col items-start gap-4">
        <div>
          <h2 className="text-lg font-semibold">No API key configured</h2>
          <p className="text-sm text-gray-400 mt-1">
            Add a Magnific API key to start generating Motion Control videos.
          </p>
        </div>
        <button className="btn-primary" onClick={onGoToSettings}>
          Open Settings
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <form className="card lg:col-span-2 space-y-5" onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FilePicker
            label="Character image (JPG/PNG/WEBP, ≥300px, ≤10MB)"
            file={imageFile}
            onPick={handlePickImage}
            onClear={() => setImageFile(null)}
            accent="image"
          />
          <FilePicker
            label="Reference motion video (MP4/MOV, 3–30s, ≤100MB)"
            file={videoFile}
            onPick={handlePickVideo}
            onClear={() => setVideoFile(null)}
            accent="video"
          />
        </div>

        <div>
          <label className="label">Prompt (optional, max 2500 chars)</label>
          <textarea
            className="input min-h-[88px] resize-y"
            maxLength={2500}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the motion or character behavior…"
          />
          <div className="text-right text-xs text-gray-500 mt-1">
            {prompt.length}/2500
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Toggle
            label="Quality"
            value={quality}
            options={[
              { value: 'pro', label: 'Pro 1080p' },
              { value: 'std', label: 'Standard 720p' },
            ]}
            onChange={setQuality}
          />
          <Toggle
            label="Character orientation"
            value={orientation}
            options={[
              { value: 'video', label: 'Video (≤30s)' },
              { value: 'image', label: 'Image (≤10s)' },
            ]}
            onChange={setOrientation}
          />
          <div>
            <label className="label">cfg_scale ({Number(cfgScale).toFixed(2)})</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={cfgScale}
              onChange={(e) => setCfgScale(parseFloat(e.target.value))}
              className="w-full accent-accent"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={!canSubmit}>
            Submit task
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleReset}
            disabled={phase === PHASES.UPLOADING_IMAGE || phase === PHASES.UPLOADING_VIDEO || phase === PHASES.SUBMITTING}
          >
            Reset
          </button>
          {activeKey && (
            <span className="text-xs text-gray-500 ml-auto">
              Using key:{' '}
              <span className="text-gray-300">{activeKey.label}</span>
            </span>
          )}
        </div>
      </form>

      <aside className="card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">Status</h3>
          <StatusBadge status={phaseStatus} />
        </div>
        <div className="text-sm text-gray-300">
          {PHASE_LABEL[phase]}
          {phase === PHASES.POLLING && pollSecondsLeft > 0 && (
            <span className="text-gray-500"> (next poll in {pollSecondsLeft}s)</span>
          )}
        </div>

        {(phase === PHASES.UPLOADING_IMAGE ||
          phase === PHASES.UPLOADING_VIDEO ||
          phase === PHASES.SUBMITTING) && (
          <div className="h-1.5 bg-white/10 rounded overflow-hidden">
            <div className="h-full bg-accent animate-pulse w-2/3" />
          </div>
        )}

        {activeTask && (
          <div className="text-xs text-gray-400 space-y-1 pt-2 border-t border-white/5">
            <div>Task ID: <span className="text-gray-200 font-mono">{activeTask.id}</span></div>
            <div>Quality: {activeTask.quality}</div>
            <div>Created: {new Date(activeTask.createdAt).toLocaleString()}</div>
            {activeTask.lastPolledAt && (
              <div>Last polled: {new Date(activeTask.lastPolledAt).toLocaleTimeString()}</div>
            )}
          </div>
        )}

        {phase === PHASES.DONE && activeTask?.resultUrl && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <video
              src={activeTask.resultUrl}
              controls
              className="w-full rounded border border-white/10 bg-black"
            />
            <div className="flex gap-2">
              <button className="btn-primary" onClick={handleDownload}>
                Download
              </button>
              <button className="btn-secondary" onClick={onGoToHistory}>
                Open History
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm text-red-300 bg-red-900/30 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </aside>
    </div>
  );
}

function FilePicker({ label, file, onPick, onClear, accent }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="border border-dashed border-white/15 rounded-md bg-black/30 px-3 py-4 flex items-center gap-3">
        <button type="button" className="btn-secondary" onClick={onPick}>
          {file ? `Change ${accent}` : `Choose ${accent}`}
        </button>
        <div className="text-xs text-gray-400 truncate">
          {file ? (
            <>
              <div className="text-gray-200 truncate" title={file.path}>
                {file.name}
              </div>
              <div>{formatBytes(file.size)}</div>
            </>
          ) : (
            <span>No file selected</span>
          )}
        </div>
        {file && (
          <button
            type="button"
            className="ml-auto text-xs text-gray-400 hover:text-red-300"
            onClick={onClear}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, value, options, onChange }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="inline-flex bg-black/40 border border-white/10 rounded-md p-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              value === opt.value
                ? 'bg-accent text-white'
                : 'text-gray-300 hover:text-white'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}
