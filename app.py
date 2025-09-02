import time
import threading
import board
import adafruit_dht
import digitalio
import atexit
import signal
import sys
import os
import json
from datetime import datetime, timedelta
from flask import Flask, jsonify, render_template, send_from_directory, request

# ------------------- Hardware Setup -------------------
# DHT11 sensor connected to GPIO4 (Pin 7 on Raspberry Pi header)
dht_device = adafruit_dht.DHT11(board.D4)

# Buzzer connected to GPIO17 (Pin 11 on Raspberry Pi header)
buzzer = digitalio.DigitalInOut(board.D17)
buzzer.direction = digitalio.Direction.OUTPUT
buzzer.value = False

# Global storage
sensor_data = {"temperature": None, "humidity": None, "buzzer": "OFF", "time": None, "error": False}

# Event to stop thread safely
stop_event = threading.Event()

# Historical data file paths
HIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "historicaldata")
HIST_FILE = os.path.join(HIST_DIR, "historical_data.json")

# Make sure folder exists
os.makedirs(HIST_DIR, exist_ok=True)

# Historical data storage and timing
historical_data = {"labels": [], "temp": [], "hum": []}
last_historical_save = None
HISTORICAL_INTERVAL = 300  # 5 minutes in seconds
MAX_HISTORICAL_POINTS = 288  # 24 hours * 12 points per hour (5-min intervals)

# 5-minute averaging variables
temp_readings_buffer = []
humidity_readings_buffer = []
buffer_start_time = None

# ------------------- Historical Data Functions -------------------
def load_historical_data():
    """Load historical data from file on startup"""
    global historical_data, last_historical_save
    try:
        if os.path.exists(HIST_FILE):
            with open(HIST_FILE, "r") as f:
                data = json.load(f)
            historical_data = data.get("data", {"labels": [], "temp": [], "hum": []})
            last_historical_save_str = data.get("last_save")
            if last_historical_save_str:
                last_historical_save = datetime.fromisoformat(last_historical_save_str)
            print(f"Loaded {len(historical_data['labels'])} historical data points")
        else:
            print("No historical data file found, starting fresh")
    except Exception as e:
        print(f"Error loading historical data: {e}")
        historical_data = {"labels": [], "temp": [], "hum": []}

def save_historical_data():
    """Save historical data to file"""
    try:
        data_to_save = {
            "data": historical_data,
            "last_save": last_historical_save.isoformat() if last_historical_save else None
        }
        with open(HIST_FILE, "w") as f:
            json.dump(data_to_save, f, indent=2)
        print(f"Saved historical data with {len(historical_data['labels'])} points")
    except Exception as e:
        print(f"Error saving historical data: {e}")

def add_to_buffer(temperature, humidity):
    """Add readings to the 5-minute averaging buffer"""
    global temp_readings_buffer, humidity_readings_buffer, buffer_start_time
    
    now = datetime.now()
    
    # Initialize buffer start time if this is the first reading
    if buffer_start_time is None:
        buffer_start_time = now
        print(f"Started new 5-minute averaging period at {buffer_start_time.strftime('%I:%M:%S %p')}")
    
    # Add readings to buffer
    temp_readings_buffer.append(temperature)
    humidity_readings_buffer.append(humidity)
    
    # Check if 5 minutes have passed
    if (now - buffer_start_time).total_seconds() >= HISTORICAL_INTERVAL:
        save_averaged_data()

def save_averaged_data():
    """Calculate averages and save to historical data"""
    global temp_readings_buffer, humidity_readings_buffer, buffer_start_time, last_historical_save
    
    if not temp_readings_buffer or not humidity_readings_buffer:
        return False
    
    # Calculate averages
    avg_temp = sum(temp_readings_buffer) / len(temp_readings_buffer)
    avg_humidity = sum(humidity_readings_buffer) / len(humidity_readings_buffer)
    
    # Use the middle time of the 5-minute period for the timestamp
    middle_time = buffer_start_time + timedelta(seconds=HISTORICAL_INTERVAL/2)
    timestamp = middle_time.strftime("%b %d %I:%M %p")
    
    # Add averaged data point
    historical_data["labels"].append(timestamp)
    historical_data["temp"].append(round(avg_temp, 1))
    historical_data["hum"].append(round(avg_humidity, 1))
    
    # Keep only the last MAX_HISTORICAL_POINTS
    if len(historical_data["labels"]) > MAX_HISTORICAL_POINTS:
        historical_data["labels"] = historical_data["labels"][-MAX_HISTORICAL_POINTS:]
        historical_data["temp"] = historical_data["temp"][-MAX_HISTORICAL_POINTS:]
        historical_data["hum"] = historical_data["hum"][-MAX_HISTORICAL_POINTS:]
    
    last_historical_save = datetime.now()
    
    # Save to file
    save_historical_data()
    
    print(f"Added historical point: {timestamp} - Avg Temp: {avg_temp:.1f}°C, Avg Hum: {avg_humidity:.1f}% (from {len(temp_readings_buffer)} readings)")
    
    # Reset buffers for next 5-minute period
    temp_readings_buffer = []
    humidity_readings_buffer = []
    buffer_start_time = None
    
    return True

def clean_old_data():
    """Clean data older than 24 hours"""
    if not historical_data["labels"]:
        return
    
    now = datetime.now()
    cutoff_time = now - timedelta(hours=24)
    
    # Find the first index that should be kept
    keep_from = 0
    for i, label in enumerate(historical_data["labels"]):
        try:
            # Parse the label back to datetime for comparison (updated for 12-hour format)
            # Try both old format (24-hour) and new format (12-hour) for backward compatibility
            try:
                point_time = datetime.strptime(f"{now.year} {label}", "%Y %b %d %I:%M %p")
            except ValueError:
                # Fallback for old 24-hour format data
                point_time = datetime.strptime(f"{now.year} {label}", "%Y %b %d %H:%M")
            
            if point_time >= cutoff_time:
                keep_from = i
                break
        except:
            continue
    
    if keep_from > 0:
        historical_data["labels"] = historical_data["labels"][keep_from:]
        historical_data["temp"] = historical_data["temp"][keep_from:]
        historical_data["hum"] = historical_data["hum"][keep_from:]
        save_historical_data()
        print(f"Cleaned {keep_from} old data points")

# ------------------- Cleanup -------------------
def cleanup(*args):
    print("\nCleaning up GPIO...")
    stop_event.set()
    
    # Save any remaining buffered data before shutdown
    if temp_readings_buffer and humidity_readings_buffer:
        print("Saving remaining buffered data...")
        save_averaged_data()
    
    try:
        buzzer.value = False
        buzzer.deinit()
        print("Buzzer released.")
    except Exception as e:
        print(f"Buzzer cleanup error: {e}")
    try:
        dht_device.exit()
        print("DHT11 released.")
    except Exception as e:
        print(f"DHT cleanup error: {e}")

    sys.exit(0)

atexit.register(cleanup)
signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

# ------------------- Sensor Loop -------------------
def sensor_loop():
    print("Reading DHT11 sensor... (Press CTRL+C to stop)")
    while not stop_event.is_set():
        try:
            temperature = dht_device.temperature
            humidity = dht_device.humidity

            if temperature is not None and humidity is not None:
                now = time.strftime("%Y-%m-%d %I:%M:%S %p")
                sensor_data.update({
                    "temperature": temperature,
                    "humidity": humidity,
                    "time": now,
                    "error": False
                })

                print(f"[{now}] Temp: {temperature}°C, Hum: {humidity}% (Buffer: {len(temp_readings_buffer)} readings)")

                # Add to 5-minute averaging buffer
                add_to_buffer(temperature, humidity)

                if temperature >= 38:
                    buzzer.value = True
                    sensor_data["buzzer"] = "ON"
                    print("Buzzer: ON (High Temperature!)")
                else:
                    buzzer.value = False
                    sensor_data["buzzer"] = "OFF"
                    print("Buzzer: OFF")
            else:
                sensor_data["error"] = True
                print("Failed to retrieve sensor data")

        except RuntimeError as e:
            sensor_data["error"] = True
            print(f"Runtime error: {e}")
        except Exception as e:
            sensor_data["error"] = True
            print(f"Unexpected error: {e}")

        time.sleep(5)  # sensor read every 5 seconds

# ------------------- Data Cleanup Thread -------------------
def cleanup_thread():
    """Thread to clean old data periodically"""
    while not stop_event.is_set():
        time.sleep(3600)  # Run every hour
        if not stop_event.is_set():
            clean_old_data()

# ------------------- Flask -------------------
app = Flask(__name__)

@app.route('/static/<path:filename>')
def serve_static(filename):
    root_dir = os.path.dirname(os.path.abspath(__file__))
    return send_from_directory(os.path.join(root_dir, 'static'), filename)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/sensor", methods=["GET"])
def get_sensor():
    return jsonify(sensor_data)

@app.route("/load_history", methods=["GET"])
def load_history():
    """Load historical data for the frontend"""
    try:
        return jsonify(historical_data)
    except Exception as e:
        print(f"Error loading historical data: {e}")
        return jsonify({"labels": [], "temp": [], "hum": [], "error": str(e)})

@app.route("/clear_history", methods=["POST"])
def clear_history():
    """Clear all historical data"""
    global historical_data, last_historical_save, temp_readings_buffer, humidity_readings_buffer, buffer_start_time
    try:
        historical_data = {"labels": [], "temp": [], "hum": []}
        last_historical_save = None
        
        # Also clear the averaging buffers
        temp_readings_buffer = []
        humidity_readings_buffer = []
        buffer_start_time = None
        
        # Delete the file
        if os.path.exists(HIST_FILE):
            os.remove(HIST_FILE)
        
        print("Historical data cleared")
        return jsonify({"status": "success", "message": "Historical data cleared"})
    except Exception as e:
        print(f"Error clearing historical data: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/history_stats", methods=["GET"])
def history_stats():
    """Get statistics about historical data"""
    try:
        stats = {
            "total_points": len(historical_data["labels"]),
            "oldest_point": historical_data["labels"][0] if historical_data["labels"] else None,
            "newest_point": historical_data["labels"][-1] if historical_data["labels"] else None,
            "last_save": last_historical_save.isoformat() if last_historical_save else None,
            "buffered_readings": len(temp_readings_buffer),
            "buffer_start": buffer_start_time.isoformat() if buffer_start_time else None,
            "next_save_in": None
        }
        
        if buffer_start_time:
            next_save = buffer_start_time + timedelta(seconds=HISTORICAL_INTERVAL)
            remaining = (next_save - datetime.now()).total_seconds()
            stats["next_save_in"] = max(0, int(remaining))
        
        return jsonify(stats)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ------------------- Main -------------------
if __name__ == "__main__":
    # Load existing historical data
    load_historical_data()
    
    # Start sensor thread
    sensor_thread = threading.Thread(target=sensor_loop, daemon=True)
    sensor_thread.start()
    
    # Start cleanup thread
    cleanup_data_thread = threading.Thread(target=cleanup_thread, daemon=True)
    cleanup_data_thread.start()

    try:
        print("Starting Flask server on http://0.0.0.0:5000")
        app.run(host="0.0.0.0", port=5000, debug=False)
    except KeyboardInterrupt:
        print("CTRL+C detected, shutting down...")
        cleanup()