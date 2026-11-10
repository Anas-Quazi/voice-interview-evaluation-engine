"""
Interview coach - web backend.

Run it with:    uvicorn app:app --reload
Then open:      http://localhost:8000

The flow for one interview:
  1. POST /api/session/start          -> first question (text + audio)
  2. POST /api/session/{id}/answer    -> student's recording in, feedback + next question out
     (repeat step 2 until the last question)
  3. GET  /api/session/{id}/report    -> final summary
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

load_dotenv()
GNANI_KEY = os.getenv("GNANI_API_KEY")
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
if not GNANI_KEY or not GEMINI_KEY:
    raise SystemExit("Missing GNANI_API_KEY or GEMINI_API_KEY in .env")

# ---------------- settings you can change ----------------
STT_MODEL = "prisma-v3.0"
TTS_MODEL = "timbre-v2.5"
TTS_VOICE = "Nalini"

# For each answer language: speech-to-text code, text-to-speech code, and the name used in prompts.
# hi-IN keeps English words as they are. Check that your Timbre plan supports the voice in en-IN.
LANGUAGES = {
    "hi": {"stt": "hi-IN", "tts": "hi-IN", "name": "Hindi"},
    "en": {"stt": "en-IN", "tts": "en-IN", "name": "English"},
}

# The first question is fixed so the interview starts instantly. Gemini writes all the others.
OPENING_QUESTIONS = {
    "hi": "चलिए शुरू करते हैं। अपने बारे में थोड़ा बताइए।",
    "en": "Let's get started. Tell me a little about yourself.",
}

# (model, thinking_off). Tried in order; a busy or failing model is skipped right away.
GEMINI_MODELS = [
    ("gemini-3.5-flash", True),          # fastest in your test: 2.6 s
    ("gemini-3.5-flash-lite", False),    # backup: 6.6 s
    ("gemini-flash-lite-latest", False), # backup: 9.9 s
    ("gemini-3.1-flash-lite", False),
    ("gemini-3.7-flash", False),
    ("gemini-3.8-flash", False),
]

SESSION_TTL = 2 * 60 * 60            # forget sessions (and their audio files) after 2 hours
MAX_UPLOAD_BYTES = 8 * 1024 * 1024   # a 30 second recording is far smaller than this
# ---------------------------------------------------------

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
AUDIO_DIR = BASE_DIR / "assets" / "tts"

STT_URL = "https://api.vachana.ai/stt/v3"
TTS_URL = "https://api.vachana.ai/api/v1/tts/inference"
SCORE_KEYS = ["language", "grammar", "communication", "professionalism", "behavior", "confidence"]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("coach")

client = genai.Client(api_key=GEMINI_KEY)
pool = ThreadPoolExecutor(max_workers=4)   # lets us make two audio clips at the same time


# ---------------------------------------------------------------- sessions

@dataclass
class Session:
    id: str
    role: str
    level: str
    language: str
    total: int
    created: float = field(default_factory=time.time)
    current_question: str = ""
    turns: list = field(default_factory=list)     # one dict per answered question
    finished: bool = False
    report: dict | None = None
    report_turns: int = 0                          # how many turns the cached report covers
    lock: threading.Lock = field(default_factory=threading.Lock)


sessions: dict[str, Session] = {}
sessions_lock = threading.Lock()


def get_session(session_id):
    with sessions_lock:
        s = sessions.get(session_id)
    if s is None:
        raise HTTPException(404, "That interview wasn't found. Please start a new one.")
    return s


def drop_old_sessions():
    cutoff = time.time() - SESSION_TTL
    with sessions_lock:
        for sid in [k for k, v in sessions.items() if v.created < cutoff]:
            del sessions[sid]
    for f in AUDIO_DIR.glob("*.wav"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


# ---------------------------------------------------------------- speech to text

def transcribe(audio_bytes, filename, mime, language_code):
    r = requests.post(
        STT_URL,
        headers={"X-API-Key-ID": GNANI_KEY},
        files={"audio_file": (filename, audio_bytes, mime)},
        data={"model": STT_MODEL, "language_code": language_code},
        timeout=60,
    )
    r.raise_for_status()
    return r.json().get("transcript", "").strip()


# ---------------------------------------------------------------- gemini

def history_text(session):
    if not session.turns:
        return "Nothing yet. This is the first question."
    parts = []
    for t in session.turns:
        parts.append(f"Q{t['number']}: {t['question']}\nAnswer: {t['transcript']}")
    return "\n\n".join(parts)


def build_prompt(session, transcript, is_last):
    lang = LANGUAGES[session.language]["name"]
    number = len(session.turns) + 1

    if is_last:
        next_rule = ""
        reply_rule = f"under 50 words, in {lang}, friendly: one strength, one tip, then a short warm goodbye (this was the last question)"
        next_hint = "This was the LAST question, so next_question must be an empty string."
    else:
        next_rule = f"one new interview question in {lang}"
        reply_rule = f"under 40 words, in {lang}, friendly: one strength and one tip. Do not ask a question here"
        next_hint = (
            "- next_question: follow up on something the candidate actually said, or move to a fresh topic that suits the role "
            "(basics, projects, behaviour, a small situation). Never repeat or reword a question already asked."
        )

    return f"""You are a warm, expert interview coach running a mock interview. The candidate is a {session.level} interviewing for a {session.role} role.
This is question {number} of {session.total}.

Earlier in this interview:
{history_text(session)}

Question just asked: {session.current_question}
Candidate's spoken answer (speech-to-text transcript): {transcript}

Rules:
- Evaluate only what the candidate actually said. Never invent facts about them (degree, skills, projects, companies).
- The transcript comes from speech, so ignore punctuation and spelling quirks. Treat cultural greetings (like Assalamu Alaikum) as polite and professional.
- grammar_fixes: include only REAL mistakes, with "said" copied exactly from the transcript. Use an empty list if there are none.
- better_answer: improve the structure using only the candidate's own facts. Use placeholders like [your degree] or [your project] where details are missing.
{next_hint}
- spoken_reply and next_question will be read aloud, so use plain text only (no markdown, no emojis). For Hindi, write in Devanagari and keep technical terms and common English words in English.

Return ONLY JSON with exactly these keys:
{{
  "scores": {{"language": 1-5, "grammar": 1-5, "communication": 1-5,
              "professionalism": 1-5, "behavior": 1-5, "confidence": 1-5}},
  "strength": "one specific thing done well (English, short)",
  "improvement": "one clear, kind tip (English, short)",
  "grammar_fixes": [{{"said": "...", "better": "..."}}],
  "better_answer": "a polished version using only the candidate's facts",
  "next_question": "{next_rule}",
  "spoken_reply": "{reply_rule}"
}}"""


def load_json(text):
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)     # in case the model wraps it in a code fence
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("expected a JSON object")
    return data


def clean_scores(raw):
    scores = {}
    for key in SCORE_KEYS:
        try:
            value = int(round(float(raw[key])))
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"missing score: {key}")
        scores[key] = max(1, min(5, value))
    return scores


def clean_fixes(raw):
    fixes = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and item.get("said") and item.get("better"):
                fixes.append({"said": str(item["said"]).strip(), "better": str(item["better"]).strip()})
    return fixes[:5]


def parse_turn(text, is_last):
    data = load_json(text)
    if not isinstance(data.get("scores"), dict):
        raise ValueError("no scores in reply")
    result = {
        "scores": clean_scores(data["scores"]),
        "strength": str(data.get("strength", "")).strip(),
        "improvement": str(data.get("improvement", "")).strip(),
        "grammar_fixes": clean_fixes(data.get("grammar_fixes")),
        "better_answer": str(data.get("better_answer", "")).strip(),
        "next_question": "" if is_last else str(data.get("next_question", "")).strip(),
        "spoken_reply": str(data.get("spoken_reply", "")).strip(),
    }
    if not result["spoken_reply"]:
        raise ValueError("no spoken reply")
    if not is_last and not result["next_question"]:
        raise ValueError("no next question")
    return result


def ask_gemini(prompt, parse):
    """Try each model in turn. `parse` turns the raw text into a result, or raises if it looks wrong."""
    for round_no in (1, 2):                       # go through the list; if all are busy, wait and go once more
        for model, thinking_off in GEMINI_MODELS:
            cfg = {"response_mime_type": "application/json"}
            if thinking_off:
                cfg["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
            try:
                r = client.models.generate_content(
                    model=model, contents=prompt, config=types.GenerateContentConfig(**cfg)
                )
                return parse(r.text), model
            except Exception as e:
                log.warning("%s skipped: %s", model, str(e)[:80])
        if round_no == 1:
            time.sleep(3)
    raise RuntimeError("The coach is busy right now. Please try again in a minute.")


# ---------------------------------------------------------------- text to speech

def speak(text, out_path, language_code):
    body = {
        "text": text,
        "voice": TTS_VOICE,
        "model": TTS_MODEL,
        "language": language_code,
        "speed": 1.0,
        "audio_config": {
            "sample_rate": 48000, "num_channels": 1, "sample_width": 2,
            "encoding": "linear_pcm", "container": "wav",
        },
    }
    for attempt in (1, 2):
        r = requests.post(
            TTS_URL,
            headers={"Content-Type": "application/json", "X-API-Key-ID": GNANI_KEY},
            json=body,
            timeout=60,
        )
        if r.status_code == 200:
            with open(out_path, "wb") as f:
                f.write(r.content)
            return
        if r.status_code >= 500 and attempt == 1:
            time.sleep(2)                         # temporary server error: retry once
            continue
        break
    raise RuntimeError(f"Timbre failed: {r.status_code} {r.text[:200]}")


def make_audio(text, language, name):
    """Returns a URL for the audio, or None if speech failed. The app still works without audio."""
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    path = AUDIO_DIR / f"{name}.wav"
    try:
        speak(text, path, LANGUAGES[language]["tts"])
    except Exception as e:
        log.warning("speech failed for %s: %s", name, e)
        return None
    return f"/audio/{name}.wav"


# ---------------------------------------------------------------- api

app = FastAPI(title="Interview Coach")


class StartRequest(BaseModel):
    role: str = Field(min_length=2, max_length=80)
    level: Literal["fresher", "experienced"] = "fresher"
    language: Literal["hi", "en"] = "hi"
    num_questions: int = Field(5, ge=1, le=10)


@app.post("/api/session/start")
def start_session(req: StartRequest):
    role = " ".join(req.role.split())            # one line, single spaces
    if len(role) < 2:
        raise HTTPException(422, "Please enter the role you're preparing for.")

    drop_old_sessions()
    s = Session(
        id=uuid.uuid4().hex,
        role=role,
        level=req.level,
        language=req.language,
        total=req.num_questions,
        current_question=OPENING_QUESTIONS[req.language],
    )
    with sessions_lock:
        sessions[s.id] = s

    audio_url = make_audio(s.current_question, s.language, f"{s.id}_q1")
    return {
        "session_id": s.id,
        "question": {"number": 1, "total": s.total, "text": s.current_question, "audio_url": audio_url},
    }


@app.post("/api/session/{session_id}/answer")
def submit_answer(session_id: str, audio: UploadFile = File(...)):
    s = get_session(session_id)
    if not s.lock.acquire(blocking=False):       # a double click, or a retry while the first is still running
        raise HTTPException(409, "Still working on your last answer. Give it a moment.")
    try:
        if s.finished:
            raise HTTPException(409, "This interview is already finished.")
        return process_answer(s, audio)
    finally:
        s.lock.release()


def process_answer(s, upload):
    audio_bytes = upload.file.read(MAX_UPLOAD_BYTES + 1)
    if len(audio_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "That recording is too large. Answers can be up to 30 seconds.")
    if len(audio_bytes) < 1000:
        raise HTTPException(422, "The recording looks empty. Please try again.")

    t0 = time.time()
    try:
        transcript = transcribe(
            audio_bytes,
            upload.filename or "answer.wav",
            upload.content_type or "audio/wav",
            LANGUAGES[s.language]["stt"],
        )
    except requests.RequestException as e:
        log.error("speech-to-text failed: %s", e)
        raise HTTPException(502, "Couldn't reach the speech service. Please try again.")
    if not transcript:
        raise HTTPException(422, "I couldn't hear anything in that recording. Check your microphone and try again.")
    t1 = time.time()

    number = len(s.turns) + 1
    is_last = number >= s.total
    try:
        result, model = ask_gemini(build_prompt(s, transcript, is_last), lambda text: parse_turn(text, is_last))
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    t2 = time.time()

    # speak the feedback and the next question at the same time so the student waits once
    reply_job = pool.submit(make_audio, result["spoken_reply"], s.language, f"{s.id}_r{number}")
    question_job = None
    if not is_last:
        question_job = pool.submit(make_audio, result["next_question"], s.language, f"{s.id}_q{number + 1}")
    reply_url = reply_job.result()
    question_url = question_job.result() if question_job else None
    t3 = time.time()

    # only now do we save the turn, so a failed attempt can simply be retried
    s.turns.append({
        "number": number,
        "question": s.current_question,
        "transcript": transcript,
        "scores": result["scores"],
        "average": round(sum(result["scores"].values()) / len(SCORE_KEYS), 1),
        "strength": result["strength"],
        "improvement": result["improvement"],
        "grammar_fixes": result["grammar_fixes"],
        "better_answer": result["better_answer"],
    })
    if is_last:
        s.finished = True
    else:
        s.current_question = result["next_question"]

    log.info("session %s q%d: stt %.1fs, %s %.1fs, tts %.1fs", s.id[:6], number, t1 - t0, model, t2 - t1, t3 - t2)
    return {
        "transcript": transcript,
        "scores": result["scores"],
        "average": s.turns[-1]["average"],
        "strength": result["strength"],
        "improvement": result["improvement"],
        "grammar_fixes": result["grammar_fixes"],
        "better_answer": result["better_answer"],
        "reply_audio_url": reply_url,
        "finished": is_last,
        "next_question": None if is_last else {
            "number": number + 1,
            "total": s.total,
            "text": result["next_question"],
            "audio_url": question_url,
        },
    }


# ---------------------------------------------------------------- final report

def average_scores(turns):
    return {k: round(sum(t["scores"][k] for t in turns) / len(turns), 1) for k in SCORE_KEYS}


def build_report_prompt(s):
    lines = []
    for t in s.turns:
        scores = ", ".join(f"{k} {v}" for k, v in t["scores"].items())
        lines.append(
            f"Q{t['number']}: {t['question']}\nAnswer: {t['transcript']}\n"
            f"Scores: {scores}\nStrength noted: {t['strength']}\nTip given: {t['improvement']}"
        )
    return f"""You are a warm, expert interview coach. A {s.level} candidate just finished a mock interview for a {s.role} role.
Here is how each answer went:

{chr(10).join(lines)}

Write the final report. Use only what is shown above and never invent facts about the candidate. Plain English, kind but honest.

Return ONLY JSON with exactly these keys:
{{
  "summary": "2-3 sentences on how the interview went overall",
  "strengths": ["2 or 3 patterns that worked well across the answers"],
  "focus_areas": ["2 or 3 things to practise next, each one concrete"],
  "tips": ["2 or 3 short practice exercises for this week"]
}}"""


def parse_report(text):
    data = load_json(text)
    summary = str(data.get("summary", "")).strip()
    if not summary:
        raise ValueError("no summary")

    def items(key):
        raw = data.get(key)
        return [str(x).strip() for x in raw if str(x).strip()][:4] if isinstance(raw, list) else []

    return {"summary": summary, "strengths": items("strengths"),
            "focus_areas": items("focus_areas"), "tips": items("tips")}


def basic_report(s):
    """Used when Gemini can't be reached, so the student still gets their results."""
    strengths = [t["strength"] for t in s.turns if t["strength"]][:3]
    focus = [t["improvement"] for t in s.turns if t["improvement"]][:3]
    return {
        "summary": f"You answered {len(s.turns)} of {s.total} questions. Your scores for each answer are below.",
        "strengths": strengths,
        "focus_areas": focus,
        "tips": [],
    }


def build_report(s):
    try:
        narrative, _ = ask_gemini(build_report_prompt(s), parse_report)
    except RuntimeError:
        narrative = basic_report(s)

    averages = average_scores(s.turns)
    return {
        "role": s.role,
        "level": s.level,
        "answered": len(s.turns),
        "total": s.total,
        "average_overall": round(sum(averages.values()) / len(averages), 1),
        "average_scores": averages,
        **narrative,
        "turns": s.turns,
    }


@app.get("/api/session/{session_id}/report")
def get_report(session_id: str):
    s = get_session(session_id)
    if not s.turns:
        raise HTTPException(409, "Answer at least one question to see a report.")
    with s.lock:
        s.finished = True                         # the report closes the interview
        if s.report is None or s.report_turns != len(s.turns):
            s.report = build_report(s)
            s.report_turns = len(s.turns)
        return s.report


# ---------------------------------------------------------------- pages and audio

AUDIO_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="site")
