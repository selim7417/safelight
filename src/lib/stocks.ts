// The film stocks. Each one is a description of chemistry, not a colour filter:
// how each dye layer responds to light, how the layers bleed into each other,
// how big the grain is and how much light scatters back through the base.
//
// These are original models inspired by the character of classic emulsions. They are
// not measured from, or affiliated with, any manufacturer's product.

export type StockKind = 'Colour negative' | 'Motion picture' | 'Slide' | 'Black & white' | 'Infrared';

export interface Layer {
  /** Slope of the straight-line portion, density per log10 of exposure. */
  gamma: number;
  /** log10 exposure, relative to mid grey, where the toe begins. */
  toe: number;
  /** log10 exposure where the shoulder rolls off. */
  shoulder: number;
}

export interface Stock {
  id: string;
  name: string;
  iso: string;
  kind: StockKind;
  /** Printed along the film edge. */
  code: string;
  /** Colour of the box, and the interface's accent while this stock is loaded. */
  box: string;
  boxInk: string;
  note: string;
  process: 'negative' | 'reversal';
  layers: [Layer, Layer, Layer];
  softToe: number;
  softShoulder: number;
  /** Print or transparency: steepness and maximum density of the viewing medium. */
  paperGamma: number;
  paperDmax: number;
  /** Output for a mid-grey scene. Unequal channels are the stock's colour cast. */
  mid: [number, number, number];
  /** Crosstalk between dye layers: how the film sees scene colour. Row = layer. */
  matrix: [number, number, number, number, number, number, number, number, number];
  saturation: number;
  grain: { sizeUm: number; amount: number; chroma: number };
  halation: { amount: number; radius: number; color: [number, number, number] };
  bloom: number;
  mono?: { weights: [number, number, number]; shadow: [number, number, number]; highlight: [number, number, number] };
  infrared?: boolean;
}

/** A symmetric crosstalk matrix: 1 is neutral, above 1 widens colour, below narrows it. */
function spread(s: number): Stock['matrix'] {
  const o = (1 - s) / 3;
  const d = o + s;
  return [d, o, o, o, d, o, o, o, d];
}

const layer = (gamma: number, toe: number, shoulder: number): Layer => ({ gamma, toe, shoulder });
const NEG_PAPER = { paperGamma: 2.15, paperDmax: 2.15 };
const SLIDE_PAPER = { paperGamma: 1, paperDmax: 3.0 };
const IDENTITY = spread(1);
const WARM_HALO: [number, number, number] = [1, 0.42, 0.16];
const RED_HALO: [number, number, number] = [1, 0.2, 0.06];

export const STOCKS: Stock[] = [
  {
    id: 'portrait160',
    name: 'Portrait 160',
    iso: '160',
    kind: 'Colour negative',
    code: 'PORTRAIT 160',
    box: '#e8b23a',
    boxInk: '#2a1d05',
    note: 'Low contrast and forgiving, built for skin. Holds detail in a bright window and in the shadow beside it.',
    process: 'negative',
    layers: [layer(0.49, -1.52, 1.75), layer(0.49, -1.5, 1.75), layer(0.47, -1.48, 1.7)],
    softToe: 5,
    softShoulder: 2.6,
    ...NEG_PAPER,
    mid: [0.188, 0.18, 0.17],
    matrix: [0.97, 0.05, -0.02, 0.0, 0.96, 0.04, -0.01, 0.05, 0.96],
    saturation: 0.94,
    grain: { sizeUm: 24, amount: 0.024, chroma: 0.45 },
    halation: { amount: 0.16, radius: 0.007, color: WARM_HALO },
    bloom: 0.02,
  },
  {
    id: 'portrait400',
    name: 'Portrait 400',
    iso: '400',
    kind: 'Colour negative',
    code: 'PORTRAIT 400',
    box: '#f0c44b',
    boxInk: '#2a1d05',
    note: 'Pastel highlights and enormous latitude. Overexpose it by two stops and it only gets creamier.',
    process: 'negative',
    layers: [layer(0.47, -1.6, 2.0), layer(0.47, -1.58, 2.0), layer(0.45, -1.54, 1.95)],
    softToe: 4.6,
    softShoulder: 2.2,
    ...NEG_PAPER,
    mid: [0.194, 0.183, 0.17],
    matrix: [0.98, 0.04, -0.02, 0.0, 0.98, 0.02, -0.01, 0.03, 0.98],
    saturation: 0.97,
    grain: { sizeUm: 30, amount: 0.036, chroma: 0.5 },
    halation: { amount: 0.2, radius: 0.008, color: WARM_HALO },
    bloom: 0.03,
  },
  {
    id: 'gold200',
    name: 'Gold 200',
    iso: '200',
    kind: 'Colour negative',
    code: 'GOLD 200',
    box: '#e98a1f',
    boxInk: '#2b1102',
    note: 'The family album. Warm through the midtones, with blues that lean slightly toward cyan.',
    process: 'negative',
    layers: [layer(0.56, -1.42, 1.5), layer(0.54, -1.34, 1.45), layer(0.5, -1.18, 1.32)],
    softToe: 5,
    softShoulder: 3,
    ...NEG_PAPER,
    mid: [0.206, 0.18, 0.146],
    matrix: [1.06, -0.02, -0.04, -0.03, 1.08, -0.05, -0.05, 0.07, 0.98],
    saturation: 1.1,
    grain: { sizeUm: 34, amount: 0.044, chroma: 0.6 },
    halation: { amount: 0.26, radius: 0.009, color: WARM_HALO },
    bloom: 0.03,
  },
  {
    id: 'everyday400',
    name: 'Everyday 400',
    iso: '400',
    kind: 'Colour negative',
    code: 'EVERYDAY 400',
    box: '#2f9e6e',
    boxInk: '#04190f',
    note: 'A drugstore classic. Green-tinted shadows, a magenta lift in the highlights, and honest grain.',
    process: 'negative',
    layers: [layer(0.54, -1.28, 1.42), layer(0.57, -1.46, 1.46), layer(0.53, -1.3, 1.5)],
    softToe: 4.8,
    softShoulder: 3,
    ...NEG_PAPER,
    mid: [0.175, 0.187, 0.176],
    matrix: [1.05, -0.03, -0.02, -0.04, 1.08, -0.04, -0.02, -0.03, 1.05],
    saturation: 1.06,
    grain: { sizeUm: 38, amount: 0.052, chroma: 0.7 },
    halation: { amount: 0.22, radius: 0.009, color: WARM_HALO },
    bloom: 0.02,
  },
  {
    id: 'vivid100',
    name: 'Vivid 100',
    iso: '100',
    kind: 'Colour negative',
    code: 'VIVID 100',
    box: '#d6332e',
    boxInk: '#fff0e6',
    note: 'The finest grain of any negative here, with saturation close to slide film and a negative’s latitude.',
    process: 'negative',
    layers: [layer(0.6, -1.34, 1.5), layer(0.6, -1.34, 1.5), layer(0.59, -1.34, 1.48)],
    softToe: 5.4,
    softShoulder: 3.2,
    ...NEG_PAPER,
    mid: [0.184, 0.18, 0.174],
    matrix: [1.18, -0.1, -0.08, -0.07, 1.16, -0.09, -0.04, -0.12, 1.16],
    saturation: 1.14,
    grain: { sizeUm: 15, amount: 0.014, chroma: 0.4 },
    halation: { amount: 0.1, radius: 0.006, color: WARM_HALO },
    bloom: 0.01,
  },
  {
    id: 'cine800t',
    name: 'Cine 800T',
    iso: '800T',
    kind: 'Motion picture',
    code: 'CINE 800T',
    box: '#16507a',
    boxInk: '#e6f4ff',
    note: 'Cinema film without its anti-halation backing, so light scatters back through the base. Every streetlamp grows a red halo.',
    process: 'negative',
    layers: [layer(0.54, -1.24, 1.68), layer(0.56, -1.42, 1.62), layer(0.56, -1.56, 1.58)],
    softToe: 4.6,
    softShoulder: 2.6,
    ...NEG_PAPER,
    mid: [0.166, 0.18, 0.2],
    matrix: [1.02, 0.02, -0.04, -0.02, 1.03, -0.01, -0.03, 0.0, 1.03],
    saturation: 0.98,
    grain: { sizeUm: 38, amount: 0.05, chroma: 0.65 },
    halation: { amount: 1.05, radius: 0.017, color: RED_HALO },
    bloom: 0.06,
  },
  {
    id: 'cine250d',
    name: 'Cine 250D',
    iso: '250D',
    kind: 'Motion picture',
    code: 'CINE 250D',
    box: '#7c2d3a',
    boxInk: '#ffeef0',
    note: 'Daylight motion picture stock. Flat, rich and quiet, with colour that holds together in the shadows.',
    process: 'negative',
    layers: [layer(0.46, -1.62, 1.88), layer(0.46, -1.6, 1.86), layer(0.45, -1.58, 1.82)],
    softToe: 4.4,
    softShoulder: 2.4,
    ...NEG_PAPER,
    mid: [0.184, 0.18, 0.172],
    matrix: [0.97, 0.05, -0.02, 0.01, 0.96, 0.03, -0.01, 0.05, 0.96],
    saturation: 0.95,
    grain: { sizeUm: 24, amount: 0.026, chroma: 0.45 },
    halation: { amount: 0.3, radius: 0.01, color: RED_HALO },
    bloom: 0.03,
  },
  {
    id: 'slide50',
    name: 'Slide 50',
    iso: '50',
    kind: 'Slide',
    code: 'SLIDE 50',
    box: '#1f7a4d',
    boxInk: '#e8fff3',
    note: 'A landscape photographer’s film. Saturated greens and deep blues, punishing contrast and almost no latitude.',
    process: 'reversal',
    layers: [layer(1.6, -0.86, 0.72), layer(1.62, -0.84, 0.72), layer(1.6, -0.84, 0.7)],
    softToe: 7.5,
    softShoulder: 6.5,
    ...SLIDE_PAPER,
    mid: [0.17, 0.178, 0.178],
    matrix: [1.24, -0.14, -0.1, -0.1, 1.24, -0.14, -0.05, -0.17, 1.22],
    saturation: 1.16,
    grain: { sizeUm: 13, amount: 0.012, chroma: 0.4 },
    halation: { amount: 0.05, radius: 0.005, color: WARM_HALO },
    bloom: 0,
  },
  {
    id: 'slide100',
    name: 'Slide 100',
    iso: '100',
    kind: 'Slide',
    code: 'SLIDE 100',
    box: '#2a6fb0',
    boxInk: '#eef6ff',
    note: 'The neutral reference. Clean, accurate colour and crisp blacks, projected straight off the transparency.',
    process: 'reversal',
    layers: [layer(1.4, -1.0, 0.86), layer(1.4, -1.0, 0.86), layer(1.4, -1.0, 0.86)],
    softToe: 6.6,
    softShoulder: 5.4,
    ...SLIDE_PAPER,
    mid: [0.18, 0.18, 0.18],
    matrix: [1.08, -0.05, -0.03, -0.04, 1.08, -0.04, -0.02, -0.05, 1.07],
    saturation: 1.06,
    grain: { sizeUm: 16, amount: 0.015, chroma: 0.4 },
    halation: { amount: 0.06, radius: 0.005, color: WARM_HALO },
    bloom: 0,
  },
  {
    id: 'chrome64',
    name: 'Chrome 64',
    iso: '64',
    kind: 'Slide',
    code: 'CHROME 64',
    box: '#b8452a',
    boxInk: '#fff1e6',
    note: 'Mid-century magazine colour. Dense reds, warm earth tones and shadows that sit heavy on the page.',
    process: 'reversal',
    layers: [layer(1.42, -0.94, 0.84), layer(1.5, -0.88, 0.76), layer(1.5, -0.84, 0.72)],
    softToe: 6.8,
    softShoulder: 5.6,
    ...SLIDE_PAPER,
    mid: [0.19, 0.172, 0.15],
    matrix: [1.22, -0.1, -0.12, -0.03, 1.1, -0.07, -0.02, -0.1, 1.12],
    saturation: 1.08,
    grain: { sizeUm: 18, amount: 0.018, chroma: 0.45 },
    halation: { amount: 0.08, radius: 0.006, color: WARM_HALO },
    bloom: 0,
  },
  {
    id: 'pan400',
    name: 'Pan 400',
    iso: '400',
    kind: 'Black & white',
    code: 'PAN 400',
    box: '#f2efe6',
    boxInk: '#111111',
    note: 'Sixty years of photojournalism in one emulsion. Gritty, tonal and impossible to ruin.',
    process: 'negative',
    layers: [layer(0.6, -1.32, 1.6), layer(0.6, -1.32, 1.6), layer(0.6, -1.32, 1.6)],
    softToe: 4.8,
    softShoulder: 2.8,
    ...NEG_PAPER,
    mid: [0.18, 0.18, 0.18],
    matrix: IDENTITY,
    saturation: 1,
    grain: { sizeUm: 46, amount: 0.08, chroma: 0 },
    halation: { amount: 0.14, radius: 0.008, color: [1, 1, 1] },
    bloom: 0.02,
    mono: { weights: [0.34, 0.52, 0.14], shadow: [1, 1, 1], highlight: [1, 0.995, 0.98] },
  },
  {
    id: 'fine100',
    name: 'Fine 100',
    iso: '100',
    kind: 'Black & white',
    code: 'FINE 100',
    box: '#c7ccd1',
    boxInk: '#10151a',
    note: 'A modern tabular-grain film. Smooth to the point of silk, with long and even tones.',
    process: 'negative',
    layers: [layer(0.54, -1.46, 1.72), layer(0.54, -1.46, 1.72), layer(0.54, -1.46, 1.72)],
    softToe: 5.4,
    softShoulder: 2.8,
    ...NEG_PAPER,
    mid: [0.18, 0.18, 0.18],
    matrix: IDENTITY,
    saturation: 1,
    grain: { sizeUm: 18, amount: 0.022, chroma: 0 },
    halation: { amount: 0.06, radius: 0.006, color: [1, 1, 1] },
    bloom: 0.01,
    mono: { weights: [0.28, 0.56, 0.16], shadow: [0.97, 0.985, 1], highlight: [0.995, 1, 1] },
  },
  {
    id: 'selenium125',
    name: 'Selenium 125',
    iso: '125',
    kind: 'Black & white',
    code: 'SELENIUM 125',
    box: '#5c3b4e',
    boxInk: '#f8eaf2',
    note: 'A classic film printed on warm fibre paper and toned in selenium. The shadows turn the colour of aubergine.',
    process: 'negative',
    layers: [layer(0.58, -1.38, 1.62), layer(0.58, -1.38, 1.62), layer(0.58, -1.38, 1.62)],
    softToe: 5,
    softShoulder: 2.8,
    ...NEG_PAPER,
    mid: [0.18, 0.18, 0.18],
    matrix: IDENTITY,
    saturation: 1,
    grain: { sizeUm: 28, amount: 0.04, chroma: 0 },
    halation: { amount: 0.1, radius: 0.007, color: [1, 1, 1] },
    bloom: 0.02,
    mono: { weights: [0.38, 0.5, 0.12], shadow: [1.02, 0.86, 0.94], highlight: [1, 0.965, 0.9] },
  },
  {
    id: 'noir3200',
    name: 'Noir 3200',
    iso: '3200',
    kind: 'Black & white',
    code: 'NOIR 3200',
    box: '#15130f',
    boxInk: '#f7e9c9',
    note: 'For when there is no light left. Grain like sand, blacks like ink, and a bloom around every lamp.',
    process: 'negative',
    layers: [layer(0.74, -1.02, 1.42), layer(0.74, -1.02, 1.42), layer(0.74, -1.02, 1.42)],
    softToe: 4.2,
    softShoulder: 2.8,
    ...NEG_PAPER,
    mid: [0.17, 0.17, 0.17],
    matrix: IDENTITY,
    saturation: 1,
    grain: { sizeUm: 74, amount: 0.14, chroma: 0 },
    halation: { amount: 0.3, radius: 0.012, color: [1, 1, 1] },
    bloom: 0.08,
    mono: { weights: [0.42, 0.46, 0.12], shadow: [1, 0.985, 0.96], highlight: [1, 0.985, 0.95] },
  },
  {
    id: 'infra400',
    name: 'Infra 400',
    iso: '400',
    kind: 'Infrared',
    code: 'INFRA 400',
    box: '#c9256b',
    boxInk: '#fff0f7',
    note: 'False-colour aerial film, first made to spot camouflage. Foliage reflects infrared, so every leaf turns crimson.',
    process: 'reversal',
    layers: [layer(1.34, -1.02, 0.9), layer(1.34, -1.02, 0.9), layer(1.34, -1.02, 0.9)],
    softToe: 6,
    softShoulder: 5,
    ...SLIDE_PAPER,
    mid: [0.18, 0.18, 0.19],
    matrix: IDENTITY,
    saturation: 1.1,
    grain: { sizeUm: 30, amount: 0.04, chroma: 0.6 },
    halation: { amount: 0.16, radius: 0.009, color: WARM_HALO },
    bloom: 0.03,
    infrared: true,
  },
];

export const STOCK_BY_ID = new Map(STOCKS.map((s) => [s.id, s]));
export const DEFAULT_STOCK = 'portrait400';
export const getStock = (id: string): Stock => STOCK_BY_ID.get(id) ?? STOCK_BY_ID.get(DEFAULT_STOCK)!;
