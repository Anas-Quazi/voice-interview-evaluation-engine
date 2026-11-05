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

# Models from your key's list, newest first. The first one that works is used.
CANDIDATES = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
]

question = "Tell me about yourself."
answer = "अस्सलामु अलैकुम! मेरा नाम मोहम्मद अनस है और मैं एक aspiring data scientist हूँ।"

prompt = f"""You are a warm, expert interview coach. The candidate is a fresher interviewing for a Data Scientist role.
Question asked: {question}
Candidate's spoken answer (speech-to-text transcript): {answer}

Evaluate the answer. Return ONLY JSON with exactly these keys:
{{
  "scores": {{"language": 1-5, "grammar": 1-5, "communication": 1-5,
              "professionalism": 1-5, "behavior": 1-5, "confidence": 1-5}},
  "strength": "one specific thing done well (English, short)",
  "improvement": "one clear, kind tip (English, short)",
  "grammar_fixes": [{{"said": "...", "better": "..."}}],
  "better_answer": "a polished version of the answer",
  "next_question": "one new interview question",
  "spoken_reply": "under 50 words, in Hindi, friendly: one strength, one tip, then the next question"
}}"""

worked = False
for model in CANDIDATES:
    for attempt in (1, 2):          # retry once, because 503 "high demand" is usually temporary
        try:
            r = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            data = json.loads(r.text)
            print(f"Model that worked: {model}\n")
            print(json.dumps(data, indent=2, ensure_ascii=False))
            worked = True
            break
        except Exception as e:
            msg = str(e)
            print(f"{model} (attempt {attempt}) -> failed: {msg[:160]}\n")
            if "503" in msg and attempt == 1:
                time.sleep(4)
                continue
            break
    if worked:
        break

if not worked:
    print("No candidate worked. Paste this output and I'll pick another model.")