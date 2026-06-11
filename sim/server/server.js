// sim/server/server.js
// Spec §3. The ONLY file in sim/ allowed to read the wall clock — and only to
// decide how far to advance sim-time. The kernel itself never sees real time.
import { WebSocketServer } from 'ws';
import { parseClientMsg, serializeEntity, snapshotMsg, tickDeltaMsg, eventsMsg, timeMsg } from './protocol.js';
import { createPlayer, pick, chop } from '../world/actions.js';
import { checkpoint } from '../store/checkpoint.js';

const PUMP_MS = 100;   // ~10 Hz (spec §3.2)

export class SimServer {
  constructor({ kernel, port = 8787, timeScale = 48, db = null }) {
    this.kernel = kernel;
    this.port = port;
    this.timeScale = timeScale;
    this.db = db;                 // optional: admin save / shutdown checkpoint target
    this.paused = false;
    this.sessions = new Set();    // { ws, viewport, playerId, knownIds:Set }
    this.pendingIntents = [];     // applied at next pump boundary, in arrival order
    this._lastReal = null;
    this._eventCursor = 0;        // ledger index already broadcast
  }

  listen() {
    return new Promise(resolve => {
      this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port }, () => {
        this.port = this.wss.address().port;
        this._eventCursor = this.kernel.ledger.events.length;
        this._lastReal = Date.now();
        this.pump = setInterval(() => this._pump(), PUMP_MS);
        this.pump.unref();   // don't keep the process alive if all sockets close
        resolve();
      });
      this.wss.on('connection', ws => this._onConnection(ws));
    });
  }

  async close() {
    clearInterval(this.pump);
    if (this.db) checkpoint(this.kernel, this.db);    // quit → checkpoint (spec §3.4)
    for (const s of this.sessions) s.ws.close();
    await new Promise(res => this.wss.close(res));
  }

  _onConnection(ws) {
    let session = null;
    ws.on('message', raw => {
      const m = parseClientMsg(String(raw));
      if (!m) return;                                  // junk from untrusted input: drop
      if (m.type === 'hello') {
        const player = createPlayer(this.kernel, this.kernel.tick);
        session = { ws, viewport: m.viewport, playerId: player.id, knownIds: new Set() };
        this.sessions.add(session);
        this._sendSnapshot(session);
      } else if (!session) {
        // ignore everything before hello
      } else if (m.type === 'intent') {
        this.pendingIntents.push({ session, ...m });
      } else if (m.type === 'query') {
        const node = this.kernel.graph.nodes.get(m.id);
        ws.send(JSON.stringify({ type: 'query-result', id: m.id, entity: node ? serializeEntity(node, this.kernel.tick) : null }));
      } else if (m.type === 'admin') {
        if (m.op === 'pause') this.paused = true;
        if (m.op === 'resume') { this.paused = false; this._lastReal = Date.now(); }
        if (m.op === 'save' && this.db) checkpoint(this.kernel, this.db);
        if (m.op === 'ff') { this.kernel.runTo(this.kernel.tick + Math.round(m.days * 86400)); this._broadcastFrame(); }
      }
    });
    ws.on('close', () => { if (session) this.sessions.delete(session); });
  }

  _bubbleEntities(viewport) {
    const cx = viewport.x + viewport.w / 2, cy = viewport.y + viewport.h / 2;
    const radius = Math.hypot(viewport.w, viewport.h) / 2;
    return this.kernel.graph.nodesNear(cx, cy, radius)
      .map(n => serializeEntity(n, this.kernel.tick));
  }

  _sendSnapshot(session) {
    const entities = this._bubbleEntities(session.viewport);
    session.knownIds = new Set(entities.map(e => e.id));
    session.ws.send(JSON.stringify(snapshotMsg(
      this.kernel.tick, session.playerId, entities, this.kernel.deltas.list)));
  }

  _pump() {
    const now = Date.now();
    const elapsed = (now - this._lastReal) / 1000;
    this._lastReal = now;
    // 1. apply queued intents at the current boundary tick (arrival order = ledger order)
    const intents = this.pendingIntents.splice(0);
    for (const it of intents) {
      try {
        if (it.verb === 'pick') pick(this.kernel, it.session.playerId, it.target, this.kernel.tick);
        else if (it.verb === 'chop') chop(this.kernel, it.session.playerId, it.target, this.kernel.tick);
      } catch {
        // node died between snapshot and pump — drop the intent silently
      }
    }
    // 2. advance sim-time
    if (!this.paused && elapsed > 0) {
      this.kernel.runTo(this.kernel.tick + Math.max(1, Math.round(elapsed * this.timeScale)));
    }
    this._broadcastFrame();
  }

  _broadcastFrame() {
    // events: everything appended to the ledger since last frame
    const fresh = this.kernel.ledger.events.slice(this._eventCursor)
      .map(e => ({ id: e.id, tick: e.tick, type: e.type, actor: e.actor, targets: e.targets, magnitude: e.magnitude }));
    this._eventCursor = this.kernel.ledger.events.length;
    for (const s of this.sessions) {
      if (s.ws.readyState !== 1) continue;
      const entities = this._bubbleEntities(s.viewport);
      const curIds = new Set(entities.map(e => e.id));
      const removed = [...s.knownIds].filter(id => !curIds.has(id));
      s.knownIds = curIds;
      const player = this.kernel.materialized(s.playerId);
      s.ws.send(JSON.stringify(tickDeltaMsg(this.kernel.tick, entities, removed, { R: player?.R ?? 0 })));
      if (fresh.length) s.ws.send(JSON.stringify(eventsMsg(this.kernel.tick, fresh)));
      s.ws.send(JSON.stringify(timeMsg(this.kernel.tick)));
    }
  }
}
