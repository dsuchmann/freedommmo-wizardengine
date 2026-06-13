// WebGL2 terrain compositor — Stage 1 of the GPU migration.
//
// Draws worker-painted chunk ImageBitmaps as GPU textures on a GL canvas that
// sits UNDERNEATH the existing 2D canvas. Each chunk bitmap is uploaded whole
// via texImage2D (the path verified safe against the atlas stripe bug — we
// never re-assemble terrain from a tile atlas on the GPU).
//
// Sampling is NEAREST + CLAMP_TO_EDGE to match ctx.imageSmoothingEnabled=false.
// Quad placement uses the exact same CSS-pixel sx/sy/chunkPx math as the 2D
// path, so the two modes are pixel-comparable with the A/B toggle (G key).

var VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;            // unit quad corner (0..1)
uniform vec2 uPos;        // quad top-left, CSS px
uniform vec2 uSize;       // quad size, CSS px
uniform vec2 uViewport;   // viewport size, CSS px
out vec2 vUV;
void main() {
  vec2 px = uPos + aUnit * uSize;
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUnit;
}`;

var FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUV);
}`;

// --- Stage 2: instanced sprite pipeline (F2 small flora) ---
// Sprites live in a runtime shelf-packed atlas. Each instance replicates the
// 2D path's pivot math: translate(sx, sy + halfDraw); rotate(a); drawImage at
// (-halfDraw, -drawSize) — i.e. pivot at bottom-center of the quad.
var SPRITE_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;     // unit quad corner (0..1)
in vec4 aPSR;      // pivot.xy (world TILE units), size (tiles), rotation (rad)
in float aAlpha;
in vec4 aUV;       // u0, v0, du, dv
uniform vec2 uViewport;
uniform vec3 uCam; // x,y = screen-px offset, z = px per tile (tilePxSnapped)
out vec2 vUV;
out float vAlpha;
void main() {
  float sizePx = aPSR.z * uCam.z;
  vec2 pivotPx = aPSR.xy * uCam.z + uCam.xy;
  vec2 local = vec2(aUnit.x * sizePx - sizePx * 0.5, aUnit.y * sizePx - sizePx);
  float c = cos(aPSR.w);
  float s = sin(aPSR.w);
  vec2 px = pivotPx + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV.xy + aUnit * aUV.zw;
  vAlpha = aAlpha;
}`;

var SPRITE_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
uniform sampler2D uAtlas;
out vec4 outColor;
void main() {
  outColor = texture(uAtlas, vUV) * vAlpha; // premultiplied alpha
}`;

// Silhouette shadows: same instance data as sprites, but the quad is sheared
// along the sun direction and flattened onto the ground. The fragment shader
// keeps only the sprite's alpha as a dark, tip-faded silhouette.
var SHADOW_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;
in vec4 aPSR;      // pivot.xy (world tiles), size (tiles), w = diffusion
in float aAlpha;   // sprite alpha * per-biome shadow strength
in vec4 aUV;
uniform vec2 uViewport;
uniform vec3 uCam;        // x,y = screen-px offset, z = px per tile
uniform vec2 uShadowVec;
out vec2 vUV;
out float vAlpha;
out float vH;
out float vDiff;
void main() {
  float sizePx = aPSR.z * uCam.z;
  vec2 pivotPx = aPSR.xy * uCam.z + uCam.xy;
  float hgt = 1.0 - aUnit.y;
  float diff = aPSR.w;
  float shadowLen = length(uShadowVec);
  float flatK = clamp(1.0 - shadowLen / 2.5, 0.0, 1.0);
  float vert = mix(0.85, 0.40, flatK);
  float wide = 1.0 + diff * 0.45;
  vec2 base = vec2((aUnit.x - 0.5) * sizePx * wide, hgt * sizePx * vert);
  vec2 px = pivotPx + base + hgt * sizePx * uShadowVec;
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV.xy + aUnit * aUV.zw;
  vAlpha = aAlpha;
  vH = hgt;
  vDiff = diff;
}`;

var SHADOW_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
in float vH;
in float vDiff;
uniform sampler2D uAtlas;
uniform float uShadowAlpha; // global strength (sun-height driven)
uniform float uAtlasTexel;  // 1 / atlas size
out vec4 outColor;
void main() {
  // 5-tap blur of atlas alpha, radius scaled by per-instance diffusion
  float r = vDiff * 1.6 * uAtlasTexel;
  float sa = texture(uAtlas, vUV).a * 0.36
           + (texture(uAtlas, vUV + vec2(r, 0.0)).a
            + texture(uAtlas, vUV - vec2(r, 0.0)).a
            + texture(uAtlas, vUV + vec2(0.0, r)).a
            + texture(uAtlas, vUV - vec2(0.0, r)).a) * 0.16;
  // crisp large silhouettes keep a mild edge; diffuse flora stays soft
  float crisp = smoothstep(0.25, 0.75, sa);
  sa = mix(crisp, sa, clamp(vDiff * 2.0, 0.0, 1.0));
  float a = sa * vAlpha * uShadowAlpha * (1.0 - vH * 0.55);
  outColor = vec4(vec3(0.035, 0.045, 0.085) * a, a); // premultiplied dark blue-black
}`;

// Floats per sprite instance: pivotX, pivotY, size, rot, alpha, u0, v0, du, dv
export var SPRITE_FLOATS = 9;
var SPRITE_STRIDE = SPRITE_FLOATS * 4;

// --- Stage 3: 1:1 art-res scene framebuffer + sharp-bilinear present ---
// The whole GL scene (terrain + sprites) renders at art resolution (one
// texel per art pixel) into an offscreen framebuffer, snapped to integer
// art pixels. The present pass upscales to the canvas with "sharp bilinear"
// sampling: pixels stay fat and crisp, but pixel EDGES get exactly one
// screen-pixel of bilinear smoothing — uniform pixel sizes at any zoom, and
// smooth sub-pixel camera scroll via the fractional offset uniform.
var PRESENT_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;
out vec2 vTL; // unit coords, top-left origin
void main() {
  gl_Position = vec4(aUnit.x * 2.0 - 1.0, 1.0 - aUnit.y * 2.0, 0.0, 1.0);
  vTL = aUnit;
}`;

var PRESENT_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vTL;
uniform sampler2D uScene;
uniform vec4 uArt;    // artW, artH, allocW, allocH (texels)
uniform vec2 uView;   // visible art px (cssW/zoom, cssH/zoom)
uniform vec2 uOff;    // fractional camera offset, art px
uniform float uSharp; // DEVICE px per art px (zoom * devicePixelRatio)
// Stage 4: per-tile water wave field, soft-light blended over the scene.
// One texel per world tile; 0.5 = neutral (non-water tiles stay untouched).
uniform sampler2D uWave;
uniform float uWaveOn;
uniform vec2 uWaveOrg; // art px from view texel space to wave field origin
uniform vec2 uWaveN;   // wave field size, tiles
uniform float uTilePx; // art px per tile
uniform float uCrt;    // 0 = off, 1 = subtle CRT (scanlines + aperture grille)
uniform float uCrtK;   // zoom / 1.84 — keeps scanline device-px pitch constant
// Atmosphere pass: per-tile biome grading fields (same addressing as uWave)
uniform sampler2D uAtmoA;  // hue, sat, con, bri
uniform sampler2D uAtmoB;  // warm, fog, shadow, night-floor
uniform sampler2D uAtmoC;  // mood one-hot weights (filmic/painterly/muted/chiaroscuro)
uniform float uAtmoOn;
uniform vec2 uAtmoOrg;     // art-px offset, view texel space -> field origin
uniform vec2 uAtmoN;       // field size, tiles
uniform float uAmbient;    // phase ambient 0..1
uniform vec3 uPhaseTint;   // phase tint (≈1.0 neutral)
uniform vec3 uFogColor;    // phase fog color 0..1
uniform float uSunAzim;    // sun angle: 0=east, pi/2=overhead, pi=west
uniform float uSunHeight;  // 0..1
uniform float uTimeSec;
uniform float uCloudCover; // 0..1
uniform vec2 uCloudOff;    // accumulated cloud drift, world art px
uniform vec2 uWorldOrg;    // world art-px of view texel origin (camXi, camYi)
uniform vec2 uPlayerPos;   // world art-px of player feet
uniform float uPlayerLight; // visibility radius scale, ~1.0
out vec4 outColor;

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c2 = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c2, d, u.x), u.y);
}
vec3 blendOverlay(vec3 b, vec3 s) {
  return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(vec3(0.5), b));
}
vec3 blendScreen(vec3 b, vec3 s) { return 1.0 - (1.0 - b) * (1.0 - s); }
vec3 blendSoft(vec3 b, vec3 s) {
  vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(vec3(0.25), b));
  return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(vec3(0.5), s));
}
vec3 satAdj(vec3 c, float s) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), c, s);
}
vec3 hueRot(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float cs = cos(a), sn = sin(a);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
}
vec4 atmoSample(sampler2D t, vec2 uv, vec2 bs) {
  // center + 4-tap cross blur — widens the biome blend band beyond bilinear
  return texture(t, uv) * 0.4
       + (texture(t, uv + vec2(bs.x, 0.0)) + texture(t, uv - vec2(bs.x, 0.0))
        + texture(t, uv + vec2(0.0, bs.y)) + texture(t, uv - vec2(0.0, bs.y))) * 0.15;
}

void main() {
  vec2 texel = vTL * uView + uOff;            // art px, top-left origin
  // Sharp bilinear: sample pinned to the texel CENTER across the texel's
  // interior (crisp plateau), ramping to the boundary only within a
  // one-device-pixel band at each edge. (The previous formula was inverted —
  // it saturated at the texel BOUNDARY, a 50/50 blend, over the outer half
  // of every texel, blurring the whole image.)
  vec2 ip = floor(texel);
  vec2 cd = texel - ip - 0.5;                 // distance from texel center
  vec2 rr = vec2(max(0.0, 0.5 - 0.5 / uSharp)); // crisp half-width
  vec2 p = ip + 0.5 + (cd - clamp(cd, -rr, rr)) * uSharp;
  vec2 uv = vec2(p.x / uArt.z, (uArt.y - p.y) / uArt.w);
  vec3 c = texture(uScene, uv).rgb;
  if (uWaveOn > 0.5) {
    vec2 wuv = ((texel + uWaveOrg) / uTilePx) / uWaveN;
    float s = texture(uWave, wuv).r;
    // W3C soft-light blend, single gray source channel
    vec3 d = mix(((16.0 * c - 12.0) * c + 4.0) * c, sqrt(c), step(vec3(0.25), c));
    vec3 b = (s <= 0.5)
      ? c - (1.0 - 2.0 * s) * c * (1.0 - c)
      : c + (2.0 * s - 1.0) * (d - c);
    c = mix(c, b, 0.85);
    // Sun glints: wave crests catch the sun's color. Strongest at low sun
    // (golden path of sparkle), aligned to the sun's side of the screen.
    if (uAtmoOn > 0.5 && uSunHeight > 0.02) {
      float crest = smoothstep(0.62, 0.85, s);
      float lowSun2 = 1.0 - smoothstep(0.10, 0.60, uSunHeight);
      float sunSide = 1.0 - abs(vTL.x - (0.5 + cos(uSunAzim) * 0.45));
      float glint = crest * (0.10 + lowSun2 * 0.55) * clamp(sunSide, 0.2, 1.0);
      c += uPhaseTint * glint;
    }
  }
  if (uAtmoOn > 0.5) {
    vec2 auv = ((texel + uAtmoOrg) / uTilePx) / uAtmoN;
    vec2 bs = vec2(8.0) / uAtmoN;            // ±8-tile blur taps → ~24-tile blend band
    vec4 A = atmoSample(uAtmoA, auv, bs);
    vec4 B = atmoSample(uAtmoB, auv, bs);
    vec4 M = atmoSample(uAtmoC, auv, bs);
    float hue = (A.r * 120.0 - 60.0) * 0.017453;
    float sat = A.g * 2.0;
    float con = A.b * 2.0;
    float bri = A.a * 2.0;
    float warm = B.r;
    float fogD = B.g;
    float nightF = B.a;
    float msum = max(0.001, M.r + M.g + M.b + M.a);
    vec4 mw = M / msum;                       // mood weights, sum 1

    // mood base curves (from tuner CSS filters):
    // filmic contrast(1.12) | painterly saturate(1.15) | muted sat(.82) con(1.08) | chiaroscuro con(1.28)
    float mCon = mw.x * 1.12 + mw.y * 1.00 + mw.z * 1.08 + mw.w * 1.28;
    float mSat = mw.x * 1.00 + mw.y * 1.15 + mw.z * 0.82 + mw.w * 1.18;
    c = satAdj(c, sat * mSat);
    c = clamp(hueRot(c, hue), 0.0, 1.0);
    c = (c - 0.5) * (con * mCon) + 0.5;
    c = clamp(c * bri, 0.0, 1.0);

    // mood overlays — screen-space gradients matching the tuner previews,
    // scaled by warmth and gated to daylight (sun up) like golden light is
    float dayGate = smoothstep(0.0, 0.15, uSunHeight);
    float gd = clamp(vTL.x * 0.5 + vTL.y * 0.5, 0.0, 1.0);  // 160° diagonal
    float wA = warm * 0.55 * dayGate;
    vec3 filmCol = mix(vec3(1.0, 0.63, 0.24), vec3(0.0, 0.24, 0.31), gd);
    c = mix(c, blendOverlay(c, filmCol), mix(wA, wA * 0.6, gd) * mw.x);
    float rad = clamp(length(vTL - vec2(0.2, 0.0)), 0.0, 1.0);
    vec3 paintCol = mix(vec3(1.0, 0.82, 0.35), vec3(0.47, 0.31, 0.55), rad);
    c = mix(c, blendScreen(c, paintCol), clamp(mix(wA * 1.6, 0.10 * dayGate, rad), 0.0, 0.85) * mw.y);
    vec3 muteCol = mix(vec3(0.71, 0.51, 0.31), vec3(0.24, 0.27, 0.43), vTL.y);
    c = mix(c, blendSoft(c, muteCol), (wA * 0.66 + 0.10) * mw.z);
    vec3 chiCol = mix(vec3(1.0, 0.55, 0.12), vec3(0.06, 0.04, 0.16), gd);
    c = mix(c, blendOverlay(c, chiCol), clamp(mix(wA * 1.4, wA * 1.65 + 0.10, gd), 0.0, 0.85) * mw.w);
    float vig = smoothstep(0.55, 1.0, length(vTL - 0.5) * 1.6);
    c *= 1.0 - vig * (0.32 * mw.z + 0.30 * mw.w);

    // cloud shadows: 2-octave world-space noise drifting with the wind
    vec2 wp = (texel + uWorldOrg + uCloudOff) * 0.004;
    float cl = vnoise(wp) * 0.65 + vnoise(wp * 2.7 + 13.1) * 0.35;
    float cmask = smoothstep(0.55, 0.80, cl) * uCloudCover * uSunHeight;
    c *= 1.0 - cmask * 0.18;

    // phase tint (replaces the 2D tint fillRect)
    c = clamp(c * uPhaseTint, 0.0, 1.0);

    // day/night brightness with per-biome night floor (the "too dark" fix).
    // The floor lifts toward a luminance-NORMALIZED moonlit version of the
    // scene: dark-albedo biomes (deep ocean) have bases far too dark for a
    // multiplicative floor to ever keep them readable at night.
    float nightAmt = 1.0 - smoothstep(0.10, 0.55, uAmbient);
    vec3 nightShift = vec3(0.62, 0.70, 1.10);
    vec3 dark = c * max(uAmbient, 0.10) * nightShift;
    float lum0 = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 moonlit = min(c * (0.25 / max(lum0, 0.05)), vec3(1.0)) * nightShift;
    dark = mix(dark, moonlit, nightF);
    // player visibility pool: the night stays dark, but a warm readable
    // circle follows the player (torch-like falloff, ~3 tiles core, ~7 fade)
    float pdist = length((texel + uWorldOrg) - uPlayerPos);
    float pvis = (1.0 - smoothstep(uTilePx * 2.5, uTilePx * 7.0, pdist)) * uPlayerLight;
    float nightLocal = nightAmt * (1.0 - pvis * 0.85);
    c = mix(c, dark, nightLocal);
    c += vec3(0.85, 0.55, 0.22) * pvis * nightAmt * 0.13;   // faint warm torch tint, only at night

    // god rays: soft patchy light shafts, present most of the day, fading
    // near high noon, strongest at low sun. Never visible parallel lines.
    float rayAmt = (1.0 - smoothstep(0.30, 0.95, uSunHeight)) * step(0.02, uSunHeight);
    float rayStr = rayAmt * (0.25 + fogD * 0.75) * 0.14;
    if (rayStr > 0.004) {
      vec2 rd = normalize(vec2(cos(uSunAzim), 0.55));
      float band = dot(vTL, rd) * 3.5 + uTimeSec * 0.05;
      float n = vnoise(vec2(band, band * 0.13)) * 0.6
              + vnoise(vec2(band * 2.3 + 7.0, band * 0.31)) * 0.4;
      float shafts = smoothstep(0.30, 1.05, n);
      // large-scale screen mask: shafts are patchy, not wall-to-wall
      float pmask = smoothstep(0.25, 0.80, vnoise(vTL * 2.1 + vec2(uTimeSec * 0.02, 3.7)));
      vec3 sunCol = mix(uPhaseTint, vec3(1.0, 0.85, 0.55), 0.6);
      c += sunCol * shafts * pmask * rayStr * (1.0 - vig * 0.5);
    }

    // fog: per-biome density, phase-colored, breathing noise, edge-biased
    float fn = vnoise((texel + uWorldOrg) * 0.012 + vec2(uTimeSec * 0.015, -uTimeSec * 0.010));
    float fedge = smoothstep(0.25, 0.95, length(vTL - 0.5) * 1.45);
    float fogA = clamp(fogD * (0.30 + 0.45 * fedge + 0.25 * fn), 0.0, 0.8);
    c = mix(c, uFogColor, fogA * 0.55);
    c = clamp(c, 0.0, 1.0);
  }
  if (uCrt > 0.5) {
    // Subtle CRT: gentle scanlines aligned to art rows (darkest at row
    // boundaries) + a faint aperture-grille RGB tint per device-pixel
    // triad, brightness-compensated so the image doesn't dim.
    float scan = 1.0 - 0.22 * (0.5 + 0.5 * cos(6.28318 * texel.y * uCrtK));
    float gx = mod(gl_FragCoord.x, 3.0);
    vec3 grille = gx < 1.0 ? vec3(1.06, 0.94, 0.94)
                : gx < 2.0 ? vec3(0.94, 1.06, 0.94)
                           : vec3(0.94, 0.94, 1.06);
    c = clamp(c * scan * grille * 1.13, 0.0, 1.0);
  }
  outColor = vec4(c, 1.0);
}`;

// Evict chunk textures not drawn for this many frames.
var EVICT_AFTER_FRAMES = 600;
var SWEEP_INTERVAL = 256;

function parseColor(css) {
  // Supports '#rgb', '#rrggbb', 'rgb(...)' / 'rgba(...)'. Fallback: dark slate.
  if (typeof css === 'string') {
    if (css[0] === '#') {
      var hex = css.slice(1);
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      if (hex.length >= 6) {
        var n = parseInt(hex.slice(0, 6), 16);
        if (!isNaN(n)) return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      }
    } else {
      var m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    }
  }
  return [0.094, 0.149, 0.169]; // #18262b
}

export class GLCompositor {
  constructor() {
    this.ok = false;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'glTerrain';
    var gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!gl) {
      console.warn('[GL] WebGL2 unavailable — staying on Canvas 2D terrain path');
      return;
    }
    this.gl = gl;
    this.textures = new Map(); // 'cx,cy' -> { tex, bmp, lastUsed }
    this.crt = true;      // subtle CRT scanlines + grille (C key toggles)
    this.frame = 0;
    this._lastSkyCss = null;
    this._skyRGB = [0, 0, 0];

    var program = this._buildProgram(VERT_SRC, FRAG_SRC);
    if (!program) return;
    this.program = program;
    this.uPos = gl.getUniformLocation(program, 'uPos');
    this.uSize = gl.getUniformLocation(program, 'uSize');
    this.uViewport = gl.getUniformLocation(program, 'uViewport');
    this.uTex = gl.getUniformLocation(program, 'uTex');

    // Static unit quad (triangle strip)
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.unitVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(program, 'aUnit');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.spritesOk = false;
    this._initSprites();

    gl.disable(gl.BLEND); // terrain chunks are opaque
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ok = false;
      console.warn('[GL] context lost — falling back to Canvas 2D terrain');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[GL] context restored — press G twice to re-enable');
    });

    this.ok = true;
    console.log('[GL] WebGL2 terrain compositor ready:', gl.getParameter(gl.VERSION));
  }

  _buildProgram(vsSrc, fsSrc) {
    var gl = this.gl;
    var vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error('[GL] vertex shader:', gl.getShaderInfoLog(vs));
      return null;
    }
    var fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('[GL] fragment shader:', gl.getShaderInfoLog(fs));
      return null;
    }
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[GL] program link:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  resize(cssW, cssH, dpr) {
    if (!this.ok) return;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
  }

  beginFrame(skyColorCss, cssW, cssH) {
    if (!this.ok) return;
    var gl = this.gl;
    this.sceneActive = false;
    if (skyColorCss !== this._lastSkyCss) {
      this._lastSkyCss = skyColorCss;
      this._skyRGB = parseColor(skyColorCss);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this._skyRGB[0], this._skyRGB[1], this._skyRGB[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uViewport, cssW, cssH);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
  }

  // Stage 3: begin an art-resolution scene pass. All subsequent drawChunk /
  // drawSpriteInstances calls take ART-pixel coordinates (integer-snapped
  // camera). Returns false if the framebuffer path is unavailable — caller
  // should fall back to beginFrame() with CSS-px coordinates.
  beginScene(skyColorCss, artW, artH) {
    if (!this.ok || !this._ensureScene(artW, artH)) return false;
    var gl = this.gl;
    if (skyColorCss !== this._lastSkyCss) {
      this._lastSkyCss = skyColorCss;
      this._skyRGB = parseColor(skyColorCss);
    }
    this._artW = artW;
    this._artH = artH;
    this.sceneActive = true;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, artW, artH);
    gl.clearColor(this._skyRGB[0], this._skyRGB[1], this._skyRGB[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uViewport, artW, artH);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    return true;
  }

  _ensureScene(artW, artH) {
    if (this.sceneOk === false) return false; // failed once — don't retry
    var gl = this.gl;
    if (!this.presentProgram) {
      var prog = this._buildProgram(PRESENT_VERT_SRC, PRESENT_FRAG_SRC);
      if (!prog) { this.sceneOk = false; return false; }
      this.presentProgram = prog;
      this.pUScene = gl.getUniformLocation(prog, 'uScene');
      this.pUArt = gl.getUniformLocation(prog, 'uArt');
      this.pUView = gl.getUniformLocation(prog, 'uView');
      this.pUOff = gl.getUniformLocation(prog, 'uOff');
      this.pUSharp = gl.getUniformLocation(prog, 'uSharp');
      this.pUCrt = gl.getUniformLocation(prog, 'uCrt');
      this.pUCrtK = gl.getUniformLocation(prog, 'uCrtK');
      this.pUWave = gl.getUniformLocation(prog, 'uWave');
      this.pUWaveOn = gl.getUniformLocation(prog, 'uWaveOn');
      this.pUWaveOrg = gl.getUniformLocation(prog, 'uWaveOrg');
      this.pUWaveN = gl.getUniformLocation(prog, 'uWaveN');
      this.pUTilePx = gl.getUniformLocation(prog, 'uTilePx');
      this.pUAtmoA = gl.getUniformLocation(prog, 'uAtmoA');
      this.pUAtmoB = gl.getUniformLocation(prog, 'uAtmoB');
      this.pUAtmoC = gl.getUniformLocation(prog, 'uAtmoC');
      this.pUAtmoOn = gl.getUniformLocation(prog, 'uAtmoOn');
      this.pUAtmoOrg = gl.getUniformLocation(prog, 'uAtmoOrg');
      this.pUAtmoN = gl.getUniformLocation(prog, 'uAtmoN');
      this.pUAmbient = gl.getUniformLocation(prog, 'uAmbient');
      this.pUPhaseTint = gl.getUniformLocation(prog, 'uPhaseTint');
      this.pUFogColor = gl.getUniformLocation(prog, 'uFogColor');
      this.pUSunAzim = gl.getUniformLocation(prog, 'uSunAzim');
      this.pUSunHeight = gl.getUniformLocation(prog, 'uSunHeight');
      this.pUTimeSec = gl.getUniformLocation(prog, 'uTimeSec');
      this.pUCloudCover = gl.getUniformLocation(prog, 'uCloudCover');
      this.pUCloudOff = gl.getUniformLocation(prog, 'uCloudOff');
      this.pUWorldOrg = gl.getUniformLocation(prog, 'uWorldOrg');
      this.pUPlayerPos = gl.getUniformLocation(prog, 'uPlayerPos');
      this.pUPlayerLight = gl.getUniformLocation(prog, 'uPlayerLight');
      this.atmoTex = [];
      for (var ai = 0; ai < 3; ai++) {
        var t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.atmoTex.push(t);
      }
      this._atmoOn = false;
      this._atmoTW = 0;
      this._atmoTH = 0;
      this._atmoEnv = null;
      this.waveTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
      // LINEAR: smooth tile-to-tile shimmer gradients (the 2D path was blocky
      // per tile); CLAMP so the viewport edge holds the last tile's value.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._waveOn = false;
      this._waveTW = 0;
      this._waveTH = 0;
      this.presentVao = gl.createVertexArray();
      gl.bindVertexArray(this.presentVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
      var loc = gl.getAttribLocation(prog, 'aUnit');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.sceneTex = gl.createTexture();
      this.sceneFbo = gl.createFramebuffer();
      this._sceneAllocW = 0;
      this._sceneAllocH = 0;
    }
    if (artW > this._sceneAllocW || artH > this._sceneAllocH) {
      // Round allocation up to 64-texel steps so zoom wobble doesn't realloc
      this._sceneAllocW = Math.max(this._sceneAllocW, Math.ceil(artW / 64) * 64);
      this._sceneAllocH = Math.max(this._sceneAllocH, Math.ceil(artH / 64) * 64);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this._sceneAllocW, this._sceneAllocH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      // LINEAR — the present shader does the sharp-bilinear math itself
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
      var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn('[GL] scene framebuffer incomplete (status ' + status + ') — falling back to direct rendering');
        this.sceneOk = false;
        return false;
      }
      console.log('[GL] art-res scene framebuffer: ' + this._sceneAllocW + 'x' + this._sceneAllocH);
    }
    this.sceneOk = true;
    return true;
  }

  // Stage 4: upload this frame's per-tile wave field (RGBA, one texel/tile,
  // 128 = neutral). orgX/orgY = art-px offset from the view's texel space to
  // the field origin (camXi - tile0X*tileSize). tilePx = art px per tile.
  setWaveField(data, tilesW, tilesH, orgX, orgY, tilePx) {
    if (!this.ok || !this.waveTex) return;
    var gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
    if (tilesW !== this._waveTW || tilesH !== this._waveTH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tilesW, tilesH, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      this._waveTW = tilesW;
      this._waveTH = tilesH;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tilesW, tilesH, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    gl.activeTexture(gl.TEXTURE0);
    this._waveOn = true;
    this._waveOrgX = orgX;
    this._waveOrgY = orgY;
    this._waveTilePx = tilePx;
  }

  clearWaveField() {
    this._waveOn = false;
  }

  // Atmosphere field: three per-tile RGBA layers (see atmosphere-pass.js).
  // Same origin convention as setWaveField.
  setAtmoField(field, tilesW, tilesH, orgX, orgY, tilePx) {
    if (!this.ok || !this.atmoTex) return;
    var gl = this.gl;
    var bufs = [field.a, field.b, field.c];
    for (var i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE2 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.atmoTex[i]);
      if (tilesW !== this._atmoTW || tilesH !== this._atmoTH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tilesW, tilesH, 0, gl.RGBA, gl.UNSIGNED_BYTE, bufs[i]);
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tilesW, tilesH, gl.RGBA, gl.UNSIGNED_BYTE, bufs[i]);
      }
    }
    this._atmoTW = tilesW;
    this._atmoTH = tilesH;
    gl.activeTexture(gl.TEXTURE0);
    this._atmoOn = true;
    this._atmoOrgX = orgX;
    this._atmoOrgY = orgY;
    if (tilePx) this._atmoTilePx = tilePx;
  }

  // Per-frame scalar atmosphere environment (sun/weather/time).
  setAtmoEnv(env) {
    this._atmoEnv = env;
  }

  clearAtmoField() {
    this._atmoOn = false;
  }

  // Upscale the art-res scene to the full canvas with sharp-bilinear sampling.
  presentScene(cssW, cssH, zoom, fracX, fracY) {
    if (!this.ok || !this.sceneActive) return;
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.presentProgram);
    gl.bindVertexArray(this.presentVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this.pUScene, 0);
    gl.uniform4f(this.pUArt, this._artW, this._artH, this._sceneAllocW, this._sceneAllocH);
    gl.uniform2f(this.pUView, cssW / zoom, cssH / zoom);
    gl.uniform2f(this.pUOff, fracX, fracY);
    // Sharpness band is one DEVICE pixel — on scaled displays (dpr > 1) the
    // canvas backing store is larger than CSS px, and using zoom alone makes
    // every pixel edge dpr-times blurrier than intended.
    gl.uniform1f(this.pUSharp, zoom * (this.canvas.width / Math.max(1, cssW)));
    gl.uniform1f(this.pUCrt, this.crt ? 1 : 0);
    gl.uniform1f(this.pUCrtK, zoom / 1.84);
    if (this._waveOn) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.pUWave, 1);
      gl.uniform1f(this.pUWaveOn, 1);
      gl.uniform2f(this.pUWaveOrg, this._waveOrgX, this._waveOrgY);
      gl.uniform2f(this.pUWaveN, this._waveTW, this._waveTH);
      gl.uniform1f(this.pUTilePx, this._waveTilePx);
    } else {
      gl.uniform1f(this.pUWaveOn, 0);
    }
    var env = this._atmoEnv;
    if (this._atmoOn && env) {
      for (var ai = 0; ai < 3; ai++) {
        gl.activeTexture(gl.TEXTURE2 + ai);
        gl.bindTexture(gl.TEXTURE_2D, this.atmoTex[ai]);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.pUAtmoA, 2);
      gl.uniform1i(this.pUAtmoB, 3);
      gl.uniform1i(this.pUAtmoC, 4);
      gl.uniform1f(this.pUAtmoOn, 1);
      // uTilePx is shared with the wave block; ensure it's set even when
      // no water is visible this frame (wave branch skipped).
      if (!this._waveOn) gl.uniform1f(this.pUTilePx, this._atmoTilePx || 16);
      gl.uniform2f(this.pUAtmoOrg, this._atmoOrgX, this._atmoOrgY);
      gl.uniform2f(this.pUAtmoN, this._atmoTW, this._atmoTH);
      gl.uniform1f(this.pUAmbient, env.ambient);
      gl.uniform3f(this.pUPhaseTint, env.tint[0], env.tint[1], env.tint[2]);
      gl.uniform3f(this.pUFogColor, env.fogColor[0], env.fogColor[1], env.fogColor[2]);
      gl.uniform1f(this.pUSunAzim, env.sunAzim);
      gl.uniform1f(this.pUSunHeight, env.sunHeight);
      gl.uniform1f(this.pUTimeSec, env.timeSec);
      gl.uniform1f(this.pUCloudCover, env.cloudCover);
      gl.uniform2f(this.pUCloudOff, env.cloudOffX, env.cloudOffY);
      gl.uniform2f(this.pUWorldOrg, env.worldOrgX, env.worldOrgY);
      gl.uniform2f(this.pUPlayerPos, env.playerX || 0, env.playerY || 0);
      gl.uniform1f(this.pUPlayerLight, env.playerLight !== undefined ? env.playerLight : 1);
    } else {
      gl.uniform1f(this.pUAtmoOn, 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    this.sceneActive = false;
  }

  // Upload (or reuse) the chunk bitmap as a texture and draw it as a quad.
  // Identity check on the bitmap reference handles chunk repaints: the
  // provider creates a NEW ImageBitmap on repaint, triggering re-upload.
  drawChunk(key, bitmap, sx, sy, dw, dh) {
    if (!this.ok) return;
    var gl = this.gl;
    var entry = this.textures.get(key);
    if (!entry || entry.bmp !== bitmap) {
      var tex = entry ? entry.tex : gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry = { tex: tex, bmp: bitmap, lastUsed: this.frame };
      this.textures.set(key, entry);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      entry.lastUsed = this.frame;
    }
    gl.uniform2f(this.uPos, sx, sy);
    gl.uniform2f(this.uSize, dw, dh);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // --- Stage 2: sprite atlas + instanced rendering ---

  _initSprites() {
    var gl = this.gl;
    var prog = this._buildProgram(SPRITE_VERT_SRC, SPRITE_FRAG_SRC);
    if (!prog) return;
    this.spriteProgram = prog;
    this.sUViewport = gl.getUniformLocation(prog, 'uViewport');
    this.sUCam = gl.getUniformLocation(prog, 'uCam');
    this.sUAtlas = gl.getUniformLocation(prog, 'uAtlas');

    // Runtime shelf-packed sprite atlas. F2 sprites are ~32px so a 4096²
    // atlas holds ~15k of them — far more than ever loads at once.
    this.atlasSize = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.atlasSize, this.atlasSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.atlasRects = new Map(); // url -> {u0,v0,du,dv} | null (failed/full)
    this._lastAtlasReset = -99999;
    // Fixed region reserved for the player sprite, re-uploaded every frame so
    // the player participates in the depth-sorted instance batch.
    this._playerRegion = { x: 1, y: 1, w: 256, h: 256 };
    this._shelfX = 1;
    this._shelfY = this._playerRegion.y + this._playerRegion.h + 2; // shelves pack below it
    this._shelfH = 0;
    this._atlasFullWarned = false;

    // Sprite VAO: shared unit quad + per-instance attributes (divisor 1)
    this.spriteVao = gl.createVertexArray();
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
    var locUnit = gl.getAttribLocation(prog, 'aUnit');
    gl.enableVertexAttribArray(locUnit);
    gl.vertexAttribPointer(locUnit, 2, gl.FLOAT, false, 0, 0);
    this.instVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    var locPSR = gl.getAttribLocation(prog, 'aPSR');
    gl.enableVertexAttribArray(locPSR);
    gl.vertexAttribPointer(locPSR, 4, gl.FLOAT, false, SPRITE_STRIDE, 0);
    gl.vertexAttribDivisor(locPSR, 1);
    var locAlpha = gl.getAttribLocation(prog, 'aAlpha');
    gl.enableVertexAttribArray(locAlpha);
    gl.vertexAttribPointer(locAlpha, 1, gl.FLOAT, false, SPRITE_STRIDE, 16);
    gl.vertexAttribDivisor(locAlpha, 1);
    var locUV = gl.getAttribLocation(prog, 'aUV');
    gl.enableVertexAttribArray(locUV);
    gl.vertexAttribPointer(locUV, 4, gl.FLOAT, false, SPRITE_STRIDE, 20);
    gl.vertexAttribDivisor(locUV, 1);
    gl.bindVertexArray(null);
    this._instCapacityBytes = 0;
    this._spriteAttribLocs = { psr: locPSR, alpha: locAlpha, uv: locUV };

    // Shadow pass: same instance layout, separate program/VAO/VBO so the
    // shadow batch (subset of sprites) doesn't disturb the sprite batch.
    var sprog = this._buildProgram(SHADOW_VERT_SRC, SHADOW_FRAG_SRC);
    this.shadowOk = false;
    if (sprog) {
      this.shadowProgram = sprog;
      this.shUViewport = gl.getUniformLocation(sprog, 'uViewport');
      this.shUCam = gl.getUniformLocation(sprog, 'uCam');
      this.shUAtlas = gl.getUniformLocation(sprog, 'uAtlas');
      this.shUShadowVec = gl.getUniformLocation(sprog, 'uShadowVec');
      this.shUShadowAlpha = gl.getUniformLocation(sprog, 'uShadowAlpha');
      this.shUAtlasTexel = gl.getUniformLocation(sprog, 'uAtlasTexel');
      this.shadowVao = gl.createVertexArray();
      gl.bindVertexArray(this.shadowVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.unitVbo);
      var sLocUnit = gl.getAttribLocation(sprog, 'aUnit');
      gl.enableVertexAttribArray(sLocUnit);
      gl.vertexAttribPointer(sLocUnit, 2, gl.FLOAT, false, 0, 0);
      this.shadowVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowVbo);
      var sLocPSR = gl.getAttribLocation(sprog, 'aPSR');
      gl.enableVertexAttribArray(sLocPSR);
      gl.vertexAttribPointer(sLocPSR, 4, gl.FLOAT, false, SPRITE_STRIDE, 0);
      gl.vertexAttribDivisor(sLocPSR, 1);
      var sLocAlpha = gl.getAttribLocation(sprog, 'aAlpha');
      gl.enableVertexAttribArray(sLocAlpha);
      gl.vertexAttribPointer(sLocAlpha, 1, gl.FLOAT, false, SPRITE_STRIDE, 16);
      gl.vertexAttribDivisor(sLocAlpha, 1);
      var sLocUV = gl.getAttribLocation(sprog, 'aUV');
      gl.enableVertexAttribArray(sLocUV);
      gl.vertexAttribPointer(sLocUV, 4, gl.FLOAT, false, SPRITE_STRIDE, 20);
      gl.vertexAttribDivisor(sLocUV, 1);
      gl.bindVertexArray(null);
      this._shadowCapacityBytes = 0;
      this._shadowAttribLocs = { psr: sLocPSR, alpha: sLocAlpha, uv: sLocUV };
      this.shadowOk = true;
    }
    this.spritesOk = true;
  }

  // Pack an Image into the atlas (or return its cached rect). Returns
  // {u0,v0,du,dv} or null (not ready / failed / atlas full → caller draws 2D).
  atlasRect(img, url) {
    if (!this.ok || !this.spritesOk) return null;
    var rect = this.atlasRects.get(url);
    if (rect !== undefined) return rect;
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    // Canvases (downscale cache) have no .complete — only gate Images on decode
    if (!w || !h || img.complete === false) return null; // not decoded yet — retry later
    var A = this.atlasSize;
    if (w + 2 > A || h + 2 > A) {
      this.atlasRects.set(url, null); // sprite larger than the whole atlas
      return null;
    }
    if (this._shelfX + w + 1 > A) {
      this._shelfY += this._shelfH + 1;
      this._shelfX = 1;
      this._shelfH = 0;
    }
    if (this._shelfY + h + 1 > A) {
      // Atlas full. Unique URLs grow unbounded over a session (every anim
      // frame is its own URL), so permanent null-marking makes sprites vanish
      // in art-scene mode. Reset the shelves and rebuild lazily from the
      // sprites actually drawn — packing is synchronous, so the working set
      // repacks within a frame. Thrash guard: if it fills again within the
      // SAME frame, this frame's working set itself exceeds the atlas; mark
      // overflow null (retried after the next reset).
      if (this.frame !== this._lastAtlasReset) {
        this._lastAtlasReset = this.frame;
        this.atlasRects.clear();
        this._shelfX = 1;
        this._shelfY = this._playerRegion.y + this._playerRegion.h + 2;
        this._shelfH = 0;
        console.log('[GL] sprite atlas full — reset, repacking visible sprites');
      } else {
        if (!this._atlasFullWarned) {
          this._atlasFullWarned = true;
          console.warn('[GL] sprite atlas working set exceeds capacity (' + this.atlasRects.size + ' sprites) — overflow sprites skipped');
        }
        this.atlasRects.set(url, null);
        return null;
      }
    }
    var x = this._shelfX;
    var y = this._shelfY;
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } catch (e) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.atlasRects.set(url, null);
      return null;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this._shelfX += w + 1;
    if (h > this._shelfH) this._shelfH = h;
    // Half-texel inset prevents NEAREST bleed from neighboring sprites
    rect = { u0: (x + 0.5) / A, v0: (y + 0.5) / A, du: (w - 1) / A, dv: (h - 1) / A };
    this.atlasRects.set(url, rect);
    return rect;
  }

  // Upload the player's composited canvas into its reserved atlas region.
  // Returns the UV rect, or null if sprites are unavailable.
  uploadPlayerSprite(canvas) {
    if (!this.ok || !this.spritesOk) return null;
    var gl = this.gl;
    var r = this._playerRegion;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    } catch (e) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      return null;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    var A = this.atlasSize;
    return { u0: r.x / A, v0: r.y / A, du: r.w / A, dv: r.h / A };
  }

  // Draw `count` sprite instances from a packed Float32Array
  // (SPRITE_FLOATS floats each, in back-to-front order).
  drawSpriteInstances(data, count, cssW, cssH) {
    if (!this.ok || !this.spritesOk || count === 0) return;
    var gl = this.gl;
    gl.useProgram(this.spriteProgram);
    gl.bindVertexArray(this.spriteVao);
    // In scene mode the viewport MUST match beginScene's art dims exactly,
    // or sprites drift off the terrain's pixel grid by the ceil+margin delta.
    if (this.sceneActive) gl.uniform2f(this.sUViewport, this._artW, this._artH);
    else gl.uniform2f(this.sUViewport, cssW, cssH);
    gl.uniform3f(this.sUCam, 0, 0, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.sUAtlas, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    var bytes = count * SPRITE_STRIDE;
    if (bytes > this._instCapacityBytes) {
      this._instCapacityBytes = bytes * 2;
      gl.bufferData(gl.ARRAY_BUFFER, this._instCapacityBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * SPRITE_FLOATS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // Draw silhouette shadows (same packed layout as sprites). shadowVec is the
  // ground displacement of a sprite's TOP, as a fraction of sprite size
  // (x = horizontal skew toward shadow side, y = vertical ground run).
  drawShadowInstances(data, count, cssW, cssH, shadowVec, strength) {
    if (!this.ok || !this.shadowOk || count === 0) return;
    var gl = this.gl;
    gl.useProgram(this.shadowProgram);
    gl.bindVertexArray(this.shadowVao);
    if (this.sceneActive) gl.uniform2f(this.shUViewport, this._artW, this._artH);
    else gl.uniform2f(this.shUViewport, cssW, cssH);
    gl.uniform3f(this.shUCam, 0, 0, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.shUAtlas, 0);
    gl.uniform2f(this.shUShadowVec, shadowVec.x, shadowVec.y);
    gl.uniform1f(this.shUShadowAlpha, strength);
    gl.uniform1f(this.shUAtlasTexel, 1 / (this.atlasSize || 1));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowVbo);
    var bytes = count * SPRITE_STRIDE;
    if (bytes > this._shadowCapacityBytes) {
      this._shadowCapacityBytes = bytes * 2;
      gl.bufferData(gl.ARRAY_BUFFER, this._shadowCapacityBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * SPRITE_FLOATS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // --- Persistent sprite pool (world-space instances, partial uploads) ---
  // The pool owns two VBOs (sprites, shadows) that survive across frames.
  // ensurePoolCapacity grows them; uploadPoolRange patches dirty instances;
  // drawPoolRange draws a contiguous instance range by re-pointing the
  // instance attributes (WebGL2 has no baseInstance).

  ensurePoolCapacity(kind, instCount) {
    if (!this.ok || !this.spritesOk) return false;
    var gl = this.gl;
    if (!this._pool) this._pool = {};
    var p = this._pool[kind];
    if (!p) {
      p = this._pool[kind] = { vbo: gl.createBuffer(), capBytes: 0 };
    }
    var bytes = Math.max(4096 * SPRITE_STRIDE, instCount * SPRITE_STRIDE);
    if (bytes > p.capBytes) {
      gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
      p.capBytes = bytes * 2;
      gl.bufferData(gl.ARRAY_BUFFER, p.capBytes, gl.DYNAMIC_DRAW);
    }
    return true;
  }

  // Upload `count` instances from mirror (Float32Array of packed instances)
  // starting at instance index `start` (same index in VBO and mirror).
  uploadPoolRange(kind, mirror, start, count) {
    if (!this.ok || !this.spritesOk || count === 0) return;
    var gl = this.gl;
    var p = this._pool && this._pool[kind];
    if (!p) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, start * SPRITE_STRIDE,
      mirror, start * SPRITE_FLOATS, count * SPRITE_FLOATS);
  }

  // Point the 3 instance attributes of the currently-bound VAO at byte offset
  // start*stride of the given VBO. attribLocs = { psr, alpha, uv }.
  _pointPoolAttribs(vbo, locs, startInst) {
    var gl = this.gl;
    var base = startInst * SPRITE_STRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.vertexAttribPointer(locs.psr, 4, gl.FLOAT, false, SPRITE_STRIDE, base);
    gl.vertexAttribPointer(locs.alpha, 1, gl.FLOAT, false, SPRITE_STRIDE, base + 16);
    gl.vertexAttribPointer(locs.uv, 4, gl.FLOAT, false, SPRITE_STRIDE, base + 20);
  }

  // Draw instances [start, start+count) of the persistent sprite pool.
  // cam = { x, y, scale } (screen-px offset + px-per-tile).
  drawPoolSprites(start, count, cssW, cssH, cam) {
    if (!this.ok || !this.spritesOk || count === 0) return;
    var p = this._pool && this._pool.sprite;
    if (!p) return;
    var gl = this.gl;
    gl.useProgram(this.spriteProgram);
    gl.bindVertexArray(this.spriteVao);
    if (this.sceneActive) gl.uniform2f(this.sUViewport, this._artW, this._artH);
    else gl.uniform2f(this.sUViewport, cssW, cssH);
    gl.uniform3f(this.sUCam, cam.x, cam.y, cam.scale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.sUAtlas, 0);
    this._pointPoolAttribs(p.vbo, this._spriteAttribLocs, start);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    // Restore VAO's default pointers (offset 0 into the legacy instVbo) so
    // legacy drawSpriteInstances callers are unaffected.
    this._pointPoolAttribs(this.instVbo, this._spriteAttribLocs, 0);
    gl.bindVertexArray(null);
  }

  drawPoolShadows(start, count, cssW, cssH, cam, shadowVec, strength) {
    if (!this.ok || !this.shadowOk || count === 0) return;
    var p = this._pool && this._pool.shadow;
    if (!p) return;
    var gl = this.gl;
    gl.useProgram(this.shadowProgram);
    gl.bindVertexArray(this.shadowVao);
    if (this.sceneActive) gl.uniform2f(this.shUViewport, this._artW, this._artH);
    else gl.uniform2f(this.shUViewport, cssW, cssH);
    gl.uniform3f(this.shUCam, cam.x, cam.y, cam.scale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.shUAtlas, 0);
    gl.uniform2f(this.shUShadowVec, shadowVec.x, shadowVec.y);
    gl.uniform1f(this.shUShadowAlpha, strength);
    gl.uniform1f(this.shUAtlasTexel, 1 / (this.atlasSize || 1));
    this._pointPoolAttribs(p.vbo, this._shadowAttribLocs, start);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    this._pointPoolAttribs(this.shadowVbo, this._shadowAttribLocs, 0);
    gl.bindVertexArray(null);
  }

  endFrame() {
    if (!this.ok) return;
    this.frame++;
    if (this.frame % SWEEP_INTERVAL === 0) this._sweep();
  }

  _sweep() {
    var gl = this.gl;
    for (var [key, entry] of this.textures) {
      if (this.frame - entry.lastUsed > EVICT_AFTER_FRAMES) {
        gl.deleteTexture(entry.tex);
        this.textures.delete(key);
      }
    }
  }

  stats() {
    return { glTextures: this.textures.size, atlasSprites: this.atlasRects ? this.atlasRects.size : 0 };
  }
}
