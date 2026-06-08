# Weather Enhancement Design

**Date:** 2026-06-07
**Status:** Spec ready for implementation
**Scope:** Expand the existing WeatherSystem with severity levels, richer visual effects, and dramatic weather events.

## Overview

The base WeatherSystem (wind, precipitation, clouds, seasons, atmosphere) is functional but basic. This spec adds severity scaling, visual richness (wind-blown particles, accumulation, lightning), and dramatic weather events (blizzards, thunderstorms, dust devils).

## Current State

`src/world/weather.js` has:
- Wind: direction, intensity (0-1), gust pulses
- Precipitation: type (none/rain/snow/sleet/sandstorm), intensity (0-1)
- Clouds: cover (0-1), speed, direction
- Seasons: 30-min year cycle
- Atmosphere: fog, humidity, temperature
- Preset cycling via P key

`src/render/canvas-renderer.js` has:
- `drawPrecipitation()`: basic rain streaks, snow dots, sandstorm rectangles
- `drawFog()`: radial gradient

## Design

### Severity Levels

Each weather condition has 5 severity levels that affect particle count, size, opacity, and sound:

```js
var SEVERITY = {
  clear:       { particles: 0, windEffect: 0, visibility: 1.0 },
  light:       { particles: 40, windEffect: 0.2, visibility: 0.95 },
  moderate:    { particles: 120, windEffect: 0.5, visibility: 0.85 },
  heavy:       { particles: 250, windEffect: 0.8, visibility: 0.65 },
  extreme:     { particles: 400, windEffect: 1.0, visibility: 0.35 },
};
```

Severity is derived from `precipitation.intensity`:
- 0.00-0.05 → clear
- 0.05-0.25 → light
- 0.25-0.55 → moderate
- 0.55-0.80 → heavy
- 0.80-1.00 → extreme

### Enhanced Rain

```js
function drawRain(ctx, w, h, intensity, wind, time, severity) {
  // Layer 1: Background drizzle (small, fast, transparent)
  var bgCount = severity.particles * 0.3;
  ctx.strokeStyle = `rgba(160,180,200,${0.06 + intensity * 0.08})`;
  ctx.lineWidth = 0.5;
  // ... thin streaks across full screen

  // Layer 2: Main rain (medium, angled by wind)
  var mainCount = severity.particles;
  ctx.strokeStyle = `rgba(180,200,220,${0.12 + intensity * 0.20})`;
  ctx.lineWidth = 1;
  var len = 10 + intensity * 20;
  var windDrift = wind.intensity * 0.6;
  for (var i = 0; i < mainCount; i++) {
    // Deterministic position from seed + time (no Math.random per frame)
    var seed = (i * 7919 + Math.floor(time * 12)) % 10007;
    var rx = ((seed * 3.1 + time * 120 * (1 + windDrift)) % (w + 100)) - 50;
    var ry = ((seed * 7.3 + time * 400) % (h + 60)) - 30;
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx + windDrift * len, ry + len);
    ctx.stroke();
  }

  // Layer 3: Heavy foreground drops (large, bright, sparse)
  if (intensity > 0.5) {
    var fgCount = Math.floor((intensity - 0.5) * 40);
    ctx.strokeStyle = `rgba(200,215,235,${0.25 + intensity * 0.15})`;
    ctx.lineWidth = 2;
    var fgLen = 15 + intensity * 15;
    // ... larger drops, slower seed cycling
  }

  // Layer 4: Splash effects on ground (at heavy+)
  if (intensity > 0.6) {
    ctx.fillStyle = `rgba(180,200,220,${0.08})`;
    var splashCount = Math.floor(intensity * 30);
    for (var s = 0; s < splashCount; s++) {
      var seed = (s * 4271 + Math.floor(time * 20)) % 10007;
      var splashX = (seed * 5.3) % w;
      var splashY = (seed * 2.7) % h;
      var radius = 1 + (seed % 3);
      ctx.beginPath();
      ctx.arc(splashX, splashY, radius, 0, 6.28);
      ctx.fill();
    }
  }
}
```

### Enhanced Snow

```js
function drawSnow(ctx, w, h, intensity, wind, time, severity) {
  var windX = Math.cos(wind.direction) * wind.intensity;

  // Layer 1: Distant snow (tiny, slow, many)
  ctx.fillStyle = `rgba(230,235,245,${0.15 + intensity * 0.15})`;
  var distCount = severity.particles * 0.5;
  for (var i = 0; i < distCount; i++) {
    var seed = (i * 6271 + Math.floor(time * 1.5)) % 10007;
    var sx = ((seed * 4.7 + time * 8 * (1 + windX * 0.3)) % (w + 40)) - 20;
    var sy = ((seed * 2.3 + time * 20) % (h + 40)) - 20;
    // Sinusoidal drift
    sx += Math.sin(time * 0.8 + i * 0.7) * 6;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }

  // Layer 2: Near snow (larger, floating, fewer)
  ctx.fillStyle = `rgba(245,248,255,${0.3 + intensity * 0.3})`;
  var nearCount = severity.particles * 0.15;
  for (var i = 0; i < nearCount; i++) {
    var seed = (i * 3571 + Math.floor(time * 0.8)) % 10007;
    var sx = ((seed * 3.2 + time * 12 * (1 + windX * 0.5)) % (w + 60)) - 30;
    var sy = ((seed * 5.1 + time * 30) % (h + 60)) - 30;
    sx += Math.sin(time * 0.4 + i * 1.3) * 15; // Bigger drift
    var size = 2 + (seed % 3);
    ctx.beginPath();
    ctx.arc(sx, sy, size, 0, 6.28);
    ctx.fill();
  }

  // Blizzard mode (extreme): horizontal whipping + visibility reduction
  if (intensity > 0.8) {
    // Horizontal streaks
    ctx.strokeStyle = `rgba(220,225,240,${0.15})`;
    ctx.lineWidth = 1;
    var streakCount = Math.floor((intensity - 0.8) * 200);
    for (var i = 0; i < streakCount; i++) {
      var seed = (i * 8923 + Math.floor(time * 15)) % 10007;
      var sx = (seed * 2.1 + time * 400 * windX) % w;
      var sy = (seed * 6.3) % h;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + windX * 40, sy + 2);
      ctx.stroke();
    }
    // White-out overlay
    ctx.fillStyle = `rgba(220,225,240,${(intensity - 0.8) * 0.4})`;
    ctx.fillRect(0, 0, w, h);
  }
}
```

### Enhanced Sandstorm

```js
function drawSandstorm(ctx, w, h, intensity, wind, time) {
  var windX = Math.cos(wind.direction) * wind.intensity;
  
  // Amber particle cloud
  var count = Math.floor(intensity * 300);
  for (var i = 0; i < count; i++) {
    var seed = (i * 5381 + Math.floor(time * 8)) % 10007;
    var sx = ((seed * 3.9 + time * 300 * Math.abs(windX)) % (w + 80)) - 40;
    var sy = ((seed * 8.1 + time * 40 + Math.sin(time * 2 + i) * 20) % (h + 40)) - 20;
    var size = 1 + (seed % 5);
    var alpha = 0.04 + (seed % 10) * 0.01;
    ctx.fillStyle = `rgba(194,170,120,${alpha})`;
    ctx.fillRect(sx, sy, size, 1 + (seed % 2));
  }

  // Visibility reduction (amber fog)
  if (intensity > 0.3) {
    ctx.fillStyle = `rgba(180,155,100,${intensity * 0.25})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Dust devils at extreme intensity
  if (intensity > 0.85) {
    var devilCount = Math.floor((intensity - 0.85) * 8) + 1;
    for (var d = 0; d < devilCount; d++) {
      var dseed = (d * 9973 + Math.floor(time * 0.3)) % 10007;
      var dx = (dseed * 7.7 + time * 30) % w;
      var dy = (dseed * 3.3) % h;
      // Swirling particles
      ctx.fillStyle = 'rgba(170,145,90,0.12)';
      for (var p = 0; p < 20; p++) {
        var angle = time * 3 + p * 0.31;
        var radius = 5 + p * 1.5 + Math.sin(time * 2 + p) * 3;
        var px = dx + Math.cos(angle) * radius;
        var py = dy + Math.sin(angle) * radius * 0.5 - p * 2; // Spiral upward
        ctx.fillRect(px, py, 2, 2);
      }
    }
  }
}
```

### Lightning (Thunderstorm)

During heavy rain (intensity > 0.7), occasional lightning flashes:

```js
// In WeatherSystem._updatePrecipitation:
// Add thunderstorm state
if (this.state.precipitation.type === 'rain' && this.state.precipitation.intensity > 0.7) {
  this._thunderTimer -= dt;
  if (this._thunderTimer <= 0) {
    this.state.precipitation.lightning = true;
    this._lightningDuration = 0.08 + Math.random() * 0.12; // 80-200ms flash
    this._thunderTimer = 3 + Math.random() * 12; // 3-15 seconds between strikes
  }
  if (this._lightningDuration > 0) {
    this._lightningDuration -= dt;
    this.state.precipitation.lightning = this._lightningDuration > 0;
  }
} else {
  this.state.precipitation.lightning = false;
}
```

Rendering:
```js
// In drawPrecipitation, after rain drawing:
if (precip.lightning) {
  // White flash overlay
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(0, 0, w, h);
  // Optional: draw a jagged bolt line
}
```

### Cloud Shadow Overlay

Moving cloud shadows create dappled light on the ground during partly cloudy conditions:

```js
function drawCloudShadows(ctx, w, h, clouds, time) {
  if (clouds.cover < 0.15 || clouds.cover > 0.85) return; // Only partly cloudy
  
  ctx.save();
  ctx.globalAlpha = clouds.cover * 0.15; // Subtle
  ctx.fillStyle = '#1a2030';
  
  // Large, slowly moving shadow patches
  var patchCount = 3 + Math.floor(clouds.cover * 5);
  var moveX = Math.cos(clouds.direction) * clouds.speed * time * 20;
  var moveY = Math.sin(clouds.direction) * clouds.speed * time * 20;
  
  for (var i = 0; i < patchCount; i++) {
    var seed = i * 7331;
    var cx = ((seed * 3.7 + moveX) % (w * 1.5)) - w * 0.25;
    var cy = ((seed * 5.3 + moveY) % (h * 1.5)) - h * 0.25;
    var rx = 80 + (seed % 120);
    var ry = 60 + (seed % 80);
    
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, seed * 0.01, 0, 6.28);
    ctx.fill();
  }
  ctx.restore();
}
```

### Weather Transition System

Weather doesn't snap between states — it transitions smoothly:

```js
// In WeatherSystem, add transition tracking:
this._targetPrecip = { type: 'none', intensity: 0 };
this._currentPrecip = { type: 'none', intensity: 0 };

// Update: lerp current toward target
_updatePrecipitation(dt) {
  // Compute target (existing logic)
  this._targetPrecip = { type, intensity };
  
  // Smooth transition
  this._currentPrecip.intensity += (this._targetPrecip.intensity - this._currentPrecip.intensity) * dt * 0.5;
  
  // Type changes only when intensity crosses threshold
  if (this._currentPrecip.intensity < 0.02) {
    this._currentPrecip.type = this._targetPrecip.type; // Switch during lull
  }
}
```

### Expanded Preset Cycling

Update `cyclePreset()` with more states:

```js
var presets = [
  'clear',           // Sunny, no clouds
  'partly_cloudy',   // 40% cover, dappled shadows
  'overcast',        // 80% cover, flat light
  'light_rain',      // Gentle drizzle
  'heavy_rain',      // Downpour
  'thunderstorm',    // Heavy rain + lightning + wind
  'snow',            // Gentle snowfall
  'blizzard',        // Heavy snow + wind + whiteout
  'sandstorm',       // Amber particles + dust devils
  'fog',             // Dense fog
];
```

### Wind Effects on Objects

The weather system exposes wind data that object renderers can use for sway:

```js
// For grass/shrub objects in the main thread renderer:
var windSway = Math.sin(time * 1.5 + objectHash) * wind.intensity * 0.15;
// Apply as slight X offset or rotation to sprite

// For trees:
var treeSway = Math.sin(time * 0.8 + objectHash) * wind.intensity * 0.05;
// Apply as slight lean to tree sprite
```

This isn't implemented in this spec — it's a note for the object animation system. The weather system just provides the data.

## Updated WeatherSystem State

```js
precipitation: {
  type: 'none' | 'rain' | 'snow' | 'sleet' | 'sandstorm',
  intensity: [0..1],
  angle: radians,
  severity: 'clear' | 'light' | 'moderate' | 'heavy' | 'extreme',
  lightning: boolean,        // NEW
}
```

## Files to Modify

- `src/world/weather.js` — Add severity, lightning, smooth transitions, expanded presets
- `src/render/canvas-renderer.js` — Replace `drawPrecipitation` with enhanced version, add cloud shadows, lightning flash

## Files NOT to Touch

- Worker code, chunk compilation, asset files
- `src/world/lighting.js` — Handled by the lighting spec

## Performance Budget

- Enhanced rain (heavy): ~0.8ms (250 particles, 3 layers)
- Enhanced snow (blizzard): ~0.6ms (200 particles + streaks)
- Sandstorm with dust devils: ~0.5ms
- Cloud shadows: ~0.2ms (few ellipses)
- Lightning flash: ~0.05ms (single fillRect)
- **Total worst case: ~2.1ms** (thunderstorm with all effects) — acceptable within 16ms budget
