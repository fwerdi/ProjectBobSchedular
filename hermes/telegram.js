// Telegram bot: two-way. Receives commands from chat and sends notifications.
import TelegramBot from 'node-telegram-bot-api';

let bot = null;
let allowedChatId = null;
let fmtDeadline = (iso) => iso;

// Handlers wired from server.js so the bot can touch the task store + calendar.
let handlers = {
  addFromText: async () => {},   // (text) => task
  listTasks: () => [],
  completeByIndex: async () => null, // (n) => task|null
  deleteByIndex: async () => null,   // (n) => task|null
};

export function initTelegram({ token, chatId, formatDeadline }, boundHandlers) {
  allowedChatId = chatId ? String(chatId) : null;
  if (formatDeadline) fmtDeadline = formatDeadline;
  if (boundHandlers) handlers = { ...handlers, ...boundHandlers };

  if (!token) {
    console.warn('[telegram] disabled: TELEGRAM_BOT_TOKEN not set');
    return;
  }

  bot = new TelegramBot(token, { polling: true });
  console.log('[telegram] polling started');

  bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    // Only respond to the owner.
    if (allowedChatId && chatId !== allowedChatId) {
      return;
    }
    const text = (msg.text || '').trim();
    if (!text) return;

    try {
      await handleMessage(chatId, text);
    } catch (err) {
      console.error('[telegram] handler error:', err.message);
      send(`⚠️ Error: ${err.message}`);
    }
  });

  bot.on('polling_error', (err) => {
    console.error('[telegram] polling_error:', err.message);
  });
}

function taskLine(t, idx) {
  const check = t.done ? '✅' : '⬜';
  const when = t.deadline ? ` ⏱ ${fmtDeadline(t.deadline)}` : '';
  return `${idx}. ${check} ${t.title}${when} _(${t.tier})_`;
}

async function handleMessage(chatId, text) {
  const lower = text.toLowerCase();

  // /start or /help
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
      '`/help` — bantuan ini'
    );
    return;
  }

  // /list
  if (lower === '/list') {
    const tasks = handlers.listTasks();
    if (!tasks.length) { send('Belum ada task. Tambah aja langsung ketik di sini.'); return; }
    const lines = tasks.map((t, i) => taskLine(t, i + 1));
    send('*Task kamu:*\n' + lines.join('\n'));
    return;
  }

  // /done <n>
  const doneMatch = lower.match(/^\/done\s+(\d+)/);
  if (doneMatch) {
    const t = await handlers.completeByIndex(parseInt(doneMatch[1], 10) - 1);
    send(t ? `✅ Selesai: *${t.title}*` : '❌ Nomor task tidak ditemukan. Cek `/list`.');
    return;
  }

  // /del <n>
  const delMatch = lower.match(/^\/del\s+(\d+)/);
  if (delMatch) {
    const t = await handlers.deleteByIndex(parseInt(delMatch[1], 10) - 1);
    send(t ? `🗑 Dihapus: *${t.title}*` : '❌ Nomor task tidak ditemukan. Cek `/list`.');
    return;
  }

  // Ignore other slash commands.
  if (text.startsWith('/')) {
    send('Perintah tidak dikenal. Ketik `/help`.');
    return;
  }

  // Free text -> create a task (parsed via LLM in server.js).
  const task = await handlers.addFromText(text);
  const when = task.deadline ? `\n⏱ ${fmtDeadline(task.deadline)}` : '';
  send(`➕ Task ditambah: *${task.title}*${when}\n_(${task.tier})_`);
}

// Send a Markdown message to the owner chat.
export function send(message) {
  if (!bot || !allowedChatId) return;
  bot.sendMessage(allowedChatId, message, { parse_mode: 'Markdown' }).catch((err) => {
    console.error('[telegram] send failed:', err.message);
  });
}

export function telegramEnabled() {
  return !!bot;
}
