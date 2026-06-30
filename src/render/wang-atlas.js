// src/render/wang-atlas.js
// Owns the GL atlas of 32x32 Wang base tiles, keyed (biome-asset, wang level, cornerMask). Pure slot key
// below is unit-tested; the GL build/upload (a later task) attaches to the WangAtlas class.
export function wangSlotKey(biomeAsset, level, cornerMask) {
  return biomeAsset + '|' + level + '|' + (cornerMask & 63);
}
