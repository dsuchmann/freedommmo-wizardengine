import { rand, randRange } from '../kernel/rng.js';
import { DAY } from '../time/metabolism.js';
import { REGION, createAggregate } from '../lod/aggregate.js';

// Deterministic baseline meadow (spec §5.1). Densities are per-tile probabilities.
export const DENSITY = { grass: 0.5, berry_bush: 0.05, grazer: 0.004, tree: 0.02 };
export const START = {
  grass:      { R: [200, 1500],   body: [10, 60],    maxAgeDays: 50 },
  berry_bush: { R: [3000, 15000], body: [500, 3000], maxAgeDays: 600 },
  grazer:     { R: [20000, 60000], body: [2000, 8000], maxAgeDays: 1500 },
  tree:       { R: [10000, 40000], body: [5000, 30000], maxAgeDays: 3000 },
};

export function spawnMeadow(kernel, { x0, y0, w, h }) {
  kernel.graph.boot(() => {
    for (let ty = y0; ty < y0 + h; ty++) {
      for (let tx = x0; tx < x0 + w; tx++) {
        let salt = 0;
        for (const species of Object.keys(DENSITY)) {
          salt += 1000;
          if (rand(kernel.seed, tx * 31 + salt, ty * 17 + salt) < DENSITY[species]) {
            const s = START[species];
            kernel.addLiving({
              species,
              x: tx + rand(kernel.seed, tx + salt + 1, ty),
              y: ty + rand(kernel.seed, tx, ty + salt + 2),
              R: randRange(kernel.seed, tx + salt + 3, ty, s.R[0], s.R[1]),
              body: randRange(kernel.seed, tx + salt + 4, ty, s.body[0], s.body[1]),
              tick: 0,
              age: Math.floor(randRange(kernel.seed, tx + salt + 5, ty, 0, s.maxAgeDays * DAY)),
            });
          }
        }
      }
    }
  });
}

/** Statistical baseline for one region: expected counts from the same DENSITY table,
 *  means from the same START ranges the individual spawner uses (spec §5.1 — baseline from seed).
 *  w/h: actual in-bounds tile extent (edge regions clipped by world bounds). */
export function spawnRegionAggregate(kernel, rx, ry, w = REGION, h = REGION) {
  const pops = {};
  let salt = 0;
  for (const species of Object.keys(DENSITY)) {
    salt += 1000;
    const expected = DENSITY[species] * w * h;
    const frac = expected - Math.floor(expected);
    const count = Math.floor(expected) + (rand(kernel.seed, rx * 131 + salt, ry * 173 + salt) < frac ? 1 : 0);
    if (count === 0) continue;
    const s = START[species];
    pops[species] = {
      count,
      sumR: count * (s.R[0] + s.R[1]) / 2,
      sumBody: count * (s.body[0] + s.body[1]) / 2,
      ageSum: count * s.maxAgeDays * DAY / 2,
      detritusE: 0,
    };
  }
  if (Object.keys(pops).length) createAggregate(kernel, `${rx},${ry}`, pops, kernel.tick, null);
}

/** Whole-world baseline: individuals where the attention bubble starts, aggregates everywhere else. */
export function spawnWorld(kernel, bounds, fullRect) {
  kernel.graph.boot(() => {
    const r0x = Math.floor(bounds.x0 / REGION), r1x = Math.ceil((bounds.x0 + bounds.w) / REGION);
    const r0y = Math.floor(bounds.y0 / REGION), r1y = Math.ceil((bounds.y0 + bounds.h) / REGION);
    for (let ry = r0y; ry < r1y; ry++) for (let rx = r0x; rx < r1x; rx++) {
      const gx = rx * REGION, gy = ry * REGION;
      // clip edge regions to the world bounds so baseline never spawns outside the world
      const cw = Math.min(REGION, bounds.x0 + bounds.w - gx), ch = Math.min(REGION, bounds.y0 + bounds.h - gy);
      const overlaps = gx < fullRect.x0 + fullRect.w && gx + REGION > fullRect.x0
        && gy < fullRect.y0 + fullRect.h && gy + REGION > fullRect.y0;
      if (overlaps) spawnMeadow(kernel, { x0: gx, y0: gy, w: cw, h: ch });
      else spawnRegionAggregate(kernel, rx, ry, cw, ch);
    }
  });
}
