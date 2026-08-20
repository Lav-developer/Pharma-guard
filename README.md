# PharmaGuard

AI-powered web app for analyzing VCF files and predicting pharmacogenomic risks from VCF files and drug names.

## Live Demo
- Live project link: https://pharma-rift.netlify.app/
- LinkedIn video link: https://www.linkedin.com/posts/lavkush-iet_rift2026-pharmaguard-pharmacogenomics-ugcPost-7430392205149687808-lH5O?utm_source=share&utm_medium=member_desktop&rcm=ACoAAFKCXzUB2s9ddr85YgZdMHgJ7Di3y-JvFFE

## Architecture Overview
- **Frontend:** Static HTML/CSS/JS served from `public/` (Netlify or the local Express server).
- **Backend:** `POST /api/analyze` — runs on the local Express server (`server.js`) or as a Netlify Function (`netlify/functions/analyze.js`).
- **Shared engine:** `shared/engine.js` contains all parsing, genotype-aware star-allele inference, phenotype and risk logic — used by *both* backends so behaviour is identical everywhere.
- **LLM:** Gemini API (default model `gemini-2.5-flash`, override with `GEMINI_MODEL`) generates clinical narratives when `GEMINI_API_KEY` is set; a rule-based explanation is used otherwise.
- **Data flow:** User uploads VCF + drug list → API parses variants (respecting FORMAT/GT genotypes) → risk engine builds the JSON report → UI renders results with export options.

## Tech Stack
- Frontend: HTML, CSS, Vanilla JavaScript (no build step)
- Backend: Node.js (Express for local dev, Netlify Functions for hosting)
- Runtime libraries: Express, Multer (local dev only)
- Hosting: Netlify
- LLM: Google Gemini API

## Installation Instructions

### Local Development
```bash
npm install
npm start
```

Open http://localhost:3000 — or use `npm run dev` for auto-restart.

### Environment Variables
Set `GEMINI_API_KEY` to enable Gemini explanations (optional — the app falls back to rule-based narratives).

```bash
# Linux / macOS
export GEMINI_API_KEY="YOUR_KEY"

# Windows (PowerShell)
setx GEMINI_API_KEY "YOUR_KEY"
```

Optional: `GEMINI_MODEL` overrides the default model (`gemini-2.5-flash`). If the configured model fails, the engine automatically retries with `gemini-2.5-flash` and `gemini-3.7-flash`.

### Tests
```bash
npm test
```
Runs the full test suite (VCF parsing incl. genotype-awareness, star-allele inference, risk assessment, multipart parsing).

## API Docs

### `POST /api/analyze`
Analyzes a VCF file and a drug list.

**Form data:**
- `vcf` (file) — VCF v4.2 file, max 5 MB
- `drugs` (string) — comma-separated drug names (e.g. `CODEINE, WARFARIN`)

**Supported drugs:** CODEINE, WARFARIN, CLOPIDOGREL, SIMVASTATIN, AZATHIOPRINE, FLUOROURACIL

**Response:** JSON array, one object per drug:

```json
[
  {
    "patient_id": "PATIENT_001",
    "drug": "CODEINE",
    "timestamp": "2026-08-18T10:10:10.000Z",
    "risk_assessment": {
      "risk_label": "Adjust Dosage",
      "confidence_score": 0.85,
      "severity": "low"
    },
    "pharmacogenomic_profile": {
      "primary_gene": "CYP2D6",
      "diplotype": "*4/*1",
      "alleles": ["*4"],
      "phenotype": "IM",
      "phenotype_label": "Intermediate metabolizer",
      "detected_variants": [
        {
          "rsid": "rs3892097",
          "gene": "CYP2D6",
          "star": "*4",
          "chrom": "chr22",
          "pos": "42128945",
          "ref": "C",
          "alt": "T",
          "genotype": "heterozygous"
        }
      ]
    },
    "clinical_recommendation": {
      "primary_gene": "CYP2D6",
      "phenotype": "IM",
      "recommendation": "Consider an alternative analgesic…",
      "guideline": "CPIC Guideline"
    },
    "llm_generated_explanation": {
      "summary": "…",
      "mechanism": "…",
      "evidence": "…",
      "citations": ["rs3892097"]
    },
    "quality_metrics": {
      "vcf_parsing_success": true,
      "variants_found": 2,
      "gene_variants_found": 1,
      "genes_covered": ["CYP2D6", "CYP2C9"],
      "gt_available": true
    }
  }
]
```

### `GET /api/health`
Returns service status and supported drugs.

## Usage Example (cURL)

```bash
curl -X POST http://localhost:3000/api/analyze \
  -F "vcf=@sample_patient_data.vcf" \
  -F "drugs=CODEINE, WARFARIN"
```

## Sample Data
- `sample_patient_data.vcf` — simple VCF without genotype columns.
- `TC_P1_PATIENT_001_Normal.vcf` — genotype-aware VCF (FORMAT/GT); variants called `0/0` are correctly ignored.
- `public/sample.vcf` — demo file used by the "Use sample data" button in the UI.

## How the risk engine works
1. **Parse** — reads `#CHROM` headers, INFO fields (`GENE`, `RS`, `STAR`) and, when present, the sample `GT` genotype. A variant with genotype `0/0` (homozygous reference) is *not* counted as detected.
2. **Star alleles** — normalised, deduplicated (multiple markers for one allele count once) and combined into a diplotype (`*1/*2`, `*4/*1`, …). Zygosity is respected: a single heterozygous `*4` becomes `*4/*1`.
3. **Phenotype** — activity-score based: NF = 0, DF = 0.5, NM = 1, IF = 1 (RM flag), duplication → URM. Scores map to URM/RM/NM/IM/PM.
4. **Risk** — drug-specific risk label + severity + confidence, CPIC-informed.
5. **Explain** — Gemini narrative when configured, rule-based narrative otherwise.

## Team Members
- Lav Kush (Team Leader)
- Ankit Sehgal
- Sujeet Singh
- Aditya Upadhyay
