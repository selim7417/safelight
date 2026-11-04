// A self-contained WebGL2 film renderer. Used twice: once for the big print on screen,
// and once, off-screen, to draw every stock's thumbnail in the film strip.

import { buildLut, LOG_MAX, LOG_MIN, LUT_SIZE } from '../lib/curves';
import type { Affine } from '../lib/geometry';
import { grainPixels, type Recipe, whiteBalanceGains } from '../lib/recipe';
import { getStock } from '../lib/stocks';
import { BLUR_FRAG, FILM_FRAG, FULLSCREEN_VERT, PREFILTER_FRAG } from './shaders';

type Uniforms = Record<string, WebGLUniformLocation | null>;

interface Program {
  program: WebGLProgram;
  uniforms: Uniforms;
}

interface Target {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

export interface View {
  /** Image top-left in target pixels. */
  x: number;
  y: number;
  /** Displayed image size in target pixels. */
  width: number;
  height: number;
}

export interface TestStrip {
  count: number;
  /** Stops of the first band, relative to the recipe's own exposure. */
  start: number;
  step: number;
}

export interface Effects {
  split?: number;
  develop?: number;
  lights?: number;
  time?: number;
  strip?: TestStrip | null;
  showBounds?: boolean;
  grainSeed?: [number, number];
}

const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

const GRAIN_TILE = 512;
// Keeps mid grey on mid grey after highlight expansion (0.18 becomes 0.2068).
const MID_GREY_GAIN = 1 - 0.72 * 0.18;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`Shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, frag: string): Program {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`Shader failed to link: ${gl.getProgramInfoLog(program)}`);
  }
  const uniforms: Uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i)!;
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

/** Gaussian-filtered noise that wraps at its edges. RGB are the dye layers; A is the shared silver pattern. */
function bakeGrain(size: number): Uint8Array {
  const channels = 4;
  const out = new Uint8Array(size * size * channels);
  const kernel = [0.06, 0.24, 0.4, 0.24, 0.06];
  const radius = 2;
  let seed = 90210;
  const random = () => {
    // Deterministic, so the same recipe always produces the same grain.
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gaussian = () => Math.sqrt(-2 * Math.log(random() + 1e-9)) * Math.cos(6.283185 * random());
  const buffer = new Float32Array(size * size);
  const temp = new Float32Array(size * size);
  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < buffer.length; i++) buffer[i] = gaussian();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += buffer[y * size + ((x + k + size) % size)] * kernel[k + radius];
        temp[y * size + x] = sum;
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += temp[((y + k + size) % size) * size + x] * kernel[k + radius];
        buffer[y * size + x] = sum;
      }
    }
    let variance = 0;
    for (const v of buffer) variance += v * v;
    const scale = 1 / Math.sqrt(variance / buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      out[i * channels + c] = Math.max(0, Math.min(255, 127.5 + buffer[i] * scale * 42));
    }
  }
  return out;
}

export class FilmRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private film: Program;
  private prefilter: Program;
  private blur: Program;
  private vao: WebGLVertexArrayObject;
  private source: WebGLTexture | null = null;
  private lut: WebGLTexture;
  private grain: WebGLTexture;
  private haloA!: Target;
  private haloB!: Target;
  private bloomA!: Target;
  private bloomB!: Target;
  imageWidth = 1;
  imageHeight = 1;
  private lutKey = '';
  private bleedKey = '';
  private recipe: Recipe | null = null;
  private transform: Affine = IDENTITY;
  private exportFbo: { fbo: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number } | null = null;
  readonly maxTexture: number;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, opts: { readback?: boolean } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: opts.readback ?? false,
      powerPreference: 'default',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      throw new Error('This graphics card cannot render to high-precision targets.');
    }
    gl.getExtension('OES_texture_float_linear');
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    this.film = link(gl, FILM_FRAG);
    this.prefilter = link(gl, PREFILTER_FRAG);
    this.blur = link(gl, BLUR_FRAG);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.lut = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.lut);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.grain = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.grain);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, GRAIN_TILE, GRAIN_TILE, 0, gl.RGBA, gl.UNSIGNED_BYTE, bakeGrain(GRAIN_TILE));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  private makeTarget(width: number, height: number): Target {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { texture, fbo, width, height };
  }

  private disposeTarget(t?: Target) {
    if (!t) return;
    this.gl.deleteTexture(t.texture);
    this.gl.deleteFramebuffer(t.fbo);
  }

  /** Loads a photograph. Stored as sRGB, so the GPU hands the shader linear light and filters it correctly. */
  setSource(image: TexImageSource, width: number, height: number, opts: { live?: boolean } = {}) {
    const gl = this.gl;
    if (this.source) gl.deleteTexture(this.source);
    // Photos larger than the graphics card's limit (phones can stop at 4096) are scaled to fit.
    // The logical size stays the same, so framing, grain and blur all behave as before.
    let upload = image;
    const longEdge = Math.max(width, height);
    if (longEdge > this.maxTexture) {
      const scale = this.maxTexture / longEdge;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(width * scale);
      canvas.height = Math.floor(height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
      upload = canvas;
    }
    this.source = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, upload as TexImageSource);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);

    this.imageWidth = width;
    this.imageHeight = height;

    // Bleed buffers are small and scale with the picture: their blur is measured in fractions of the frame.
    const aspect = height / width;
    // Live video redoes this every frame, so it gets smaller buffers.
    const haloW = Math.min(opts.live ? 360 : 720, Math.max(64, width));
    const bloomW = Math.min(opts.live ? 120 : 200, Math.max(32, width));
    for (const t of [this.haloA, this.haloB, this.bloomA, this.bloomB]) this.disposeTarget(t);
    this.haloA = this.makeTarget(haloW, Math.max(16, Math.round(haloW * aspect)));
    this.haloB = this.makeTarget(haloW, Math.max(16, Math.round(haloW * aspect)));
    this.bloomA = this.makeTarget(bloomW, Math.max(8, Math.round(bloomW * aspect)));
    this.bloomB = this.makeTarget(bloomW, Math.max(8, Math.round(bloomW * aspect)));
    this.bleedKey = '';
  }

  /** Swaps in a new frame of the same size, without reallocating anything. For live video. */
  updateSource(image: TexImageSource, opts: { bleed?: boolean } = {}) {
    if (!this.source) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (opts.bleed !== false && this.recipe) this.renderBleed();
  }

  get hasSource() {
    return !!this.source;
  }

  /** Sets how the output frame samples the photograph: crop, rotation and mirror. */
  setTransform(transform: Affine) {
    this.transform = transform;
  }

  clear() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  setRecipe(recipe: Recipe) {
    this.recipe = recipe;
    const stock = getStock(recipe.stock);
    const gl = this.gl;

    const lutKey = `${stock.id}|${recipe.push}|${recipe.contrast}`;
    if (lutKey !== this.lutKey) {
      this.lutKey = lutKey;
      const data = buildLut(stock, { push: recipe.push, contrast: recipe.contrast });
      gl.bindTexture(gl.TEXTURE_2D, this.lut);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, LUT_SIZE, 1, 0, gl.RGBA, gl.FLOAT, data);
    }

    const bleedKey = `${stock.id}|${recipe.exposure}|${recipe.temperature}|${recipe.tint}`;
    if (bleedKey !== this.bleedKey && this.source) {
      this.bleedKey = bleedKey;
      this.renderBleed();
    }
  }

  private fullscreen() {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private bindTexture(unit: number, texture: WebGLTexture, location: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
  }

  private blurInto(a: Target, b: Target, sigmaPixels: number) {
    const gl = this.gl;
    // Wide blurs take larger steps; the texture filter covers the gaps.
    const stride = Math.max(1, sigmaPixels / 6);
    const sigma = sigmaPixels / stride;
    gl.useProgram(this.blur.program);
    gl.uniform1f(this.blur.uniforms.uSigma, sigma);
    for (const [from, to, dx, dy] of [
      [a, b, stride / a.width, 0],
      [b, a, 0, stride / a.height],
    ] as const) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
      gl.viewport(0, 0, to.width, to.height);
      gl.uniform2f(this.blur.uniforms.uStep, dx, dy);
      this.bindTexture(0, from.texture, this.blur.uniforms.uTexture);
      this.fullscreen();
    }
  }

  /** Renders the highlights that will scatter inside the film into two small, soft buffers. */
  private renderBleed() {
    const gl = this.gl;
    const recipe = this.recipe!;
    const stock = getStock(recipe.stock);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prefilter.program);
    const u = this.prefilter.uniforms;
    gl.uniform3fv(u.uWhiteBalance, whiteBalanceGains(recipe.temperature, recipe.tint));
    gl.uniform1f(u.uGain, Math.pow(2, recipe.exposure) * MID_GREY_GAIN);
    this.bindTexture(0, this.source!, u.uSource);

    gl.uniform1f(u.uThreshold, 1.05);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.haloA.fbo);
    gl.viewport(0, 0, this.haloA.width, this.haloA.height);
    this.fullscreen();
    this.blurInto(this.haloA, this.haloB, Math.max(0.8, stock.halation.radius * this.haloA.width));

    gl.useProgram(this.prefilter.program);
    gl.uniform1f(u.uThreshold, 0.55);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
    gl.viewport(0, 0, this.bloomA.width, this.bloomA.height);
    this.fullscreen();
    this.blurInto(this.bloomA, this.bloomB, Math.max(0.8, 0.045 * this.bloomA.width));
  }

  private drawFilm(target: { width: number; height: number }, view: View, effects: Effects, flip: boolean) {
    const gl = this.gl;
    const recipe = this.recipe!;
    const stock = getStock(recipe.stock);
    const u = this.film.uniforms;
    gl.useProgram(this.film.program);

    this.bindTexture(0, this.source!, u.uSource);
    this.bindTexture(1, this.haloA.texture, u.uHalo);
    this.bindTexture(2, this.bloomA.texture, u.uBloom);
    this.bindTexture(3, this.lut, u.uLut);
    this.bindTexture(4, this.grain, u.uGrain);

    gl.uniform2f(u.uTarget, target.width, target.height);
    gl.uniform2f(u.uOrigin, view.x, view.y);
    gl.uniform2f(u.uDisplay, view.width, view.height);
    gl.uniform1f(u.uFlipOutput, flip ? 1 : 0);
    gl.uniform1f(u.uAspect, view.width / view.height);
    const [a, b, c, d, e, f] = this.transform;
    gl.uniform3f(u.uFrameToU, a, b, c);
    gl.uniform3f(u.uFrameToV, d, e, f);
    gl.uniform1f(u.uShowBounds, effects.showBounds ? 1 : 0);
    const strip = effects.strip;
    gl.uniform3f(u.uTestStrip, strip?.count ?? 0, strip?.start ?? 0, strip?.step ?? 0);
    const seed = effects.grainSeed ?? [0, 0];
    gl.uniform2f(u.uGrainSeed, seed[0], seed[1]);

    gl.uniform3fv(u.uWhiteBalance, whiteBalanceGains(recipe.temperature, recipe.tint));
    gl.uniform1f(u.uGain, Math.pow(2, recipe.exposure) * MID_GREY_GAIN);
    const m = stock.matrix;
    // GLSL matrices are column-major; the stock's rows are layers.
    gl.uniformMatrix3fv(u.uMatrix, false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
    gl.uniform1f(u.uInfrared, stock.infrared ? 1 : 0);
    gl.uniform1f(u.uMono, stock.mono ? 1 : 0);
    gl.uniform3fv(u.uMonoWeights, stock.mono?.weights ?? [0, 0, 0]);
    gl.uniform3fv(u.uToneShadow, stock.mono?.shadow ?? [1, 1, 1]);
    gl.uniform3fv(u.uToneHighlight, stock.mono?.highlight ?? [1, 1, 1]);
    gl.uniform3fv(u.uHaloColor, stock.halation.color);
    gl.uniform1f(u.uHaloAmount, stock.halation.amount * recipe.halation * 0.85);
    gl.uniform1f(u.uBloomAmount, stock.bloom * recipe.bloom * 1.2);
    gl.uniform1f(u.uSaturation, stock.saturation * (1 + recipe.saturation));
    gl.uniform1f(u.uFade, recipe.fade);
    gl.uniform1f(u.uVignette, recipe.vignette);

    // Grain is sized against a 35mm frame, so it looks the same at any resolution.
    const longEdge = Math.max(this.imageWidth, this.imageHeight);
    const pushBoost = 1 + 0.32 * Math.max(recipe.push, 0) + 0.1 * Math.min(recipe.push, 0);
    gl.uniform1f(u.uGrainAmount, stock.grain.amount * recipe.grain * pushBoost);
    gl.uniform1f(u.uGrainChroma, stock.grain.chroma);
    const px = Math.max(grainPixels(stock.grain.sizeUm, longEdge), 0.55);
    gl.uniform2f(u.uGrainScale, this.imageWidth / (px * GRAIN_TILE), this.imageHeight / (px * GRAIN_TILE));

    gl.uniform1f(u.uLogMin, LOG_MIN);
    gl.uniform1f(u.uLogMax, LOG_MAX);
    gl.uniform1f(u.uSplit, effects.split ?? -1);
    gl.uniform1f(u.uDevelop, effects.develop ?? 1);
    gl.uniform1f(u.uLights, effects.lights ?? 1);
    gl.uniform1f(u.uTime, effects.time ?? 0);
    this.fullscreen();
  }

  /** Draws to the canvas. */
  render(view: View, effects: Effects = {}) {
    if (!this.source || !this.recipe) return;
    const gl = this.gl;
    const c = this.canvas;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(view.x, c.height - view.y - view.height, view.width, view.height);
    this.drawFilm({ width: c.width, height: c.height }, view, effects, false);
    gl.disable(gl.SCISSOR_TEST);
  }

  /** Renders the whole photograph at any size and returns the pixels, top row first. */
  renderPixels(width: number, height: number): Uint8ClampedArray {
    if (!this.source || !this.recipe) throw new Error('Nothing to render.');
    const gl = this.gl;
    if (!this.exportFbo || this.exportFbo.width !== width || this.exportFbo.height !== height) {
      if (this.exportFbo) {
        gl.deleteTexture(this.exportFbo.texture);
        gl.deleteFramebuffer(this.exportFbo.fbo);
      }
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`This device can’t render an image of ${width} × ${height}. Pick a smaller size.`);
      }
      this.exportFbo = { fbo, texture, width, height };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.exportFbo.fbo);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    // With the flip on, framebuffer row 0 is the top of the photograph, so readback is already top-down.
    this.drawFilm({ width, height }, { x: 0, y: 0, width, height }, {}, true);
    const pixels = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  /** Releases the export buffer, which can be hundreds of megabytes. */
  releaseExport() {
    if (!this.exportFbo) return;
    this.gl.deleteTexture(this.exportFbo.texture);
    this.gl.deleteFramebuffer(this.exportFbo.fbo);
    this.exportFbo = null;
  }

  /** Frees the photograph from GPU memory. */
  releaseSource() {
    if (this.source) this.gl.deleteTexture(this.source);
    this.source = null;
    this.bleedKey = '';
  }
}
