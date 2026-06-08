export class Camera {
  constructor() {
    this.zoom = 1.95;
    this.manualZoom = 1.95;
    this.targetZoom = 1.95;
    this.elevationOffsetY = 0;
    window.addEventListener('wheel', event => {
      event.preventDefault();
      const delta = Math.sign(event.deltaY) * -0.08;
      this.manualZoom = clamp(this.manualZoom + delta, 0.35, 2.4);
    }, { passive: false });
  }

  update(dt, tile) {
    // Zoom is purely manual — no elevation/slope/plateau adjustment.
    // The old system caused jitter as each tile's different values
    // micro-adjusted the zoom while walking.
    this.targetZoom = clamp(this.manualZoom, 0.32, 2.4);
    var lerpSpeed = Math.min(1, dt * 4.0);
    this.zoom += (this.targetZoom - this.zoom) * lerpSpeed;
    if (Math.abs(this.targetZoom - this.zoom) < 0.0005) this.zoom = this.targetZoom;
    this.elevationOffsetY = 0;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
