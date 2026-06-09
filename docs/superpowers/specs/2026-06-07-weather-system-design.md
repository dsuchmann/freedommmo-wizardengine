# Weather System Design

**Date:** 2026-06-07
**Status:** Spec ready for implementation
**Scope:** Global weather state that drives wind, precipitation, cloud cover, season, and atmosphere. Consumed by the rendering pipeline for grass sway, water waves, lighting, and eventually all 4 animation categories.

## Overview

The weather system produces a global state object updated once per frame. All rendering systems read from it — they never compute their own weather. This is the single source of truth for environmental conditions.

```js
// WeatherSystem.state — read by all renderers
{
  wind: { direction, intensity, gustPhase, gustIntensity },
  precipitation: { type, intensity, angle },
  clouds: { cover, speed, direction },
  season: { current, progress, dayOfYear },
  atmosphere: { fog, humidity, temperature },
  time: performance.now() / 1000
}
```

## Architecture

### File: `src/world/weather.js` (NEW)

```js
export class WeatherSystem {
  constructor(lighting) {
    this.lighting = lighting;  // reference to DayNightCycle
    this.state = { wind: {}, precipitation: {}, clouds: {}, season: {}, atmosphere: {} };
    this._windAngle = 0;
    this._windTarget = 0;
    this._precipTimer = 0;
  }

  update(dt, playerTile) { ... }  // called once per frame from main.js
  wind() { return this.state.wind; }
  season() { return this.state.season; }
}
```

### Integration into main.js

```js
import { WeatherSystem } from './world/weather.js';

const weather = new WeatherSystem(lighting);

function update(dt) {
  lighting.update(dt);
  weather.update(dt, chunks.tileAt(player.x, player.y));
  // ...
}

function loop(now) {
  // Pass weather to renderer
  renderer.draw(chunks, player, lighting, camera, provider, weather);
}
```

### Integration into canvas-renderer.js

```js
draw(chunkStore, player, lighting, camera, provider, weather) {
  // ... existing chunk drawing ...
  
  // Water wave overlay reads wind
  drawWaterWaveOverlay(ctx, visibleChunks, chunkStore, tilePx, w, h, 
    performance.now() / 1000, weather.wind());
  
  // Field 2+ animated objects read wind for sway
  // Precipitation overlay draws rain/snow particles
  // Atmosphere overlay applies fog
}
```

---

## System 1: Wind

### State
```js
wind: {
  direction: 0.3,        // radians, 0 = east, increases counterclockwise
  intensity: 0.6,        // 0.0 (calm) to 1.0 (storm)
  gustPhase: 0.0,        // 0-1 oscillating, drives gust pulses
  gustIntensity: 0.0,    // 0-1, current gust strength (spikes then fades)
}
```

### Behavior
- **Direction** drifts slowly (0.005-0.02 rad/s), occasional larger shifts
- **Intensity** follows Perlin-like noise over ~60s cycles. Calm periods (0.1-0.3), breezy (0.4-0.6), windy (0.7-0.9), storm (0.9-1.0)
- **Gusts** are rhythmic pulses: `gustPhase = sin(time * gustFreq)`. When gustPhase > 0.7, `gustIntensity` spikes. Frequency varies (1-3 Hz in storms, 0.3-0.5 Hz in calm)
- Near coastline (tile.climate.elevation < 0.45), wind aligns more toward shore
- In dense_forest, wind.intensity is damped by 0.25-0.50

### Per-biome wind damping
```js
const WIND_DAMPING = {
  dense_forest: 0.25, forest: 0.50, tropical_forest: 0.35,
  swamp: 0.40, grassland: 1.0, steppe: 1.1, desert: 0.9,
  beach: 1.0, hills: 1.1, mountains: 1.3, arctic: 1.2,
  tundra: 1.1, volcanic: 0.8, mystic: 0.6, taiga: 0.45,
  savanna: 1.0, ocean: 1.2, deep_ocean: 1.3,
  shallow_water: 1.0, river: 0.8, lake: 0.7,
};
```

### Update logic
```js
update(dt) {
  // Slow direction drift
  this._windAngle += (noise(time * 0.01) - 0.5) * 0.02 * dt;
  
  // Periodically pick new target direction (every ~30-90s)
  if (random() < dt * 0.02) {
    this._windTarget = this._windAngle + (random() - 0.5) * 1.5;
  }
  this._windAngle += (this._windTarget - this._windAngle) * dt * 0.3;
  
  // Intensity from low-frequency noise
  const baseIntensity = noise(time * 0.015) * 0.5 + 0.35;
  
  // Gust pulses
  const gustFreq = 0.5 + baseIntensity * 2.0;
  const gustPhase = (Math.sin(time * gustFreq) + 1) * 0.5;
  const gustIntensity = gustPhase > 0.7 ? (gustPhase - 0.7) / 0.3 * 0.4 : 0;
  
  // Apply biome damping
  const damping = WIND_DAMPING[playerTile?.biome] ?? 1.0;
  
  this.state.wind = {
    direction: this._windAngle,
    intensity: clamp(baseIntensity * damping, 0, 1),
    gustPhase: gustPhase,
    gustIntensity: gustIntensity * damping,
  };
}
```

### How renderers consume wind
```js
// Water wave overlay (already exists, currently uses hardcoded CURRENT_ANGLE)
// Replace: const CURRENT_ANGLE = 0.4;
// With:    const CURRENT_ANGLE = weather.wind().direction;

// Field 2 grass sway (main thread animated tiles near player)
const sway = Math.sin(time * 1.5 + tileHash) * wind.intensity * 0.15;
// Apply as rotation or x-offset to grass sprite

// Field 6 tree sway (when re-enabled)
const treeSway = Math.sin(time * 0.8 + tileHash) * wind.intensity * 0.05;
```

---

## System 2: Precipitation

### State
```js
precipitation: {
  type: 'none',          // 'none', 'rain', 'snow', 'sleet', 'sandstorm'
  intensity: 0.0,        // 0-1
  angle: 0.3,            // radians, matches wind direction
}
```

### Behavior
- Precipitation type is driven by biome temperature and season
- `rain`: moisture > 0.5, heat > 0.3 (temperate/tropical)
- `snow`: heat < 0.3 OR arctic/tundra/taiga biomes
- `sandstorm`: desert/steppe with wind.intensity > 0.7
- Intensity follows weather cycles: clear (0) → light (0.2-0.4) → moderate (0.5-0.7) → heavy (0.8-1.0) → clearing
- Cycles last 5-15 minutes game time
- Angle tracks wind direction with slight lag

### Rendering
Precipitation is a full-screen particle overlay drawn after all terrain:
- **Rain**: angled streaks, density from intensity, color tinted by lighting
- **Snow**: slow falling dots with slight horizontal drift from wind
- **Sandstorm**: horizontal amber particles, reduces visibility (fog increases)

```js
// In canvas-renderer.js, after drawAtmosphere:
if (weather.precipitation().type !== 'none') {
  drawPrecipitation(ctx, w, h, weather.precipitation(), weather.wind(), performance.now());
}
```

---

## System 3: Cloud Cover

### State
```js
clouds: {
  cover: 0.3,           // 0 (clear sky) to 1 (overcast)
  speed: 0.5,           // cloud movement speed
  direction: 0.3,       // follows wind direction
}
```

### Behavior
- Cloud cover correlates with precipitation (heavy rain = high cover)
- Affects ambient light: `effectiveAmbient = sun.ambient * (1 - cover * 0.35)`
- Creates dappled shadow patterns when cover is 0.3-0.6 (partly cloudy)
- Overcast (> 0.8) flattens lighting uniformly

### Rendering
```js
// Modify sun.ambient based on cloud cover
const cloudedAmbient = sun.ambient * (1 - weather.clouds().cover * 0.35);

// Optional: dappled shadow overlay using noise
if (cover > 0.2 && cover < 0.7) {
  // Draw moving shadow patches using cloud direction/speed
}
```

---

## System 4: Seasons

### State
```js
season: {
  current: 'summer',    // 'spring', 'summer', 'autumn', 'winter'
  progress: 0.65,       // 0-1 within current season
  dayOfYear: 180,       // 0-365
  yearProgress: 0.49,   // 0-1 across full year
}
```

### Behavior
- Full year cycle = ~30 minutes real time (configurable)
- Seasons affect:
  - **Vegetation color** (autumn = orange/red tint, winter = desaturated)
  - **Life cycle stages** (spring = seedling/sprout, summer = mature, autumn = withering, winter = dead)
  - **Precipitation type** (rain in summer → snow in winter for temperate biomes)
  - **Wind patterns** (stronger in autumn/winter)
  - **Day length** (shorter days in winter, longer in summer)

### Season transitions
```js
const SEASON_THRESHOLDS = [
  { name: 'spring', start: 0.00, peak: 0.125 },
  { name: 'summer', start: 0.25, peak: 0.375 },
  { name: 'autumn', start: 0.50, peak: 0.625 },
  { name: 'winter', start: 0.75, peak: 0.875 },
];

// Smooth transitions: between seasons, blend properties
// e.g., late autumn gradually increases chance of snow vs rain
```

### Integration with DayNightCycle
```js
// Seasons modify day length
const dayLengthMultiplier = {
  spring: 1.0, summer: 1.3, autumn: 1.0, winter: 0.7
};
// In DayNightCycle, adjust speed based on season
this.speed = baseSpeed * (isDay ? 1/mult : mult);
```

---

## System 5: Atmosphere

### State
```js
atmosphere: {
  fog: 0.0,             // 0 (clear) to 1 (dense fog)
  humidity: 0.5,         // from biome moisture
  temperature: 0.5,      // from biome heat + season
}
```

### Behavior
- **Fog**: increases near water, in swamps, during dawn/dusk, in winter
  - `fog = baseFog + dawnBonus + moistureBonus + winterBonus`
  - Rendered as semi-transparent overlay with distance falloff
- **Humidity**: directly from tile.climate.moisture, affects color saturation
- **Temperature**: tile.climate.heat modified by season and time of day

### Fog rendering
```js
// Distance-based fog: tiles further from player get more fog
// Rendered as a radial gradient overlay
if (weather.atmosphere().fog > 0.05) {
  const gradient = ctx.createRadialGradient(
    w/2, h/2, tilePx * 8,  // clear zone around player
    w/2, h/2, Math.max(w, h) * 0.6  // fog edge
  );
  gradient.addColorStop(0, 'rgba(180,195,210,0)');
  gradient.addColorStop(1, `rgba(180,195,210,${fog * 0.6})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}
```

---

## Implementation Notes

### Files to create
- `src/world/weather.js` — WeatherSystem class (NEW)

### Files to modify
- `src/main.js` — instantiate WeatherSystem, pass to renderer
- `src/render/canvas-renderer.js` — accept weather param, pass to overlays
- `src/render/water-wave-overlay.js` — replace hardcoded CURRENT_ANGLE with wind.direction
- `src/world/lighting.js` — accept season for day length modulation

### Files NOT to touch
- `src/render/worker-chunk-renderer.js` — workers don't need weather (static bitmaps)
- `src/render/wang-image-list.js` — asset URLs unchanged
- `src/world/chunk-worker.js` — chunk compilation unchanged

### Performance budget
- WeatherSystem.update: < 0.1ms (just math, no rendering)
- Precipitation overlay: ~0.5ms (particle drawing)
- Fog overlay: ~0.2ms (gradient fill)
- Cloud shadows: ~0.3ms (noise-based overlay)
- **Total: ~1.1ms** — well within 16ms frame budget

### Noise function
The weather system needs a smooth noise function for natural-feeling cycles. Use the existing `smoothNoise` from `src/core/random.js` with time as an input coordinate:
```js
import { smoothNoise } from '../core/random.js';
const windNoise = smoothNoise(time * 10, 0, 50, 9000);
```

### Key design constraint
**Weather is global, not per-tile.** One wind direction, one precipitation type, one cloud cover value. Per-tile variation comes from biome damping (wind is weaker in forest) and biome-specific precipitation type (rain vs snow), but the base weather state is shared across the entire visible area. This keeps it simple and cheap.

### Keybindings
- `W` key: cycle weather presets (clear → cloudy → rain → storm → snow → clear)
- This is for development/debugging only

---

## Consumer Interface Summary

Any renderer that needs weather data calls these methods:

```js
weather.wind()          // { direction, intensity, gustPhase, gustIntensity }
weather.precipitation() // { type, intensity, angle }
weather.clouds()        // { cover, speed, direction }
weather.season()        // { current, progress, dayOfYear, yearProgress }
weather.atmosphere()    // { fog, humidity, temperature }
```

These return plain objects with no methods — safe to destructure, cache per-frame, or pass to workers if needed later.
