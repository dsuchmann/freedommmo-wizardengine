import Database from 'better-sqlite3';

const db = new Database(':memory:');
try {
  db.exec(`
    CREATE TABLE test1(
      id INTEGER PRIMARY KEY,
      A INTEGER,
      a INTEGER
    );
  `);
  console.log("Test 1 passed: A and a are different");
} catch (e) {
  console.log("Test 1 failed:", e.message);
}

try {
  db.exec(`
    CREATE TABLE test2(
      id INTEGER PRIMARY KEY,
      R REAL,
      r REAL
    );
  `);
  console.log("Test 2 passed: R and r are different");
} catch (e) {
  console.log("Test 2 failed:", e.message);
}

db.close();
