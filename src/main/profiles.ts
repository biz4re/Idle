import { DatabaseSync } from 'node:sqlite'

export class ProfileRegistry {
  private db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS selection (id INTEGER PRIMARY KEY CHECK (id = 1), profile_id TEXT NOT NULL);
      INSERT INTO profiles SELECT 'default', 'Default', 0 WHERE NOT EXISTS (SELECT 1 FROM profiles);
      INSERT OR IGNORE INTO selection SELECT 1, id FROM profiles ORDER BY position LIMIT 1;`)
  }
  list(): { id: string; name: string }[] {
    return this.db.prepare('SELECT id, name FROM profiles ORDER BY position').all().flatMap((row) => typeof row.id === 'string' && typeof row.name === 'string' && /^(default|[0-9a-f-]{36})$/.test(row.id) ? [{ id: row.id, name: row.name }] : [])
  }
  active(): string { const id = this.db.prepare('SELECT profile_id FROM selection WHERE id = 1').get()?.profile_id; const available = this.list(); return available.find((item) => item.id === id)?.id ?? available[0]?.id ?? 'default' }
  create(id: string, name: string): void { this.db.prepare('INSERT INTO profiles VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM profiles))').run(id, name) }
  rename(id: string, name: string): void { this.db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(name, id) }
  select(id: string): void { if (!this.list().some((item) => item.id === id)) throw new Error('Unknown Profile'); this.db.prepare('UPDATE selection SET profile_id = ? WHERE id = 1').run(id) }
  remove(id: string): void { if (id === this.active() || this.list().length < 2) throw new Error('Cannot delete the active or final Profile'); this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id) }
  sidebarWidth(): number { const value = this.db.prepare("SELECT value FROM settings WHERE key = 'sidebarWidth'").get()?.value; return typeof value === 'number' && Number.isInteger(value) && value >= 200 && value <= 400 ? value : 232 }
  setSidebarWidth(width: number): void { if (!Number.isInteger(width) || width < 200 || width > 400) throw new Error('Invalid sidebar width'); this.db.prepare("INSERT INTO settings VALUES ('sidebarWidth', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(width) }
  close(): void { this.db.close() }
}
