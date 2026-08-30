# Vyra — Deployment Guide (aaPanel Edition)

Step-by-step deployment using **aaPanel** — the free web control panel that gives
you a browser UI for Nginx, MySQL, SSL, cron and file management, so almost
nothing needs to be done blind on the command line. Written for a first
deployment done by one person; every click and every command is spelled out.

> **The one rule:** never delete or reset the database. Every deployment and
> every update is additive. If something goes wrong you roll back **code**, never
> data. See `UPDATE_GUIDE.md` for updating a live platform safely.
>
> Not using aaPanel? The plain-Ubuntu procedure is in **Appendix A** at the end.

---

## 1. What you are deploying

| Part | What it is | Runs where |
|---|---|---|
| **Backend API** | Node.js (Express + Socket.IO) — everything lives here | Server, port 4000, behind Nginx |
| **Worker** | Video processing jobs (needs FFmpeg) | Server, second PM2 process |
| **Super Admin panel** | Next.js web app for operating the platform | Server, port 3000, behind Nginx |
| **Mobile app** | Expo / React Native | Users' phones (built with EAS, not on the server) |
| **Database** | MySQL / MariaDB — all user data | Managed by aaPanel |
| **Redis** | Rate limiting, presence, cache | Installed from aaPanel App Store |

---

## 2. What you need before starting

| Item | Requirement |
|---|---|
| Server | Ubuntu 22.04 LTS (clean install), 2 vCPU, 4 GB RAM, 80 GB SSD minimum — 4 vCPU / 8 GB / 200 GB recommended |
| Network | 1 public IPv4; ports 80, 443 and the aaPanel port open at your cloud provider's firewall too |
| Domains | `vyra.example.com` (API) and `admin.vyra.example.com` (admin panel) — two DNS **A-records** pointing at the server IP |
| Email | A Gmail account (or any SMTP provider) — connected later from the admin panel, no server work |
| Access | Root SSH access to the server (only needed twice: to install aaPanel, and it gives you a terminal after that) |

> **Set the clock first.** SSH in once and run:
> ```bash
> sudo timedatectl set-timezone UTC
> ```
> The database stamps every row with the system clock. A server whose timezone
> changes later shifts every timestamp — we hit exactly this during testing.

---

## 3. Step 1 — Install aaPanel

SSH into the server as root and run the official installer (copy the current
one-liner from https://www.aapanel.com if this one has changed):

```bash
URL=https://www.aapanel.com/script/install_7.0_en.sh && if [ -f /usr/bin/curl ];then curl -ksSO "$URL" ;else wget --no-check-certificate -O install_7.0_en.sh "$URL";fi;bash install_7.0_en.sh aapanel
```

It takes a few minutes and then prints something like:

```
aaPanel Internet Address: https://YOUR-IP:PORT/xxxxxxxx
username: xxxxxxxx
password: xxxxxxxx
```

**Save all three lines.** Open the address in your browser and sign in.

First things to do inside aaPanel:

1. **Settings** (left menu) → change the panel **username and password** to your own.
2. **Security** (left menu) → confirm ports **80** and **443** are released. Do
   **not** open 3000 or 4000 — those stay internal, behind Nginx.
3. If your cloud provider (AWS/Hetzner/DO/Contabo) has its own firewall, open
   80, 443 and the aaPanel port there as well.

---

## 4. Step 2 — Install the software from the App Store

aaPanel → **App Store** (left menu). Install these four, one by one
(each takes a minute or two — the panel shows progress):

| App | Version to pick | Why |
|---|---|---|
| **Nginx** | 1.24 or newer | The web server in front of everything |
| **MySQL** | **MariaDB 10.6+** (or MySQL 8.0) | The database |
| **Redis** | any offered | Rate limits, presence, cache |
| **PM2 Manager** | latest | Installs Node.js + the PM2 process manager |

Then open aaPanel's **Terminal** (left menu) and check the Node version:

```bash
node -v
```

Vyra needs **Node 24**. If the version shown is older, install Node 24 over it:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
node -v    # must print v24.x
```

FFmpeg (for the video worker) — still in the aaPanel Terminal:

```bash
sudo apt install -y ffmpeg
ffmpeg -version | head -1
```

---

## 5. Step 3 — Upload the project

**Where it lives:** `/www/wwwroot/vyra` (aaPanel's standard web root).

**Option A — git (recommended):** aaPanel Terminal:

```bash
cd /www/wwwroot
git clone https://github.com/knsoftic/vyra.git vyra
```

**Option B — zip upload:** on your PC, zip the project **without** these:

```
node_modules/        (every one — reinstalled on the server)
.env                 (never copy your local one)
backend/storage/     (local test media)
admin/.next/         (rebuilt on the server)
mobile/              (not needed on the server — built separately with EAS)
```

Then aaPanel → **Files** → navigate to `/www/wwwroot` → **Upload** → upload the
zip → right-click it → **Unzip** → rename the folder to `vyra`.

---

## 6. Step 4 — Create the database (two minutes, all UI)

aaPanel → **Databases** → **Add database**:

| Field | Value |
|---|---|
| Database name | `vyra` |
| Username | `vyra` |
| Password | press the dice to generate a strong one — **copy it** |
| Access permission | `localhost` |
| Charset | **utf8mb4** (important — emoji and every language) |

Press **Submit**. Done — no SQL needed.

> While you are here: note the **Root password** button on this page. You never
> need root for Vyra, but aaPanel keeps it available.

---

## 7. Step 5 — Configure the backend (.env)

aaPanel → **Files** → `/www/wwwroot/vyra/backend` → find `.env.example` →
right-click → **Copy**, paste in the same folder, rename the copy to `.env` →
double-click `.env` to open aaPanel's editor.

Set every line. The server refuses to start if a key is missing and prints
which one — that is deliberate. The values that matter:

| Key | Set it to |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `LOG_LEVEL` | `info` |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` |
| `DB_USER` / `DB_NAME` | `vyra` / `vyra` |
| `DB_PASSWORD` | the password aaPanel generated in Step 4 |
| `DB_POOL_SIZE` | `10` |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `JWT_ACCESS_SECRET` | generate below — 48 random bytes |
| `JWT_REFRESH_SECRET` | generate **again** — must be different |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `30d` |
| `STORAGE_PUBLIC_URL` | `https://vyra.example.com/media` |
| `STORAGE_ENDPOINT` / keys / bucket | keep the defaults (media is served from the server's disk) |
| `LIVE_INGEST_URL` / `LIVE_PLAYBACK_URL` | keep defaults until you add a media server |
| `SMTP_*` | **leave empty** — Gmail is configured from the admin panel after launch |
| `MAIL_FROM` | `Vyra <no-reply@vyra.example.com>` |
| `CORS_ORIGINS` | `https://admin.vyra.example.com` |
| `RATE_LIMIT_ENABLED` | `true` |

Generate the two JWT secrets in the aaPanel Terminal (run it twice):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Save the file (Ctrl+S in the aaPanel editor).

---

## 8. Step 6 — Install, migrate, seed

aaPanel **Terminal**:

```bash
cd /www/wwwroot/vyra/backend
npm ci
npm run migrate:up          # creates all tables — additive, forward-only
npm run seed                # creative catalogue, segments, ranking weights
npm run seed:gifts          # the gift shop
npm run seed:monetization   # coin packages, payment/payout methods, tasks, criteria
```

Create your Super Admin account (prints the credentials ONCE — save them):

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long passphrase' npm run seed:admin
```

Build the backend and the admin panel for production:

```bash
cd /www/wwwroot/vyra/backend
npm run build

cd /www/wwwroot/vyra/admin
echo "NEXT_PUBLIC_API_URL=https://vyra.example.com" > .env.production
npm ci
npm run build
```

---

## 9. Step 7 — Start the three processes with PM2

aaPanel **Terminal**:

```bash
cd /www/wwwroot/vyra/backend
pm2 start dist/backend/src/server.js --name vyra-api
pm2 start dist/backend/src/jobs/worker.js --name vyra-worker

cd /www/wwwroot/vyra/admin
pm2 start npm --name vyra-admin -- run start      # serves on port 3000

pm2 save
pm2 startup        # run the one command it prints, so everything survives reboots
pm2 ls             # all three must say "online"
```

(You can also see and restart these later in aaPanel → **App Store → PM2
Manager → Settings**, which lists every PM2 process with logs.)

**The email drain — aaPanel Cron.** Queued email (verification codes, resets)
is delivered by a drain that must run every minute. aaPanel → **Cron** →
**Add Cron Job**:

| Field | Value |
|---|---|
| Type of Task | Shell Script |
| Name of Task | `vyra-outbox-drain` |
| Period | N minutes → `1` |
| Script content | `cd /www/wwwroot/vyra/backend && /usr/bin/npm run outbox:drain >> /www/wwwlogs/vyra-outbox.log 2>&1` |

Press **Add Task**. Without this, codes queue correctly and never send.

**While you are in Cron — add the database backup** (do it now, thank yourself later):

| Field | Value |
|---|---|
| Type of Task | Backup Database |
| Database | `vyra` |
| Period | Daily, 03:00 |
| Keep copies | 7 |

---

## 10. Step 8 — Websites, reverse proxy and HTTPS (all UI)

### 10.1 The API site

aaPanel → **Website** → **Add site**:

- **Domain:** `vyra.example.com`
- **Database:** Do not create
- **PHP version:** Static

Open the new site's settings (click its name) →

1. **Reverse Proxy** → **Add Reverse Proxy**:
   - Proxy Name: `api`
   - Target URL: `http://127.0.0.1:4000`
   - Send Domain: `$host`
   - Submit.
2. Still in site settings → **Config** (the raw Nginx file). Two edits:

   **a) WebSockets + upload size** — inside the `server { }` block (near the top), add:

   ```nginx
   client_max_body_size 600M;
   ```

   Then find the proxy `location` block aaPanel generated (it may be in an
   included file shown in the same editor) and make sure it contains these
   three lines — add any that are missing:

   ```nginx
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```

   Without them, chat and live features (Socket.IO) cannot connect.

   **b) Media files** — add this block **above** the proxy location, so media
   is served straight from disk instead of through Node:

   ```nginx
   location /media/ {
       alias /www/wwwroot/vyra/backend/storage/;
       expires 7d;
   }
   ```

   **Save** — aaPanel reloads Nginx automatically.

3. **SSL** tab → **Let's Encrypt** → tick the domain → **Apply**. When issued,
   switch on **Force HTTPS**.

### 10.2 The admin panel site

**Website** → **Add site** again:

- **Domain:** `admin.vyra.example.com`, Database: none, PHP: Static.

Site settings →

1. **Reverse Proxy** → Add: Target URL `http://127.0.0.1:3000`, Send Domain `$host`.
2. **SSL** → Let's Encrypt → Apply → Force HTTPS.

No config edits needed for this one.

### 10.3 Quick test

```bash
curl -s https://vyra.example.com/health
# → {"ok":true,"data":{"status":"ok",...}}
```

And open `https://admin.vyra.example.com` — the Vyra Admin login page should load.

---

## 11. Step 9 — Run the preflight

aaPanel **Terminal**:

```bash
cd /www/wwwroot/vyra/backend
NODE_ENV=production npm run preflight
```

One command checks: secrets, database, Redis, email, migrations, payment
accounts, money settings, administrators, the outbox, media URLs and CORS.
**Exit code 1 means do not launch.** Every `FAIL` line explains itself; fix it
and run again. At this point the only expected FAIL is the email transport
(fixed in the next step) and the payment placeholders (fixed in the admin panel).

---

## 12. Step 10 — First sign-in: finish setup in the admin panel

Open `https://admin.vyra.example.com`, sign in with the `seed:admin` credentials.

### 12.1 Connect Gmail (email delivery) — 4 steps, no server work

1. **Google Account → Security** → turn ON **2-Step Verification** (App
   Passwords do not exist without it).
2. **Google Account → Security → App passwords** → create one named "Vyra" →
   copy the 16-character password.
3. Admin panel → **App Settings → Email (SMTP)** → press **Use Gmail** (fills
   `smtp.gmail.com` : `587`) → User = your Gmail address → App password = the
   16 characters → **Save email settings**.
4. Type your own address under **Send a test to** → **Send test** → check your
   inbox. When it arrives, every verification code and password reset is live.

> A normal Gmail password never works — Google rejects it for SMTP; it must be
> an App Password. Gmail allows roughly 500 emails/day: enough to launch. When
> you outgrow it, put a transactional provider (Brevo, Resend, Amazon SES) into
> the same four fields.

### 12.2 Money settings

- **Rates & Methods** → replace every `REPLACE IN ADMIN` payment account with
  your real Easypaisa / JazzCash / bank / USDT details. *Money sent to a
  placeholder account is money lost.* Set the coin purchase rates per currency.
- **Coins** and **Gifts** → adjust packages and gift prices if you want
  different ones than the seeds.

### 12.3 The rest

- **App Settings** → app name, privacy policy / terms / guidelines URLs, upload limits.
- **Roles & Permissions** → grant admin access to your team. (They register a
  normal account in the app first; you grant against their email — this screen
  never handles passwords.)
- Run the preflight once more. Everything you have not knowingly deferred
  should now be green.

---

## 13. The mobile app (built on your PC, not the server)

```bash
cd mobile
# Point the app at production (EXPO_PUBLIC_API_URL=https://vyra.example.com)
npx eas build --platform android --profile production
npx eas build --platform ios --profile production    # needs an Apple developer account
npx eas submit                                        # to the stores
```

For quick internal testing, build an APK profile and install it directly on
Android phones.

---

## 14. Known-deferred items (the preflight names them)

| Item | Effect until added |
|---|---|
| Push provider (FCM/APNs) | No push notifications; the in-app inbox carries everything. Push rows fail **visibly** in the outbox — by design, never silently. |
| Media server (RTMP) | Live streaming untested end-to-end; UI, gifting and wallet logic are ready. |
| Object storage (S3) | Media lives on the server disk. Fine to launch; watch disk usage in aaPanel's dashboard and migrate when it grows. |

---

## 15. Troubleshooting (aaPanel edition)

| Symptom | Look at |
|---|---|
| Cannot reach aaPanel itself | Cloud provider firewall — the panel port must be open there too, not only in aaPanel → Security. |
| API will not start | `pm2 logs vyra-api` — it prints exactly which `.env` key is wrong. |
| "Code sent" but no email arrives | Admin → Notifications: transport says `console`? Configure Gmail (12.1). Then aaPanel → Cron: is `vyra-outbox-drain` there and running? Check `/www/wwwlogs/vyra-outbox.log`. |
| Admin panel: "cannot reach the API" | `NEXT_PUBLIC_API_URL` wrong in `admin/.env.production` (rebuild after changing), or admin domain missing from `CORS_ORIGINS` in `backend/.env` (then `pm2 restart vyra-api`). |
| Chat / live never connects | The three WebSocket lines are missing from the proxy config (10.1-2a). |
| Uploads fail around 50 MB | `client_max_body_size 600M;` missing from the site config (10.1-2a). |
| Videos stuck in "processing" | `pm2 logs vyra-worker` — usually FFmpeg missing. |
| Timestamps hours off | Server timezone changed after MySQL started. Keep UTC; restart MySQL once from App Store → MySQL → Restart. |
| Everything slow / odd rate limits | App Store → Redis → is it running? Terminal: `redis-cli ping` → `PONG`. |
| Buyer paid but no coins | That is a human step by design: Admin → Coin Requests → approve. Approving credits instantly and is audited. |

**Updating later:** follow `UPDATE_GUIDE.md` exactly — backup (aaPanel Cron
already makes daily ones; take a manual one too: Databases → Backup), validate
migrations, migrate while old code runs, switch code, `pm2 restart`, verify row
counts. Roll back code, never data.

---

## Appendix A — Without aaPanel (plain Ubuntu)

The same deployment using raw `apt`, `mysql`, hand-written Nginx configs and
certbot — for operators who prefer no control panel:

1. `sudo apt install -y mariadb-server redis-server nginx ffmpeg` + NodeSource Node 24 + `npm i -g pm2`.
2. Create the DB and user in the `mysql` shell (`CREATE DATABASE vyra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'vyra'@'localhost' IDENTIFIED BY '...'; GRANT ALL PRIVILEGES ON vyra.* TO 'vyra'@'localhost';`).
3. Steps 5–7 and 9–12 are identical (paths under `/var/www` instead of `/www/wwwroot`).
4. Nginx: write both server blocks yourself — API block with the `/media/` alias, WebSocket headers and `client_max_body_size 600M`; admin block proxying :3000. `sudo certbot --nginx -d vyra.example.com -d admin.vyra.example.com` for SSL.
5. The outbox drain becomes a crontab entry: `* * * * * cd /var/www/vyra/backend && /usr/bin/npm run outbox:drain >> /var/log/vyra-outbox.log 2>&1`.
