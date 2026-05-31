export function animationFrame(animation, timeSeconds, direction = 'S') {
  if (!animation) return { frame: 0, direction };
  const directions = animation.directions ?? ['OMNI'];
  const resolvedDirection = directions.includes(direction) ? direction : directions[0];
  const frameCount = Math.max(1, animation.frames ?? 1);
  const frame = animation.loop
    ? Math.floor(timeSeconds * (animation.fps ?? 1)) % frameCount
    : Math.min(frameCount - 1, Math.floor(timeSeconds * (animation.fps ?? 1)));
  return { frame, direction: resolvedDirection };
}

export function activeFrameEvents(animation, frame) {
  return (animation?.events ?? []).filter(event => event.frame === frame);
}
