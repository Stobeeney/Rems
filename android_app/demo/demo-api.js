// REMCS Demo Mode: in-browser stand-in for the Flask backend.
// Bundled into the APK only. Intercepts fetch('/api/...') so mobile.js runs unchanged
// with simulated PZEM telemetry, relay control, PFC automation, and AI suggestions.
(function () {
    'use strict';

    const DEVICES = [
        [1, "PFC Capacitor Bank 1 (K1)", "Main Panel", "Pin 11 (GPIO 17)"],
        [2, "PFC Capacitor Bank 2 (K2)", "Main Panel", "Pin 13 (GPIO 27)"],
        [3, "PFC Capacitor Bank 3 (K3)", "Main Panel", "Pin 15 (GPIO 22)"],
        [4, "Living Room Lights", "Living Room", "Pin 7 (GPIO 4)"],
        [5, "Living Room TV", "Living Room", "Pin 29 (GPIO 5)"],
        [6, "Outlet Group 1", "Living Room", "Pin 31 (GPIO 6)"],
        [7, "Air Conditioner Main (ACU)", "Master Bedroom", "Pin 26 (GPIO 7)"],
        [8, "Bedroom 1 Lights", "Master Bedroom", "Pin 24 (GPIO 8)"],
        [9, "Bedroom 1 Outlet Group 2", "Master Bedroom", "Pin 21 (GPIO 9)"],
        [10, "Refrigerator (Critical)", "Kitchen", "Pin 19 (GPIO 10)"],
        [11, "Kitchen Outlets", "Kitchen", "Pin 23 (GPIO 11)"],
        [12, "Water Heater", "Bathroom", "Pin 32 (GPIO 12)"],
        [13, "Washing Machine", "Laundry Area", "Pin 33 (GPIO 13)"],
        [14, "Microwave Oven", "Kitchen", "Pin 36 (GPIO 16)"],
        [15, "Garage Door & Lights", "Garage", "Pin 12 (GPIO 18)"],
        [16, "Dining Room Lighting", "Dining Room", "Pin 35 (GPIO 19)"],
        [17, "Outdoor Security Lights", "Outdoor / Garden", "Pin 38 (GPIO 20)"],
        [18, "CCTV / Security NVR", "Main Panel", "Pin 40 (GPIO 21)"],
        [19, "Standby Outlets", "Living Room", "Pin 16 (GPIO 23)"],
        [20, "Air Conditioner Bedroom 2 (ACU 2)", "Bedroom 2", "Pin 18 (GPIO 24)"]
    ].map(([id, name, room, pin]) => ({
        id, name, room, pin, power: 0, sensor_linked: id === 4,
        three_way: [4, 8, 15, 16, 17].includes(id), aircon: id === 7 || id === 20, sensed: id >= 4 && id <= 13
    }));
    const ROOMS = ["Living Room", "Master Bedroom", "Bedroom 2", "Kitchen", "Dining Room", "Bathroom",
        "Garage", "Outdoor / Garden", "Hallway", "Laundry Area", "Main Panel"];

    // Electrical 3-way lights: the lamp is lit when relay position and wall switch differ
    const THREE_WAY = [4, 8, 15, 16, 17];
    const wallSwitch = {};
    THREE_WAY.forEach(id => { wallSwitch[id] = false; });
    const isOn = id => THREE_WAY.includes(id) ? relays[id] !== wallSwitch[id] : relays[id];

    // Typical draw (W) and power factor per relay load
    const LOADS = {
        4: [60, 0.95], 5: [110, 0.90], 6: [180, 0.85], 7: [950, 0.78], 8: [40, 0.97],
        9: [90, 0.92], 10: [150, 0.80], 11: [220, 0.88], 12: [600, 0.99], 13: [450, 0.75],
        14: [800, 0.95], 15: [70, 0.90], 16: [50, 0.96], 17: [80, 0.93], 18: [25, 0.90],
        19: [15, 0.60], 20: [850, 0.78]
    };
    const BANK_KVAR = 250; // reactive power each capacitor bank compensates

    const relays = {};
    for (let i = 1; i <= 20; i++) relays[i] = false;
    [4, 5, 7, 10, 11, 13, 18].forEach(i => { relays[i] = true; });

    let pfcAuto = false;
    let loadAuto = false;
    let systemMode = "MANUAL";
    const energy = {};
    for (let ch = 0; ch <= 10; ch++) energy[ch] = 5 + Math.random() * 35;
    let lastTick = Date.now();

    let nextSuggestionId = 3;
    let suggestions = [
        { id: 1, message: "Standby power leakage detected on Relay #5 (107.6W) during sustained vacancy. Turn OFF to conserve energy?",
          confidence: "High (94%)", priority: "Medium", potential_savings: "~25.8 kWh/mo (₱309.89/mo)", status: "pending", target_relay: 5 },
        { id: 2, message: "Low Power Factor (0.81) detected under active load. Engage Capacitor Bank K1 to improve power quality?",
          confidence: "High (98%)", priority: "High", potential_savings: "Voltage Stabilization & Loss Reduction", status: "pending", target_relay: 1 }
    ];

    const rand = (a, b) => a + Math.random() * (b - a);
    const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
    const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

    function setRelay(id, on) {
        if (on && (id === 7 || id === 20)) [1, 2, 3].forEach(c => { relays[c] = false; }); // ACU interlock
        if (on && [1, 2, 3].includes(id) && (relays[7] || relays[20])) {
            return { success: false, message: "ACU Interlock Active: Cannot energize Capacitor Banks while an aircon is running." };
        }
        if (THREE_WAY.includes(id)) {
            if (isOn(id) !== on) relays[id] = !relays[id];
        } else {
            relays[id] = on;
        }
        return { success: true, status: on ? "ON" : "OFF", note: "Demo mode" };
    }

    function lightsMap() {
        const out = {};
        THREE_WAY.forEach(id => {
            const sensed = id >= 4 && id <= 13;
            const state = sensed ? isOn(id) : relays[id];
            out[String(id)] = { state: state ? "ON" : "OFF", sensed, current: sensed ? (state ? 0.25 : 0) : null };
        });
        return out;
    }

    function telemetry() {
        const now = Date.now();
        const dtHours = (now - lastTick) / 3_600_000;
        lastTick = now;

        const voltage = rand(226, 230);
        const freq = rand(59.95, 60.05);
        const branches = {};
        let totalP = 35, totalQ = 15; // always-on base load

        for (let r = 4; r <= 20; r++) {
            if (!isOn(r)) continue;
            const [w, pf] = LOADS[r];
            const p = w * rand(0.92, 1.08);
            totalP += p;
            totalQ += p * Math.sqrt(1 / (pf * pf) - 1);
        }
        const banks = [1, 2, 3].filter(c => relays[c]).length;
        totalQ = Math.max(0, totalQ - banks * BANK_KVAR);

        // Branches C1..C10 follow relays 4..13
        for (let ch = 1; ch <= 10; ch++) {
            const r = ch + 3;
            const on = isOn(r);
            const [w, pf] = LOADS[r];
            const p = on ? w * rand(0.92, 1.08) : 0;
            const pfCh = on ? Math.min(1, pf + rand(-0.02, 0.02)) : 0;
            energy[ch] += p * dtHours / 1000;
            branches[`C${ch}`] = {
                channel: ch, name: `Branch ${ch} (C${ch})`, status: "ONLINE",
                voltage: round(voltage, 1), current: on ? round(p / (voltage * pfCh), 2) : 0,
                power: round(p, 1), power_factor: round(pfCh, 2), frequency: round(freq, 1),
                energy: round(energy[ch], 2), last_updated: stamp()
            };
        }

        const s = Math.hypot(totalP, totalQ);
        const mainPf = totalP / s;
        energy[0] += totalP * dtHours / 1000;
        const main = {
            channel: 0, name: "Main Panel (C0)", status: "ONLINE",
            voltage: round(voltage, 1), current: round(s / voltage, 2), power: round(totalP, 1),
            power_factor: round(mainPf, 2), frequency: round(freq, 1), energy: round(energy[0], 2), last_updated: stamp()
        };
        branches.C0 = main;

        // PFC automation (mirrors backend pfc_automation_engine)
        if (pfcAuto) {
            if (relays[7]) {
                [1, 2, 3].forEach(c => { relays[c] = false; });
            } else if (totalP > 50 && mainPf < 0.97) {
                const want = mainPf < 0.85 ? [1, 2] : [1];
                want.forEach(c => { relays[c] = true; });
            } else if (mainPf >= 0.97 || totalP < 25) {
                [1, 2, 3].forEach(c => { relays[c] = false; });
            }
        }

        return {
            voltage: main.voltage, current: main.current, power: main.power, power_factor: main.power_factor,
            frequency: main.frequency, energy: main.energy, last_updated: main.last_updated,
            branches, system_mode: systemMode,
            pfc_auto: pfcAuto, load_auto: loadAuto, sensor_linked_relays: [4],
            relays: relayMap(), lights: lightsMap()
        };
    }

    function relayMap() {
        const out = {};
        for (let i = 1; i <= 20; i++) out[String(i)] = relays[i] ? "ON" : "OFF";
        return out;
    }

    function maybeAddSuggestion() {
        const pending = suggestions.filter(s => s.status === 'pending');
        if (pending.length >= 3 || Math.random() > 0.15) return;
        const candidates = [4, 6, 8, 9, 11, 15, 16, 17, 19].filter(r => isOn(r) && !pending.some(s => s.target_relay === r));
        if (!candidates.length) return;
        const r = candidates[Math.floor(Math.random() * candidates.length)];
        const w = LOADS[r][0] * rand(0.9, 1.1);
        const kwh = w * 8 * 30 / 1000;
        suggestions.unshift({
            id: nextSuggestionId++, status: "pending", target_relay: r, priority: "Medium", confidence: "High (94%)",
            message: `Standby power leakage detected on Relay #${r} (${w.toFixed(1)}W) during sustained vacancy. Turn OFF to conserve energy?`,
            potential_savings: `~${kwh.toFixed(1)} kWh/mo (₱${(kwh * 12).toFixed(2)}/mo)`, timestamp: stamp()
        });
    }

    function handle(method, path, body) {
        if (method === 'GET' && path === '/api/data') return [200, telemetry()];
        if (method === 'GET' && path === '/api/devices') return [200, { success: true, devices: DEVICES, rooms: ROOMS }];
        if (method === 'GET' && path === '/api/relay/status') {
            const mode = pfcAuto ? "AUTO" : "MANUAL";
            return [200, { success: true, mode, pfc_mode: mode, load_mode: loadAuto ? "AUTO" : "MANUAL", relays: relayMap(), lights: lightsMap() }];
        }
        if (method === 'GET' && path === '/api/pzem/branches') return [200, telemetry().branches];
        if (method === 'GET' && path === '/api/mode') {
            return [200, { success: true, mode: systemMode, pfc_auto: pfcAuto, load_auto: loadAuto }];
        }
        if (method === 'POST' && path === '/api/mode') {
            const mode = String(body.mode || '').toUpperCase();
            if (!['MANUAL', 'AI_ASSISTED', 'SECURITY'].includes(mode)) {
                return [400, { success: false, message: "Invalid mode. Choose MANUAL, AI_ASSISTED, or SECURITY" }];
            }
            systemMode = mode;
            pfcAuto = loadAuto = mode === 'AI_ASSISTED';
            if (mode === 'SECURITY') {
                for (let r = 4; r <= 20; r++) if (![10, 18].includes(r)) setRelay(r, false);
            }
            return [200, { success: true, mode }];
        }
        if (method === 'POST' && path === '/api/devices/update') {
            const dev = DEVICES.find(d => d.id === parseInt(body.id, 10));
            if (!dev) return [400, { success: false, message: "Unknown device" }];
            const name = body.name != null ? String(body.name).trim() : null;
            if (name !== null && (!name || name.length > 40)) {
                return [400, { success: false, message: "Name must be 1-40 characters" }];
            }
            if (body.room != null && !ROOMS.includes(body.room)) return [400, { success: false, message: "Invalid room" }];
            if (name) dev.name = name;
            if (body.room) dev.room = body.room;
            return [200, { success: true, message: `Device ${dev.id} updated successfully` }];
        }
        if (method === 'GET' && path === '/api/suggestions') {
            maybeAddSuggestion();
            return [200, suggestions.filter(s => s.status === 'pending')];
        }
        if (method === 'GET' && path === '/api/tunnel') return [200, { active: false, url: null, mobile_url: null }];

        if (method === 'POST' && path === '/api/relay') {
            const action = String(body.action || '').toLowerCase();
            const module = body.module || 'pfc';
            if (action === 'auto' || action === 'manual') {
                const on = action === 'auto';
                if (module === 'pfc' || module === 'both') pfcAuto = on;
                if (module === 'load' || module === 'both') loadAuto = on;
                return [200, { success: true, mode: on ? "AUTO" : "MANUAL" }];
            }
            const id = parseInt(body.relay_id, 10);
            if (!(id >= 1 && id <= 20)) return [400, { success: false, message: "Invalid relay_id" }];
            if (action === 'toggle') {
                if (!THREE_WAY.includes(id)) return [400, { success: false, message: "Toggle is only for 3-way lights" }];
                relays[id] = !relays[id];
                return [200, { success: true, toggled: true, note: "Demo mode" }];
            }
            const res = setRelay(id, action === 'on');
            return [res.success ? 200 : 400, res];
        }

        const m = path.match(/^\/api\/suggestions\/(\d+)\/(approve|apply|reject|dismiss)$/);
        if (method === 'POST' && m) {
            const s = suggestions.find(x => x.id === Number(m[1]));
            const approve = m[2] === 'approve' || m[2] === 'apply';
            if (s) {
                if (approve) {
                    if (s.target_relay === 1) {
                        const res = setRelay(1, true);
                        if (!res.success) return [400, res];
                    } else if (s.target_relay >= 4 && ![10, 18].includes(s.target_relay)) {
                        setRelay(s.target_relay, false);
                    }
                }
                s.status = approve ? 'approve' : 'reject';
            }
            return [200, { success: true, message: `Suggestion ${approve ? 'approve' : 'reject'}ed successfully` }];
        }

        return [404, { success: false, message: `Demo mode: ${method} ${path} not simulated` }];
    }

    const realFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
        if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
            return realFetch(input, init);
        }
        const method = ((init && init.method) || 'GET').toUpperCase();
        let body = {};
        try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) { /* non-JSON body */ }
        const [status, payload] = handle(method, url.pathname, body);
        const response = new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
        return new Promise(resolve => setTimeout(() => resolve(response), 60 + Math.random() * 90));
    };

    // Label the UI as demo data, and hide links that need the real server
    document.addEventListener('DOMContentLoaded', () => {
        const original = window.setOnlineStatus;
        if (typeof original === 'function') {
            window.setOnlineStatus = function (online) {
                original(online);
                const badge = document.getElementById('sys-status-badge');
                const label = document.getElementById('sys-status-label');
                if (online && badge && label) {
                    label.textContent = 'DEMO';
                    badge.style.background = 'rgba(245, 158, 11, 0.15)';
                    badge.style.borderColor = 'rgba(245, 158, 11, 0.35)';
                    badge.style.color = '#f59e0b';
                }
            };
        }
        document.querySelectorAll('a[href^="/?desktop"]').forEach(a => { a.style.display = 'none'; });
    });
})();
