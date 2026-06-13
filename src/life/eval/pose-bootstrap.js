// src/life/eval/pose-bootstrap.js — Render every pose in poses.json as a stick figure PNG.
// Usage: node src/life/eval/pose-bootstrap.js
// Writes to src/life/choreography/evals/poses/
import { renderPose } from './stick-renderer.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));
const outDir = 'src/life/choreography/evals/poses';
mkdirSync(outDir, { recursive: true });

for (const p of poses) {
  const buf = await renderPose(rig, p.joints, { width: 400, height: 600, label: `${p.id}: ${p.desc}` });
  writeFileSync(`${outDir}/${p.id}.png`, buf);
  console.log(`  ✓ ${p.id}`);
}
console.log(`\nRendered ${poses.length} poses to ${outDir}/`);
