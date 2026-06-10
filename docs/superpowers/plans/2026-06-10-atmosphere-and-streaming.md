# Atmosphere, Lighting & Chunk Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-biome GPU color grading driven by the user's 21 tuner configs, with seamless spatial blending, long silhouette shadows, cloud shadows, god rays, fog, night floor, water glints, tinted precipitation — plus stutter-free chunk streaming.

**Architecture:** All spatial/color work lands in the existing WebGL2 present shader in `gl-compositor.js`, following the proven water-shimmer-field pattern (per-tile RGBA data textures, bilinear-sampled). New pure-data module `src/world/biome-atmosphere.js` + field builder `src/render/atmosphere-pass.js`. Existing 2D precipitation kept, tinted. Streaming fixes in `chunk-provider.js`.

**Tech Stack:** Vanilla ES modules, WebGL2 (GLSL ES 3.00), no build step. Dev server serves the working tree live at localhost:8741. No unit-test framework — verification is (a) Node ESM import scripts for pure modules (works: `/tmp/find-biomes.mjs` precedent), (b) headless Playwright harness at `C:\Users\daves\AppData\Local\Temp\pwtest` (chromium-1217, `--use-angle=swiftshader`).

**Testing conventions (all visual tasks):**
- Launch page `http://localhost:8741/?x=<wx>&y=<wy>`, wait for `/bitmaps (\d+)/ >= 9` in `#stats`, press `l` to freeze the sun, screenshot via `page.screenshot` (GL canvas has `preserveDrawingBuffer:false` — never `drawImage`/`getImageData`).
- Useful coords: steppe (-1248,-992), desert (6688,-736), swamp (-1504,2336), arctic (-4576,4640), shallow_water (-992,1056), tundra (-5088,3104). Biome border for seam test: walk x from -1300 to -1200 at y=-600 (steppe→beach region) or diff a wide screenshot.
- To force a phase: in page context run `window._debugLighting = true` is NOT available — instead set time directly: `await page.evaluate(() => {})` won't reach module scope. **Add once in Task 5** a debug hook `window._lighting = lighting` in main.js so tests can do `page.evaluate(t => { window._lighting.time = t; window._lighting.paused = true; }, 0.65)` (golden hour) / `0.05` (deep night) / `0.45` (noon).
- After any src change, test with a fresh incognito context (browser caches workers; known gotcha).

**Commit after every task** (working tree is live-served; keep tasks atomic and revertible).

---

### Task 1: Biome atmosphere config module

**Files:**
- Create: `src/world/biome-atmosphere.js`
- Verify: `/tmp/check-atmo.mjs` (throwaway)

- [ ] **Step 1: Write the module**

```js
// Per-biome atmosphere configs — authored by the user in the brainstorm tuner
// (docs/superpowers/specs/2026-06-10-biome-atmosphere-tuning.json). Sliders:
// hue ±60°, sat/con/bri percent (100 = neutral), warm/fog/shadow/night 0-100.
// Mood = grading personality (tone curve + screen-space overlays in shader).

export var MOOD_IDS = ['filmic', 'painterly', 'muted', 'chiaroscuro'];

export var BIOME_ATMOSPHERE = {
  grassland:       { mood: 'filmic',      hue: 1,   sat: 115, con: 111, bri: 110, warm: 88,  fog: 0,  shadow: 50, night: 1 },
  forest:          { mood: 'filmic',      hue: 0,   sat: 99,  con: 122, bri: 111, warm: 0,   fog: 0,  shadow: 62, night: 6 },
  dense_forest:    { mood: 'muted',       hue: -13, sat: 140, con: 112, bri: 90,  warm: 0,   fog: 2,  shadow: 50, night: 25 },
  tropical_forest: { mood: 'filmic',      hue: 2,   sat: 95,  con: 131, bri: 103, warm: 57,  fog: 13, shadow: 50, night: 12 },
  taiga:           { mood: 'muted',       hue: 10,  sat: 100, con: 126, bri: 107, warm: 100, fog: 0,  shadow: 50, night: 20 },
  swamp:           { mood: 'chiaroscuro', hue: 1,   sat: 83,  con: 119, bri: 99,  warm: 0,   fog: 25, shadow: 53, night: 12 },
  steppe:          { mood: 'muted',       hue: -6,  sat: 104, con: 112, bri: 102, warm: 26,  fog: 10, shadow: 49, night: 5 },
  savanna:         { mood: 'muted',       hue: -2,  sat: 91,  con: 122, bri: 103, warm: 100, fog: 31, shadow: 50, night: 6 },
  desert:          { mood: 'filmic',      hue: -6,  sat: 68,  con: 101, bri: 109, warm: 100, fog: 0,  shadow: 50, night: 0 },
  beach:           { mood: 'filmic',      hue: 1,   sat: 86,  con: 91,  bri: 108, warm: 34,  fog: 32, shadow: 50, night: 0 },
  hills:           { mood: 'chiaroscuro', hue: -15, sat: 101, con: 109, bri: 112, warm: 6,   fog: 27, shadow: 41, night: 5 },
  mountains:       { mood: 'muted',       hue: -6,  sat: 110, con: 119, bri: 110, warm: 81,  fog: 0,  shadow: 50, night: 25 },
  tundra:          { mood: 'chiaroscuro', hue: 8,   sat: 117, con: 98,  bri: 103, warm: 0,   fog: 40, shadow: 50, night: 8 },
  arctic:          { mood: 'painterly',   hue: -6,  sat: 77,  con: 109, bri: 96,  warm: 0,   fog: 11, shadow: 50, night: 3 },
  volcanic:        { mood: 'chiaroscuro', hue: -1,  sat: 109, con: 114, bri: 106, warm: 100, fog: 9,  shadow: 47, night: 21 },
  mystic:          { mood: 'chiaroscuro', hue: 0,   sat: 89,  con: 127, bri: 107, warm: 0,   fog: 4,  shadow: 50, night: 11 },
  river:           { mood: 'filmic',      hue: 1,   sat: 113, con: 117, bri: 100, warm: 0,   fog: 23, shadow: 58, night: 13 },
  lake:            { mood: 'filmic',      hue: -2,  sat: 124, con: 107, bri: 105, warm: 0,   fog: 3,  shadow: 50, night: 2 },
  shallow_water:   { mood: 'filmic',      hue: 4,   sat: 103, con: 109, bri: 99,  warm: 31,  fog: 0,  shadow: 51, night: 17 },
  ocean:           { mood: 'chiaroscuro', hue: 2,   sat: 112, con: 113, bri: 110, warm: 44,  fog: 0,  shadow: 49, night: 3 },
  deep_ocean:      { mood: 'chiaroscuro', hue: 2,   sat: 99,  con: 112, bri: 130, warm: 0,   fog: 2,  shadow: 50, night: 53 },
};

var DEFAULT_ATMO = { mood: 'painterly', hue: 0, sat: 100, con: 105, bri: 100, warm: 30, fog: 15, shadow: 50, night: 25 };

export function getAtmosphere(biomeId) {
  return BIOME_ATMOSPHERE[biomeId] || DEFAULT_ATMO;
}

// Pack one biome's config into three parallel RGBA byte quads at offset o.
// A: hue (128 = 0°, full range ±60°), sat, con, bri (0..255 = 0..200%)
// B: warm, fog, shadow, night (0..255 = slider 0..100)
// C: mood one-hot (bilinear filtering blends these into smooth mood weights)
export function packAtmosphere(cfg, outA, outB, outC, o) {
  outA[o]     = Math.round((cfg.hue + 60) / 120 * 255);
  outA[o + 1] = Math.round(cfg.sat / 200 * 255);
  outA[o + 2] = Math.round(cfg.con / 200 * 255);
  outA[o + 3] = Math.round(cfg.bri / 200 * 255);
  outB[o]     = Math.round(cfg.warm * 2.55);
  outB[o + 1] = Math.round(cfg.fog * 2.55);
  outB[o + 2] = Math.round(cfg.shadow * 2.55);
  outB[o + 3] = Math.round(cfg.night * 2.55);
  var mi = MOOD_IDS.indexOf(cfg.mood);
  if (mi < 0) mi = 1;
  outC[o]     = mi === 0 ? 255 : 0;
  outC[o + 1] = mi === 1 ? 255 : 0;
  outC[o + 2] = mi === 2 ? 255 : 0;
  outC[o + 3] = mi === 3 ? 255 : 0;
}
```

- [ ] **Step 2: Verify via Node import**

Write `/tmp/check-atmo.mjs`:

```js
import { BIOME_ATMOSPHERE, getAtmosphere, packAtmosphere, MOOD_IDS } from 'file:///C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/src/world/biome-atmosphere.js';
const biomes = Object.keys(BIOME_ATMOSPHERE);
if (biomes.length !== 21) throw new Error('expected 21 biomes, got ' + biomes.length);
const a = new Uint8Array(4), b = new Uint8Array(4), c = new Uint8Array(4);
packAtmosphere(getAtmosphere('desert'), a, b, c, 0);
// desert: hue -6 → round((54/120)*255)=115; warm 100 → 255; night 0 → 0; mood filmic → C[0]=255
if (a[0] !== 115) throw new Error('hue pack: ' + a[0]);
if (b[0] !== 255 || b[3] !== 0) throw new Error('warm/night pack: ' + b[0] + ',' + b[3]);
if (c[0] !== 255 || c[1] !== 0) throw new Error('mood pack');
packAtmosphere(getAtmosphere('nonexistent_biome'), a, b, c, 0);
if (c[1] !== 255) throw new Error('default mood should be painterly');
console.log('OK: 21 biomes, packing verified');
```

Run: `node /tmp/check-atmo.mjs` — Expected: `OK: 21 biomes, packing verified`

- [ ] **Step 3: Commit**

```bash
git add src/world/biome-atmosphere.js
git commit -m "feat: per-biome atmosphere config module (user-tuned, 21 biomes)"
```

---

### Task 2: Atmosphere field builder

**Files:**
- Create: `src/render/atmosphere-pass.js`
- Verify: `/tmp/check-atmo-field.mjs`

Mirrors `buildWaveField` in `src/render/water-wave-overlay.js:100-122`: one texel per world tile, viewport-sized, rebuilt per frame (cheap: ~60×40 tiles × 3 small buffers).

- [ ] **Step 1: Write the module**

```js
// Builds the per-tile atmosphere field textures for the GL present pass.
// Same shape/convention as buildWaveField (water-wave-overlay.js): one texel
// per world tile covering the viewport plus margin. Three RGBA8 layers:
//   A = hue/sat/con/bri, B = warm/fog/shadow/night, C = mood one-hot weights.
// The GPU samples these LINEAR + a blur kernel, so per-biome values cross-fade
// spatially over a wide band — the "seamless transition" requirement.
import { getAtmosphere, packAtmosphere } from '../world/biome-atmosphere.js';

var _bufA = null, _bufB = null, _bufC = null;

export function buildAtmoField(chunkStore, tile0X, tile0Y, tilesW, tilesH) {
  var n = tilesW * tilesH * 4;
  if (!_bufA || _bufA.length !== n) {
    _bufA = new Uint8Array(n);
    _bufB = new Uint8Array(n);
    _bufC = new Uint8Array(n);
  }
  for (var ty = 0; ty < tilesH; ty++) {
    for (var tx = 0; tx < tilesW; tx++) {
      var o = (ty * tilesW + tx) * 4;
      var tile = chunkStore.tileAt(tile0X + tx, tile0Y + ty);
      packAtmosphere(getAtmosphere(tile ? tile.biome : null), _bufA, _bufB, _bufC, o);
    }
  }
  return { a: _bufA, b: _bufB, c: _bufC };
}
```

- [ ] **Step 2: Verify via Node with a stub chunkStore**

Write `/tmp/check-atmo-field.mjs`:

```js
import { buildAtmoField } from 'file:///C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/src/render/atmosphere-pass.js';
const stub = { tileAt: (x, y) => ({ biome: x < 2 ? 'desert' : 'arctic' }) };
const f = buildAtmoField(stub, 0, 0, 4, 2);
if (f.a.length !== 32) throw new Error('size');
// texel (0,0)=desert → warm=255 ; texel (3,0)=arctic → warm=0, mood painterly C[1]=255
if (f.b[0] !== 255) throw new Error('desert warm');
if (f.b[3 * 4] !== 0) throw new Error('arctic warm');
if (f.c[3 * 4 + 1] !== 255) throw new Error('arctic mood');
console.log('OK: field builder verified');
```

Run: `node /tmp/check-atmo-field.mjs` — Expected: `OK: field builder verified`

- [ ] **Step 3: Commit**

```bash
git add src/render/atmosphere-pass.js
git commit -m "feat: per-tile atmosphere field builder"
```

---

### Task 3: GLCompositor atmosphere plumbing (textures + uniforms, inert)

**Files:**
- Modify: `src/render/gl-compositor.js`

Adds the three field textures, uniform locations, and setter methods — with `uAtmoOn` defaulting to 0 so this task is visually inert (safe to verify by absence of errors).

- [ ] **Step 1: Add uniforms to PRESENT_FRAG_SRC**

In `PRESENT_FRAG_SRC`, directly after `uniform float uCrt;` (gl-compositor.js:105), add:

```glsl
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
```

- [ ] **Step 2: Get locations + create textures in `_ensureScene`**

After `this.pUTilePx = ...` (line 358), add:

```js
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
```

- [ ] **Step 3: Add setter methods after `clearWaveField()` (line 432)**

```js
  // Atmosphere field: three per-tile RGBA layers (see atmosphere-pass.js).
  // Same origin convention as setWaveField.
  setAtmoField(field, tilesW, tilesH, orgX, orgY) {
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
  }

  // Per-frame scalar atmosphere environment (sun/weather/time).
  setAtmoEnv(env) {
    this._atmoEnv = env;
  }

  clearAtmoField() {
    this._atmoOn = false;
  }
```

- [ ] **Step 4: Bind in `presentScene` (after the wave block, line 463-465)**

```js
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
    } else {
      gl.uniform1f(this.pUAtmoOn, 0);
    }
```

- [ ] **Step 5: Verify shader still compiles**

Playwright (or just load the game): console must contain `[GL] WebGL2 terrain compositor ready` and `[GL] art-res scene framebuffer`, and must NOT contain `[GL] fragment shader:` errors. Note: declared-but-unused uniforms are legal GLSL — no atmosphere math exists yet.

- [ ] **Step 6: Commit**

```bash
git add src/render/gl-compositor.js
git commit -m "feat: atmosphere field textures + uniform plumbing in GL compositor (inert)"
```

---

### Task 4: Present-shader atmosphere block + renderer wiring

**Files:**
- Modify: `src/render/gl-compositor.js` (shader main + helpers)
- Modify: `src/render/canvas-renderer.js` (build/upload field, env uniforms, retire 2D tint/fog in GL mode)
- Modify: `src/main.js` (expose `window._lighting`, `window.atmo` dev hook)

- [ ] **Step 1: Add GLSL helpers to PRESENT_FRAG_SRC**

Insert after the `sim()` function (gl-compositor.js:115):

```glsl
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
  return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
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
```

- [ ] **Step 2: Add the atmosphere block to `main()`**

Insert AFTER the wave block (`if (uWaveOn > 0.5) {...}`, line 151-160) and BEFORE the CRT block (line 161):

```glsl
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

    // day/night brightness with per-biome night floor (the "too dark" fix)
    float floorB = mix(0.10, 0.60, nightF);
    float nightAmt = 1.0 - smoothstep(0.10, 0.55, uAmbient);
    float darkMul = max(uAmbient, floorB);
    c = mix(c, c * darkMul * vec3(0.62, 0.70, 1.10), nightAmt);

    // god rays: angled shafts at low sun, strongest with fog
    float rayAmt = (1.0 - smoothstep(0.08, 0.45, uSunHeight)) * step(0.02, uSunHeight);
    float rayStr = rayAmt * (0.25 + fogD * 0.75) * 0.30;
    if (rayStr > 0.004) {
      vec2 rd = normalize(vec2(cos(uSunAzim), 0.55));
      float band = dot(vTL, rd) * 14.0 + uTimeSec * 0.06;
      float shafts = smoothstep(0.45, 1.0, vnoise(vec2(band, band * 0.13)));
      c += uPhaseTint * shafts * rayStr * (1.0 - vig * 0.5);
    }

    // fog: per-biome density, phase-colored, breathing noise, edge-biased
    float fn = vnoise((texel + uWorldOrg) * 0.012 + vec2(uTimeSec * 0.015, -uTimeSec * 0.010));
    float fedge = smoothstep(0.25, 0.95, length(vTL - 0.5) * 1.45);
    float fogA = clamp(fogD * (0.30 + 0.45 * fedge + 0.25 * fn), 0.0, 0.8);
    c = mix(c, uFogColor, fogA * 0.55);
    c = clamp(c, 0.0, 1.0);
  }
```

- [ ] **Step 3: Wire the renderer (`canvas-renderer.js`)**

(a) Add import at top: `import { buildAtmoField } from './atmosphere-pass.js';`

(b) In `draw()`, inside the `if (glScene) { ... }` block (lines 423-435), after the wave-field upload and before `presentScene`:

```js
      const afield = buildAtmoField(chunkStore, tile0X, tile0Y, tilesW, tilesH);
      this.glc.setAtmoField(afield, tilesW, tilesH, camXi - tile0X * ts, camYi - tile0Y * ts);
      const cloudsNow = weather ? weather.clouds() : { cover: 0, speed: 0, direction: 0 };
      if (!this._cloudOff) this._cloudOff = { x: 0, y: 0, t: performance.now() };
      const cdt = Math.min(0.1, (performance.now() - this._cloudOff.t) / 1000);
      this._cloudOff.t = performance.now();
      this._cloudOff.x += Math.cos(cloudsNow.direction) * cloudsNow.speed * 14 * cdt;
      this._cloudOff.y += Math.sin(cloudsNow.direction) * cloudsNow.speed * 14 * cdt;
      this.glc.setAtmoEnv({
        ambient: sun.ambient,
        tint: [sun.tint.r, sun.tint.g, sun.tint.b],
        fogColor: [sun.fogTint[0] / 255, sun.fogTint[1] / 255, sun.fogTint[2] / 255],
        sunAzim: sun.sunAngle,
        sunHeight: sun.sunHeight,
        timeSec: performance.now() / 1000,
        cloudCover: cloudsNow.cover,
        cloudOffX: this._cloudOff.x,
        cloudOffY: this._cloudOff.y,
        worldOrgX: camXi,
        worldOrgY: camYi,
      });
```

Note: the wave block computes `tile0X/tile0Y/tilesW/tilesH` already (lines 427-430) — the atmosphere field reuses the exact same values, so this code goes right below `else this.glc.clearWaveField();`.

(c) Retire the 2D overlays in GL-scene mode. Change the weather/lighting calls (lines 405-413) to:

```js
    if (weather) {
      drawPrecipitation(ctx, w, h, weather.precipitation(), weather.wind(), performance.now() / 1000, sun.tint);
      if (!glScene) drawFog(ctx, w, h, weather.atmosphere().fog);
    }

    // Atmospheric color grading: in GL-scene mode the present shader does
    // tint/darkness/fog; keep only moonlight + player torch glow on 2D.
    if (sun) {
      this.drawLighting(ctx, sun, w, h, weather, player, camera, glScene);
    }
```

(d) Thread `glMode` through `drawLighting(ctx, sun, w, h, weather, player, camera, glMode)` → `this._paintLighting(lctx, sun, w, h, weather, player, camera, glMode)`, and in `_paintLighting` wrap the now-shader-owned sections:

- Section 1 (directional sunlight gradient, lines 597-635): wrap in `if (!glMode) { ... }`
- Section 2 (color tint overlay, lines 637-647): wrap in `if (!glMode) { ... }`
- Section 3 (night darkness, lines 649-665): wrap in `if (!glMode) { ... }`
- Section 5 (cloud dimming, lines 680-685): wrap in `if (!glMode) { ... }`
- Sections 4 (moonlight) and 6 (player spotlight/torch) stay unconditional.

(`drawPrecipitation` gains a `tint` parameter here but ignores it until Task 8 — add the parameter to the signature now: `function drawPrecipitation(ctx, w, h, precip, wind, time, tint)`.)

- [ ] **Step 4: Dev hooks in `main.js`**

After `window._debugChunks = chunks;` (line 28):

```js
window._lighting = null; // set below — lets tests/dev freeze & set time of day
```

After `const lighting = new DayNightCycle();` (line 33):

```js
window._lighting = lighting;
import('./world/biome-atmosphere.js').then(m => {
  window.atmo = {
    set(biome, partial) { Object.assign(m.BIOME_ATMOSPHERE[biome], partial); },
    get(biome) { return m.BIOME_ATMOSPHERE[biome]; },
  };
});
```

- [ ] **Step 5: Visual verification (Playwright, incognito)**

Script outline (reuse the biomes.js harness pattern):
1. Desert (6688,-736): set `window._lighting.time = 0.45; window._lighting.paused = true;` wait 1s, screenshot → must look desaturated/warm vs a stash of the pre-change screenshot `screenshots/_atmo_desert.png` (pixel-diff > 5%).
2. Same coords, `time = 0.05` (deep night): mean luminance must be LOW but > 0 (desert night floor 0 → very dark). Then deep_ocean (32,-2528) at `time = 0.05`: mean luminance must be ≥ 2× desert's (night floor 53).
3. Tundra (-5088,3104) at `time = 0.65` (golden hour): god rays + fog 40 — screenshot for human review.
4. Seam test: spawn between steppe and neighbor at (-1248,-800), wide screenshot, scan one pixel row crossing the border: no adjacent-pixel RGB jump > 60 attributable to a vertical grading seam (sample the same row twice 200px apart and verify gradient is smooth — eyeball the saved image too).
5. Console: zero `[GL] fragment shader` errors.

- [ ] **Step 6: Commit**

```bash
git add src/render/gl-compositor.js src/render/canvas-renderer.js src/render/atmosphere-pass.js src/main.js
git commit -m "feat: GPU per-biome atmosphere pass — grading, moods, night floor, fog, cloud shadows, god rays"
```

---

### Task 5: Steeper sun & longer dramatic phases (lighting.js)

**Files:**
- Modify: `src/world/lighting.js`

- [ ] **Step 1: Lengthen golden hour / dawn, retune shadow length**

(a) In `PHASES` (lighting.js:4-29), change phase boundaries to widen the dramatic windows (dawn 0.22→0.30 stays, golden hour grows, dusk shifts later):

```js
  { name: 'noon',      start: 0.42, ... },          // unchanged
  { name: 'golden_hour', start: 0.55,                // was 0.58 — golden light starts earlier
    ambient: 0.62, tint: { r: 1.25, g: 0.78, b: 0.35 },
    sky: [210, 120, 40], fog: [220, 150, 80] },
  { name: 'dusk',      start: 0.74,                  // was 0.72 — golden hour lasts longer
    ...unchanged fields... },
```

(b) In `sun()` (lines 105-110), replace the shadow formulas with steeper-sun versions:

```js
    var shadowSource = sunHeight > 0.05 ? sunAngle : moonAngle;
    var shadowHeight = sunHeight > 0.05 ? sunHeight : moonHeight;
    // Steep-sun look: shadows stretch hard at dawn/golden/dusk (low sun),
    // stay short and tight at noon. Length in "object heights".
    var lowSun = Math.pow(1 - shadowHeight, 1.6);
    var shadowX = -Math.cos(shadowSource) * (1.0 + lowSun * 1.6);
    var shadowY = 0.30 + lowSun * 0.55;
    var shadowLength = 0.35 + lowSun * 3.4;   // up to ~3.75 object heights
```

- [ ] **Step 2: Verify numerically via Node**

`/tmp/check-sun.mjs`:

```js
import { DayNightCycle } from 'file:///C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/src/world/lighting.js';
const d = new DayNightCycle();
d.time = 0.50; const noon = d.sun();
d.time = 0.65; const golden = d.sun();
if (!(golden.shadowLength > noon.shadowLength * 2.5)) throw new Error('golden shadows not long enough: ' + golden.shadowLength + ' vs ' + noon.shadowLength);
if (golden.label !== 'golden_hour') throw new Error('phase at 0.65: ' + golden.label);
console.log('OK: noon shadowLength', noon.shadowLength.toFixed(2), '→ golden', golden.shadowLength.toFixed(2));
```

Run: `node /tmp/check-sun.mjs` — Expected: `OK:` line with golden ≥ 2.5× noon.

- [ ] **Step 3: Commit**

```bash
git add src/world/lighting.js
git commit -m "feat: steeper sun — longer shadows at dawn/golden/dusk, wider golden hour"
```

---

### Task 6: Silhouette shadow pipeline

**Files:**
- Modify: `src/render/gl-compositor.js` (shadow shader program + draw method)
- Modify: `src/render/field2-animator.js` (shadow instance batch)
- Modify: `src/render/canvas-renderer.js` (`drawPlayerAt` stretched player shadow)

Shadows reuse the EXISTING sprite atlas and instance layout (`SPRITE_FLOATS` = 9: pivotX, pivotY, size, rot, alpha, u0, v0, du, dv) — a second instanced draw with a shear shader, drawn BEFORE the sprite batch so all sprites sit on top of all shadows.

- [ ] **Step 1: Shadow shader in gl-compositor.js**

After `SPRITE_FRAG_SRC` (line 67):

```js
// Silhouette shadows: same instance data as sprites, but the quad is sheared
// along the sun direction and flattened onto the ground. The fragment shader
// keeps only the sprite's alpha as a dark, tip-faded silhouette.
var SHADOW_VERT_SRC = `#version 300 es
precision highp float;
in vec2 aUnit;
in vec4 aPSR;      // pivot.xy, size, rotation (rotation ignored for shadows)
in float aAlpha;   // sprite alpha * per-biome shadow strength
in vec4 aUV;
uniform vec2 uViewport;
uniform vec2 uShadowVec;  // ground displacement per unit sprite-height (art px ratio): x=skew, y=flatten
out vec2 vUV;
out float vAlpha;
out float vH;             // 0 at base, 1 at sprite top
void main() {
  float hgt = 1.0 - aUnit.y;                       // quad top = sprite top
  vec2 base = vec2(aUnit.x * aPSR.z - aPSR.z * 0.5, 0.0);
  // project the sprite onto the ground: top of sprite lands shadowVec away
  vec2 px = aPSR.xy + base + hgt * aPSR.z * uShadowVec;
  vec2 clip = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV.xy + aUnit * aUV.zw;
  vAlpha = aAlpha;
  vH = hgt;
}`;

var SHADOW_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
in float vH;
uniform sampler2D uAtlas;
uniform float uShadowAlpha; // global strength (sun-height driven)
out vec4 outColor;
void main() {
  float a = texture(uAtlas, vUV).a * vAlpha * uShadowAlpha * (1.0 - vH * 0.55);
  outColor = vec4(vec3(0.035, 0.045, 0.085) * a, a); // premultiplied dark blue-black
}`;
```

- [ ] **Step 2: Build the program in `_initSprites()` and add `drawShadowInstances`**

At the end of `_initSprites()` (before `this.spritesOk = true;`):

```js
    var sprog = this._buildProgram(SHADOW_VERT_SRC, SHADOW_FRAG_SRC);
    this.shadowOk = false;
    if (sprog) {
      this.shadowProgram = sprog;
      this.shUViewport = gl.getUniformLocation(sprog, 'uViewport');
      this.shUAtlas = gl.getUniformLocation(sprog, 'uAtlas');
      this.shUShadowVec = gl.getUniformLocation(sprog, 'uShadowVec');
      this.shUShadowAlpha = gl.getUniformLocation(sprog, 'uShadowAlpha');
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
      this.shadowOk = true;
    }
```

New method after `drawSpriteInstances` (line 641):

```js
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
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.shUAtlas, 0);
    gl.uniform2f(this.shUShadowVec, shadowVec.x, shadowVec.y);
    gl.uniform1f(this.shUShadowAlpha, strength);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowVbo);
    var bytes = count * SPRITE_STRIDE;
    if (bytes > this._shadowCapacityBytes) {
      this._shadowCapacityBytes = bytes * 2;
      gl.bufferData(gl.ARRAY_BUFFER, this._shadowCapacityBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * SPRITE_FLOATS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
```

- [ ] **Step 3: Shadow batch in field2-animator.js**

(a) Import at top (line ~10 already imports SPRITE_FLOATS — extend the existing import):
`import { getAtmosphere } from '../world/biome-atmosphere.js';`

(b) In the tile loop, capture per-biome shadow strength once per tile (after `var currentEffect = sampleCurrents(...)`, line 807):

```js
      var biomeShadowK = getAtmosphere(tile.biome).shadow / 100;
```

and add `shadowK: biomeShadowK` to BOTH `drawBuffer.push({...})` objects (lines 885 and 900).

(c) In the GL branch (after `drawBuffer.sort(...)`, inside `if (glc && glc.spritesOk)`), build the shadow array BEFORE the sprite instance loop. Add module-level `var _shadowArray = null;` next to `_instArray`. Then, right before `var instCount = 0;`:

```js
    // Silhouette shadows: one shadow instance per sufficiently large sprite.
    // Tiny sprites (grass blades < 60% of a tile) skip — silhouettes don't
    // read at that size and the ground sells the lighting anyway (the
    // approved "blob fallback" degenerates to no-op for sub-tile flora).
    var sunH = sun ? sun.sunHeight : 1;
    var shadowOn = glc.shadowOk && sun && sunH > 0.04;
    var shCount = 0;
    if (shadowOn) {
      if (!_shadowArray || _shadowArray.length < drawBuffer.length * SPRITE_FLOATS) {
        _shadowArray = new Float32Array(Math.max(4096, drawBuffer.length * SPRITE_FLOATS * 2));
      }
      var minShadowSize = tilePxSnapped * 0.6;
      for (var shi = 0; shi < drawBuffer.length; shi++) {
        var sg = drawBuffer[shi];
        if (sg.drawSize < minShadowSize) continue;
        var srect = glc.atlasRect(sg.img, sg._url);
        if (!srect) continue;
        var so = shCount * SPRITE_FLOATS;
        _shadowArray[so] = sg.sx;
        _shadowArray[so + 1] = sg.sy + sg.halfDraw;       // same ground pivot as sprite
        _shadowArray[so + 2] = sg.drawSize;
        _shadowArray[so + 3] = 0;
        _shadowArray[so + 4] = sg.alpha * (sg.shadowK !== undefined ? sg.shadowK : 0.5);
        _shadowArray[so + 5] = srect.u0;
        _shadowArray[so + 6] = srect.v0;
        _shadowArray[so + 7] = srect.du;
        _shadowArray[so + 8] = srect.dv;
        shCount++;
      }
    }
```

and AFTER the existing sprite loop fills `_instArray` but BEFORE `glc.drawSpriteInstances(_instArray, instCount, w, h);`:

```js
    if (shadowOn && shCount > 0) {
      // shadowVec: top of sprite lands shadowLength sprite-heights away,
      // skewed horizontally by sun azimuth; flattened to 35% vertical run.
      var shVec = {
        x: sun.shadowX * sun.shadowLength * 0.9,
        y: sun.shadowLength * 0.35,
      };
      var shStrength = 0.40 * Math.min(1, 0.35 + (1 - sunH) * 0.9);
      glc.drawShadowInstances(_shadowArray, shCount, w, h, shVec, shStrength);
    }
```

(Shadows draw before sprites → every sprite renders on top of every shadow; within F2's size class that's the correct read.)

- [ ] **Step 4: Stretch the player's 2D blob shadow (canvas-renderer.js `drawPlayerAt`, lines 546-558)**

The player shadow must respond to the sun too. `drawPlayerAt` has no `sun` — store it: in `draw()` after `const sun = lighting.sun();` add `this._sun = sun;`. Then replace the ellipse block:

```js
    const sun2 = this._sun;
    const lowSun = sun2 ? Math.pow(1 - Math.max(0, sun2.sunHeight), 1.6) : 0;
    const stretch = 1 + (sun2 ? sun2.shadowLength : 0) * 0.9;
    const skewX = sun2 ? sun2.shadowX * 6 * zoom * stretch * 0.4 : 0;
    ctx.fillStyle = `rgba(20,24,38,${player?.z > 0 ? 0.12 : 0.20 + lowSun * 0.10})`;
    ctx.beginPath();
    ctx.ellipse(px + skewX, sy + 8 * zoom, (8 * zoom + (player?.z ?? 0) * zoom) * stretch, 3 * zoom, 0, 0, Math.PI * 2);
    ctx.fill();
```

- [ ] **Step 5: Visual verification (Playwright, incognito)**

Steppe (-1248,-992): set `time = 0.50` screenshot A, `time = 0.65` screenshot B. In B, flora must show elongated dark silhouettes trailing west-ish; pixel-diff A vs B must show the shadow regions. Also `time = 0.05`: NO silhouettes (sunH gate). Console clean.

- [ ] **Step 6: Commit**

```bash
git add src/render/gl-compositor.js src/render/field2-animator.js src/render/canvas-renderer.js
git commit -m "feat: instanced silhouette shadows skewed by sun, per-biome strength"
```

---

### Task 7: Water specular glints

**Files:**
- Modify: `src/render/gl-compositor.js` (wave block in PRESENT_FRAG_SRC)

- [ ] **Step 1: Add glints inside the existing wave block**

In `PRESENT_FRAG_SRC`, inside `if (uWaveOn > 0.5) { ... }` after `c = mix(c, b, 0.85);` (line 159):

```glsl
    // Sun glints: wave crests catch the sun's color. Strongest at low sun
    // (golden path of sparkle), aligned to the sun's side of the screen.
    if (uAtmoOn > 0.5 && uSunHeight > 0.02) {
      float crest = smoothstep(0.62, 0.85, s);
      float lowSun2 = 1.0 - smoothstep(0.10, 0.60, uSunHeight);
      float sunSide = 1.0 - abs(vTL.x - (0.5 + cos(uSunAzim) * 0.45));
      float glint = crest * (0.10 + lowSun2 * 0.55) * clamp(sunSide, 0.2, 1.0);
      c += uPhaseTint * glint;
    }
```

(Legal because the atmo uniforms are declared above `main` — `uWaveOn` block runs before the atmo block, so glints get graded/darkened like everything else.)

- [ ] **Step 2: Verify**

Shallow_water (-992,1056), `time = 0.65`: screenshot must show warm sparkle highlights on water; two screenshots 600ms apart must differ on water (shimmer still animating). `time = 0.45`: glints much fainter. Console clean.

- [ ] **Step 3: Commit**

```bash
git add src/render/gl-compositor.js
git commit -m "feat: sun-colored specular glints on water crests"
```

---

### Task 8: Phase-tinted precipitation

**Files:**
- Modify: `src/render/canvas-renderer.js` (`drawPrecipitation`)

- [ ] **Step 1: Use the `tint` parameter added in Task 4**

At the top of `drawPrecipitation` (after the early return):

```js
  var tr = tint ? tint.r : 1, tg = tint ? tint.g : 1, tb = tint ? tint.b : 1;
  function tc(r, g, b, a) {
    return 'rgba(' + Math.round(Math.min(255, r * tr)) + ',' + Math.round(Math.min(255, g * tg)) + ',' + Math.round(Math.min(255, b * tb)) + ',' + a + ')';
  }
```

Then replace every color literal in the function with `tc`, keeping the alpha expressions identical. Examples (apply the same mechanical transform to all ~10 occurrences across rain/snow/sandstorm/sleet):

- `'rgba(160,185,210,' + (0.08 + precip.intensity * 0.10) + ')'` → `tc(160, 185, 210, 0.08 + precip.intensity * 0.10)`
- `'rgba(200,220,240,' + (0.25 + precip.intensity * 0.20) + ')'` → `tc(200, 220, 240, 0.25 + precip.intensity * 0.20)`
- `'rgba(240,245,255,' + alpha + ')'` → `tc(240, 245, 255, alpha)`
- `'rgba(194,170,120,' + alpha + ')'` → `tc(194, 170, 120, alpha)`

- [ ] **Step 2: Verify**

Spawn anywhere, `page.keyboard.press('p')` until title says `Weather: rain`, set `time = 0.65`: rain streaks must read amber-grey (sample a few bright streak pixels: R > B). At `time = 0.45` they stay cool (B ≥ R).

- [ ] **Step 3: Commit**

```bash
git add src/render/canvas-renderer.js
git commit -m "feat: precipitation particles tinted by time-of-day"
```

---

### Task 9: Chunk streaming — budgeted adoption + live distance priority

**Files:**
- Modify: `src/world/chunk-provider.js`
- Modify: `src/world/chunk.js` (streamAround feeds player position)

- [ ] **Step 1: Time-budgeted adoption + distance re-sort in chunk-provider.js**

(a) In the constructor, replace `this.maxAdoptPerFrame = 1;` (line 21) with:

```js
    this.adoptBudgetMs = 3.0;       // frame-time budget for adopting compiled chunks
    this.adoptBudgetMovingMs = 1.5; // tighter while the player is moving
    this._playerChunk = null;
    this._playerMoving = false;
```

(b) Add a method (after `initPreload`):

```js
  // Called by ChunkStore.streamAround every frame: lets the queue re-sort by
  // CURRENT distance (priorities assigned at request time go stale as the
  // player walks) and tightens the adoption budget while moving.
  setPlayerFocus(cx, cy, moving) {
    this._playerChunk = { cx, cy };
    this._playerMoving = !!moving;
  }
```

(c) Replace the adoption loop at the top of `pumpQueue()` (lines 163-168) with:

```js
    var budget = this._playerMoving ? this.adoptBudgetMovingMs : this.adoptBudgetMs;
    var t0 = performance.now();
    var adopted = 0;
    while (this.completed.length > 0 && (adopted === 0 || performance.now() - t0 < budget)) {
      const { key, chunk } = this.completed.shift();
      this.ready.set(key, chunk);
      adopted++;
    }
```

(`adopted === 0` guarantees forward progress even on a slow frame.)

(d) Replace the job sort (line 173) with live distance:

```js
        const pc = this._playerChunk;
        const jobs = [...this.queued.values()].sort((a, b) => {
          const da = pc ? Math.abs(a.cx - pc.cx) + Math.abs(a.cy - pc.cy) : a.priority;
          const db = pc ? Math.abs(b.cx - pc.cx) + Math.abs(b.cy - pc.cy) : b.priority;
          return da - db || a.requestedAt - b.requestedAt;
        });
```

- [ ] **Step 2: Feed player focus from `chunk.js` streamAround**

In `streamAround` (chunk.js:56), after computing `pcx/pcy` (line 58):

```js
    const moved = this._lastStreamPos && (Math.abs(wx - this._lastStreamPos.x) > 0.01 || Math.abs(wy - this._lastStreamPos.y) > 0.01);
    this._lastStreamPos = { x: wx, y: wy };
    this.provider.setPlayerFocus(pcx, pcy, moved);
```

- [ ] **Step 3: Verify — frame-time probe while walking**

Playwright: spawn at steppe, wait bitmaps≥9, then hold `d` (walk east) for 12 seconds while collecting `requestAnimationFrame` deltas via an injected probe:

```js
await page.evaluate(() => {
  window._frameDeltas = [];
  let last = performance.now();
  const probe = (t) => { window._frameDeltas.push(t - last); last = t; requestAnimationFrame(probe); };
  requestAnimationFrame(probe);
});
await page.keyboard.down('d');
await new Promise(r => setTimeout(r, 12000));
await page.keyboard.up('d');
const deltas = await page.evaluate(() => window._frameDeltas);
const long = deltas.filter(d => d > 50).length;
console.log('frames:', deltas.length, 'long(>50ms):', long);
```

Record the same numbers from a pre-change run (stash or `git stash` toggle). Expected: long-frame count not worse than baseline, ideally lower. (Swiftshader is slow in absolute terms — compare relatively, same machine, same run length.)

Also verify viewport-first loading: cold load (fresh incognito) at mystic (-8672,6688), log time from `goto` until `bitmaps` count ≥ 9 — must not regress vs a pre-change cold load.

- [ ] **Step 4: Commit**

```bash
git add src/world/chunk-provider.js src/world/chunk.js
git commit -m "perf: time-budgeted chunk adoption + live distance-priority compile queue"
```

---

### Task 10: Full verification sweep + docs

**Files:**
- Create: `C:\Users\daves\AppData\Local\Temp\pwtest\atmo-verify.js` (throwaway harness)
- Modify: memory `project_session_handoff.md` (close the "weak atmosphere" + "chunk stutter" items)

- [ ] **Step 1: Run the combined verification script**

One Playwright run covering, per the spec's testing section:
1. Per-biome grading differs: screenshot desert, swamp, arctic, tundra at `time = 0.45`; pairwise pixel-diff > 8% each.
2. Long shadows: steppe at 0.50 vs 0.65 — diff in lower-screen flora regions.
3. No seam: border strip screenshot — no hard vertical grading line (eyeball + row-scan).
4. Night floor: deep_ocean night luminance ≥ 2× desert night luminance.
5. Frame-time probe while walking (Task 9 step 3 numbers, recorded in commit message).
6. Console: zero shader errors, zero uncaught exceptions across all runs.

- [ ] **Step 2: Capture fresh per-biome screenshots for the user**

Re-run the existing `biomes.js` capture (same 21 coords) into `screenshots/_atmo2_<biome>.png` at `time = 0.65` so the user can compare tuner intent vs in-game result and fine-tune via `window.atmo.set(...)`.

- [ ] **Step 3: Update memory + commit**

Update `project_session_handoff.md`: atmosphere + stutter items implemented (note remaining: user fine-tune pass, 2D fallback stays simplified). Final commit:

```bash
git add -A docs/ && git commit -m "docs: atmosphere implementation verification notes"
```

---

## Self-review notes

- **Spec coverage:** grading/moods/night floor/fog/clouds/rays (Task 4), transitions (Task 4 blur + LINEAR), shadows steep sun (Tasks 5-6), water reflections (Task 7), precipitation tint (Task 8), stutter + load priority (Task 9), testing (Task 10). 2D fallback: covered by `if (!glMode)` guards in Task 4 — the existing 2D lighting path remains intact when GL is off. "Ready gate = viewport + 1 ring": there is NO loading screen in this app today (main.js starts the loop immediately); the gate is therefore realized as *ordering* — Task 9's live distance priority makes viewport chunks always compile/paint first, which is what "feels fully loaded" requires. No new gate UI (YAGNI).
- **Type consistency:** instance layout SPRITE_FLOATS=9 shared by sprites and shadows; `setAtmoField(field, tilesW, tilesH, orgX, orgY)` matches `buildAtmoField` return `{a,b,c}`; `setAtmoEnv` keys match `presentScene` reads; `drawPrecipitation(..., tint)` signature added in Task 4, used in Task 8.
- **Known risk:** mood overlay constants (Task 4 step 2) are CSS→GLSL translations — expect one fine-tuning pass with the user via `window.atmo.set` and direct constant nudges; that's by design (live-tunable uniforms).

