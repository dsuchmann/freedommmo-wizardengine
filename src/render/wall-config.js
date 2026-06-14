// src/render/wall-config.js — shared wall rendering config.
// Baked calibrated values from user tuning session.
// Used by both the main-thread renderer (building-renderer.js)
// and the chunk worker (worker-chunk-renderer.js).
// The wall tuner can override these at runtime on the main thread.

export var WALL_CONFIG = {
  wallYOffset: 0.25,
  cornerExtend: 0,
  wallHeight: 4,
  northWall: true,
  northYOffset: 0.25,
  interiorWall: false,
  eastWestColumns: true,
  eastTileName: 'edge_ew',
  westTileName: 'edge_ew',
  ewTileHeight: 0.40,
  ewXOffset: -0.30,
  ewFrequency: 1,
  ewFlipH: false,
  ewFlipV: false,
  ewRotate90: true,
};
