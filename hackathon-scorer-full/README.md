# Hackathon Scorer (Devpost + PDF Rubric → Gemini)

A tiny full‑stack app that:
1) Scrapes a Devpost gallery to get all project links
2) Parses your rubric PDF with Gemini into `{ name, weight }` criteria
3) Fetches each project page and asks Gemini to score it against the rubric
4) Returns a ranked scoreboard with per‑criterion breakdown

## Quick start

```bash
# 1) Unzip and go to the backend folder
cd backend

# 2) Install deps
npm install

# 3) Set your Gemini key
cp .env.sample .env
# edit .env and paste GEMINI_API_KEY

# 4) Run the server (serves API and the static frontend)
npm run dev
# Backend runs on http://localhost:5175 and serves the frontend from ../frontend

# 5) Open the app
# In your browser go to:
http://localhost:5175/
```

## Frontend dev
The frontend is pure HTML/CSS/JS in `frontend/`. No build tools needed.

## Notes & caveats
- **CORS**: We scrape Devpost server‑side to avoid browser CORS blocks.
- **Parsing**: Devpost HTML varies by event; the scraper uses broad selectors but may need tweaks.
- **Costs/time**: Scoring calls Gemini once **per project** (and once for rubric parsing). For big galleries, costs can add up—test with a small subset first.
- **Security**: The API key lives in the backend `.env` and is **never exposed** to the browser.
- **Weights**: We assume rubric weights sum to ~1. If not, Gemini normalizes in `/api/parse-rubric` based on instructions.
- **Refresh on reload**: The app re‑scrapes and re‑scores automatically if the toggle is on (default).

## File structure
```
backend/
  index.js            # Express API
  package.json
  .env.sample
frontend/
  index.html
  style.css
  app.js
```

## License
MIT
