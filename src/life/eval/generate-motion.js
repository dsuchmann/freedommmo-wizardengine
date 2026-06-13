// src/life/eval/generate-motion.js
import { composeChoreography } from './compose.js';
import { compilePlan } from './compile-plan.js';
import { renderStrip } from './stick-renderer.js';
import { evalMotion } from './vision-eval.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const command = process.argv[2];
if (!command) { console.error('Usage: node generate-motion.js "command"'); process.exit(1); }

const key = process.env.MOTION_LLM_KEY;
if (!key) { console.error('Set MOTION_LLM_KEY env var'); process.exit(1); }

const rig = JSON.parse(readFileSync('src/life/rigs/humanoid.json', 'utf8'));
const poses = JSON.parse(readFileSync('src/life/choreography/poses.json', 'utf8'));
const poseSummary = poses.map(p => ({ id: p.id, desc: p.desc }));
const cfg = { key };

const evalDir = 'src/life/choreography/evals/motions';
const validatedDir = 'src/life/choreography/validated';
mkdirSync(evalDir, { recursive: true });
mkdirSync(validatedDir, { recursive: true });

const id = command.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
const attempts = [];
let finalProgram = null;

for (let attempt = 0; attempt < 3; attempt++) {
  console.log(`\nAttempt ${attempt + 1}/3...`);

  const composeCmd = attempt === 0 ? command :
    `${command}\n\nPrevious attempt scored ${attempts[attempt-1].score}/5. Critique: ${attempts[attempt-1].critique}\nFix the issues.`;
  const { plan, error: composeErr } = await composeChoreography(composeCmd, poseSummary, cfg);
  if (composeErr) { console.error(`  Compose error: ${composeErr}`); continue; }
  console.log(`  Composed: ${plan.steps?.length} steps`);

  let program;
  try { program = compilePlan(plan, poses); }
  catch (e) { console.error(`  Compile error: ${e.message}`); continue; }

  if (program.missingPoses) {
    console.log(`  Missing poses: ${program.missingPoses.join(', ')}`);
    continue;
  }

  const frames = program.root.children.map((c, i) => ({
    joints: c.joints,
    label: plan.steps[i]?.pose || `step${i}`,
  }));
  const stripBuf = await renderStrip(rig, frames, { frameWidth: 200, frameHeight: 400, title: `"${command}"` });
  const stripPath = `${evalDir}/${id}_attempt${attempt + 1}.png`;
  writeFileSync(stripPath, stripBuf);
  console.log(`  Rendered ${frames.length} frames → ${stripPath}`);

  const base64 = stripBuf.toString('base64');
  const { score, critique } = await evalMotion(base64, command, frames.length);
  console.log(`  Score: ${score}/5 — ${critique}`);

  attempts.push({ plan, score, critique, stripPath });

  if (score >= 4) { finalProgram = program; break; }
  await new Promise(r => setTimeout(r, 500));
}

if (finalProgram) {
  writeFileSync(`${validatedDir}/${id}.json`, JSON.stringify(finalProgram, null, 2));
  console.log(`\nPASS — saved to ${validatedDir}/${id}.json`);
} else {
  console.log(`\nFAILED after 3 attempts`);
}

writeFileSync(`${evalDir}/${id}_report.json`, JSON.stringify({
  command, id,
  attempts: attempts.map(a => ({ score: a.score, critique: a.critique, stripPath: a.stripPath })),
  verdict: finalProgram ? 'pass' : 'fail',
}, null, 2));

process.exit(finalProgram ? 0 : 1);
