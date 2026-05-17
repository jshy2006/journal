from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
STATE_PATH = DATA_DIR / "diary.json"


DEFAULT_STATE = {
    "version": 1,
    "activeEntryId": "entry-rain",
    "updatedAt": 0,
    "entries": [
        {
            "id": "entry-rain",
            "title": "雨停以后",
            "date": "今天 21:34",
            "mood": "平静",
            "moodClass": "calm",
            "weather": "雨后多云",
            "place": "回家路上",
            "tags": ["日常", "散步", "夜晚"],
            "text": "便利店门口的灯把雨水照得像一层薄玻璃。今天终于没有急着把一天过成清单。",
            "note": "散步，热牛奶，薄荷。",
            "image": "../assets/illustrations/diary-desk.png",
            "updatedAt": 0,
            "syncedAt": 0,
            "locked": False,
        },
        {
            "id": "entry-room",
            "title": "把房间收亮一点",
            "date": "昨天 23:06",
            "mood": "开心",
            "moodClass": "bright",
            "weather": "晴",
            "place": "卧室",
            "tags": ["家", "整理"],
            "text": "换了床单，把书桌左边空出来，心里也像被擦过一遍。",
            "note": "整理书桌和床单。",
            "image": "../assets/illustrations/mobile-writing.png",
            "updatedAt": 0,
            "syncedAt": 0,
            "locked": False,
        },
        {
            "id": "entry-future",
            "title": "给未来的自己",
            "date": "5月15日 22:18",
            "mood": "温暖",
            "moodClass": "warm",
            "weather": "微风",
            "place": "书桌前",
            "tags": ["成长", "给自己"],
            "text": "今天没有特别厉害，但没有逃走。这样也值得被认真记下来。",
            "note": "没有逃走，也值得记录。",
            "image": "../assets/illustrations/secure-sync.png",
            "updatedAt": 0,
            "syncedAt": 0,
            "locked": True,
        },
    ],
}


def read_state():
    if not STATE_PATH.exists():
        return DEFAULT_STATE.copy()

    try:
        with STATE_PATH.open("r", encoding="utf-8") as file:
            state = json.load(file)
    except (OSError, json.JSONDecodeError):
        return DEFAULT_STATE.copy()

    entries = state.get("entries")
    if not isinstance(entries, list):
        state["entries"] = DEFAULT_STATE["entries"]
    state.setdefault("version", 1)
    state.setdefault("activeEntryId", state["entries"][0]["id"] if state["entries"] else "")
    state.setdefault("updatedAt", 0)
    return state


def write_state(state):
    DATA_DIR.mkdir(exist_ok=True)
    temp_path = STATE_PATH.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(state, file, ensure_ascii=False, indent=2)
        file.write("\n")
    os.replace(temp_path, STATE_PATH)


def entry_timestamp(entry):
    try:
        return int(entry.get("updatedAt") or 0)
    except (TypeError, ValueError):
        return 0


def clean_entry(entry):
    entry_id = str(entry.get("id") or "").strip()
    if not entry_id:
        return None

    tags = entry.get("tags") if isinstance(entry.get("tags"), list) else []
    cleaned = {
        "id": entry_id,
        "title": str(entry.get("title") or "新的日记"),
        "date": str(entry.get("date") or ""),
        "mood": str(entry.get("mood") or "平静"),
        "moodClass": str(entry.get("moodClass") or "calm"),
        "weather": str(entry.get("weather") or "未填写"),
        "place": str(entry.get("place") or "未填写"),
        "tags": [str(tag) for tag in tags],
        "text": str(entry.get("text") or ""),
        "note": str(entry.get("note") or ""),
        "image": str(entry.get("image") or "../assets/illustrations/diary-desk.png"),
        "updatedAt": entry_timestamp(entry),
        "syncedAt": entry_timestamp(entry) or 0,
        "locked": bool(entry.get("locked")),
    }
    return cleaned


def merge_state(payload):
    current = read_state()
    current_entries = {
        entry["id"]: entry
        for entry in (clean_entry(item) for item in current.get("entries", []))
        if entry
    }

    ordered_ids = []
    for item in payload.get("entries", []):
        entry = clean_entry(item)
        if not entry:
            continue

        current_entry = current_entries.get(entry["id"])
        if current_entry is None or entry_timestamp(entry) >= entry_timestamp(current_entry):
            current_entries[entry["id"]] = entry
        ordered_ids.append(entry["id"])

    existing_order = [entry.get("id") for entry in current.get("entries", []) if entry.get("id")]
    order = []
    for entry_id in [*ordered_ids, *existing_order]:
        if entry_id in current_entries and entry_id not in order:
            order.append(entry_id)

    entries = [current_entries[entry_id] for entry_id in order]
    active_entry_id = str(payload.get("activeEntryId") or current.get("activeEntryId") or "")
    if entries and active_entry_id not in current_entries:
        active_entry_id = entries[0]["id"]

    state = {
        "version": 1,
        "activeEntryId": active_entry_id,
        "updatedAt": max(entry_timestamp(payload), entry_timestamp(current)) + 1,
        "entries": entries,
    }
    write_state(state)
    return state


class SyncHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urlparse(self.path).path == "/api/state":
            self.send_json(200, read_state())
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/state":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(min(length, 1024 * 1024))
            payload = json.loads(raw.decode("utf-8") or "{}")
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "Invalid JSON"})
            return

        self.send_json(200, merge_state(payload))


def run():
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("0.0.0.0", 5173), SyncHandler)
    print("Serving diary preview on http://0.0.0.0:5173", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    run()
