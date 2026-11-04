// Composes the final file: the developed photograph plus an optional darkroom border.

import type { Affine } from '../lib/geometry';
import type { Recipe } from '../lib/recipe';
import { getStock } from '../lib/stocks';
import type { FilmRenderer } from './renderer';

export type BorderStyle = 'none' | 'print' | 'rebate';

export interface FrameLayout {
  width: number;
  height: number;
  imageX: number;
  imageY: number;
}

/** Outer dimensions and image position for each border style. */
export function frameLayout(imageWidth: number, imageHeight: number, border: BorderStyle): FrameLayout {
  const long = Math.max(imageWidth, imageHeight);
  if (border === 'print') {
    const margin = Math.round(long * 0.045);
    const bottom = Math.round(long * 0.075);
    return { width: imageWidth + margin * 2, height: imageHeight + margin + bottom, imageX: margin, imageY: margin };
  }
  if (border === 'rebate') {
    // Along the film's long edge, sprocket bands sit above and below; rotate for portrait frames.
    const band = Math.round(Math.min(imageWidth, imageHeight) * 0.135);
    const gap = Math.round(long * 0.012);
    return imageWidth >= imageHeight
      ? { width: imageWidth + gap * 2, height: imageHeight + band * 2, imageX: gap, imageY: band }
      : { width: imageWidth + band * 2, height: imageHeight + gap * 2, imageX: band, imageY: gap };
  }
  return { width: imageWidth, height: imageHeight, imageX: 0, imageY: 0 };
}

function drawRebate(ctx: CanvasRenderingContext2D, layout: FrameLayout, imageWidth: number, imageHeight: number, recipe: Recipe, frameNumber: number) {
  const { width, height } = layout;
  const landscape = imageWidth >= imageHeight;
  ctx.save();
  // Treat the film as horizontal and rotate the whole drawing for portrait frames.
  if (!landscape) {
    ctx.translate(width, 0);
    ctx.rotate(Math.PI / 2);
  }
  const W = landscape ? width : height;
  const H = landscape ? height : width;
  const band = landscape ? layout.imageY : layout.imageX;

  ctx.fillStyle = '#0d0b08';
  ctx.fillRect(0, 0, W, H);

  // Sprocket holes: 8 per frame, as on real 135 film. The light behind them is the scanner's.
  const holeW = W / 8 * 0.46;
  const holeH = band * 0.46;
  ctx.fillStyle = '#efe9dc';
  for (let i = 0; i < 8; i++) {
    const x = (i + 0.27) * (W / 8);
    for (const y of [band * 0.09, H - band * 0.09 - holeH]) {
      ctx.beginPath();
      ctx.roundRect(x, y, holeW, holeH, holeH * 0.16);
      ctx.fill();
    }
  }

  // Edge markings, in the dotted lettering film makers print into the rebate.
  const stock = getStock(recipe.stock);
  const size = band * 0.25;
  const y = band - size * 0.55;
  ctx.font = `800 ${size}px "Doto Variable", ui-monospace, monospace`;
  ctx.fillStyle = '#e8963a';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(`SAFELIGHT ${stock.code}`, W * 0.035, y);
  ctx.textAlign = 'right';
  ctx.fillText(`${frameNumber}  ▸  ${frameNumber}A`, W * 0.965, y);
  ctx.textAlign = 'center';
  ctx.fillText(`${frameNumber}`, W * 0.5, H - band + size * 0.55);
  ctx.restore();
}

/** Renders a photograph through a recipe into a canvas ready for encoding. */
export function composePrint(
  renderer: FilmRenderer,
  recipe: Recipe,
  transform: Affine,
  imageWidth: number,
  imageHeight: number,
  border: BorderStyle,
  frameNumber: number,
): HTMLCanvasElement {
  renderer.setRecipe(recipe);
  renderer.setTransform(transform);
  const pixels = renderer.renderPixels(imageWidth, imageHeight);
  // Opaque output: the shader writes alpha 1 everywhere inside the image.
  const image = new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, imageWidth, imageHeight);
  renderer.releaseExport();

  const layout = frameLayout(imageWidth, imageHeight, border);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d')!;

  if (border === 'print') {
    ctx.fillStyle = '#f6f2e9';
    ctx.fillRect(0, 0, layout.width, layout.height);
    // A filed-out negative carrier prints a thin, slightly uneven black keyline around the image.
    const line = Math.max(2, Math.round(Math.max(imageWidth, imageHeight) * 0.0018));
    ctx.fillStyle = '#0c0b09';
    ctx.fillRect(layout.imageX - line, layout.imageY - line, imageWidth + line * 2, imageHeight + line * 2);
  } else if (border === 'rebate') {
    drawRebate(ctx, layout, imageWidth, imageHeight, recipe, frameNumber);
  }
  ctx.putImageData(image, layout.imageX, layout.imageY);

  if (border === 'print') {
    const stock = getStock(recipe.stock);
    const size = Math.max(11, Math.round(Math.max(imageWidth, imageHeight) * 0.0125));
    ctx.font = `500 ${size}px "Geist Mono Variable", ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(20,18,14,0.62)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const y = layout.imageY + imageHeight + (layout.height - layout.imageY - imageHeight) * 0.56;
    ctx.fillText(stock.name, layout.imageX, y);
  }
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality = 0.94): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode this image.'))), type, quality);
  });
}
