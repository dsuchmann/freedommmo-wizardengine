// sim/world/blueprints.js — M4: nested blueprint grammar (locked decision 6).
// Buildings are walls/floors/doors stamped on the world grid — NEVER house-sprites.
// Templates are authored DATA in the world-compiler building-template schema
// (docs 2026-05-24-world-compiler-design.md). The no-mock rule forbids predefined
// RECIPES (locked decision 5); blueprint templates are knowledge artifacts like
// species definitions and are explicitly allowed.
// Grammar levels region→settlement→district are honest absences in M4: the
// `children` mechanism supports them structurally (see 'compound'), but only
// building→wall-section is populated. Settlements arrive with a later plan.

/** Building templates — world-compiler schema shape. */
export const BLUEPRINT_TEMPLATES = {
  hut: {
    template_id: 'hut', category: 'residence',
    footprint: { width: 5, height: 4 },
    walls: { material: 'wattle', doors: [{ side: 'south', offset: 2 }] },
    floor: { material: 'dirt' },
    interior_features: [
      { type: 'hearth', pos: [1, 1], provides: 'heat' },
      { type: 'bedroll', pos: [3, 1], provides: 'sleep' },
    ],
    npc_slots: [{ role: 'resident', workplace: null, sleep: 'bedroll' }],
  },
  forge: {
    template_id: 'forge', category: 'workshop',
    footprint: { width: 6, height: 5 },
    walls: { material: 'stone', doors: [{ side: 'south', offset: 2 }, { side: 'east', offset: 2 }] },
    floor: { material: 'stone' },
    interior_features: [
      { type: 'furnace', pos: [1, 1], provides: 'smelt' },
      { type: 'anvil', pos: [3, 2], provides: 'smith' },
    ],
    npc_slots: [{ role: 'smith', workplace: 'anvil', sleep: null }],
  },
  compound: {
    template_id: 'compound', category: 'group',
    children: [
      { template: 'hut', dx: 0, dy: 0 },
      { template: 'forge', dx: 7, dy: 0 },
    ],
  },
};

/** Absolute (x, y) of a door given footprint origin + size. */
function doorXY(side, offset, ox, oy, w, h) {
  switch (side) {
    case 'north': return [ox + offset, oy];
    case 'south': return [ox + offset, oy + h - 1];
    case 'west':  return [ox, oy + offset];
    case 'east':  return [ox + w - 1, oy + offset];
    default: throw new Error(`unknown door side '${side}'`);
  }
}

/** Expand one LEAF template into stamps/features at absolute coordinates. */
function expandLeaf(template, ox, oy) {
  const { width: w, height: h } = template.footprint;
  const doors = new Map(); // "x,y" -> true
  for (const d of template.walls.doors ?? []) {
    const [dx, dy] = doorXY(d.side, d.offset, ox, oy, w, h);
    doors.set(`${dx},${dy}`, true);
  }
  const stamps = [];
  for (let y = oy; y < oy + h; y++) for (let x = ox; x < ox + w; x++) {
    const perimeter = x === ox || x === ox + w - 1 || y === oy || y === oy + h - 1;
    if (!perimeter) {
      stamps.push({ x, y, piece: 'floor', material: template.floor.material, walkable: true });
    } else if (doors.has(`${x},${y}`)) {
      stamps.push({ x, y, piece: 'door', material: template.walls.material, walkable: true });
    } else {
      stamps.push({ x, y, piece: 'wall', material: template.walls.material, walkable: false });
    }
  }
  const features = (template.interior_features ?? []).map(f => ({
    type: f.type, x: ox + f.pos[0], y: oy + f.pos[1], provides: f.provides,
  }));
  return {
    template: template.template_id,
    footprint: { x0: ox, y0: oy, w, h },
    stamps, features,
    npcSlots: structuredClone(template.npc_slots ?? []),
  };
}

/** Deterministically expand a blueprint at an origin.
 *  Returns { leaves: [...] } — one leaf per physical building (groups recurse). */
export function expandBlueprint(templateId, ox, oy) {
  const template = BLUEPRINT_TEMPLATES[templateId];
  if (!template) throw new Error(`unknown blueprint '${templateId}'`);
  if (template.children) {
    const leaves = [];
    for (const c of template.children) {
      leaves.push(...expandBlueprint(c.template, ox + c.dx, oy + c.dy).leaves);
    }
    return { leaves };
  }
  return { leaves: [expandLeaf(template, ox, oy)] };
}
