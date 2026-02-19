# PharmacoGenomics Risk Analyzer

AI-powered web app for analyzing VCF files and predicting pharmacogenomic risks.

## Features
- Parses VCF v4.2 files (up to 5 MB)
- Supports CYP2D6, CYP2C19, CYP2C9, SLCO1B1, TPMT, DPYD
- Drug support: Codeine, Warfarin, Clopidogrel, Simvastatin, Azathioprine, Fluorouracil
- Structured JSON output with clinical recommendations
- Optional Gemini API explanations via `GEMINI_API_KEY`

## Deploy Online

See [DEPLOY_NETLIFY.md](DEPLOY_NETLIFY.md) for simple 3-step deployment to Netlify.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.
