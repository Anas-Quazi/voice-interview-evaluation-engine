import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()
key = os.getenv("GNANI_API_KEY")

URL = "https://api.vachana.ai/api/v1/tts/inference"

AUDIO = {
    "sample_rate": 48000,
    "num_channels": 1,
    "sample_width": 2,
    "encoding": "linear_pcm",
    "container": "wav",
}

HINDI = "अस्सलामु अलैकुम! चलिए इंटरव्यू शुरू करते हैं। अपने बारे में बताइए।"
ENGLISH = "Hello! Let's begin your interview. Tell me about yourself."

#! try different models with hindi and english
TRIES = [
    ("A: v2.5 Nalini Hindi",        "timbre-v2.5", "Nalini",  "hi-IN", HINDI),
    ("B: v2.5 Nalini English",      "timbre-v2.5", "Nalini",  "en-IN", ENGLISH),
    ("C: v3.0 Shivani Hindi",       "timbre-v3.0", "Shivani", "hi-IN", HINDI),
    ("D: v3.0 Shivani English",     "timbre-v3.0", "Shivani", "en-IN", ENGLISH),
    ("E: v2.5 Poorvi Hinglish",     "timbre-v2.5", "Poorvi",  "hi-en", "Hello! Chaliye interview start karte hain. Apne baare mein bataiye."),
]

if not key:
    raise SystemExit("GNANI_API_KEY not found. Check your .env file.")

os.makedirs("assets", exist_ok=True)

for name, model, voice, lang, text in TRIES:
    body = {
        "text": text,
        "voice": voice,
        "model": model,
        "language": lang,
        "speed": 1.0,
        "audio_config": AUDIO,
    }
    try:
        r = requests.post(
            URL,
            headers={"Content-Type": "application/json", "X-API-Key-ID": key},
            json=body,
            timeout=60,
        )
    except Exception as e:
        print(f"{name} -> request failed: {e}")
        continue

    if r.status_code == 200:
        filename = f"assets/timbre_{name[0]}.wav"
        with open(filename, "wb") as f:
            f.write(r.content)
        print(f"{name} -> 200 OK, saved {filename} ({len(r.content)} bytes)")
    else:
        print(f"{name} -> {r.status_code}: {r.text[:300]}")

    time.sleep(2)