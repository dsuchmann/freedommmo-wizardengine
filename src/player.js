export class Player {
  constructor(position = { x: 0, y: 0 }) {
    this.x = position.x;
    this.y = position.y;
    this.speed = 9;
  }

  reset() {
    this.x = 0;
    this.y = 0;
  }

  update(input, dt) {
    const axis = input.axis();
    this.x += axis.x * this.speed * dt;
    this.y += axis.y * this.speed * dt;
  }
}
