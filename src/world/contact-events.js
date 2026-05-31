export class ContactEventBus {
  constructor() {
    this.events = [];
    this.maxEvents = 256;
  }

  emit(event) {
    this.events.push({ time: performance.now() / 1000, ...event });
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
  }

  recent(seconds = 1) {
    const now = performance.now() / 1000;
    return this.events.filter(event => now - event.time <= seconds);
  }

  clearOld(seconds = 3) {
    const now = performance.now() / 1000;
    this.events = this.events.filter(event => now - event.time <= seconds);
  }
}

export function contactKindForPlayer(player, moving) {
  if (player.rollTimer > 0) return 'dodge_roll_sweep';
  if (player.z > 0.05) return player.glide ? 'glide_shadow' : 'airborne';
  return moving ? 'footstep' : 'standing';
}
