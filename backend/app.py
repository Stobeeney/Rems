from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from datetime import datetime
import sqlite3
import os
from dotenv import load_dotenv
import google.generativeai as genai
import json
from gpiozero import OutputDevice
import serial
import re
import threading
import time

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Initialize 20 Relays (Active Low for most relay modules)
# 1-3 are PFC, 4-20 are Load Control branches.
relay_pins = {
    1: 17, 2: 27, 3: 22,
    4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
    11: 11, 12: 12, 13: 13, 14: 16, 15: 18,
    16: 19, 17: 20, 18: 21, 19: 23, 20: 24
}
relays = {}
relay_status = {}
pfc_auto_mode = False # Default to manual so user has full direct control
load_auto_mode = False # Default to manual so user has full direct control

for r_id, pin in relay_pins.items():
    try:
        relays[r_id] = OutputDevice(pin, active_high=False, initial_value=False)
        relay_status[r_id] = False
    except Exception as e:
        print(f"Error initializing relay {r_id} on pin {pin}: {e}")
        relays[r_id] = None
        relay_status[r_id] = False

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
            timestamp TEXT NOT NULL
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            room TEXT NOT NULL,
            pin_desc TEXT,
            power REAL DEFAULT 0.00
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
    Ise-serve nito ang Frontend UI (Login & Dashboard)
    """
    return render_template('index.html')

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

    # If user manually toggles a relay, automatically permit it!
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

@app.route('/api/devices', methods=['GET'])
def get_devices():
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT id, name, room, pin_desc, power FROM devices ORDER BY id ASC")
        rows = c.fetchall()
        conn.close()
        devices = [{"id": r[0], "name": r[1], "room": r[2], "pin": r[3], "power": r[4]} for r in rows]
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
        conn.commit()
        conn.close()
        print(f"✏️ Updated Device {dev_id}: Name='{name}', Room='{room}'")
        return jsonify({"success": True, "message": f"Device {dev_id} updated successfully"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

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
    Dito kukuha ng data yung Front-End (Vite/app.js) para i-display sa Dashboard.
    Naglalaman ng parehong top-level metrics (Main Panel) at branches dictionary (C0-C10).
    """
    resp = dict(latest_sensor_data)
    resp["branches"] = pzem_branches
    return jsonify(resp), 200


@app.route('/api/pzem/branches', methods=['GET'])
def get_pzem_branches():
    """Returns real-time data for all 11 multiplexed PZEM channels"""
    return jsonify(pzem_branches), 200


@app.route('/api/suggestions', methods=['GET'])
def get_suggestions():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT id, message, confidence, status, timestamp FROM suggestions WHERE status='pending' ORDER BY id DESC")
    rows = c.fetchall()
    conn.close()
    
    suggestions = []
    for r in rows:
        suggestions.append({
            "id": r[0],
            "message": r[1],
            "confidence": r[2],
            "status": r[3],
            "timestamp": r[4]
        })
    return jsonify(suggestions), 200

@app.route('/api/suggestions/<int:s_id>/<action>', methods=['POST'])
def handle_suggestion(s_id, action):
    if action not in ['approve', 'reject']:
        return jsonify({"error": "Invalid action"}), 400
        
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("UPDATE suggestions SET status=? WHERE id=?", (action, s_id))
    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "message": f"Suggestion {action}ed"}), 200

import threading
import time

def ai_anomaly_engine():
    """Background thread na mag-scan ng anomalies gamit ang Gemini API"""
    while True:
        time.sleep(30) # Check every 30 seconds
        
        if not GEMINI_API_KEY:
            print("No Gemini API key found, skipping AI check.")
            continue
            
        voltage = latest_sensor_data.get('voltage', 220.0)
        power = latest_sensor_data.get('power', 0.0)
        pf = latest_sensor_data.get('power_factor', 1.0)
        current = latest_sensor_data.get('current', 0.0)
        
        # Only query AI if there's actually some power draw or low PF to save API calls
        if power < 5 and pf >= 0.9:
            continue
            
        prompt = f"""
        You are an AI for a Residential Energy Management System. 
        Current sensor readings: Voltage={voltage}V, Current={current}A, Power={power}W, Power Factor={pf}.
        
        Analyze if there is an anomaly or optimization possible:
        - If power > 10W, it might be a standby leak if unoccupied. (Assume unoccupied for this check).
        - If power factor < 0.90, it needs capacitor bank correction.
        
        Return your response ONLY in valid JSON format as an array of suggestions. Each suggestion should be an object with 'message' and 'confidence' (e.g. "High (95%)").
        If no anomalies, return an empty array [].
        Example format:
        [
            {{"message": "Low Power Factor (0.85) detected. Enable Capacitor Bank?", "confidence": "High (98%)"}},
            {{"message": "Standby load detected (15W). Turn OFF Outlet?", "confidence": "Medium (75%)"}}
        ]
        """
        
        try:
            model = genai.GenerativeModel('gemini-3.6-flash')
            response = model.generate_content(prompt)
            # Basic parsing of JSON
            text_resp = response.text.strip()
            if text_resp.startswith("```json"):
                text_resp = text_resp[7:-3].strip()
            elif text_resp.startswith("```"):
                text_resp = text_resp[3:-3].strip()
                
            suggestions = json.loads(text_resp)
            
            if suggestions:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                
                for sug in suggestions:
                    msg = sug.get("message", "")
                    conf = sug.get("confidence", "High")
                    
                    # Prevent duplicate pending suggestions
                    c.execute("SELECT COUNT(*) FROM suggestions WHERE message=? AND status='pending'", (msg,))
                    if c.fetchone()[0] == 0:
                        c.execute("INSERT INTO suggestions (message, confidence, timestamp) VALUES (?, ?, ?)", (msg, conf, now_str))
                        print(f"🤖 AI Generated Suggestion: {msg}")
                        
                conn.commit()
                conn.close()
                
        except Exception as e:
            print(f"Error calling Gemini API: {e}")

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

# Start background threads
# anomaly_thread = threading.Thread(target=ai_anomaly_engine, daemon=True)
# anomaly_thread.start()  # Paused: Will only trigger once multiplexer & real sensors are online!

serial_thread = threading.Thread(target=esp32_serial_worker, daemon=True)
serial_thread.start()

if __name__ == '__main__':
    # I-run ang server sa port 5000 at i-expose sa network (0.0.0.0)
    print("🚀 Starting Flask Backend Server for REMS...")
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)
