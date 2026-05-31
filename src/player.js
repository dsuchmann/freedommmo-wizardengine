export class Player {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.speed = 9;
  }

  update(input, dt) {
    const axis = input.axis();
    this.x += axis.x * this.speed * dt;
    this.y += axis.y * this.speed * dt;
  }
}
