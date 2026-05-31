export class PerformanceMonitor {
  constructor() {
    this.fps = 60;
    this.frameMs = 16.7;
    this.drawMs = 0;
    this.updateMs = 0;
    this.alpha = 0.08;
  }

  sampleFrame(dt) {
    const instant = dt > 0 ? 1 / dt : 60;
    this.fps += (instant - this.fps) * this.alpha;
    this.frameMs += (dt * 1000 - this.frameMs) * this.alpha;
  }

  sampleUpdate(ms) {
    this.updateMs += (ms - this.updateMs) * this.alpha;
  }

  sampleDraw(ms) {
    this.drawMs += (ms - this.drawMs) * this.alpha;
  }
}
