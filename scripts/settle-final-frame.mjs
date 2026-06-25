// scripts/settle-final-frame.mjs <animDir>
// Deterministic auto-fix for the PixelLab final-frame glitch (qa-frames SETTLE-FAIL): a door/window animation
// SETTLES at the end — the leaf has finished moving — so the final frame ought to ≈ the previous one. When
// PixelLab corrupts the last frame (zigzag triangles / colour blowout), the CORRECT settled frame IS the
// previous frame, so replace the final frame with a copy of the second-to-last. Use ONLY when qa-frames flags
// the final frame; it does not invent motion, it freezes the already-settled pose. Pairs with qa-frames, which
// (by design) does NOT flag a final frame identical to its predecessor as FROZEN.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: settle-final-frame.mjs <animDir>'); process.exit(2); }
const files = fs.readdirSync(dir).filter((f) => /^frame_\d+\.png$/.test(f)).sort();
if (files.length < 2) { console.log('no frame sequence in', dir); process.exit(0); }
const last = files[files.length - 1], prev = files[files.length - 2];
fs.copyFileSync(path.join(dir, prev), path.join(dir, last));
console.log(`settled ${last} <- ${prev} (replaced corrupt final frame with the settled pose) in ${dir}`);
