// REMS Mobile Frontend Controller
// Real-time telemetry, relay control, PZEM branches, and AI recommendations

let activeTab = 'overview';
let devicesList = [];
let relayStates = {};
let pfcMode = 'AUTO';
let loadMode = 'AUTO';
let currentFilter = 'all';

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initFilterChips();
    loadDevices();
    pollData();
    pollRelays();
    pollSuggestions();

    // Set polling intervals
    setInterval(pollData, 1500);
    setInterval(pollRelays, 2000);
    setInterval(pollSuggestions, 10000);
    setInterval(updateClock, 1000);
});

// Tab Navigation
function initTabs() {
    const navItems = document.querySelectorAll('.bottom-nav-bar .nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = item.getAttribute('data-tab');
            switchTab(target);
        });
    });
}

function switchTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === `tab-${tabId}`);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Clock updater
function updateClock() {
    const now = new Date();
    const timeEl = document.getElementById('m-current-time');
    if (timeEl) {
        timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
}

// Fetch Devices list from SQLite DB
async function loadDevices() {
    try {
        const res = await fetch('/api/devices');
        if (res.ok) {
            const data = await res.json();
            devicesList = Array.isArray(data) ? data : (data.devices || []);
            renderRelays();
            renderFilterChips();
        }
    } catch (err) {
        console.error("Failed to load devices:", err);
    }
}

// Poll Real-Time Sensor Telemetry
async function pollData() {
    try {
        const res = await fetch('/api/data');
        if (!res.ok) throw new Error("Network response not ok");
        const data = await res.json();
        
        // Update connection status
        setOnlineStatus(true);

        // Update Overview Hero Metrics
        const power = (data.power || 0).toFixed(1);
        const voltage = (data.voltage || 0).toFixed(1);
        const current = (data.current || 0).toFixed(2);
        const energy = (data.energy || 0).toFixed(2);
        const pf = (data.power_factor || 0).toFixed(2);
        const freq = (data.frequency || 60.0).toFixed(1);

        const elPower = document.getElementById('hero-power-val');
        if (elPower) elPower.textContent = power;

        const elVolt = document.getElementById('metric-volt-val');
        if (elVolt) elVolt.textContent = voltage + " V";

        const elCurr = document.getElementById('metric-curr-val');
        if (elCurr) elCurr.textContent = current + " A";

        const elEnergy = document.getElementById('metric-energy-val');
        if (elEnergy) elEnergy.textContent = energy + " kWh";

        const elPf = document.getElementById('metric-pf-val');
        if (elPf) elPf.textContent = pf;

        const elFreq = document.getElementById('metric-freq-val');
        if (elFreq) elFreq.textContent = freq + " Hz";

        // Update PZEM Branches
        if (data.branches) {
            renderBranches(data.branches);
        }
    } catch (err) {
        setOnlineStatus(false);
    }
}

function setOnlineStatus(online) {
    const badge = document.getElementById('sys-status-badge');
    const label = document.getElementById('sys-status-label');
    if (!badge || !label) return;
    if (online) {
        badge.style.background = 'rgba(16, 185, 129, 0.15)';
        badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        badge.style.color = '#10b981';
        label.textContent = 'ONLINE';
    } else {
        badge.style.background = 'rgba(244, 63, 94, 0.15)';
        badge.style.borderColor = 'rgba(244, 63, 94, 0.3)';
        badge.style.color = '#f43f5e';
        label.textContent = 'DISCONNECTED';
    }
}

// Poll Relay States
async function pollRelays() {
    try {
        const res = await fetch('/api/relay/status');
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.success && data.relays) {
            relayStates = data.relays;
            pfcMode = data.pfc_mode || 'AUTO';
            loadMode = data.load_mode || 'AUTO';

            updateModeUI();
            updateRelaySwitches();
        }
    } catch (err) {
        console.error("Relay poll error:", err);
    }
}

// Update Mode indicators
function updateModeUI() {
    const pfcBtn = document.getElementById('mode-btn-pfc');
    const pfcStatus = document.getElementById('mode-status-pfc');
    if (pfcBtn && pfcStatus) {
        pfcStatus.textContent = pfcMode;
        pfcBtn.className = `mode-badge-btn ${pfcMode === 'AUTO' ? 'active-auto' : 'active-manual'}`;
    }

    const loadBtn = document.getElementById('mode-btn-load');
    const loadStatus = document.getElementById('mode-status-load');
    if (loadBtn && loadStatus) {
        loadStatus.textContent = loadMode;
        loadBtn.className = `mode-badge-btn ${loadMode === 'AUTO' ? 'active-auto' : 'active-manual'}`;
    }
}

// Toggle PFC Mode
async function toggleMode(module) {
    const current = module === 'pfc' ? pfcMode : loadMode;
    const newAction = current === 'AUTO' ? 'manual' : 'auto';
    try {
        const res = await fetch('/api/relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: newAction, module: module })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`${module.toUpperCase()} mode set to ${newAction.toUpperCase()}`);
            pollRelays();
        }
    } catch (err) {
        showToast("Failed to switch mode");
    }
}

// Render Filter Chips for Rooms
function renderFilterChips() {
    const container = document.getElementById('filter-chips-container');
    if (!container) return;

    const rooms = new Set(['All']);
    devicesList.forEach(d => {
        if (d.room) rooms.add(d.room.trim());
    });

    container.innerHTML = '';
    rooms.forEach(room => {
        const chip = document.createElement('div');
        chip.className = `filter-chip ${currentFilter.toLowerCase() === room.toLowerCase() ? 'active' : ''}`;
        chip.textContent = room;
        chip.addEventListener('click', () => {
            currentFilter = room;
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderRelays();
        });
        container.appendChild(chip);
    });
}

function initFilterChips() {
    // Chips populated dynamically in renderFilterChips()
}

// Render Relay List
function renderRelays() {
    const list = document.getElementById('relay-cards-list');
    if (!list) return;

    // Filter by room
    const filtered = devicesList.filter(d => {
        if (currentFilter === 'All' || currentFilter === 'all') return true;
        return (d.room && d.room.toLowerCase() === currentFilter.toLowerCase());
    });

    list.innerHTML = '';
    filtered.forEach(device => {
        const relayId = device.id;
        const state = (relayStates[relayId] === 'ON');

        const card = document.createElement('div');
        card.className = `relay-item-card ${state ? 'is-on' : ''}`;
        card.id = `relay-card-${relayId}`;

        card.innerHTML = `
            <div class="relay-info-box">
                <div class="relay-id-indicator">#${relayId}</div>
                <div class="relay-name-room">
                    <h3>${device.name || `Load ${relayId}`}</h3>
                    <div class="relay-meta">
                        <span class="relay-room-pill">${device.room || 'General'}</span>
                        <span>• ${device.pin_desc || ''}</span>
                    </div>
                </div>
            </div>
            <label class="switch-control">
                <input type="checkbox" id="switch-relay-${relayId}" ${state ? 'checked' : ''} onchange="toggleRelay(${relayId}, this.checked)">
                <span class="slider-knob"></span>
            </label>
        `;
        list.appendChild(card);
    });
}

function updateRelaySwitches() {
    devicesList.forEach(device => {
        const id = device.id;
        const state = (relayStates[id] === 'ON');
        const input = document.getElementById(`switch-relay-${id}`);
        const card = document.getElementById(`relay-card-${id}`);
        if (input && input.checked !== state) {
            input.checked = state;
        }
        if (card) {
            card.classList.toggle('is-on', state);
        }
    });
}

// Send Relay Toggle Command
async function toggleRelay(id, state) {
    const action = state ? 'on' : 'off';
    try {
        const res = await fetch('/api/relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relay_id: id, action: action })
        });
        const data = await res.json();
        if (data.success) {
            relayStates[id] = state ? 'ON' : 'OFF';
            updateRelaySwitches();
            showToast(`Relay #${id} turned ${action.toUpperCase()}`);
        } else {
            showToast(`Error: ${data.message || 'Action failed'}`);
            pollRelays();
        }
    } catch (err) {
        showToast("Connection failed");
        pollRelays();
    }
}

// Bulk Controls
async function setAllRelays(state) {
    if (!confirm(`Are you sure you want to turn ${state ? 'ON' : 'OFF'} ALL relays?`)) return;

    showToast(`Turning ${state ? 'ON' : 'OFF'} all loads...`);
    for (const d of devicesList) {
        await toggleRelay(d.id, state);
    }
}

// Emergency Cutoff
async function emergencyCutoff() {
    if (!confirm("⚠️ EMERGENCY CUTOFF: Turn OFF ALL 20 relays immediately?")) return;
    showToast("EMERGENCY CUTOFF TRIGGERED");
    for (let i = 1; i <= 20; i++) {
        await fetch('/api/relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relay_id: i, action: 'off' })
        });
    }
    pollRelays();
}

// Render 11 PZEM Branches
function renderBranches(branches) {
    const container = document.getElementById('branches-list');
    if (!container) return;

    let html = '';
    for (let ch = 0; ch <= 10; ch++) {
        const key = `C${ch}`;
        const b = branches[key] || {
            name: ch === 0 ? "Main Panel (C0)" : `Branch ${ch} (C${ch})`,
            status: "STANDBY",
            voltage: 0,
            current: 0,
            power: 0,
            energy: 0
        };

        const isOnline = (b.status === 'ONLINE');

        html += `
            <div class="branch-card">
                <div class="branch-top">
                    <div class="branch-title">
                        <i class="ph-fill ph-lightning" style="color: ${isOnline ? 'var(--primary)' : 'var(--text-muted)'}"></i>
                        <span>${b.name}</span>
                    </div>
                    <span class="branch-status-tag ${isOnline ? 'online' : 'standby'}">${b.status}</span>
                </div>
                <div class="branch-readings-row">
                    <div class="branch-metric">
                        <span class="lbl">Power</span>
                        <span class="num" style="color: var(--primary)">${(b.power || 0).toFixed(1)}W</span>
                    </div>
                    <div class="branch-metric">
                        <span class="lbl">Voltage</span>
                        <span class="num">${(b.voltage || 0).toFixed(1)}V</span>
                    </div>
                    <div class="branch-metric">
                        <span class="lbl">Current</span>
                        <span class="num">${(b.current || 0).toFixed(2)}A</span>
                    </div>
                    <div class="branch-metric">
                        <span class="lbl">Energy</span>
                        <span class="num">${(b.energy || 0).toFixed(2)}k</span>
                    </div>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

// Poll AI Suggestions
async function pollSuggestions() {
    try {
        const res = await fetch('/api/suggestions');
        if (!res.ok) return;
        const list = await res.json();
        renderSuggestions(list);
    } catch (err) {
        console.error("Suggestions error:", err);
    }
}

function renderSuggestions(list) {
    const container = document.getElementById('ai-suggestions-list');
    if (!container) return;

    if (!list || list.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding: 24px 12px; color: var(--text-muted); font-size: 12px;">
                <i class="ph ph-sparkle" style="font-size: 28px; color: var(--accent-cyan); display:block; margin-bottom:8px;"></i>
                All energy systems operating efficiently. No pending recommendations.
            </div>
        `;
        return;
    }

    let html = '';
    list.forEach(s => {
        html += `
            <div class="suggestion-card">
                <div class="sugg-header">
                    <i class="ph-fill ph-sparkle"></i>
                    <h4 class="sugg-title">${s.message || s.title || 'Optimization Opportunity'}</h4>
                </div>
                <p class="sugg-desc">
                    ${s.potential_savings ? `<span style="color:var(--primary); font-weight:600;">Savings: ${s.potential_savings}</span><br>` : ''}
                    <span style="font-size:11px; color:var(--text-muted);">Priority: ${s.priority || 'Medium'} • Confidence: ${s.confidence || 'High'}</span>
                </p>
                <div class="sugg-actions">
                    <button class="btn-sugg btn-sugg-apply" onclick="applySuggestion(${s.id})">Approve Action</button>
                    <button class="btn-sugg btn-sugg-dismiss" onclick="dismissSuggestion(${s.id})">Reject</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

async function applySuggestion(id) {
    try {
        const res = await fetch(`/api/suggestions/${id}/approve`, { method: 'POST' });
        if (res.ok) {
            showToast("Recommendation Approved");
            pollSuggestions();
            pollRelays();
        }
    } catch (err) {
        showToast("Failed to apply recommendation");
    }
}

async function dismissSuggestion(id) {
    try {
        const res = await fetch(`/api/suggestions/${id}/reject`, { method: 'POST' });
        if (res.ok) {
            showToast("Suggestion Rejected");
            pollSuggestions();
        }
    } catch (err) {
        showToast("Failed to dismiss");
    }
}

// Toast notification helper
function showToast(msg) {
    let toast = document.getElementById('mobile-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'mobile-toast';
        toast.className = 'toast-notice';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="ph-fill ph-check-circle" style="color:var(--primary); font-size:16px;"></i> <span>${msg}</span>`;
    toast.classList.add('show');
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 2400);
}

// Server URL re-configuration bridge
function configureServerUrl() {
    if (window.AndroidREMS && typeof window.AndroidREMS.openServerConfig === 'function') {
        window.AndroidREMS.openServerConfig();
    } else {
        const current = window.location.origin;
        const newUrl = prompt("Enter Raspberry Pi IP or Cloudflare Tunnel URL:", current);
        if (newUrl && newUrl.trim() !== "") {
            let target = newUrl.trim();
            if (!target.startsWith("http://") && !target.startsWith("https://")) {
                target = "https://" + target;
            }
            window.location.href = target.replace(/\/+$/, "") + "/mobile";
        }
    }
}
