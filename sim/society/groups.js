// sim/society/groups.js — P2: the group primitive (S5 society's first node type).
// A group is a time WALLET shaped like the player (R + body:0 → kernel.stocks()
// counts it with zero kernel changes): it holds pooled time and spends it on
// infrastructure. Honest absences: NO decision-making (Agency, Pass 4), no roles,
// no membership semantics beyond contributor ids — declared, not faked.
import { transfer } from '../time/metabolism.js';

/** Found a group at a position. Returns the group node. */
export function createGroup(kernel, tick, pos) {
  const evId = kernel.ledger.emit({ tick, type: 'group_founded' });
  const group = kernel.graph.createNode({
    type: 'group', tick, x: pos?.x ?? null, y: pos?.y ?? null, R: 0, causeEventId: evId,
    attrs: { body: 0, cap: 0, burn: 0, noFlux: true, members: [] },
  });
  kernel.ledger.events[evId - 1].targets.push(group.id);
  return group;
}

/** Member moves `amount` tu of R into the group through the lossy gift channel.
 *  Refuses (false, side-effect-free) on missing nodes, non-positive or unaffordable amount. */
export function contribute(kernel, memberId, groupId, amount, tick) {
  const member = kernel.graph.nodes.get(memberId);
  const group = kernel.graph.nodes.get(groupId);
  if (!member || !group || group.type !== 'group') return false;
  if (!(amount > 0) || member.R == null || member.R < amount) return false;
  const evId = kernel.ledger.emit({
    tick, type: 'contribute', actor: memberId, targets: [groupId],
    attrs: { amount },
  });
  member.R -= amount;
  group.R += transfer(amount, 'gift', kernel.ledger);
  if (!group.attrs.members.includes(memberId)) group.attrs.members.push(memberId);
  return true;
}
