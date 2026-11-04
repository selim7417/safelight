// Decoding photographs. Everything happens in the browser; nothing is uploaded.

export class UnreadableImageError extends Error {}

export async function decodeImage(source: Blob | string): Promise<ImageBitmap> {
  const blob = typeof source === 'string' ? await fetchBlob(source) : source;
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
  } catch {
    // Some browsers reject the options object. Fall back to the plainest call before giving up.
    try {
      return await createImageBitmap(blob);
    } catch {
      throw new UnreadableImageError('This browser can’t read that file.');
    }
  }
}

async function fetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new UnreadableImageError(`Couldn’t load the photo (HTTP ${response.status}).`);
  return response.blob();
}

/** A small copy of the photo for the film strip and histogram. */
export function makeThumb(bitmap: ImageBitmap, maxEdge = 560): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Size that fits within a long edge, keeping the aspect ratio. Never enlarges. */
export function fitLongEdge(width: number, height: number, longEdge: number): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}


export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|heic|heif|bmp|gif)$/i.test(file.name);
}
