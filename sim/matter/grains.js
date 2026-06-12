// sim/matter/grains.js — Grain type registry (atlas S3 Material System).
// Grains are TYPES with property bags, never nodes (1M-entity rule).
// Property vocabulary mined from SCI_FI_FANTASY_SYSTEMS.md design archaeology.
export const CATEGORIES = ['physical', 'magical', 'spiritual', 'technical'];

// { category, purity 0..1, resonance -1..1, stability 0..1 (decay resistance),
//   energyDensity (tu per grain unit at transfer points) }
export const GRAINS = {
  cellulose: { category: 'physical', purity: 0.6, resonance: 0.1,  stability: 0.5, energyDensity: 80 },
  fibre:     { category: 'physical', purity: 0.5, resonance: 0.2,  stability: 0.3, energyDensity: 60 },
  sugar:     { category: 'physical', purity: 0.8, resonance: 0.4,  stability: 0.2, energyDensity: 160 },
  lignin:    { category: 'physical', purity: 0.7, resonance: 0.0,  stability: 0.8, energyDensity: 100 },
  keratin:   { category: 'physical', purity: 0.6, resonance: 0.1,  stability: 0.6, energyDensity: 90 },
  bone:      { category: 'physical', purity: 0.7, resonance: -0.1, stability: 0.9, energyDensity: 70 },
  stone:     { category: 'physical', purity: 0.5, resonance: -0.3, stability: 0.97, energyDensity: 10 },
  ore:       { category: 'physical', purity: 0.4, resonance: -0.2, stability: 0.95, energyDensity: 20 },
};
