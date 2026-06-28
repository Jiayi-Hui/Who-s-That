const state = {
  people: [],
  selectedFile: null,
  cameraStream: null,
  capturedBlob: null,
};

const els = {
  apiStatus: document.querySelector("#apiStatus"),
  personForm: document.querySelector("#personForm"),
  peopleList: document.querySelector("#peopleList"),
  peopleCount: document.querySelector("#peopleCount"),
  startCameraButton: document.querySelector("#startCameraButton"),
  captureButton: document.querySelector("#captureButton"),
  cameraPreview: document.querySelector("#cameraPreview"),
  photoInput: document.querySelector("#photoInput"),
  photoPreview: document.querySelector("#photoPreview"),
  emptyPreview: document.querySelector("#emptyPreview"),
  recognizeButton: document.querySelector("#recognizeButton"),
  resultBox: document.querySelector("#resultBox"),
  hudName: document.querySelector("#hudName"),
  hudTitle: document.querySelector("#hudTitle"),
  hudNote: document.querySelector("#hudNote"),
  hudConfidence: document.querySelector("#hudConfidence"),
};

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || body.error || `Request failed: ${response.status}`);
  }
  return body;
}

async function loadPeople() {
  try {
    const health = await api("/health");
    const model = health.recognizer;
    els.apiStatus.textContent = model.available ? "ArcFace ready" : "ArcFace setup needed";
    els.apiStatus.classList.toggle("online", model.available);
    els.resultBox.textContent = model.available
      ? `Backend ready: ${model.name} (${model.embedding}).`
      : `Backend running, but ArcFace is unavailable: ${model.error || "missing dependencies"}`;

    const data = await api("/api/people");
    state.people = data.people;
  } catch (error) {
    els.apiStatus.textContent = "API offline";
    els.resultBox.textContent = error.message;
  }
  renderPeople();
}

function renderPeople() {
  els.peopleCount.textContent = state.people.length;
  els.peopleList.innerHTML = "";

  if (state.people.length === 0) {
    els.peopleList.innerHTML = `<div class="empty-list">Add a person to start.</div>`;
    return;
  }

  for (const person of state.people) {
    const count = person.face_sample_count || 0;
    const item = document.createElement("div");
    item.className = "person-item";
    item.innerHTML = `
      <strong>${escapeHtml(person.name)}</strong>
      <span>${escapeHtml(joinParts([person.title, person.company]))}</span>
      <small>${escapeHtml(person.note || "No note yet")}</small>
      <em>${count} ArcFace sample${count === 1 ? "" : "s"}</em>
      <label class="sample-upload">
        Add face photos
        <input type="file" accept="image/*" multiple data-person-id="${escapeHtml(person.id)}">
      </label>
    `;
    item.querySelector("input").addEventListener("click", (event) => event.stopPropagation());
    item.querySelector("input").addEventListener("change", async (event) => {
      event.stopPropagation();
      const files = Array.from(event.target.files || []);
      if (files.length > 0) {
        await enrollReferencePhotos(person.id, files);
        event.target.value = "";
      }
    });
    els.peopleList.appendChild(item);
  }
}

async function addPerson(event) {
  event.preventDefault();
  const form = new FormData(els.personForm);
  const referencePhotos = form.getAll("referencePhotos").filter((file) => file.size > 0);
  const person = {
    name: form.get("name"),
    company: form.get("company"),
    title: form.get("title"),
    note: form.get("note"),
  };

  try {
    const data = await api("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(person),
    });
    state.people.push(data.person);
    renderPeople();

    if (referencePhotos.length > 0) {
      els.resultBox.textContent = `Creating ${data.person.name} and enrolling ArcFace samples...`;
      await enrollReferencePhotos(data.person.id, referencePhotos);
    } else {
      els.resultBox.textContent = `Created ${data.person.name}. Add face photos before recognition.`;
    }
    els.personForm.reset();
  } catch (error) {
    els.resultBox.textContent = error.message;
  }
}

async function enrollReferencePhotos(personId, files) {
  const body = new FormData();
  for (const file of files) {
    body.append("files", file, file.name);
  }

  try {
    els.resultBox.textContent = `Sending ${files.length} reference photo${files.length === 1 ? "" : "s"} to ArcFace backend...`;
    const result = await api(`/api/people/${personId}/faces`, {
      method: "POST",
      body,
    });
    const index = state.people.findIndex((person) => person.id === personId);
    if (index >= 0) state.people[index] = result.person;
    renderPeople();

    const rejected = result.rejected?.length || 0;
    els.resultBox.innerHTML = `
      <strong>Saved ${result.accepted.length} ArcFace sample${result.accepted.length === 1 ? "" : "s"}</strong>
      <span>${rejected} rejected.</span>
      ${renderRejected(result.rejected || [])}
    `;
  } catch (error) {
    els.resultBox.textContent = error.message;
  }
}

function handlePhotoChange(event) {
  const file = event.target.files[0];
  state.selectedFile = file || null;
  state.capturedBlob = null;
  els.recognizeButton.disabled = !file;

  if (!file) {
    els.photoPreview.removeAttribute("src");
    els.photoPreview.classList.remove("active");
    els.emptyPreview.hidden = false;
    return;
  }

  els.photoPreview.src = URL.createObjectURL(file);
  els.photoPreview.classList.add("active");
  els.cameraPreview.classList.remove("active");
  els.emptyPreview.hidden = true;
}

async function startCamera() {
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    els.cameraPreview.srcObject = state.cameraStream;
    els.cameraPreview.classList.add("active");
    els.photoPreview.classList.remove("active");
    els.emptyPreview.hidden = true;
    els.captureButton.disabled = false;
    els.startCameraButton.textContent = "Camera On";
  } catch (error) {
    els.resultBox.textContent = "Camera permission failed. You can still upload a test photo.";
  }
}

async function captureFrame() {
  if (!state.cameraStream || !els.cameraPreview.videoWidth) return;

  const canvas = document.createElement("canvas");
  canvas.width = els.cameraPreview.videoWidth;
  canvas.height = els.cameraPreview.videoHeight;
  const context = canvas.getContext("2d");
  context.drawImage(els.cameraPreview, 0, 0, canvas.width, canvas.height);

  state.capturedBlob = await new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.92);
  });
  state.selectedFile = null;
  els.photoInput.value = "";
  els.photoPreview.src = URL.createObjectURL(state.capturedBlob);
  els.photoPreview.classList.add("active");
  els.cameraPreview.classList.remove("active");
  els.recognizeButton.disabled = false;
  els.emptyPreview.hidden = true;
  els.resultBox.textContent = "Captured one camera frame. Send it to ArcFace recognition.";
}

async function recognize() {
  const image = state.capturedBlob || state.selectedFile;
  if (!image) return;

  els.recognizeButton.disabled = true;
  els.recognizeButton.textContent = "Recognizing";
  els.resultBox.textContent = "Sending image to /recognize...";

  const body = new FormData();
  body.append("image", image, state.capturedBlob ? "camera-frame.jpg" : state.selectedFile.name);

  try {
    const result = await api("/recognize", {
      method: "POST",
      body,
    });
    showResult(result);
    showHud(result);
  } catch (error) {
    showResult({
      matched: false,
      reason: error.message,
      confidence: 0,
      person: null,
    });
    showHud({
      matched: false,
      reason: error.message,
      confidence: 0,
      person: null,
    });
  } finally {
    els.recognizeButton.disabled = false;
    els.recognizeButton.textContent = "Recognize Captured Face";
  }
}

function showResult(result) {
  if (!result.matched || !result.person) {
    els.resultBox.innerHTML = `
      <strong>未确认</strong>
      <span>${escapeHtml(result.reason || "No confident match.")}</span>
      ${result.confidence == null ? "" : `<span>Score: ${Number(result.confidence).toFixed(3)}</span>`}
      ${result.threshold == null ? "" : `<span>Threshold: ${Number(result.threshold).toFixed(3)}</span>`}
    `;
    return;
  }

  const person = result.person;
  els.resultBox.innerHTML = `
    <strong>Recognized: ${escapeHtml(person.name)}</strong>
    <span>${escapeHtml(joinParts([person.title, person.company]))}</span>
    <span>${escapeHtml(person.note || "No note")}</span>
    <span>ArcFace score: ${Number(result.score || result.confidence).toFixed(3)}</span>
    <span>Threshold: ${Number(result.threshold).toFixed(3)}</span>
  `;
}

function showHud(result) {
  const hud = result.hud || {};
  if (!result.matched || !result.person) {
    els.hudName.textContent = hud.line1 || "未确认";
    els.hudTitle.textContent = hud.line2 || "No confident match";
    els.hudNote.textContent = hud.line3 || result.reason || "Try another angle or better lighting.";
    els.hudConfidence.textContent = "--";
    return;
  }

  els.hudName.textContent = hud.line1 || result.person.name;
  els.hudTitle.textContent = hud.line2 || joinParts([result.person.title, result.person.company]) || "Known attendee";
  els.hudNote.textContent = hud.line3 || result.person.note || "No context note yet.";
  els.hudConfidence.textContent = `${Math.round(result.confidence * 100)}%`;
}

function renderRejected(rejected) {
  if (!rejected.length) return "";
  return rejected
    .map((item) => `<span>${escapeHtml(item.filename || "photo")}: ${escapeHtml(item.reason)}</span>`)
    .join("");
}

function joinParts(parts) {
  return parts.filter(Boolean).join(" / ");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

els.personForm.addEventListener("submit", addPerson);
els.startCameraButton.addEventListener("click", startCamera);
els.captureButton.addEventListener("click", captureFrame);
els.photoInput.addEventListener("change", handlePhotoChange);
els.recognizeButton.addEventListener("click", recognize);

loadPeople();

