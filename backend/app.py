from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from datetime import datetime
import sqlite3
import os
from dotenv import load_dotenv
import google.generativeai as genai
import json

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

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
    # Insert default accounts only if users table is empty
    c.execute("SELECT COUNT(*) FROM users")
    if c.fetchone()[0] == 0:
        c.execute("INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')")
        c.execute("INSERT INTO users (username, password, role) VALUES ('user', 'password', 'user')")
        conn.commit()
    conn.close()

# Initialize DB on startup
init_db()

# Temporary Data Store for Sensors
latest_sensor_data = {
    "voltage": 220.0,
    "current": 0.0,
    "power": 0.0,
    "power_factor": 1.0,
    "last_updated": None
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

@app.route('/api/data', methods=['POST'])
def receive_data_from_esp32():
    """
    Dito ipapadala ng ESP32 yung data.
    Format na ie-expect: {"voltage": 220, "current": 5, "power_factor": 0.92}
    """
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "No JSON payload provided"}), 400

    # I-update yung latest data
    latest_sensor_data["voltage"] = data.get("voltage", latest_sensor_data["voltage"])
    latest_sensor_data["current"] = data.get("current", latest_sensor_data["current"])
    latest_sensor_data["power_factor"] = data.get("power_factor", latest_sensor_data["power_factor"])
    
    # Calculate Power (P = V * I * PF)
    latest_sensor_data["power"] = latest_sensor_data["voltage"] * latest_sensor_data["current"] * latest_sensor_data["power_factor"]
    
    # Timestamp
    latest_sensor_data["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    print(f"📡 New Data from ESP32: {latest_sensor_data}")
    return jsonify({"status": "success", "message": "Data saved successfully!"}), 200


@app.route('/api/data', methods=['GET'])
def send_data_to_frontend():
    """
    Dito kukuha ng data yung Front-End (Vite/app.js) para i-display sa Dashboard
    """
    return jsonify(latest_sensor_data), 200


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

# Start background thread
anomaly_thread = threading.Thread(target=ai_anomaly_engine, daemon=True)
anomaly_thread.start()

if __name__ == '__main__':
    # I-run ang server sa port 5000 at i-expose sa network (0.0.0.0)
    print("🚀 Starting Flask Backend Server for REMS...")
    app.run(host='0.0.0.0', port=5000, debug=True)
