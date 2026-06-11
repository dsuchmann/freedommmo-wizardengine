import Database from 'better-sqlite3';

const DDL = `
CREATE TABLE IF NOT EXISTS nodes(
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  born_tick INTEGER NOT NULL,
  x REAL, y REAL,
  R REAL, rate REAL, last_tick INTEGER,
  ver INTEGER NOT NULL DEFAULT 0,
  created_by_event INTEGER REFERENCES events(id),
  owner INTEGER REFERENCES nodes(id),
  attrs TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE TABLE IF NOT EXISTS edges(
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  born_tick INTEGER NOT NULL,
  owner INTEGER REFERENCES nodes(id),
  attrs TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS edge_members(
  edge_id INTEGER NOT NULL REFERENCES edges(id),
  node_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(edge_id, node_id, role)
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY,
  tick INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor INTEGER,
  magnitude REAL,
  cause_event_id INTEGER REFERENCES events(id),
  attrs TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_tick ON events(tick);
CREATE TABLE IF NOT EXISTS event_targets(
  event_id INTEGER NOT NULL REFERENCES events(id),
  node_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deltas(
  id INTEGER PRIMARY KEY,
  tick INTEGER NOT NULL,
  x REAL, y REAL,
  target TEXT NOT NULL,
  kind TEXT NOT NULL,
  attrs TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS sched(
  idx INTEGER PRIMARY KEY,
  tick INTEGER NOT NULL,
  node_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ver INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
`;

export function openDb(path) {
  const db = new Database(path);
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
  return db;
}

/** Stable string of all content — determinism is defined over this, not file bytes. */
export function canonicalDump(db) {
  const parts = [];
  const tables = [
    ['nodes', 'id'], ['edges', 'id'], ['edge_members', 'edge_id, node_id, role'],
    ['events', 'id'], ['event_targets', 'event_id, node_id'],
    ['deltas', 'id'], ['sched', 'idx'], ['meta', 'key'],
  ];
  for (const [t, order] of tables) {
    parts.push(`== ${t}`);
    for (const row of db.prepare(`SELECT * FROM ${t} ORDER BY ${order}`).all()) {
      parts.push(JSON.stringify(row));
    }
  }
  return parts.join('\n');
}
