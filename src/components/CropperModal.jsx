import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { cropToJpegBlob, ratioFor } from '../lib/imageCrop.js';

/**
 * Aspect-ratio cropper modal.
 *
 * Props:
 *  - imageUrl: blob/data URL of the source image to crop.
 *  - ratio: '1:1' | '9:16' | '16:9' | '4:3' (Free is handled outside this modal).
 *  - onConfirm: (blob: Blob) => void — receives the cropped JPEG.
 *  - onCancel: () => void
 */
export default function CropperModal({ imageUrl, ratio, onConfirm, onCancel }) {
  const [crop, setCrop] = useState(undefined);
  const [completed, setCompleted] = useState(undefined);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const imgRef = useRef(null);

  const aspect = ratioFor(ratio) ?? 1;

  const handleImageLoad = useCallback(
    (e) => {
      const img = e.currentTarget;
      const { naturalWidth, naturalHeight } = img;
      const initial = centerCrop(
        makeAspectCrop({ unit: '%', width: 90 }, aspect, naturalWidth, naturalHeight),
        naturalWidth,
        naturalHeight,
      );
      setCrop(initial);
    },
    [aspect],
  );

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const handleConfirm = async () => {
    setError(null);
    if (!imgRef.current || !completed) return;
    setWorking(true);
    try {
      const blob = await cropToJpegBlob(imgRef.current, completed);
      await onConfirm?.(blob);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div className="bg-card border border-white/10 rounded-lg shadow-2xl w-[min(92vw,820px)] max-h-[90vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div>
            <h3 className="text-sm font-semibold">Crop image — {ratio}</h3>
            <p className="text-xs text-gray-400">
              Drag to adjust. The aspect ratio is locked at {ratio}.
            </p>
          </div>
          <button
            type="button"
            className="text-gray-400 hover:text-white text-lg leading-none"
            onClick={onCancel}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-auto p-4 bg-black/40 flex items-center justify-center">
          {imageUrl ? (
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              onComplete={(c) => setCompleted(c)}
              aspect={aspect}
              keepSelection
              minWidth={20}
              minHeight={20}
            >
              <img
                ref={imgRef}
                src={imageUrl}
                alt="To crop"
                onLoad={handleImageLoad}
                style={{ maxHeight: '60vh', maxWidth: '100%', display: 'block' }}
              />
            </ReactCrop>
          ) : (
            <div className="text-gray-400 text-sm">Loading image…</div>
          )}
        </div>

        {error && (
          <div className="px-5 py-2 text-xs text-red-300 border-t border-red-500/30 bg-red-900/20">
            {error}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/5">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={working}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleConfirm}
            disabled={working || !completed?.width || !completed?.height}
          >
            {working ? 'Cropping…' : 'Confirm Crop'}
          </button>
        </footer>
      </div>
    </div>
  );
}
