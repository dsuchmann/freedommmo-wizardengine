export class Camera {
  constructor() {
    this.zoom = 1.95;
    this.manualZoom = 1.95;
    this.targetZoom = 1.95;
    this._renderZoom = 1.95;  // zoom the renderer last drew at
    this.elevationOffsetY = 0;
    this.zooming = false;     // true during CSS-transform zoom (renderer skips redraw)
    this._zoomSettleTimer = null;
    this._canvas = null;

    window.addEventListener('wheel', event => {
      event.preventDefault();
      const delta = Math.sign(event.deltaY) * -0.08;
      this.manualZoom = clamp(this.manualZoom + delta, 0.35, 2.4);
      this._startCSSZoom();
    }, { passive: false });
  }

  /** Attach to the game canvas for CSS transform zooming. */
  setCanvas(canvas) { this._canvas = canvas; }

  /** During wheel events, apply CSS transform instead of re-rendering.
   *  The renderer keeps drawing at _renderZoom; CSS scales the result. */
  _startCSSZoom() {
    this.zooming = true;
    if (!this._canvas) return;

    // CSS scale relative to last rendered zoom
    const cssScale = this.manualZoom / this._renderZoom;
    this._canvas.style.transformOrigin = '50% 50%';
    this._canvas.style.transform = `scale(${cssScale})`;

    // Debounce: settle after 150ms of no scroll → do one clean re-render
    clearTimeout(this._zoomSettleTimer);
    this._zoomSettleTimer = setTimeout(() => {
      this.zooming = false;
      this.zoom = clamp(this.manualZoom, 0.32, 2.4);
      this._renderZoom = this.zoom;
      if (this._canvas) {
        this._canvas.style.transform = '';
        this._canvas.style.transformOrigin = '';
      }
    }, 150);
  }

  update(dt, tile) {
    this.targetZoom = clamp(this.manualZoom, 0.32, 2.4);
    if (!this.zooming) {
      // Normal: renderer uses actual zoom
      this.zoom = this.targetZoom;
      this._renderZoom = this.zoom;
    } else {
      // Zooming: keep renderer at last stable zoom, CSS handles the visual
      this.zoom = this._renderZoom;
    }
    this.elevationOffsetY = 0;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
