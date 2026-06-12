import { ModularCharacter } from './character/modular-character.js';

export class Player {
  constructor(position = { x: 0, y: 0 }) {
    this.x = position.x;
    this.y = position.y;
    this.z = 0;
    this.vz = 0;
    this.speed = 9;
    this.sprintMultiplier = 1.65;
    this.rollTimer = 0;
    this.glide = false;
    this.character = new ModularCharacter();
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vz = 0;
    this.rollTimer = 0;
  }

  update(input, dt, chunkStore = null, movement = null) {
    const axis = input.axis();
    const moving = Boolean(axis.x || axis.y);
    const sprinting = input.down?.('shift') && moving && this.rollTimer <= 0;
    if (input.wasPressed?.(' ') && this.z <= (this.floorZ ?? 0) + 0.01) this.vz = 7.5;
    if (input.wasPressed?.('q') && moving && this.rollTimer <= 0) this.rollTimer = 0.38;
    this.interactPressed = Boolean(input.wasPressed?.('f'));
    this.glide = input.down?.('e') && this.z > 0.6 && this.vz < 0;

    const tile = chunkStore?.tileAt(this.x, this.y);
    this.climbing = Boolean((tile?.terrainForm === 'step' || tile?.layers?.[7]?.slope > 0.09) && tile?.layers?.[7]?.slope <= 0.16 && moving && this.z <= 0.05);
    const cost = movement?.movementCost ? movement.movementCost(tile) : 1;
    const rollBoost = this.rollTimer > 0 ? 2.4 : 1;
    const speed = this.speed * (sprinting ? this.sprintMultiplier : 1) * rollBoost;
    const dx = axis.x * speed * dt / cost;
    const dy = axis.y * speed * dt / cost;
    if (chunkStore && movement?.resolveMovement) movement.resolveMovement(this, chunkStore, dx, dy);
    else {
      this.x += dx;
      this.y += dy;
    }

    const gravity = this.glide ? 3.2 : 16;
    this.vz -= gravity * dt;
    this.z += this.vz * dt;
    const floorZ = this.floorZ ?? 0;
    if (this.z < floorZ) {
      this.z = floorZ;
      this.vz = 0;
    }
    this.rollTimer = Math.max(0, this.rollTimer - dt);
    this.character.setMotion({ moving, sprinting, jumping: this.z > (this.floorZ ?? 0) + 0.05, climbing: this.climbing, gliding: this.glide, rolling: this.rollTimer > 0, direction: directionFromAxis(axis) });
    this.character.update(dt);
  }
}

function directionFromAxis(axis) {
  if (!axis.x && !axis.y) return 'S';
  if (axis.y < -0.4 && axis.x > 0.4) return 'NE';
  if (axis.y < -0.4 && axis.x < -0.4) return 'NW';
  if (axis.y > 0.4 && axis.x > 0.4) return 'SE';
  if (axis.y > 0.4 && axis.x < -0.4) return 'SW';
  if (axis.y < -0.4) return 'N';
  if (axis.y > 0.4) return 'S';
  return axis.x > 0 ? 'E' : 'W';
}
