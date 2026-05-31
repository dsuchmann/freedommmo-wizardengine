export const WORLD = Object.freeze({
  seed: 42,
  chunkSize: 64,
  tileSize: 16,
  sourceTileSize: 32,
  overmapChunks: 6400,
  loadRadius: 2,
  unloadPadding: 1
});

export const LAYERS = Object.freeze({
  bedrock: 0,
  substrate: 1,
  terrain: 2,
  surface: 3,
  objects: 4,
  structures: 5,
  terrainForms: 6,
  subterranean: 7,
  entities: 8,
  lighting: 9
});
