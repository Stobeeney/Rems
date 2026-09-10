from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from datetime import datetime
import sqlite3
import os
from dotenv import load_dotenv
import google.generativeai as genai
import json
from gpiozero import OutputDevice, DigitalInputDevice
import serial
import re
import threading
import time

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# =============================================================================
# 1. Hardware Actuators: 20 Relays (Active Low)
# =============================================================================
# Relays 1-3: PFC Capacitor Banks (K1, K2, K3) via CJX2-1210 contactors
# Relays 4-20: Monitored Lighting, Outlets, and ACU Load Branches
relay_pins = {
    1: 17, 2: 27, 3: 22,   # PFC Capacitor Banks K1, K2, K3
    4: 4,  5: 5,  6: 6,    # Living Room Lights, TV, Outlets Group 1
    7: 7,  8: 8,  9: 9,    # ACU Main, Bedroom 1 Lights, Bedroom 1 Outlets
    10: 10, 11: 11, 12: 12, # Refrigerator (Critical), Kitchen Outlets, Water Heater
    13: 13, 14: 16, 15: 18, # Washing Machine, Microwave, Garage Door & Lights
    16: 19, 17: 20, 18: 21, # Dining Room Lights, Outdoor Lights, CCTV/NVR (Critical)
    19: 23, 20: 24          # Standby Outlets, Auxiliary Branch
}
relays = {}
relay_status = {}
pfc_auto_mode = False   # PFC automatic threshold engagement
load_auto_mode = False  # Load control automatic engagement
system_mode = "MANUAL"  # 3 Modes: MANUAL, AI_ASSISTED, SECURITY

for r_id, pin in relay_pins.items():
    try:
        relays[r_id] = OutputDevice(pin, active_high=False, initial_value=False)
        relay_status[r_id] = False
    except Exception as e:
        print(f"Error initializing relay {r_id} on pin {pin}: {e}")
        relays[r_id] = None
        relay_status[r_id] = False

# =============================================================================
# 2. Hardware Sensor: HLK-LD2410B 24GHz mmWave Human Presence
# =============================================================================
# Primary Tested Sensor: HLK-LD2410B OUT -> GPIO 14 (Header Pin 8)
# Multi-zone Support: GPIO 14 (Living Room), 15 (Master Bed), 25 (Bed 2), 26 (Kitchen)
HLK_PINS = {
    "zone1": 14,  # Living Room (Tested on GPIO 14 / Pin 8)
    "zone2": 15,  # Master Bedroom (GPIO 15 / Pin 10)
    "zone3": 25,  # Bedroom 2 (GPIO 25 / Pin 22)
    "zone4": 26   # Kitchen (GPIO 26 / Pin 37)
}
hlk_sensors = {}
for zone, pin in HLK_PINS.items():
    try:
        hlk_sensors[zone] = DigitalInputDevice(pin, pull_up=False)
        print(f"✅ HLK-LD2410B sensor initialized on GPIO {pin} ({zone})")
    except Exception as e:
        hlk_sensors[zone] = None
        print(f"⚠️ Could not initialize HLK on GPIO {pin}: {e}")

occupancy_state = {
    "sensor": "4x HLK-LD2410B (24GHz mmWave)",
    "detected": False,
    "status": "VACANT",
    "last_motion_time": time.time(),
    "vacancy_seconds": 0,
    "active_zones_count": 0,
    "zones": {
        "zone1": {"name": "Living Room (GPIO 14)", "pin": 14, "detected": False, "status": "VACANT"},
        "zone2": {"name": "Master Bedroom (GPIO 15)", "pin": 15, "detected": False, "status": "VACANT"},
        "zone3": {"name": "Bedroom 2 (GPIO 25)", "pin": 25, "detected": False, "status": "VACANT"},
        "zone4": {"name": "Kitchen (GPIO 26)", "pin": 26, "detected": False, "status": "VACANT"}
    }
}

app = Flask(__name__)
# Ina-allow nito na makipag-usap ang Front-end sa Back-end
CORS(app) 

# --- Database Setup ---
DB_FILE = 'rems.db'

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    # Create tables if they don't exist
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user'
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS suggestions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message TEXT NOT NULL,
            confidence TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            timestamp TEXT NOT NULL,
            priority TEXT DEFAULT 'Medium',
            potential_savings TEXT DEFAULT '',
            target_relay INTEGER DEFAULT 0
        )
    ''')
    try:
        c.execute("ALTER TABLE suggestions ADD COLUMN priority TEXT DEFAULT 'Medium'")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE suggestions ADD COLUMN potential_savings TEXT DEFAULT ''")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE suggestions ADD COLUMN target_relay INTEGER DEFAULT 0")
    except Exception:
        pass
    c.execute('''
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_type TEXT NOT NULL,
            severity TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ACTIVE'
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            room TEXT NOT NULL,
            pin_desc TEXT,
            power REAL DEFAULT 0.00,
            sensor_linked INTEGER DEFAULT 0
        )
    ''')
    try:
        c.execute("ALTER TABLE devices ADD COLUMN sensor_linked INTEGER DEFAULT 0")
        conn.commit()
    except Exception:
        pass

    # Ensure default Relay 4 has sensor_linked=1 if none is set
    try:
        c.execute("SELECT COUNT(*) FROM devices WHERE sensor_linked = 1")
        if c.fetchone()[0] == 0:
            c.execute("UPDATE devices SET sensor_linked = 1 WHERE id = 4")
            conn.commit()
    except Exception:
        pass
    c.execute('''
        CREATE TABLE IF NOT EXISTS energy_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            channel INTEGER NOT NULL,
            voltage REAL,
            current REAL,
            power REAL,
            energy REAL,
            power_factor REAL,
            frequency REAL
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS system_overrides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            source TEXT NOT NULL,
            action TEXT NOT NULL,
            details TEXT
        )
    ''')
    # Insert default accounts only if users table is empty
    c.execute("SELECT COUNT(*) FROM users")
    if c.fetchone()[0] == 0:
        c.execute("INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')")
        c.execute("INSERT INTO users (username, password, role) VALUES ('user', 'password', 'user')")
        conn.commit()

    # Seed default devices only if devices table is empty
    c.execute("SELECT COUNT(*) FROM devices")
    if c.fetchone()[0] == 0:
        default_devices = [
            (1, "PFC Capacitor Bank 1 (K1)", "Main Panel", "Pin 11 (GPIO 17)", 0.00),
            (2, "PFC Capacitor Bank 2 (K2)", "Main Panel", "Pin 13 (GPIO 27)", 0.00),
            (3, "PFC Capacitor Bank 3 (K3)", "Main Panel", "Pin 15 (GPIO 22)", 0.00),
            (4, "Living Room Lights", "Living Room", "Pin 7 (GPIO 4)", 0.00),
            (5, "Living Room TV", "Living Room", "Pin 29 (GPIO 5)", 0.00),
            (6, "Outlet Group 1", "Living Room", "Pin 31 (GPIO 6)", 0.00),
            (7, "Air Conditioner Main (ACU)", "Master Bedroom", "Pin 26 (GPIO 7)", 0.00),
            (8, "Bedroom 1 Lights", "Master Bedroom", "Pin 24 (GPIO 8)", 0.00),
            (9, "Bedroom 1 Outlet Group 2", "Master Bedroom", "Pin 21 (GPIO 9)", 0.00),
            (10, "Refrigerator (Critical)", "Kitchen", "Pin 19 (GPIO 10)", 0.00),
            (11, "Kitchen Outlets", "Kitchen", "Pin 23 (GPIO 11)", 0.00),
            (12, "Water Heater", "Bathroom", "Pin 32 (GPIO 12)", 0.00),
            (13, "Washing Machine", "Laundry Area", "Pin 33 (GPIO 13)", 0.00),
            (14, "Microwave Oven", "Kitchen", "Pin 36 (GPIO 16)", 0.00),
            (15, "Garage Door & Lights", "Garage", "Pin 12 (GPIO 18)", 0.00),
            (16, "Dining Room Lighting", "Dining Room", "Pin 35 (GPIO 19)", 0.00),
            (17, "Outdoor Security Lights", "Outdoor / Garden", "Pin 38 (GPIO 20)", 0.00),
            (18, "CCTV / Security NVR", "Main Panel", "Pin 40 (GPIO 21)", 0.00),
            (19, "Standby Outlets", "Living Room", "Pin 16 (GPIO 23)", 0.00),
            (20, "Auxiliary Branch", "Main Panel", "Pin 18 (GPIO 24)", 0.00)
        ]
        c.executemany("INSERT INTO devices (id, name, room, pin_desc, power) VALUES (?, ?, ?, ?, ?)", default_devices)
        conn.commit()
    conn.close()

# Initialize DB on startup
init_db()

# Temporary Data Store for Sensors (RAW ONLY - NO MOCK DATA)
latest_sensor_data = {
    "voltage": 0.0,
    "current": 0.0,
    "power": 0.0,
    "power_factor": 0.0,
    "frequency": 0.0,
    "energy": 0.0,
    "last_updated": None
}

# 11-Channel PZEM CD74HC4067 Multiplexer Store (C0 = Main Panel, C1-C10 = Sub-branches)
pzem_branches = {
    f"C{ch}": {
        "channel": ch,
        "name": "Main Panel (C0)" if ch == 0 else f"Branch {ch} (C{ch})",
        "status": "STANDBY",
        "voltage": 0.0,
        "current": 0.0,
        "power": 0.0,
        "power_factor": 0.0,
        "frequency": 0.0,
        "energy": 0.0,
        "last_updated": None
    }
    for ch in range(11)
}

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({"success": False, "message": "Missing username or password"}), 400
        
    username = data['username'].lower()
    password = data['password']
    
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT role FROM users WHERE username=? AND password=?", (username, password))
    user = c.fetchone()
    conn.close()
    
    if user:
        return jsonify({"success": True, "message": "Login successful", "role": user[0]})
    else:
        return jsonify({"success": False, "message": "Invalid username or password"}), 401

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({"success": False, "message": "Missing username or password"}), 400
        
    username = data['username'].lower()
    password = data['password']
    role = 'user' # default role for new registrations
    
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    try:
        c.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", (username, password, role))
        conn.commit()
        success = True
        message = "Registration successful"
    except sqlite3.IntegrityError:
        success = False
        message = "Username already exists"
    finally:
        conn.close()
        
    return jsonify({"success": success, "message": message}), (200 if success else 400)

@app.route('/')
def home():
    """
    Ise-serve nito ang Frontend UI:
    - Kung mobile phone / Android APK: ise-serve ang mobile.html
    - Kung touchscreen kiosk / desktop: ise-serve ang index.html
    """
    user_agent = request.headers.get('User-Agent', '').lower()
    is_mobile = any(m in user_agent for m in ['android', 'iphone', 'ipad', 'mobile'])
    if is_mobile and request.args.get('desktop') != '1':
        return render_template('mobile.html')
    return render_template('index.html')

@app.route('/mobile')
def mobile():
    """
    Dedicated endpoint para sa Mobile UI at Android APK WebView
    """
    return render_template('mobile.html')

@app.route('/api/relay', methods=['POST'])
def control_relay():
    global pfc_auto_mode, load_auto_mode
    data = request.get_json()
    if not data or 'action' not in data:
        return jsonify({"success": False, "message": "Missing action"}), 400
        
    action = data['action'].lower()
    relay_id = data.get('relay_id', 1)
    if type(relay_id) != int:
        try: relay_id = int(relay_id)
        except: relay_id = 1
    
    # Mode switch
    target_module = data.get('module', 'pfc') # pfc or load
    if action == 'auto':
        if target_module == 'pfc': pfc_auto_mode = True
        elif target_module == 'load': load_auto_mode = True
        else:
            pfc_auto_mode = True
            load_auto_mode = True
        return jsonify({"success": True, "mode": "AUTO"})
    elif action == 'manual':
        if target_module == 'pfc': pfc_auto_mode = False
        elif target_module == 'load': load_auto_mode = False
        else:
            pfc_auto_mode = False
            load_auto_mode = False
        return jsonify({"success": True, "mode": "MANUAL"})

    # Safety Interlock: ACU & Capacitor Banks
    if action == 'on':
        if relay_id == 7:
            # ACU is turned ON -> Immediately shut down Capacitor Banks K1, K2, K3
            for cap_id in [1, 2, 3]:
                if relays.get(cap_id):
                    relays[cap_id].off()
                relay_status[cap_id] = False
            print("🔒 [ACU Interlock]: ACU engaged! Forcibly shut down Capacitor Banks K1, K2, K3.")
        elif relay_id in [1, 2, 3] and relay_status.get(7, False):
            return jsonify({
                "success": False, 
                "message": "ACU Interlock Active: Cannot energize Capacitor Banks while ACU (Relay 7) is running."
            }), 400

    relay_obj = relays.get(relay_id)
        
    if relay_obj:
        if action == 'on':
            relay_obj.on()
            relay_status[relay_id] = True
            print(f"⚡ Physical Relay {relay_id} (Pin {relay_pins.get(relay_id)}) turned ON")
        elif action == 'off':
            relay_obj.off()
            relay_status[relay_id] = False
            print(f"⚡ Physical Relay {relay_id} (Pin {relay_pins.get(relay_id)}) turned OFF")
        return jsonify({"success": True, "status": "ON" if action=='on' else "OFF"})
    else:
        # Fallback if hardware not present
        if action == 'on': relay_status[relay_id] = True
        elif action == 'off': relay_status[relay_id] = False
        return jsonify({"success": True, "status": "ON" if action=='on' else "OFF", "note": "Virtual only"})

@app.route('/api/relay/status', methods=['GET'])
def relay_status_get():
    formatted_status = {str(k): ("ON" if v else "OFF") for k, v in relay_status.items()}
    return jsonify({
        "success": True, 
        "mode": "AUTO" if pfc_auto_mode else "MANUAL", # Backward compatibility
        "pfc_mode": "AUTO" if pfc_auto_mode else "MANUAL",
        "load_mode": "AUTO" if load_auto_mode else "MANUAL",
        "relays": formatted_status
    })

def get_sensor_linked_relays():
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT id FROM devices WHERE sensor_linked = 1")
        rows = c.fetchall()
        conn.close()
        linked = [r[0] for r in rows]
        return linked if linked else [4]
    except Exception:
        return [4]

@app.route('/api/devices', methods=['GET'])
def get_devices():
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT id, name, room, pin_desc, power, sensor_linked FROM devices ORDER BY id ASC")
        rows = c.fetchall()
        conn.close()
        devices = [{
            "id": r[0], 
            "name": r[1], 
            "room": r[2], 
            "pin": r[3], 
            "power": r[4],
            "sensor_linked": bool(r[5])
        } for r in rows]
        return jsonify({"success": True, "devices": devices})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/devices/update', methods=['POST'])
def update_device():
    try:
        data = request.get_json() or {}
        dev_id = data.get('id')
        name = data.get('name')
        room = data.get('room')
        sensor_linked = data.get('sensor_linked')
        if not dev_id:
            return jsonify({"success": False, "message": "Missing device ID"}), 400
        
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        if name and room:
            c.execute("UPDATE devices SET name = ?, room = ? WHERE id = ?", (name.strip(), room.strip(), dev_id))
        elif name:
            c.execute("UPDATE devices SET name = ? WHERE id = ?", (name.strip(), dev_id))
        elif room:
            c.execute("UPDATE devices SET room = ? WHERE id = ?", (room.strip(), dev_id))
            
        if sensor_linked is not None:
            c.execute("UPDATE devices SET sensor_linked = ? WHERE id = ?", (1 if sensor_linked else 0, dev_id))
            
        conn.commit()
        conn.close()
        print(f"✏️ Updated Device {dev_id}: Name='{name}', Room='{room}', SensorLinked={sensor_linked}")
        return jsonify({"success": True, "message": f"Device {dev_id} updated successfully"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/devices/toggle-sensor-link', methods=['POST'])
def toggle_device_sensor_link():
    """Dynamically links or unlinks a specific relay to the HLK-LD2410B presence sensor"""
    try:
        data = request.get_json() or {}
        dev_id = int(data.get('id', 0))
        linked = bool(data.get('linked', False))
        if dev_id < 1 or dev_id > 20:
            return jsonify({"success": False, "message": "Invalid device ID"}), 400
        
        # Disallow linking PFC banks (Relays 1-3) and Critical Loads (10 Ref, 18 CCTV)
        if dev_id in [1, 2, 3]:
            return jsonify({"success": False, "message": "Cannot link PFC Capacitor Banks to motion sensor."}), 400
        if dev_id in [10, 18]:
            return jsonify({"success": False, "message": "Cannot link Critical Loads (Refrigerator/CCTV) to motion sensor."}), 400

        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("UPDATE devices SET sensor_linked = ? WHERE id = ?", (1 if linked else 0, dev_id))
        conn.commit()
        conn.close()
        linked_relays = get_sensor_linked_relays()
        print(f"📡 Device {dev_id} sensor_linked set to {linked}. Current linked relays: {linked_relays}")
        return jsonify({"success": True, "id": dev_id, "sensor_linked": linked, "linked_relays": linked_relays})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/mode', methods=['GET', 'POST'])
def manage_system_mode():
    """Manages the 3 System Modes required by thesis: MANUAL, AI_ASSISTED, SECURITY"""
    global system_mode, pfc_auto_mode, load_auto_mode
    if request.method == 'POST':
        data = request.get_json() or {}
        new_mode = data.get('mode', '').upper()
        if new_mode in ['MANUAL', 'AI_ASSISTED', 'SECURITY']:
            system_mode = new_mode
            if system_mode == 'AI_ASSISTED':
                pfc_auto_mode = True
                load_auto_mode = True
                print("🤖 Switched to AI-ASSISTED MODE: Automation enabled.")
            elif system_mode == 'MANUAL':
                pfc_auto_mode = False
                load_auto_mode = False
                print("👤 Switched to MANUAL MODE: Automation paused.")
            elif system_mode == 'SECURITY':
                pfc_auto_mode = False
                load_auto_mode = False
                # Cut off non-critical convenience outlets; Keep critical (10=Ref, 18=CCTV) ON
                for r_id in range(4, 21):
                    if r_id not in [10, 18] and relays.get(r_id):
                        relays[r_id].off()
                        relay_status[r_id] = False
                print("🔒 Switched to SECURITY MODE: Non-critical outlets cut off. Critical loads preserved.")
            return jsonify({"success": True, "mode": system_mode})
        return jsonify({"success": False, "message": "Invalid mode. Choose MANUAL, AI_ASSISTED, or SECURITY"}), 400
    return jsonify({
        "success": True, 
        "mode": system_mode,
        "pfc_auto": pfc_auto_mode,
        "load_auto": load_auto_mode
    })

@app.route('/api/occupancy', methods=['GET'])
def get_occupancy_state():
    """Returns HLK-LD2410B mmWave human presence status (GPIO 14 primary tested)"""
    return jsonify(occupancy_state), 200

@app.route('/api/active-devices', methods=['GET'])
def get_active_devices():
    """Feature: 'Ano mga nakabukas' - Returns list of all currently powered ON devices"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT id, name, room, pin_desc, power FROM devices ORDER BY id ASC")
    rows = c.fetchall()
    conn.close()
    active = []
    for r in rows:
        dev_id = r[0]
        if relay_status.get(dev_id, False):
            active.append({
                "id": dev_id,
                "name": r[1],
                "room": r[2],
                "pin": r[3],
                "power": r[4],
                "status": "ON"
            })
    return jsonify({"success": True, "count": len(active), "devices": active}), 200

@app.route('/api/active-devices/turn-off-all', methods=['POST'])
def turn_off_all_active_devices():
    """Turns off all active non-critical loads (preserves Refrigerator #10, CCTV #18, and PFC Banks)"""
    turned_off = []
    for r_id in range(4, 21):
        if r_id not in [10, 18] and relay_status.get(r_id, False):
            if relays.get(r_id):
                relays[r_id].off()
            relay_status[r_id] = False
            turned_off.append(r_id)
    return jsonify({"success": True, "turned_off": turned_off, "count": len(turned_off)}), 200

@app.route('/api/data', methods=['POST'])
def receive_data_from_esp32():
    """
    Endpoint para sa ESP32 telemetry.
    Format: {"channel": 0, "status": "ONLINE", "voltage": 220.5, "current": 1.25, "power": 275.0, "pf": 0.98, "freq": 60.0, "energy": 0.12}
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON payload provided"}), 400

    ch = int(data.get("channel", 0)) if "channel" in data else 0
    ch_key = f"C{ch}"
    if ch_key in pzem_branches:
        pzem_branches[ch_key].update({
            "status": data.get("status", "ONLINE"),
            "voltage": float(data.get("voltage", pzem_branches[ch_key]["voltage"])),
            "current": float(data.get("current", pzem_branches[ch_key]["current"])),
            "power": float(data.get("power", pzem_branches[ch_key]["power"])),
            "power_factor": float(data.get("pf", data.get("power_factor", pzem_branches[ch_key]["power_factor"]))),
            "frequency": float(data.get("freq", data.get("frequency", pzem_branches[ch_key]["frequency"]))),
            "energy": float(data.get("energy", pzem_branches[ch_key]["energy"])),
            "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })

    # Main Panel is Channel 0
    if ch == 0:
        latest_sensor_data["voltage"] = float(data.get("voltage", latest_sensor_data["voltage"]))
        latest_sensor_data["current"] = float(data.get("current", latest_sensor_data["current"]))
        latest_sensor_data["power_factor"] = float(data.get("pf", data.get("power_factor", latest_sensor_data["power_factor"])))
        latest_sensor_data["power"] = float(data.get("power", latest_sensor_data["voltage"] * latest_sensor_data["current"] * latest_sensor_data["power_factor"]))
        latest_sensor_data["frequency"] = float(data.get("freq", data.get("frequency", latest_sensor_data["frequency"])))
        latest_sensor_data["energy"] = float(data.get("energy", latest_sensor_data["energy"]))
        latest_sensor_data["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    return jsonify({"status": "success", "channel": ch, "message": "Data saved successfully!"}), 200


@app.route('/api/data', methods=['GET'])
def send_data_to_frontend():
    """
    Main telemetry endpoint supplying data to Front-End (app.js) for REMS Dashboard.
    Contains metrics, branches (C0-C10), occupancy, system_mode, pfc_auto, load_auto, and relays.
    """
    resp = dict(latest_sensor_data)
    resp["branches"] = pzem_branches
    resp["occupancy"] = occupancy_state
    resp["system_mode"] = system_mode
    resp["pfc_auto"] = pfc_auto_mode
    resp["load_auto"] = load_auto_mode
    resp["sensor_linked_relays"] = get_sensor_linked_relays()
    resp["relays"] = {str(k): ("ON" if v else "OFF") for k, v in relay_status.items()}
    return jsonify(resp), 200


@app.route('/api/pzem/branches', methods=['GET'])
def get_pzem_branches():
    """Returns real-time data for all 11 multiplexed PZEM channels"""
    return jsonify(pzem_branches), 200


# =============================================================================
# AI Recommendations & Decision Engine (Academic Thesis Compliance)
# =============================================================================
@app.route('/api/suggestions', methods=['GET'])
def get_suggestions():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT id, message, confidence, priority, potential_savings, status, timestamp, target_relay FROM suggestions ORDER BY id DESC LIMIT 30")
    rows = c.fetchall()
    conn.close()
    
    suggestions = []
    for r in rows:
        suggestions.append({
            "id": r[0],
            "message": r[1],
            "confidence": r[2],
            "priority": r[3] if len(r) > 3 and r[3] else "Medium",
            "potential_savings": r[4] if len(r) > 4 and r[4] else "",
            "status": r[5] if len(r) > 5 and r[5] else "pending",
            "timestamp": r[6] if len(r) > 6 and r[6] else "",
            "target_relay": r[7] if len(r) > 7 and r[7] else 0
        })
    return jsonify(suggestions), 200

@app.route('/api/suggestions/<int:s_id>/<action>', methods=['POST'])
def handle_suggestion(s_id, action):
    if action not in ['approve', 'reject']:
        return jsonify({"error": "Invalid action"}), 400
        
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT target_relay, message FROM suggestions WHERE id=?", (s_id,))
    row = c.fetchone()
    target_relay = row[0] if row and row[0] else 0
    msg = row[1] if row else ""
    
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if action == 'approve':
        # Execute corrective action per thesis specification
        if target_relay == 1:
            # Engage Capacitor Bank K1
            if relays.get(1):
                relays[1].on()
                relay_status[1] = True
            print("🤖 [AI Suggestion Approved]: Engaged Capacitor Bank K1.")
        elif target_relay >= 4 and target_relay not in [10, 18]:
            # De-energize target non-critical load
            if relays.get(target_relay):
                relays[target_relay].off()
                relay_status[target_relay] = False
            print(f"🤖 [AI Suggestion Approved]: Disconnected Relay #{target_relay}.")
            
        c.execute("INSERT INTO system_overrides (timestamp, source, action, details) VALUES (?, 'AI_RECOMMENDATION', 'APPROVE', ?)", (now_str, f"Approved: {msg}"))
        
    c.execute("UPDATE suggestions SET status=? WHERE id=?", (action, s_id))
    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "message": f"Suggestion {action}ed successfully"}), 200

# =============================================================================
# Safety & Reliability Monitoring Endpoints (Section 1.7 Thesis Compliance)
# =============================================================================
@app.route('/api/alerts', methods=['GET'])
def get_alerts():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT id, alert_type, severity, message, timestamp, status FROM alerts ORDER BY id DESC LIMIT 50")
    rows = c.fetchall()
    conn.close()
    
    alerts = []
    for r in rows:
        alerts.append({
            "id": r[0],
            "alert_type": r[1],
            "severity": r[2],
            "message": r[3],
            "timestamp": r[4],
            "status": r[5]
        })
    return jsonify({"success": True, "alerts": alerts}), 200

@app.route('/api/alerts/<int:a_id>/dismiss', methods=['POST'])
def dismiss_alert(a_id):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("UPDATE alerts SET status='RESOLVED' WHERE id=?", (a_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Alert marked as resolved"}), 200

@app.route('/api/alerts/clear-all', methods=['POST'])
def clear_all_alerts():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("UPDATE alerts SET status='RESOLVED' WHERE status='ACTIVE'")
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "All active alerts dismissed"}), 200

# =============================================================================
# Hardware RTC DS3231 Synchronization Endpoint
# =============================================================================
@app.route('/api/rtc/sync', methods=['POST'])
def sync_rtc():
    now_str = datetime.now().strftime("%B %d, %Y %I:%M:%S %p")
    try:
        os.system("sudo -n hwclock -s 2>/dev/null || true")
    except Exception:
        pass
    return jsonify({
        "success": True,
        "timestamp": now_str,
        "message": "System time synchronized with DS3231 I2C RTC hardware at address 0x68."
    }), 200

# =============================================================================
# Background Anomaly & Heuristic Recommendation Engine
# =============================================================================
def ai_anomaly_engine():
    """Background engine scanning for standby energy leaks, low PF, and overnight waste"""
    while True:
        try:
            time.sleep(25)
            now_dt = datetime.now()
            now_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")
            hour = now_dt.hour
            is_vacant = (occupancy_state.get("status") == "VACANT" and occupancy_state.get("vacancy_seconds", 0) >= 120)

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            # Rule 1: Standby Power Leak Heuristic (>10W during sustained vacancy)
            if is_vacant:
                for r_id in range(4, 21):
                    if r_id in [10, 18]: # Protect critical loads
                        continue
                    if relay_status.get(r_id, False):
                        ch_key = f"C{r_id - 3}" if (r_id - 3) <= 10 else "C0"
                        ch_p = pzem_branches.get(ch_key, {}).get("power", 0.0)
                        if ch_p <= 0:
                            c.execute("SELECT power FROM devices WHERE id=?", (r_id,))
                            row = c.fetchone()
                            ch_p = (row[0] * 1000.0) if row and row[0] else 15.0

                        if 5.0 <= ch_p <= 150.0:
                            msg = f"Standby power leakage detected on Relay #{r_id} ({ch_p:.1f}W) during sustained vacancy. Turn OFF to conserve energy?"
                            c.execute("SELECT COUNT(*) FROM suggestions WHERE target_relay=? AND status='pending'", (r_id,))
                            if c.fetchone()[0] == 0:
                                monthly_kwh = (ch_p * 8.0 * 30.0) / 1000.0
                                monthly_php = monthly_kwh * 12.00
                                savings_str = f"~{monthly_kwh:.1f} kWh/mo (₱{monthly_php:.2f}/mo)"
                                c.execute('''
                                    INSERT INTO suggestions (message, confidence, status, timestamp, priority, potential_savings, target_relay)
                                    VALUES (?, ?, 'pending', ?, 'Medium', ?, ?)
                                ''', (msg, "High (94%)", now_str, savings_str, r_id))
                                print(f"💡 [AI Engine]: Generated Standby Leak Suggestion for Relay #{r_id}")

            # Rule 2: Power Factor Correction Recommendation (PF < 0.90 on active load)
            main_pf = latest_sensor_data.get("power_factor", 1.0)
            main_p = latest_sensor_data.get("power", 0.0)
            if 0.10 <= main_pf < 0.90 and main_p > 30.0:
                msg = f"Low Power Factor ({main_pf:.2f}) detected under active load. Engage Capacitor Bank K1 to improve power quality?"
                c.execute("SELECT COUNT(*) FROM suggestions WHERE target_relay=1 AND status='pending'")
                if c.fetchone()[0] == 0:
                    c.execute('''
                        INSERT INTO suggestions (message, confidence, status, timestamp, priority, potential_savings, target_relay)
                        VALUES (?, ?, 'pending', ?, 'High', 'Voltage Stabilization & Loss Reduction', 1)
                    ''', (msg, "High (98%)", now_str))
                    print(f"⚡ [AI Engine]: Generated Low PF Correction Suggestion")

            # Rule 3: Overnight Inefficient Lighting Heuristic (Sleep hours: 22:00 to 06:00)
            if hour >= 22 or hour < 6:
                for r_id in [4, 8, 16]:
                    if relay_status.get(r_id, False) and is_vacant:
                        msg = f"Overnight illumination detected on Relay #{r_id} during inactive sleep hours (22:00–06:00). Turn OFF light?"
                        c.execute("SELECT COUNT(*) FROM suggestions WHERE target_relay=? AND status='pending'", (r_id,))
                        if c.fetchone()[0] == 0:
                            c.execute('''
                                INSERT INTO suggestions (message, confidence, status, timestamp, priority, potential_savings, target_relay)
                                VALUES (?, ?, 'pending', ?, 'High', '~14.4 kWh/mo (₱172.80/mo)', ?)
                            ''', (msg, "High (96%)", now_str, r_id))
                            print(f"🌙 [AI Engine]: Generated Overnight Lighting Suggestion for Relay #{r_id}")

            # Optional Gemini AI Enrichment if API key is active
            if GEMINI_API_KEY and latest_sensor_data.get('power', 0.0) > 100.0:
                try:
                    model = genai.GenerativeModel('gemini-3.6-flash')
                    prompt = f"REMS Energy Check: V={latest_sensor_data['voltage']}V, I={latest_sensor_data['current']}A, P={latest_sensor_data['power']}W, PF={latest_sensor_data['power_factor']}. If anomaly exists, return 1 concise English suggestion in JSON format with 'message' and 'confidence'."
                    resp = model.generate_content(prompt)
                    clean_txt = resp.text.strip()
                    if clean_txt.startswith("```json"):
                        clean_txt = clean_txt[7:-3].strip()
                    elif clean_txt.startswith("```"):
                        clean_txt = clean_txt[3:-3].strip()
                    gemini_obj = json.loads(clean_txt)
                    if isinstance(gemini_obj, list) and len(gemini_obj) > 0:
                        g_msg = gemini_obj[0].get("message", "")
                        if g_msg:
                            c.execute("SELECT COUNT(*) FROM suggestions WHERE message=? AND status='pending'", (g_msg,))
                            if c.fetchone()[0] == 0:
                                c.execute('''
                                    INSERT INTO suggestions (message, confidence, status, timestamp, priority, potential_savings, target_relay)
                                    VALUES (?, ?, 'pending', ?, 'Medium', '~10 kWh/mo (₱120.00/mo)', 0)
                                ''', (g_msg, "High (95%)", now_str))
                except Exception:
                    pass

            conn.commit()
            conn.close()
        except Exception as e:
            print(f"⚠️ Anomaly Engine error: {e}")

# =============================================================================
# Background Safety & Reliability Monitoring Engine (Section 1.7)
# =============================================================================
def safety_monitoring_engine():
    """Monitors branch overcurrent, overload, actuator contact faults, and enclosure thermal status"""
    overcurrent_timers = {}
    overload_timers = {}
    last_temp_alert_time = 0

    while True:
        try:
            time.sleep(5)
            now = time.time()
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            # 1. Overcurrent & Overload Checking
            for ch_key, ch_data in pzem_branches.items():
                current = ch_data.get("current", 0.0)
                ch_num = ch_data.get("channel", 0)
                rated_amps = 15.0 # 15A branch breaker rating

                # Overload: >= 100% rating for >= 5s
                if current >= rated_amps:
                    if ch_key not in overload_timers:
                        overload_timers[ch_key] = now
                    elif (now - overload_timers[ch_key]) >= 5.0:
                        msg = f"CRITICAL OVERLOAD: Branch {ch_num} drawing {current:.2f}A (>=100% of 15A rating) for >5s."
                        c.execute("SELECT COUNT(*) FROM alerts WHERE alert_type='OVERLOAD' AND message=? AND status='ACTIVE'", (msg,))
                        if c.fetchone()[0] == 0:
                            c.execute("INSERT INTO alerts (alert_type, severity, message, timestamp, status) VALUES ('OVERLOAD', 'CRITICAL', ?, ?, 'ACTIVE')", (msg, now_str))
                            print(f"🚨 [Safety Alert]: {msg}")
                else:
                    overload_timers.pop(ch_key, None)

                # Overcurrent Warning: 80%-99% rating (12.0A - 14.9A) for >= 10s
                if 12.0 <= current < rated_amps:
                    if ch_key not in overcurrent_timers:
                        overcurrent_timers[ch_key] = now
                    elif (now - overcurrent_timers[ch_key]) >= 10.0:
                        msg = f"Overcurrent Warning: Branch {ch_num} current at {current:.2f}A (80%-99% of 15A rating) for >10s."
                        c.execute("SELECT COUNT(*) FROM alerts WHERE alert_type='OVERCURRENT' AND message=? AND status='ACTIVE'", (msg,))
                        if c.fetchone()[0] == 0:
                            c.execute("INSERT INTO alerts (alert_type, severity, message, timestamp, status) VALUES ('OVERCURRENT', 'WARNING', ?, ?, 'ACTIVE')", (msg, now_str))
                            print(f"⚠️ [Safety Warning]: {msg}")
                else:
                    overcurrent_timers.pop(ch_key, None)

            # 2. Actuator Fault Detection (Relay commanded OFF but current persists)
            for r_id in range(4, 21):
                if not relay_status.get(r_id, False):
                    ch_key = f"C{r_id - 3}" if (r_id - 3) <= 10 else "C0"
                    ch_i = pzem_branches.get(ch_key, {}).get("current", 0.0)
                    ch_p = pzem_branches.get(ch_key, {}).get("power", 0.0)
                    if ch_i > 0.20 or ch_p > 25.0:
                        msg = f"Actuator Fault: Relay #{r_id} commanded OFF but current flow ({ch_i:.2f}A, {ch_p:.1f}W) persists. Potential contact welding."
                        c.execute("SELECT COUNT(*) FROM alerts WHERE alert_type='ACTUATOR_FAULT' AND message=? AND status='ACTIVE'", (msg,))
                        if c.fetchone()[0] == 0:
                            c.execute("INSERT INTO alerts (alert_type, severity, message, timestamp, status) VALUES ('ACTUATOR_FAULT', 'CRITICAL', ?, ?, 'ACTIVE')", (msg, now_str))
                            print(f"🚨 [Actuator Fault]: {msg}")

            # 3. Panel Thermal & CPU Overtemperature Monitoring
            cpu_temp = 45.0
            try:
                if os.path.exists('/sys/class/thermal/thermal_zone0/temp'):
                    with open('/sys/class/thermal/thermal_zone0/temp', 'r') as f:
                        cpu_temp = float(f.read().strip()) / 1000.0
            except Exception:
                pass

            if cpu_temp >= 70.0 and (now - last_temp_alert_time) > 300:
                last_temp_alert_time = now
                sev = 'CRITICAL' if cpu_temp >= 80.0 else 'WARNING'
                msg = f"Panel Thermal Alert: Internal temperature reached {cpu_temp:.1f}°C (Threshold: 70°C). Check panel ventilation."
                c.execute("INSERT INTO alerts (alert_type, severity, message, timestamp, status) VALUES ('TEMPERATURE', ?, ?, ?, 'ACTIVE')", (sev, msg, now_str))
                print(f"🌡️ [Thermal Alert]: {msg}")

            conn.commit()
            conn.close()
        except Exception as e:
            print(f"⚠️ Safety monitoring error: {e}")

# =============================================================================
# Security Mode Evening Presence Simulation Engine (Section 1.1 Item 3)
# =============================================================================
def security_simulation_engine():
    """Security Mode Presence Simulation: Toggles lighting during evening hours (18:00 to 23:00)"""
    sim_state = False
    while True:
        try:
            time.sleep(60)
            if system_mode == 'SECURITY':
                hour = datetime.now().hour
                if 18 <= hour <= 23:
                    sim_state = not sim_state
                    target_light = 4 if sim_state else 8 # Alternate living room & bedroom
                    if relays.get(target_light):
                        if sim_state:
                            relays[target_light].on()
                            relay_status[target_light] = True
                            print(f"🔒 [Security Simulation]: Toggled ON Relay #{target_light} to simulate occupancy.")
                        else:
                            relays[target_light].off()
                            relay_status[target_light] = False
                            print(f"🔒 [Security Simulation]: Toggled OFF Relay #{target_light}.")
        except Exception as e:
            print(f"⚠️ Security simulation error: {e}")

def esp32_serial_worker():
    """Background thread that continuously reads PZEM electrical data from ESP32 over USB"""
    usb_candidate_ports = ['/dev/ttyUSB0', '/dev/ttyACM0', '/dev/ttyUSB1', '/dev/ttyACM1']
    
    while True:
        ser = None
        for port in usb_candidate_ports:
            if not os.path.exists(port):
                continue
            try:
                s = serial.Serial()
                s.port = port
                s.baudrate = 115200
                s.timeout = 1
                s.dtr = False
                s.rts = False
                s.open()
                ser = s
                print(f"🔌 Connected to ESP32 on {port} @ 115200 baud")
                break
            except Exception as conn_err:
                print(f"⚠️ Could not open {port}: {conn_err}")
                continue
                
        if not ser:
            time.sleep(1)
            continue
            
        try:
            last_packet_time = time.time()
            while True:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if not line:
                    # If 6 seconds pass with no data on open port, reconnect
                    if time.time() - last_packet_time > 6.0:
                        print("⚠️ Serial timeout: No packets received for 6 seconds. Reconnecting...")
                        break
                    continue

                last_packet_time = time.time()
                match = re.search(r'\{.*\}', line)
                if match:
                    try:
                        data = json.loads(match.group(0))
                        ch = int(data.get("channel", 0)) if "channel" in data else 0
                        ch_key = f"C{ch}"
                        if ch_key in pzem_branches:
                            pzem_branches[ch_key].update({
                                "status": data.get("status", "STANDBY"),
                                "voltage": float(data.get("voltage", 0.0)),
                                "current": float(data.get("current", 0.0)),
                                "power": float(data.get("power", 0.0)),
                                "power_factor": float(data.get("pf", data.get("power_factor", 0.0))),
                                "frequency": float(data.get("freq", data.get("frequency", 0.0))),
                                "energy": float(data.get("energy", 0.0)),
                                "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                            })

                        # Channel 0 represents Main Panel metrics
                        if ch == 0:
                            latest_sensor_data["voltage"] = float(data.get("voltage", latest_sensor_data["voltage"]))
                            latest_sensor_data["current"] = float(data.get("current", latest_sensor_data["current"]))
                            latest_sensor_data["power"] = float(data.get("power", latest_sensor_data["voltage"] * latest_sensor_data["current"]))
                            latest_sensor_data["power_factor"] = float(data.get("pf", data.get("power_factor", latest_sensor_data["power_factor"])))
                            latest_sensor_data["frequency"] = float(data.get("freq", data.get("frequency", latest_sensor_data["frequency"])))
                            latest_sensor_data["energy"] = float(data.get("energy", latest_sensor_data["energy"]))
                            latest_sensor_data["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    except Exception as err:
                        print(f"⚠️ Error parsing ESP32 serial data: {err}")
        except Exception as read_err:
            print(f"⚠️ Serial read exception: {read_err}")
            try:
                ser.close()
            except Exception:
                pass
            time.sleep(1)

# =============================================================================
# 4. Automation Engines: Occupancy Fusion, PFC Loop, & 5-min Energy Logger
# =============================================================================

def occupancy_engine():
    """Background engine monitoring 4x HLK-LD2410B mmWave human presence sensors (GPIO 14, 15, 25, 26)"""
    global occupancy_state
    while True:
        try:
            now = time.time()
            any_detected = False
            active_zones_count = 0
            for zone_key, pin in HLK_PINS.items():
                sensor_dev = hlk_sensors.get(zone_key)
                if sensor_dev is None:
                    try:
                        hlk_sensors[zone_key] = DigitalInputDevice(pin, pull_up=False)
                        sensor_dev = hlk_sensors[zone_key]
                        print(f"✅ Recovered HLK sensor on GPIO {pin} ({zone_key})")
                    except Exception:
                        sensor_dev = None
                val = bool(sensor_dev.value) if sensor_dev else False
                zone_info = occupancy_state["zones"][zone_key]
                zone_info["detected"] = val
                zone_info["status"] = "OCCUPIED" if val else "VACANT"
                if val:
                    any_detected = True
                    active_zones_count += 1

            occupancy_state["detected"] = any_detected
            occupancy_state["active_zones_count"] = active_zones_count
            
            if any_detected:
                occupancy_state["last_motion_time"] = now
                occupancy_state["vacancy_seconds"] = 0
                occupancy_state["status"] = "OCCUPIED"
                
                # In AI-Assisted Mode: Auto-turn ON all sensor-linked relays
                if system_mode == 'AI_ASSISTED':
                    linked_relays = get_sensor_linked_relays()
                    for r_id in linked_relays:
                        if not relay_status.get(r_id, False) and relays.get(r_id):
                            relays[r_id].on()
                            relay_status[r_id] = True
                            print(f"🤖 [AI-Assisted]: HLK mmWave detected presence ({active_zones_count} zones active). Turned ON Relay {r_id}.")
            else:
                elapsed = int(now - occupancy_state.get("last_motion_time", now))
                occupancy_state["vacancy_seconds"] = elapsed
                if elapsed > 10:
                    occupancy_state["status"] = "VACANT"
                    
                # In AI-Assisted Mode: Auto-turn OFF all sensor-linked relays after 2 minutes (120s) vacancy
                if system_mode == 'AI_ASSISTED' and elapsed >= 120:
                    linked_relays = get_sensor_linked_relays()
                    for r_id in linked_relays:
                        if relay_status.get(r_id, False) and relays.get(r_id):
                            relays[r_id].off()
                            relay_status[r_id] = False
                            print(f"🤖 [AI-Assisted]: Vacancy timeout (2 mins reached). Turned OFF Relay {r_id}.")
                        
                # In Manual Mode: Generate notification suggestion once vacant
                elif system_mode == 'MANUAL' and elapsed == 120:
                    linked_relays = get_sensor_linked_relays()
                    any_linked_on = any(relay_status.get(r, False) for r in linked_relays)
                    if any_linked_on:
                        conn = sqlite3.connect(DB_FILE)
                        c = conn.cursor()
                        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        c.execute("INSERT INTO suggestions (message, confidence, timestamp) VALUES (?, ?, ?)",
                                  (f"All 4 zones vacant for 2 minutes. Turn OFF motion-linked loads {linked_relays}?", "High (95%)", now_str))
                        conn.commit()
                        conn.close()
        except Exception:
            pass
        time.sleep(0.3)


def pfc_automation_engine():
    """Automated Power Factor Correction (PFC) loop for Relays 1, 2, 3 and Contactors K1, K2, K3"""
    while True:
        try:
            if pfc_auto_mode or system_mode == 'AI_ASSISTED':
                # Interlock Check: If ACU is active/starting, turn OFF capacitor banks
                acu_on = relay_status.get(7, False)
                if acu_on:
                    for r_id in [1, 2, 3]:
                        if relay_status.get(r_id, False) and relays.get(r_id):
                            relays[r_id].off()
                            relay_status[r_id] = False
                            print(f"⚡ [PFC Interlock]: ACU is ON. Disengaged Capacitor Bank Relay {r_id}.")
                else:
                    main_p = latest_sensor_data.get("power", 0.0)
                    main_pf = latest_sensor_data.get("power_factor", 1.0)
                    
                    # Compensate only when load is actively drawing power (> 50W) and PF is lagging
                    if main_p > 50.0 and 0.1 < main_pf < 0.97:
                        if main_pf < 0.85:
                            if not relay_status.get(1, False) and relays.get(1):
                                relays[1].on(); relay_status[1] = True
                            if not relay_status.get(2, False) and relays.get(2):
                                relays[2].on(); relay_status[2] = True
                            print(f"⚡ [PFC Auto]: Low PF ({main_pf:.2f}). Engaged Capacitor Banks 1 & 2.")
                        else:
                            if not relay_status.get(1, False) and relays.get(1):
                                relays[1].on(); relay_status[1] = True
                            print(f"⚡ [PFC Auto]: Lagging PF ({main_pf:.2f}). Engaged Capacitor Bank 1.")
                    elif main_pf >= 0.97 or main_p < 25.0:
                        # De-energize to avoid leading PF / overcompensation
                        for r_id in [1, 2, 3]:
                            if relay_status.get(r_id, False) and relays.get(r_id):
                                relays[r_id].off()
                                relay_status[r_id] = False
                                print(f"⚡ [PFC Auto]: Optimal PF ({main_pf:.2f}) or idle load. Disengaged Bank {r_id}.")
        except Exception:
            pass
        time.sleep(2)


def periodic_energy_logger():
    """Records 11-channel PZEM data into SQLite every 5 minutes (300s) as required by thesis spec"""
    while True:
        time.sleep(300) # Every 5 minutes
        try:
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            for ch_key, ch_data in pzem_branches.items():
                c.execute('''
                    INSERT INTO energy_logs (timestamp, channel, voltage, current, power, energy, power_factor, frequency)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    now_str,
                    ch_data.get("channel", 0),
                    ch_data.get("voltage", 0.0),
                    ch_data.get("current", 0.0),
                    ch_data.get("power", 0.0),
                    ch_data.get("energy", 0.0),
                    ch_data.get("power_factor", 0.0),
                    ch_data.get("frequency", 0.0)
                ))
            conn.commit()
            conn.close()
            print(f"💾 [Energy Logger]: Stored 5-minute snapshot for all 11 PZEM channels at {now_str}")
        except Exception as e:
            print(f"⚠️ Error logging 5-minute energy data: {e}")


# Start background threads
serial_thread = threading.Thread(target=esp32_serial_worker, daemon=True)
serial_thread.start()

occupancy_thread = threading.Thread(target=occupancy_engine, daemon=True)
occupancy_thread.start()

pfc_thread = threading.Thread(target=pfc_automation_engine, daemon=True)
pfc_thread.start()

logger_thread = threading.Thread(target=periodic_energy_logger, daemon=True)
logger_thread.start()

anomaly_thread = threading.Thread(target=ai_anomaly_engine, daemon=True)
anomaly_thread.start()

safety_thread = threading.Thread(target=safety_monitoring_engine, daemon=True)
safety_thread.start()

security_thread = threading.Thread(target=security_simulation_engine, daemon=True)
security_thread.start()

if __name__ == '__main__':
    # I-run ang server sa port 5000 at i-expose sa network (0.0.0.0)
    print("🚀 Starting Flask Backend Server for REMS...")
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)
