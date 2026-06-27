#!/usr/bin/env python3
import cgi
import json
import random
import shutil
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DATA = ROOT / "backend" / "people.json"
UPLOADS = ROOT / "backend" / "uploads"


DEFAULT_PEOPLE = [
    {
        "id": "demo-alex",
        "name": "Alex Chen",
        "company": "Northstar Labs",
        "title": "Product Lead",
        "note": "Ask about pilot budget and procurement timing.",
    },
    {
        "id": "demo-maya",
        "name": "Maya Patel",
        "company": "Orbit Health",
        "title": "Head of Ops",
        "note": "Prefers concise updates and clear next actions.",
    },
]


def ensure_data():
    UPLOADS.mkdir(parents=True, exist_ok=True)
    if not DATA.exists():
        DATA.write_text(json.dumps(DEFAULT_PEOPLE, indent=2), encoding="utf-8")


def read_people():
    ensure_data()
    return json.loads(DATA.read_text(encoding="utf-8"))


def write_people(people):
    DATA.write_text(json.dumps(people, indent=2), encoding="utf-8")


def json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class AppHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = urlparse(path)
        clean_path = parsed.path
        if clean_path == "/":
            clean_path = "/index.html"
        return str(FRONTEND / clean_path.lstrip("/"))

    def do_GET(self):
        if self.path == "/api/people":
            json_response(self, 200, {"people": read_people()})
            return
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/people":
            self.create_person()
            return
        if self.path == "/recognize":
            self.recognize()
            return
        json_response(self, 404, {"error": "Not found"})

    def create_person(self):
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        person = {
            "id": payload.get("id") or f"person-{uuid.uuid4().hex[:8]}",
            "name": payload.get("name", "").strip(),
            "company": payload.get("company", "").strip(),
            "title": payload.get("title", "").strip(),
            "note": payload.get("note", "").strip(),
        }
        if not person["name"]:
            json_response(self, 400, {"error": "name is required"})
            return
        people = read_people()
        people.append(person)
        write_people(people)
        json_response(self, 201, {"person": person})

    def recognize(self):
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type"),
            },
        )
        people = read_people()
        selected_id = form.getfirst("person_id", "")
        selected = next((p for p in people if p["id"] == selected_id), None)
        if selected is None and people:
            selected = random.choice(people)

        image_item = form["image"] if "image" in form else None
        upload_path = None
        if image_item is not None and getattr(image_item, "filename", ""):
            suffix = Path(image_item.filename).suffix or ".jpg"
            upload_path = UPLOADS / f"{uuid.uuid4().hex}{suffix}"
            with upload_path.open("wb") as target:
                shutil.copyfileobj(image_item.file, target)

        if selected is None:
            json_response(
                self,
                200,
                {
                    "matched": False,
                    "confidence": 0,
                    "person": None,
                    "image_saved": str(upload_path) if upload_path else None,
                },
            )
            return

        json_response(
            self,
            200,
            {
                "matched": True,
                "confidence": round(random.uniform(0.78, 0.94), 2),
                "person": selected,
                "image_saved": str(upload_path) if upload_path else None,
            },
        )


if __name__ == "__main__":
    ensure_data()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), AppHandler)
    print("Who's That running at http://127.0.0.1:8000")
    server.serve_forever()
