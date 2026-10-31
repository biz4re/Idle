import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export class ProfileRegistry {
  private db: DatabaseSync
  constructor(path: string) {
    const fresh = path === ':memory:' || (!existsSync(path) && !existsSync(join(dirname(path), 'session.sqlite')))
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS selection (id INTEGER PRIMARY KEY CHECK (id = 1), profile_id TEXT NOT NULL);
      INSERT OR IGNORE INTO selection SELECT 1, id FROM profiles ORDER BY position LIMIT 1;`)
    if (!this.db.prepare('PRAGMA table_info(profiles)').all().some((row) => row.name === 'icon')) this.db.exec("ALTER TABLE profiles ADD COLUMN icon TEXT NOT NULL DEFAULT 'personal'; UPDATE profiles SET icon = 'work' WHERE lower(trim(name)) = 'work'")
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (!this.db.prepare('SELECT 1 FROM profiles LIMIT 1').get()) {
        this.db.prepare('INSERT INTO profiles (id, name, position, icon) VALUES (?, ?, ?, ?)').run('default', fresh ? 'Personal' : 'Default', 0, 'personal')
        if (fresh) this.db.prepare('INSERT INTO profiles (id, name, position, icon) VALUES (?, ?, ?, ?)').run(randomUUID(), 'Work', 1, 'work')
      }
      this.db.exec('INSERT OR IGNORE INTO selection SELECT 1, id FROM profiles ORDER BY position LIMIT 1; COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  list(): { id: string; name: string; icon: 'personal' | 'work' }[] {
    return this.db.prepare('SELECT id, name, icon FROM profiles ORDER BY position').all().flatMap((row) => typeof row.id === 'string' && typeof row.name === 'string' && /^(default|[0-9a-f-]{36})$/.test(row.id) ? [{ id: row.id, name: row.name, icon: row.icon === 'work' ? 'work' as const : 'personal' as const }] : [])
  }
  active(): string { const id = this.db.prepare('SELECT profile_id FROM selection WHERE id = 1').get()?.profile_id; const available = this.list(); return available.find((item) => item.id === id)?.id ?? available[0]?.id ?? 'default' }
  create(id: string, name: string): void { this.db.prepare('INSERT INTO profiles (id, name, position, icon) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM profiles), ?)').run(id, name, name.trim().toLowerCase() === 'work' ? 'work' : 'personal') }
  rename(id: string, name: string): void { this.db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(name, id) }
  select(id: string): void { if (!this.list().some((item) => item.id === id)) throw new Error('Unknown Profile'); this.db.prepare('UPDATE selection SET profile_id = ? WHERE id = 1').run(id) }
  remove(id: string): void { if (id === this.active() || this.list().length < 2) throw new Error('Cannot delete the active or final Profile'); this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id); this.db.prepare('DELETE FROM settings WHERE key = ?').run(`peekMode:${id}`) }
  sidebarWidth(): number { const value = this.db.prepare("SELECT value FROM settings WHERE key = 'sidebarWidth'").get()?.value; return typeof value === 'number' && Number.isInteger(value) && value >= 200 && value <= 400 ? value : 232 }
  setSidebarWidth(width: number): void { if (!Number.isInteger(width) || width < 200 || width > 400) throw new Error('Invalid sidebar width'); this.db.prepare("INSERT INTO settings VALUES ('sidebarWidth', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(width) }
  peekMode(id: string): 'automatic' | 'manual' { return this.db.prepare('SELECT value FROM settings WHERE key = ?').get(`peekMode:${id}`)?.value === 1 ? 'manual' : 'automatic' }
  setPeekMode(id: string, mode: 'automatic' | 'manual'): void { if (!this.list().some((profile) => profile.id === id)) throw new Error('Unknown Profile'); this.db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`peekMode:${id}`, mode === 'manual' ? 1 : 0) }
  close(): void { this.db.close() }
}
