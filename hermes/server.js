// Hermes — backend brain for the Bob task board.
// REST API + static Bob UI + Telegram bot + Google Calendar + OpenRouter.
import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  initDb, listTasks, getTask, createTask, updateTask, deleteTask, dueReminders,
} from './db.js';
import { parseTask } from './llm.js';
import {
  initCalendar, createEvent, updateEvent, deleteEvent, calendarEnabled,
} from './calendar.js';
import {
  initTelegram, processUpdate, send as tgSend, telegramEnabled,
} from './telegram.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const {
  PORT = 3000,
  API_KEY = '',
  OPENROUTER_API_KEY = '',
  OPENROUTER_MODEL = 'openai/gpt-4o-mini',
  TELEGRAM_BOT_TOKEN = '',
  TELEGRAM_CHAT_ID = '',
  TELEGRAM_MODE = 'polling',          // 'polling' (local) | 'webhook' (production)
  PUBLIC_URL = '',                    // e.g. https://hermes-xxxx.onrender.com
  GOOGLE_SERVICE_ACCOUNT_FILE = 'service-account.json',
  GOOGLE_SERVICE_ACCOUNT_JSON = '',   // production: full JSON pasted as one env var
  GOOGLE_CALENDAR_ID = '',
  TIMEZONE = 'Asia/Jakarta',
} = process.env;

// Render's PUBLIC_URL may come without a scheme (just the host). Normalize it.
function normalizePublicUrl(u) {
  if (!u) return '';
  const trimmed = u.replace(/\/$/, '');
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}
const PUBLIC_URL_FULL = normalizePublicUrl(PUBLIC_URL);

// Secret path segment for the Telegram webhook (keeps the endpoint hard to guess).
const WEBHOOK_PATH = `/telegram/${TELEGRAM_BOT_TOKEN.split(':')[0] || 'bot'}`;

// ---------- helpers ----------
function fmtDeadline(iso) {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

  await initTelegram(
    {
      token: TELEGRAM_BOT_TOKEN,
      chatId: TELEGRAM_CHAT_ID,
      formatDeadline: fmtDeadline,
      mode: TELEGRAM_MODE,
      webhookUrl: PUBLIC_URL_FULL ? PUBLIC_URL_FULL + WEBHOOK_PATH : '',
    },
    {
      addFromText: async (text) => {
        const parsed = await parseTask(text, {
          apiKey: OPENROUTER_API_KEY, model: OPENROUTER_MODEL, timezone: TIMEZONE,
        });
        return addTask({ ...parsed, source: 'telegram' });
      },
      listTasks: async () => listTasks(),
      completeByIndex: async (idx) => {
        const tasks = await listTasks();
        const t = tasks[idx];
        return t ? setDone(t.id, true) : null;
      },
      deleteByIndex: async (idx) => {
        const tasks = await listTasks();
        const t = tasks[idx];
        return t ? removeTask(t.id) : null;
      },
    },
  );

  const app = express();
  app.use(express.json());

  function requireKey(req, res, next) {
    if (!API_KEY) return next();
    if (req.get('x-api-key') !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
    next();
  }

  // Telegram webhook (production).
  app.post(WEBHOOK_PATH, (req, res) => {
    processUpdate(req.body);
    res.sendStatus(200);
  });

  // Serve the Bob UI.
  app.use(express.static(join(__dirname, '..')));
  app.get('/', (req, res) => res.sendFile(join(__dirname, '..', 'Bob.html')));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      calendar: calendarEnabled(),
      telegram: telegramEnabled(),
      llm: !!OPENROUTER_API_KEY,
      telegramMode: TELEGRAM_MODE,
    });
  });

  app.get('/api/tasks', requireKey, async (req, res) => {
    res.json(await listTasks());
  });

  app.post('/api/tasks', requireKey, async (req, res) => {
    const { title, tier, deadline, text } = req.body || {};

    if (text && !title) {
      const parsed = await parseTask(text, {
        apiKey: OPENROUTER_API_KEY, model: OPENROUTER_MODEL, timezone: TIMEZONE,
      });
      const task = await addTask({ ...parsed, source: 'web' });
      tgSend(`➕ Task baru dari web: *${task.title}*${task.deadline ? `\n⏱ ${fmtDeadline(task.deadline)}` : ''}`);
      return res.status(201).json(task);
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title (or text) is required' });
    }
    const task = await addTask({
      title: title.trim(), tier: tier || 'primary', deadline: deadline || null, source: 'web',
    });
    tgSend(`➕ Task baru dari web: *${task.title}*${task.deadline ? `\n⏱ ${fmtDeadline(task.deadline)}` : ''}`);
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

  // ---------- deadline reminder scheduler ----------
  let lastCheck = new Date();
  setInterval(async () => {
    const now = new Date();
    try {
      const due = await dueReminders(lastCheck.toISOString(), now.toISOString());
      for (const t of due) tgSend(`⏰ *Deadline!* ${t.title}\n_(${t.tier})_`);
    } catch (err) {
      console.error('[scheduler] error:', err.message);
    }
    lastCheck = now;
  }, 60 * 1000);

  app.listen(PORT, () => {
    console.log(`[hermes] listening on http://0.0.0.0:${PORT}`);
    console.log(`[hermes] calendar=${calendarEnabled()} telegram=${telegramEnabled()} llm=${!!OPENROUTER_API_KEY} mode=${TELEGRAM_MODE}`);
  });
}

main().catch((err) => {
  console.error('[hermes] fatal:', err);
  process.exit(1);
});
