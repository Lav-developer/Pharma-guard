# PharmacoGenomics Risk Analyzer

AI-powered web app for analyzing VCF files and predicting pharmacogenomic risks from VCF files and drug names.

## Live Demo
- Live project link: https://pharma-rift.netlify.app/
- Live demo link: https://pharma-rift.netlify.app/
- LinkedIn video link: https://demo.in

## Architecture Overview
- Frontend: Static HTML/CSS/JS served from Netlify.
- Backend: Netlify Function (/api/analyze) processes VCF + drug input.
- LLM: Gemini API generates clinical explanations when GEMINI_API_KEY is set.
- Data flow: User uploads VCF + drug list -> API parses variants -> risk engine builds JSON -> UI renders results.

## Tech Stack
- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js (Netlify Functions)
- Runtime libraries: Express (local dev), Multer (local dev), fetch
- Hosting: Netlify
- LLM: Google Gemini API

## Installation Instructions

### Local Development
npm install
npm start

Open http://localhost:3000

### Environment Variables
Set GEMINI_API_KEY to enable Gemini explanations.

Windows (PowerShell):
setx GEMINI_API_KEY "YOUR_KEY"

## API Docs

### POST /api/analyze
Description: Analyze a VCF file and drug list.

Form Data:
- vcf (file): VCF v4.2 file, max 5 MB
- drugs (string): Comma-separated drug names (e.g., CODEINE, WARFARIN)

Supported drugs: CODEINE, WARFARIN, CLOPIDOGREL, SIMVASTATIN, AZATHIOPRINE, FLUOROURACIL

Response: Array of JSON objects, one per drug, matching the required schema.

## Usage Examples

### Example Request (cURL)
curl -X POST https://pharma-rift.netlify.app/api/analyze -F "vcf=@sample.vcf" -F "drugs=CODEINE, WARFARIN"

### Example Response (truncated)
[
  {
    "patient_id": "PATIENT_001",
    "drug": "CODEINE",
    "timestamp": "2026-02-20T10:10:10.000Z",
    "risk_assessment": {
      "risk_label": "Adjust Dosage",
      "confidence_score": 0.7,
      "severity": "low"
    }
  }
]

## Team Members
- Lav Kush (Team Leader)
- Ankit Sehgal
- Sujeet Singh
- Aditya Upadhyay
