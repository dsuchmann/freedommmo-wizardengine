export class Camera {
  constructor() {
    this.zoom = 1;
    this.manualZoom = 1;
    this.targetZoom = 1;
    window.addEventListener('wheel', event => {
      event.preventDefault();
      const delta = Math.sign(event.deltaY) * -0.08;
      this.manualZoom = clamp(this.manualZoom + delta, 0.55, 2.25);
    }, { passive: false });
  }

  update(dt, tile) {
    const elevation = tile?.climate?.elevation ?? 0.5;
    const elevationZoom = 1.05 - Math.max(0, elevation - 0.45) * 0.28;
    this.targetZoom = clamp(this.manualZoom * elevationZoom, 0.45, 2.4);
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * 4.5);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
