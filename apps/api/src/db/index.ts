import Database from 'better-sqlite3';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;
const MIGRATIONS = fileURLToPath(new URL('./migrations/', import.meta.url));

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => (r as { version: number }).version));
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()) {
    const version = parseInt(f, 10);
    if (done.has(version)) continue;
    db.transaction(() => {
      db.exec(readFileSync(path.join(MIGRATIONS, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
    })();
  }
}

export const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
