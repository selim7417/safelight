import { describe, expect, it } from 'vitest';
import { linearToSrgb, srgbToLinear } from './color';
import { buildLut, channelTransfer, curveStats, LOG_MAX, LOG_MIN, LUT_SIZE, STOP } from './curves';
import { DEFAULT_RECIPE, decodeRecipe, encodeRecipe, grainPixels, testStripBands, whiteBalanceGains } from './recipe';
import {
  cropForRatio,
  DEFAULT_GEOMETRY,
  fitCrop,
  flipHorizontal,
  frameToSource,
  frameToSourcePoint,
  FULL_CROP,
  isDefaultGeometry,
  moveCrop,
  orientedSize,
  outputSize,
  rectInside,
  resizeCrop,
  rotateClockwise,
  type Geometry,
} from './geometry';
import { getStock, STOCKS } from './stocks';
import { createZip, crc32, uniqueFileNames } from './zip';
import { accentFor } from './accent';
import { fitLongEdge, isImageFile } from './images';
import { frameLayout } from '../gl/print';

describe('colour', () => {
  it('round-trips sRGB', () => {
    for (let v = 0; v <= 1; v += 0.05) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
  });
  it('places mid grey where it should be', () => {
    expect(linearToSrgb(0.18)).toBeCloseTo(0.461, 2);
  });
});

describe('every stock', () => {
  for (const stock of STOCKS) {
    describe(stock.name, () => {
      const lut = buildLut(stock);
      it('never gets darker as exposure rises', () => {
        for (let c = 0; c < 3; c++) {
          for (let i = 1; i < LUT_SIZE; i++) {
            expect(lut[i * 4 + c]).toBeGreaterThanOrEqual(lut[(i - 1) * 4 + c] - 1e-5);
          }
        }
      });
      it('lands mid grey on its target', () => {
        for (const c of [0, 1, 2] as const) {
          expect(channelTransfer(stock, c)(0)).toBeCloseTo(stock.mid[c], 3);
        }
      });
      it('has a true black and a clean white', () => {
        for (let c = 0; c < 3; c++) {
          expect(lut[c]).toBeLessThan(0.03);
          expect(lut[(LUT_SIZE - 1) * 4 + c]).toBeGreaterThan(0.75);
          expect(lut[(LUT_SIZE - 1) * 4 + c]).toBeLessThanOrEqual(1);
        }
      });
      it('stays finite', () => {
        expect(lut.every(Number.isFinite)).toBe(true);
      });
      it('has real tonal range', () => {
        const { latitude, contrast } = curveStats(stock);
        expect(latitude).toBeGreaterThan(4);
        expect(contrast).toBeGreaterThan(0.7);
        expect(contrast).toBeLessThan(2.4);
      });
      it('is complete', () => {
        expect(stock.note.length).toBeGreaterThan(30);
        expect(stock.box).toMatch(/^#[0-9a-f]{6}$/);
      });
    });
  }

  it('has unique identifiers', () => {
    expect(new Set(STOCKS.map((s) => s.id)).size).toBe(STOCKS.length);
  });
  it('black and white stocks have identical channels', () => {
    for (const stock of STOCKS.filter((s) => s.mono)) {
      const lut = buildLut(stock);
      for (let i = 0; i < LUT_SIZE; i += 37) {
        expect(lut[i * 4]).toBeCloseTo(lut[i * 4 + 1], 5);
        expect(lut[i * 4 + 1]).toBeCloseTo(lut[i * 4 + 2], 5);
      }
    }
  });
});

describe('film behaviour', () => {
  it('negatives have more latitude than slides', () => {
    const negative = curveStats(getStock('portrait400')).latitude;
    const slide = curveStats(getStock('slide50')).latitude;
    expect(negative).toBeGreaterThan(slide + 2);
  });
  it('slide film has more contrast than portrait film', () => {
    expect(curveStats(getStock('slide50')).contrast).toBeGreaterThan(curveStats(getStock('portrait160')).contrast);
  });
  it('pushing builds contrast and costs latitude', () => {
    const stock = getStock('pan400');
    const normal = curveStats(stock);
    const pushed = curveStats(stock, { push: 2, contrast: 0 });
    expect(pushed.contrast).toBeGreaterThan(normal.contrast);
    expect(pushed.latitude).toBeLessThan(normal.latitude);
  });
  it('harder paper raises contrast, softer lowers it', () => {
    const stock = getStock('fine100');
    const base = curveStats(stock).contrast;
    expect(curveStats(stock, { push: 0, contrast: 1 }).contrast).toBeGreaterThan(base);
    expect(curveStats(stock, { push: 0, contrast: -1 }).contrast).toBeLessThan(base);
  });
  it('holds mid grey steady through push and paper changes', () => {
    const f = channelTransfer(getStock('pan400'), 1, { push: 3, contrast: 0.5 });
    expect(f(0)).toBeCloseTo(0.18, 3);
  });
  it('overexposed portrait film keeps highlight detail that slide film burns out', () => {
    const twoStops = 2 * STOP;
    const threeStops = 3 * STOP;
    const separation = (id: string) => {
      const f = channelTransfer(getStock(id), 1);
      return f(threeStops) - f(twoStops);
    };
    expect(separation('portrait400')).toBeGreaterThan(separation('slide50'));
  });
  it('covers the range the shader can feed it', () => {
    // Highlight expansion tops out at 1 / 0.28 = 3.57. Plus 3 EV peaks near log10(28.6 / 0.18) = 2.2.
    expect(LOG_MAX).toBeGreaterThan(2.2);
    expect(LOG_MIN).toBeLessThan(-3);
  });
  it('white balance leaves luminance alone', () => {
    for (const [t, n] of [[1, 0], [-1, 0], [0, 1], [0.5, -0.5]]) {
      const [r, g, b] = whiteBalanceGains(t, n);
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1, 5);
    }
    expect(whiteBalanceGains(0, 0)).toEqual([1, 1, 1]);
    const [warmR, , warmB] = whiteBalanceGains(0.5, 0);
    expect(warmR).toBeGreaterThan(warmB);
  });
  it('scales grain with the photograph, not the screen', () => {
    expect(grainPixels(36, 6000)).toBeCloseTo(6, 5);
    expect(grainPixels(36, 3000)).toBeCloseTo(3, 5);
  });
});

describe('recipe codes', () => {
  it('round-trips a full recipe', () => {
    const recipe = {
      ...DEFAULT_RECIPE,
      stock: 'cine800t',
      exposure: 0.5,
      push: 1.5,
      temperature: -0.2,
      tint: 0.1,
      grain: 1.4,
      halation: 2,
      vignette: -0.35,
    };
    const code = encodeRecipe(recipe);
    expect(code.startsWith('SL1_cine800t')).toBe(true);
    expect(decodeRecipe(code)).toEqual(recipe);
  });
  it('keeps default recipes short', () => {
    expect(encodeRecipe(DEFAULT_RECIPE)).toBe('SL1_portrait400');
  });
  it('rejects junk and unknown stocks', () => {
    expect(decodeRecipe('hello')).toBeNull();
    expect(decodeRecipe('SL1_notafilm_e1')).toBeNull();
    expect(decodeRecipe('SL1_pan400_q1')).toBeNull();
  });
  it('clamps values from a tampered code', () => {
    expect(decodeRecipe('SL1_pan400_e99')!.exposure).toBe(3);
  });
});

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('writes a well-formed archive', () => {
    const a = new TextEncoder().encode('hello');
    const zip = createZip([{ name: 'a.txt', data: a }, { name: 'é.txt', data: new Uint8Array([1, 2, 3]) }], new Date(2026, 10, 2));
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
  });
  it('gives every file a safe, unique name', () => {
    expect(uniqueFileNames(['a.jpg', 'a.png', 'b/c:d.heic', '...'], ' Pan 400', 'jpg')).toEqual([
      'a Pan 400.jpg',
      'a Pan 400 2.jpg',
      'bcd Pan 400.jpg',
      'photo Pan 400.jpg',
    ]);
  });
});

describe('output sizes', () => {
  it('fits the long edge and never enlarges', () => {
    expect(fitLongEdge(6000, 4000, 2048)).toEqual({ width: 2048, height: 1365 });
    expect(fitLongEdge(4000, 6000, 1080)).toEqual({ width: 720, height: 1080 });
    expect(fitLongEdge(800, 600, 2048)).toEqual({ width: 800, height: 600 });
    expect(fitLongEdge(800, 600, Infinity)).toEqual({ width: 800, height: 600 });
  });
  it('leaves a borderless photo alone', () => {
    expect(frameLayout(1200, 800, 'none')).toEqual({ width: 1200, height: 800, imageX: 0, imageY: 0 });
  });
  it('gives a print a heavier bottom margin', () => {
    const f = frameLayout(1000, 800, 'print');
    const bottom = f.height - f.imageY - 800;
    expect(bottom).toBeGreaterThan(f.imageY);
    expect(f.width - 1000).toBe(f.imageX * 2);
  });
  it('runs sprocket bands along the long edge, in both orientations', () => {
    const wide = frameLayout(1500, 1000, 'rebate');
    expect(wide.height - 1000).toBeGreaterThan(wide.width - 1500);
    const tall = frameLayout(1000, 1500, 'rebate');
    expect(tall.width - 1000).toBeGreaterThan(tall.height - 1500);
    expect(tall.imageX).toBe(wide.imageY);
  });
});

describe('interface helpers', () => {
  it('keeps the accent visible against the dark room', () => {
    expect(accentFor('#f0c44b', '#111111')).toBe('#f0c44b');
    expect(accentFor('#15130f', '#f7e9c9')).toBe('#f7e9c9');
    expect(accentFor('#16507a', '#e6f4ff')).toBe('#e6f4ff');
  });
  it('recognises photos by type or extension', () => {
    const file = (name: string, type: string) => ({ name, type }) as File;
    expect(isImageFile(file('a.jpg', 'image/jpeg'))).toBe(true);
    expect(isImageFile(file('IMG_1.HEIC', ''))).toBe(true);
    expect(isImageFile(file('notes.pdf', 'application/pdf'))).toBe(false);
  });
});

describe('test strip', () => {
  it('centres the bands on the current exposure', () => {
    expect(testStripBands(0, 0.5, 7)).toEqual([-1.5, -1, -0.5, 0, 0.5, 1, 1.5]);
    expect(testStripBands(1, 1, 5)).toEqual([-1, 0, 1, 2, 3]);
  });
  it('slides the window to stay inside the slider range', () => {
    expect(testStripBands(2.8, 0.5, 7)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    expect(testStripBands(-3, 0.5, 5)).toEqual([-3, -2.5, -2, -1.5, -1]);
  });
});

describe('geometry', () => {
  const W = 3000;
  const H = 2000;
  const close = (a: [number, number], b: [number, number]) => {
    expect(a[0]).toBeCloseTo(b[0], 6);
    expect(a[1]).toBeCloseTo(b[1], 6);
  };
  const tilted: Geometry = { quarter: 1, flip: true, angle: 7, crop: { x: 0.2, y: 0.25, w: 0.4, h: 0.3 }, lock: null };

  it('samples the photo straight through by default', () => {
    close(frameToSourcePoint(DEFAULT_GEOMETRY, W, H, 0.25, 0.75), [0.25, 0.75]);
    expect(frameToSource(DEFAULT_GEOMETRY, W, H)).toEqual([1, 0, 0, 0, 1, 0]);
    expect(isDefaultGeometry(DEFAULT_GEOMETRY)).toBe(true);
  });

  it('turns clockwise: the top-left of the photo lands at the top-right', () => {
    const g = rotateClockwise(DEFAULT_GEOMETRY);
    close(frameToSourcePoint(g, W, H, 1, 0), [0, 0]);
    close(frameToSourcePoint(g, W, H, 1, 1), [1, 0]);
    close(frameToSourcePoint(g, W, H, 0, 0), [0, 1]);
    expect(orientedSize(g, W, H)).toEqual({ width: H, height: W });
    expect(outputSize(g, W, H)).toEqual({ width: H, height: W });
  });

  it('mirrors left to right', () => {
    const g = flipHorizontal(DEFAULT_GEOMETRY);
    close(frameToSourcePoint(g, W, H, 0, 0), [1, 0]);
    close(frameToSourcePoint(g, W, H, 1, 0.5), [0, 0.5]);
  });

  it('crops: the frame maps onto the chosen part of the photo', () => {
    const g: Geometry = { ...DEFAULT_GEOMETRY, crop: { x: 0.5, y: 0.25, w: 0.5, h: 0.5 } };
    close(frameToSourcePoint(g, W, H, 0, 0), [0.5, 0.25]);
    close(frameToSourcePoint(g, W, H, 1, 1), [1, 0.75]);
    expect(outputSize(g, W, H)).toEqual({ width: 1500, height: 1000 });
  });

  it('straightens clockwise about the centre, in true pixels', () => {
    const g: Geometry = { ...DEFAULT_GEOMETRY, angle: 90 };
    // On screen, what was at the top of the photo moves to the right.
    close(frameToSourcePoint(g, 1000, 1000, 1, 0.5), [0.5, 0]);
    close(frameToSourcePoint(g, 1000, 1000, 0.5, 0.5), [0.5, 0.5]);
  });

  it('keeps straight lines straight: the shader matrix equals the exact mapping', () => {
    for (const g of [DEFAULT_GEOMETRY, tilted, rotateClockwise(tilted), flipHorizontal(tilted)]) {
      const [a, b, c, d, e, f] = frameToSource(g, W, H);
      for (const [x, y] of [[0.1, 0.9], [0.5, 0.5], [0.73, 0.21]]) {
        close([a * x + b * y + c, d * x + e * y + f], frameToSourcePoint(g, W, H, x, y));
      }
    }
  });

  it('rotating keeps the same image under the same turned point', () => {
    for (const g of [DEFAULT_GEOMETRY, tilted, { ...tilted, flip: false }, { ...tilted, quarter: 3 as const }]) {
      const turned = rotateClockwise(g);
      for (const [x, y] of [[0, 0], [1, 0], [0.3, 0.8], [0.5, 0.5]]) {
        close(frameToSourcePoint(turned, W, H, 1 - y, x), frameToSourcePoint(g, W, H, x, y));
      }
    }
  });

  it('mirroring keeps the same image under the same mirrored point', () => {
    for (const g of [DEFAULT_GEOMETRY, tilted, { ...tilted, quarter: 2 as const }]) {
      const mirrored = flipHorizontal(g);
      for (const [x, y] of [[0, 0], [0.3, 0.8], [1, 1]]) {
        close(frameToSourcePoint(mirrored, W, H, 1 - x, y), frameToSourcePoint(g, W, H, x, y));
      }
    }
  });

  it('four turns, or two mirrors, come back to the start', () => {
    let g = tilted;
    for (let i = 0; i < 4; i++) g = rotateClockwise(g);
    expect(g.quarter).toBe(tilted.quarter);
    expect(g.crop.x).toBeCloseTo(tilted.crop.x, 9);
    expect(g.crop.h).toBeCloseTo(tilted.crop.h, 9);
    const back = flipHorizontal(flipHorizontal(tilted));
    expect(back.flip).toBe(tilted.flip);
    expect(back.angle).toBe(tilted.angle);
    expect(back.crop.x).toBeCloseTo(tilted.crop.x, 9);
  });

  it('turning inverts a locked crop shape', () => {
    const g = rotateClockwise({ ...DEFAULT_GEOMETRY, lock: 4 / 5 });
    expect(g.lock).toBeCloseTo(5 / 4, 9);
  });

  it('straightening shrinks the crop so no empty corners show', () => {
    const fitted = fitCrop(FULL_CROP, 5, W, H);
    expect(rectInside(FULL_CROP, 5, W, H)).toBe(false);
    expect(rectInside(fitted, 5, W, H)).toBe(true);
    expect(fitted.w).toBeLessThan(1);
    expect(fitted.w).toBeGreaterThan(0.7);
    expect(fitted.w).toBeCloseTo(fitted.h, 9);
    // Every corner of the output really samples inside the photo.
    const g: Geometry = { ...DEFAULT_GEOMETRY, angle: 5, crop: fitted };
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const [u, v] = frameToSourcePoint(g, W, H, x, y);
      expect(u).toBeGreaterThanOrEqual(-1e-5);
      expect(u).toBeLessThanOrEqual(1 + 1e-5);
      expect(v).toBeGreaterThanOrEqual(-1e-5);
      expect(v).toBeLessThanOrEqual(1 + 1e-5);
    }
  });

  it('leaves a crop alone when it already fits', () => {
    const small = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    expect(fitCrop(small, 5, W, H)).toEqual(small);
  });

  it('makes crops of the exact shape asked for', () => {
    const square = cropForRatio(1, 0, W, H);
    expect(square.w * W).toBeCloseTo(square.h * H, 6);
    expect(square.h).toBeCloseTo(1, 9);
    expect(square.x).toBeCloseTo((1 - square.w) / 2, 9);
    const wide = cropForRatio(16 / 9, 0, W, H);
    expect((wide.w * W) / (wide.h * H)).toBeCloseTo(16 / 9, 6);
    const portrait = cropForRatio(4 / 5, 3, W, H);
    expect((portrait.w * W) / (portrait.h * H)).toBeCloseTo(4 / 5, 6);
    expect(rectInside(portrait, 3, W, H)).toBe(true);
  });

  it('slides along an edge instead of sticking to it', () => {
    const start = { x: 0.5, y: 0.5, w: 0.25, h: 0.25 };
    const moved = moveCrop(start, 0.5, 0.1, 0, W, H);
    expect(moved.x).toBeCloseTo(0.75, 3);
    expect(moved.y).toBeCloseTo(0.6, 6);
    expect(moved.w).toBe(0.25);
  });

  it('resizes from a handle, anchoring the opposite side', () => {
    const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    const se = resizeCrop(start, 'se', 0.1, 0.2, null, 0, W, H);
    expect(se).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.5, 9), h: expect.closeTo(0.6, 9) });
    const nw = resizeCrop(start, 'nw', 0.1, 0.1, null, 0, W, H);
    expect(nw.x + nw.w).toBeCloseTo(0.6, 9);
    expect(nw.y + nw.h).toBeCloseTo(0.6, 9);
    expect(nw.w).toBeCloseTo(0.3, 9);
  });

  it('never collapses a crop to nothing', () => {
    const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    const tiny = resizeCrop(start, 'se', -5, -5, null, 0, W, H);
    expect(tiny.w).toBeGreaterThan(0.01);
    expect(tiny.h).toBeGreaterThan(0.01);
    const locked = resizeCrop(start, 'se', -5, -5, 1, 0, W, H);
    expect(locked.w).toBeGreaterThan(0.01);
  });

  it('holds a locked shape through every handle, and stops at the edge', () => {
    const start = cropForRatio(1, 0, W, H);
    const smaller = { x: 0.4, y: 0.3, w: 0.2, h: 0.3 }; // square in pixels
    for (const handle of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
      const r = resizeCrop(smaller, handle, 0.03, -0.02, 1, 0, W, H);
      expect((r.w * W) / (r.h * H)).toBeCloseTo(1, 6);
      expect(rectInside(r, 0, W, H)).toBe(true);
    }
    const huge = resizeCrop(start, 'se', 3, 3, 1, 0, W, H);
    expect((huge.w * W) / (huge.h * H)).toBeCloseTo(1, 6);
    expect(rectInside(huge, 0, W, H)).toBe(true);
  });

  it('stays on the picture while straightened', () => {
    const start = fitCrop({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, 12, W, H);
    expect(rectInside(moveCrop(start, 2, 2, 12, W, H), 12, W, H)).toBe(true);
    expect(rectInside(resizeCrop(start, 'se', 2, 2, null, 12, W, H), 12, W, H)).toBe(true);
  });
});
