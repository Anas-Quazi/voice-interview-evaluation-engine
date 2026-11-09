"use strict";

const MAX_SECONDS = 30;       // matches the speech-to-text limit
const MIN_SECONDS = 1.5;
const WAV_RATE = 16000;       // 16 kHz mono is plenty for speech and keeps uploads small

const SCORE_LABELS = {
  language: "Language",
  grammar: "Grammar",
  communication: "Communication",
  professionalism: "Professionalism",
  behavior: "Behavior",
  confidence: "Confidence",
};

const state = {
  sessionId: null,
  question: null,       // the question on screen: {number, total, text, audio_url}
  nextQuestion: null,   // comes back with the feedback
  finished: false,
  replyUrl: null,
  stream: null,
  recorder: null,
  chunks: [],
  startedAt: 0,
  duration: 0,
  timerId: null,
  meter: null,
  answer: null,         // {blob, name, peak, url}
};

const $ = (selector) => document.querySelector(selector);

// tiny helper so we never put model text into innerHTML
function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}


/* ---------------------------------------------------------------- screens and messages */

function showScreen(name) {
  for (const id of ["setup", "interview", "report"]) {
    $("#screen-" + id).hidden = id !== name;
  }
  $("#progress").hidden = name !== "interview";
  window.scrollTo(0, 0);
}

function setPhase(name) {
  for (const node of document.querySelectorAll("[data-phase]")) {
    node.hidden = node.dataset.phase !== name;
  }
  document.body.classList.toggle("recording", name === "recording");
}

let retryAction = null;

function showError(message, retry) {
  $("#error-text").textContent = message;
  retryAction = retry || null;
  $("#error-retry").hidden = !retry;
  $("#error").hidden = false;
}

function hideError() {
  $("#error").hidden = true;
  retryAction = null;
}

function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
  button.disabled = busy;
}


/* ---------------------------------------------------------------- talking to the server */

async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let res;
  try {
    res = await fetch(path, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("That took too long. Please try again.");
    throw new Error("Can't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  let body = null;
  try { body = await res.json(); } catch (_) { /* not JSON, fine */ }

  if (!res.ok) {
    const detail = body && body.detail;
    throw new Error(typeof detail === "string" ? detail : "Something went wrong. Please try again.");
  }
  return body;
}


/* ---------------------------------------------------------------- audio playback */

let player = null;

function stopAudio() {
  if (player) {
    player.pause();
    player = null;
  }
}

function playUrl(url) {
  stopAudio();
  if (!url) {
    showError("The coach's voice isn't available right now. You can read the text on screen instead.");
    return;
  }
  player = new Audio(url);
  // the browser can block autoplay, the play buttons still work
  player.play().catch(() => {});
}


/* ---------------------------------------------------------------- starting an interview */

function onSetupSubmit(event) {
  event.preventDefault();
  hideError();

  const form = new FormData($("#setup-form"));
  const role = String(form.get("role") || "").trim();
  if (role.length < 2) {
    showError("Please enter the role you're preparing for.");
    $("#role").focus();
    return;
  }

  beginSession({
    role,
    level: form.get("level"),
    language: form.get("language"),
    num_questions: Number(form.get("num_questions")),
  });
}

async function beginSession(payload) {
  const button = $("#start-btn");
  setBusy(button, true, "Starting...");
  try {
    const data = await api("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.sessionId = data.session_id;
    state.finished = false;
    showScreen("interview");
    showQuestion(data.question);
  } catch (err) {
    showError(err.message, () => beginSession(payload));
  } finally {
    setBusy(button, false);
  }
}

function showQuestion(q) {
  state.question = q;
  state.answer = null;

  $("#q-count").textContent = `Question ${q.number} of ${q.total}`;
  $("#question-text").textContent = q.text;
  $("#replay-question").hidden = !q.audio_url;
  renderSegments(q.number, q.total);

  setPhase("idle");
  window.scrollTo(0, 0);
  $("#question-text").focus({ preventScroll: true });
  playUrl(q.audio_url);
}

function renderSegments(number, total) {
  const wrap = $("#segments");
  wrap.replaceChildren();
  for (let i = 1; i <= total; i++) {
    wrap.append(h("span", i < number ? "done" : i === number ? "current" : ""));
  }
  wrap.setAttribute("aria-label", `Question ${number} of ${total}`);
}


/* ---------------------------------------------------------------- recording */

function pickMimeType() {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return options.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || "";
}

function micErrorMessage(err) {
  if (err.name === "NotAllowedError" || err.name === "SecurityError") {
    return "Microphone access is blocked. Allow it in your browser's site settings, then try again.";
  }
  if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
    return "No microphone found. Plug one in or check your system settings.";
  }
  return "Couldn't start the microphone. Close other apps that might be using it and try again.";
}

async function startRecording() {
  hideError();
  stopAudio();

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    showError("Recording isn't available here. Use a recent Chrome, Edge, Firefox or Safari, and open the app on localhost or over https.");
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    showError(micErrorMessage(err));
    return;
  }

  const mimeType = pickMimeType();
  state.chunks = [];
  state.recorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
  state.recorder.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
  state.recorder.onstop = onRecordingStopped;
  state.recorder.start();

  state.startedAt = performance.now();
  state.timerId = setInterval(tickTimer, 100);
  startMeter(state.stream);
  tickTimer();
  setPhase("recording");
}

function tickTimer() {
  const seconds = (performance.now() - state.startedAt) / 1000;
  const whole = Math.floor(seconds);
  $("#timer").textContent = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  if (seconds >= MAX_SECONDS) stopRecording();
}

function stopRecording() {
  if (!state.recorder || state.recorder.state !== "recording") return;
  state.duration = (performance.now() - state.startedAt) / 1000;
  clearInterval(state.timerId);
  stopMeter();
  state.recorder.stop();
  state.stream.getTracks().forEach((track) => track.stop());
}

// the ring around the stop button grows and shrinks with your voice
function startMeter(stream) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  const ctx = new AudioCtx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  const target = $("#stop-btn");
  let frame = 0;

  const loop = () => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) {
      const v = (value - 128) / 128;
      sum += v * v;
    }
    const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
    target.style.setProperty("--level", level.toFixed(2));
    frame = requestAnimationFrame(loop);
  };
  loop();

  state.meter = {
    stop() {
      cancelAnimationFrame(frame);
      target.style.setProperty("--level", 0);
      ctx.close();
    },
  };
}

function stopMeter() {
  if (state.meter) {
    state.meter.stop();
    state.meter = null;
  }
}

async function onRecordingStopped() {
  if (state.duration < MIN_SECONDS) {
    showError("That was too short. Record at least a couple of seconds.");
    setPhase("idle");
    return;
  }

  const raw = new Blob(state.chunks, { type: state.recorder.mimeType || "audio/webm" });
  let answer;
  try {
    answer = await toWav(raw);
  } catch (err) {
    // the speech service needs WAV, so a raw webm/ogg/m4a recording would only fail on the server
    console.warn("WAV conversion failed", err);
    showError("I couldn't process that recording in your browser. Please record again, or try Chrome or Edge.");
    setPhase("idle");
    return;
  }

  if (answer.peak < 0.01) {
    showError("I couldn't pick up any sound. Check that the right microphone is selected, then try again.");
    setPhase("idle");
    return;
  }

  if (state.answer && state.answer.url) URL.revokeObjectURL(state.answer.url);
  answer.url = URL.createObjectURL(answer.blob);
  state.answer = answer;
  $("#review-audio").src = answer.url;
  setPhase("review");
}

function recordAgain() {
  hideError();
  $("#review-audio").pause();
  setPhase("idle");
}


/* ---------------------------------------------------------------- turning the recording into a wav file */

async function toWav(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  const buffer = await blob.arrayBuffer();
  const ctx = new AudioCtx();
  let decoded;
  try {
    decoded = await new Promise((resolve, reject) => ctx.decodeAudioData(buffer, resolve, reject));
  } finally {
    ctx.close();
  }

  // render into a 16 kHz, one channel buffer (this also mixes stereo down to mono)
  const frames = Math.max(1, Math.ceil(decoded.duration * WAV_RATE));
  const offline = new OfflineCtx(1, frames, WAV_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  const samples = rendered.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return { blob: encodeWav(samples, WAV_RATE), name: "answer.wav", peak };
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);              // size of this block
  view.setUint16(20, 1, true);               // plain PCM
  view.setUint16(22, 1, true);               // one channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);  // bytes per second
  view.setUint16(32, 2, true);               // bytes per sample frame
  view.setUint16(34, 16, true);              // bits per sample
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}


/* ---------------------------------------------------------------- sending the answer and showing feedback */

async function sendAnswer() {
  hideError();
  $("#review-audio").pause();
  setPhase("processing");

  const form = new FormData();
  form.append("audio", state.answer.blob, state.answer.name);

  try {
    const data = await api(`/api/session/${state.sessionId}/answer`, { method: "POST", body: form });
    showFeedback(data);
  } catch (err) {
    setPhase("review");           // the recording is still here, so they can send it again
    showError(err.message, sendAnswer);
  }
}

function showFeedback(data) {
  state.nextQuestion = data.next_question;
  state.finished = data.finished;
  state.replyUrl = data.reply_audio_url;

  $("#fb-transcript").textContent = data.transcript;
  $("#fb-average").textContent = data.average.toFixed(1);
  fillBars($("#fb-bars"), data.scores);
  $("#fb-strength").textContent = data.strength;
  $("#fb-improvement").textContent = data.improvement;
  fillFixes($("#fb-grammar"), data.grammar_fixes);
  $("#fb-grammar-wrap").hidden = data.grammar_fixes.length === 0;
  $("#fb-better").textContent = data.better_answer;

  $("#replay-reply").hidden = !data.reply_audio_url;
  $("#next-btn").textContent = data.finished ? "See my report" : "Next question";
  $("#finish-btn").hidden = data.finished;

  setPhase("feedback");
  playUrl(data.reply_audio_url);
}

function goNext() {
  stopAudio();
  if (state.finished) {
    showReport();
  } else {
    showQuestion(state.nextQuestion);
  }
}

function tone(value) {
  return value >= 4 ? "high" : value === 3 ? "mid" : "low";
}

function barRow(label, value) {
  const rounded = Math.round(value);
  const row = h("div", "bar-row");
  const track = h("span", "bar-track");
  for (let i = 1; i <= 5; i++) {
    track.append(h("span", i <= rounded ? `seg ${tone(rounded)}` : "seg"));
  }
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  row.append(h("span", "bar-label", label), track, h("span", "bar-value", shown));
  return row;
}

function fillBars(container, scores) {
  container.replaceChildren();
  for (const key of Object.keys(SCORE_LABELS)) {
    if (key in scores) container.append(barRow(SCORE_LABELS[key], scores[key]));
  }
}

function fillFixes(list, fixes) {
  list.replaceChildren();
  for (const fix of fixes) {
    const item = h("li");
    item.append(h("del", "", fix.said), " ", h("ins", "", fix.better));
    list.append(item);
  }
}


/* ---------------------------------------------------------------- final report */

async function showReport() {
  hideError();
  stopAudio();
  showScreen("report");
  $("#report-loading").hidden = false;
  $("#report-body").hidden = true;

  try {
    const report = await api(`/api/session/${state.sessionId}/report`);
    renderReport(report);
  } catch (err) {
    $("#report-loading").hidden = true;
    showError(err.message, showReport);
  }
}

function fillList(list, items) {
  list.replaceChildren();
  for (const text of items) list.append(h("li", "", text));
}

function renderReport(r) {
  $("#report-loading").hidden = true;
  $("#report-body").hidden = false;

  const level = r.level === "fresher" ? "fresher" : "experienced";
  $("#r-role").textContent = `${r.role}, ${level}. ${r.answered} of ${r.total} questions answered.`;
  $("#r-overall").textContent = r.average_overall.toFixed(1);
  $("#r-summary").textContent = r.summary;
  fillBars($("#r-bars"), r.average_scores);
  fillList($("#r-strengths"), r.strengths);
  fillList($("#r-focus"), r.focus_areas);
  fillList($("#r-tips"), r.tips);
  $("#r-tips-wrap").hidden = r.tips.length === 0;

  const recap = $("#r-turns");
  recap.replaceChildren();
  for (const t of r.turns) {
    const details = h("details");
    const summary = h("summary");
    summary.append(h("span", "", `${t.number}. ${t.question}`), h("span", "score", `${t.average.toFixed(1)} / 5`));

    const body = h("div", "detail");
    body.append(textBlock("What you said", t.transcript));
    body.append(textBlock("What worked", t.strength));
    body.append(textBlock("Try this next time", t.improvement));
    if (t.grammar_fixes.length) {
      const wrap = h("div");
      const list = h("ul", "fixes");
      fillFixes(list, t.grammar_fixes);
      wrap.append(h("h3", "", "Grammar fixes"), list);
      body.append(wrap);
    }
    const better = h("div");
    better.append(h("h3", "", "A stronger version"), h("p", "better", t.better_answer));
    body.append(better);

    details.append(summary, body);
    recap.append(details);
  }
}

function textBlock(title, text) {
  const wrap = h("div");
  wrap.append(h("h3", "", title), h("p", "", text));
  return wrap;
}

function startOver() {
  stopAudio();
  hideError();
  state.sessionId = null;
  state.answer = null;
  setPhase("idle");
  showScreen("setup");
}


/* ---------------------------------------------------------------- wiring */

$("#setup-form").addEventListener("submit", onSetupSubmit);
$("#record-btn").addEventListener("click", startRecording);
$("#stop-btn").addEventListener("click", stopRecording);
$("#send-btn").addEventListener("click", sendAnswer);
$("#redo-btn").addEventListener("click", recordAgain);
$("#replay-question").addEventListener("click", () => playUrl(state.question && state.question.audio_url));
$("#replay-reply").addEventListener("click", () => playUrl(state.replyUrl));
$("#next-btn").addEventListener("click", goNext);
$("#finish-btn").addEventListener("click", showReport);
$("#restart-btn").addEventListener("click", startOver);
$("#print-btn").addEventListener("click", () => window.print());
$("#error-close").addEventListener("click", hideError);
$("#error-retry").addEventListener("click", () => {
  const retry = retryAction;
  hideError();
  if (retry) retry();
});
