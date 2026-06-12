// src/sim/sim-client.js — the renderer is a client of the sim process (CLAUDE.md locked decision 2).
// Environment-free: WebSocket comes in via factory so node:test can drive it with 'ws'.
//
// Protocol field names verified against sim/server/protocol.js + server.js:
//   snapshot  → { type, tick, playerId, entities, deltas }
//   tick-delta → { type, tick, upserts, removed, player, deltas }   (NOT 'entities' — 'upserts')
//   events    → { type, tick, events }
//   time      → { type, tick, day }
export class SimClient {
  constructor({ url, wsFactory = u => new WebSocket(u), viewport, onState = () => {}, onClose = () => {} }) {
    this.entities = new Map();      // id → serialized entity
    this.deltas = [];               // current delta list (placement:* targets included)
    this.tick = -1;
    this.playerId = null;
    this.events = [];               // most-recent events batch
    this.day = 0;                   // sim day (from 'time' messages)
    this.playerR = 0;               // player wallet R (from tick-delta)
    this.onState = onState;
    this.ready = new Promise((res, rej) => { this._readyRes = res; this._readyRej = rej; });
    this.ws = wsFactory(url);
    this.ws.onopen = () => this._send({ type: 'hello', viewport });
    this.ws.onmessage = m => {
      let msg;
      try { msg = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString()); }
      catch { return; } // ignore unparseable frames
      this._onMsg(msg);
    };
    this.ws.onerror = e => this._readyRej?.(e);
    this.ws.onclose = () => {
      this._readyRej?.(new Error('closed before snapshot'));
      this.closed = true;
      onClose(this);            // mid-session disconnect: let the host degrade to baseline
    };
    this.closed = false;
  }

  _send(msg) { this.ws.send(JSON.stringify(msg)); }

  intend({ verb, target }) { this._send({ type: 'intent', verb, target }); }

  setViewport(v) { this._send({ type: 'viewport', viewport: v }); }

  close() { this.ws.close(); }

  _onMsg(msg) {
    if (msg.type === 'snapshot') {
      this.tick = msg.tick;
      this.playerId = msg.playerId;
      this.entities = new Map(msg.entities.map(e => [e.id, e]));
      this.deltas = msg.deltas ?? [];
      this._readyRes?.();
      this._readyRes = null;
      this._readyRej = null;
    } else if (msg.type === 'tick-delta') {
      // NOTE: tick-delta uses 'upserts' (not 'entities') — verified in protocol.js tickDeltaMsg
      this.tick = msg.tick;
      for (const e of msg.upserts ?? []) this.entities.set(e.id, e);
      for (const id of msg.removed ?? []) this.entities.delete(id);
      this.deltas = msg.deltas ?? this.deltas;
      this.playerR = msg.player?.R ?? this.playerR;
    } else if (msg.type === 'events') {
      this.events = msg.events ?? [];
    } else if (msg.type === 'time') {
      this.tick = msg.tick;
      this.day = msg.day;
    }
    // unknown message types are silently ignored (future-proofing)
    this.onState(this);
  }
}
