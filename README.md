# Meeting Face HUD MVP

Local Web MVP for a meeting-assistant glasses flow:

1. Add known meeting attendees.
2. Upload a test meeting photo.
3. Capture a frame from the computer camera.
4. Compare it against enrolled reference face photos in the browser.
5. Show the result in a glasses-style HUD.

The browser demo uses `@vladmandic/face-api` for local face matching. The backend `/recognize` endpoint is still present as a mock/stub so it can later be replaced by a production recognition service.

## Run

```bash
python3 backend/app.py
```

Open:

```text
http://127.0.0.1:8000
```

## API Shape

`POST /recognize`

Multipart form fields:

- `image`: uploaded image file
- `person_id`: optional selected person id for mock recognition

The current frontend tries browser-side face recognition first. If no enrolled face samples are available, `/recognize` remains available as a mock API shape for the future backend.

Response:

```json
{
  "matched": true,
  "confidence": 0.87,
  "person": {
    "id": "demo-alex",
    "name": "Alex Chen",
    "company": "Northstar Labs",
    "title": "Product Lead",
    "note": "Ask about pilot budget and procurement timing."
  }
}
```
