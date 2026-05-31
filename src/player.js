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

  update(input, dt, chunkStore = null, movement = null) {
    const axis = input.axis();
    const tile = chunkStore?.tileAt(this.x, this.y);
    const cost = movement?.movementCost ? movement.movementCost(tile) : 1;
    const dx = axis.x * this.speed * dt / cost;
    const dy = axis.y * this.speed * dt / cost;
    if (chunkStore && movement?.resolveMovement) movement.resolveMovement(this, chunkStore, dx, dy);
    else {
      this.x += dx;
      this.y += dy;
    }
  }
}
