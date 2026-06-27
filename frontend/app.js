const state = {
  people: [],
  selectedFile: null,
  cameraStream: null,
  capturedBlob: null,
  faceReady: false,
  descriptors: {},
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
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function loadPeople() {
  try {
    const data = await api("/api/people");
    state.people = data.people;
    els.apiStatus.textContent = "Local API ready";
    els.apiStatus.classList.add("online");
  } catch (error) {
    state.people = JSON.parse(localStorage.getItem("people") || "[]");
    els.apiStatus.textContent = "Static fallback";
  }
  loadStoredDescriptors();
  renderPeople();
  loadFaceModels();
}

function renderPeople() {
  els.peopleCount.textContent = state.people.length;
  els.peopleList.innerHTML = "";

  if (state.people.length === 0) {
    els.peopleList.innerHTML = `<div class="empty-list">Add a person to start.</div>`;
    return;
  }

  for (const person of state.people) {
    const item = document.createElement("div");
    item.className = "person-item";
    item.innerHTML = `
      <strong>${escapeHtml(person.name)}</strong>
      <span>${escapeHtml(joinParts([person.title, person.company]))}</span>
      <small>${escapeHtml(person.note || "No note yet")}</small>
      <em>${descriptorCount(person.id)} face sample${descriptorCount(person.id) === 1 ? "" : "s"}</em>
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
  let savedPerson;

  try {
    const data = await api("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(person),
    });
    savedPerson = data.person;
    state.people.push(savedPerson);
  } catch (error) {
    person.id = `local-${crypto.randomUUID()}`;
    savedPerson = person;
    state.people.push(savedPerson);
    localStorage.setItem("people", JSON.stringify(state.people));
  }

  if (referencePhotos.length > 0) {
    els.resultBox.textContent = `Creating ${savedPerson.name} and enrolling reference photos...`;
    await enrollReferencePhotos(savedPerson.id, referencePhotos);
  } else {
    renderPeople();
    els.resultBox.textContent = `Created ${savedPerson.name}. Add face photos before recognition.`;
  }
  els.personForm.reset();
}

async function loadFaceModels() {
  if (!window.faceapi) {
    els.resultBox.textContent = "Face engine failed to load. Check internet access, then reload.";
    return;
  }

  els.resultBox.textContent = "Loading face recognition model...";
  try {
    const modelUrl = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(modelUrl),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
    ]);
    state.faceReady = true;
    els.resultBox.textContent = "Face engine ready. Add reference photos, then use camera capture.";
  } catch (error) {
    els.resultBox.textContent = "Could not load face recognition model. Check the network, then reload.";
  }
}

function loadStoredDescriptors() {
  const raw = localStorage.getItem("faceDescriptors");
  if (!raw) return;
  const stored = JSON.parse(raw);
  state.descriptors = Object.fromEntries(
    Object.entries(stored).map(([personId, descriptors]) => [
      personId,
      descriptors.map((descriptor) => Float32Array.from(descriptor)),
    ])
  );
}

function saveStoredDescriptors() {
  const serializable = Object.fromEntries(
    Object.entries(state.descriptors).map(([personId, descriptors]) => [
      personId,
      descriptors.map((descriptor) => Array.from(descriptor)),
    ])
  );
  localStorage.setItem("faceDescriptors", JSON.stringify(serializable));
}

async function enrollReferencePhotos(personId, files) {
  if (!state.faceReady) {
    await loadFaceModels();
  }
  if (!state.faceReady) return;

  const person = state.people.find((entry) => entry.id === personId);
  els.resultBox.textContent = `Reading ${files.length} reference photo${files.length === 1 ? "" : "s"} for ${person?.name || "this person"}...`;
  const descriptors = [];
  for (const file of files) {
    const img = await imageFromBlob(file);
    const detection = await faceapi
      .detectSingleFace(img)
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (detection) descriptors.push(detection.descriptor);
  }

  state.descriptors[personId] = [
    ...(state.descriptors[personId] || []),
    ...descriptors,
  ];
  saveStoredDescriptors();
  renderPeople();
  els.resultBox.textContent =
    descriptors.length > 0
      ? `Saved ${descriptors.length} usable face sample${descriptors.length === 1 ? "" : "s"} for ${person?.name || "this person"}.`
      : `No face found in the reference photos for ${person?.name || "this person"}. Try a clear front-facing photo.`;
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
    canvas.toBlob(resolve, "image/jpeg", 0.9);
  });
  state.selectedFile = null;
  els.photoInput.value = "";
  els.photoPreview.src = URL.createObjectURL(state.capturedBlob);
  els.photoPreview.classList.add("active");
  els.cameraPreview.classList.remove("active");
  els.recognizeButton.disabled = false;
  els.emptyPreview.hidden = true;
  els.resultBox.textContent = "Captured one camera frame. Run recognition to update the HUD.";
}

async function recognize() {
  const image = state.capturedBlob || state.selectedFile;
  if (!image) return;
  els.recognizeButton.disabled = true;
  els.recognizeButton.textContent = "Recognizing";
  els.resultBox.textContent = "Looking for a face in the captured image...";

  const realResult = await recognizeWithFaceApi(image);
  if (realResult) {
    showResult(realResult);
    showHud(realResult);
    els.recognizeButton.disabled = false;
    els.recognizeButton.textContent = "Recognize Captured Face";
    return;
  }

  els.recognizeButton.disabled = false;
  els.recognizeButton.textContent = "Recognize Captured Face";
}

async function recognizeWithFaceApi(imageBlob) {
  if (!state.faceReady) {
    await loadFaceModels();
  }
  if (!state.faceReady) return null;

  const enrolled = Object.entries(state.descriptors).filter(([, descriptors]) => descriptors.length > 0);
  if (enrolled.length === 0) {
    return {
      matched: false,
      confidence: 0,
      person: null,
      reason: "No reference face samples yet. Add face photos to a person first.",
    };
  }

  const img = await imageFromBlob(imageBlob);
  const detection = await faceapi
    .detectSingleFace(img)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    return {
      matched: false,
      confidence: 0,
      person: null,
      reason: "No face was detected in the captured image.",
    };
  }

  let best = { distance: Number.POSITIVE_INFINITY, person: null };
  for (const [personId, descriptors] of enrolled) {
    for (const descriptor of descriptors) {
      const distance = faceapi.euclideanDistance(detection.descriptor, descriptor);
      if (distance < best.distance) {
        best = {
          distance,
          person: state.people.find((person) => person.id === personId),
        };
      }
    }
  }

  const threshold = 0.56;
  if (!best.person || best.distance > threshold) {
    return {
      matched: false,
      confidence: Math.max(0, 1 - best.distance),
      person: null,
      reason: best.person
        ? `A face was detected. Closest match was ${best.person.name}, but distance ${best.distance.toFixed(3)} is above threshold ${threshold}.`
        : "A face was detected, but no enrolled person could be compared.",
    };
  }

  return {
    matched: true,
    confidence: Math.max(0.01, Math.min(0.99, 1 - best.distance)),
    person: best.person,
    distance: best.distance,
  };
}

function showResult(result) {
  if (!result.matched || !result.person) {
    els.resultBox.innerHTML = `
      <strong>未确认</strong>
      <span>${escapeHtml(result.reason || "No confident match.")}</span>
    `;
    return;
  }

  const person = result.person;
  els.resultBox.innerHTML = `
    <strong>Recognized: ${escapeHtml(person.name)}</strong>
    <span>${escapeHtml(joinParts([person.title, person.company]))}</span>
    <span>${escapeHtml(person.note || "No note")}</span>
    <span>Confidence: ${Math.round(result.confidence * 100)}%</span>
    ${result.distance == null ? "" : `<span>Distance: ${result.distance.toFixed(3)}</span>`}
  `;
}

function showHud(result) {
  if (!result.matched || !result.person) {
    els.hudName.textContent = "未确认";
    els.hudTitle.textContent = "No confident match";
    els.hudNote.textContent = result.reason || "Try another angle or better lighting.";
    els.hudConfidence.textContent = "--";
    return;
  }

  const person = result.person;
  els.hudName.textContent = person.name;
  els.hudTitle.textContent = joinParts([person.title, person.company]) || "Known attendee";
  els.hudNote.textContent = person.note || "No context note yet.";
  els.hudConfidence.textContent = `${Math.round(result.confidence * 100)}%`;
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

function descriptorCount(personId) {
  return state.descriptors[personId]?.length || 0;
}

function imageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

els.personForm.addEventListener("submit", addPerson);
els.startCameraButton.addEventListener("click", startCamera);
els.captureButton.addEventListener("click", captureFrame);
els.photoInput.addEventListener("change", handlePhotoChange);
els.recognizeButton.addEventListener("click", recognize);

loadPeople();
