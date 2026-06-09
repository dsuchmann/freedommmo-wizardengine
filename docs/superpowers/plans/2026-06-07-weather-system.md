# Weather System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global weather system that drives wind, precipitation, cloud cover, seasons, and atmosphere — consumed by all rendering systems.

**Architecture:** Single new file `src/world/weather.js` with a `WeatherSystem` class updated once per frame. It reads the existing `DayNightCycle` for time-of-day and produces a state object consumed by renderers. Integration is minimal: instantiate in main.js, pass to draw(), wire wind into water-wave-overlay.

**Tech Stack:** Vanilla JS, existing `smoothNoise` from `src/core/random.js`, existing `DayNightCycle` from `src/world/lighting.js`.

---

### Task 1: Create WeatherSystem core with wind

**Files:**
- Create: `src/world/weather.js`

**Context:** The spec defines 5 subsystems. Wind is the most impactful since it immediately drives water waves and grass sway. The `smoothNoise` function at `src/core/random.js:20` takes `(x, y, scale, salt, seed)` — we'll use time as the x coordinate with y=0 for 1D noise.

- [ ] **Step 1: Create `src/world/weather.js` with WeatherSystem class**

```js
import { smoothNoise } from '../core/random.js';

var WIND_DAMPING = {
  dense_forest: 0.25, forest: 0.50, tropical_forest: 0.35,
  swamp: 0.40, grassland: 1.0, steppe: 1.1, desert: 0.9,
  beach: 1.0, hills: 1.1, mountains: 1.3, arctic: 1.2,
  tundra: 1.1, volcanic: 0.8, mystic: 0.6, taiga: 0.45,
  savanna: 1.0, ocean: 1.2, deep_ocean: 1.3,
  shallow_water: 1.0, river: 0.8, lake: 0.7,
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export class WeatherSystem {
  constructor(lighting) {
    this.lighting = lighting;
    this._windAngle = 0.3;
    this._windTarget = 0.3;
    this._time = 0;
    this._precipTimer = 0;
    this._precipCycle = 0;
    this._yearTime = 0;
    this.state = {
      wind: { direction: 0.3, intensity: 0.4, gustPhase: 0, gustIntensity: 0 },
      precipitation: { type: 'none', intensity: 0, angle: 0.3 },
      clouds: { cover: 0.3, speed: 0.5, direction: 0.3 },
      season: { current: 'summer', progress: 0, dayOfYear: 180, yearProgress: 0.49 },
      atmosphere: { fog: 0, humidity: 0.5, temperature: 0.5 },
    };
  }

  update(dt, playerTile) {
    this._time += dt;
    this._updateWind(dt, playerTile);
    this._updatePrecipitation(dt, playerTile);
    this._updateClouds(dt);
    this._updateSeason(dt);
    this._updateAtmosphere(dt, playerTile);
  }

  _updateWind(dt, playerTile) {
    // Slow direction drift
    var drift = smoothNoise(this._time * 10, 0, 50, 9000) - 0.5;
    this._windAngle += drift * 0.02 * dt;

    // Periodically pick new target direction
    if (Math.random() < dt * 0.02) {
      this._windTarget = this._windAngle + (Math.random() - 0.5) * 1.5;
    }
    this._windAngle += (this._windTarget - this._windAngle) * dt * 0.3;

    // Intensity from low-frequency noise
    var baseIntensity = smoothNoise(this._time * 10, 0, 70, 9100) * 0.5 + 0.35;

    // Gust pulses
    var gustFreq = 0.5 + baseIntensity * 2.0;
    var gustPhase = (Math.sin(this._time * gustFreq) + 1) * 0.5;
    var gustIntensity = gustPhase > 0.7 ? (gustPhase - 0.7) / 0.3 * 0.4 : 0;

    // Apply biome damping
    var damping = WIND_DAMPING[playerTile ? playerTile.biome : 'grassland'] || 1.0;

    this.state.wind = {
      direction: this._windAngle,
      intensity: clamp(baseIntensity * damping, 0, 1),
      gustPhase: gustPhase,
      gustIntensity: gustIntensity * damping,
    };
  }

  _updatePrecipitation(dt, playerTile) {
    // Precipitation follows slow cycles (5-15 min)
    this._precipTimer += dt;
    var cycleLen = 420; // ~7 min per cycle
    var cyclePhase = (this._precipTimer % cycleLen) / cycleLen;

    // Bell curve: peaks at 0.5, zero at 0 and 1
    var rawIntensity = Math.max(0, Math.sin(cyclePhase * Math.PI) * 1.2 - 0.2);

    // Determine type from biome
    var type = 'none';
    if (rawIntensity > 0.05 && playerTile) {
      var heat = playerTile.climate ? playerTile.climate.heat : 0.5;
      var moisture = playerTile.climate ? playerTile.climate.moisture : 0.5;
      var biome = playerTile.biome;
      var season = this.state.season.current;

      if ((biome === 'desert' || biome === 'steppe') && this.state.wind.intensity > 0.7) {
        type = 'sandstorm';
      } else if (heat < 0.2 || biome === 'arctic' || biome === 'tundra' || 
                 (season === 'winter' && heat < 0.4)) {
        type = 'snow';
      } else if (moisture > 0.4 && heat > 0.15) {
        type = 'rain';
      } else if (heat < 0.3 && moisture > 0.3) {
        type = 'sleet';
      }
    }

    this.state.precipitation = {
      type: type,
      intensity: type === 'none' ? 0 : clamp(rawIntensity, 0, 1),
      angle: this._windAngle + (Math.random() - 0.5) * 0.05,
    };
  }

  _updateClouds(dt) {
    // Cloud cover correlates with precipitation
    var targetCover = this.state.precipitation.intensity * 0.6 + 0.15;
    var cover = this.state.clouds.cover;
    cover += (targetCover - cover) * dt * 0.3;

    this.state.clouds = {
      cover: clamp(cover, 0, 1),
      speed: 0.3 + this.state.wind.intensity * 0.7,
      direction: this._windAngle,
    };
  }

  _updateSeason(dt) {
    // 30-minute year cycle
    var YEAR_DURATION = 30 * 60; // seconds
    this._yearTime = (this._yearTime + dt) % YEAR_DURATION;
    var yearProgress = this._yearTime / YEAR_DURATION;
    var dayOfYear = Math.floor(yearProgress * 365);

    var current;
    if (yearProgress < 0.25) current = 'spring';
    else if (yearProgress < 0.50) current = 'summer';
    else if (yearProgress < 0.75) current = 'autumn';
    else current = 'winter';

    var seasonStart = yearProgress < 0.25 ? 0 : yearProgress < 0.5 ? 0.25 : yearProgress < 0.75 ? 0.5 : 0.75;
    var progress = (yearProgress - seasonStart) / 0.25;

    this.state.season = {
      current: current,
      progress: progress,
      dayOfYear: dayOfYear,
      yearProgress: yearProgress,
    };
  }

  _updateAtmosphere(dt, playerTile) {
    var sun = this.lighting.sun();
    var timeLabel = sun.label;
    var moisture = playerTile && playerTile.climate ? playerTile.climate.moisture : 0.5;
    var heat = playerTile && playerTile.climate ? playerTile.climate.heat : 0.5;
    var biome = playerTile ? playerTile.biome : 'grassland';

    // Fog: higher near water, at dawn/dusk, in winter, in swamps
    var baseFog = 0;
    if (biome === 'swamp') baseFog += 0.25;
    if (biome === 'lake' || biome === 'river') baseFog += 0.15;
    var dawnBonus = (timeLabel === 'dawn') ? 0.2 : 0;
    var moistureBonus = Math.max(0, moisture - 0.5) * 0.3;
    var winterBonus = this.state.season.current === 'winter' ? 0.15 : 0;
    var fog = clamp(baseFog + dawnBonus + moistureBonus + winterBonus, 0, 1);

    // Season modifies temperature
    var seasonTempMod = { spring: 0, summer: 0.15, autumn: -0.05, winter: -0.25 };
    var temp = clamp(heat + (seasonTempMod[this.state.season.current] || 0), 0, 1);

    this.state.atmosphere = {
      fog: fog,
      humidity: moisture,
      temperature: temp,
    };
  }

  // Consumer interface
  wind() { return this.state.wind; }
  precipitation() { return this.state.precipitation; }
  clouds() { return this.state.clouds; }
  season() { return this.state.season; }
  atmosphere() { return this.state.atmosphere; }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/world/weather.js
git commit -m "feat: add WeatherSystem with wind, precipitation, clouds, seasons, atmosphere"
```

---

### Task 2: Wire WeatherSystem into main.js

**Files:**
- Modify: `src/main.js`

**Context:** `main.js` currently imports `DayNightCycle` and calls `lighting.update(dt)` in `update()`, then passes `lighting` to `renderer.draw()`. We add `WeatherSystem` alongside it.

- [ ] **Step 1: Add import and instantiation**

Add after line 9 (`import { DayNightCycle } from './world/lighting.js';`):
```js
import { WeatherSystem } from './world/weather.js';
```

Add after line 31 (`const lighting = new DayNightCycle();`):
```js
const weather = new WeatherSystem(lighting);
```

- [ ] **Step 2: Call weather.update in the update function**

In `function update(dt)`, after `lighting.update(dt);` (line 53), add:
```js
weather.update(dt, chunks.tileAt(player.x, player.y));
```

- [ ] **Step 3: Pass weather to renderer.draw**

Change line 71:
```js
renderer.draw(chunks, player, lighting, camera, provider);
```
To:
```js
renderer.draw(chunks, player, lighting, camera, provider, weather);
```

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: instantiate WeatherSystem and pass to renderer"
```

---

### Task 3: Accept weather in canvas-renderer.js and wire to water overlay

**Files:**
- Modify: `src/render/canvas-renderer.js:49,71,104`
- Modify: `src/render/water-wave-overlay.js:91,151,173-174`

**Context:** `canvas-renderer.js` `draw()` method signature is at line 49. The water wave overlay is called at line 104 with `drawWaterWaveOverlay(ctx, visibleChunks, chunkStore, tilePx, w, h, performance.now() / 1000)`. The overlay has a hardcoded `CURRENT_ANGLE = 0.3` at line 151.

- [ ] **Step 1: Update draw() signature in canvas-renderer.js**

Change line 49:
```js
draw(chunkStore, player, lighting, camera, provider) {
```
To:
```js
draw(chunkStore, player, lighting, camera, provider, weather) {
```

- [ ] **Step 2: Pass wind to water wave overlay**

Change line 104:
```js
drawWaterWaveOverlay(ctx, visibleChunks, chunkStore, tilePx, w, h, performance.now() / 1000);
```
To:
```js
drawWaterWaveOverlay(ctx, visibleChunks, chunkStore, tilePx, w, h, performance.now() / 1000, weather ? weather.wind() : null);
```

- [ ] **Step 3: Add cloud cover to ambient light**

After the `draw()` method gets the sun object (find where `sun` or `lighting.sun()` is used for ambient), add cloud cover modulation. Find the line that uses `sun.ambient` and modify it to factor in cloud cover:

After getting the sun object in draw(), before it's used for rendering, add:
```js
var cloudedSun = weather ? Object.assign({}, sun, {
  ambient: sun.ambient * (1 - (weather.clouds().cover * 0.35))
}) : sun;
```

Use `cloudedSun` where `sun` was previously used for ambient/lighting.

- [ ] **Step 4: Update water-wave-overlay.js to accept wind parameter**

Change `drawWaterWaveOverlay` signature at line 91:
```js
export function drawWaterWaveOverlay(ctx, visibleChunks, chunkStore, tilePx, w, h, timeSeconds) {
```
To:
```js
export function drawWaterWaveOverlay(ctx, visibleChunks, chunkStore, tilePx, w, h, timeSeconds, wind) {
```

- [ ] **Step 5: Replace hardcoded CURRENT_ANGLE with wind direction**

Change line 151:
```js
const CURRENT_ANGLE = 0.3; // global ocean current direction (radians)
```
To:
```js
const CURRENT_ANGLE = wind ? wind.direction : 0.3;
```

- [ ] **Step 6: Commit**

```bash
git add src/render/canvas-renderer.js src/render/water-wave-overlay.js
git commit -m "feat: wire weather into renderer — wind drives water waves, clouds dim ambient"
```

---

### Task 4: Add precipitation overlay

**Files:**
- Modify: `src/render/canvas-renderer.js`

**Context:** Precipitation is a full-screen particle overlay drawn after terrain. Rain = angled streaks, snow = slow dots, sandstorm = amber particles. Performance budget: ~0.5ms.

- [ ] **Step 1: Add precipitation drawing function in canvas-renderer.js**

Add before the `draw()` method:
```js
function drawPrecipitation(ctx, w, h, precip, wind, time) {
  if (precip.type === 'none' || precip.intensity < 0.01) return;
  var count = Math.floor(precip.intensity * 200);
  var windX = Math.cos(wind.direction) * wind.intensity;
  var windY = Math.sin(wind.direction) * wind.intensity;

  ctx.save();
  if (precip.type === 'rain') {
    ctx.strokeStyle = 'rgba(180,200,220,' + (0.15 + precip.intensity * 0.25) + ')';
    ctx.lineWidth = 1;
    for (var i = 0; i < count; i++) {
      var seed = (i * 7919 + Math.floor(time * 8)) % 10007;
      var rx = (seed * 3.1 + time * 80 * (1 + windX)) % w;
      var ry = (seed * 7.3 + time * 300) % h;
      var len = 8 + precip.intensity * 12;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + windX * len, ry + len);
      ctx.stroke();
    }
  } else if (precip.type === 'snow') {
    ctx.fillStyle = 'rgba(240,245,255,' + (0.3 + precip.intensity * 0.4) + ')';
    for (var i = 0; i < count * 0.4; i++) {
      var seed = (i * 6271 + Math.floor(time * 2)) % 10007;
      var sx = (seed * 4.7 + time * 15 * (1 + windX * 0.5) + Math.sin(time * 0.5 + i) * 10) % w;
      var sy = (seed * 2.3 + time * 40) % h;
      var size = 1.5 + (seed % 3);
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, 6.28);
      ctx.fill();
    }
  } else if (precip.type === 'sandstorm') {
    ctx.fillStyle = 'rgba(194,170,120,' + (0.08 + precip.intensity * 0.15) + ')';
    for (var i = 0; i < count * 0.6; i++) {
      var seed = (i * 5381 + Math.floor(time * 6)) % 10007;
      var sx = (seed * 3.9 + time * 200 * windX) % w;
      var sy = (seed * 8.1 + time * 30) % h;
      ctx.fillRect(sx, sy, 2 + (seed % 4), 1);
    }
  }
  ctx.restore();
}
```

- [ ] **Step 2: Call precipitation overlay in draw()**

After the water wave overlay call (after line 104), add:
```js
if (weather) {
  drawPrecipitation(ctx, w, h, weather.precipitation(), weather.wind(), performance.now() / 1000);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/render/canvas-renderer.js
git commit -m "feat: precipitation overlay — rain streaks, snow dots, sandstorm particles"
```

---

### Task 5: Add fog overlay

**Files:**
- Modify: `src/render/canvas-renderer.js`

**Context:** Fog is a radial gradient overlay — clear near the player, increasingly opaque at distance. Driven by `weather.atmosphere().fog`. Performance budget: ~0.2ms.

- [ ] **Step 1: Add fog drawing function in canvas-renderer.js**

Add after the precipitation function:
```js
function drawFog(ctx, w, h, fog) {
  if (fog < 0.05) return;
  var cx = w / 2;
  var cy = h / 2;
  var innerRadius = Math.min(w, h) * 0.15;
  var outerRadius = Math.max(w, h) * 0.6;
  var gradient = ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, outerRadius);
  gradient.addColorStop(0, 'rgba(180,195,210,0)');
  gradient.addColorStop(1, 'rgba(180,195,210,' + (fog * 0.55) + ')');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}
```

- [ ] **Step 2: Call fog overlay in draw()**

After the precipitation call, add:
```js
if (weather) {
  drawFog(ctx, w, h, weather.atmosphere().fog);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/render/canvas-renderer.js
git commit -m "feat: fog overlay — radial gradient driven by weather atmosphere"
```

---

### Task 6: Add weather HUD info and W key cycling

**Files:**
- Modify: `src/render/canvas-renderer.js` (HUD section)
- Modify: `src/main.js` (W key handler)
- Modify: `src/world/weather.js` (add cycling method)

- [ ] **Step 1: Add preset cycling to WeatherSystem**

In `src/world/weather.js`, add to the class:
```js
  cyclePreset() {
    var presets = ['clear', 'cloudy', 'rain', 'storm', 'snow'];
    this._preset = ((this._preset || 0) + 1) % presets.length;
    var p = presets[this._preset];
    if (p === 'clear') {
      this._precipTimer = 0; // reset to clear phase
      this.state.clouds.cover = 0.1;
    } else if (p === 'cloudy') {
      this.state.clouds.cover = 0.6;
      this.state.precipitation.type = 'none';
      this.state.precipitation.intensity = 0;
    } else if (p === 'rain') {
      this.state.precipitation.type = 'rain';
      this.state.precipitation.intensity = 0.6;
      this.state.clouds.cover = 0.7;
    } else if (p === 'storm') {
      this.state.precipitation.type = 'rain';
      this.state.precipitation.intensity = 0.95;
      this.state.clouds.cover = 0.95;
      this.state.wind.intensity = 0.9;
    } else if (p === 'snow') {
      this.state.precipitation.type = 'snow';
      this.state.precipitation.intensity = 0.5;
      this.state.clouds.cover = 0.8;
    }
    return p;
  }
```

- [ ] **Step 2: Add W key handler in main.js**

In `function update(dt)`, after the existing key handlers, add:
```js
if (input.wasPressed('w') && !input.isHeld('shift')) {
  // Only cycle weather when not moving (W is also walk forward)
  // Use Shift+W or just let it cycle — actually use 'p' for precipitation
}
```

Actually, `W` is WASD movement. Use `p` key instead:
```js
if (input.wasPressed('p')) {
  var preset = weather.cyclePreset();
  console.log('Weather:', preset);
}
```

- [ ] **Step 3: Add weather info to HUD**

In the HUD section of canvas-renderer.js, add a weather line. In the `hud()` method, after the sun line, add:
```js
const weatherLine = weather ? `<br>weather: wind ${weather.wind().intensity.toFixed(2)} @ ${(weather.wind().direction * 180 / Math.PI).toFixed(0)}° · ${weather.precipitation().type} ${weather.precipitation().intensity.toFixed(2)} · clouds ${weather.clouds().cover.toFixed(2)} · ${weather.season().current} (${(weather.season().yearProgress * 100).toFixed(0)}%) · fog ${weather.atmosphere().fog.toFixed(2)}` : '';
```

Add this variable to the innerHTML template string.

- [ ] **Step 4: Pass weather to hud()**

Change the hud call in main.js:
```js
renderer.hud(chunks, player, lighting, camera, perf);
```
To:
```js
renderer.hud(chunks, player, lighting, camera, perf, weather);
```

Update the hud() method signature in canvas-renderer.js to accept `weather` as the 6th parameter.

- [ ] **Step 5: Commit**

```bash
git add src/world/weather.js src/main.js src/render/canvas-renderer.js
git commit -m "feat: weather HUD display and P key to cycle presets"
```

---

## Self-Review

**Spec coverage:**
1. ✅ Wind — direction drift, intensity cycles, gust pulses, per-biome damping (Task 1)
2. ✅ Precipitation — rain/snow/sandstorm, biome+season driven (Task 1 + 4)
3. ✅ Cloud cover — affects ambient light (Task 3)
4. ✅ Seasons — 30-min year cycle (Task 1)
5. ✅ Atmosphere — fog near water/dawn (Task 1 + 5)
6. ✅ Water wave integration (Task 3)
7. ✅ HUD display (Task 6)
8. ✅ Debug cycling (Task 6)
9. ✅ Performance budget respected — all overlays are simple fills/strokes

**Not covered (by design):**
- Dappled cloud shadows (spec marked optional)
- Season affecting DayNightCycle speed (can add later)
- Season affecting vegetation color (needs vegetation rendering system)

**Type consistency:** All method signatures match between tasks. `weather.wind()`, `weather.precipitation()`, `weather.clouds()`, `weather.season()`, `weather.atmosphere()` used consistently.
