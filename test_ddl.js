import Database from 'better-sqlite3';

const DDL = `
CREATE TABLE IF NOT EXISTS nodes(
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  born_tick INTEGER NOT NULL,
  x REAL, y REAL,
  R REAL, r REAL, last_tick INTEGER,
  created_by_event INTEGER REFERENCES events(id),
  owner INTEGER REFERENCES nodes(id),
  attrs TEXT NOT NULL DEFAULT '{}'
);
`;

const db = new Database(':memory:');
try {
  db.exec(DDL);
  console.log("DDL executed successfully");
} catch (e) {
  console.log("Error:", e.message);
  console.log("Code:", e.code);
}
db.close();
