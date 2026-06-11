// Binary min-heap of due events. Deterministic order: (tick, nodeId, kind).

function lt(a, b) {
  if (a.tick !== b.tick) return a.tick < b.tick;
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId;
  return a.kind < b.kind;
}

export class EventHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }

  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!lt(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }

  pop() {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && lt(a[l], a[m])) m = l;
        if (r < a.length && lt(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
