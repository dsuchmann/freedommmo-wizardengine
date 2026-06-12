// sim/matter/grains.js — Grain type registry (atlas S3 Material System).
// Grains are TYPES with property bags, never nodes (1M-entity rule).
// Property vocabulary mined from SCI_FI_FANTASY_SYSTEMS.md design archaeology.
export const CATEGORIES = ['physical', 'magical', 'spiritual', 'technical'];

// { category, purity 0..1, resonance -1..1, stability 0..1 (decay resistance),
//   adhesion 0..1 (bonding quality in mixtures), energyDensity (tu per grain unit at transfer points),
//   hardness 0..1 (resistance to deformation; tool-edge quality) }
export const GRAINS = {
  cellulose: { category: 'physical', purity: 0.6, resonance: 0.1,  stability: 0.5,  adhesion: 0.3,  energyDensity: 80,  hardness: 0.3 },
  fibre:     { category: 'physical', purity: 0.5, resonance: 0.2,  stability: 0.3,  adhesion: 0.9,  energyDensity: 60,  hardness: 0.1 },
  sugar:     { category: 'physical', purity: 0.8, resonance: 0.4,  stability: 0.2,  adhesion: 0.6,  energyDensity: 160, hardness: 0.05 },
  lignin:    { category: 'physical', purity: 0.7, resonance: 0.0,  stability: 0.8,  adhesion: 0.5,  energyDensity: 100, hardness: 0.6 },
  keratin:   { category: 'physical', purity: 0.6, resonance: 0.1,  stability: 0.6,  adhesion: 0.4,  energyDensity: 90,  hardness: 0.5 },
  bone:      { category: 'physical', purity: 0.7, resonance: -0.1, stability: 0.9,  adhesion: 0.1,  energyDensity: 70,  hardness: 0.8 },
  stone:     { category: 'physical', purity: 0.5, resonance: -0.3, stability: 0.97, adhesion: 0.0,  energyDensity: 10,  hardness: 0.95 },
  ore:       { category: 'physical', purity: 0.4, resonance: -0.2, stability: 0.95, adhesion: 0.05, energyDensity: 20,  hardness: 0.9 },
};
