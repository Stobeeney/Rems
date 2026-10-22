# REMS Fix Plan

Findings from the full-repo scan on 2026-09-29.

## Instructions for AI agents

- Each task has a checkbox, an ID, and a **Done when** line. A task is finished only when every **Done when** condition is true in the code.
- Before starting a task, check whether it's already done. Code may have changed since this file was written, so re-check the file and line references.
- When you finish a task, change `- [ ]` to `- [x]` and add `— done YYYY-MM-DD (commit <sha>)` at the end of the task line.
- If a task turns out to be invalid or unnecessary, mark it `- [~]` and give a one-line reason.
- **The plan is complete when this file has no `- [ ]` left.** Check with:
  ```bash
  grep -c -- '- \[ \]' FIX_PLAN.md   # 0 = plan complete
  ```
- Work in priority order (P0 → P1 → P2) unless the user says otherwise.
- After any `backend/app.py` change: `python3 -m py_compile backend/app.py`
- After any JS change: `node --check backend/static/app.js && node --check backend/static/mobile.js`

---

## P0: Security (system is publicly reachable via Cloudflare tunnel)

- [ ] **SEC-1: Enforce authentication on the server side**
  - Add session- or token-based auth in `backend/app.py`. `/api/login` issues it, and every state-changing `/api/*` route requires it (relay, mode, devices, suggestions, alerts, rtc, active-devices).
  - Exempt only: `/`, `/mobile`, static files, `/api/login`, `/api/register`, and `POST /api/data` (the ESP32 telemetry endpoint; optionally protect it with a shared device key instead).
  - Update `app.js` and `mobile.js` so they send the credential and handle `401` by showing the login screen.
  - **Done when:** `curl -X POST http://localhost:5000/api/relay -H 'Content-Type: application/json' -d '{"action":"on","relay_id":4}'` without a session returns `401`, and the UI still works after logging in.

- [ ] **SEC-2: Hash passwords and remove weak defaults**
  - Store passwords with `werkzeug.security.generate_password_hash` and check them with `check_password_hash`. Migrate existing plaintext rows on startup.
  - Stop seeding `admin/admin123` and `user/password`. Take the initial admin password from `.env` (e.g. `REMS_ADMIN_PASSWORD`) or require it to be set on first run.
  - Decide whether `/api/register` stays open to anyone. At minimum, new accounts must never get the `admin` role.
  - **Done when:** `SELECT password FROM users` shows no plaintext passwords and `app.py` contains no hardcoded passwords.

- [ ] **SEC-3: Remove client-side login bypasses**
  - `backend/static/app.js` `doLogin`: don't fall back to `admin`/`admin123` when the fields are empty.
  - `backend/static/app.js` DOMContentLoaded: remove the localhost auto-bypass and the "default to Admin" profile. The UI should rely on the server session from SEC-1.
  - **Done when:** `grep -n "admin123" backend/static/app.js` returns nothing, and no code path shows `#main-app` without a successful login.

- [ ] **SEC-4: Fix stored XSS in innerHTML templates**
  - Add an `escapeHtml()` helper to `app.js` and `mobile.js`. Apply it to every server-supplied string interpolated into `innerHTML`: device `name`, `room`, `pin`, suggestion `message`, `potential_savings`, `confidence`, alert `message`, and toast text.
  - Validate or strip `<>` in `/api/devices/update` on the server as well.
  - **Done when:** renaming a device to `<img src=x onerror=alert(1)>` shows the text literally on both the kiosk and mobile UIs.
  - **Progress 2026-10-22:** `escapeHtml()` added to both files. mobile.js is fully escaped. In app.js, the Load Control table and the Active Devices cards are escaped; suggestions, alerts and the remaining templates are not yet. The server now validates name length and room, but it doesn't strip `<>` yet.

- [ ] **SEC-5: Disable Flask debug mode in production**
  - `backend/app.py`, last line: `debug=True` → read from env (e.g. `FLASK_DEBUG`), default `False`.
  - **Done when:** running `python app.py` without env vars starts with debug off.

## P1: Hardware and safety logic bugs

- [ ] **LOGIC-1: Apply the ACU interlock when approving AI suggestions**
  - `handle_suggestion()` in `backend/app.py`: before engaging Capacitor Bank K1 (target_relay 1), refuse if `relay_status[7]` (ACU) is ON. Return an error and leave the suggestion pending.
  - Better: move relay switching into one `set_relay(id, on)` helper that always enforces the interlock, and use it from every code path.
  - **Done when:** with relay 7 ON, approving a K1 suggestion does not energize relay 1.

- [x] **LOGIC-2: Fix the relay → PZEM channel mapping** — done 2026-10-22 (uncommitted; `RELAY_CHANNEL_MAP` in app.py)
  - Relays 14–20 currently map to `C0` (main panel) in both `ai_anomaly_engine` and `safety_monitoring_engine`. This causes false `ACTUATOR_FAULT` alerts and bad standby-leak suggestions.
  - Define one explicit `RELAY_CHANNEL_MAP` dict (relay → branch channel, or `None` if unmonitored) and skip relays with no dedicated channel.
  - **Done when:** with relays 14–20 OFF and current flowing on C0, no `ACTUATOR_FAULT` alert is created for them.

- [ ] **LOGIC-3: Stop duplicate alerts**
  - Overload, overcurrent and actuator-fault duplicate checks compare `message`, which contains a live reading, so a new row is inserted every 5 s.
  - Deduplicate by `(alert_type, channel/relay)` with `status='ACTIVE'` instead (add a column such as `source_key`, or match on a stable prefix).
  - **Done when:** a sustained overload on one branch produces exactly one ACTIVE alert.

- [ ] **LOGIC-4: Fix the manual-mode vacancy suggestion**
  - `occupancy_engine()`: `elapsed == 120` fires several times in the 0.3 s loop. Use a "notified" flag that resets when presence is detected.
  - Set a meaningful `target_relay`, or support multi-relay approval, so pressing Approve actually does something.
  - **Done when:** a 2-minute vacancy creates exactly one suggestion, and approving it turns off the linked loads.

- [ ] **LOGIC-5: Fix or remove the Gemini enrichment**
  - The prompt asks for a JSON object, but the code only handles a list, so nothing is ever inserted. The `gemini-1.5-flash` model and the `google-generativeai` package are deprecated.
  - Either migrate to the current Google GenAI SDK and model and accept both object and list responses, or remove the feature.
  - **Done when:** a valid model response results in a stored suggestion, or the feature and its dependency are removed.

- [ ] **LOGIC-6: Clean up the PFC loop**
  - `pfc_automation_engine()`: only log when a relay actually changes state (it currently logs every 2 s). Decide whether bank K3 should ever engage (e.g. PF < 0.75) and implement it, or document why not.
  - **Done when:** steady low PF does not spam the log, and K3's behavior is defined.

## P2: Setup and minor issues

- [ ] **MISC-1: Add missing Python dependencies**
  - Add `gpiozero`, `pyserial`, and on Pi 5 `lgpio` to `backend/requirements.txt`.
  - **Done when:** `pip install -r backend/requirements.txt` in a fresh venv followed by `python -c "import serial, gpiozero"` succeeds.

- [ ] **MISC-2: Validate relay_id in /api/relay**
  - Reject IDs outside 1–20 with `400` instead of storing them in `relay_status`.
  - **Done when:** `{"action":"on","relay_id":99}` returns `400`.

- [x] **MISC-3: Fix the mobile pin label** — done 2026-10-22 (uncommitted)
  - `backend/static/mobile.js` reads `device.pin_desc`, but the API returns `pin`.
  - **Done when:** the pin shows on mobile relay cards.

- [ ] **MISC-4: Remove unused stylesheet**
  - `backend/static/styles.css` isn't referenced anywhere (`index.html` uses `styles_v4.css`). Delete it after confirming it's still unused.
  - **Done when:** the file is gone, or it's referenced intentionally.

- [x] **MISC-5: Harden the Android app** — done 2026-09-29 (uncommitted)
  - `MainActivity.java`: replace the hardcoded, temporary `trycloudflare.com` `DEFAULT_URL` (use a named tunnel or prompt on first launch).
  - Only expose the `AndroidREMS` JS bridge to the configured server origin.
  - Disable `usesCleartextTraffic`, or limit it to LAN IPs through a network security config.
  - Replace the deprecated `onBackPressed` with `OnBackPressedDispatcher`.
  - **Done when:** all four points are addressed.

- [x] **MISC-6: Update hardware/README.md** — done 2026-10-14 (uncommitted; full pin tables + KiCad schematic in `hardware/schematic/`)
  - It still shows an old single-sensor WiFi HTTP POST example. Document the actual 11-channel PZEM + CD74HC4067 USB-serial setup and the JSON line format used by `esp32_11_pzem_multiplexer.ino`.
  - **Done when:** the README matches the firmware.

- [x] **MISC-7: Document the GPIO 14/15 UART conflict** — done 2026-10-14 (uncommitted; hardware/README.md §7)
  - HLK zones 1 and 2 use GPIO 14 and 15 (the Pi's UART TX/RX). Add a note to the deploy script or README saying to disable the serial console (`raspi-config` → Interface → Serial) or move those zones.
  - **Done when:** the requirement is documented, or the pins have been moved.

- [x] **MISC-8: AI & Auto tab shows stale PFC/Load mode** — done 2026-10-22 (uncommitted)
  - `backend/templates/mobile.html` has hardcoded `AUTO` in `#mode-status-pfc-2` and `#mode-status-load-2`. `updateModeUI()` in `mobile.js` only updates the Overview labels, so the AI tab says AUTO while the server is MANUAL. The `'AUTO'` fallbacks in `mobile.js` (`pfcMode`/`loadMode` defaults) are also misleading.
  - **Done when:** both tabs show the same mode as `GET /api/relay/status` after load and after toggling.

- [ ] **MISC-9 (manual): Verify relay state during Pi boot**
  - On power-up, Pi GPIO 9–27 default to pull-down. With active-LOW relay inputs, relays on those pins (including PFC banks K1–K3 on GPIO17/27/22) may energize until `app.py` starts.
  - Measure at the relay board while rebooting the Pi. If relays click ON, add `gpio=9-13,16-24,27=op,dh` to `/boot/firmware/config.txt` (see hardware/README.md §7).
  - **Done when:** rebooting the Pi doesn't energize any relay before `app.py` starts.

- [ ] **MISC-10: Keep the pin docs in sync**
  - If `relay_pins`, `HLK_PINS` or the ESP32 pin defines change: run `python3 hardware/schematic/generate_schematic.py`, re-export the PDF/PNG (`kicad-cli sch export pdf`, then `pdftoppm -r 150 -png -singlefile`), confirm `kicad-cli sch erc` shows 0 violations, and update the tables in `hardware/README.md`.
  - **Done when:** this is ongoing; check it off only if the README tables are also generated automatically from code.

## INFRA: Permanent remote access (Cloudflare named tunnel)

Guide: `docs/CLOUDFLARE_TUNNEL.md`. Tasks marked **(manual)** need the owner's Cloudflare account or physical Pi access. Agents can't complete them and should ask the user to confirm instead.

- [x] **INFRA-1: Tunnel setup tooling in repo** — done 2026-09-29 (uncommitted)
  - `deploy/setup-cloudflare-tunnel.sh` (installs cloudflared + `cloudflared` and `rems` systemd services), `start_tunnel.sh` reads the token from `backend/.env`, `/api/tunnel` reports `REMS_PUBLIC_URL`, the APK allows the `*.cloudflareaccess.com` login in the WebView.
  - **Done when:** `bash -n deploy/setup-cloudflare-tunnel.sh` passes and the APK builds.

- [ ] **INFRA-2 (manual): Domain + tunnel created in Cloudflare dashboard**
  - Guide Steps 1–2. Public hostname → `HTTP localhost:5000`.
  - **Done when:** the user has a tunnel token and a hostname like `https://rems.<domain>`.

- [ ] **INFRA-3 (manual): Setup script run on the Pi**
  - Guide Step 3.
  - **Done when:** on the Pi, `systemctl is-active cloudflared rems` prints `active` twice and `curl -s -o /dev/null -w '%{http_code}' https://rems.<domain>/mobile` returns `200` (or `302` once Access is on).

- [ ] **INFRA-4 (manual): Cloudflare Access email login enabled**
  - Guide Step 5. Temporary protection until SEC-1…SEC-5 are done.
  - **Done when:** opening the public URL in a private browser window shows the Cloudflare Access login instead of the dashboard.

- [ ] **INFRA-5 (manual): APK pointed at the permanent URL**
  - Set `DEFAULT_SERVER_URL` in `android_app/app/build.gradle.kts` to the permanent URL, then rebuild. While it's empty, the app runs in **Demo Mode** (bundled UI from `backend/templates/mobile.html` + `backend/static/mobile.*`, simulated API in `android_app/demo/demo-api.js`). Users can switch anytime by long-pressing or via Settings → Configure Server URL (the dialog has a **Demo Mode** button).
  - **Done when:** the app shows live sensor data over mobile data (Wi-Fi off).
