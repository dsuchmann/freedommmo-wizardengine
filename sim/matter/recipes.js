// sim/matter/recipes.js — discovered recipes become canonical nodes (locked decision 5).
// Recipe nodes are KNOWLEDGE: bounded by distinct signatures (1M-entity rule safe — attempts
// are ledger events, not nodes). knownBy is owner-scoped; knowledge moves only via teachRecipe
// (Lore seam: conversation/observation, never telepathy).

/** The canonical recipe node for a signature, or null. Recipes are few: linear scan is honest. */
export function recipeNodeOf(kernel, signature) {
  for (const n of kernel.graph.nodes.values()) {
    if (n.type === 'recipe' && n.attrs.signature === signature) return n;
  }
  return null;
}

/** Idempotent: create the canonical node on first discovery, else add discoverer to knownBy.
 *  Returns the recipe node id. causeEventId = the combine event that proved it. */
export function canonicalizeRecipe(kernel, signature, form, discovererId, causeEventId, tick) {
  const existing = recipeNodeOf(kernel, signature);
  if (existing) {
    if (!existing.attrs.knownBy.includes(discovererId)) existing.attrs.knownBy.push(discovererId);
    return existing.id;
  }
  const node = kernel.graph.createNode({
    type: 'recipe', tick, x: null, y: null, causeEventId,
    attrs: { signature, form, knownBy: [discovererId], noFlux: true },
  });
  return node.id;
}

export function knowsRecipe(kernel, entityId, signature) {
  return recipeNodeOf(kernel, signature)?.attrs.knownBy.includes(entityId) ?? false;
}

/** Teacher must know the recipe. Emits a 'teach' ledger event (knowledge has provenance too). */
export function teachRecipe(kernel, teacherId, learnerId, signature, tick) {
  const node = recipeNodeOf(kernel, signature);
  if (!node || !node.attrs.knownBy.includes(teacherId)) return false;
  if (!node.attrs.knownBy.includes(learnerId)) node.attrs.knownBy.push(learnerId);
  kernel.ledger.emit({ tick, type: 'teach', actor: teacherId, targets: [learnerId],
                       attrs: { signature, recipeId: node.id } });
  return true;
}
