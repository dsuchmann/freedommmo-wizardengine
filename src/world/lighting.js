// 8-phase day/night cycle with authored color grading.
// Sun rises east, sets west. Moon rises west, sets east.

var PHASES = [
  { name: 'deep_night', start: 0.00,
    ambient: 0.10, tint: { r: 0.20, g: 0.22, b: 0.48 },
    sky: [10, 14, 26], fog: [20, 25, 50] },
  { name: 'pre_dawn',  start: 0.15,
    ambient: 0.16, tint: { r: 0.32, g: 0.30, b: 0.48 },
    sky: [26, 24, 51], fog: [40, 35, 65] },
  { name: 'dawn',      start: 0.22,
    ambient: 0.50, tint: { r: 0.88, g: 0.74, b: 0.55 },
    sky: [124, 168, 196], fog: [180, 200, 220] },
  { name: 'morning',   start: 0.30,
    ambient: 0.82, tint: { r: 0.96, g: 0.93, b: 0.87 },
    sky: [168, 212, 230], fog: [200, 215, 230] },
  { name: 'noon',      start: 0.42,
    ambient: 1.00, tint: { r: 1.05, g: 1.02, b: 0.98 },
    sky: [212, 234, 245], fog: [230, 240, 250] },
  { name: 'golden_hour', start: 0.55,
    ambient: 0.62, tint: { r: 1.25, g: 0.78, b: 0.35 },
    sky: [210, 120, 40], fog: [220, 150, 80] },
  { name: 'dusk',      start: 0.74,
    ambient: 0.24, tint: { r: 0.40, g: 0.35, b: 0.58 },
    sky: [40, 30, 65], fog: [60, 45, 80] },
  { name: 'night',     start: 0.82,
    ambient: 0.10, tint: { r: 0.18, g: 0.20, b: 0.45 },
    sky: [8, 12, 28], fog: [14, 18, 38] },
];

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Hermite smoothstep for smooth transitions
function smoothstep(t) { return t * t * (3 - 2 * t); }

function lerpPhase(a, b, t) {
  var s = smoothstep(t);
  return {
    ambient: a.ambient + (b.ambient - a.ambient) * s,
    tint: {
      r: a.tint.r + (b.tint.r - a.tint.r) * s,
      g: a.tint.g + (b.tint.g - a.tint.g) * s,
      b: a.tint.b + (b.tint.b - a.tint.b) * s,
    },
    sky: [
      a.sky[0] + (b.sky[0] - a.sky[0]) * s,
      a.sky[1] + (b.sky[1] - a.sky[1]) * s,
      a.sky[2] + (b.sky[2] - a.sky[2]) * s,
    ],
    fog: [
      a.fog[0] + (b.fog[0] - a.fog[0]) * s,
      a.fog[1] + (b.fog[1] - a.fog[1]) * s,
      a.fog[2] + (b.fog[2] - a.fog[2]) * s,
    ],
    name: t < 0.5 ? a.name : b.name,
  };
}

function getPhase(time) {
  // Find which two phases we're between
  var idx = 0;
  for (var i = PHASES.length - 1; i >= 0; i--) {
    if (time >= PHASES[i].start) { idx = i; break; }
  }
  var next = (idx + 1) % PHASES.length;
  var phaseStart = PHASES[idx].start;
  var phaseEnd = PHASES[next].start;
  if (phaseEnd <= phaseStart) phaseEnd += 1; // Wrap around midnight
  var localTime = time;
  if (localTime < phaseStart) localTime += 1;
  var t = clamp01((localTime - phaseStart) / (phaseEnd - phaseStart));
  return lerpPhase(PHASES[idx], PHASES[next], t);
}

export class DayNightCycle {
  constructor() {
    this.time = 0.28; // Start at dawn
    this.speed = 0.012; // Full cycle ~83 seconds
    this.paused = false;
  }

  update(dt) {
    if (!this.paused) this.time = (this.time + dt * this.speed) % 1;
  }

  togglePause() {
    this.paused = !this.paused;
  }

  sun() {
    var time = this.time;
    var phase = getPhase(time);

    // Sun arc: rises east (right) at dawn=0.22, zenith at noon=0.50, sets west (left) at dusk=0.78
    var sunProgress = clamp01((time - 0.22) / 0.56);
    var sunAngle = sunProgress * Math.PI; // 0 = east, π/2 = overhead, π = west
    var sunHeight = time >= 0.22 && time <= 0.78 ? Math.sin(sunAngle) : 0;

    // Moon arc: rises west at 0.80, zenith at midnight=0.00, sets east at 0.20
    var moonTime = time < 0.5 ? time + 1 : time;
    var moonProgress = clamp01((moonTime - 0.80) / 0.40);
    var moonAngle = Math.PI - moonProgress * Math.PI; // π → 0
    var moonHeight = (time >= 0.80 || time <= 0.20) ? Math.sin(moonProgress * Math.PI) * 0.5 : 0;

    // Shadow direction from sun (daytime) or moon (nighttime)
    var shadowSource = sunHeight > 0.05 ? sunAngle : moonAngle;
    var shadowHeight = sunHeight > 0.05 ? sunHeight : moonHeight;
    // Steep-sun look: shadows stretch hard at dawn/golden/dusk (low sun),
    // stay short and tight at noon. Length in "object heights".
    var lowSun = Math.pow(1 - shadowHeight, 1.6);
    var shadowX = -Math.cos(shadowSource) * (1.0 + lowSun * 1.6);
    var shadowY = 0.30 + lowSun * 0.55;
    var shadowLength = 0.35 + lowSun * 3.4;   // up to ~3.75 object heights

    // Sky color as CSS string
    var skyColor = 'rgb(' + Math.round(phase.sky[0]) + ',' + Math.round(phase.sky[1]) + ',' + Math.round(phase.sky[2]) + ')';

    return {
      time: time,
      label: phase.name,
      sunAngle: sunAngle,
      sunHeight: sunHeight,
      moonAngle: moonAngle,
      moonHeight: moonHeight,
      // Legacy compat
      angle: sunAngle,
      height: Math.max(sunHeight, moonHeight * 0.3),
      intensity: phase.ambient,
      ambient: phase.ambient,
      tint: phase.tint,
      skyColor: skyColor,
      fogTint: phase.fog,
      shadowX: shadowX,
      shadowY: shadowY,
      shadowLength: shadowLength,
      isDaytime: sunHeight > 0.05,
    };
  }
}
