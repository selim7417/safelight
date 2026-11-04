// Off-screen renderer for the film strip and the histogram.

import { DEFAULT_GEOMETRY, frameToSource, outputSize, type Geometry } from '../lib/geometry';
import type { Recipe } from '../lib/recipe';
import { FilmRenderer } from './renderer';

let shared: { renderer: FilmRenderer; canvas: HTMLCanvasElement } | null = null;
let currentSourceId = '';

function get() {
  if (!shared) {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    shared = { renderer: new FilmRenderer(canvas, { readback: true }), canvas };
  }
  return shared;
}

function prepare(sourceId: string, thumb: ImageBitmap | HTMLCanvasElement) {
  const { renderer } = get();
  if (currentSourceId !== sourceId) {
    renderer.setSource(thumb, thumb.width, thumb.height);
    currentSourceId = sourceId;
  }
  return renderer;
}

/** Draws one recipe into a 2D canvas. Fits the photo inside, cropping to the frame's shape. */
export function drawThumbnail(
  sourceId: string,
  thumb: ImageBitmap | HTMLCanvasElement,
  recipe: Recipe,
  target: HTMLCanvasElement,
  geometry: Geometry = DEFAULT_GEOMETRY,
) {
  const { canvas } = get();
  const renderer = prepare(sourceId, thumb);
  const w = target.width;
  const h = target.height;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  renderer.setRecipe(recipe);
  renderer.setTransform(frameToSource(geometry, thumb.width, thumb.height));
  const out = outputSize(geometry, thumb.width, thumb.height);
  const scale = Math.max(w / out.width, h / out.height);
  const dw = Math.round(out.width * scale);
  const dh = Math.round(out.height * scale);
  renderer.render({ x: Math.round((w - dw) / 2), y: Math.round((h - dh) / 2), width: dw, height: dh });
  const ctx = target.getContext('2d')!;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(canvas, 0, 0);
}

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  l: Uint32Array;
}

export function readHistogram(
  sourceId: string,
  thumb: ImageBitmap | HTMLCanvasElement,
  recipe: Recipe,
  geometry: Geometry = DEFAULT_GEOMETRY,
): Histogram {
  const renderer = prepare(sourceId, thumb);
  renderer.setRecipe(recipe);
  renderer.setTransform(frameToSource(geometry, thumb.width, thumb.height));
  const frame = outputSize(geometry, thumb.width, thumb.height);
  const w = Math.min(frame.width, 256);
  const h = Math.max(1, Math.round((w * frame.height) / frame.width));
  const px = renderer.renderPixels(w, h);
  const bins = 64;
  const out: Histogram = { r: new Uint32Array(bins), g: new Uint32Array(bins), b: new Uint32Array(bins), l: new Uint32Array(bins) };
  for (let i = 0; i < px.length; i += 4) {
    out.r[(px[i] * bins) >> 8]++;
    out.g[(px[i + 1] * bins) >> 8]++;
    out.b[(px[i + 2] * bins) >> 8]++;
    out.l[((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * bins) >> 8]++;
  }
  return out;
}

/** The thumbnail renderer, loaded with a given photo. Lets other views share its GPU work. */
export function getThumbRenderer(sourceId: string, thumb: ImageBitmap | HTMLCanvasElement): FilmRenderer {
  return prepare(sourceId, thumb);
}

// The film strip while the camera is on: a small copy of the latest video frame.
const LIVE_ID = 'live';
let liveCanvas: HTMLCanvasElement | null = null;

/** Copies the latest video frame into the thumbnail renderer. Returns that small frame. */
export function refreshLiveThumbnail(video: HTMLVideoElement): HTMLCanvasElement {
  const width = 480;
  const height = Math.max(1, Math.round((width * video.videoHeight) / Math.max(video.videoWidth, 1)));
  if (!liveCanvas || liveCanvas.width !== width || liveCanvas.height !== height) {
    liveCanvas = document.createElement('canvas');
    liveCanvas.width = width;
    liveCanvas.height = height;
    currentSourceId = '';
  }
  liveCanvas.getContext('2d')!.drawImage(video, 0, 0, width, height);
  if (currentSourceId === LIVE_ID) get().renderer.updateSource(liveCanvas);
  else prepare(LIVE_ID, liveCanvas);
  return liveCanvas;
}

export const liveThumbnail = () => liveCanvas;
export const LIVE_SOURCE = LIVE_ID;
