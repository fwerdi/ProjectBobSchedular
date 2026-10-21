// Hermes — backend brain for the Bob task board.
// REST API + static Bob UI + Telegram bot + Google Calendar + OpenRouter.
import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  listTasks, getTask, createTask, updateTask, deleteTask, dueReminders,
} from './db.js';
import { parseTask } from './llm.js';
import {
  initCalendar, createEvent, updateEvent, deleteEvent, calendarEnabled,
} from './calendar.js';
import { initTelegram, send as tgSend, telegramEnabled } from './telegram.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const {
  PORT = 3000,
  API_KEY = '',
  OPENROUTER_API_KEY = '',
  OPENROUTER_MODEL = 'openai/gpt-4o-mini',
  TELEGRAM_BOT_TOKEN = '',
  TELEGRAM_CHAT_ID = '',
  GOOGLE_SERVICE_ACCOUNT_FILE = '',
  GOOGLE_CALENDAR_ID = '',
  TIMEZONE = 'Asia/Jakarta',
} = process.env;

// ---------- helpers ----------
function fmtDeadline(iso) {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Create a task everywhere: DB + Google Calendar. Shared by web + Telegram.
async function addTask({ title, tier, deadline, source }) {
  let task = createTask({ title, tier, deadline, source });
  if (task.deadline && calendarEnabled()) {
    const eventId = await createEvent(task);
    if (eventId) task = updateTask(task.id, { calendarEventId: eventId });
  }
  return task;
}

async function removeTask(id) {
  const task = getTask(id);
  if (!task) return null;
  if (task.calendarEventId) await deleteEvent(task.calendarEventId);
  return deleteTask(id);
}

async function setDone(id, done) {
  const task = getTask(id);
  if (!task) return null;
  const completedAt = done ? new Date().toDateString() : null;
  return updateTask(id, { done, completedAt });
}

// ---------- Telegram wiring ----------
initCalendar({
  serviceAccountFile: GOOGLE_SERVICE_ACCOUNT_FILE,
  calendarId: GOOGLE_CALENDAR_ID,
  timezone: TIMEZONE,
});

initTelegram(
  { token: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID, formatDeadline: fmtDeadline },
  {
    addFromText: async (text) => {
      const parsed = await parseTask(text, {
        apiKey: OPENROUTER_API_KEY,
        model: OPENROUTER_MODEL,
        timezone: TIMEZONE,
      });
      return addTask({ ...parsed, source: 'telegram' });
    },
    listTasks: () => listTasks(),
    completeByIndex: async (idx) => {
      const tasks = listTasks();
      const t = tasks[idx];
      if (!t) return null;
      return setDone(t.id, true);
    },
    deleteByIndex: async (idx) => {
      const tasks = listTasks();
      const t = tasks[idx];
      if (!t) return null;
      return removeTask(t.id);
    },
  },
);

// ---------- Express ----------
const app = express();
app.use(express.json());

// Simple API-key guard for /api routes.
function requireKey(req, res, next) {
  if (!API_KEY) return next(); // no key configured -> open (dev only)
  const key = req.get('x-api-key');
  if (key !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// Serve the Bob UI (one directory up from hermes/).
app.use(express.static(join(__dirname, '..')));
app.get('/', (req, res) => res.sendFile(join(__dirname, '..', 'Bob.html')));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    calendar: calendarEnabled(),
    telegram: telegramEnabled(),
    llm: !!OPENROUTER_API_KEY,
  });
});

app.get('/api/tasks', requireKey, (req, res) => {
  res.json(listTasks());
});

app.post('/api/tasks', requireKey, async (req, res) => {
  const { title, tier, deadline, text } = req.body || {};

  // If "text" is given, let the LLM parse it (free-text from web too).
  if (text && !title) {
    const parsed = await parseTask(text, {
      apiKey: OPENROUTER_API_KEY,
      model: OPENROUTER_MODEL,
      timezone: TIMEZONE,
    });
    const task = await addTask({ ...parsed, source: 'web' });
    tgSend(`➕ Task baru dari web: *${task.title}*${task.deadline ? `\n⏱ ${fmtDeadline(task.deadline)}` : ''}`);
    return res.status(201).json(task);
  }

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title (or text) is required' });
  }
  const task = await addTask({
    title: title.trim(),
    tier: tier || 'primary',
    deadline: deadline || null,
    source: 'web',
  });
  tgSend(`➕ Task baru dari web: *${task.title}*${task.deadline ? `\n⏱ ${fmtDeadline(task.deadline)}` : ''}`);
  res.status(201).json(task);
});

app.patch('/api/tasks/:id', requireKey, async (req, res) => {
  const { id } = req.params;
  const current = getTask(id);
  if (!current) return res.status(404).json({ error: 'not found' });

  const patch = req.body || {};
  // Handle done toggle (sets completedAt).
  if (patch.done !== undefined) {
    await setDone(id, patch.done);
  }
  // Handle other editable fields + keep calendar in sync.
  const fields = {};
  if (patch.title !== undefined) fields.title = patch.title;
  if (patch.tier !== undefined) fields.tier = patch.tier;
  if (patch.deadline !== undefined) fields.deadline = patch.deadline;
  if (Object.keys(fields).length) {
    let updated = updateTask(id, fields);
    if (calendarEnabled()) {
      if (updated.calendarEventId) {
        await updateEvent(updated.calendarEventId, updated);
      } else if (updated.deadline) {
        const eventId = await createEvent(updated);
        if (eventId) updated = updateTask(id, { calendarEventId: eventId });
      }
    }
  }
  res.json(getTask(id));
});

app.delete('/api/tasks/:id', requireKey, async (req, res) => {
  const removed = await removeTask(req.params.id);
  if (!removed) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// ---------- deadline reminder scheduler ----------
// Every minute, find tasks whose deadline just passed into the current window
// and ping Telegram. Uses a small persisted-in-memory cursor.
let lastCheck = new Date();
setInterval(() => {
  const now = new Date();
  const due = dueReminders(lastCheck.toISOString(), now.toISOString());
  for (const t of due) {
    tgSend(`⏰ *Deadline!* ${t.title}\n_(${t.tier})_`);
  }
  lastCheck = now;
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`[hermes] listening on http://0.0.0.0:${PORT}`);
  console.log(`[hermes] calendar=${calendarEnabled()} telegram=${telegramEnabled()} llm=${!!OPENROUTER_API_KEY}`);
});
