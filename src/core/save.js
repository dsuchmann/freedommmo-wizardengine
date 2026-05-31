const PLAYER_POSITION_KEY = 'freedommmo.player.position.v1';

export function loadPlayerPosition() {
  try {
    const raw = window.localStorage.getItem(PLAYER_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

export function savePlayerPosition(player) {
  try {
    window.localStorage.setItem(PLAYER_POSITION_KEY, JSON.stringify({ x: player.x, y: player.y }));
  } catch {
    // Persistence is helpful during live editing, but not required for the simulation.
  }
}

export function clearPlayerPosition() {
  try {
    window.localStorage.removeItem(PLAYER_POSITION_KEY);
  } catch {
    // Ignore storage failures.
  }
}
