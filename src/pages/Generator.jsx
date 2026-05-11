import React, { useEffect, useMemo, useState } from 'react';
import StatusBadge from '../components/StatusBadge.jsx';
import CropperModal from '../components/CropperModal.jsx';
import {
  base64ToBlob,
  blobToBase64,
  cropFilename,
} from '../lib/imageCrop.js';

const RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '9:16', label: '9:16' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: 'free', label: 'Free' },
];

const ACTIVE_STATUSES = new Set([
  'QUEUED',
  'PREPARING',
  'SUBMITTING',
  'CREATED',
  'IN_PROGRESS',
  'DOWNLOADING',
]);

export default function Generator({
  keys,
  activeKey,
  tasks,
  outputFolder,
  onGoToSettings,
  onGoToHistory,
  onGoToApi,
}) {
  const [imageFile, setImageFile] = useState(null);
  const [imageBlobUrl, setImageBlobUrl] = useState(null);
  const [imageLoadError, setImageLoadError] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [quality, setQuality] = useState('pro');
  const [orientation, setOrientation] = useState('video');
  const [cfgScale, setCfgScale] = useState(0.5);

  const [ratio, setRatio] = useState('free');
  const [cropResult, setCropResult] = useState(null);
  const [cropperRatio, setCropperRatio] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const queueable = !!imageFile && !!videoFile && keys.length > 0 && !submitting;

  // Load picked image into a blob URL for cropper preview.
  useEffect(() => {
    if (!imageFile?.path) {
      setImageBlobUrl(null);
      return undefined;
    }
    let revoked = false;
    let urlToRevoke = null;
    (async () => {
      try {
        setImageLoadError(null);
        const data = await window.api.readFile(imageFile.path);
        if (revoked) return;
        const blob = base64ToBlob(data.dataBase64, data.mime);
        const url = URL.createObjectURL(blob);
        urlToRevoke = url;
        setImageBlobUrl(url);
      } catch (err) {
        if (!revoked) setImageLoadError(err?.message || String(err));
      }
    })();
    return () => {
      revoked = true;
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
    };
  }, [imageFile?.path]);

  useEffect(() => {
    return () => {
      if (cropResult?.blobUrl) URL.revokeObjectURL(cropResult.blobUrl);
    };
  }, [cropResult?.blobUrl]);

  const handlePickImage = async () => {
    const f = await window.api.selectFile('image');
    if (f) {
      setImageFile(f);
      setRatio('free');
      setCropResult(null);
      setCropperRatio(null);
    }
  };
  const handleClearImage = () => {
    setImageFile(null);
    setRatio('free');
    setCropResult(null);
    setCropperRatio(null);
  };
  const handlePickVideo = async () => {
    const f = await window.api.selectFile('video');
    if (f) setVideoFile(f);
  };

  const handleRatioClick = (value) => {
    if (value === 'free') {
      setRatio('free');
      setCropResult(null);
      setCropperRatio(null);
      return;
    }
    setCropperRatio(value);
  };

  const handleCropConfirm = async (blob) => {
    const dataBase64 = await blobToBase64(blob);
    const blobUrl = URL.createObjectURL(blob);
    setCropResult((prev) => {
      if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
      return {
        ratio: cropperRatio,
        dataBase64,
        mime: blob.type || 'image/jpeg',
        blobUrl,
        name: cropFilename(imageFile?.name || 'image.jpg', cropperRatio),
      };
    });
    setRatio(cropperRatio);
    setCropperRatio(null);
  };

  const handlePickFolder = async () => {
    const folder = await window.api.selectFolder();
    if (folder) {
      try {
        await window.api.setOutputFolder(folder);
      } catch (err) {
        setError(err?.message || 'Could not set output folder');
      }
    }
  };

  const handleClearFolder = async () => {
    try {
      await window.api.setOutputFolder(null);
    } catch (err) {
      setError(err?.message || 'Could not clear output folder');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!queueable) return;
    setError(null);
    setSubmitting(true);
    try {
      // If the user cropped, persist that buffer to a real file so it
      // survives until a worker picks it up (the renderer's blob/URL
      // lives only as long as this page).
      let imagePath = imageFile.path;
      if (cropResult) {
        imagePath = await window.api.persistBuffer({
          filename: cropResult.name,
          dataBase64: cropResult.dataBase64,
        });
      }
      await window.api.queueTask({
        imagePath,
        videoPath: videoFile.path,
        prompt: prompt || '',
        quality,
        orientation,
        cfg_scale: Number(cfgScale),
      });
      // Reset only the inputs that should change per submission. Keep
      // the chosen video + options so the user can quickly queue many
      // jobs against the same source.
      setImageFile(null);
      setRatio('free');
      setCropResult(null);
      setCropperRatio(null);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const recent = useMemo(() => {
    return tasks
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8);
  }, [tasks]);

  const activeCount = useMemo(
    () => tasks.filter((t) => ACTIVE_STATUSES.has(t.status)).length,
    [tasks],
  );
  const queuedCount = useMemo(
    () => tasks.filter((t) => t.status === 'QUEUED').length,
    [tasks],
  );

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
        <OutputFolderBar
          folder={outputFolder}
          onPick={handlePickFolder}
          onClear={handleClearFolder}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <FilePicker
              label="Character image (JPG/PNG/WEBP, ≥300px, ≤10MB)"
              file={imageFile}
              onPick={handlePickImage}
              onClear={handleClearImage}
              accent="image"
            />
            {imageFile && (
              <RatioPicker
                ratio={ratio}
                cropResult={cropResult}
                imageBlobUrl={imageBlobUrl}
                imageLoadError={imageLoadError}
                onPick={handleRatioClick}
                onRecrop={() => cropResult && setCropperRatio(cropResult.ratio)}
              />
            )}
          </div>
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
          <button type="submit" className="btn-primary" disabled={!queueable}>
            {submitting ? 'Queuing…' : 'Queue task'}
          </button>
          <div className="text-xs text-gray-500 ml-auto">
            {keys.filter((k) => !k.exhausted).length} key(s) available
            {' · '}
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={onGoToApi}
            >
              API Management
            </button>
          </div>
        </div>
        {error && (
          <div className="text-sm text-red-300 bg-red-900/30 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </form>

      <aside className="card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">Queue</h3>
          <div className="text-xs text-gray-400">
            <span className="text-emerald-300">{activeCount - queuedCount}</span>
            {' running · '}
            <span className="text-slate-300">{queuedCount}</span>
            {' queued'}
          </div>
        </div>

        {recent.length === 0 && (
          <p className="text-xs text-gray-500">
            Queued and recent tasks will show up here.
          </p>
        )}

        <ul className="space-y-2">
          {recent.map((t) => (
            <li
              key={t.id}
              className="border border-white/5 rounded-md bg-black/30 px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <StatusBadge status={t.status} />
                <span className="text-gray-500">
                  {new Date(t.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="mt-1 text-gray-300 truncate" title={t.prompt || ''}>
                {t.prompt || <span className="text-gray-500">(no prompt)</span>}
              </div>
              {t.localPath && (
                <div className="mt-1 text-emerald-300 truncate" title={t.localPath}>
                  Saved: {t.localPath}
                </div>
              )}
              {t.lastError && (
                <div className="mt-1 text-red-300 line-clamp-2" title={t.lastError}>
                  {t.lastError}
                </div>
              )}
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn-secondary w-full"
          onClick={onGoToHistory}
        >
          Open History
        </button>
      </aside>

      {cropperRatio && imageBlobUrl && (
        <CropperModal
          imageUrl={imageBlobUrl}
          ratio={cropperRatio}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropperRatio(null)}
        />
      )}
    </div>
  );
}

function OutputFolderBar({ folder, onPick, onClear }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 px-3 py-2 flex items-center gap-3 text-xs">
      <span className="text-gray-400">Auto-download folder</span>
      <span
        className={`flex-1 truncate ${folder ? 'text-gray-100' : 'text-gray-500'}`}
        title={folder || ''}
      >
        {folder || 'Not set — videos won\u2019t auto-download'}
      </span>
      <button type="button" className="btn-secondary !py-1 !px-2" onClick={onPick}>
        {folder ? 'Change' : 'Choose folder'}
      </button>
      {folder && (
        <button
          type="button"
          className="text-gray-400 hover:text-red-300"
          onClick={onClear}
        >
          Clear
        </button>
      )}
    </div>
  );
}

function RatioPicker({
  ratio,
  cropResult,
  imageBlobUrl,
  imageLoadError,
  onPick,
  onRecrop,
}) {
  return (
    <div className="border border-white/10 rounded-md bg-black/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="label !mb-0">Aspect ratio</span>
        {cropResult ? (
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={onRecrop}
          >
            Re-crop
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {RATIOS.map((r) => {
          const active = ratio === r.value;
          return (
            <button
              key={r.value}
              type="button"
              onClick={() => onPick(r.value)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                active
                  ? 'bg-accent border-accent text-white'
                  : 'bg-black/40 border-white/10 text-gray-300 hover:text-white hover:border-white/30'
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      {imageLoadError && (
        <div className="text-xs text-red-300">
          Could not read image: {imageLoadError}
        </div>
      )}
      {cropResult ? (
        <div className="flex items-center gap-3 pt-1">
          <img
            src={cropResult.blobUrl}
            alt="Cropped preview"
            className="w-16 h-16 object-cover rounded border border-white/10 bg-black"
          />
          <div className="text-xs text-gray-300">
            <div className="text-gray-200">Cropped to {cropResult.ratio}</div>
            <div className="text-gray-500">{cropResult.name}</div>
          </div>
        </div>
      ) : ratio === 'free' ? (
        <p className="text-xs text-gray-500">
          Free — the original image will be uploaded without cropping.
        </p>
      ) : (
        <p className="text-xs text-gray-500">
          Pick a ratio above to open the cropper.
        </p>
      )}
      {imageBlobUrl == null && !imageLoadError && (
        <p className="text-xs text-gray-500">Reading image…</p>
      )}
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
