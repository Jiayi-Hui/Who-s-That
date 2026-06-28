#!/usr/bin/env python3
import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"
DATA_DIR = BACKEND / "data"
PEOPLE_PATH = BACKEND / "people.json"
EMBEDDINGS_DIR = DATA_DIR / "embeddings"
FACE_PHOTOS_DIR = DATA_DIR / "face_photos"
UPLOADS_DIR = BACKEND / "uploads"

ARCFACE_THRESHOLD = 0.35


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


class PersonCreate(BaseModel):
    name: str
    company: str = ""
    title: str = ""
    note: str = ""


def ensure_data():
    EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)
    FACE_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    if not PEOPLE_PATH.exists():
        PEOPLE_PATH.write_text(json.dumps(DEFAULT_PEOPLE, indent=2), encoding="utf-8")


def read_people():
    ensure_data()
    return json.loads(PEOPLE_PATH.read_text(encoding="utf-8"))


def write_people(people):
    PEOPLE_PATH.write_text(json.dumps(people, indent=2), encoding="utf-8")


def embedding_path(person_id: str):
    return EMBEDDINGS_DIR / f"{person_id}.npy"


def face_sample_count(person_id: str):
    path = embedding_path(person_id)
    if not path.exists():
        return 0
    try:
        import numpy as np

        embeddings = np.load(path)
        return int(embeddings.shape[0])
    except Exception:
        return 0


def serialize_person(person):
    return {
        **person,
        "face_sample_count": face_sample_count(person["id"]),
    }


class ArcFaceRecognizer:
    def __init__(self):
        self._model = None
        self._load_error: Optional[str] = None

    def available(self):
        return self._load_error is None and self._model is not None

    def load(self):
        if self._model is not None or self._load_error is not None:
            return
        try:
            from insightface.app import FaceAnalysis

            model = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
            model.prepare(ctx_id=-1, det_size=(640, 640))
            self._model = model
        except Exception as exc:
            self._load_error = str(exc)

    def status(self):
        self.load()
        return {
            "name": "InsightFace buffalo_l",
            "embedding": "ArcFace-style 512D face embedding",
            "threshold": ARCFACE_THRESHOLD,
            "available": self.available(),
            "error": self._load_error,
        }

    def embedding_from_bytes(self, image_bytes: bytes):
        self.load()
        if not self.available():
            raise HTTPException(
                status_code=503,
                detail=f"ArcFace recognizer is not available: {self._load_error}",
            )

        import cv2
        import numpy as np

        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if image is None:
            raise HTTPException(status_code=400, detail="Could not decode image")

        faces = self._model.get(image)
        if not faces:
            raise HTTPException(status_code=422, detail="No face detected")

        face = max(
            faces,
            key=lambda item: (item.bbox[2] - item.bbox[0]) * (item.bbox[3] - item.bbox[1]),
        )
        embedding = face.normed_embedding
        if embedding is None:
            embedding = face.embedding / np.linalg.norm(face.embedding)
        return embedding.astype("float32")


recognizer = ArcFaceRecognizer()
app = FastAPI(title="Who's That API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "recognizer": recognizer.status(),
    }


@app.get("/api/people")
def list_people():
    return {"people": [serialize_person(person) for person in read_people()]}


@app.post("/api/people")
def create_person(payload: PersonCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    person = {
        "id": f"person-{uuid.uuid4().hex[:8]}",
        "name": name,
        "company": payload.company.strip(),
        "title": payload.title.strip(),
        "note": payload.note.strip(),
    }
    people = read_people()
    people.append(person)
    write_people(people)
    return {"person": serialize_person(person)}


@app.post("/api/people/{person_id}/faces")
async def add_faces(person_id: str, files: list[UploadFile] = File(...)):
    people = read_people()
    person = next((item for item in people if item["id"] == person_id), None)
    if person is None:
        raise HTTPException(status_code=404, detail="person not found")

    import numpy as np

    person_photo_dir = FACE_PHOTOS_DIR / person_id
    person_photo_dir.mkdir(parents=True, exist_ok=True)

    accepted = []
    rejected = []
    for upload in files:
        image_bytes = await upload.read()
        try:
            embedding = recognizer.embedding_from_bytes(image_bytes)
        except HTTPException as exc:
            rejected.append({"filename": upload.filename, "reason": exc.detail})
            continue

        suffix = Path(upload.filename or "face.jpg").suffix or ".jpg"
        photo_path = person_photo_dir / f"{uuid.uuid4().hex}{suffix}"
        photo_path.write_bytes(image_bytes)
        accepted.append({"filename": upload.filename, "saved_to": str(photo_path)})

        path = embedding_path(person_id)
        if path.exists():
            embeddings = np.load(path)
            embeddings = np.vstack([embeddings, embedding])
        else:
            embeddings = np.expand_dims(embedding, axis=0)
        np.save(path, embeddings.astype("float32"))

    return {
        "person": serialize_person(person),
        "accepted": accepted,
        "rejected": rejected,
    }


@app.post("/recognize")
async def recognize(image: UploadFile = File(...)):
    import numpy as np

    image_bytes = await image.read()
    upload_path = UPLOADS_DIR / f"{uuid.uuid4().hex}{Path(image.filename or 'frame.jpg').suffix or '.jpg'}"
    upload_path.write_bytes(image_bytes)

    try:
        query = recognizer.embedding_from_bytes(image_bytes)
    except HTTPException as exc:
        return unmatched(exc.detail, image_saved=str(upload_path))

    best = {"score": -1.0, "person": None}
    for person in read_people():
        path = embedding_path(person["id"])
        if not path.exists():
            continue
        embeddings = np.load(path)
        scores = embeddings @ query
        score = float(np.max(scores))
        if score > best["score"]:
            best = {"score": score, "person": person}

    if best["person"] is None:
        return unmatched("No enrolled face samples yet.", image_saved=str(upload_path))

    if best["score"] < ARCFACE_THRESHOLD:
        return unmatched(
            f"Closest match was {best['person']['name']}, but ArcFace cosine score "
            f"{best['score']:.3f} is below threshold {ARCFACE_THRESHOLD}.",
            confidence=max(0.0, best["score"]),
            image_saved=str(upload_path),
        )

    person = serialize_person(best["person"])
    confidence = min(0.99, max(0.01, best["score"]))
    return {
        "matched": True,
        "person": person,
        "confidence": confidence,
        "score": best["score"],
        "threshold": ARCFACE_THRESHOLD,
        "model": recognizer.status(),
        "image_saved": str(upload_path),
        "hud": hud_for(person),
    }


def unmatched(reason: str, confidence: float = 0.0, image_saved: Optional[str] = None):
    return {
        "matched": False,
        "person": None,
        "confidence": confidence,
        "reason": reason,
        "threshold": ARCFACE_THRESHOLD,
        "model": recognizer.status(),
        "image_saved": image_saved,
        "hud": {
            "line1": "未确认",
            "line2": "No confident match",
            "line3": reason,
        },
    }


def hud_for(person):
    return {
        "line1": person["name"],
        "line2": " / ".join(part for part in [person.get("title"), person.get("company")] if part)
        or "Known attendee",
        "line3": person.get("note") or "No context note yet.",
    }


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND), name="frontend")


if __name__ == "__main__":
    import uvicorn

    ensure_data()
    print("Who's That running at http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
