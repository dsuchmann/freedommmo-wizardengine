export class Camera {
  constructor() {
    this.zoom = 1.95;
    this.targetZoom = 1.95;
    this.elevationOffsetY = 0;
    window.addEventListener('wheel', event => {
      event.preventDefault();
      // Use actual deltaY magnitude — smooth on trackpads, proportional on mice
      // deltaMode 0 = pixels, 1 = lines, 2 = pages
      let pixels = event.deltaY;
      if (event.deltaMode === 1) pixels *= 16;  // lines → pixels
      if (event.deltaMode === 2) pixels *= 100;  // pages → pixels
      // Multiplicative: each pixel of scroll = tiny zoom factor
      const factor = Math.pow(0.998, pixels);
      this.targetZoom = clamp(this.targetZoom * factor, 0.32, 2.4);
    }, { passive: false });
  }

  update(dt) {
    // Smooth exponential chase — converges quickly, never overshoots
    const t = 1 - Math.pow(0.00001, dt);
    this.zoom += (this.targetZoom - this.zoom) * t;
    if (Math.abs(this.targetZoom - this.zoom) < 0.0005) this.zoom = this.targetZoom;
    this.elevationOffsetY = 0;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
