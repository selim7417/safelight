// A recipe is everything that decides how a photograph is developed.

import { DEFAULT_STOCK, getStock, STOCK_BY_ID } from './stocks';

export interface Recipe {
  stock: string;
  exposure: number;
  push: number;
  temperature: number;
  tint: number;
  saturation: number;
  contrast: number;
  fade: number;
  vignette: number;
  grain: number;
  halation: number;
  bloom: number;
}

export const DEFAULT_RECIPE: Recipe = {
  stock: DEFAULT_STOCK,
  exposure: 0,
  push: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  contrast: 0,
  fade: 0,
  vignette: 0,
  grain: 1,
  halation: 1,
  bloom: 1,
};

export interface Control {
  key: Exclude<keyof Recipe, 'stock'>;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  hint: string;
}

const signed = (digits: number) => (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
const percent = (v: number) => `${Math.round(v * 100)}%`;

export const CONTROL_GROUPS: { title: string; controls: Control[] }[] = [
  {
    title: 'In camera',
    controls: [
      { key: 'exposure', label: 'Exposure', min: -3, max: 3, step: 0.01, format: (v) => `${signed(2)(v)} EV`, hint: 'How much light reached the film, in stops.' },
      { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01, format: signed(2), hint: 'Colour of the light: cooler to warmer.' },
      { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01, format: signed(2), hint: 'Green to magenta balance.' },
    ],
  },
  {
    title: 'In the tank',
    controls: [
      { key: 'push', label: 'Push / pull', min: -2, max: 3, step: 0.5, format: (v) => `${signed(1)(v)} stops`, hint: 'Longer development builds contrast and grain, and loses shadow detail.' },
      { key: 'grain', label: 'Grain', min: 0, max: 2.5, step: 0.01, format: percent, hint: '100% is this stock’s natural grain.' },
      { key: 'halation', label: 'Halation', min: 0, max: 3, step: 0.01, format: percent, hint: 'Light that scatters back through the film base and glows around highlights.' },
      { key: 'bloom', label: 'Bloom', min: 0, max: 5, step: 0.01, format: percent, hint: 'Soft glow from lens and film diffusion.' },
    ],
  },
  {
    title: 'On the paper',
    controls: [
      { key: 'contrast', label: 'Paper grade', min: -1, max: 1, step: 0.01, format: signed(2), hint: 'Soft to hard paper.' },
      { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01, format: signed(2), hint: 'Relative to what this stock already does.' },
      { key: 'fade', label: 'Fade', min: 0, max: 1, step: 0.01, format: percent, hint: 'Lifts the blacks, like an old print.' },
      { key: 'vignette', label: 'Vignette', min: -1, max: 1, step: 0.01, format: signed(2), hint: 'Burn or dodge the corners.' },
    ],
  },
];

const KEYS = CONTROL_GROUPS.flatMap((g) => g.controls);
const SHORT: Record<Control['key'], string> = {
  exposure: 'e',
  push: 'p',
  temperature: 't',
  tint: 'n',
  saturation: 's',
  contrast: 'c',
  fade: 'f',
  vignette: 'v',
  grain: 'g',
  halation: 'h',
  bloom: 'b',
};

/** A short, human-readable code for sharing a look: SL1_cine800t_e0.5_g1.4 */
export function encodeRecipe(r: Recipe): string {
  const parts = ['SL1', getStock(r.stock).id];
  for (const c of KEYS) {
    const value = r[c.key];
    if (value !== DEFAULT_RECIPE[c.key]) parts.push(`${SHORT[c.key]}${+value.toFixed(2)}`);
  }
  return parts.join('_');
}

export function decodeRecipe(code: string): Recipe | null {
  const match = code.trim().match(/^SL1_([a-z0-9]+)((?:_[a-z]-?\d+(?:\.\d+)?)*)$/);
  if (!match || !STOCK_BY_ID.has(match[1])) return null;
  const recipe: Recipe = { ...DEFAULT_RECIPE, stock: match[1] };
  for (const part of match[2].split('_').filter(Boolean)) {
    const control = KEYS.find((c) => SHORT[c.key] === part[0]);
    const value = parseFloat(part.slice(1));
    if (!control || Number.isNaN(value)) return null;
    recipe[control.key] = Math.max(control.min, Math.min(control.max, value));
  }
  return recipe;
}

/** Scene colour balance as RGB gains. Luminance stays put, so temperature does not change exposure. */
export function whiteBalanceGains(temperature: number, tint: number): [number, number, number] {
  const r = Math.pow(2, temperature * 0.55);
  const b = Math.pow(2, -temperature * 0.55);
  const g = Math.pow(2, -tint * 0.32);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / lum, g / lum, b / lum];
}

/**
 * The exposures for a darkroom test strip: bands of the same picture at stepped exposures,
 * centred on the current setting and kept inside the slider's range.
 */
export function testStripBands(exposure: number, step: number, count: number, min = -3, max = 3): number[] {
  const span = step * (count - 1);
  const start = Math.max(min, Math.min(exposure - span / 2, max - span));
  return Array.from({ length: count }, (_, i) => Math.round((start + step * i) * 100) / 100);
}

/** Grain size in image pixels, so the look stays the same at any resolution. 36 mm is a 35mm frame's width. */
export function grainPixels(sizeUm: number, longEdgePx: number): number {
  return (sizeUm / 36000) * longEdgePx;
}
