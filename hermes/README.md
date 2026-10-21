# Hermes — otak backend untuk Bob

Backend Node.js yang:
- Nyimpen task di SQLite (`hermes.db`) — atau PostgreSQL kalau `DATABASE_URL` diisi
- Nyajikan UI Bob (`index.html`) + REST API
- Nulis task yang punya deadline ke Google Calendar (sinkron ke HP)

```
HP / laptop  ──▶  Web Bob  ──POST /api/tasks──▶  Hermes (Node.js)
                                                   ├─ SQLite (hermes.db)
HP (app Google Calendar) ◀─────────────────────── └─ Google Calendar (event)
```

Tidak ada Telegram, tidak ada LLM. Fokus: task board + sinkron Google Calendar.

---

## 1. Konfigurasi

Copy `.env.example` jadi `.env`, lalu isi:

| Variabel | Isi |
|---|---|
| `PORT` | Port HTTP, default `3000` |
| `API_KEY` | String rahasia bebas. Harus sama dengan `HERMES.apiKey` di `index.html` |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Nama file JSON service account (lokal) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Alternatif: tempel seluruh isi JSON (buat cloud) |
| `GOOGLE_CALENDAR_ID` | Email kalender target (gmail kamu) |
| `TIMEZONE` | `Asia/Jakarta` |
| `DATABASE_URL` | Kosongkan untuk SQLite. Isi kalau pakai Postgres. |

> Jangan commit `.env` dan `service-account.json`. Keduanya sudah di `.gitignore`.

---

## 2. Setup Google Calendar (service account)

(Sudah dilakukan — service account `bob-calendar@bobschedule.iam.gserviceaccount.com`
sudah di-share ke kalender dengan izin "Make changes to events".)

Kalau perlu ulang:
1. https://console.cloud.google.com → project → enable **Google Calendar API**
2. Bikin **Service Account** → **Keys → Add key → JSON** → simpan sebagai `hermes/service-account.json`
3. Copy `client_email` dari JSON → share kalender Google ke email itu, izin **"Make changes to events"**
4. Calendar ID = alamat gmail kamu → isi `GOOGLE_CALENDAR_ID`

Cek berhasil: `GET /api/health` → `"calendar": true`.

---

## 3. Jalanin lokal

Paling gampang: double-click **`Start Bob.bat`** di folder project.
Atau manual:

```powershell
npm install
npm start
```

Buka http://localhost:3000 → Bob yang tersambung backend.

---

## 4. Akses dari HP

### Opsi A — HP & laptop satu WiFi
1. Cari IP lokal laptop: `ipconfig` → cari "IPv4 Address" (misal `192.168.1.5`)
2. Pastikan firewall Windows izinkan port 3000 (lihat bawah)
3. Di HP buka `http://192.168.1.5:3000`

Izinkan port di firewall Windows (jalankan PowerShell as admin, sekali saja):
```powershell
New-NetFirewallRule -DisplayName "Bob Hermes" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

### Opsi B — Akses dari mana saja (web di Vercel + tunnel)
Web statis di Vercel, backend di laptop lewat Cloudflare Tunnel (gratis, tanpa kartu).
Lihat panduan terpisah saat setup tunnel.

---

## REST API

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/health` | Status (`calendar`) |
| GET | `/api/tasks` | Daftar task |
| POST | `/api/tasks` | Bikin task `{title,tier,deadline}` |
| PATCH | `/api/tasks/:id` | Update (`{done}`, `{title}`, `{tier}`, `{deadline}`) |
| DELETE | `/api/tasks/:id` | Hapus task (event calendar ikut terhapus) |

Semua `/api/*` butuh header `x-api-key` kalau `API_KEY` diisi.
