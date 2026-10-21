// Dual-backend task store.
//  - If DATABASE_URL is set (e.g. on Render) -> PostgreSQL (persistent).
//  - Otherwise -> local SQLite file (good for `Start Bob.bat` on your laptop).
// The public API is async so both backends share the same interface.
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const usePg = !!process.env.DATABASE_URL;

let backend; // set by init

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalize(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    tier: row.tier,
    deadline: row.deadline || null,
    done: !!row.done,
    completedAt: row.completedat ?? row.completedAt ?? null,
    calendarEventId: row.calendareventid ?? row.calendarEventId ?? null,
    source: row.source,
    createdAt: row.createdat ?? row.createdAt,
  };
}

// ---------- PostgreSQL backend ----------
async function initPg() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'primary',
      deadline TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      completedAt TEXT,
      calendarEventId TEXT,
      source TEXT NOT NULL DEFAULT 'web',
      createdAt TEXT NOT NULL
    );
  `);

  return {
    async all() {
      const r = await pool.query('SELECT * FROM tasks ORDER BY createdAt DESC');
      return r.rows.map(normalize);
    },
    async get(id) {
      const r = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
      return normalize(r.rows[0]);
    },
    async insert(t) {
      await pool.query(
        `INSERT INTO tasks (id,title,tier,deadline,done,completedAt,calendarEventId,source,createdAt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [t.id, t.title, t.tier, t.deadline, t.done, t.completedAt, t.calendarEventId, t.source, t.createdAt],
      );
      return this.get(t.id);
    },
    async update(t) {
      await pool.query(
        `UPDATE tasks SET title=$2,tier=$3,deadline=$4,done=$5,completedAt=$6,calendarEventId=$7 WHERE id=$1`,
        [t.id, t.title, t.tier, t.deadline, t.done, t.completedAt, t.calendarEventId],
      );
      return this.get(t.id);
    },
    async del(id) {
      await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    },
    async due(fromIso, untilIso) {
      const r = await pool.query(
        `SELECT * FROM tasks WHERE done = 0 AND deadline IS NOT NULL
         AND deadline <= $1 AND deadline > $2`,
        [untilIso, fromIso],
      );
      return r.rows.map(normalize);
    },
  };
}

// ---------- SQLite backend ----------
async function initSqlite() {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(join(__dirname, 'hermes.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'primary',
      deadline TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      completedAt TEXT,
      calendarEventId TEXT,
      source TEXT NOT NULL DEFAULT 'web',
      createdAt TEXT NOT NULL
    );
  `);
  const s = {
    all: db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC'),
    get: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    insert: db.prepare(`INSERT INTO tasks (id,title,tier,deadline,done,completedAt,calendarEventId,source,createdAt)
      VALUES (@id,@title,@tier,@deadline,@done,@completedAt,@calendarEventId,@source,@createdAt)`),
    update: db.prepare(`UPDATE tasks SET title=@title,tier=@tier,deadline=@deadline,done=@done,
      completedAt=@completedAt,calendarEventId=@calendarEventId WHERE id=@id`),
    del: db.prepare('DELETE FROM tasks WHERE id = ?'),
    due: db.prepare(`SELECT * FROM tasks WHERE done = 0 AND deadline IS NOT NULL
      AND deadline <= @until AND deadline > @from`),
  };
  return {
    async all() { return s.all.all().map(normalize); },
    async get(id) { return normalize(s.get.get(id)); },
    async insert(t) { s.insert.run(t); return this.get(t.id); },
    async update(t) { s.update.run(t); return this.get(t.id); },
    async del(id) { s.del.run(id); },
    async due(fromIso, untilIso) { return s.due.all({ from: fromIso, until: untilIso }).map(normalize); },
  };
}

export async function initDb() {
  backend = usePg ? await initPg() : await initSqlite();
  console.log(`[db] using ${usePg ? 'PostgreSQL' : 'SQLite'}`);
  return backend;
}

export async function listTasks() {
  return backend.all();
}

export async function getTask(id) {
  return backend.get(id);
}

export async function createTask(task) {
  const record = {
    id: task.id || newId(),
    title: task.title,
    tier: task.tier || 'primary',
    deadline: task.deadline || null,
    done: task.done ? 1 : 0,
    completedAt: task.completedAt || null,
    calendarEventId: task.calendarEventId || null,
    source: task.source || 'web',
    createdAt: new Date().toISOString(),
  };
  return backend.insert(record);
}

export async function updateTask(id, patch) {
  const current = await backend.get(id);
  if (!current) return null;
  const merged = {
    id,
    title: patch.title ?? current.title,
    tier: patch.tier ?? current.tier,
    deadline: patch.deadline !== undefined ? patch.deadline : current.deadline,
    done: patch.done !== undefined ? (patch.done ? 1 : 0) : (current.done ? 1 : 0),
    completedAt: patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
    calendarEventId: patch.calendarEventId !== undefined ? patch.calendarEventId : current.calendarEventId,
  };
  return backend.update(merged);
}

export async function deleteTask(id) {
  const existing = await backend.get(id);
  await backend.del(id);
  return existing;
}

export async function dueReminders(fromIso, untilIso) {
  return backend.due(fromIso, untilIso);
}
