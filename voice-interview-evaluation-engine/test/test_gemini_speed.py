import os
import json
import time
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
key = os.getenv("GEMINI_API_KEY")
if not key:
    raise SystemExit("GEMINI_API_KEY not found. Check your .env file.")

client = genai.Client(api_key=key)

MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-flash-lite-latest",
]

transcript = "अस्सलामु अलैकुम! मेरा नाम मोहम्मद अनस है और मैं एक aspiring data scientist हूँ।"

prompt = f"""You are a warm interview coach. Candidate is a fresher interviewing for a Data Scientist role.
Question: Tell me about yourself.
Answer (speech transcript): {transcript}
Evaluate only what was said; never invent facts.
Return ONLY JSON with keys: "scores" (language, grammar, communication, professionalism, behavior, confidence, each 1-5),
"strength", "improvement", "grammar_fixes" (list), "better_answer", "next_question",
"spoken_reply" (under 50 words, in Hindi: one strength, one tip, then the next question)."""


def run(model, thinking_off):
    cfg = {"response_mime_type": "application/json"}
    if thinking_off:
        cfg["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
    t = time.time()
    r = client.models.generate_content(
        model=model, contents=prompt, config=types.GenerateContentConfig(**cfg)
    )
    json.loads(r.text)  # make sure the JSON is valid
    return time.time() - t


print(f"{'model':28} {'normal':>12} {'thinking off':>14}")
for model in MODELS:
    row = []
    for thinking_off in (False, True):
        try:
            row.append(f"{run(model, thinking_off):.1f}s")
        except Exception as e:
            code = "503" if "503" in str(e) else "404" if "404" in str(e) else "err"
            row.append(f"failed ({code})")
        time.sleep(1)
    print(f"{model:28} {row[0]:>12} {row[1]:>14}")