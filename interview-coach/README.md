# Interview Coach

A voice-based mock interview that runs in the browser. The coach asks a question aloud, you answer with your microphone, and you receive scores, grammar corrections and an improved version of your answer. Each follow-up question is generated from your previous responses, and a summary report is produced at the end.

**Pipeline:** Prisma (speech-to-text) → Gemini (evaluation and question generation) → Timbre (text-to-speech), served by a FastAPI backend with a lightweight static frontend.

## Quick Start

**Requirements:** Python 3.9+, a modern browser (Chrome, Edge, Firefox or Safari), and API keys for Gnani (Prisma/Timbre) and Gemini.

```bash
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file in the project root:

```env
GNANI_API_KEY=your_gnani_key
GEMINI_API_KEY=your_gemini_key
```

Start the server and open <http://localhost:8000>, then allow microphone access:

```bash
uvicorn app:app --reload
```

> The microphone requires `localhost` or an `https` origin. Deploy behind HTTPS.

## Project Structure

```
app.py              Backend: sessions, Prisma, Gemini, Timbre, report
static/index.html   Setup, interview and report screens
static/style.css    Styling
static/app.js       Recording, upload, feedback display
assets/tts/         Generated coach audio (auto-created, purged after 2 hours)
```

## How an Interview Works

1. `POST /api/session/start` creates a session and returns the first question with audio.
2. The browser records up to 30 seconds, converts it to a 16 kHz WAV and sends it to `POST /api/session/{id}/answer`.
3. The server transcribes the audio, then Gemini scores the answer and writes the next question using the full history. Audio for the feedback and next question is synthesized in parallel.
4. After the final question, `GET /api/session/{id}/report` returns average scores and a written summary.

## Configuration

Settings live at the top of `app.py`:

| Setting | Purpose |
| --- | --- |
| `GEMINI_MODELS` | Ordered fallback list of Gemini models |
| `TTS_VOICE`, `LANGUAGES` | Voice and language codes (English uses `en-IN`; change if your Timbre plan lacks it) |
| `OPENING_QUESTIONS` | Fixed first question so the interview starts instantly |
| `SESSION_TTL` | How long a session is kept in memory |

## Notes

- Sessions are stored in memory; restarting the server ends any interview in progress. To add history or accounts, extend the `Session` class with a database.
- If text-to-speech fails, the interview continues with text only.
- If the speech service rejects the audio, check `WAV_RATE` at the top of `static/app.js`.
