export class Camera {
  constructor() {
    this.zoom = 1.95;
    this.targetZoom = 1.95;
    this.elevationOffsetY = 0;
    window.addEventListener('wheel', event => {
      event.preventDefault();
      // Multiplicative zoom — feels natural at any scale, fine-grained
      const factor = event.deltaY > 0 ? 0.95 : 1.0 / 0.95;
      this.targetZoom = clamp(this.targetZoom * factor, 0.32, 2.4);
    }, { passive: false });
  }

  update(dt) {
    // Smooth exponential interpolation — fast response, no overshoot
    const t = 1 - Math.pow(0.0001, dt); // ~93% per frame at 60fps
    this.zoom += (this.targetZoom - this.zoom) * t;
    if (Math.abs(this.targetZoom - this.zoom) < 0.001) this.zoom = this.targetZoom;
    this.elevationOffsetY = 0;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
