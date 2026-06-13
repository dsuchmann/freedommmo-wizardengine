// Usage: MOTION_LLM_KEY=sk-... node src/life/eval/verify-poses.js
import { renderPose } from './stick-renderer.js';
import { evalPose } from './vision-eval.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));
const evalDir = 'src/life/choreography/evals/poses';
mkdirSync(evalDir, { recursive: true });

const results = [];
let passCount = 0;

for (const p of poses) {
  const buf = await renderPose(rig, p.joints, { width: 400, height: 600, label: p.id });
  const base64 = buf.toString('base64');
  writeFileSync(`${evalDir}/${p.id}.png`, buf);
  const { score, critique } = await evalPose(base64, p.id, p.desc);
  const passed = score >= 4;
  if (passed) passCount++;
  p.verified = passed;
  results.push({ id: p.id, score, critique, passed });
  console.log(`  ${passed ? '✓' : '✗'} ${p.id}: ${score}/5 — ${critique}`);
  await new Promise(r => setTimeout(r, 200));
}

writeFileSync('src/life/choreography/poses.json', JSON.stringify(poses, null, 2));
writeFileSync(`${evalDir}/report.json`, JSON.stringify({ total: poses.length, passed: passCount, results }, null, 2));
console.log(`\n${passCount}/${poses.length} poses verified.`);
