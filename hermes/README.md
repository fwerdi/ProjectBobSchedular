# Hermes — otak backend untuk Bob

Backend Node.js yang:
- Nyimpen task di SQLite (`hermes.db`)
- Nyajikan UI Bob (`Bob.html`) + REST API
- Bot Telegram dua arah (bikin/lihat/selesaikan task dari chat)
- Nulis task yang punya deadline ke Google Calendar
- Pakai OpenRouter buat ngubah teks bebas jadi task terstruktur

```
Bob.html (web)  ──POST /api/tasks──▶  Hermes (Node.js)
                                         ├─ SQLite (hermes.db)
chat Telegram  ◀──polling bot────────▶  ├─ OpenRouter (parse teks bebas)
                                         ├─ Telegram (notif + perintah)
HP (app Google Calendar) ◀──────────────┴─ Google Calendar (event)
```

---

## 1. Konfigurasi

Copy `.env.example` jadi `.env`, lalu isi:

| Variabel | Isi |
|---|---|
| `PORT` | Port HTTP, default `3000` |
| `API_KEY` | String rahasia bebas. Harus sama dengan `HERMES.apiKey` di `Bob.html` |
| `OPENROUTER_API_KEY` | API key OpenRouter |
| `OPENROUTER_MODEL` | Model, default `openai/gpt-4o-mini` |
| `TELEGRAM_BOT_TOKEN` | Token dari @BotFather |
| `TELEGRAM_CHAT_ID` | Chat id kamu |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Nama file JSON service account |
| `GOOGLE_CALENDAR_ID` | Email kalender target |
| `TIMEZONE` | `Asia/Jakarta` |

> **Penting:** jangan commit `.env` dan `service-account.json`. Keduanya sudah ada di `.gitignore`.

---

## 2. Setup Google Calendar (service account)

1. Buka https://console.cloud.google.com → bikin / pilih project.
2. **APIs & Services → Library** → cari **Google Calendar API** → **Enable**.
3. **APIs & Services → Credentials → Create Credentials → Service account**.
   - Kasih nama bebas, misal `bob-calendar`. Selesaikan sampai jadi.
4. Klik service account itu → tab **Keys → Add key → Create new key → JSON**.
   - File JSON ter-download. Taruh di folder `hermes/` dan namain `service-account.json`.
5. Buka file JSON itu, copy nilai `client_email` (bentuknya `...@...iam.gserviceaccount.com`).
6. Buka **Google Calendar** di browser (pakai akun yang mau dipakai):
   - Settings kalender yang mau dipakai → **Share with specific people** → tambahkan `client_email` tadi → beri izin **"Make changes to events"**.
7. Masih di settings kalender, cari **Calendar ID** (buat kalender utama = alamat gmail-mu). Isi ke `GOOGLE_CALENDAR_ID` di `.env`.

Cek berhasil: `GET /api/health` harus `"calendar": true`.

---

## 3. Jalanin lokal (buat tes)

```powershell
npm install
npm start
```

Buka http://localhost:3000 → itu Bob yang sudah tersambung backend.

---

## 4b. Deploy GRATIS: Hermes di Render + Bob di Vercel

Arsitektur: **Vercel** nyajikan `Bob.html` (web), **Render** jalanin Hermes (otak + DB + bot) 24/7.

### A. Deploy Hermes ke Render

1. Buka https://render.com → **Sign up with GitHub**.
2. **New → Blueprint** → pilih repo `ProjectBobSchedular`.
   Render baca `render.yaml` dan bikin: web service `hermes` + database `hermes-db`.
3. Saat diminta, isi **environment variables rahasia** (yang `sync: false`):
   | Var | Isi |
   |---|---|
   | `API_KEY` | string acak panjang (catat, dipakai di Vercel) |
   | `OPENROUTER_API_KEY` | key OpenRouter (yang baru) |
   | `TELEGRAM_BOT_TOKEN` | token bot (yang baru) |
   | `TELEGRAM_CHAT_ID` | `5845416639` (chat id kamu) |
   | `GOOGLE_CALENDAR_ID` | `fsarkozy07@gmail.com` |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | **seluruh isi** file `service-account.json`, ditempel jadi satu (lihat di bawah) |
4. Klik **Apply**. Tunggu build selesai. Render kasih URL, misal `https://hermes-xxxx.onrender.com`.
5. Cek: buka `https://hermes-xxxx.onrender.com/api/health` → semua `true`.
   Webhook Telegram di-set otomatis saat start (mode `webhook`).

**Cara dapat `GOOGLE_SERVICE_ACCOUNT_JSON`:** buka file `service-account.json`, copy SELURUH isinya (dari `{` sampai `}`), tempel sebagai value env var. Render menerima multi-line, jadi tempel apa adanya.

### B. Deploy Bob.html ke Vercel

1. Edit `Bob.html` bagian `HERMES`:
   ```js
   const HERMES = {
     base: 'https://hermes-xxxx.onrender.com', // URL Render kamu
     apiKey: 'sama-dengan-API_KEY-di-Render',
   };
   ```
   Commit & push perubahan ini.
2. Buka https://vercel.com → **Sign up with GitHub**.
3. **Add New → Project** → pilih repo `ProjectBobSchedular`.
4. **Root Directory**: biarkan root. Framework preset: **Other**. Deploy.
5. Vercel kasih URL, misal `https://project-bob-schedular.vercel.app`.
   Buka dari HP → itu Bob kamu, online 24/7.

> Catatan free tier Render: service "tidur" setelah 15 menit idle. Karena pakai
> **webhook**, pesan Telegram tetap membangunkan service. Request pertama setelah
> tidur agak lambat (~30 detik) — itu normal di tier gratis.

---

## 4c. Deploy ke Oracle Cloud (Ubuntu/Linux)

SSH ke server Oracle-mu, lalu:

```bash
# 1. install Node.js 20 (kalau belum ada)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. upload project. Dari laptop (PowerShell), contoh pakai scp:
#    scp -r "d:\Solo Project\Project Bob" ubuntu@<IP_ORACLE>:~/bob

# 3. di server:
cd ~/bob/hermes
npm install --omit=dev
cp .env.example .env
nano .env          # isi semua nilai; taruh service-account.json di folder ini

# 4. tes jalan
node server.js     # Ctrl+C kalau sudah OK
```

### Jadikan service permanen (systemd)

```bash
sudo tee /etc/systemd/system/hermes.service >/dev/null <<'EOF'
[Unit]
Description=Hermes (Bob backend)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/bob/hermes
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now hermes
sudo systemctl status hermes      # cek jalan
journalctl -u hermes -f           # lihat log
```

### Buka port di firewall

Oracle Cloud punya **dua** lapis firewall:

1. **Security List / NSG** (di console Oracle): tambahkan Ingress Rule untuk TCP port `3000` (atau 80/443 kalau pakai reverse proxy).
2. **Firewall OS** (Ubuntu pakai iptables bawaan Oracle):
   ```bash
   sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
   sudo netfilter-persistent save
   ```

Akses dari HP: `http://<IP_ORACLE>:3000`.

> Untuk produksi sebaiknya pasang reverse proxy (Nginx) + HTTPS (Let's Encrypt) di depan port 3000. Bisa dibantu nyusul.

---

## 5. Sambungkan Bob.html ke server

Kalau Bob dibuka lewat Hermes (`http://<IP_ORACLE>:3000`), biarin `HERMES.base = ''` (same origin).

Kalau Bob dibuka dari file lokal tapi backend di Oracle, edit bagian atas `<script>` di `Bob.html`:

```js
const HERMES = {
  base: 'http://<IP_ORACLE>:3000',
  apiKey: 'nilai-sama-dengan-API_KEY-di-.env',
};
```

---

## REST API

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/health` | Status (calendar/telegram/llm) |
| GET | `/api/tasks` | Daftar task |
| POST | `/api/tasks` | Bikin task. Body `{title,tier,deadline}` **atau** `{text}` (diparse LLM) |
| PATCH | `/api/tasks/:id` | Update (`{done}`, `{title}`, `{tier}`, `{deadline}`) |
| DELETE | `/api/tasks/:id` | Hapus task |

Semua `/api/*` butuh header `x-api-key` kalau `API_KEY` diisi.

## Perintah Telegram

- ketik bebas → bikin task (diparse LLM)
- `/list` — lihat semua task
- `/done <nomor>` — tandai selesai
- `/del <nomor>` — hapus
- `/help` — bantuan
