import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path = process.env.DATA_PATH || '.local/tradingapp.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS snapshots (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  get(key) {
    const row = this.db.prepare('SELECT value, updated FROM snapshots WHERE key=?').get(key);
    return row ? { data: JSON.parse(row.value), updatedAt: row.updated } : null;
  }
  put(key, data, now = new Date().toISOString()) {
    this.db.prepare('INSERT INTO snapshots VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated=excluded.updated').run(key, JSON.stringify(data), now);
  }
  close() { this.db.close(); }
}
