// The darkroom, as GLSL. The order of operations follows the physical process:
// light → film layers (with halation inside the emulsion) → development curve → grain → paper.

export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
in vec2 aPosition;
out vec2 vClip;
void main() {
  vClip = aPosition;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

// Shared: turn display-referred photo pixels back into scene-like exposure.
const EXPOSURE_GLSL = /* glsl */ `
  // Camera files clip and compress highlights. Expanding the top of the range gives the film's
  // shoulder and halation something real to respond to.
  vec3 expandHighlights(vec3 l) {
    vec3 c = min(l, vec3(1.0));
    return c / max(1.0 - 0.72 * c, vec3(0.28));
  }
`;

/** Extracts what will bleed: highlights for halation, or a broad soft glow for bloom. */
export const PREFILTER_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vClip;
out vec4 fragColor;
uniform sampler2D uSource;
uniform vec3 uWhiteBalance;
uniform float uGain;
uniform float uThreshold;
${EXPOSURE_GLSL}
void main() {
  vec2 uv = vClip * 0.5 + 0.5;
  vec3 e = expandHighlights(texture(uSource, uv).rgb * uWhiteBalance) * uGain;
  // Soft knee: nothing bleeds below the threshold, everything above bleeds in proportion.
  float peak = max(e.r, max(e.g, e.b));
  float over = max(peak - uThreshold, 0.0);
  e *= over / max(over + 0.5, 1e-4) * (over / max(peak, 1e-4) + 0.25);
  fragColor = vec4(min(e, vec3(12.0)), 1.0);
}`;

/** Separable Gaussian, stepping through the half-float target. */
export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vClip;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform vec2 uStep;
uniform float uSigma;
void main() {
  vec2 uv = vClip * 0.5 + 0.5;
  vec3 sum = texture(uTexture, uv).rgb;
  float total = 1.0;
  for (int i = 1; i <= 18; i++) {
    float x = float(i);
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    sum += (texture(uTexture, uv + uStep * x).rgb + texture(uTexture, uv - uStep * x).rgb) * w;
    total += 2.0 * w;
  }
  fragColor = vec4(sum / total, 1.0);
}`;

export const FILM_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vClip;
out vec4 fragColor;

uniform sampler2D uSource;
uniform sampler2D uHalo;
uniform sampler2D uBloom;
uniform sampler2D uLut;
uniform sampler2D uGrain;

// Mapping from output pixels to the photograph.
uniform vec2 uTarget;       // size of the render target, in pixels
uniform vec2 uOrigin;       // where the image's top-left corner lands
uniform vec2 uDisplay;      // displayed size of the image, in pixels
uniform float uFlipOutput;  // 1 when rendering for readback
uniform float uAspect;      // of the output frame
uniform vec3 uFrameToU;     // crop, rotation and mirror: output-frame fractions to source fractions
uniform vec3 uFrameToV;
uniform float uShowBounds;  // 1 in the crop tool, where a straightened picture leaves empty corners
uniform vec3 uTestStrip;    // bands across the frame, first band's stops, stops per band. 0 bands is off.
uniform vec2 uGrainSeed;    // moves the grain between frames of live video

uniform vec3 uWhiteBalance;
uniform float uGain;
uniform mat3 uMatrix;
uniform float uInfrared;
uniform float uMono;
uniform vec3 uMonoWeights;
uniform vec3 uToneShadow;
uniform vec3 uToneHighlight;
uniform vec3 uHaloColor;
uniform float uHaloAmount;
uniform float uBloomAmount;
uniform float uSaturation;
uniform float uFade;
uniform float uVignette;
uniform float uGrainAmount;
uniform float uGrainChroma;
uniform vec2 uGrainScale;   // tile repeats across the photograph
uniform float uLogMin;
uniform float uLogMax;
uniform float uSplit;       // before/after divider, in image x. Negative when off.
uniform float uDevelop;     // 0 blank paper → 1 fully developed
uniform float uLights;      // 0 under the safelight → 1 room lights on
uniform float uTime;

${EXPOSURE_GLSL}

const float MID_GREY = 0.18;

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

const mat2 ROT_A = mat2(0.8253, -0.5646, 0.5646, 0.8253);
const mat2 ROT_B = mat2(0.3624, 0.9320, -0.9320, 0.3624);

/** Dye clouds: tiled noise, read twice at unrelated angles so no repeat can be seen. */
vec3 grainField(vec2 uv) {
  vec2 p = (uv + uGrainSeed) * uGrainScale;
  vec4 a = texture(uGrain, ROT_A * p + vec2(0.17, 0.61));
  vec4 b = texture(uGrain, ROT_B * p * 1.137 + vec2(0.53, 0.29));
  vec4 n = (a + b - 1.0) * 1.4142;
  return mix(n.aaa, n.rgb, uGrainChroma);
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uFlipOutput > 0.5 ? gl_FragCoord.y : uTarget.y - gl_FragCoord.y);
  // The renderer scissors to the image rectangle, so there is no out-of-bounds branch here:
  // an early return would break the texture derivatives along the picture's edge.
  vec2 frame = (pixel - uOrigin) / uDisplay;
  vec3 frameH = vec3(frame, 1.0);
  vec2 uv = vec2(dot(uFrameToU, frameH), dot(uFrameToV, frameH));
  vec2 edgeDistance = min(uv, 1.0 - uv) / max(fwidth(uv), vec2(1e-6));

  // The print stirs slowly in the tray while it is developing.
  if (uLights < 1.0) {
    float settle = (1.0 - uDevelop) * (1.0 - uLights);
    uv += settle * 0.0035 * vec2(sin(uv.y * 16.0 + uTime * 1.3), cos(uv.x * 13.0 - uTime * 1.1));
    uv = clamp(uv, vec2(0.0), vec2(1.0));
  }

  vec3 linear = texture(uSource, uv).rgb;

  if (uSplit >= 0.0 && frame.x < uSplit) {
    fragColor = vec4(toSrgb(linear), 1.0);
    return;
  }

  // A test strip exposes each band of the paper for a different time.
  float bandGain = 1.0;
  if (uTestStrip.x > 0.5) {
    float band = min(floor(frame.x * uTestStrip.x), uTestStrip.x - 1.0);
    bandGain = pow(2.0, uTestStrip.y + uTestStrip.z * band);
  }

  // 1. Light reaches the film.
  vec3 e = expandHighlights(linear * uWhiteBalance) * uGain * bandGain;
  vec2 q = (frame - 0.5) * vec2(uAspect, 1.0) / sqrt(uAspect * uAspect + 1.0) * 2.0;
  float r2 = dot(q, q);
  e *= 1.0 + uVignette * r2 * (0.9 + 0.5 * r2);

  // 2. False-colour infrared: green-rich surfaces (leaves) reflect infrared, and the film shifts
  //    each layer down one band: infrared → red, red → green, green → blue.
  if (uInfrared > 0.5) {
    float foliage = max(min(e.g - e.r * 0.94, e.g - e.b * 1.12), 0.0);
    float ir = max(0.95 * e.r + 0.15 * e.g - 0.35 * e.b, 0.0) + foliage * 7.0;
    e = vec3(ir, e.r * 0.9 + e.g * 0.08, e.g * 0.82 + e.b * 0.12);
  }

  // 3. Each dye layer sees a mixture of scene colours.
  e = max(uMatrix * e, vec3(0.0));

  // 4. Inside the emulsion: light scatters back through the base and exposes the layers again.
  vec3 halo = texture(uHalo, uv).rgb;
  float haloLight = dot(halo, vec3(0.3, 0.5, 0.2));
  e += uHaloColor * haloLight * uHaloAmount * bandGain;
  e += texture(uBloom, uv).rgb * uBloomAmount * bandGain;

  if (uMono > 0.5) e = vec3(dot(e, uMonoWeights));

  // 5. Development: exposure to print, through this stock's characteristic curves.
  vec3 x = log(max(e, vec3(1e-5)) / MID_GREY) / 2.302585;
  vec3 t = clamp((x - uLogMin) / (uLogMax - uLogMin), 0.0, 1.0);
  float half_texel = 0.5 / 1024.0;
  t = t * (1.0 - 2.0 * half_texel) + half_texel;
  vec3 print = vec3(
    texture(uLut, vec2(t.r, 0.5)).r,
    texture(uLut, vec2(t.g, 0.5)).g,
    texture(uLut, vec2(t.b, 0.5)).b
  );

  float luma = dot(print, vec3(0.2126, 0.7152, 0.0722));
  print = max(vec3(luma) + (print - vec3(luma)) * uSaturation, vec3(0.0));

  // 6. Grain lives in density, and shows most in the midtones.
  if (uGrainAmount > 0.0) {
    vec3 n = grainField(uv);
    float tone = sqrt(max(luma, 0.0));
    float weight = 0.28 + 0.72 * exp(-pow((tone - 0.45) / 0.36, 2.0));
    print *= pow(vec3(10.0), -n * uGrainAmount * weight);
  }

  // 7. Paper: toner, then the fade of age.
  if (uMono > 0.5) {
    float l = clamp(pow(luma, 0.45), 0.0, 1.0);
    print *= mix(uToneShadow, uToneHighlight, smoothstep(0.1, 0.85, l));
  }
  print = uFade * 0.034 + print * (1.0 - uFade * 0.09);

  vec3 c = toSrgb(print);

  // Dither to keep long gradients smooth in 8 bits.
  float d = hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 17.0) - 1.0;
  c += d / 255.0;

  // 8. The tray. On real paper the darkest parts of the picture appear first.
  if (uLights < 1.0) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float depth = 1.0 - l;
    float blotch = (texture(uGrain, uv * 2.3 + 0.13).a - 0.5) * 0.14;
    float appear = smoothstep(1.0 - depth * 0.9 - 0.08, 1.0 - depth * 0.9 + 0.3, uDevelop * 1.32 + blotch);
    float paper = 1.0 - depth * appear;
    vec3 safelit = vec3(paper) * vec3(0.92, 0.14, 0.085);
    c = mix(safelit, c, uLights);
  }

  if (uShowBounds > 0.5) {
    float inside = clamp(min(edgeDistance.x, edgeDistance.y) + 0.5, 0.0, 1.0);
    fragColor = vec4(c * inside, inside);
    return;
  }

  fragColor = vec4(c, 1.0);
}`;
