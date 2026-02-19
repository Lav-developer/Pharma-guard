# Deployment Instructions

## Netlify (Recommended)

### Option A: GitHub + Netlify (Recommended)
1. Push the project to GitHub.
2. In Netlify: Add new site -> Import an existing project.
3. Select your GitHub repo.
4. Build settings:
   - Build command: `npm install`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
5. Click Deploy.

### Environment Variables (Gemini)
1. Netlify dashboard -> Site settings -> Build & deploy -> Environment.
2. Add:
   - Key: `GEMINI_API_KEY`
   - Value: your Gemini API key
3. Trigger a new deploy.

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
