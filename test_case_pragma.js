import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.pragma('case_sensitive_like = ON');
try {
  db.exec(`
    CREATE TABLE test2(
      id INTEGER PRIMARY KEY,
      R REAL,
      r REAL
    );
  `);
  console.log("Success with case_sensitive_like");
} catch (e) {
  console.log("Failed with case_sensitive_like:", e.message);
}

db.close();
