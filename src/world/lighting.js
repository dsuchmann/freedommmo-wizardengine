export class DayNightCycle {
  constructor() {
    this.time = 0.28;
    this.speed = 0.015;
    this.paused = false;
  }

  update(dt) {
    if (!this.paused) this.time = (this.time + dt * this.speed) % 1;
  }

  togglePause() {
    this.paused = !this.paused;
  }

  sun() {
    const angle = this.time * Math.PI * 2;
    const height = Math.sin(angle - Math.PI * 0.5) * 0.5 + 0.5;
    const dawn = Math.max(0, 1 - Math.abs(this.time - 0.25) * 10);
    const dusk = Math.max(0, 1 - Math.abs(this.time - 0.75) * 10);
    const twilight = Math.max(dawn, dusk);
    const intensity = Math.max(0.16, height);
    return {
      time: this.time,
      label: labelForTime(this.time),
      angle,
      height,
      intensity,
      ambient: 0.22 + intensity * 0.72,
      tint: {
        r: 0.55 + intensity * 0.45 + twilight * 0.22,
        g: 0.62 + intensity * 0.38 + twilight * 0.08,
        b: 0.82 + intensity * 0.18 - twilight * 0.18
      },
      shadowX: Math.cos(angle) * (1.25 - height),
      shadowY: Math.sin(angle) * (1.25 - height)
    };
  }
}

function labelForTime(time) {
  if (time < 0.20) return 'night';
  if (time < 0.30) return 'dawn';
  if (time < 0.68) return 'day';
  if (time < 0.80) return 'dusk';
  return 'night';
}
