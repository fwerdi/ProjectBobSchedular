// Google Calendar integration via a service account.
// The service account must be granted write access to the target calendar (see README).
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, isAbsolute } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let calendarClient = null;
let calendarId = null;
let timezone = 'Asia/Jakarta';
let enabled = false;

export function initCalendar({ serviceAccountFile, serviceAccountJson, calendarId: calId, timezone: tz }) {
  timezone = tz || timezone;
  calendarId = calId;

  if (!calId) {
    console.warn('[calendar] disabled: GOOGLE_CALENDAR_ID not set');
    return;
  }

  // Credentials can come from an env var (production/Render) or a file (local).
  let rawJson = null;
  if (serviceAccountJson && serviceAccountJson.trim()) {
    rawJson = serviceAccountJson;
  } else if (serviceAccountFile) {
    const keyPath = isAbsolute(serviceAccountFile)
      ? serviceAccountFile
      : join(__dirname, serviceAccountFile);
    if (existsSync(keyPath)) {
      rawJson = readFileSync(keyPath, 'utf8');
    } else {
      console.warn(`[calendar] disabled: service account file not found at ${keyPath}`);
      return;
    }
  } else {
    console.warn('[calendar] disabled: no service account JSON or file provided');
    return;
  }

  try {
    const credentials = JSON.parse(rawJson);
    const auth = new google.auth.JWT(
      credentials.client_email,
      undefined,
      credentials.private_key,
      ['https://www.googleapis.com/auth/calendar'],
    );
    calendarClient = google.calendar({ version: 'v3', auth });
    enabled = true;
    console.log('[calendar] enabled for', calId);
  } catch (err) {
    console.error('[calendar] init failed:', err.message);
  }
}

export function calendarEnabled() {
  return enabled;
}

// Create an event for a task with a deadline. Returns the event id, or null.
export async function createEvent(task) {
  if (!enabled || !task.deadline) return null;
  try {
    const start = new Date(task.deadline);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 1h block
    const res = await calendarClient.events.insert({
      calendarId,
      requestBody: {
        summary: task.title,
        description: `Bob task (${task.tier}) • id: ${task.id}`,
        start: { dateTime: start.toISOString(), timeZone: timezone },
        end: { dateTime: end.toISOString(), timeZone: timezone },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 30 },
            { method: 'popup', minutes: 0 },
          ],
        },
      },
    });
    return res.data.id;
  } catch (err) {
    console.error('[calendar] createEvent failed:', err.message);
    return null;
  }
}

export async function updateEvent(eventId, task) {
  if (!enabled || !eventId) return null;
  try {
    if (!task.deadline) {
      // Deadline removed -> delete the event.
      await deleteEvent(eventId);
      return null;
    }
    const start = new Date(task.deadline);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    await calendarClient.events.patch({
      calendarId,
      eventId,
      requestBody: {
        summary: task.title,
        start: { dateTime: start.toISOString(), timeZone: timezone },
        end: { dateTime: end.toISOString(), timeZone: timezone },
      },
    });
    return eventId;
  } catch (err) {
    console.error('[calendar] updateEvent failed:', err.message);
    return eventId;
  }
}

export async function deleteEvent(eventId) {
  if (!enabled || !eventId) return;
  try {
    await calendarClient.events.delete({ calendarId, eventId });
  } catch (err) {
    console.error('[calendar] deleteEvent failed:', err.message);
  }
}
