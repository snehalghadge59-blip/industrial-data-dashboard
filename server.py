from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import os
import time
import threading
from urllib.parse import urlparse, parse_qs

PORT = 8080
DATA_FILE = os.path.join(os.path.dirname(__file__), "visitor_stats.json")
BASE_COUNT = 1

stats_lock = threading.Lock()
active_sessions = {}
SESSION_TIMEOUT = 45  # seconds

def get_stats():
    with stats_lock:
        if os.path.exists(DATA_FILE):
            try:
                with open(DATA_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if "totalVisitors" in data and isinstance(data["totalVisitors"], int):
                        return data
            except Exception:
                pass
        initial_data = {
            "totalVisitors": BASE_COUNT,
            "lastUpdated": time.time()
        }
        try:
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(initial_data, f, indent=2)
        except Exception:
            pass
        return initial_data

def save_stats(data):
    with stats_lock:
        try:
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Error saving stats: {e}")

def get_active_count():
    now = time.time()
    expired = [sid for sid, last_seen in list(active_sessions.items()) if now - last_seen > SESSION_TIMEOUT]
    for sid in expired:
        active_sessions.pop(sid, None)
    return max(1, len(active_sessions))

class MedNexaHandler(SimpleHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError, ConnectionError):
            pass
        except Exception as e:
            print(f"Non-fatal client error: {e}")

    def end_headers(self):
        # Allow cross-origin and prevent tunnel blockers
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Bypass-Tunnel-Reminder", "true")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            query = parse_qs(parsed.query)

            # 1. API: New Person Opened Website
            if path == "/api/visitor-count/open" or path == "/api/visitor-count/increment":
                sid = query.get("sid", [f"s_{time.time()}"])[0]
                active_sessions[sid] = time.time()
                
                stats = get_stats()
                stats["totalVisitors"] = stats.get("totalVisitors", BASE_COUNT) + 1
                stats["lastUpdated"] = time.time()
                save_stats(stats)

                payload = {
                    "success": True,
                    "totalVisitors": stats["totalVisitors"],
                    "activeNow": get_active_count(),
                    "opened": True
                }
                self.send_json(payload)
                return

            # 2. API: Periodic Real-Time Poll & Heartbeat
            if path == "/api/visitor-count" or path == "/api/visitor-count/poll":
                sid = query.get("sid", [None])[0]
                if sid:
                    active_sessions[sid] = time.time()

                stats = get_stats()
                payload = {
                    "success": True,
                    "totalVisitors": stats.get("totalVisitors", BASE_COUNT),
                    "activeNow": get_active_count(),
                    "serverTime": int(time.time() * 1000)
                }
                self.send_json(payload)
                return

            # Serve static files
            super().do_GET()
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            pass

    def send_json(self, data):
        try:
            body = json.dumps(data).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            pass

def run_server():
    server_address = ("0.0.0.0", PORT)
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer(server_address, MedNexaHandler)
    print(f"MedNexa Threaded Server running on http://0.0.0.0:{PORT}")
    httpd.serve_forever()

if __name__ == "__main__":
    run_server()
