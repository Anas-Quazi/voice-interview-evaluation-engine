import os
import requests
from dotenv import load_dotenv
import sys

sys.stdout.reconfigure(encoding = "utf-8")

load_dotenv()
key = os.getenv("GNANI_API_KEY") #^ ganai api key

#todo request api to extract audio and convert to text
with open("test/test_audio.mp3", "rb") as f:
    r = requests.post(
        "https://api.vachana.ai/stt/v3",
        headers={"X-API-Key-ID": key},
        files={"audio_file": ("test/test_audio.mp3", f, "audio/wav")},
        data={"model": "prisma-v3.0", "language_code": "hi-IN"},
        timeout=60,
    )

#? verify status
print(r.status_code)
print(r.json())