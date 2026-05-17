import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
STATE_PATH = DATA_DIR / "diary.json"


DEFAULT_STATE = {
    "version": 1,
    "activeEntryId": "",
    "updatedAt": 0,
    "entries": [],
    "deletedEntryIds": ["entry-rain", "entry-room", "entry-future"],
}


def read_state():
    if not STATE_PATH.exists():
        return json.loads(json.dumps(DEFAULT_STATE))

    try:
        with STATE_PATH.open("r", encoding="utf-8") as file:
            state = json.load(file)
    except (OSError, json.JSONDecodeError):
        return json.loads(json.dumps(DEFAULT_STATE))

    entries = state.get("entries")
    if not isinstance(entries, list):
        state["entries"] = []
    if not isinstance(state.get("deletedEntryIds"), list):
        state["deletedEntryIds"] = list(DEFAULT_STATE["deletedEntryIds"])
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


def clean_attachment(item):
    if not isinstance(item, dict):
        return None
    name = str(item.get("name") or "").strip()
    data_url = str(item.get("dataUrl") or "").strip()
    if not name and not data_url:
        return None
    return {
        "name": name or "未命名文件",
        "type": str(item.get("type") or ""),
        "dataUrl": data_url,
        "uploadedAt": entry_timestamp(item),
    }


def clean_attachment_list(value):
    if not isinstance(value, list):
        return []
    return [
        attachment
        for attachment in (clean_attachment(item) for item in value)
        if attachment
    ]


def clean_entry(entry):
    if not isinstance(entry, dict):
        return None

    entry_id = str(entry.get("id") or "").strip()
    if not entry_id:
        return None

    tags = entry.get("tags") if isinstance(entry.get("tags"), list) else []
    images = clean_attachment_list(entry.get("images"))
    voice = clean_attachment(entry.get("voice"))
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
        "image": str(entry.get("image") or ""),
        "images": images,
        "voice": voice,
        "updatedAt": entry_timestamp(entry),
        "syncedAt": entry_timestamp(entry) or 0,
        "locked": bool(entry.get("locked")),
    }
    return cleaned


def deleted_ids(state):
    raw_ids = state.get("deletedEntryIds") if isinstance(state, dict) else []
    if not isinstance(raw_ids, list):
        return set()
    return {str(entry_id).strip() for entry_id in raw_ids if str(entry_id).strip()}


def merge_state(payload):
    current = read_state()
    removed_ids = deleted_ids(current) | deleted_ids(payload)
    current_entries = {
        entry["id"]: entry
        for entry in (clean_entry(item) for item in current.get("entries", []))
        if entry and entry["id"] not in removed_ids
    }

    ordered_ids = []
    for item in payload.get("entries", []):
        entry = clean_entry(item)
        if not entry or entry["id"] in removed_ids:
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
    if not entries:
        active_entry_id = ""

    state = {
        "version": 1,
        "activeEntryId": active_entry_id,
        "updatedAt": max(entry_timestamp(payload), entry_timestamp(current)) + 1,
        "entries": entries,
        "deletedEntryIds": sorted(removed_ids),
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
