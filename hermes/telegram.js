// Telegram bot: two-way. Receives commands from chat and sends notifications.
// Two modes:
//   - webhook (production, e.g. Render): Telegram POSTs updates to our URL.
//   - polling (local dev): the bot long-polls Telegram.
// Selected via TELEGRAM_MODE ('webhook' | 'polling'); defaults to polling.
import TelegramBot from 'node-telegram-bot-api';

let bot = null;
let allowedChatId = null;
let fmtDeadline = (iso) => iso;
let mode = 'polling';

let handlers = {
  addFromText: async () => {},
  listTasks: async () => [],
  completeByIndex: async () => null,
  deleteByIndex: async () => null,
};

export async function initTelegram(
  { token, chatId, formatDeadline, mode: m, webhookUrl },
  boundHandlers,
) {
  allowedChatId = chatId ? String(chatId) : null;
  if (formatDeadline) fmtDeadline = formatDeadline;
  if (boundHandlers) handlers = { ...handlers, ...boundHandlers };
  mode = m === 'webhook' ? 'webhook' : 'polling';

  if (!token) {
    console.warn('[telegram] disabled: TELEGRAM_BOT_TOKEN not set');
    return;
  }

  if (mode === 'webhook') {
    // No polling; server.js feeds updates via processUpdate().
    bot = new TelegramBot(token, { polling: false });
    if (webhookUrl) {
      try {
        await bot.setWebHook(webhookUrl);
        console.log('[telegram] webhook set to', webhookUrl);
      } catch (err) {
        console.error('[telegram] setWebHook failed:', err.message);
      }
    } else {
      console.warn('[telegram] webhook mode but no webhookUrl provided');
    }
  } else {
    bot = new TelegramBot(token, { polling: true });
    console.log('[telegram] polling started');
    bot.on('polling_error', (err) => console.error('[telegram] polling_error:', err.message));
  }

  bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    if (allowedChatId && chatId !== allowedChatId) return;
    const text = (msg.text || '').trim();
    if (!text) return;
    try {
      await handleMessage(text);
    } catch (err) {
      console.error('[telegram] handler error:', err.message);
      send(`⚠️ Error: ${err.message}`);
    }
  });
}

// Called by the webhook endpoint in server.js.
export function processUpdate(update) {
  if (bot) bot.processUpdate(update);
}

function taskLine(t, idx) {
  const check = t.done ? '✅' : '⬜';
  const when = t.deadline ? ` ⏱ ${fmtDeadline(t.deadline)}` : '';
  return `${idx}. ${check} ${t.title}${when} _(${t.tier})_`;
}

async function handleMessage(text) {
  const lower = text.toLowerCase();

  if (lower === '/start' || lower === '/help') {
    send(
      '*Bob — asisten task kamu* 🤖\n\n' +
      'Ketik tugas pakai bahasa bebas, contoh:\n' +
      '• _ingetin meeting besok jam 3 sore_\n' +
      '• _beli kopi_\n\n' +
      'Perintah:\n' +
      '`/list` — lihat semua task\n' +
      '`/done <nomor>` — tandai selesai\n' +
      '`/del <nomor>` — hapus task\n' +
      '`/help` — bantuan ini',
    );
    return;
  }

  if (lower === '/list') {
    const tasks = await handlers.listTasks();
    if (!tasks.length) { send('Belum ada task. Tambah aja langsung ketik di sini.'); return; }
    send('*Task kamu:*\n' + tasks.map((t, i) => taskLine(t, i + 1)).join('\n'));
    return;
  }

  const doneMatch = lower.match(/^\/done\s+(\d+)/);
  if (doneMatch) {
    const t = await handlers.completeByIndex(parseInt(doneMatch[1], 10) - 1);
    send(t ? `✅ Selesai: *${t.title}*` : '❌ Nomor task tidak ditemukan. Cek `/list`.');
    return;
  }

  const delMatch = lower.match(/^\/del\s+(\d+)/);
  if (delMatch) {
    const t = await handlers.deleteByIndex(parseInt(delMatch[1], 10) - 1);
    send(t ? `🗑 Dihapus: *${t.title}*` : '❌ Nomor task tidak ditemukan. Cek `/list`.');
    return;
  }

  if (text.startsWith('/')) {
    send('Perintah tidak dikenal. Ketik `/help`.');
    return;
  }

  const task = await handlers.addFromText(text);
  const when = task.deadline ? `\n⏱ ${fmtDeadline(task.deadline)}` : '';
  send(`➕ Task ditambah: *${task.title}*${when}\n_(${task.tier})_`);
}

export function send(message) {
  if (!bot || !allowedChatId) return;
  bot.sendMessage(allowedChatId, message, { parse_mode: 'Markdown' }).catch((err) => {
    console.error('[telegram] send failed:', err.message);
  });
}

export function telegramEnabled() {
  return !!bot;
}
