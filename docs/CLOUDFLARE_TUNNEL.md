# REMCS Remote Access

## Option A (current setup, free): quick tunnel + pairing code

No domain, no Cloudflare account, nothing to install by hand. After `git pull` and a restart, the backend (`app.py`) does it all:

1. Starts a free Cloudflare **quick tunnel** (`https://<random-words>.trycloudflare.com`). It downloads `cloudflared` to `~/.local/bin` the first time.
2. Creates a **pairing code** on first run, saved only on the Pi in `backend/pairing_code.txt` (gitignored).
3. Posts the current tunnel URL to **ntfy.sh** under a topic derived from the pairing code (a one-way hash, so the topic does not reveal the code). It reposts every 30 minutes and whenever the URL changes, e.g. after a reboot.

**Phone setup (one time):**
1. On the Pi screen: **Settings → Remote Access (Phone App)**. It shows the pairing code (e.g. `ABCD-EFGH-JKMN`) and the tunnel status. Only the Pi's own screen can see the code.
2. In the REMCS app: long-press the screen (or tap *Configure Server* on the error screen), type the pairing code, and tap **Save & Connect**.
3. From then on the app finds the newest URL by itself, on Wi-Fi or mobile data.

**Security:** anything coming through the tunnel needs the pairing code (cookie `rems_pair`):
- `/api/*` answers 401 without it.
- Pages show a "Enter pairing code" form.
- Five wrong codes lock the form for 60 s.
- LAN access (`http://192.168.x.x:5000`) and the kiosk work as before, with no code.

To change the code (for example if it leaked), delete `backend/pairing_code.txt` and restart the backend. Then enter the new code in the app.

Limits of the free option:
- The URL changes on every restart. The app handles that, but browser bookmarks will break.
- It depends on ntfy.sh and trycloudflare.com, which are free public services with no uptime guarantee.
- To turn it off, add `REMS_QUICK_TUNNEL=0` to `backend/.env`.

Do **not** also run `start_tunnel.sh`, because that starts a second tunnel.

---

## Option B (paid domain): Cloudflare Named Tunnel


This gives the Raspberry Pi a **permanent HTTPS URL** (e.g. `https://rems.yourdomain.xyz`) so the dashboard and the Android app can see live sensor data from anywhere, over mobile data too.

```
ESP32 ──USB──▶ Raspberry Pi (Flask :5000) ──outbound tunnel──▶ Cloudflare ◀── Phone / Browser
```

No router port forwarding is needed, and the Pi's home IP is never exposed. Unlike the free quick tunnel (`start_tunnel.sh`), the URL **doesn't change** when the Pi restarts.

> ⚠️ **Security:** once the URL is public, anyone who finds it can switch relays, because the API has no server-side login yet (FIX_PLAN.md SEC-1…SEC-5). Do **Step 5 (Cloudflare Access)** right away. It puts an email login in front of everything and costs nothing.

---

## Step 1: Get a domain on Cloudflare (one time)

1. Create a free account at <https://dash.cloudflare.com>.
2. Get a domain in one of two ways:
   - **Easiest:** Dashboard → *Domain Registration* → *Register Domains*. Cloudflare sells at cost; cheap TLDs like `.xyz` run roughly ₱600–800/yr. Check the current price in the dashboard.
   - **Already own one elsewhere:** *Add a site*, then change the nameservers at your registrar to the two Cloudflare gives you. Wait until the domain shows **Active**.

## Step 2: Create the tunnel in the dashboard

1. Open **Zero Trust** (<https://one.dash.cloudflare.com>). The first time, it asks you to pick a team name and the **Free** plan.
2. Go to **Networks → Tunnels → Create a tunnel**.
3. Choose **Cloudflared**, name it `rems-pi`, and save.
4. On the *Install connector* screen, choose **Debian** and **arm64** (Pi 4/5 on 64-bit OS). Copy the install command. You only need the long token after `--token` (starts with `eyJ…`).
   **Keep the token secret**, because anyone with it can run your tunnel.
5. Click **Next**, then add a **Public Hostname** (called *Published application routes* in newer dashboards):
   | Field | Value |
   |---|---|
   | Subdomain | `rems` |
   | Domain | your domain |
   | Service type | `HTTP` |
   | URL | `localhost:5000` |
6. Save the tunnel.

## Step 3: Run the setup script on the Pi

```bash
cd ~/<repo folder>
./deploy-to-pi.sh                       # only if the venv isn't set up yet
./deploy/setup-cloudflare-tunnel.sh     # paste the token and https://rems.yourdomain.xyz
```

The script:
- installs `cloudflared` from Cloudflare's official apt repo
- runs the tunnel as the `cloudflared` systemd service, so it starts on boot
- installs `rems.service`, which runs the Flask backend on boot and restarts it if it crashes
- saves `CLOUDFLARE_TUNNEL_TOKEN` and `REMS_PUBLIC_URL` into `backend/.env` (gitignored, chmod 600)
- tests the local and public URLs

After this, **don't run `python app.py` or `start_tunnel.sh` by hand**. Both now run automatically as services.

## Step 4: Point the Android app at it (one time)

Open the REMS app, enter `https://rems.yourdomain.xyz`, then tap **Save & Connect**. Long-press the screen anytime to change it.

## Step 5: Protect it with Cloudflare Access (strongly recommended, free)

1. Zero Trust → **Access → Applications → Add an application → Self-hosted**.
2. Application domain: `rems.yourdomain.xyz`, session duration: `1 month`.
3. Add a policy: **Action** `Allow`, **Include** `Emails` = your email (plus your groupmates'/adviser's).
4. Under **Authentication**, keep **One-time PIN** enabled.

Now anyone who opens the URL, in a browser or the app, must enter a code sent to an allowed email first. The APK (v1.1+) keeps the `*.cloudflareaccess.com` login page inside the app so the login sticks.

The ESP32 isn't affected, because it talks to the Pi over USB serial, not through the tunnel.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Public URL shows Cloudflare error **1033** | Tunnel isn't connected: `sudo systemctl status cloudflared`, `sudo journalctl -u cloudflared -n 50` |
| Public URL shows **502 Bad Gateway** | Flask isn't running: `sudo systemctl status rems`, `sudo journalctl -u rems -n 50` |
| Works on Wi-Fi but not in the app | Make sure the app URL starts with `https://` and has no typo; long-press to edit |
| Relays don't switch under the service | The run user must be in the `gpio` group: `sudo usermod -aG gpio $USER`, then reboot |
| No sensor data | ESP32 serial access needs the `dialout` group: `sudo usermod -aG dialout $USER` |

Useful commands:
```bash
sudo systemctl restart rems          # after pulling new code
sudo systemctl restart cloudflared
sudo journalctl -u rems -f           # live backend logs
```

To remove everything: `sudo cloudflared service uninstall && sudo systemctl disable --now rems`.
