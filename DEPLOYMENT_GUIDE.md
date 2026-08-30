# Vyra — Deployment Guide (aaPanel Edition — Roman Urdu)

Yeh guide **aaPanel** ke sath step-by-step deployment ke liye hai — aaPanel aik
free web control panel hai jo Nginx, MySQL, SSL, cron aur file management sab
browser se karwa deta hai, is liye zyada tar kaam clicks se hota hai aur sirf
zaroori commands uske Terminal mein paste karni parti hain. Har click aur har
command neeche likhi hui hai.

> **Sab se bara usool:** database kabhi delete ya reset nahi karna. Har
> deployment aur har update sirf ADD karta hai. Agar kuch kharab ho jaye to
> **code** wapas purana karna hai, data ko haath nahi lagana. Live platform ko
> update karne ka tareeqa `UPDATE_GUIDE.md` mein hai.
>
> aaPanel use nahi kar rahe? Plain-Ubuntu ka tareeqa aakhir mein **Appendix A**
> mein hai.

**Yeh guide aap ki asli deployment ke mutabiq personalised hai:**

| Cheez | Value |
|---|---|
| Repository | `https://github.com/knsoftic/vyra.git` |
| Server folder | `/www/wwwroot/website` |
| API domain | `knbazaar.com` |
| Admin panel domain | `admin.knbazaar.com` |
| Database / DB user | `vyra` / `vyra` (database ka naam `vyra` hi rahega — sirf folder ka naam `website` hai) |

---

## 1. Aap kya deploy kar rahe hain

| Hissa | Yeh kya hai | Kahan chalta hai |
|---|---|---|
| **Backend API** | Node.js (Express + Socket.IO) — saare features isi mein hain | Server, port 4000, Nginx ke peechay |
| **Worker** | Video processing (FFmpeg chahiye) | Server, doosra PM2 process |
| **Super Admin panel** | Platform chalane ki web app | Server, port 3000, Nginx ke peechay |
| **Mobile app** | Expo / React Native | Users ke phones (EAS se banti hai, server par nahi) |
| **Database** | MySQL / MariaDB — TAMAM user data | aaPanel manage karta hai |
| **Redis** | Rate limiting, presence, cache | aaPanel App Store se |

---

## 2. Shuru karne se pehle kya chahiye

| Cheez | Zaroorat |
|---|---|
| Server | Ubuntu 22.04 LTS (clean install), kam az kam 2 vCPU, 4 GB RAM, 80 GB SSD — behtar: 4 vCPU / 8 GB / 200 GB |
| Network | 1 public IP; ports 80, 443 aur aaPanel ka port — cloud provider ke firewall mein bhi khule hon |
| Domains | `knbazaar.com` (API) aur `admin.knbazaar.com` (admin panel) |
| DNS records | `A  knbazaar.com -> SERVER-IP` aur `A  admin.knbazaar.com -> SERVER-IP` — yeh dono **Step 8 se pehle** ban jane chahiyen, warna Let's Encrypt certificate nahi dega |
| Email | Aik Gmail account — baad mein admin panel se connect hoga, server par kuch nahi karna |
| Access | Server ka root SSH — sirf aaPanel install karne ke liye chahiye, uske baad uska apna Terminal hai |

> **Sab se pehle server ki clock UTC par karein.** SSH kar ke aik dafa:
> ```bash
> sudo timedatectl set-timezone UTC
> ```
> Database har row par system ki clock ka waqt lagata hai. Agar baad mein
> timezone badla to saare timestamps shift ho jate hain — testing mein humein
> bilkul yehi masla mila tha.

---

## 3. Step 1 — aaPanel install karein

Server par root se SSH karein aur official installer chalayen (agar yeh command
purani ho jaye to nayi https://www.aapanel.com se copy karein):

```bash
URL=https://www.aapanel.com/script/install_7.0_en.sh && if [ -f /usr/bin/curl ];then curl -ksSO "$URL" ;else wget --no-check-certificate -O install_7.0_en.sh "$URL";fi;bash install_7.0_en.sh aapanel
```

Kuch minute lagte hain, phir yeh print hota hai:

```
aaPanel Internet Address: https://YOUR-IP:PORT/xxxxxxxx
username: xxxxxxxx
password: xxxxxxxx
```

**Teeno lines save kar lein — yeh dobara nahi dikhti.** Browser mein address
khol kar sign in karein.

aaPanel ke andar pehle yeh karein:

1. **Settings** (left menu) → panel ka **username aur password** apna rakh lein.
2. **Security** (left menu) → ports **80** aur **443** khule hon. **3000 aur
   4000 mat kholein** — woh andar hi rehte hain, Nginx ke peechay.
3. Agar cloud provider (AWS/Hetzner/DO/Contabo) ka apna firewall hai to wahan
   bhi 80, 443 aur aaPanel ka port khol dein.

---

## 4. Step 2 — App Store se software install karein

aaPanel → **App Store** (left menu). Yeh chaar install karein, aik aik kar ke
(har aik minute do lagata hai, progress panel mein dikhti hai):

| App | Kaunsa version | Kyun |
|---|---|---|
| **Nginx** | 1.24 ya naya | Sab ke aagay web server |
| **MySQL** | **MariaDB 10.6+** (ya MySQL 8.0) | Database |
| **Redis** | jo bhi mile | Rate limits, presence, cache |
| **PM2 Manager** | latest | Node.js + PM2 process manager |

Phir aaPanel ka **Terminal** (left menu) khol kar Node ka version check karein:

```bash
node -v
```

Vyra ko **Node 24** chahiye. Agar version purana hai to:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
node -v    # ab v24.x aana chahiye
```

FFmpeg (video worker ke liye) — isi Terminal mein:

```bash
sudo apt install -y ffmpeg
ffmpeg -version | head -1
```

---

## 5. Step 3 — Project upload karein

**Jagah:** `/www/wwwroot/website`

**Option A — git (recommended):** aaPanel Terminal mein pehle dekhein folder
mein kya hai:

```bash
ls -A /www/wwwroot/website
```

- **Folder abhi hai hi nahi:**

  ```bash
  cd /www/wwwroot
  git clone https://github.com/knsoftic/vyra.git website
  ```

- **Folder hai magar sirf aaPanel ki default files hain** (`index.html`,
  `404.html`, `.htaccess` — site banate waqt khud ban jati hain):

  ```bash
  cd /www/wwwroot/website
  rm -f index.html 404.html .htaccess
  git clone https://github.com/knsoftic/vyra.git .
  ```

- **Folder mein kuch aur bhi hai:** ruk jayen, pehle dekhein woh kya hai — jo
  files aap ne nahi banayi unhein kabhi delete na karein.

Baad mein check:

```bash
ls /www/wwwroot/website
```

`backend  admin  mobile  shared ...` nazar aana chahiye.

**Option B — zip upload:** apne PC par project ko zip karein magar yeh folders
**chhor kar**:

```
node_modules/        (sab ke sab — server par dobara install hote hain)
.env                 (apni local wali kabhi copy na karein)
backend/storage/     (local test media)
admin/.next/         (server par dobara build hota hai)
mobile/              (server par zaroorat nahi — EAS se alag banta hai)
```

Phir aaPanel → **Files** → `/www/wwwroot` → **Upload** → zip upload karein →
right-click → **Unzip** → folder ka naam `website` rakh dein.

---

## 6. Step 4 — Database banayen (2 minute, sab UI se)

aaPanel → **Databases** → **Add database**:

| Field | Value |
|---|---|
| Database name | `vyra` |
| Username | `vyra` |
| Password | dice daba kar strong password generate karein — **copy kar lein** |
| Access permission | `localhost` |
| Charset | **utf8mb4** (zaroori — emoji aur har zuban ke liye) |

**Submit** dabayen. Bas — koi SQL nahi likhna.

---

## 7. Step 5 — Backend configure karein (.env)

aaPanel → **Files** → `/www/wwwroot/website/backend` → `.env.example` par
right-click → **Copy** → usi folder mein paste → copy ka naam `.env` rakhein →
double-click kar ke aaPanel ke editor mein kholein.

Har line set karein. Agar koi key ghalat ho to server start hone se inkaar kar
deta hai aur bata deta hai kaunsi — yeh jaan bujh kar aisa hai. Ahem values:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `LOG_LEVEL` | `info` |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` |
| `DB_USER` / `DB_NAME` | `vyra` / `vyra` |
| `DB_PASSWORD` | Step 4 wala generated password |
| `DB_POOL_SIZE` | `10` |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `JWT_ACCESS_SECRET` | neeche wali command se generate karein |
| `JWT_REFRESH_SECRET` | **dobara** generate karein — pehle se mukhtalif hona zaroori hai |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `30d` |
| `STORAGE_PUBLIC_URL` | `https://knbazaar.com/media` |
| `STORAGE_ENDPOINT` / keys / bucket | defaults rehne dein (media server ki apni disk se serve hoti hai) |
| `LIVE_INGEST_URL` / `LIVE_PLAYBACK_URL` | defaults rehne dein jab tak media server na lagayen |
| `SMTP_*` | **khali chhor dein** — Gmail baad mein admin panel se lagega |
| `MAIL_FROM` | `Vyra <no-reply@knbazaar.com>` |
| `CORS_ORIGINS` | `https://admin.knbazaar.com` |
| `RATE_LIMIT_ENABLED` | `true` |

JWT ke dono secrets banane ke liye Terminal mein yeh **do dafa** chalayen
(har dafa naya milta hai):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

File save karein (aaPanel editor mein Ctrl+S).

---

## 8. Step 6 — Install, migrate, seed, build

aaPanel **Terminal**:

```bash
cd /www/wwwroot/website/backend
npm ci
npm run migrate:up          # saari tables banti hain — sirf add, kabhi delete nahi
npm run seed                # creative catalogue, segments, ranking weights
npm run seed:gifts          # gift shop
npm run seed:monetization   # coin packages, payment/payout methods, tasks, criteria
```

Apna Super Admin account banayen (credentials **sirf aik dafa** print hote
hain — save kar lein):

```bash
ADMIN_EMAIL=knsoftic@gmail.com ADMIN_PASSWORD='aik lamba passphrase' npm run seed:admin
```

Backend aur admin panel ki production build:

```bash
cd /www/wwwroot/website/backend
npm run build

cd /www/wwwroot/website/admin
echo "NEXT_PUBLIC_API_URL=https://knbazaar.com" > .env.production
npm ci
npm run build
```

---

## 9. Step 7 — Teeno process PM2 se chalayen

aaPanel **Terminal**:

```bash
cd /www/wwwroot/website/backend
pm2 start dist/backend/src/server.js --name vyra-api
pm2 start dist/backend/src/jobs/worker.js --name vyra-worker

cd /www/wwwroot/website/admin
pm2 start npm --name vyra-admin -- run start      # port 3000 par chalta hai

pm2 save
pm2 startup        # jo command yeh print kare woh chala dein — reboot ke baad bhi sab chalta rahega
pm2 ls             # teeno "online" hone chahiyen
```

(Baad mein inhein aaPanel → **App Store → PM2 Manager → Settings** mein bhi
dekh aur restart kar sakte hain, logs samet.)

**Email drain — aaPanel Cron.** Queue mein pari email (verification codes,
password resets) har minute deliver karne ke liye. aaPanel → **Cron** →
**Add Cron Job**:

| Field | Value |
|---|---|
| Type of Task | Shell Script |
| Name of Task | `vyra-outbox-drain` |
| Period | N minutes → `1` |
| Script content | `cd /www/wwwroot/website/backend && /usr/bin/npm run outbox:drain >> /www/wwwlogs/vyra-outbox.log 2>&1` |

**Add Task** dabayen. Iske baghair codes queue mein sahi lagte hain magar
kabhi bhejte nahi — naye user ko platform toota hua lagta hai.

**Cron mein hi database backup bhi laga dein** (abhi karein, baad mein shukriya
ada karenge):

| Field | Value |
|---|---|
| Type of Task | Backup Database |
| Database | `vyra` |
| Period | Daily, 03:00 |
| Keep copies | 7 |

---

## 10. Step 8 — Websites, reverse proxy aur HTTPS (sab clicks)

### 10.1 API site — `knbazaar.com`

aaPanel → **Website** → **Add site**:

> Agar aap pehle hi koi site bana chuke hain jiska root `/www/wwwroot/website`
> hai to **doosri mat banayen** — usi site ki settings kholein aur bas yeh
> yaqeen kar lein ke uska domain `knbazaar.com` hai. Site ka root farq nahi
> dalta (sab kuch reverse-proxy hota hai); sirf domain, proxy aur SSL ki
> settings ahem hain.

- **Domain:** `knbazaar.com`
- **Database:** Do not create
- **PHP version:** Static

Nayi site ke naam par click kar ke settings kholein:

1. **Reverse Proxy** → **Add Reverse Proxy**:
   - Proxy Name: `api`
   - Target URL: `http://127.0.0.1:4000`
   - Send Domain: `$host`
   - Submit.
2. Isi settings mein → **Config** (raw Nginx file). Do tabdeeliyan:

   **a) WebSockets + upload size** — `server { }` block ke andar (upar hi) yeh
   line add karein:

   ```nginx
   client_max_body_size 600M;
   ```

   Phir aaPanel ne jo proxy `location` block banaya hai usme yeh teen lines
   honi chahiyen — jo na ho add kar dein:

   ```nginx
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```

   In ke baghair chat aur live streaming (Socket.IO) connect nahi hoga.

   **b) Media files** — proxy location se **upar** yeh block add karein, taake
   media Node se guzre baghair seedha disk se serve ho:

   ```nginx
   location /media/ {
       alias /www/wwwroot/website/backend/storage/;
       expires 7d;
   }
   ```

   **Save** karein — aaPanel Nginx khud reload kar deta hai.

3. **SSL** tab → **Let's Encrypt** → domain tick karein → **Apply**. Certificate
   ban jaye to **Force HTTPS** on kar dein.

### 10.2 Admin panel site — `admin.knbazaar.com`

**Website** → **Add site** dobara:

- **Domain:** `admin.knbazaar.com`, Database: none, PHP: Static.

Site settings mein:

1. **Reverse Proxy** → Add: Target URL `http://127.0.0.1:3000`, Send Domain `$host`.
2. **SSL** → Let's Encrypt → Apply → Force HTTPS.

Is site mein koi config edit nahi chahiye.

### 10.3 Jaldi test

```bash
curl -s https://knbazaar.com/health
# → {"ok":true,"data":{"status":"ok",...}}
```

Aur browser mein `https://admin.knbazaar.com` kholein — Vyra Admin ka login
page aana chahiye.

---

## 11. Step 9 — Preflight chalayen

aaPanel **Terminal**:

```bash
cd /www/wwwroot/website/backend
NODE_ENV=production npm run preflight
```

Yeh aik command check karti hai: secrets, database, Redis, email, migrations,
payment accounts, money settings, administrators, outbox, media URLs aur CORS.
**Exit code 1 ka matlab hai launch mat karein.** Har `FAIL` khud wajah batata
hai; theek karein aur dobara chalayen. Is waqt sirf do FAIL expected hain:
email transport (agla step) aur payment placeholders (admin panel mein theek
honge).

---

## 12. Step 10 — Pehli sign-in: admin panel mein setup mukammal karein

`https://admin.knbazaar.com` khol kar `seed:admin` wale credentials se sign in
karein.

### 12.1 Gmail connect karein (email delivery) — 4 steps, server ko haath nahi lagana

1. **Google Account → Security** → **2-Step Verification** ON karein (iske
   baghair App Passwords ka option aata hi nahi).
2. **Google Account → Security → App passwords** → "Vyra" ke naam se banayen →
   16 harf ka password copy karein.
3. Admin panel → **App Settings → Email (SMTP)** → **Use Gmail** dabayen
   (`smtp.gmail.com` : `587` khud bhar jata hai) → User = apna Gmail address →
   App password = woh 16 harf → **Save email settings**.
4. **Send a test to** mein apna address likh kar **Send test** dabayen → inbox
   check karein. Email aa gayi to har verification code aur password reset ab
   live hai.

> Aam Gmail password kabhi nahi chalega — Google SMTP ke liye use reject karta
> hai; **App Password** hi chahiye. Gmail din ke taqreeban 500 emails deta hai:
> launch ke liye kafi. Jab barh jayen to inhi 4 fields mein koi transactional
> provider (Brevo, Resend, Amazon SES) daal dein.

### 12.1b SMS connect karein (phone number se login) — admin panel se, deploy ki zaroorat nahi

App mein **"Continue with phone"** ka option hai: banda apna number likhta hai,
usay 6 hindson ka code aata hai, aur code sahi hote hi woh **seedha login** ho
jata hai. Agar us number ka account pehle se hai to usi mein, warna naya account
ban kar usi mein. Alag se "sign up" ka step nahi hai — code hi asal pehchan hai.

Yeh tab tak band rehta hai jab tak aap gateway na lagayen. **Aur jaan boojh kar
band rehta hai**: agar gateway na ho to app saaf keh deti hai "SMS available
nahi", bajaye is ke ke banda apna phone dekhta rahe jis par kabhi kuch aana hi
nahi tha.

**Admin panel → App Settings → SMS (sign-in codes)**

| Field | Kya dalna hai |
|---|---|
| **Provider** | `Generic HTTP gateway` (Pakistani gateways ke liye) ya `Twilio` |
| **Sender ID / From number** | Jo naam ya number message par nazar aaye — jaise `VYRA` |
| **Default country code** | `92` — is se log `0300…` likh sakenge, `+92300…` likhna zaroori nahi |
| **API key / secret** | Gateway wale ne jo diya. Ek dafa save karne ke baad dobara nazar nahi aata (SMTP password ki tarah); khali chhorne ka matlab "purana hi rehne do" |

**Generic gateway ke liye** aur do fields:

- **Gateway URL** — jaise `https://api.aapkagateway.com/send`
- **Body / query string** — apne gateway ki documentation ke mutabiq, in
  placeholders ke saath (yeh khud bhar jate hain):

  | Placeholder | Kya banta hai |
  |---|---|
  | `{to}` | number, country code ke saath, bina `+` ke |
  | `{text}` | message ka matn |
  | `{key}` / `{secret}` | upar wali credentials |
  | `{sender}` | Sender ID |

  Misal ke taur par:
  `api_key={key}&sender={sender}&to={to}&message={text}`

  Agar body `{` se shuru ho aur sahi JSON ho to JSON bhej diya jata hai, warna
  form-encoded.

> **Default country code zaroor bharein.** Yeh khali chhorne ka matlab hai ke
> `0300…` likhne wale ko app refuse kar degi (kyunki `0300…` kis mulk ka hai,
> yeh server ko nahi pata — aur andaza lagana ka matlab hota ek hi bande ke do
> alag account ban jana). `92` daal dene se dono tareeqe ek hi account par
> jate hain.

Save karne ke baad app se apne number par code manga kar dekh lein — aur yaad
rakhein ke code **outbox** se jata hai, to aaPanel wala `vyra-outbox-drain` cron
chalta rehna chahiye (section 11 dekhen), warna code queue mein hi baitha
rahega.

### 12.2 Paison ki settings

- **Rates & Methods** → har `REPLACE IN ADMIN` wale payment account mein apni
  asli Easypaisa / JazzCash / bank / USDT details dalein. *Placeholder account
  par bheja gaya paisa dooba hua paisa hai.* Har currency ka coin rate set
  karein.
- **Coins** aur **Gifts** → packages aur gift prices apni marzi ke mutabiq.

### 12.3 Baqi cheezen

- **App Settings** → app ka naam, privacy policy / terms / guidelines ke URLs,
  upload limits.
- **Roles & Permissions** → apni team ko admin access dein. (Woh pehle app mein
  aam account register karein; aap unke email par grant karein — yeh screen
  kabhi password handle nahi karti.)
- Preflight dobara chalayen — ab sab green hona chahiye (siwaye un cheezon ke
  jo jaan bujh kar baad ke liye chhori hain).

---

## 13. Mobile app (apne PC par banti hai, server par nahi)

```bash
cd mobile
# App ko production par point karein (EXPO_PUBLIC_API_URL=https://knbazaar.com)
npx eas build --platform android --profile production
npx eas build --platform ios --profile production    # Apple developer account chahiye
npx eas submit                                        # stores par bhejne ke liye
```

Jaldi internal testing ke liye APK profile kafi hai — seedha Android phones
par install karein.

---

## 14. Jo cheezen jaan bujh kar baad ke liye hain (preflight inka naam leta hai)

| Cheez | Jab tak nahi lagegi to kya hoga |
|---|---|
| Push provider (FCM/APNs) | Push notifications nahi; in-app inbox sab kuch dikhata hai. Push rows outbox mein **saaf nazar aa kar** fail hoti hain — jaan bujh kar, kabhi chupke nahi. |
| Media server (RTMP) | Live streaming end-to-end untested; UI, gifting aur wallet ka logic tayyar hai. |
| Object storage (S3) | Media abhi server ki disk par hai. Launch ke liye theek hai; aaPanel dashboard par disk dekhte rahein, barhne par migrate karein. |

---

## 15. Kuch kaam na kare to (aaPanel edition)

| Masla | Kahan dekhein |
|---|---|
| aaPanel khud nahi khul raha | Cloud provider ka apna firewall — panel ka port wahan bhi khula hona chahiye, sirf aaPanel → Security mein nahi. |
| API start nahi ho raha | `pm2 logs vyra-api` — woh khud batata hai `.env` ki kaunsi key ghalat hai. |
| Phone login par "SMS available nahi" | Admin → App Settings → SMS: Provider abhi `None` hai. Gateway lagayen (12.1b). |
| Number likhne par "country code dalein" | Admin → App Settings → SMS → **Default country code** khali hai. `92` daal dein. |
| "Code sent" magar email nahi aayi | Admin → Notifications: transport `console` hai? Gmail lagayen (12.1). Phir aaPanel → Cron: `vyra-outbox-drain` chal raha hai? `/www/wwwlogs/vyra-outbox.log` dekhein. |
| Admin panel: "cannot reach the API" | `admin/.env.production` mein `NEXT_PUBLIC_API_URL` ghalat (badalne ke baad rebuild karein), ya `backend/.env` ke `CORS_ORIGINS` mein admin domain nahi (phir `pm2 restart vyra-api`). |
| Chat / live connect nahi hota | Proxy config mein WebSocket ki teen lines nahi hain (10.1-2a). |
| Upload 50 MB ke qareeb fail | Site config mein `client_max_body_size 600M;` nahi hai (10.1-2a). |
| Videos "processing" par atki hain | `pm2 logs vyra-worker` — aksar FFmpeg install nahi hota. |
| Timestamps ghanton aagay peechay | MySQL start hone ke baad server ka timezone badla hai. UTC rakhein; App Store → MySQL → Restart aik dafa. |
| Sab kuch slow / rate limits ajeeb | App Store → Redis chal raha hai? Terminal: `redis-cli ping` → `PONG`. |
| Buyer ne paise bheje magar coins nahi mile | Yeh jaan bujh kar insaani step hai: Admin → Coin Requests → approve. Approve karte hi coins mil jate hain, aur audit hota hai. |

**Baad mein update karna:** `UPDATE_GUIDE.md` ko poora follow karein — backup
(aaPanel Cron rozana khud banata hai; update se pehle aik manual bhi:
Databases → Backup), migrations validate, migrate jab purana code chal raha ho,
phir code switch, `pm2 restart`, aur row counts verify. Rollback hamesha code
ka hota hai, data ka kabhi nahi.

---

## Appendix A — aaPanel ke baghair (plain Ubuntu)

Wahi deployment seedha `apt`, `mysql`, haath se likhi Nginx configs aur certbot
se — un operators ke liye jo control panel nahi chahte:

1. `sudo apt install -y mariadb-server redis-server nginx ffmpeg` + NodeSource se Node 24 + `npm i -g pm2`.
2. `mysql` shell mein DB aur user banayen (`CREATE DATABASE vyra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'vyra'@'localhost' IDENTIFIED BY '...'; GRANT ALL PRIVILEGES ON vyra.* TO 'vyra'@'localhost';`).
3. Steps 5–7 aur 9–12 bilkul wahi hain (paths `/www/wwwroot` ki jagah `/var/www` ke neeche).
4. Nginx: dono server blocks khud likhein — API block mein `/media/` alias, WebSocket headers aur `client_max_body_size 600M`; admin block :3000 par proxy. SSL ke liye `sudo certbot --nginx -d knbazaar.com -d admin.knbazaar.com`.
5. Outbox drain crontab entry ban jata hai: `* * * * * cd /var/www/website/backend && /usr/bin/npm run outbox:drain >> /var/log/vyra-outbox.log 2>&1`.
