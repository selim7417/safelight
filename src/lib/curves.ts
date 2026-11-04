// Characteristic curves: how much density a film builds for a given exposure.
// A colour negative is modelled as two stages, as in a real lab: scene to negative, then
// negative to print. Slide film is one stage. The same numbers drive the shader's lookup
// table, the chart in the interface, and the tests, so they can never disagree.

import type { Layer, Stock } from './stocks';

/** The lookup table covers log10 exposure relative to mid grey. 1 stop = 0.301. */
export const LOG_MIN = -3.2;
export const LOG_MAX = 2.6;
export const LUT_SIZE = 1024;
export const STOP = Math.log10(2);

function softplus(x: number, k: number): number {
  const v = x * k;
  if (v > 40) return x;
  return Math.log1p(Math.exp(v)) / k;
}

/** Zero below the toe, straight at slope `gamma`, levelling off past the shoulder. */
export function density(x: number, l: Layer, softToe: number, softShoulder: number): number {
  return l.gamma * (softplus(x - l.toe, softToe) - softplus(x - l.shoulder, softShoulder));
}

export interface Development {
  /** Push (+) or pull (−) in stops. Longer development raises contrast and costs shadow detail. */
  push: number;
  /** Paper grade: −1 soft to +1 hard. */
  contrast: number;
}

export const NO_DEVELOPMENT: Development = { push: 0, contrast: 0 };

function developedLayer(l: Layer, d: Development): Layer {
  return {
    gamma: l.gamma * (1 + 0.13 * d.push),
    toe: l.toe + 0.055 * d.push,
    shoulder: l.shoulder - 0.02 * d.push,
  };
}

function printDensity(logExposure: number, stock: Stock, gammaScale: number): number {
  const g = stock.paperGamma * gammaScale;
  const dmin = 0.012;
  const shoulder = stock.paperDmax / g;
  return dmin + g * (softplus(logExposure, 7.5) - softplus(logExposure - shoulder, 5.5));
}

function negativeOutput(x: number, l: Layer, stock: Stock, printer: number, paperScale: number): number {
  const dn = density(x, l, stock.softToe, stock.softShoulder);
  return Math.pow(10, -printDensity(printer - dn, stock, paperScale));
}

function reversalOutput(x: number, l: Layer, stock: Stock, shift: number, contrastScale: number): number {
  const scaled = { ...l, gamma: l.gamma * contrastScale };
  const range = l.gamma * contrastScale * (l.shoulder - l.toe);
  const d = 0.04 + Math.max(0, Math.min(stock.paperDmax, range)) - density(x + shift, scaled, stock.softToe, stock.softShoulder);
  return Math.pow(10, -Math.max(d, 0));
}

/** Finds the printer light (or slide exposure shift) that lands mid grey on the stock's target. */
function calibrate(fn: (offset: number) => number, target: number): number {
  let lo = -4;
  let hi = 4;
  const rising = fn(hi) > fn(lo);
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const value = fn(mid);
    if (value < target === rising) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export type Transfer = (x: number) => number;

/** One channel's response: log10 exposure in, linear print reflectance out. */
export function channelTransfer(stock: Stock, channel: 0 | 1 | 2, dev: Development = NO_DEVELOPMENT): Transfer {
  const l = developedLayer(stock.layers[channel], dev);
  const target = stock.mid[channel];
  if (stock.process === 'negative') {
    const scale = 1 + 0.32 * dev.contrast;
    const printer = calibrate((offset) => negativeOutput(0, l, stock, offset, scale), target);
    return (x) => negativeOutput(x, l, stock, printer, scale);
  }
  const scale = 1 + 0.25 * dev.contrast;
  const shift = calibrate((offset) => reversalOutput(0, l, stock, offset, scale), target);
  return (x) => reversalOutput(x, l, stock, shift, scale);
}

/** RGBA float table for the shader. */
export function buildLut(stock: Stock, dev: Development = NO_DEVELOPMENT): Float32Array {
  const lut = new Float32Array(LUT_SIZE * 4);
  const transfers = [channelTransfer(stock, 0, dev), channelTransfer(stock, 1, dev), channelTransfer(stock, 2, dev)];
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = LOG_MIN + ((LOG_MAX - LOG_MIN) * i) / (LUT_SIZE - 1);
    lut[i * 4] = transfers[0](x);
    lut[i * 4 + 1] = transfers[1](x);
    lut[i * 4 + 2] = transfers[2](x);
    lut[i * 4 + 3] = 1;
  }
  return lut;
}

export interface CurveStats {
  /** Usable range of the film, in stops. */
  latitude: number;
  /** Tonal contrast around mid grey. */
  contrast: number;
}

/** Measures a stock the way a datasheet would: slope at mid grey and the range holding visible detail. */
export function curveStats(stock: Stock, dev: Development = NO_DEVELOPMENT): CurveStats {
  const f = channelTransfer(stock, 1, dev);
  const slope = (x: number) => {
    const h = 0.02;
    return (Math.log10(f(x + h)) - Math.log10(f(x - h))) / (2 * h);
  };
  const contrast = slope(0);
  const threshold = 0.16;
  let low = 0;
  while (low > LOG_MIN && slope(low) > threshold) low -= 0.01;
  let high = 0;
  while (high < LOG_MAX && slope(high) > threshold) high += 0.01;
  return { latitude: (high - low) / STOP, contrast };
}
