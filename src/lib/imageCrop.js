// Convert a base64 string to a Blob in the renderer.
export function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

// Convert a Blob to a base64 (no data: prefix) string.
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result || '';
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

// Render a `react-image-crop` completed crop to a JPEG Blob.
// `image` is the loaded HTMLImageElement; `crop` is in displayed pixels.
export async function cropToJpegBlob(image, crop, quality = 0.92) {
  if (!image || !crop || !crop.width || !crop.height) {
    throw new Error('Invalid crop region');
  }
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const sx = crop.x * scaleX;
  const sy = crop.y * scaleY;
  const sw = crop.width * scaleX;
  const sh = crop.height * scaleY;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
      'image/jpeg',
      quality,
    );
  });
}

// e.g. ratioFor('16:9') -> 16/9; ratioFor('free') -> null
export function ratioFor(ratio) {
  if (!ratio || ratio === 'free') return null;
  const [a, b] = String(ratio).split(':').map(Number);
  if (!a || !b) return null;
  return a / b;
}

// e.g. cropFilename('photo.png', '1:1') -> 'photo-1x1.jpg'
export function cropFilename(originalName, ratio) {
  const safeRatio = ratio === 'free' ? 'orig' : String(ratio).replace(':', 'x');
  const dot = originalName.lastIndexOf('.');
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${stem}-${safeRatio}.jpg`;
}
