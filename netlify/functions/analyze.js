/**
 * PharmaGuard Netlify Function — POST /api/analyze
 *
 * Accepts multipart/form-data: `vcf` (file, <= 5 MB) and `drugs`
 * (comma-separated names). Bundled with the shared engine via esbuild.
 */
import {
  parseVcf,
  parseMultipartBody,
  buildResult,
  generateExplanation,
  validateDrugs
} from "../../shared/engine.js";

const MAX_BODY_BYTES = 6 * 1024 * 1024; // 5 MB file + multipart overhead

export async function handler(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const raw = event.body || "";
    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(raw, "base64")
      : Buffer.from(raw);

    if (bodyBuffer.length > MAX_BODY_BYTES) {
      return {
        statusCode: 413,
        headers,
        body: JSON.stringify({ error: "File size exceeds the 5 MB limit." })
      };
    }

    let fields;
    try {
      fields = parseMultipartBody(bodyBuffer);
    } catch (parseError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Expected multipart/form-data body." })
      };
    }

    const vcfPart = fields.vcf;
    if (!vcfPart || !vcfPart.content) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "VCF file is required." })
      };
    }

    const drugsInput = String(fields.drugs || "").trim();
    const drugError = validateDrugs(drugsInput);
    if (drugError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: drugError })
      };
    }

    const parseResult = parseVcf(vcfPart.content);
    if (!parseResult.success) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: parseResult.error })
      };
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(analysisResults)
    };
  } catch (error) {
    console.error("Analysis error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Unexpected server error." })
    };
  }
};
