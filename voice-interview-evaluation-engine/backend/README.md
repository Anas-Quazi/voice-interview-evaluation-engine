# VoiceCoach - Interview Evaluation Engine

A voice mock interview in the browser. An AI interviewer asks a question out loud, you answer on your microphone, and you get scores, charts, voice analysis, grammar fixes and a stronger version of your answer. Gemini writes each next question from your answers, your resume and the company you chose.

## Run it on Windows

Double-click `run.bat` in the project folder. The first time, it asks for your two API keys, installs everything and opens http://localhost:8000.

## Run it by hand (Windows, Mac or Linux)

You need Python 3.10 or newer. From the project folder:

```
python -m venv .venv
.venv\Scripts\activate          (Mac or Linux: source .venv/bin/activate)
pip install -r backend/requirements.txt
copy .env.example .env          (Mac or Linux: cp .env.example .env)
```

Put your `GNANI_API_KEY` and `GEMINI_API_KEY` in `.env`, then:

```
cd backend
uvicorn app:app --port 8000
```

Open http://localhost:8000 in Chrome or Edge and allow the microphone. The microphone only works on `localhost` or `https`.

## Check that it works

1. On the setup page, enter a role and pick With resume or Without resume, and a company or None.
2. Press Start interview. The avatar should speak the first question and its mouth should move.
3. Press Space or the orb and speak. The waveform and orb should react to your voice. Press Space again to stop.
4. Press Enter to send. You should see score rings, the radar chart, voice analysis and the next question's type and difficulty.
5. Press F or finish all questions to see the report charts. An answer averaging 4 or more sets off confetti.

## Keyboard shortcuts

Space records or stops. Enter sends or moves on. R records again. P replays the coach. F finishes. ? shows the list.

## How it fits together

```
run.bat            one-click start on Windows
backend/app.py     sessions, resume reading, company styles, voice analysis, Prisma, Gemini, Timbre, report
backend/static/    index.html (screens), style.css (theme), ui.js (avatar, waveform, charts), app.js (interview flow)
```

- `POST /api/resume` reads a PDF, DOCX or TXT and returns its text.
- `POST /api/session/start` creates a session and returns the first question.
- `POST /api/session/{id}/answer` takes the recording and browser voice measurements, and returns feedback and the next question.
- `GET /api/session/{id}/report` returns the final report.

## Good to know

- Add or change companies in `COMPANIES` at the top of `app.py`. Their styles are general guidance, not real question banks.
- Voice figures are estimates. Pauses, steadiness and pitch come from the recording, while pace and filler words come from the transcript. Speech-to-text may clean up some fillers.
- Sessions live in memory, so restarting the server ends any interview in progress.
- If Gemini says it is busy, press Try again. The recording is kept.
- Charts load Chart.js from a CDN, so the browser needs internet access, as the speech and Gemini services do.
