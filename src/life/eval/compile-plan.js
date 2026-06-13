// src/life/eval/compile-plan.js
// Compile a pose-ref choreography plan into a standard DSL program.
// plan = { id, kind, steps: [{pose, ticks}], variant? }
// poses = array of {id, joints, ...} from poses.json

export function compilePlan(plan, poses) {
  const poseMap = new Map(poses.map(p => [p.id, p]));
  const missing = [];

  const children = plan.steps.map((step, i) => {
    if (step.pose.startsWith('NEW:')) {
      missing.push(step.pose.slice(4).trim());
      return { op: 'pose', joints: {}, ticks: step.ticks };
    }
    const p = poseMap.get(step.pose);
    if (!p) throw new Error(`Unknown pose "${step.pose}" at step ${i}`);
    return { op: 'pose', joints: { ...p.joints }, ticks: step.ticks };
  });

  if (missing.length > 0) return { missingPoses: missing };

  return {
    id: plan.id,
    kind: plan.kind,
    variant: plan.variant || { time: [0.9, 1.1], amplitude: [0.9, 1.1] },
    root: { op: 'sequence', children },
  };
}
