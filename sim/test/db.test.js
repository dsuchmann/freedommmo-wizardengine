import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, canonicalDump } from '../store/db.js';

test('openDb creates schema in WAL mode', () => {
  const db = openDb(':memory:');
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  for (const t of ['nodes','edges','edge_members','events','event_targets','deltas','meta']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  db.close();
});

test('canonicalDump is equal for identical content, differs for different content', () => {
  const a = openDb(':memory:'), b = openDb(':memory:');
  const ins = d => d.prepare(
    'INSERT INTO nodes(id,type,born_tick,x,y,R,rate,last_tick,created_by_event,owner,attrs) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  );
  ins(a).run(1,'grass',0,5,5,100,0.2,0,null,null,'{}');
  ins(b).run(1,'grass',0,5,5,100,0.2,0,null,null,'{}');
  assert.equal(canonicalDump(a), canonicalDump(b));
  ins(b).run(2,'grass',0,6,5,100,0.2,0,null,null,'{}');
  assert.notEqual(canonicalDump(a), canonicalDump(b));
  a.close(); b.close();
});
