// Crop, rotate and straighten. Nothing here touches pixels: a geometry is a description, and the
// shader samples the photograph through it. That keeps every edit lossless and undoable.
//
// A photograph is displayed in this order: quarter turns, then mirror, then straighten about the
// centre. The crop rectangle lives in the result, as fractions of that oriented frame.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Geometry {
  /** Clockwise quarter turns. */
  quarter: 0 | 1 | 2 | 3;
  flip: boolean;
  /** Degrees. Positive turns the picture clockwise on screen. */
  angle: number;
  crop: Rect;
  /** Locked crop shape as width / height in pixels, or null for free. */
  lock: number | null;
}

/** u = a·x + b·y + c, v = d·x + e·y + f, from output-frame fractions to source-image fractions. */
export type Affine = [a: number, b: number, c: number, d: number, e: number, f: number];

export const FULL_CROP: Rect = { x: 0, y: 0, w: 1, h: 1 };
export const DEFAULT_GEOMETRY: Geometry = { quarter: 0, flip: false, angle: 0, crop: FULL_CROP, lock: null };
export const MAX_ANGLE = 20;
const MIN_SIZE = 0.04;
const EPSILON = 1e-6;
const RAD = Math.PI / 180;

export interface Size {
  width: number;
  height: number;
}

/** The photograph's size after quarter turns. */
export function orientedSize(g: Pick<Geometry, 'quarter'>, width: number, height: number): Size {
  return g.quarter % 2 ? { width: height, height: width } : { width, height };
}

/** The finished picture's size in pixels. */
export function outputSize(g: Geometry, width: number, height: number): Size {
  const o = orientedSize(g, width, height);
  return { width: Math.max(1, Math.round(g.crop.w * o.width)), height: Math.max(1, Math.round(g.crop.h * o.height)) };
}

/** Where a point of the output frame samples the source photograph. */
export function frameToSourcePoint(g: Geometry, width: number, height: number, x: number, y: number): [number, number] {
  const o = orientedSize(g, width, height);
  // Crop to oriented pixels, relative to the centre.
  const rx = (g.crop.x + x * g.crop.w - 0.5) * o.width;
  const ry = (g.crop.y + y * g.crop.h - 0.5) * o.height;
  // Showing the picture turned clockwise means sampling it turned the other way. y points down.
  const c = Math.cos(g.angle * RAD);
  const s = Math.sin(g.angle * RAD);
  let nx = (c * rx + s * ry) / o.width + 0.5;
  const ny = (-s * rx + c * ry) / o.height + 0.5;
  if (g.flip) nx = 1 - nx;
  switch (g.quarter) {
    case 1:
      return [ny, 1 - nx];
    case 2:
      return [1 - nx, 1 - ny];
    case 3:
      return [1 - ny, nx];
    default:
      return [nx, ny];
  }
}

export function frameToSource(g: Geometry, width: number, height: number): Affine {
  const [c, f] = frameToSourcePoint(g, width, height, 0, 0);
  const [ax, dx] = frameToSourcePoint(g, width, height, 1, 0);
  const [bx, ey] = frameToSourcePoint(g, width, height, 0, 1);
  return [ax - c, bx - c, c, dx - f, ey - f, f];
}

/** Whether a crop lies wholly on the picture once straightened. */
export function rectInside(rect: Rect, angle: number, orientedW: number, orientedH: number): boolean {
  const c = Math.cos(angle * RAD);
  const s = Math.sin(angle * RAD);
  for (const [px, py] of [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h],
  ]) {
    const rx = (px - 0.5) * orientedW;
    const ry = (py - 0.5) * orientedH;
    const nx = (c * rx + s * ry) / orientedW + 0.5;
    const ny = (-s * rx + c * ry) / orientedH + 0.5;
    if (nx < -EPSILON || nx > 1 + EPSILON || ny < -EPSILON || ny > 1 + EPSILON) return false;
  }
  return true;
}

const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
});

/** Goes as far from a valid rectangle towards a target as the picture's edge allows. */
function limit(from: Rect, to: Rect, inside: (r: Rect) => boolean): Rect {
  if (inside(to)) return to;
  if (!inside(from)) return from;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inside(lerpRect(from, to, mid))) lo = mid;
    else hi = mid;
  }
  return lerpRect(from, to, lo);
}

/** The largest version of a crop, same shape and centre, that fits at this angle. */
export function fitCrop(base: Rect, angle: number, orientedW: number, orientedH: number): Rect {
  const inside = (r: Rect) => rectInside(r, angle, orientedW, orientedH);
  if (inside(base)) return base;
  let cx = base.x + base.w / 2;
  let cy = base.y + base.h / 2;
  // Tiny tilts keep the centre on the picture; pull it inwards if a corner crop has lost it.
  const point = (x: number, y: number): Rect => ({ x, y, w: 0, h: 0 });
  if (!inside(point(cx, cy))) {
    const moved = limit(point(0.5, 0.5), point(cx, cy), inside);
    cx = moved.x;
    cy = moved.y;
  }
  const centred = (scale: number): Rect => ({
    x: cx - (base.w * scale) / 2,
    y: cy - (base.h * scale) / 2,
    w: base.w * scale,
    h: base.h * scale,
  });
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inside(centred(mid))) lo = mid;
    else hi = mid;
  }
  return centred(lo);
}

/** The largest crop of a given shape, centred on the picture. */
export function cropForRatio(ratio: number, angle: number, orientedW: number, orientedH: number): Rect {
  const frameRatio = orientedW / orientedH;
  const w = ratio >= frameRatio ? 1 : ratio / frameRatio;
  const h = ratio >= frameRatio ? frameRatio / ratio : 1;
  return fitCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h }, angle, orientedW, orientedH);
}

export function moveCrop(start: Rect, dx: number, dy: number, angle: number, orientedW: number, orientedH: number): Rect {
  const inside = (r: Rect) => rectInside(r, angle, orientedW, orientedH);
  // One axis at a time, so a crop slides along an edge instead of sticking to it.
  const horizontal = limit(start, { ...start, x: start.x + dx }, inside);
  return limit(horizontal, { ...horizontal, y: horizontal.y + dy }, inside);
}

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function resizeCrop(
  start: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  lock: number | null,
  angle: number,
  orientedW: number,
  orientedH: number,
): Rect {
  const inside = (r: Rect) => rectInside(r, angle, orientedW, orientedH);
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');

  if (lock === null) {
    const moveX = (r: Rect): Rect => {
      if (west) {
        const right = r.x + r.w;
        const x = Math.min(r.x + dx, right - MIN_SIZE);
        return { ...r, x, w: right - x };
      }
      return east ? { ...r, w: Math.max(r.w + dx, MIN_SIZE) } : r;
    };
    const moveY = (r: Rect): Rect => {
      if (north) {
        const bottom = r.y + r.h;
        const y = Math.min(r.y + dy, bottom - MIN_SIZE);
        return { ...r, y, h: bottom - y };
      }
      return south ? { ...r, h: Math.max(r.h + dy, MIN_SIZE) } : r;
    };
    const horizontal = limit(start, moveX(start), inside);
    return limit(horizontal, moveY(horizontal), inside);
  }

  // A locked shape has one degree of freedom: whichever axis moved furthest leads.
  const ratio = (lock * orientedH) / orientedW; // width / height as fractions of the frame
  const wantW = start.w + (east ? dx : west ? -dx : 0);
  const wantH = start.h + (south ? dy : north ? -dy : 0);
  const fromW = Math.abs(wantW - start.w);
  const fromH = Math.abs(wantH - start.h) * ratio;
  const horizontalLeads = (east || west) && (!(north || south) || fromW >= fromH);
  let w = horizontalLeads ? wantW : wantH * ratio;
  w = Math.max(w, MIN_SIZE, MIN_SIZE * ratio);
  const h = w / ratio;

  const x = west ? start.x + start.w - w : east ? start.x : start.x + (start.w - w) / 2;
  const y = north ? start.y + start.h - h : south ? start.y : start.y + (start.h - h) / 2;
  return limit(start, { x, y, w, h }, inside);
}

/** Turns the finished picture a quarter clockwise. The same part of the photo stays in the crop. */
export function rotateClockwise(g: Geometry): Geometry {
  const { x, y, w, h } = g.crop;
  return {
    ...g,
    // Mirroring happens after the quarter turn, so with a mirror on, the source turns the other way.
    quarter: (((g.quarter + (g.flip ? 3 : 1)) % 4) as Geometry['quarter']),
    crop: { x: 1 - y - h, y: x, w: h, h: w },
    lock: g.lock === null ? null : 1 / g.lock,
  };
}

/** Mirrors the finished picture left to right. */
export function flipHorizontal(g: Geometry): Geometry {
  return { ...g, flip: !g.flip, angle: -g.angle, crop: { ...g.crop, x: 1 - g.crop.x - g.crop.w } };
}

export const isDefaultGeometry = (g: Geometry) =>
  g.quarter === 0 &&
  !g.flip &&
  g.angle === 0 &&
  g.lock === null &&
  g.crop.x === 0 &&
  g.crop.y === 0 &&
  g.crop.w === 1 &&
  g.crop.h === 1;
