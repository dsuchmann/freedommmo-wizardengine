# Lighting & Color Grading Overhaul

**Date:** 2026-06-07
**Status:** Spec ready for implementation
**Scope:** Overhaul DayNightCycle with opinionated time-of-day color grading, directional sun/moon, and atmospheric tinting.

## Overview

Replace the current simple sine-curve lighting with a richly authored time-of-day system. Each phase of the day has distinct, opinionated color grading. The sun has a clear east-west arc. A moon provides nighttime illumination from west to east.

## Current State

`src/world/lighting.js` has a `DayNightCycle` class with:
- `time` cycling 0-1, speed 0.015 (~67s full cycle)
- `sun()` returns `{ time, label, angle, height, intensity, ambient, tint, shadowX, shadowY }`
- Tint is a simple formula: base + intensity + twilight adjustment
- Shadow direction from `cos(angle)` / `sin(angle)`
- Labels: night [0, 0.20), dawn [0.20, 0.30), day [0.30, 0.68), dusk [0.68, 0.80), night [0.80, 1.0)

## Design

### Time-of-Day Phases

The day cycle is broken into 8 phases with authored color palettes. Transitions between phases are smooth (hermite interpolation).

| Phase | Time Range | Duration | Description |
|-------|-----------|----------|-------------|
| deep_night | 0.00-0.15 | 15% | Dark navy blue, inky. Stars visible. Moon at peak. |
| pre_dawn | 0.15-0.22 | 7% | Faint blue-purple glow on horizon. Moon setting. |
| dawn | 0.22-0.30 | 8% | Crisp light blue → clear yellow. Sun breaking horizon. |
| morning | 0.30-0.42 | 12% | Bright, clean light. Warming up. |
| noon | 0.42-0.58 | 16% | Dramatic white flood. Harsh, bright. Short shadows. |
| golden_hour | 0.58-0.72 | 14% | Deep amber, heavy orange tint, long shadows. Stretched out. |
| dusk | 0.72-0.82 | 10% | Gradual shift from golden to bluish. Sun below horizon. |
| night | 0.82-1.00 | 18% | Dark navy blue blanket. Moon rising. |

### Color Palette Per Phase

Each phase defines: `ambient` (brightness 0-1), `tint` (RGB multiplier), `skyColor` (background fill), `fogTint` (fog color).

```js
var PHASES = [
  { name: 'deep_night', start: 0.00, ambient: 0.12,
    tint: { r: 0.25, g: 0.28, b: 0.55 },
    skyColor: '#0a0e1a', fogTint: { r: 20, g: 25, b: 50 } },
  { name: 'pre_dawn', start: 0.15, ambient: 0.18,
    tint: { r: 0.35, g: 0.32, b: 0.52 },
    skyColor: '#1a1833', fogTint: { r: 40, g: 35, b: 65 } },
  { name: 'dawn', start: 0.22, ambient: 0.55,
    tint: { r: 0.85, g: 0.72, b: 0.55 },
    skyColor: '#7ca8c4', fogTint: { r: 180, g: 200, b: 220 } },
  { name: 'morning', start: 0.30, ambient: 0.82,
    tint: { r: 0.95, g: 0.92, b: 0.85 },
    skyColor: '#a8d4e6', fogTint: { r: 200, g: 215, b: 230 } },
  { name: 'noon', start: 0.42, ambient: 1.0,
    tint: { r: 1.05, g: 1.02, b: 0.98 },
    skyColor: '#d4eaf5', fogTint: { r: 230, g: 240, b: 250 } },
  { name: 'golden_hour', start: 0.58, ambient: 0.72,
    tint: { r: 1.15, g: 0.82, b: 0.45 },
    skyColor: '#c4863a', fogTint: { r: 200, g: 160, b: 100 } },
  { name: 'dusk', start: 0.72, ambient: 0.35,
    tint: { r: 0.55, g: 0.45, b: 0.58 },
    skyColor: '#3a2a4a', fogTint: { r: 80, g: 60, b: 90 } },
  { name: 'night', start: 0.82, ambient: 0.14,
    tint: { r: 0.22, g: 0.25, b: 0.50 },
    skyColor: '#0c1020', fogTint: { r: 18, g: 22, b: 45 } },
];
```

### Sun Direction

The sun rises in the east (right side of screen) and sets in the west (left side).

```js
// Sun arc: east (0) → zenith (π/2) → west (π)
// Mapped to time: dawn (0.22) → noon (0.50) → dusk (0.78)
var sunProgress = clamp((time - 0.22) / 0.56, 0, 1); // 0 at dawn, 1 at dusk
var sunAngle = sunProgress * Math.PI; // 0 = east, π/2 = overhead, π = west
var sunHeight = Math.sin(sunAngle); // 0 at horizon, 1 at zenith
var sunX = Math.cos(sunAngle); // +1 = east, -1 = west
```

Shadow direction: shadows point away from the sun. At dawn (sun east), shadows point west (negative X). At golden hour (sun west), shadows point east (positive X). Shadow length is inversely proportional to sun height.

```js
shadowX: -sunX * (1.5 - sunHeight * 1.2),  // Long at dawn/dusk, short at noon
shadowY: 0.4 + (1 - sunHeight) * 0.8,      // Always slightly south, more at low sun
shadowLength: 0.3 + (1 - sunHeight) * 1.2,  // Scale factor for shadow size
```

### Moon Direction

The moon rises in the west and sets in the east (opposite of sun). Active during night phases.

```js
// Moon arc: west (π) → zenith (π/2) → east (0)
// Mapped to time: dusk (0.80) → midnight (0.00) → dawn (0.20)
var moonTime = time < 0.5 ? time + 1 : time; // Normalize so midnight is center
var moonProgress = clamp((moonTime - 0.80) / 0.40, 0, 1);
var moonAngle = Math.PI - moonProgress * Math.PI; // π → 0
var moonHeight = Math.sin(moonAngle) * 0.6; // Lower arc than sun
```

Moon provides dim, cool illumination. Shadow direction from moon is computed the same way as sun but with much lower intensity (shadows barely visible at night).

### Atmospheric Overlay

A full-screen tint overlay applied after all terrain and object rendering:

```js
// Color grading overlay
var phase = currentPhase(time);
ctx.fillStyle = `rgba(${phase.tint.r * 255}, ${phase.tint.g * 255}, ${phase.tint.b * 255}, 0.15)`;
ctx.globalCompositeOperation = 'multiply';
ctx.fillRect(0, 0, w, h);
ctx.globalCompositeOperation = 'source-over';

// Night darkening (heavier than current)
if (ambient < 0.5) {
  var darkness = (0.5 - ambient) * 1.6;
  ctx.fillStyle = `rgba(8, 12, 28, ${clamp(darkness, 0, 0.7)})`;
  ctx.fillRect(0, 0, w, h);
}
```

### Updated sun() Return Value

```js
sun() {
  return {
    time: this.time,
    label: phase.name,           // 'deep_night', 'dawn', 'golden_hour', etc.
    sunAngle: sunAngle,          // Radians, 0=east, π=west
    sunHeight: sunHeight,        // 0-1, 0 at horizon
    moonAngle: moonAngle,        // Moon's angle
    moonHeight: moonHeight,      // Moon's height (0-0.6)
    ambient: interpolatedAmbient,
    tint: interpolatedTint,
    skyColor: interpolatedSkyColor,
    fogTint: interpolatedFogTint,
    shadowX: shadowX,            // Direction to cast shadows
    shadowY: shadowY,
    shadowLength: shadowLength,  // Scale for shadow size
    isDaytime: sunHeight > 0.05,
  };
}
```

## Files to Modify

- `src/world/lighting.js` — Complete rewrite of sun() with phase system, sun/moon arcs
- `src/render/canvas-renderer.js` — Update atmospheric overlay to use new tint/skyColor data

## Files NOT to Touch

- `src/world/weather.js` — Weather reads lighting, doesn't need changes
- Worker code — Workers use static `sun = { height: 0.5, ambient: 0.85 }` for chunk painting

## Performance

Phase interpolation is just math — < 0.05ms per frame.
