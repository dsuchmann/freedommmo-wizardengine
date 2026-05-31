export class InputState {
  constructor(target = window) {
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    target.addEventListener('keydown', event => {
      const key = event.key.toLowerCase();
      if (!this.keys.has(key)) this.pressedThisFrame.add(key);
      this.keys.add(key);
    });
    target.addEventListener('keyup', event => this.keys.delete(event.key.toLowerCase()));
  }

  down(key) {
    return this.keys.has(key.toLowerCase());
  }

  wasPressed(key) {
    return this.pressedThisFrame.has(key.toLowerCase());
  }

  endFrame() {
    this.pressedThisFrame.clear();
  }

  axis() {
    let x = 0;
    let y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y--;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y++;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x--;
    if (this.keys.has('d') || this.keys.has('arrowright')) x++;
    if (x || y) {
      const magnitude = Math.hypot(x, y);
      x /= magnitude;
      y /= magnitude;
    }
    return { x, y };
  }
}
