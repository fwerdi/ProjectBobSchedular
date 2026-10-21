// Hermes — backend brain for the Bob task board.
// REST API + static Bob UI + Google Calendar sync.
import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  initDb, listTasks, getTask, createTask, updateTask, deleteTask,
} from './db.js';
import {
  initCalendar, createEvent, updateEvent, deleteEvent, calendarEnabled,
} from './calendar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const {
  PORT = 3000,
  API_KEY = '',
  GOOGLE_SERVICE_ACCOUNT_FILE = 'service-account.json',
  GOOGLE_SERVICE_ACCOUNT_JSON = '',
  GOOGLE_CALENDAR_ID = '',
  TIMEZONE = 'Asia/Jakarta',
} = process.env;

// ---------- helpers ----------
async function addTask({ title, tier, deadline, source }) {
  let task = await createTask({ title, tier, deadline, source });
  if (task.deadline && calendarEnabled()) {
    const eventId = await createEvent(task);
    if (eventId) task = await updateTask(task.id, { calendarEventId: eventId });
  }
  return task;
}

async function removeTask(id) {
  const task = await getTask(id);
  if (!task) return null;
  if (task.calendarEventId) await deleteEvent(task.calendarEventId);
  return deleteTask(id);
}

async function setDone(id, done) {
  const task = await getTask(id);
  if (!task) return null;
  const completedAt = done ? new Date().toDateString() : null;
  return updateTask(id, { done, completedAt });
}

async function main() {
  await initDb();

  initCalendar({
    serviceAccountFile: GOOGLE_SERVICE_ACCOUNT_FILE,
    serviceAccountJson: GOOGLE_SERVICE_ACCOUNT_JSON,
    calendarId: GOOGLE_CALENDAR_ID,
    timezone: TIMEZONE,
  });

  const app = express();
  app.use(express.json());

  // Allow the Vercel-hosted UI to call this backend from another origin.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  function requireKey(req, res, next) {
    if (!API_KEY) return next();
    if (req.get('x-api-key') !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
    next();
  }

  // Serve the Bob UI (index.html lives one directory up).
  app.use(express.static(join(__dirname, '..')));
  app.get('/', (req, res) => res.sendFile(join(__dirname, '..', 'index.html')));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      calendar: calendarEnabled(),
    });
  });

  app.get('/api/tasks', requireKey, async (req, res) => {
    res.json(await listTasks());
  });

  // Create a task from structured fields.
  app.post('/api/tasks', requireKey, async (req, res) => {
    const { title, tier, deadline } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const task = await addTask({
      title: title.trim(), tier: tier || 'primary', deadline: deadline || null, source: 'web',
    });
    res.status(201).json(task);
  });

  app.patch('/api/tasks/:id', requireKey, async (req, res) => {
    const { id } = req.params;
    const current = await getTask(id);
    if (!current) return res.status(404).json({ error: 'not found' });

    const patch = req.body || {};
    if (patch.done !== undefined) await setDone(id, patch.done);

    const fields = {};
    if (patch.title !== undefined) fields.title = patch.title;
    if (patch.tier !== undefined) fields.tier = patch.tier;
    if (patch.deadline !== undefined) fields.deadline = patch.deadline;
    if (Object.keys(fields).length) {
      let updated = await updateTask(id, fields);
      if (calendarEnabled()) {
        if (updated.calendarEventId) {
          await updateEvent(updated.calendarEventId, updated);
        } else if (updated.deadline) {
          const eventId = await createEvent(updated);
          if (eventId) updated = await updateTask(id, { calendarEventId: eventId });
        }
      }
    }
    res.json(await getTask(id));
  });

  app.delete('/api/tasks/:id', requireKey, async (req, res) => {
    const removed = await removeTask(req.params.id);
    if (!removed) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  app.listen(PORT, () => {
    console.log(`[hermes] listening on http://0.0.0.0:${PORT}`);
    console.log(`[hermes] calendar=${calendarEnabled()}`);
  });
}

main().catch((err) => {
  console.error('[hermes] fatal:', err);
  process.exit(1);
});
