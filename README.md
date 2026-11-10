# VoiceCoach: Voice Interview Evaluation Engine

An AI mock interview platform that runs in the browser. Candidates answer spoken questions on their microphone and receive scores, voice analysis and coaching after every answer. Each new question adapts to their responses, resume and target company.

## Features

- **Adaptive interviews:** Gemini generates questions from the candidate's answers and adjusts type and difficulty as the interview progresses.
- **Personalization:** Run with or without a resume (PDF, DOCX or TXT), and target TCS, Infosys, Wipro, Accenture, Google, Amazon, Microsoft, any other company, or none.
- **Answer evaluation:** Scores language, grammar, communication, professionalism, behavior and confidence from 1 to 5, with grammar fixes and an improved answer.
- **Voice analysis:** Measures pace, filler words, pauses, volume steadiness and pitch variety.
- **Interactive UI:** Talking AI avatar, live waveform, radar and trend charts, score rings and keyboard shortcuts.
- **Final report:** Summarizes strengths, focus areas, practice tips and question-by-question results, and can be saved as a PDF.
- **Languages:** Interviews can be conducted in English or Hindi.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | Python, FastAPI, Uvicorn |
| Question generation and evaluation | Google Gemini |
| Speech-to-text and text-to-speech | Gnani Vachana (Prisma and Timbre) |
| Frontend | HTML, CSS, JavaScript, Web Audio API, Chart.js |

## Getting Started

**Prerequisites:** Python 3.10 or newer, a Gemini API key, a Gnani API key, and Chrome or Edge.

**Windows:** Double-click `run.bat`. It prompts for your API keys on first run, installs the dependencies and opens the app.

**Manual setup:**

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
cp .env.example .env             # Windows: copy .env.example .env
```

Add your keys to `.env`:

```env
GNANI_API_KEY=your_gnani_key_here
GEMINI_API_KEY=your_gemini_key_here
```

Start the server, then open http://localhost:8000 and allow microphone access:

```bash
cd backend
uvicorn app:app --port 8000
```

## How It Works

1. The browser records an answer of up to 30 seconds and measures its audio characteristics.
2. The server transcribes the recording and analyzes pace and filler words.
3. Gemini evaluates the answer and writes the next question.
4. The feedback and next question are converted to speech and returned to the browser.

## Project Structure

```text
├── run.bat                 One-click Windows launcher
├── .env.example            API key template
├── backend/
│   ├── app.py              API, interview logic and integrations
│   ├── requirements.txt    Python dependencies
│   └── static/             Frontend (HTML, CSS, JavaScript)
└── test/                   Service and pipeline test scripts
```

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/resume` | Extract text from a resume |
| `POST` | `/api/session/start` | Start an interview |
| `POST` | `/api/session/{id}/answer` | Submit and evaluate an answer |
| `GET` | `/api/session/{id}/report` | Get the final report |

## Notes

- Sessions are stored in memory and end when the server restarts.
- Microphone access requires `localhost` or HTTPS.
- Resume text and transcripts are sent to the Gemini API for processing, and recordings to the Gnani speech service.
- Voice metrics are estimates intended for practice feedback.
