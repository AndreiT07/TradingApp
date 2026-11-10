import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path = process.env.DATA_PATH || '.local/tradingapp.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS snapshots (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_calls (id TEXT PRIMARY KEY, month TEXT NOT NULL, day TEXT NOT NULL,
        kind TEXT NOT NULL, company TEXT NOT NULL, cost INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS ai_month ON ai_calls(month);
      PRAGMA user_version=1;`);
  }
  get(key) {
    const row = this.db.prepare('SELECT value, updated FROM snapshots WHERE key=?').get(key);
    return row ? { data: JSON.parse(row.value), updatedAt: row.updated } : null;
  }
  put(key, data, now = new Date().toISOString()) {
    this.db.prepare('INSERT INTO snapshots VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated=excluded.updated').run(key, JSON.stringify(data), now);
  }
  reserve({ id, kind, company, cost, limit = 8_000_000, now = new Date().toISOString() }) {
    if (!Number.isSafeInteger(cost) || cost <= 0 || !Number.isSafeInteger(limit) || limit <= 0) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const day = now.slice(0, 10), month = now.slice(0, 7);
      const spent = this.db.prepare('SELECT COALESCE(SUM(cost),0) AS total FROM ai_calls WHERE month=?').get(month).total;
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM ai_calls WHERE day=? AND kind=? AND company=?').get(day, kind, company).n;
      if (spent + cost > Math.min(limit, 8_000_000) || count >= (kind === 'summary' ? 3 : 1) || this.db.prepare('SELECT 1 FROM ai_calls WHERE id=?').get(id)) {
        this.db.exec('ROLLBACK'); return false;
      }
      this.db.prepare('INSERT INTO ai_calls(id,month,day,kind,company,cost) VALUES(?,?,?,?,?,?)').run(id, month, day, kind, company, cost);
      this.db.exec('COMMIT'); return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  settle(id, cost) {
    if (!Number.isSafeInteger(cost) || cost < 0) return;
    this.db.prepare('UPDATE ai_calls SET cost=?, completed=1 WHERE id=?').run(cost, id);
  }
  close() { this.db.close(); }
}
