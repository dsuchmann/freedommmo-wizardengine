// src/life/sockets.js — canonical-humanoid-rig sub-project 1, Task 5a.
// Socket world-transform resolution (motion-DSL / canonical-rig design §3, §7).
// A SOCKET is a named attachment anchor parented to a bone: it RIDES the bone's
// solved transform but is NOT an independently-animated joint. This is the
// "attachment graph" half of the two-job skeleton — worn/held items hang here.
// Pure geometry over a SOLVED pose; no fs/kernel imports.

const DEG = Math.PI / 180;

// CCW rotation by `a` degrees — matches pose.js's `rot` convention exactly so
// sockets and bones share one coordinate frame.
const rot = (a, x, y) => {
  const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
  return { x: c * x - s * y, y: s * x + c * y };
};

/** For each socket {bone, offset:[x,y], rot}, return {origin:{x,y}, rot} in
 *  world space by riding the bone's solved transform: rotate the socket's local
 *  offset by the bone's worldDeg, add it to the bone origin, and carry the
 *  bone's worldDeg plus the socket's own rot (so held weapons orient & swing).
 *  `solved` is the output of solvePose(rig, joints). */
export function solveSockets(rig, solved) {
  const out = {};
  for (const [name, sk] of Object.entries(rig.sockets ?? {})) {
    const b = solved[sk.bone];
    const off = rot(b.worldDeg, sk.offset[0], sk.offset[1] ?? 0);
    out[name] = {
      origin: { x: b.origin.x + off.x, y: b.origin.y + off.y },
      rot: b.worldDeg + (sk.rot ?? 0),
    };
  }
  return out;
}
