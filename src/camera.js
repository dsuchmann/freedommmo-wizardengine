export class Camera {
  constructor() {
    this.zoom = 1.22;
    this.manualZoom = 1.22;
    this.targetZoom = 1.22;
    this.elevationOffsetY = 0;
    window.addEventListener('wheel', event => {
      event.preventDefault();
      const delta = Math.sign(event.deltaY) * -0.05;
      this.manualZoom = clamp(this.manualZoom + delta, 0.35, 1.65);
    }, { passive: false });
  }

  update(dt, tile) {
    const elevation = tile?.climate?.elevation ?? 0.5;
    const slope = tile?.layers?.[7]?.slope ?? 0;
    const plateau = tile?.layers?.[7]?.plateauLevel ?? 1;
    const elevationZoom = 1.04 - Math.max(0, elevation - 0.42) * 0.22 - plateau * 0.02 - slope * 0.12;
    this.targetZoom = clamp(this.manualZoom * elevationZoom, 0.32, 1.75);
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * 4.5);
    const targetOffset = -(elevation - 0.5) * 26 - plateau * 3;
    this.elevationOffsetY += (targetOffset - this.elevationOffsetY) * Math.min(1, dt * 3.5);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
