# Deployment Instructions

## Netlify (Recommended)

### Option A: GitHub + Netlify (Recommended)
1. Push the project to GitHub.
2. In Netlify: Add new site -> Import an existing project.
3. Select your GitHub repo.
4. Build settings (already defined in `netlify.toml`):
   - Build command: `npm install`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
   - Function bundler: `esbuild`
5. Click Deploy.

### Environment Variables (Gemini — optional)
1. Netlify dashboard -> Site settings -> Build & deploy -> Environment.
2. Add:
   - Key: `GEMINI_API_KEY` — enables AI-generated clinical explanations
   - Key: `GEMINI_MODEL` (optional) — overrides the default `gemini-2.5-flash`
3. Trigger a new deploy.

Without a key the app still works: the engine returns rule-based
explanations instead of LLM narratives.

### API Endpoint
- `POST https://<your-site>.netlify.app/api/analyze`
- Form fields: `vcf` (file), `drugs` (comma-separated string)

---

## Local Deployment (Optional)

### Run Locally
```bash
npm install
npm start
```
Open `http://localhost:3000`.

### Set Gemini API Key (Optional)
Windows PowerShell:
```powershell
setx GEMINI_API_KEY "YOUR_KEY"
```
Restart terminal after setting.

### Run Tests
```bash
npm test
```

## Project Structure
```
public/                  Frontend (served as-is)
  index.html             Single-page UI
  app.js                 Frontend logic (XSS-safe rendering)
  styles.css             Design system (light/dark, responsive)
  sample.vcf             Demo file for the "Use sample data" button
shared/engine.js         Shared analysis engine (parser + risk logic)
server.js                Local Express server
netlify/functions/analyze.js  Netlify Function (same engine)
test/engine.test.js      Node test suite (npm test)
```
