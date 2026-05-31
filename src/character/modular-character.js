import { BODY_PARTS } from './body-schema.js';

export class ModularCharacter {
  constructor() {
    this.direction = 'S';
    this.animation = 'idle';
    this.frame = 0;
    this.parts = new Map(BODY_PARTS.map(part => [part, { id: part, tint: null, visible: true }]));
  }

  setMotion({ moving = false, sprinting = false, jumping = false, climbing = false, gliding = false, rolling = false, direction = this.direction } = {}) {
    this.direction = direction;
    if (rolling) this.animation = 'dodge_roll';
    else if (gliding) this.animation = 'glide_loop';
    else if (climbing) this.animation = moving ? 'climb' : 'climb_idle';
    else if (jumping) this.animation = 'jump_air';
    else if (sprinting) this.animation = 'sprint';
    else if (moving) this.animation = 'walk';
    else this.animation = 'idle';
  }

  update(dt) {
    const fps = this.animation === 'idle' ? 3 : this.animation === 'dodge_roll' ? 14 : 8;
    this.frame = (this.frame + dt * fps) % 8;
  }
}
