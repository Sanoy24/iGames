# iGames — cPanel Deployment Guide

> Stack: **NestJS backend** (Node.js 20+) · **React/Vite frontend** (static) · **MySQL** (cPanel) · **Redis** (required for Socket.IO and draw locks)

---

## Prerequisites Checklist

Before you start, confirm your cPanel account has:

| Requirement | Where to check |
|---|---|
| Node.js 20+ | cPanel → **Setup Node.js App** |
| MySQL 8.0+ | cPanel → **MySQL Databases** |
| Redis | Softaculous → search "Redis", or contact your host |
| SSH / Terminal access | cPanel → **Terminal** or ask host |
| At least 512 MB RAM | Ask your host |

> [!IMPORTANT]
> Redis is **required** — it is used for distributed draw locks and Socket.IO horizontal scaling. Without it the app **will not start**. If your host does not offer Redis, ask them to enable it or use a managed Redis service (e.g., Redis Cloud free tier).

---

## Part 1 — MySQL Database Setup

1. In cPanel, go to **MySQL Databases**.
2. Create a new database — e.g. `cpanelusername_igames`.
3. Create a database user — e.g. `cpanelusername_dbuser` — with a strong password.
4. **Add the user to the database** and grant **All Privileges**.
5. Note down:
   - Host: `localhost` (always localhost on cPanel shared hosting)
   - Port: `3306`
   - Database name: `cpanelusername_igames`
   - Username: `cpanelusername_dbuser`
   - Password: (what you set)

> [!NOTE]
> TypeORM is configured with `synchronize: true`, so all tables will be created automatically on first boot. You do **not** need to run any SQL migration scripts manually.

---

## Part 2 — Redis Setup

**Option A — Softaculous Redis (if available)**
1. cPanel → **Softaculous Apps Installer** → search Redis → Install.
2. Note the socket path or port (usually `127.0.0.1:6379`).

**Option B — Managed Redis (recommended for reliability)**
1. Create a free database at [Redis Cloud](https://redis.io/try-free/) or [Upstash](https://upstash.com/).
2. Copy the `redis://:<password>@<host>:<port>` connection URL.
3. Use this as your `REDIS_URL` in the `.env` file below.

---

## Part 3 — Backend Deployment

### 3.1 Build Locally

On your **local machine** (Windows):

```powershell
# In the project root
npm install
npm run build         # produces dist/

# In the frontend directory
cd frontend
npm install
npm run build         # produces frontend/dist/
```

### 3.2 Files to Upload

Create a deployment archive. You need to upload:

```
igames-backend/           ← create this folder on the server
├── dist/                 ← compiled NestJS output (the entire folder)
├── node_modules/         ← upload OR run npm ci on server (preferred)
├── package.json
├── package-lock.json
├── .env                  ← create this on the server (never commit it)
└── logs/                 ← create this empty folder (for error/combined logs)
```

> [!TIP]
> **Preferred approach**: Upload only `dist/`, `package.json`, `package-lock.json`, then run `npm ci --omit=dev` via SSH on the server. This avoids uploading 300 MB+ of node_modules.

**Via cPanel File Manager:**
1. Go to cPanel → **File Manager**.
2. Navigate to your home directory (`/home/yourusername/`).
3. Create a folder called `igames-backend` (outside `public_html`).
4. Upload the files above into it.

**Via SSH (faster):**
```bash
# From your local machine
scp -r dist/ package.json package-lock.json yourusername@yourhost.com:~/igames-backend/
```

Then on the server via SSH:
```bash
cd ~/igames-backend
npm ci --omit=dev      # install production deps only
mkdir -p logs          # create log directory
```

### 3.3 Create the `.env` File

On the server, create `~/igames-backend/.env`:

```bash
nano ~/igames-backend/.env
```

Paste and fill in your values:

```env
NODE_ENV=production
PORT=3000

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=cpanelusername_dbuser
DB_PASSWORD=your_strong_db_password
DB_DATABASE=cpanelusername_igames

# Redis
REDIS_URL=redis://127.0.0.1:6379

# JWT — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_ACCESS_SECRET=<64-char-hex-string>
JWT_REFRESH_SECRET=<different-64-char-hex-string>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d

# Telegram Bot & Webhook
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_AUTH_MAX_AGE_SECONDS=86400
TELEGRAM_MINIAPP_URL=https://yourdomain.com
# Setting this switches the bot from long polling to webhook mode:
TELEGRAM_WEBHOOK_URL=https://api.yourdomain.com/telegram/webhook

# Auth mode
AUTH_MODE=hybrid

# Telebirr
TELEBIRR_EXPECTED_RECEIVER_NAME=Your Business Name
TELEBIRR_EXPECTED_RECEIVER_ACCOUNT=0912345678
TELEBIRR_CREDIT_MINOR_PER_BIRR=100

# CORS — must match your frontend URL exactly
ALLOWED_ORIGIN=https://yourdomain.com

# Rate limiting
THROTTLE_TTL_SECONDS=60
THROTTLE_MAX_REQUESTS=120

# Sentry (optional)
SENTRY_DSN=
```

### 3.4 Set Up Node.js App in cPanel

1. In cPanel, go to **Setup Node.js App**.
2. Click **Create Application**.

| Field | Value |
|---|---|
| Node.js version | `20.x` (or latest LTS) |
| Application mode | `Production` |
| Application root | `igames-backend` |
| Application URL | Choose a subdomain e.g. `api.yourdomain.com` |
| Application startup file | `dist/main.js` |

3. Click **Create**.
4. cPanel will generate a virtual environment. Click **Run NPM Install** if you haven't installed deps via SSH.
5. Click **Restart** to start the app.

> [!NOTE]
> cPanel uses **Phusion Passenger** under the hood to run Node.js apps. The app will run as a persistent process and restart automatically.

### 3.5 Verify Backend is Running

```bash
# Via SSH
curl http://localhost:3000/health
# Should return: {"status":"ok", ...}
```

Or visit `https://api.yourdomain.com/health` in your browser.

---

## Part 4 — Frontend Deployment

The frontend is a **static Vite build** — just HTML, JS, and CSS files served by Apache.

### 4.1 Configure the API URL Before Building

Before building locally, set the backend API URL. Create or update `frontend/.env.production`:

```env
VITE_API_URL=https://api.yourdomain.com
```

> [!IMPORTANT]
> If your backend and frontend share the same domain (e.g., frontend at `yourdomain.com`, API at `yourdomain.com/api`), you'll need to configure an Apache proxy (see Part 5). In that case, set `VITE_API_URL=https://yourdomain.com/api`.

### 4.2 Build the Frontend

```powershell
cd frontend
npm run build
# Output is in frontend/dist/
```

### 4.3 Upload to public_html

1. In cPanel → **File Manager**, navigate to your frontend document root folder (e.g., `/public_html` or `/play.yourdomain.com`).
2. Upload **all contents** of `frontend/dist/` into that folder.
3. Make sure `index.html` is at the root of that folder.

### 4.4 Configure Apache for React Router (SPA)

The app uses client-side routing (React Router). Create or update `.htaccess` in your frontend folder:

```apache
Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ /index.html [QSA,L]
```

This ensures that deep links (e.g. `/keno`, `/admin`) load the React app instead of returning a 404.

---

## Part 5 — Reverse Proxy for the API (Optional but Recommended)

By default, cPanel exposes your Node.js app on its own subdomain (e.g., `api.yourdomain.com`). If you prefer to serve everything from one domain (e.g., `yourdomain.com/api`), configure a proxy in `.htaccess`:

```apache
# In public_html/.htaccess — add BEFORE the SPA rewrite rules

RewriteEngine On

# Proxy /api/* → Node.js backend
RewriteCond %{REQUEST_URI} ^/api/(.*)$
RewriteRule ^api/(.*)$ http://localhost:3000/$1 [P,L]

# Proxy Socket.IO
RewriteCond %{REQUEST_URI} ^/socket.io/(.*)$
RewriteRule ^socket.io/(.*)$ http://localhost:3000/socket.io/$1 [P,L]

# SPA fallback (keep at bottom)
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ /index.html [QSA,L]
```

> [!WARNING]
> The `mod_proxy` Apache module must be enabled on your cPanel server for this to work. Ask your host to confirm. If it's not available, use a separate subdomain for the API (`api.yourdomain.com`) instead.

---

## Part 6 — SSL / HTTPS

1. In cPanel → **SSL/TLS** → **Let's Encrypt SSL** (or **AutoSSL**).
2. Issue certificates for:
   - `yourdomain.com` (frontend)
   - `api.yourdomain.com` (backend subdomain, if used)
3. Force HTTPS via cPanel → **Redirects** or add to `.htaccess`:

```apache
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

> [!IMPORTANT]
> The Telegram Mini App **requires HTTPS**. The app will not work over plain HTTP.

---

## Part 7 — Socket.IO Considerations

Socket.IO uses WebSockets which require **persistent connections**. cPanel with Passenger generally supports this, but:

- If you're behind a **proxy** (`.htaccess` approach above), ensure your host has `mod_proxy_wstunnel` enabled. Check with:
  ```bash
  httpd -M | grep proxy_wstunnel
  ```
- If WebSockets don't work, Socket.IO will **automatically fall back to HTTP long-polling**, which still works but is less efficient.
- For production, consider setting `transports: ['websocket']` in the frontend `useSocketConnection` hook only after confirming WebSocket support works.

---

## Part 8 — Telegram Bot Webhook Setup

After deploying, you **must register your webhook** with Telegram to ensure updates are routed to your backend API:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://api.yourdomain.com/telegram/webhook"}'
```

Verify the webhook registration details:
```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

---

## Part 9 — Post-Deployment Verification Checklist

Run through these checks after deploying:

```
[ ] GET  https://api.yourdomain.com/health        → { "status": "ok" }
[ ] MySQL tables auto-created (check via phpMyAdmin in cPanel)
[ ] Redis connected (check app logs in cPanel → Node.js App → Log)
[ ] Frontend loads at https://yourdomain.com (or play.yourdomain.com)
[ ] Deep links work (navigate to /keno, refresh — should not 404)
[ ] Telegram Mini App opens and authenticates
[ ] Credentials login works (admin/agent flow)
[ ] Keno draw scheduler fires (check logs after 1 minute)
[ ] Socket.IO events received (open browser DevTools → Network → WS)
[ ] Deposit receipt submission works
[ ] HTTPS forced (http:// redirects to https://)
```

---

## Maintenance

### Updating the Backend

```bash
# Local
npm run build

# Upload new dist/ to server
scp -r dist/ yourusername@yourhost.com:~/igames-backend/

# On server — restart via cPanel → Setup Node.js App → Restart
# Or via SSH:
touch ~/igames-backend/tmp/restart.txt   # Passenger restart signal
```

### Updating the Frontend

```bash
# Local
cd frontend && npm run build

# Upload frontend/dist/ contents to subdomain/root folder
```

### Viewing Logs

```bash
# Via SSH
tail -f ~/igames-backend/logs/combined.log
tail -f ~/igames-backend/logs/error.log
```

Or in cPanel → **Setup Node.js App** → click your app → **Log**.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App won't start | Missing `.env` variable | Check cPanel Node.js logs |
| `ALLOWED_ORIGIN` error | Env var not set in production | Add `ALLOWED_ORIGIN` to `.env` |
| DB connection refused | Wrong DB credentials | Verify in phpMyAdmin |
| Redis connection refused | Redis not running | Start Redis or use remote Redis |
| 404 on deep links | Missing `.htaccess` | Add SPA rewrite rules |
| WebSocket 404 | `mod_proxy_wstunnel` not enabled | Ask host or use long-polling fallback |
| Telegram auth fails | `TELEGRAM_BOT_TOKEN` wrong or webhook not set | Re-run `setWebhook` curl |
| Tables not created | `synchronize: true` but connection failed | Fix DB credentials first |
