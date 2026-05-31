export class InputState {
  constructor(target = window) {
    this.keys = new Set();
    target.addEventListener('keydown', event => this.keys.add(event.key.toLowerCase()));
    target.addEventListener('keyup', event => this.keys.delete(event.key.toLowerCase()));
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
