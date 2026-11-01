from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import os
import time
import threading
from urllib.parse import urlparse, parse_qs

PORT = 8080
DATA_FILE = os.path.join(os.path.dirname(__file__), "visitor_stats.json")
FEEDBACK_FILE = os.path.join(os.path.dirname(__file__), "feedbacks.json")
BASE_COUNT = 1

stats_lock = threading.Lock()
feedback_lock = threading.Lock()
active_sessions = {}
SESSION_TIMEOUT = 30  # seconds

INITIAL_SAMPLE_FEEDBACKS = [
    {
        "id": "fb-101",
        "name": "Aaditya Patil",
        "role": "PCCOE Akurdi Student (CSE)",
        "rating": 5,
        "category": "Generic Medicine Pricing",
        "message": "The Jan Aushadhi generic salt price comparison saved me over ₹200 on fever & cold medicines! Very helpful for hostel students staying around Akurdi.",
        "date": "28 Oct 2026, 14:20",
        "timestamp": 1793177400000
    },
    {
        "id": "fb-102",
        "name": "Dr. Smita Deshmukh",
        "role": "Local Practitioner, Nigdi",
        "rating": 5,
        "category": "Real-Time Distance & Wishlist",
        "message": "The real-time walking and driving distance calculation from PCCOE campus to midnight 24x7 pharmacies is remarkably accurate.",
        "date": "29 Oct 2026, 09:15",
        "timestamp": 1793245500000
    },
    {
        "id": "fb-103",
        "name": "Neha Kulkarni",
        "role": "PCCOE Student",
        "rating": 5,
        "category": "Real-Time Distance & Wishlist",
        "message": "I love the green Wishlist feature! I can save all my regular medical shops near college and see walking time before stepping out.",
        "date": "29 Oct 2026, 17:40",
        "timestamp": 1793275800000
    }
]

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
    with stats_lock:
        now = time.time()
        expired = [sid for sid, last_seen in list(active_sessions.items()) if now - last_seen > SESSION_TIMEOUT]
        for sid in expired:
            active_sessions.pop(sid, None)
        return max(1, len(active_sessions))

def get_feedbacks():
    with feedback_lock:
        if os.path.exists(FEEDBACK_FILE):
            try:
                with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        return data
            except Exception as e:
                print(f"Error reading feedbacks.json: {e}")
        # Initialize default feedbacks if file not found or empty
        try:
            with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
                json.dump(INITIAL_SAMPLE_FEEDBACKS, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error initializing feedbacks.json: {e}")
        return list(INITIAL_SAMPLE_FEEDBACKS)

def save_feedbacks(feedbacks):
    with feedback_lock:
        try:
            with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
                json.dump(feedbacks, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"Error saving feedbacks.json: {e}")
            return False

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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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
                sid = query.get("sid", [None])[0]
                if not sid:
                    sid = f"mf_{int(time.time() * 1000)}"
                with stats_lock:
                    active_sessions[sid] = time.time()
                
                stats = get_stats()
                stats["totalVisitors"] = stats.get("totalVisitors", BASE_COUNT) + 1
                stats["lastUpdated"] = time.time()
                save_stats(stats)

                active_count = get_active_count()
                print(f"[VISITOR OPEN] Total: {stats['totalVisitors']} | Active Now: {active_count} (Session: {sid[-8:]})")
                payload = {
                    "success": True,
                    "totalVisitors": stats["totalVisitors"],
                    "activeNow": active_count,
                    "opened": True
                }
                self.send_json(payload)
                return

            # 2. API: Periodic Real-Time Poll & Heartbeat
            if path == "/api/visitor-count" or path == "/api/visitor-count/poll":
                sid = query.get("sid", [None])[0]
                if sid:
                    with stats_lock:
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

            # 2B. API: User closed tab or navigated away
            if path == "/api/visitor-count/leave":
                sid = query.get("sid", [None])[0]
                if sid:
                    with stats_lock:
                        active_sessions.pop(sid, None)
                active_count = get_active_count()
                print(f"[VISITOR LEAVE] Active Now: {active_count}")
                self.send_json({
                    "success": True,
                    "activeNow": active_count
                })
                return

            # 3. API: Feedback List (Get all submitted feedbacks)
            if path == "/api/feedbacks" or path == "/api/feedback":
                feedbacks = get_feedbacks()
                payload = {
                    "success": True,
                    "feedbacks": feedbacks,
                    "total": len(feedbacks)
                }
                self.send_json(payload)
                return

            # Serve static files
            super().do_GET()
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            pass

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path

            # API: Visitor leaving tab
            if path == "/api/visitor-count/leave":
                query = parse_qs(parsed.query)
                sid = query.get("sid", [None])[0]
                if not sid:
                    try:
                        content_length = int(self.headers.get("Content-Length", 0))
                        if content_length > 0:
                            body_bytes = self.rfile.read(content_length)
                            data = json.loads(body_bytes.decode("utf-8"))
                            sid = data.get("sid")
                    except Exception:
                        pass
                if sid:
                    with stats_lock:
                        active_sessions.pop(sid, None)
                active_count = get_active_count()
                print(f"[VISITOR BEACON LEAVE] Active Now: {active_count}")
                self.send_json({"success": True, "activeNow": active_count})
                return

            # API: Submit New Feedback
            if path == "/api/feedbacks" or path == "/api/feedback":
                content_length = int(self.headers.get("Content-Length", 0))
                body_bytes = self.rfile.read(content_length)
                try:
                    data = json.loads(body_bytes.decode("utf-8"))
                except Exception:
                    data = {}

                name = str(data.get("name", "Anonymous")).strip() or "Anonymous"
                role = str(data.get("role", "User")).strip() or "User"
                category = str(data.get("category", "General Experience")).strip() or "General Experience"
                message = str(data.get("message", "")).strip()
                try:
                    rating = int(data.get("rating", 5))
                except Exception:
                    rating = 5
                rating = max(1, min(5, rating))

                if not message:
                    self.send_json({"success": False, "error": "Message is required"}, status=400)
                    return

                now = time.localtime()
                months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
                default_date = f"{now.tm_mday} {months[now.tm_mon - 1]} {now.tm_year}, {now.tm_hour:02d}:{now.tm_min:02d}"
                date_str = str(data.get("date") or default_date)

                new_feedback = {
                    "id": str(data.get("id") or f"fb-{int(time.time() * 1000)}"),
                    "name": name,
                    "role": role,
                    "rating": rating,
                    "category": category,
                    "message": message,
                    "date": date_str,
                    "timestamp": int(time.time() * 1000)
                }

                feedbacks = get_feedbacks()
                # If feedback with identical id exists, update it; otherwise prepend newest
                existing_idx = next((i for i, fb in enumerate(feedbacks) if fb.get("id") == new_feedback["id"]), None)
                if existing_idx is not None:
                    feedbacks[existing_idx] = new_feedback
                else:
                    feedbacks.insert(0, new_feedback)

                save_feedbacks(feedbacks)
                try:
                    clean_msg = message[:40].encode('ascii', errors='replace').decode('ascii')
                    clean_name = name.encode('ascii', errors='replace').decode('ascii')
                    print(f"[FEEDBACK RECEIVED] {clean_name} ({rating} stars) - {clean_msg}")
                except Exception:
                    pass

                self.send_json({
                    "success": True,
                    "feedback": new_feedback,
                    "feedbacks": feedbacks,
                    "total": len(feedbacks)
                })
                return

            self.send_response(404)
            self.end_headers()
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            pass
        except Exception as e:
            print(f"Error handling POST {self.path}: {e}")
            self.send_response(500)
            self.end_headers()

    def do_DELETE(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            query = parse_qs(parsed.query)

            # API: Delete Feedback
            if path == "/api/feedbacks" or path == "/api/feedback":
                fb_id = query.get("id", [None])[0]
                clear_all = query.get("clear", ["false"])[0].lower() in ["true", "1", "all"]

                if clear_all:
                    save_feedbacks([])
                    print("[FEEDBACK CLEARED] All feedback submissions cleared.")
                    self.send_json({"success": True, "feedbacks": [], "total": 0})
                    return

                if fb_id:
                    feedbacks = get_feedbacks()
                    feedbacks = [f for f in feedbacks if f.get("id") != fb_id]
                    save_feedbacks(feedbacks)
                    print(f"[FEEDBACK DELETED] Feedback ID {fb_id} deleted.")
                    self.send_json({"success": True, "feedbacks": feedbacks, "total": len(feedbacks)})
                    return

                self.send_response(400)
                self.end_headers()
                return

            self.send_response(404)
            self.end_headers()
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            pass
        except Exception as e:
            print(f"Error handling DELETE {self.path}: {e}")
            self.send_response(500)
            self.end_headers()

    def send_json(self, data, status=200):
        try:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            pass

def run_server():
    server_address = ("0.0.0.0", PORT)
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer(server_address, MedNexaHandler)
    # Ensure feedbacks.json exists on startup
    get_feedbacks()
    print(f"MedNexa Threaded Server running on http://0.0.0.0:{PORT}")
    httpd.serve_forever()

if __name__ == "__main__":
    run_server()
