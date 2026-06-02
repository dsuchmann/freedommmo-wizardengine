import { WORLD } from '../core/constants.js';
import { fbm, rand2 } from '../core/random.js';
import { sampleClimate } from './biomes.js';

export function classifyTerrainForm(wx, wy, climate = sampleClimate(wx, wy)) {
  const e = climate.elevation;
  const east = sampleClimate(wx + 2, wy).elevation;
  const west = sampleClimate(wx - 2, wy).elevation;
  const north = sampleClimate(wx, wy - 2).elevation;
  const south = sampleClimate(wx, wy + 2).elevation;
  const nearEast = sampleClimate(wx + 1, wy).elevation;
  const nearWest = sampleClimate(wx - 1, wy).elevation;
  const nearNorth = sampleClimate(wx, wy - 1).elevation;
  const nearSouth = sampleClimate(wx, wy + 1).elevation;
  const slopeX = east - west;
  const slopeY = south - north;
  const slope = Math.hypot(slopeX, slopeY);
  const localStep = Math.max(Math.abs(e - nearEast), Math.abs(e - nearWest), Math.abs(e - nearNorth), Math.abs(e - nearSouth));
  const convexity = e - (east + west + north + south) * 0.25;
  const valleySignal = fbm(wx + 22000, wy - 13000, 500);
  const ridgeSignal = fbm(wx - 15000, wy + 25000, 510);
  const caveSignal = fbm(wx + 44000, wy + 44000, 700);
  const dryRiverSignal = Math.abs(valleySignal - 0.52);
  const plateauLevel = Math.max(0, Math.min(4, Math.floor((e - 0.36) / 0.115)));
  const neighborLevels = [nearEast, nearWest, nearNorth, nearSouth].map(value => Math.max(0, Math.min(4, Math.floor((value - 0.36) / 0.115))));
  const plateauDelta = Math.max(...neighborLevels.map(level => Math.abs(level - plateauLevel)));

  let form = 'plains';
  if (e < 0.40) form = 'water_basin';
  else if (plateauDelta >= 2 && e > 0.48) form = 'cliff';
  else if (plateauDelta === 1 && e > 0.44) form = 'step';
  else if ((localStep > 0.075 || slope > 0.105) && e > 0.54) form = 'cliff';
  else if (e > 0.82 && convexity > 0.018) form = 'mountain_peak';
  else if (e > 0.72 && convexity < -0.018) form = 'mountain_bowl';
  else if (e > 0.66) form = 'mountain_slope';
  else if (ridgeSignal > 0.68 && convexity > 0.008 && e > 0.48) form = 'ridge';
  else if ((valleySignal < 0.34 || convexity < -0.018) && e > 0.42) form = 'valley';
  else if (localStep > 0.045 && e > 0.48) form = 'step';
  else if (e > 0.56) form = 'hillside';

  const dryRiverbed = e > 0.42 && e < 0.68 && dryRiverSignal < 0.026 && climate.moisture < 0.62;
  const caveEntrance = e > 0.56 && slope > 0.055 && caveSignal > 0.74 && rand2(Math.floor(wx / 3), Math.floor(wy / 3), 9400) > 0.988;
  const overhang = form === 'cliff' && ridgeSignal > 0.68;
  const naturalBridge = overhang && dryRiverbed && rand2(Math.floor(wx / WORLD.chunkSize), Math.floor(wy / WORLD.chunkSize), 9500) > 0.72;

  return {
    form,
    slope,
    localStep,
    convexity,
    plateauLevel,
    plateauDelta,
    slopeX,
    slopeY,
    valleySignal,
    ridgeSignal,
    dryRiverbed,
    caveEntrance,
    overhang,
    naturalBridge,
    subterranean: caveEntrance ? { entrance: true, depthHint: Math.floor(1 + caveSignal * 5) } : null
  };
}
