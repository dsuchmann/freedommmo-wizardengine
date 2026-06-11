import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

test('node:test runs and better-sqlite3 loads', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t(x)');
  db.prepare('INSERT INTO t VALUES (?)').run(42);
  assert.equal(db.prepare('SELECT x FROM t').get().x, 42);
  db.close();
});
