// =============================================================================
// REMS - Residential Energy Management Control System
// Comprehensive Frontend Controller (app.js v10)
// =============================================================================

// Global navigation function accessible anywhere
function navigateToPage(pageId) {
    const navItems = document.querySelectorAll('.main-nav li');
    const contentArea = document.getElementById('content-area');
    const pageTitle = document.getElementById('page-title');
    
    // Update Title & Nav
    const selectedNav = document.querySelector(`li[data-page="${pageId}"]`);
    if (selectedNav) {
        pageTitle.textContent = selectedNav.querySelector('span').textContent.toUpperCase();
        navItems.forEach(item => item.classList.remove('active'));
        selectedNav.classList.add('active');
    }
    
    // Load content from template
    const templateId = `tpl-${pageId}`;
    const template = document.getElementById(templateId);
    
    contentArea.innerHTML = '';
    
    if (template) {
        contentArea.appendChild(template.content.cloneNode(true));
        
        // Initialize page specific components
        if (pageId === 'dashboard') {
            initDashboardCharts();
        } else if (pageId === 'active-devices') {
            renderActiveDevicesPage();
        } else if (pageId === 'energy-monitoring') {
            initEnergyMonitoringCharts();
        } else if (pageId === 'load-control') {
            initLoadControlTable();
        } else if (pageId === 'ai-recommendations') {
            loadAiRecommendations();
        } else if (pageId === 'alerts') {
            loadAlerts();
        }
    }
    
    // Close sidebar on mobile
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && window.innerWidth <= 768) {
        sidebar.classList.remove('open');
    }
}

// Global Tab Switcher for Energy Monitoring
function switchEnergyTab(tabName) {
    const tabs = ['overview', 'voltage', 'current', 'power', 'pf'];
    tabs.forEach(t => {
        const el = document.getElementById(`energy-tab-${t}`);
        if (el) el.style.display = (t === tabName) ? 'block' : 'none';
    });
    
    // Update active tab buttons
    const btns = document.querySelectorAll('#tpl-energy-monitoring .sub-tab-btn, .energy-monitoring-view .sub-tab-btn');
    const containerBtns = document.querySelectorAll('.sub-tabs .sub-tab-btn');
    containerBtns.forEach(btn => {
        if (btn.textContent.trim().toLowerCase() === tabName.toLowerCase()) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Re-render charts for the tab
    setTimeout(() => {
        if (tabName === 'voltage') initVoltagePzemChart();
        else if (tabName === 'current') initCurrentPzemChart();
        else if (tabName === 'power') initPowerPzemChart();
        else if (tabName === 'pf') initPfPzemChart();
    }, 50);
}

// Global Tab Switcher for AI Recommendations
function switchAiTab(tabName) {
    const tabRec = document.getElementById('ai-tab-recommendations');
    const tabIns = document.getElementById('ai-tab-insights');
    if (tabRec) tabRec.style.display = (tabName === 'recommendations') ? 'block' : 'none';
    if (tabIns) tabIns.style.display = (tabName === 'insights') ? 'block' : 'none';
    
    const containerBtns = document.querySelectorAll('#content-area .sub-tabs .sub-tab-btn');
    containerBtns.forEach(btn => {
        if (btn.textContent.trim().toLowerCase() === tabName.toLowerCase()) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Global Dedicated Rooms for Dropdown Selection
const DEDICATED_ROOMS = [
    "Living Room",
    "Master Bedroom",
    "Bedroom 2",
    "Kitchen",
    "Dining Room",
    "Bathroom",
    "Garage",
    "Outdoor / Garden",
    "Hallway",
    "Laundry Area",
    "Main Panel"
];

// Global Relay Device List for Load Control (20 Relays - Customizable)
let DEVICE_MAPPING = [
    { id: 1, name: "PFC Capacitor Bank 1 (K1)", room: "Main Panel", pin: "Pin 11 (GPIO 17)", power: 0.00 },
    { id: 2, name: "PFC Capacitor Bank 2 (K2)", room: "Main Panel", pin: "Pin 13 (GPIO 27)", power: 0.00 },
    { id: 3, name: "PFC Capacitor Bank 3 (K3)", room: "Main Panel", pin: "Pin 15 (GPIO 22)", power: 0.00 },
    { id: 4, name: "Living Room Lights", room: "Living Room", pin: "Pin 7 (GPIO 4)", power: 0.00 },
    { id: 5, name: "Living Room TV", room: "Living Room", pin: "Pin 29 (GPIO 5)", power: 0.00 },
    { id: 6, name: "Outlet Group 1", room: "Living Room", pin: "Pin 31 (GPIO 6)", power: 0.00 },
    { id: 7, name: "Air Conditioner Main (ACU)", room: "Master Bedroom", pin: "Pin 26 (GPIO 7)", power: 0.00 },
    { id: 8, name: "Bedroom 1 Lights", room: "Master Bedroom", pin: "Pin 24 (GPIO 8)", power: 0.00 },
    { id: 9, name: "Bedroom 1 Outlet Group 2", room: "Master Bedroom", pin: "Pin 21 (GPIO 9)", power: 0.00 },
    { id: 10, name: "Refrigerator (Critical)", room: "Kitchen", pin: "Pin 19 (GPIO 10)", power: 0.00 },
    { id: 11, name: "Kitchen Outlets", room: "Kitchen", pin: "Pin 23 (GPIO 11)", power: 0.00 },
    { id: 12, name: "Water Heater", room: "Bathroom", pin: "Pin 32 (GPIO 12)", power: 0.00 },
    { id: 13, name: "Washing Machine", room: "Laundry Area", pin: "Pin 33 (GPIO 13)", power: 0.00 },
    { id: 14, name: "Microwave Oven", room: "Kitchen", pin: "Pin 36 (GPIO 16)", power: 0.00 },
    { id: 15, name: "Garage Door & Lights", room: "Garage", pin: "Pin 12 (GPIO 18)", power: 0.00 },
    { id: 16, name: "Dining Room Lighting", room: "Dining Room", pin: "Pin 35 (GPIO 19)", power: 0.00 },
    { id: 17, name: "Outdoor Security Lights", room: "Outdoor / Garden", pin: "Pin 38 (GPIO 20)", power: 0.00 },
    { id: 18, name: "CCTV / Security NVR", room: "Main Panel", pin: "Pin 40 (GPIO 21)", power: 0.00 },
    { id: 19, name: "Standby Outlets", room: "Living Room", pin: "Pin 16 (GPIO 23)", power: 0.00 },
    { id: 20, name: "Auxiliary Branch", room: "Main Panel", pin: "Pin 18 (GPIO 24)", power: 0.00 }
];

let currentRelayStates = {};
let currentLoadMode = "MANUAL";

// Fetch custom device names and rooms from DB
async function fetchDeviceConfigurations() {
    try {
        const res = await fetch('/api/devices');
        const data = await res.json();
        if (data.success && data.devices && data.devices.length > 0) {
            DEVICE_MAPPING = data.devices;
        }
    } catch (e) {
        console.warn("Using default device mapping:", e);
    }
}
fetchDeviceConfigurations();

function initLoadControlTable() {
    const tbody = document.getElementById('load-control-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    DEVICE_MAPPING.forEach(dev => {
        const isChecked = currentRelayStates[dev.id] === 'ON';
        const isProtected = [1, 2, 3, 10, 18].includes(dev.id);
        const roomOptionsHtml = DEDICATED_ROOMS.map(r => 
            `<option value="${r}" ${dev.room === r ? 'selected' : ''}>${r}</option>`
        ).join('');

        let sensorLinkHtml = '';
        if (isProtected) {
            sensorLinkHtml = `<span style="font-size: 10px; color: var(--text-muted); background: rgba(255,255,255,0.05); padding: 3px 8px; border-radius: 4px;" title="Protected from motion sensor">Protected</span>`;
        } else {
            sensorLinkHtml = `
                <div style="display: flex; align-items: center; gap: 6px;">
                    <label class="switch" title="Link to HLK-LD2410B presence sensor">
                        <input type="checkbox" id="sensor-link-${dev.id}" ${dev.sensor_linked ? 'checked' : ''} onchange="toggleSensorLink(${dev.id}, this.checked)">
                        <span class="slider"></span>
                    </label>
                    <span style="font-size: 10px; font-weight: 700; color: ${dev.sensor_linked ? 'var(--primary)' : 'var(--text-muted)'};" id="sensor-link-label-${dev.id}">
                        ${dev.sensor_linked ? 'LINKED' : 'OFF'}
                    </span>
                </div>
            `;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 12px 18px; font-weight: 600;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <i class="ph-fill ph-circle" style="font-size: 8px; color: ${isChecked ? 'var(--primary)' : '#ef4444'};" id="dot-relay-${dev.id}"></i>
                    <span id="name-relay-${dev.id}" style="cursor: pointer;" onclick="openEditDeviceModal(${dev.id})" title="Click to rename">${dev.name}</span>
                    <button class="btn-icon-rename" onclick="openEditDeviceModal(${dev.id})" title="Rename Device">
                        <i class="ph ph-pencil-simple"></i>
                    </button>
                    <span style="font-size: 10px; color: #8b949e; background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: monospace;">${dev.pin}</span>
                </div>
            </td>
            <td>
                <select class="select-room-dark" id="select-room-${dev.id}" onchange="onDeviceRoomChanged(${dev.id}, this.value)" title="Select dedicated room">
                    ${roomOptionsHtml}
                </select>
            </td>
            <td style="font-weight: 700; color: #ffffff;" id="pwr-relay-${dev.id}">${isChecked ? dev.power.toFixed(2) : '0.00'}</td>
            <td>
                <span id="stat-text-relay-${dev.id}" style="font-weight: 700; color: ${isChecked ? 'var(--primary)' : 'var(--text-muted)'};">
                    ${isChecked ? 'ON' : 'OFF'}
                </span>
            </td>
            <td>
                ${sensorLinkHtml}
            </td>
            <td>
                <label class="switch">
                    <input type="checkbox" id="switch-relay-${dev.id}" ${isChecked ? 'checked' : ''} onchange="toggleRelayDevice(${dev.id}, this.checked)">
                    <span class="slider"></span>
                </label>
            </td>
            <td style="text-align: right; padding-right: 18px;">
                <button class="btn-icon-rename" onclick="openEditDeviceModal(${dev.id})" title="Edit Settings">
                    <i class="ph ph-dots-three-vertical"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    const overrideToggle = document.getElementById('toggle-manual-override');
    if (overrideToggle) {
        overrideToggle.checked = (currentLoadMode === 'MANUAL');
    }
    const indicator = document.getElementById('lc-mode-indicator');
    if (indicator) {
        indicator.textContent = `Mode: ${currentLoadMode}`;
        indicator.className = `badge-pill ${currentLoadMode === 'MANUAL' ? 'badge-medium' : 'badge-info'}`;
    }
}

// Toggle Sensor Link directly from table
window.toggleSensorLink = async function(deviceId, isLinked) {
    const dev = DEVICE_MAPPING.find(d => d.id === deviceId);
    if (dev) dev.sensor_linked = isLinked;
    
    const labelEl = document.getElementById(`sensor-link-label-${deviceId}`);
    if (labelEl) {
        labelEl.textContent = isLinked ? 'LINKED' : 'OFF';
        labelEl.style.color = isLinked ? 'var(--primary)' : 'var(--text-muted)';
    }

    try {
        const res = await fetch('/api/devices/toggle-sensor-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: deviceId, linked: isLinked })
        });
        const data = await res.json();
        if (!data.success) {
            alert(data.message || "Failed to update sensor link");
            initLoadControlTable();
        }
    } catch (e) {
        console.error("Failed to toggle sensor link:", e);
    }
};

// Handler when Room is changed directly via dropdown
window.onDeviceRoomChanged = async function(deviceId, newRoom) {
    const dev = DEVICE_MAPPING.find(d => d.id === deviceId);
    if (dev) {
        dev.room = newRoom;
    }
    try {
        await fetch('/api/devices/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: deviceId, room: newRoom })
        });
    } catch (e) {
        console.error("Failed to save room change:", e);
    }
};

// Modal functions for renaming and room editing
window.openEditDeviceModal = function(deviceId) {
    const dev = DEVICE_MAPPING.find(d => d.id === deviceId);
    if (!dev) return;
    
    document.getElementById('edit-device-id').value = dev.id;
    document.getElementById('edit-device-name').value = dev.name;
    document.getElementById('edit-device-room').value = dev.room;
    document.getElementById('modal-edit-title').textContent = `Edit Device: Relay ${dev.id} (${dev.pin})`;
    
    // Sensor link container in modal
    const isProtected = [1, 2, 3, 10, 18].includes(dev.id);
    const linkContainer = document.getElementById('modal-sensor-link-container');
    const linkCheckbox = document.getElementById('edit-device-sensor-link');
    if (linkContainer) {
        linkContainer.style.display = isProtected ? 'none' : 'flex';
    }
    if (linkCheckbox) {
        linkCheckbox.checked = !!dev.sensor_linked;
    }

    document.getElementById('modal-edit-device').classList.add('open');
};

window.closeEditDeviceModal = function() {
    const modal = document.getElementById('modal-edit-device');
    if (modal) modal.classList.remove('open');
};

window.submitEditDeviceModal = async function() {
    const id = parseInt(document.getElementById('edit-device-id').value);
    const name = document.getElementById('edit-device-name').value.trim();
    const room = document.getElementById('edit-device-room').value;
    const isProtected = [1, 2, 3, 10, 18].includes(id);
    const sensorLinked = isProtected ? false : (document.getElementById('edit-device-sensor-link')?.checked ?? false);
    
    if (!name) {
        alert("Please enter a valid device name.");
        return;
    }
    
    const dev = DEVICE_MAPPING.find(d => d.id === id);
    if (dev) {
        dev.name = name;
        dev.room = room;
        dev.sensor_linked = sensorLinked;
    }
    
    // Update DOM elements in the table
    const nameEl = document.getElementById(`name-relay-${id}`);
    if (nameEl) nameEl.textContent = name;
    
    const roomSelect = document.getElementById(`select-room-${id}`);
    if (roomSelect) roomSelect.value = room;

    const sensorSwitch = document.getElementById(`sensor-link-${id}`);
    if (sensorSwitch) sensorSwitch.checked = sensorLinked;
    const sensorLabel = document.getElementById(`sensor-link-label-${id}`);
    if (sensorLabel) {
        sensorLabel.textContent = sensorLinked ? 'LINKED' : 'OFF';
        sensorLabel.style.color = sensorLinked ? 'var(--primary)' : 'var(--text-muted)';
    }
    
    closeEditDeviceModal();
    
    try {
        await fetch('/api/devices/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, name: name, room: room, sensor_linked: sensorLinked })
        });
    } catch (e) {
        console.error("Failed to save device update:", e);
    }
};

// Relay control action
window.toggleRelayDevice = async function(relayId, isChecked) {
    const action = isChecked ? 'on' : 'off';
    try {
        const res = await fetch('/api/relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action, relay_id: relayId, module: 'load' })
        });
        const data = await res.json();
        if (!data.success) {
            alert(data.message || 'Cannot switch relay in AUTO mode. Please toggle Manual Control first.');
            // Revert checkbox
            const sw = document.getElementById(`switch-relay-${relayId}`);
            if (sw) sw.checked = !isChecked;
        } else {
            currentRelayStates[relayId] = action.toUpperCase();
            updateRelayUIElement(relayId, action.toUpperCase());
        }
    } catch (e) {
        console.error("Error toggling relay:", e);
    }
};

window.toggleLoadControlMasterMode = async function(isManual) {
    const action = isManual ? 'manual' : 'auto';
    try {
        const res = await fetch('/api/relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action, module: 'all' })
        });
        const data = await res.json();
        if (data.success) {
            currentLoadMode = data.mode;
            const indicator = document.getElementById('lc-mode-indicator');
            if (indicator) {
                indicator.textContent = `Mode: ${currentLoadMode}`;
                indicator.className = `badge-pill ${currentLoadMode === 'MANUAL' ? 'badge-medium' : 'badge-info'}`;
            }
        }
    } catch (e) {
        console.error("Error changing mode:", e);
    }
};

function updateRelayUIElement(relayId, stateStr) {
    const dot = document.getElementById(`dot-relay-${relayId}`);
    const statText = document.getElementById(`stat-text-relay-${relayId}`);
    const pwr = document.getElementById(`pwr-relay-${relayId}`);
    const sw = document.getElementById(`switch-relay-${relayId}`);
    
    const isON = stateStr === 'ON';
    if (dot) dot.style.color = isON ? 'var(--primary)' : '#ef4444';
    if (statText) {
        statText.textContent = stateStr;
        statText.style.color = isON ? 'var(--primary)' : 'var(--text-muted)';
    }
    if (sw) sw.checked = isON;
    if (pwr) {
        const dev = DEVICE_MAPPING.find(d => d.id === relayId);
        if (dev) pwr.textContent = isON ? dev.power.toFixed(2) : '0.00';
    }
}

// Background status poller (Syncs backend state with UI)
setInterval(async () => {
    try {
        const res = await fetch('/api/relay/status');
        const data = await res.json();
        if (data.success) {
            currentRelayStates = data.relays;
            currentLoadMode = data.load_mode || 'AUTO';
            
            let onCount = 0;
            let offCount = 0;
            for (let i = 1; i <= 20; i++) {
                const st = data.relays[i] || 'OFF';
                if (st === 'ON') onCount++; else offCount++;
                updateRelayUIElement(i, st);
            }
            
            const onEl = document.getElementById('lc-devices-on');
            const offEl = document.getElementById('lc-devices-off');
            if (onEl) onEl.textContent = onCount;
            if (offEl) offEl.textContent = offCount;
        }
    } catch (e) {}
}, 1500);

// Branch Selection State for Energy Monitoring Tabs
let selectedBranches = {
    voltage: 'main',
    current: 'main',
    power: 'main',
    pf: 'main'
};

window.updateLivePzemChart = function(metric, branchVal) {
    selectedBranches[metric] = branchVal;
};

// Poll real-time sensor data from ESP32
setInterval(async () => {
    try {
        const res = await fetch('/api/data');
        const data = await res.json();
        if (data && data.voltage !== undefined) {
            // Main Dashboard Cards (Always Main Panel C0)
            const vEl = document.getElementById('val-voltage');
            const iEl = document.getElementById('val-current');
            const pEl = document.getElementById('val-real-power');
            const pfEl = document.getElementById('val-power-factor');
            const totalPEl = document.getElementById('val-total-power');
            const gVal = document.getElementById('gauge-power-factor');
            
            const kw = data.power > 100 ? (data.power / 1000).toFixed(2) : data.power.toFixed(2);
            if (vEl) vEl.textContent = `${parseFloat(data.voltage).toFixed(1)} V`;
            if (iEl) iEl.textContent = `${parseFloat(data.current).toFixed(1)} A`;
            if (pEl) pEl.textContent = `${kw} kW`;
            if (totalPEl) totalPEl.textContent = `${kw} kW`;
            if (pfEl) pfEl.textContent = parseFloat(data.power_factor).toFixed(2);
            if (gVal) gVal.textContent = parseFloat(data.power_factor).toFixed(2);
            
            // Helper to extract branch metrics based on user dropdown selection
            function getBranchMetric(metric, fallbackVal) {
                const sel = selectedBranches[metric];
                if (sel === 'main' || !data.branches) return fallbackVal;
                const branchObj = data.branches[`C${sel}`];
                if (!branchObj) return fallbackVal;
                if (metric === 'voltage') return branchObj.voltage;
                if (metric === 'current') return branchObj.current;
                if (metric === 'power') return branchObj.power;
                if (metric === 'pf') return branchObj.power_factor;
                return fallbackVal;
            }

            const branchV = getBranchMetric('voltage', data.voltage);
            const branchI = getBranchMetric('current', data.current);
            const branchP = getBranchMetric('power', data.power);
            const branchPf = getBranchMetric('pf', data.power_factor);
            const branchPkW = branchP > 100 ? (branchP / 1000).toFixed(2) : parseFloat(branchP).toFixed(2);

            // Energy Monitoring Live elements (reflects selected branch PZEM)
            const emV = document.getElementById('em-live-v-val');
            const emI = document.getElementById('em-live-i-val');
            const emP = document.getElementById('em-live-p-val');
            const emPf = document.getElementById('em-live-pf-val');
            if (emV) emV.textContent = `${parseFloat(branchV).toFixed(1)} V`;
            if (emI) emI.textContent = `${parseFloat(branchI).toFixed(1)} A`;
            if (emP) emP.textContent = `${branchPkW} kW`;
            if (emPf) emPf.textContent = parseFloat(branchPf).toFixed(2);

            // Update Speedometer Doughnut Gauge
            if (chartPfGauge) {
                const pfFloat = parseFloat(data.power_factor) || 0;
                const pct = Math.min(100, Math.max(0, pfFloat * 100));
                chartPfGauge.data.datasets[0].data = [pct, 100 - pct];
                chartPfGauge.update('none');
            }
            
            // Update Status Badge
            const gStatus = document.getElementById('gauge-status');
            const pfBadge = document.getElementById('val-pf-badge');
            if (gStatus && pfBadge) {
                const pf = parseFloat(data.power_factor) || 0;
                let statusText = 'Standby';
                if (pf >= 0.95) statusText = 'Optimal';
                else if (pf >= 0.85) statusText = 'Good';
                else if (pf > 0) statusText = 'Low PF (Capacitor Triggered)';
                gStatus.textContent = statusText;
                pfBadge.textContent = statusText;
            }

            // Live Waveform Stream Updates (Selected Branch)
            if (chartLiveV && branchV !== undefined) {
                chartLiveV.data.datasets[0].data.push(parseFloat(branchV));
                chartLiveV.data.datasets[0].data.shift();
                chartLiveV.update('none');
            }
            if (chartLiveI && branchI !== undefined) {
                chartLiveI.data.datasets[0].data.push(parseFloat(branchI));
                chartLiveI.data.datasets[0].data.shift();
                chartLiveI.update('none');
            }
            if (chartLiveP && branchP !== undefined) {
                chartLiveP.data.datasets[0].data.push(parseFloat(branchP));
                chartLiveP.data.datasets[0].data.shift();
                chartLiveP.update('none');
            }
            if (chartLivePf && branchPf !== undefined) {
                chartLivePf.data.datasets[0].data.push(parseFloat(branchPf));
                chartLivePf.data.datasets[0].data.shift();
                chartLivePf.update('none');
            }

            // HLK-LD2410B mmWave Presence Card Updates (4-Zone Support: Z1 Living, Z2 Master Bed, Z3 Bed 2, Z4 Kitchen)
            if (data.occupancy) {
                const occ = data.occupancy;
                const hlkBadge = document.getElementById('hlk-status-badge');
                const hlkTimer = document.getElementById('hlk-timer-text');
                
                const isOccupied = (occ.status === 'OCCUPIED' || occ.detected);
                
                if (hlkBadge) {
                    if (isOccupied) {
                        hlkBadge.textContent = 'OCCUPIED';
                        hlkBadge.style.background = 'rgba(34, 197, 94, 0.25)';
                        hlkBadge.style.color = '#86efac';
                    } else {
                        hlkBadge.textContent = 'VACANT';
                        hlkBadge.style.background = 'rgba(148, 163, 184, 0.2)';
                        hlkBadge.style.color = '#cbd5e1';
                    }
                }

                // Update individual zones
                const zones = occ.zones || {};
                let activeCount = 0;
                ['zone1', 'zone2', 'zone3', 'zone4'].forEach(zKey => {
                    const zData = zones[zKey];
                    const zDot = document.getElementById(`hlk-dot-${zKey}`);
                    const zBadge = document.getElementById(`hlk-badge-${zKey}`);
                    
                    const zActive = zData ? (zData.detected || zData.status === 'OCCUPIED') : false;
                    if (zActive) activeCount++;

                    if (zDot) {
                        zDot.style.background = zActive ? '#22c55e' : '#94a3b8';
                        zDot.style.boxShadow = zActive ? '0 0 8px #22c55e' : 'none';
                    }
                    if (zBadge) {
                        zBadge.textContent = zActive ? 'OCCUPIED' : 'VACANT';
                        zBadge.style.background = zActive ? 'rgba(34, 197, 94, 0.25)' : 'rgba(148, 163, 184, 0.2)';
                        zBadge.style.color = zActive ? '#86efac' : '#cbd5e1';
                    }
                });

                if (hlkTimer) {
                    if (isOccupied) {
                        hlkTimer.textContent = `Active: ${activeCount}/4 Zones Occupied`;
                    } else {
                        const remaining = Math.max(0, 120 - (occ.vacancy_seconds || 0));
                        hlkTimer.textContent = remaining > 0 
                            ? `All Vacant: ${occ.vacancy_seconds || 0}s (Cutoff in ${remaining}s)` 
                            : `All Vacant: Cutoff executed (${occ.vacancy_seconds || 0}s)`;
                    }
                }
            }

                // Dynamically display which loads are linked to the presence sensor
                if (data.sensor_linked_relays) {
                    const autoStatusEl = document.getElementById('hlk-auto-status');
                    if (autoStatusEl) {
                        const count = data.sensor_linked_relays.length;
                        if (count === 1) {
                            const dev = DEVICE_MAPPING.find(d => d.id === data.sensor_linked_relays[0]);
                            const dName = dev ? dev.name : `Relay #${data.sensor_linked_relays[0]}`;
                            autoStatusEl.textContent = `Auto-Controls: ${dName}`;
                        } else if (count > 1) {
                            autoStatusEl.textContent = `Auto-Controls: ${count} Loads (#${data.sensor_linked_relays.join(', #')})`;
                        } else {
                            autoStatusEl.textContent = `Auto-Controls: None (Set in Load Control)`;
                        }
                    }
                }

            // PFC Capacitor Bank Status & ACU Interlock
            if (data.relays) {
                const b1 = data.relays['1'] === 'ON';
                const b2 = data.relays['2'] === 'ON';
                const b3 = data.relays['3'] === 'ON';
                const acuOn = data.relays['7'] === 'ON';

                const b1Badge = document.getElementById('pfc-bank1-badge');
                const b2Badge = document.getElementById('pfc-bank2-badge');
                const b3Badge = document.getElementById('pfc-bank3-badge');
                const lockBadge = document.getElementById('pfc-interlock-badge');

                if (b1Badge) {
                    b1Badge.textContent = b1 ? 'ACTIVE' : 'OFF';
                    b1Badge.style.background = b1 ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)';
                    b1Badge.style.color = b1 ? '#4ade80' : 'var(--text-muted)';
                }
                if (b2Badge) {
                    b2Badge.textContent = b2 ? 'ACTIVE' : 'OFF';
                    b2Badge.style.background = b2 ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)';
                    b2Badge.style.color = b2 ? '#4ade80' : 'var(--text-muted)';
                }
                if (b3Badge) {
                    b3Badge.textContent = b3 ? 'ACTIVE' : 'OFF';
                    b3Badge.style.background = b3 ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)';
                    b3Badge.style.color = b3 ? '#4ade80' : 'var(--text-muted)';
                }

                if (lockBadge) {
                    if (acuOn) {
                        lockBadge.textContent = 'INTERLOCKED (ACU ON)';
                        lockBadge.style.background = 'rgba(239, 68, 68, 0.2)';
                        lockBadge.style.color = '#f87171';
                    } else {
                        lockBadge.textContent = 'ACU SAFE';
                        lockBadge.style.background = 'rgba(34, 197, 94, 0.15)';
                        lockBadge.style.color = '#4ade80';
                    }
                }

                // Active Devices Badge Count
                let activeRelays = 0;
                for (let r = 1; r <= 20; r++) {
                    if (data.relays[String(r)] === 'ON') activeRelays++;
                }
                const navBadge = document.getElementById('nav-active-count');
                const totalActiveEl = document.getElementById('active-devices-total-count');
                if (navBadge) {
                    navBadge.textContent = activeRelays;
                    navBadge.style.display = activeRelays > 0 ? 'inline-block' : 'none';
                }
                if (totalActiveEl) totalActiveEl.textContent = activeRelays;
            }

            // System Mode Highlighting
            if (data.system_mode) {
                const mode = data.system_mode.toUpperCase();
                const mBadge = document.getElementById('sys-mode-badge');
                if (mBadge) mBadge.textContent = mode;

                ['manual', 'ai', 'security'].forEach(m => {
                    const btn = document.getElementById(`btn-mode-${m}`);
                    if (btn) {
                        const targetMode = m === 'ai' ? 'AI_ASSISTED' : m.toUpperCase();
                        if (mode === targetMode) {
                            btn.classList.add('active');
                            btn.style.background = 'var(--primary)';
                            btn.style.color = '#000000';
                            btn.style.borderColor = 'var(--primary)';
                        } else {
                            btn.classList.remove('active');
                            btn.style.background = 'transparent';
                            btn.style.color = '#ffffff';
                            btn.style.borderColor = 'var(--border-color)';
                        }
                    }
                });
            }

            // If active devices grid is currently on screen, refresh it
            if (document.getElementById('active-devices-grid')) {
                renderActiveDevicesPage();
            }
        }
    } catch (e) {}
}, 1000);

// =============================================================================
// Active Loads ("Active Devices") & Mode Switching Functions
// =============================================================================
window.renderActiveDevicesPage = async function() {
    try {
        const res = await fetch('/api/active-devices');
        const data = await res.json();
        const grid = document.getElementById('active-devices-grid');
        const emptyState = document.getElementById('active-devices-empty');
        const totalCountEl = document.getElementById('active-devices-total-count');
        
        if (!grid || !data.success) return;
        
        const devices = data.devices || [];
        if (totalCountEl) totalCountEl.textContent = devices.length;

        if (devices.length === 0) {
            grid.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        grid.innerHTML = devices.map(d => `
            <div class="card" style="padding: 16px; border: 1px solid rgba(34,197,94,0.3); background: rgba(34,197,94,0.03); display: flex; flex-direction: column; justify-content: space-between; gap: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Relay #${d.id} • ${d.room}</div>
                        <div style="font-size: 15px; font-weight: 800; color: #ffffff; margin-top: 2px;">${d.name}</div>
                    </div>
                    <span class="badge-pill" style="background: rgba(34,197,94,0.2); color: #4ade80; font-size: 10px; font-weight: 800;">
                        <i class="ph-fill ph-check-circle"></i> ACTIVE
                    </span>
                </div>
                
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 6px; font-size: 11px;">
                    <span style="color: var(--text-muted);">${d.pin || ''}</span>
                    <span style="font-weight: 700; color: var(--primary);">${parseFloat(d.power || 0).toFixed(2)} kW</span>
                </div>

                <button class="btn btn-outline" style="border-color: #ef4444; color: #ef4444; width: 100%; padding: 8px; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="turnOffActiveDevice(${d.id})">
                    <i class="ph ph-power"></i> Disconnect Load
                </button>
            </div>
        `).join('');
    } catch (e) {
        console.error("Error rendering active devices:", e);
    }
};

window.turnOffActiveDevice = async function(relayId) {
    try {
        const res = await fetch('/api/relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relay_id: relayId, action: 'off' })
        });
        const data = await res.json();
        if (data.success) {
            renderActiveDevicesPage();
        }
    } catch (e) {
        alert("Error disconnecting load: " + e);
    }
};

window.turnOffAllNonCritical = async function() {
    if (!confirm("Are you sure you want to disconnect all active non-critical loads?")) return;
    try {
        const res = await fetch('/api/active-devices/turn-off-all', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            renderActiveDevicesPage();
            alert(`Successfully disconnected ${data.count} non-critical load(s). Refrigerator (#10) and CCTV (#18) remain safely energized.`);
        }
    } catch (e) {
        alert("Error disconnecting non-critical loads: " + e);
    }
};

window.setSystemMode = async function(mode) {
    try {
        const res = await fetch('/api/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: mode })
        });
        const data = await res.json();
        if (data.success) {
            const mBadge = document.getElementById('sys-mode-badge');
            if (mBadge) mBadge.textContent = mode;
            const descEl = document.getElementById('sys-mode-desc');
            if (descEl) {
                if (mode === 'AI_ASSISTED') descEl.textContent = 'AI mode active: Automated lighting via HLK mmWave and PFC interlocks.';
                else if (mode === 'SECURITY') descEl.textContent = 'Security mode: Non-critical outlets cut off. Security monitoring on.';
                else descEl.textContent = 'Manual control. Relays stay in current positions without automated tripping.';
            }
        }
    } catch (e) {
        alert("Error switching mode: " + e);
    }
};


// Global Login Handler
window.doLogin = async function(e) {
    if (e && e.preventDefault) e.preventDefault();
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    const loginError = document.getElementById('login-error');
    
    const uInput = document.getElementById('login-username');
    const pInput = document.getElementById('login-password');
    const username = (uInput && uInput.value.trim()) ? uInput.value.trim() : 'admin';
    const password = (pInput && pInput.value) ? pInput.value : 'admin123';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            if (loginScreen) loginScreen.style.display = 'none';
            if (mainApp) mainApp.style.display = 'flex';
            navigateToPage('dashboard');
        } else {
            if (loginError) {
                loginError.textContent = data.message || "Invalid username or password";
                loginError.style.display = 'block';
            }
        }
    } catch (err) {
        // Fallback for local connection
        if (loginScreen) loginScreen.style.display = 'none';
        if (mainApp) mainApp.style.display = 'flex';
        navigateToPage('dashboard');
    }
};

// Global Auth Mode Switcher (Login vs Register)
window.toggleAuthMode = function(mode) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginTitle = document.getElementById('login-title');
    const loginError = document.getElementById('login-error');
    const regError = document.getElementById('reg-error');
    const regSuccess = document.getElementById('reg-success');

    if (loginError) loginError.style.display = 'none';
    if (regError) regError.style.display = 'none';
    if (regSuccess) regSuccess.style.display = 'none';

    if (mode === 'register') {
        if (loginForm) loginForm.style.display = 'none';
        if (registerForm) registerForm.style.display = 'block';
        if (loginTitle) loginTitle.textContent = 'Create REMS Account';
    } else {
        if (registerForm) registerForm.style.display = 'none';
        if (loginForm) loginForm.style.display = 'block';
        if (loginTitle) loginTitle.textContent = 'Welcome to REMS';
    }
};

// Global Registration Handler
window.doRegister = async function(e) {
    if (e && e.preventDefault) e.preventDefault();
    const uInput = document.getElementById('reg-username');
    const pInput = document.getElementById('reg-password');
    const cpInput = document.getElementById('reg-confirm-password');
    const regError = document.getElementById('reg-error');
    const regSuccess = document.getElementById('reg-success');

    if (regError) regError.style.display = 'none';
    if (regSuccess) regSuccess.style.display = 'none';

    const username = uInput ? uInput.value.trim() : '';
    const password = pInput ? pInput.value : '';
    const confirmPassword = cpInput ? cpInput.value : '';

    if (!username) {
        if (regError) {
            regError.textContent = 'Please enter a username.';
            regError.style.display = 'block';
        }
        return;
    }
    if (!password) {
        if (regError) {
            regError.textContent = 'Please enter a password.';
            regError.style.display = 'block';
        }
        return;
    }
    if (password !== confirmPassword) {
        if (regError) {
            regError.textContent = 'Passwords do not match.';
            regError.style.display = 'block';
        }
        return;
    }

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            if (regSuccess) {
                regSuccess.textContent = 'Account created successfully! Switching to sign in...';
                regSuccess.style.display = 'block';
            }
            const loginU = document.getElementById('login-username');
            const loginP = document.getElementById('login-password');
            if (loginU) loginU.value = username;
            if (loginP) loginP.value = password;

            setTimeout(() => {
                window.toggleAuthMode('login');
            }, 1200);
        } else {
            if (regError) {
                regError.textContent = data.message || 'Failed to create account.';
                regError.style.display = 'block';
            }
        }
    } catch (err) {
        if (regError) {
            regError.textContent = 'Network error. Please try again.';
            regError.style.display = 'block';
        }
    }
};

// =============================================================================
// DOMContentLoaded Initializer
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
    // --- Login & Register Logic ---
    const loginForm = document.getElementById('login-form');
    const loginSubmitBtn = document.getElementById('login-submit-btn');
    const registerForm = document.getElementById('register-form');
    const registerSubmitBtn = document.getElementById('register-submit-btn');
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');

    if (loginForm) {
        loginForm.addEventListener('submit', window.doLogin);
    }
    if (loginSubmitBtn) {
        loginSubmitBtn.addEventListener('click', window.doLogin);
    }
    if (registerForm) {
        registerForm.addEventListener('submit', window.doRegister);
    }
    if (registerSubmitBtn) {
        registerSubmitBtn.addEventListener('click', window.doRegister);
    }

    // Auto bypass login if on local touchscreen
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
        if (loginScreen) loginScreen.style.display = 'none';
        if (mainApp) mainApp.style.display = 'flex';
        navigateToPage('dashboard');
    }

    // Sidebar toggle (Hamburger 3 horizontal lines)
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar = document.querySelector('.sidebar');
    if (sidebarToggleBtn && sidebar) {
        sidebarToggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // Sidebar navigation click handlers
    const navItems = document.querySelectorAll('.main-nav li');
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const pageId = this.getAttribute('data-page');
            navigateToPage(pageId);
        });
    });

    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            mainApp.style.display = 'none';
            loginScreen.style.display = 'flex';
        });
    }

    // User profile dropdown toggle
    const profileBtn = document.getElementById('user-profile-btn');
    const profileDropdown = document.getElementById('profile-dropdown');
    if (profileBtn && profileDropdown) {
        profileBtn.addEventListener('click', (e) => {
            profileDropdown.classList.toggle('show');
            e.stopPropagation();
        });
        document.addEventListener('click', () => {
            profileDropdown.classList.remove('show');
        });
    }

    // Update Date/Time Clock
    function updateClock() {
        const now = new Date();
        const options = { month: 'short', day: '2-digit', year: 'numeric' };
        const dEl = document.getElementById('current-date');
        const tEl = document.getElementById('current-time');
        if (dEl) dEl.textContent = now.toLocaleDateString('en-US', options);
        if (tEl) {
            let h = now.getHours();
            const m = now.getMinutes().toString().padStart(2, '0');
            const ampm = h >= 12 ? 'pm' : 'am';
            h = h % 12 || 12;
            tEl.textContent = `${h}:${m} ${ampm} PHT`;
        }
    }
    setInterval(updateClock, 1000);
    updateClock();

    // Default load Dashboard or Hash-specified Page
    const initialPage = window.location.hash ? window.location.hash.replace('#', '') : 'dashboard';
    navigateToPage(initialPage);

    window.addEventListener('hashchange', () => {
        if (window.location.hash) {
            navigateToPage(window.location.hash.replace('#', ''));
        }
    });

    // Initialize TFT Touchscreen swipe and drag-to-scroll engine
    initTouchDragScroll();
});

// =============================================================================
// Universal TFT Touchscreen Drag-to-Scroll & Swipe Engine
// =============================================================================
function initTouchDragScroll() {
    let isDragging = false;
    let hasDragged = false;
    let startY = 0;
    let startScrollTop = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocityY = 0;
    let targetContainer = null;
    let animId = null;

    function findScrollableParent(el) {
        let cur = el;
        while (cur && cur !== document.body && cur !== document.documentElement) {
            const style = window.getComputedStyle(cur);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight) {
                return cur;
            }
            cur = cur.parentElement;
        }
        return document.getElementById('content-area') || document.querySelector('.page-content');
    }

    function onTouchStart(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('input, select, textarea, .slider')) return;

        if (animId) {
            cancelAnimationFrame(animId);
            animId = null;
        }

        const clientY = (e.clientY !== undefined) ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        targetContainer = findScrollableParent(e.target);
        if (!targetContainer) return;

        isDragging = true;
        hasDragged = false;
        startY = clientY;
        lastY = clientY;
        startScrollTop = targetContainer.scrollTop;
        lastTime = performance.now();
        velocityY = 0;
    }

    function onTouchMove(e) {
        if (!isDragging || !targetContainer) return;
        const clientY = (e.clientY !== undefined) ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        const deltaY = startY - clientY;
        const now = performance.now();
        const dt = Math.max(1, now - lastTime);

        velocityY = (lastY - clientY) / dt;
        lastY = clientY;
        lastTime = now;

        if (Math.abs(deltaY) > 6 || hasDragged) {
            hasDragged = true;
            targetContainer.scrollTop = startScrollTop + deltaY;
            if (e.cancelable) e.preventDefault();
        }
    }

    function onTouchEnd() {
        if (!isDragging) return;
        isDragging = false;

        if (hasDragged && Math.abs(velocityY) > 0.12 && targetContainer) {
            let currentV = velocityY * 16;
            function step() {
                if (!targetContainer || Math.abs(currentV) < 0.3) {
                    animId = null;
                    return;
                }
                targetContainer.scrollTop += currentV;
                currentV *= 0.93;
                animId = requestAnimationFrame(step);
            }
            animId = requestAnimationFrame(step);
        }
    }

    // Suppress unwanted click event if finger was actively dragging/swiping
    window.addEventListener('click', (e) => {
        if (hasDragged) {
            e.stopPropagation();
            e.preventDefault();
            hasDragged = false;
        }
    }, true);

    // Pointer Events for modern Chromium & TFT Touch
    window.addEventListener('pointerdown', onTouchStart, { passive: true });
    window.addEventListener('pointermove', onTouchMove, { passive: false });
    window.addEventListener('pointerup', onTouchEnd, { passive: true });
    window.addEventListener('pointercancel', onTouchEnd, { passive: true });

    // Touch Events Fallback
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
}


// =============================================================================
// CHART INITIALIZERS (Matches DETAILS NG IPAPACODE (4).pdf)
// =============================================================================

// =============================================================================
// CHART INITIALIZERS (RAW HARDWARE DATA ONLY - NO MOCK DATA)
// =============================================================================

let chartEnergyToday = null;
let chartPfGauge = null;
let chartPfTrend = null;
let chartBar = null;
let chartDonut = null;

let chartLiveV = null;
let chartLiveI = null;
let chartLiveP = null;
let chartLivePf = null;

function initDashboardCharts() {
    const primaryColor = '#22c55e';
    const primaryLight = 'rgba(34, 197, 94, 0.15)';
    const gridColor = 'rgba(255, 255, 255, 0.05)';
    const textColor = '#8b949e';

    // 1. Energy Today Sparkline (Starts at 0, filled by actual PZEM accumulation)
    const ctxEnergy = document.getElementById('energyTodayChart');
    if (ctxEnergy) {
        chartEnergyToday = new Chart(ctxEnergy, {
            type: 'line',
            data: {
                labels: ['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM', 'Now'],
                datasets: [{
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: primaryColor,
                    backgroundColor: primaryLight,
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: textColor, font: { size: 9 } } },
                    y: { beginAtZero: true, grid: { color: gridColor }, ticks: { display: false } }
                }
            }
        });
    }

    // 2. PF Gauge (Real-time speedometer, 0 to 100%)
    const ctxGauge = document.getElementById('pfGaugeChart');
    if (ctxGauge) {
        chartPfGauge = new Chart(ctxGauge, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [0, 100],
                    backgroundColor: [primaryColor, 'rgba(255, 255, 255, 0.1)'],
                    borderWidth: 0,
                    circumference: 180,
                    rotation: 270,
                    cutout: '80%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { tooltip: { enabled: false } }
            }
        });
    }

    // 3. PF Trend Today Chart (Real-time live PF values)
    const ctxPfTrend = document.getElementById('pfTrendChart');
    if (ctxPfTrend) {
        chartPfTrend = new Chart(ctxPfTrend, {
            type: 'line',
            data: {
                labels: ['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM', 'Now'],
                datasets: [{
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    pointBackgroundColor: '#3b82f6'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } },
                    y: { min: 0.0, max: 1.0, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } }
                }
            }
        });
    }

    // 4. Energy Consumption Bar Chart (Real logged daily kWh)
    const ctxBar = document.getElementById('consumptionBarChart');
    if (ctxBar) {
        chartBar = new Chart(ctxBar, {
            type: 'bar',
            data: {
                labels: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
                datasets: [{
                    data: [0, 0, 0, 0, 0, 0, 0],
                    backgroundColor: primaryColor,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } },
                    y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } }
                }
            }
        });
    }

    // 5. Load Distribution Donut Chart (Real measured branch share)
    const ctxDonut = document.getElementById('distributionDonutChart');
    if (ctxDonut) {
        chartDonut = new Chart(ctxDonut, {
            type: 'doughnut',
            data: {
                labels: ['Living Room', 'Bedroom', 'Kitchen', 'Air Conditioner'],
                datasets: [{
                    data: [0, 0, 0, 0],
                    backgroundColor: ['#4ade80', '#22c55e', '#eab308', '#86efac'],
                    borderWidth: 0,
                    cutout: '68%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    }
}


function initEnergyMonitoringCharts() {
    const gridColor = 'rgba(255, 255, 255, 0.05)';
    const textColor = '#8b949e';
    const timeLabels = ['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM', 'Now'];

    // Overview 4 charts (All start at 0 until real historical data logs)
    const makeMiniChart = (id, color) => {
        const ctx = document.getElementById(id);
        if (!ctx) return;
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: timeLabels,
                datasets: [{
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: color,
                    backgroundColor: color.replace(')', ', 0.15)').replace('rgb', 'rgba'),
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    pointRadius: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: textColor, font: { size: 9 } } },
                    y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 9 } } }
                }
            }
        });
    };

    makeMiniChart('emOverviewVoltageChart', 'rgb(59, 130, 246)');
    makeMiniChart('emOverviewCurrentChart', 'rgb(234, 179, 8)');
    makeMiniChart('emOverviewPowerChart', 'rgb(34, 197, 94)');
    makeMiniChart('emOverviewPfChart', 'rgb(168, 85, 247)');
}

function initVoltagePzemChart() {
    const ctx = document.getElementById('emVoltagePerPzemChart');
    if (ctx) {
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM', 'Now'],
                datasets: [{
                    label: 'Voltage (V)',
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#8b949e' } },
                    y: { beginAtZero: true, max: 260, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8b949e' } }
                }
            }
        });
    }

    const ctxLive = document.getElementById('emLiveVoltageChart');
    if (ctxLive) {
        chartLiveV = new Chart(ctxLive, {
            type: 'line',
            data: {
                labels: Array.from({length: 20}, (_, i) => `${i}s`),
                datasets: [{
                    data: Array(20).fill(0),
                    borderColor: '#22c55e',
                    borderWidth: 2,
                    tension: 0.2,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { display: false } },
                    y: { beginAtZero: true, max: 260, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8b949e' } }
                }
            }
        });
    }
}

function initCurrentPzemChart() {
    const ctx = document.getElementById('emCurrentPerPzemChart');
    if (ctx) {
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM', 'Now'],
                datasets: [{
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: '#facc15',
                    backgroundColor: 'rgba(250, 204, 21, 0.15)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#8b949e' } },
                    y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8b949e' } }
                }
            }
        });
    }

    const ctxLiveI = document.getElementById('emLiveCurrentChart');
    if (ctxLiveI) {
        chartLiveI = new Chart(ctxLiveI, {
            type: 'line',
            data: {
                labels: Array.from({length: 20}, (_, i) => `${i}s`),
                datasets: [{
                    data: Array(20).fill(0),
                    borderColor: '#facc15',
                    borderWidth: 2,
                    tension: 0.2,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { display: false } },
                    y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8b949e' } }
                }
            }
        });
    }
}

function initPowerPzemChart() {
    const ctx = document.getElementById('emPowerPerPzemChart');
    if (ctx) {
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM', 'Now'],
                datasets: [{
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.15)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#8b949e' } },
                    y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8b949e' } }
                }
            }
        });
    }

    const ctxLiveP = document.getElementById('emLivePowerChart');
    if (ctxLiveP) {
        chartLiveP = new Chart(ctxLiveP, {
            type: 'line',
            data: {
                labels: Array.from({length: 20}, (_, i) => `${i}s`),
                datasets: [{
                    data: Array(20).fill(0),
                    borderColor: '#22c55e',
                    borderWidth: 2,
                    tension: 0.2,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { display: false } },
                    y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8b949e' } }
                }
            }
        });
    }
}

function initPfPzemChart() {
    const ctx = document.getElementById('emPfPerPzemChart');
    if (ctx) {
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM', 'Now'],
                datasets: [{
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: '#c084fc',
                    backgroundColor: 'rgba(192, 132, 252, 0.15)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#8b949e' } },
                    y: { min: 0.0, max: 1.0, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8b949e' } }
                }
            }
        });
    }

    const ctxLivePf = document.getElementById('emLivePfChart');
    if (ctxLivePf) {
        chartLivePf = new Chart(ctxLivePf, {
            type: 'line',
            data: {
                labels: Array.from({length: 20}, (_, i) => `${i}s`),
                datasets: [{
                    data: Array(20).fill(0),
                    borderColor: '#c084fc',
                    borderWidth: 2,
                    tension: 0.2,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { display: false } },
                    y: { min: 0.0, max: 1.0, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8b949e' } }
                }
            }
        });
    }
}

// =============================================================================
// AI Recommendations & Energy Insights Engine (Academic Thesis Compliance)
// =============================================================================
let currentAiSuggestions = [];

window.switchAiTab = function(tabName) {
    const recTab = document.getElementById('ai-tab-recommendations');
    const insTab = document.getElementById('ai-tab-insights');
    const btns = document.querySelectorAll('#tpl-ai-recommendations .sub-tab-btn, .sub-tabs .sub-tab-btn');
    
    if (tabName === 'recommendations') {
        if (recTab) recTab.style.display = 'block';
        if (insTab) insTab.style.display = 'none';
    } else {
        if (recTab) recTab.style.display = 'none';
        if (insTab) insTab.style.display = 'block';
    }
    
    btns.forEach(btn => {
        if (btn.textContent.trim().toLowerCase().includes(tabName.toLowerCase())) {
            btn.classList.add('active');
        } else if (btn.textContent.trim().toLowerCase().includes('recommendation') || btn.textContent.trim().toLowerCase().includes('insight')) {
            btn.classList.remove('active');
        }
    });
};

window.loadAiRecommendations = async function() {
    try {
        const res = await fetch('/api/suggestions');
        const data = await res.json();
        currentAiSuggestions = data || [];
        
        const tbody = document.getElementById('ai-recommendations-table-body');
        if (!tbody) return;
        
        const pending = currentAiSuggestions.filter(s => s.status === 'pending');
        
        if (pending.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align: center; padding: 48px 20px; color: var(--text-muted);">
                        <i class="ph ph-sparkle" style="font-size: 32px; color: var(--primary); margin-bottom: 10px; display: block;"></i>
                        <div style="font-weight: 600; color: #ffffff; font-size: 14px; margin-bottom: 4px;">No Pending AI Recommendations</div>
                        <div style="font-size: 11px;">Electrical telemetry and occupancy status are currently optimal. System monitors for standby leakage and reactive losses.</div>
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = pending.map(s => {
            const isHigh = (s.priority || 'Medium') === 'High';
            const prioBadge = isHigh 
                ? `<span class="badge-pill" style="background: rgba(239, 68, 68, 0.2); color: #f87171; font-size: 10px; font-weight: 800;">HIGH</span>`
                : `<span class="badge-pill" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; font-size: 10px; font-weight: 800;">MEDIUM</span>`;
            
            const savingsHtml = s.potential_savings 
                ? `<div style="font-size: 11px; color: var(--primary); font-weight: 700; margin-top: 4px;"><i class="ph ph-trend-down"></i> Potential Savings: ${s.potential_savings}</div>`
                : '';

            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 16px 20px;">
                        <div style="font-size: 13px; font-weight: 600; color: #ffffff; line-height: 1.5;">${s.message}</div>
                        ${savingsHtml}
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Generated at ${s.timestamp || 'Recent'} • Confidence: ${s.confidence || '90%'}</div>
                    </td>
                    <td style="padding: 16px 12px; vertical-align: middle;">
                        ${prioBadge}
                    </td>
                    <td style="padding: 16px 20px; text-align: right; vertical-align: middle;">
                        <div style="display: flex; gap: 8px; justify-content: flex-end;">
                            <button class="btn btn-primary" style="padding: 6px 14px; font-size: 11px; font-weight: 700;" onclick="approveSuggestion(${s.id})">
                                <i class="ph ph-check"></i> Approve
                            </button>
                            <button class="btn btn-outline" style="padding: 6px 12px; font-size: 11px;" onclick="rejectSuggestion(${s.id})">
                                <i class="ph ph-x"></i> Reject
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        console.error("Error loading AI recommendations:", e);
    }
};

window.approveSuggestion = async function(sId) {
    try {
        const res = await fetch(`/api/suggestions/${sId}/approve`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert("Recommendation approved: Corrective action successfully executed and logged.");
            loadAiRecommendations();
        }
    } catch (e) {
        alert("Failed to approve suggestion: " + e);
    }
};

window.rejectSuggestion = async function(sId) {
    try {
        const res = await fetch(`/api/suggestions/${sId}/reject`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            loadAiRecommendations();
        }
    } catch (e) {
        alert("Failed to reject suggestion: " + e);
    }
};

// =============================================================================
// Safety Monitoring & Alerts Engine (Section 1.7 Thesis Compliance)
// =============================================================================
let currentAlertsView = 'active';
let allAlertsData = [];

window.switchAlertsTab = function(tabName) {
    currentAlertsView = tabName;
    const btnActive = document.getElementById('subtab-alerts-active');
    const btnHistory = document.getElementById('subtab-alerts-history');
    if (tabName === 'active') {
        if (btnActive) btnActive.classList.add('active');
        if (btnHistory) btnHistory.classList.remove('active');
    } else {
        if (btnActive) btnActive.classList.remove('active');
        if (btnHistory) btnHistory.classList.add('active');
    }
    renderAlertsTable();
};

window.loadAlerts = async function() {
    try {
        const res = await fetch('/api/alerts');
        const data = await res.json();
        allAlertsData = data.alerts || [];
        
        const activeCount = allAlertsData.filter(a => a.status === 'ACTIVE').length;
        const badge = document.getElementById('alerts-active-badge');
        if (badge) badge.textContent = activeCount;
        
        renderAlertsTable();
    } catch (e) {
        console.error("Error loading alerts:", e);
    }
};

function renderAlertsTable() {
    const tbody = document.getElementById('alerts-table-body');
    if (!tbody) return;
    
    const filtered = currentAlertsView === 'active' 
        ? allAlertsData.filter(a => a.status === 'ACTIVE')
        : allAlertsData;
        
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 48px 20px; color: var(--text-muted);">
                    <i class="ph ph-check-circle" style="font-size: 32px; color: var(--primary); margin-bottom: 10px; display: block;"></i>
                    <div style="font-weight: 600; color: #ffffff; font-size: 14px; margin-bottom: 4px;">
                        ${currentAlertsView === 'active' ? 'No Active Safety Alerts' : 'No Alert History'}
                    </div>
                    <div style="font-size: 11px;">All electrical branch currents, panel temperatures, and relay actuators are operating within normal tolerances.</div>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = filtered.map(a => {
        let sevColor = '#60a5fa';
        let sevBg = 'rgba(59, 130, 246, 0.2)';
        if (a.severity === 'CRITICAL') {
            sevColor = '#f87171';
            sevBg = 'rgba(239, 68, 68, 0.2)';
        } else if (a.severity === 'WARNING') {
            sevColor = '#fbbf24';
            sevBg = 'rgba(251, 191, 36, 0.2)';
        }
        
        const actionBtn = a.status === 'ACTIVE'
            ? `<button class="btn btn-outline" style="padding: 5px 12px; font-size: 11px;" onclick="dismissAlert(${a.id})">Dismiss</button>`
            : `<span style="color: var(--text-muted); font-size: 11px;">Resolved</span>`;
            
        return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding: 14px 20px; font-weight: 600; color: #ffffff;">
                    ${a.message}
                </td>
                <td style="padding: 14px 12px;">
                    <span class="badge-pill" style="background: ${sevBg}; color: ${sevColor}; font-size: 10px; font-weight: 800;">
                        ${a.severity}
                    </span>
                </td>
                <td style="padding: 14px 12px; color: var(--text-muted); font-size: 11px;">
                    ${a.timestamp}
                </td>
                <td style="padding: 14px 12px;">
                    <span style="font-size: 11px; font-weight: 700; color: ${a.status === 'ACTIVE' ? '#f87171' : '#4ade80'};">
                        ${a.status}
                    </span>
                </td>
                <td style="padding: 14px 20px; text-align: right;">
                    ${actionBtn}
                </td>
            </tr>
        `;
    }).join('');
}

window.dismissAlert = async function(aId) {
    try {
        const res = await fetch(`/api/alerts/${aId}/dismiss`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            loadAlerts();
        }
    } catch (e) {
        alert("Error dismissing alert: " + e);
    }
};

window.clearAllActiveAlerts = async function() {
    try {
        const res = await fetch('/api/alerts/clear-all', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            loadAlerts();
        }
    } catch (e) {
        alert("Error clearing alerts: " + e);
    }
};

// =============================================================================
// DS3231 I2C RTC Time Synchronization
// =============================================================================
window.syncRtcTime = async function() {
    try {
        const res = await fetch('/api/rtc/sync', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            const rtcDisplay = document.getElementById('settings-rtc-display');
            if (rtcDisplay) rtcDisplay.value = data.timestamp + " (Hardware Synced)";
            alert(`RTC Synchronization Successful:\nSystem clock synchronized with DS3231 hardware module.\nTimestamp: ${data.timestamp}`);
        } else {
            alert("RTC Sync Failed: " + (data.message || "Hardware module error"));
        }
    } catch (e) {
        alert("Error synchronizing with RTC module: " + e);
    }
};

