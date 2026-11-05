import os
import json
import time
import mimetypes
import requests
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
GNANI_KEY = os.getenv("GNANI_API_KEY")
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
if not GNANI_KEY or not GEMINI_KEY:
    raise SystemExit("Missing GNANI_API_KEY or GEMINI_API_KEY in .env")

# ---------------- settings you can change ----------------
ANSWER_FILE = "test/test_audio.mp3"   # the student's recorded answer (under 30 seconds)
ROLE = "Data Scientist"
LEVEL = "fresher"
QUESTION = "Tell me about yourself."

STT_LANGUAGE = "hi-IN"            # hi-IN for Hindi (English words are kept), en-IN for English
REPLY_LANGUAGE_NAME = "Hindi"     # language the coach speaks back in
REPLY_TTS_LANGUAGE = "hi-IN"
TTS_MODEL = "timbre-v2.5"
TTS_VOICE = "Nalini"

# (model, thinking_off). Tried in order; a busy or failing model is skipped right away.
GEMINI_MODELS = [
    ("gemini-3.5-flash", True),          # fastest in your test: 2.6 s
    ("gemini-3.5-flash-lite", False),    # backup: 6.6 s
    ("gemini-flash-lite-latest", False), # backup: 9.9 s
    ("gemini-3.1-flash-lite", False),
    ("gemini-3.7-flash", False),
    ("gemini-3.8-flash", False),
]
OUT_DIR = "assets/tts"
# ---------------------------------------------------------

STT_URL = "https://api.vachana.ai/stt/v3"
TTS_URL = "https://api.vachana.ai/api/v1/tts/inference"
client = genai.Client(api_key=GEMINI_KEY)


def transcribe(path):
    mime = mimetypes.guess_type(path)[0] or "audio/wav"
    with open(path, "rb") as f:
        r = requests.post(
            STT_URL,
            headers={"X-API-Key-ID": GNANI_KEY},
            files={"audio_file": (os.path.basename(path), f, mime)},
            data={"model": "prisma-v3.0", "language_code": STT_LANGUAGE},
            timeout=60,
        )
    r.raise_for_status()
    return r.json().get("transcript", "").strip()


def build_prompt(transcript):
    return f"""You are a warm, expert interview coach. The candidate is a {LEVEL} interviewing for a {ROLE} role.
Question asked: {QUESTION}
Candidate's spoken answer (speech-to-text transcript): {transcript}

Rules:
- Evaluate only what the candidate actually said. Never invent facts about them (degree, skills, projects, companies).
- The transcript comes from speech, so ignore punctuation and spelling quirks. Treat cultural greetings (like Assalamu Alaikum) as polite and professional.
- grammar_fixes: include only REAL mistakes, with "said" copied exactly from the transcript. Use an empty list if there are none.
- better_answer: improve the structure using only the candidate's own facts. Use placeholders like [your degree] or [your project] where details are missing.

Return ONLY JSON with exactly these keys:
{{
  "scores": {{"language": 1-5, "grammar": 1-5, "communication": 1-5,
              "professionalism": 1-5, "behavior": 1-5, "confidence": 1-5}},
  "strength": "one specific thing done well (English, short)",
  "improvement": "one clear, kind tip (English, short)",
  "grammar_fixes": [{{"said": "...", "better": "..."}}],
  "better_answer": "a polished version using only the candidate's facts",
  "next_question": "one new interview question",
  "spoken_reply": "under 50 words, in {REPLY_LANGUAGE_NAME}, friendly: one strength, one tip, then the next question"
}}"""


def ask_gemini(prompt):
    for round_no in (1, 2):                       # go through the list; if all are busy, wait and go once more
        for model, thinking_off in GEMINI_MODELS:
            cfg = {"response_mime_type": "application/json"}
            if thinking_off:
                cfg["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
            try:
                r = client.models.generate_content(
                    model=model, contents=prompt, config=types.GenerateContentConfig(**cfg)
                )
                return json.loads(r.text), model
            except Exception as e:
                print(f"   ({model} skipped: {str(e)[:60]})")
        if round_no == 1:
            time.sleep(3)
    raise RuntimeError("All Gemini models failed. Try again in a minute.")


def speak(text, out_path):
    body = {
        "text": text,
        "voice": TTS_VOICE,
        "model": TTS_MODEL,
        "language": REPLY_TTS_LANGUAGE,
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


def play(path):
    if hasattr(os, "startfile"):                  # Windows
        os.startfile(os.path.abspath(path))
    else:
        print("Open this file to listen:", path)


os.makedirs(OUT_DIR, exist_ok=True)
start = time.time()

print("1) Prisma: listening to the answer...")
transcript = transcribe(ANSWER_FILE)
print("   Transcript:", transcript)
if not transcript:
    raise SystemExit("Empty transcript. Check the audio file.")
t1 = time.time()

print("2) Gemini: evaluating the answer...")
result, used_model = ask_gemini(build_prompt(transcript))
t2 = time.time()
print("   Model used:", used_model)
print("   Scores:", json.dumps(result["scores"], ensure_ascii=False))
print("   Strength:", result["strength"])
print("   Improvement:", result["improvement"])
print("   Grammar fixes:", result["grammar_fixes"])
print("   Better answer:", result["better_answer"])
print("   Next question:", result["next_question"])
print("   Spoken reply:", result["spoken_reply"])

print("3) Timbre: speaking the reply...")
out_path = f"{OUT_DIR}/coach_reply.wav"
speak(result["spoken_reply"], out_path)
t3 = time.time()

print(f"\nTime taken: Prisma {t1 - start:.1f}s | Gemini {t2 - t1:.1f}s | Timbre {t3 - t2:.1f}s | Total {t3 - start:.1f}s")
print("Playing:", out_path)
play(out_path)