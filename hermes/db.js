// SQLite storage for tasks. Single source of truth shared by the web UI and Telegram.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'hermes.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    tier         TEXT NOT NULL DEFAULT 'primary',
    deadline     TEXT,            -- ISO 8601 or NULL
    done         INTEGER NOT NULL DEFAULT 0,
    completedAt  TEXT,            -- JS Date.toDateString() or NULL
    calendarEventId TEXT,         -- Google Calendar event id, if synced
    source       TEXT NOT NULL DEFAULT 'web',  -- 'web' | 'telegram'
    createdAt    TEXT NOT NULL
  );
`);

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    tier: row.tier,
    deadline: row.deadline,
    done: !!row.done,
    completedAt: row.completedAt,
    calendarEventId: row.calendarEventId,
    source: row.source,
    createdAt: row.createdAt,
  };
}

const stmts = {
  all: db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC'),
  get: db.prepare('SELECT * FROM tasks WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO tasks (id, title, tier, deadline, done, completedAt, calendarEventId, source, createdAt)
    VALUES (@id, @title, @tier, @deadline, @done, @completedAt, @calendarEventId, @source, @createdAt)
  `),
  update: db.prepare(`
    UPDATE tasks SET title=@title, tier=@tier, deadline=@deadline, done=@done,
      completedAt=@completedAt, calendarEventId=@calendarEventId WHERE id=@id
  `),
  del: db.prepare('DELETE FROM tasks WHERE id = ?'),
  dueReminders: db.prepare(`
    SELECT * FROM tasks
    WHERE done = 0 AND deadline IS NOT NULL
      AND deadline <= @until AND deadline > @from
  `),
};

export function listTasks() {
  return stmts.all.all().map(rowToTask);
}

export function getTask(id) {
  return rowToTask(stmts.get.get(id));
}

export function createTask(task) {
  const now = new Date().toISOString();
  const record = {
    id: task.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: task.title,
    tier: task.tier || 'primary',
    deadline: task.deadline || null,
    done: task.done ? 1 : 0,
    completedAt: task.completedAt || null,
    calendarEventId: task.calendarEventId || null,
    source: task.source || 'web',
    createdAt: now,
  };
  stmts.insert.run(record);
  return getTask(record.id);
}

export function updateTask(id, patch) {
  const current = stmts.get.get(id);
  if (!current) return null;
  const merged = {
    id,
    title: patch.title ?? current.title,
    tier: patch.tier ?? current.tier,
    deadline: patch.deadline !== undefined ? patch.deadline : current.deadline,
    done: patch.done !== undefined ? (patch.done ? 1 : 0) : current.done,
    completedAt: patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
    calendarEventId: patch.calendarEventId !== undefined ? patch.calendarEventId : current.calendarEventId,
  };
  stmts.update.run(merged);
  return getTask(id);
}

export function deleteTask(id) {
  const existing = getTask(id);
  stmts.del.run(id);
  return existing;
}

// Tasks whose deadline falls in (from, until], not done. Used by the reminder scheduler.
export function dueReminders(fromIso, untilIso) {
  return stmts.dueReminders.all({ from: fromIso, until: untilIso }).map(rowToTask);
}

export default db;
