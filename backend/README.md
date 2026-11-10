# Interview Coach

A mock interview you can do in the browser. The coach asks a question out loud, you answer with your microphone, and you get scores, grammar fixes and a better version of your answer. Then it asks the next question, based on what you said. At the end you get a report.

It is the same pipeline as `test_pipeline.py` (Prisma speech-to-text, Gemini, Timbre text-to-speech), wrapped in a small web app.

## Run it

You need Python 3.9 or newer.

```
python -m venv .venv
.venv\Scripts\activate          (on Mac or Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env          (on Mac or Linux: cp .env.example .env)
```

Open `.env` and paste in your two keys, then start the server:

```
uvicorn app:app --reload
```

Go to http://localhost:8000 in Chrome, Edge, Firefox or Safari and allow the microphone when asked.

The microphone only works on `localhost` or on an `https` address. If you put this on a server, put it behind https.

## How it fits together

```
app.py             the backend: sessions, Prisma, Gemini, Timbre, report
static/index.html  the three screens: setup, interview, report
static/style.css   styling
static/app.js      recording, sending the answer, showing feedback
assets/tts/        the coach's audio clips (created on first run, cleaned up after 2 hours)
```

One interview goes like this:

1. `POST /api/session/start` creates a session and returns the first question with its audio.
2. The browser records up to 30 seconds, turns it into a 16 kHz WAV file, and sends it to `POST /api/session/{id}/answer`.
3. The server runs speech-to-text, then asks Gemini to judge the answer and write the next question (it sees all earlier questions and answers), then makes the audio for the feedback and the next question at the same time.
4. After the last question, `GET /api/session/{id}/report` returns the averages and a short written summary.

## Things you may want to change

All of these are at the top of `app.py`.

- `GEMINI_MODELS`: the fallback list from your test script, unchanged.
- `TTS_VOICE` and `LANGUAGES`: the English option uses `en-IN` for speech. If your Timbre plan doesn't have that voice or language code, change it there.
- `OPENING_QUESTIONS`: the first question is fixed so the interview starts at once. Gemini writes every one after it.
- `SESSION_TTL`: how long a session is kept in memory.

## Good to know

- Sessions live in memory, so restarting the server ends any interview in progress. If you want history or accounts later, the place to add a database is the `Session` class.
- If speech output fails for a moment, the interview still works. You just see the text without audio.
- If the speech service rejects the WAV file, check the sample rate in `WAV_RATE` at the top of `static/app.js`.
