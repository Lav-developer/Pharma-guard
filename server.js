import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseVcf,
  buildResult,
  generateExplanation,
  validateDrugs,
  SUPPORTED_DRUGS
} from "./shared/engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */

// Note: X-Frame-Options is intentionally NOT set here so the app can be
// embedded in sandboxed preview iframes during development. The Netlify
// production config (netlify.toml) applies DENY for the deployed site.
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  });
  next();
});

// Minimal CORS for the API so the frontend can be hosted elsewhere too.
app.use("/api", (req, res, next) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Simple request log for local development.
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`
    );
  });
  next();
});

app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "pharma-guard",
    supported_drugs: SUPPORTED_DRUGS,
    llm: Boolean(process.env.GEMINI_API_KEY) ? "configured" : "fallback"
  });
});

app.post("/api/analyze", (req, res) => {
  upload.single("vcf")(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res
          .status(400)
          .json({ error: "File size exceeds the 5 MB limit." });
      }
      console.error("Upload error:", err);
      return res.status(400).json({ error: "Upload failed. Please try again." });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: "VCF file is required." });
      }

      const drugsInput = String(req.body.drugs || "").trim();
      const drugError = validateDrugs(drugsInput);
      if (drugError) {
        return res.status(400).json({ error: drugError });
      }

      const vcfText = req.file.buffer.toString("utf8");
      const parseResult = parseVcf(vcfText);
      if (!parseResult.success) {
        return res.status(400).json({ error: parseResult.error });
      }

      const { patientId, geneVariants, variantsFound, variantsScanned, gtAvailable } =
        parseResult;

      const requestedDrugs = drugsInput
        .split(",")
        .map((d) => d.trim().toUpperCase())
        .filter(Boolean);

      const analysisResults = [];
      for (const drug of requestedDrugs) {
        const result = buildResult({
          patientId,
          drug,
          geneVariants,
          variantsFound,
          variantsScanned,
          gtAvailable
        });
        result.llm_generated_explanation = await generateExplanation(result);
        analysisResults.push(result);
      }

      res.json(analysisResults);
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: "Unexpected server error." });
    }
  });
});

// JSON 404 for unknown API routes.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`PharmaGuard running on http://localhost:${port}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log(
      "Tip: set GEMINI_API_KEY (and optionally GEMINI_MODEL) to enable LLM narratives."
    );
  }
});
