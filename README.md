# Who's That

Local Web MVP for a meeting-assistant glasses flow, backed by a FastAPI recognition service.

1. Add known meeting attendees.
2. Upload a test meeting photo.
3. Capture a frame from the computer camera.
4. Compare it against enrolled reference face photos through InsightFace / ArcFace embeddings.
5. Show the result in a glasses-style HUD.

The backend uses InsightFace's `buffalo_l` model package, which provides ArcFace-style 512D face embeddings for matching enrolled attendees.

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python backend/app.py
```

Open:

```text
http://127.0.0.1:8000
```

## API Shape

`POST /recognize`

Multipart form fields:

- `image`: uploaded image file

The current frontend sends captured images to `/recognize`; the browser no longer performs identity matching.

Response:

```json
{
  "matched": true,
  "confidence": 0.91,
  "score": 0.91,
  "threshold": 0.35,
  "person": {
    "id": "demo-alex",
    "name": "Alex Chen",
    "company": "Northstar Labs",
    "title": "Product Lead",
    "note": "Ask about pilot budget and procurement timing."
  },
  "hud": {
    "line1": "Alex Chen",
    "line2": "Product Lead / Northstar Labs",
    "line3": "Ask about pilot budget and procurement timing."
  }
}
```
