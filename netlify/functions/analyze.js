const SUPPORTED_DRUGS = [
  "CODEINE",
  "WARFARIN",
  "CLOPIDOGREL",
  "SIMVASTATIN",
  "AZATHIOPRINE",
  "FLUOROURACIL"
];

const TARGET_GENES = [
  "CYP2D6",
  "CYP2C19",
  "CYP2C9",
  "SLCO1B1",
  "TPMT",
  "DPYD"
];

function parseVcf(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  let headerColumns = null;
  const geneVariants = new Map();
  let variantsFound = 0;

  for (const gene of TARGET_GENES) {
    geneVariants.set(gene, []);
  }

  for (const line of lines) {
    if (line.startsWith("##")) {
      continue;
    }
    if (line.startsWith("#CHROM")) {
      headerColumns = line.split("\t");
      continue;
    }
    const cols = line.split("\t");
    if (cols.length < 8) {
      continue;
    }
    const [chrom, pos, id, ref, alt, qual, filter, info] = cols;
    const infoMap = parseInfo(info);
    const gene = (infoMap.GENE || "").toUpperCase();
    if (!gene || !geneVariants.has(gene)) {
      continue;
    }
    const rsid = (infoMap.RS || id || "").trim();
    const star = String(infoMap.STAR || "").trim();

    geneVariants.get(gene).push({
      rsid,
      gene,
      star,
      chrom,
      pos,
      ref,
      alt
    });
    variantsFound += 1;
  }

  if (!headerColumns) {
    return {
      success: false,
      error: "Invalid VCF: missing #CHROM header."
    };
  }

  const patientId = headerColumns[9] || "PATIENT_XXX";

  return {
    success: true,
    patientId,
    geneVariants,
    variantsFound
  };
}

function parseInfo(info) {
  const map = {};
  if (!info) return map;
  const items = info.split(";");
  for (const item of items) {
    if (!item) continue;
    const [key, value] = item.split("=");
    map[key] = value ?? true;
  }
  return map;
}

function drugToGene(drug) {
  switch (drug) {
    case "CODEINE":
      return "CYP2D6";
    case "WARFARIN":
      return "CYP2C9";
    case "CLOPIDOGREL":
      return "CYP2C19";
    case "SIMVASTATIN":
      return "SLCO1B1";
    case "AZATHIOPRINE":
      return "TPMT";
    case "FLUOROURACIL":
      return "DPYD";
    default:
      return "UNKNOWN";
  }
}

function inferDiplotype(gene, variants) {
  let diplotype = "*X/*Y";
  const detectedVariants = [];
  const stars = [];

  for (const variant of variants) {
    detectedVariants.push({
      rsid: variant.rsid || "",
      gene: variant.gene,
      star: variant.star || "",
      chrom: variant.chrom,
      pos: variant.pos,
      ref: variant.ref,
      alt: variant.alt
    });

    if (variant.star) {
      const starTokens = variant.star
        .replace(/^\w+/, "")
        .split(/[,/\s]+/)
        .filter(Boolean);
      stars.push(...starTokens);

      if (variant.star.includes("/")) {
        diplotype = variant.star.replace(/^\w+/, "");
      }
    }
  }

  const phenotype = inferPhenotype(gene, stars);

  return {
    diplotype,
    phenotype,
    detectedVariants
  };
}

function inferPhenotype(gene, stars) {
  const starSet = new Set(stars.map((s) => s.replace(/[^*0-9xN]/gi, "")));

  const hasAny = (list) => list.some((s) => starSet.has(s));

  if (gene === "CYP2D6") {
    if (hasAny(["*3", "*4", "*5", "*6"])) return "PM";
    if (hasAny(["*10", "*41"])) return "IM";
    if (hasAny(["*1xN", "*2xN", "*dup"])) return "URM";
    if (starSet.size > 0) return "NM";
    return "Unknown";
  }

  if (gene === "CYP2C19") {
    if (hasAny(["*2", "*3"])) return "PM";
    if (hasAny(["*17"])) return "RM";
    if (starSet.size > 0) return "NM";
    return "Unknown";
  }

  if (gene === "CYP2C9") {
    if (hasAny(["*2", "*3"]) && starSet.size > 1) return "PM";
    if (hasAny(["*2", "*3"])) return "IM";
    if (starSet.size > 0) return "NM";
    return "Unknown";
  }

  if (gene === "SLCO1B1") {
    if (hasAny(["*5", "*15"]) && starSet.size > 1) return "PM";
    if (hasAny(["*5", "*15"])) return "IM";
    if (starSet.size > 0) return "NM";
    return "Unknown";
  }

  if (gene === "TPMT") {
    if (hasAny(["*2", "*3A", "*3C"]) && starSet.size > 1) return "PM";
    if (hasAny(["*2", "*3A", "*3C"])) return "IM";
    if (starSet.size > 0) return "NM";
    return "Unknown";
  }

  if (gene === "DPYD") {
    if (hasAny(["*2A", "*13", "*9A"]) && starSet.size > 1) return "PM";
    if (hasAny(["*2A", "*13", "*9A"])) return "IM";
    if (starSet.size > 0) return "NM";
    return "Unknown";
  }

  return "Unknown";
}

function assessRisk(drug, gene, phenotype, detectedVariants) {
  let riskLabel = "Unknown";
  let severity = "none";
  let confidence = 0.4;

  const hasVariants = detectedVariants.length > 0;
  if (hasVariants) confidence = 0.7;

  if (drug === "CODEINE") {
    if (phenotype === "PM") {
      riskLabel = "Ineffective";
      severity = "moderate";
    } else if (phenotype === "IM") {
      riskLabel = "Adjust Dosage";
      severity = "low";
    } else if (phenotype === "URM") {
      riskLabel = "Toxic";
      severity = "high";
    } else if (phenotype === "NM") {
      riskLabel = "Safe";
      severity = "none";
    }
  }

  if (drug === "CLOPIDOGREL") {
    if (phenotype === "PM") {
      riskLabel = "Ineffective";
      severity = "high";
    } else if (phenotype === "RM") {
      riskLabel = "Safe";
      severity = "none";
    } else if (phenotype === "NM") {
      riskLabel = "Safe";
      severity = "none";
    } else if (phenotype === "IM") {
      riskLabel = "Adjust Dosage";
      severity = "moderate";
    }
  }

  if (drug === "WARFARIN") {
    if (phenotype === "IM") {
      riskLabel = "Adjust Dosage";
      severity = "moderate";
    } else if (phenotype === "PM") {
      riskLabel = "Toxic";
      severity = "high";
    } else if (phenotype === "NM") {
      riskLabel = "Safe";
      severity = "none";
    }
  }

  if (drug === "SIMVASTATIN") {
    if (phenotype === "IM") {
      riskLabel = "Adjust Dosage";
      severity = "moderate";
    } else if (phenotype === "PM") {
      riskLabel = "Toxic";
      severity = "high";
    } else if (phenotype === "NM") {
      riskLabel = "Safe";
      severity = "none";
    }
  }

  if (drug === "AZATHIOPRINE") {
    if (phenotype === "IM") {
      riskLabel = "Adjust Dosage";
      severity = "moderate";
    } else if (phenotype === "PM") {
      riskLabel = "Toxic";
      severity = "critical";
    } else if (phenotype === "NM") {
      riskLabel = "Safe";
      severity = "none";
    }
  }

  if (drug === "FLUOROURACIL") {
    if (phenotype === "IM") {
      riskLabel = "Adjust Dosage";
      severity = "high";
    } else if (phenotype === "PM") {
      riskLabel = "Toxic";
      severity = "critical";
    } else if (phenotype === "NM") {
      riskLabel = "Safe";
      severity = "none";
    }
  }

  return {
    risk_label: riskLabel,
    confidence_score: confidence,
    severity
  };
}

function buildRecommendation(drug, gene, phenotype, risk) {
  let recommendation = "Use standard dosing.";
  let guidance = "CPIC guidelines";

  if (risk.risk_label === "Adjust Dosage") {
    recommendation =
      "Consider dose adjustment or an alternative agent based on phenotype.";
  }
  if (risk.risk_label === "Toxic") {
    recommendation = "Avoid this drug or use a substantially reduced dose.";
  }
  if (risk.risk_label === "Ineffective") {
    recommendation = "Consider alternative therapy due to reduced efficacy.";
  }

  return {
    primary_gene: gene,
    phenotype,
    recommendation,
    guideline: guidance
  };
}

function buildResult({ patientId, drug, geneVariants, variantsFound }) {
  const gene = drugToGene(drug);
  const variants = geneVariants.get(gene) || [];
  const { diplotype, phenotype, detectedVariants } = inferDiplotype(
    gene,
    variants
  );
  const risk = assessRisk(drug, gene, phenotype, detectedVariants);
  const recommendation = buildRecommendation(drug, gene, phenotype, risk);

  return {
    patient_id: patientId,
    drug,
    timestamp: new Date().toISOString(),
    risk_assessment: risk,
    pharmacogenomic_profile: {
      primary_gene: gene,
      diplotype,
      phenotype,
      detected_variants: detectedVariants
    },
    clinical_recommendation: recommendation,
    llm_generated_explanation: {
      summary: "",
      mechanism: "",
      evidence: "",
      citations: []
    },
    quality_metrics: {
      vcf_parsing_success: true,
      variants_found: variantsFound,
      gene_variants_found: detectedVariants.length,
      genes_covered: Array.from(geneVariants.keys()).filter(
        (g) => geneVariants.get(g).length > 0
      )
    }
  };
}

async function generateExplanation(result) {
  const apiKey = process.env.GEMINI_API_KEY;
  const variants = result.pharmacogenomic_profile.detected_variants || [];
  const citations = variants.map((v) => v.rsid).filter(Boolean);

  if (!apiKey) {
    return {
      summary:
        "Genotype-driven risk assessment generated using pharmacogenomic heuristics.",
      mechanism:
        "Variant alleles in drug metabolism genes may alter enzyme activity, leading to changes in drug exposure.",
      evidence:
        "Explanation generated without external LLM calls. Provide GEMINI_API_KEY for enriched narrative.",
      citations
    };
  }

  const prompt = {
    role: "user",
    parts: [
      {
        text:
          "Generate a concise clinical explanation for this pharmacogenomic result. " +
          "Cite variants by rsID when available. Mention gene, phenotype, and drug. " +
          "Use plain language and keep to 4-6 sentences.\n\n" +
          JSON.stringify(result, null, 2)
      }
    ]
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [prompt],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 350
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error("Gemini API error");
    }

    const data = await response.json();
    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No explanation returned.";

    return {
      summary: text.trim(),
      mechanism:
        "Variant alleles may alter enzyme function and drug activation or clearance.",
      evidence: "Generated with Gemini API.",
      citations
    };
  } catch (error) {
    return {
      summary:
        "LLM explanation unavailable due to an API error. Showing fallback summary.",
      mechanism:
        "Variant alleles in drug metabolism genes may alter enzyme activity.",
      evidence: "Gemini API call failed.",
      citations
    };
  }
}

exports.handler = async (event, context) => {
  // Handle CORS
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    // Parse form data
    const body = event.body;
    const isBase64 = event.isBase64Encoded;
    const bodyBuffer = isBase64 ? Buffer.from(body, "base64") : Buffer.from(body);
    const bodyStr = bodyBuffer.toString("utf8");

    // Simple multipart parser
    const boundary = bodyStr.split("\r\n")[0];
    const parts = bodyStr.split(boundary);

    let vcfContent = "";
    let drugs = "";

    for (const part of parts) {
      if (part.includes('name="vcf"')) {
        const match = part.match(/\r\n\r\n([\s\S]*?)\r\n/);
        if (match) vcfContent = match[1];
      }
      if (part.includes('name="drugs"')) {
        const match = part.match(/\r\n\r\n([\s\S]*?)\r\n/);
        if (match) drugs = match[1];
      }
    }

    if (!vcfContent) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "VCF file is required." })
      };
    }

    if (!drugs) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Drug name is required." })
      };
    }

    const requestedDrugs = drugs
      .split(",")
      .map((d) => d.trim().toUpperCase())
      .filter(Boolean);

    const invalidDrugs = requestedDrugs.filter(
      (d) => !SUPPORTED_DRUGS.includes(d)
    );

    if (invalidDrugs.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: `Unsupported drug(s): ${invalidDrugs.join(", ")}.`
        })
      };
    }

    const parseResult = parseVcf(vcfContent);
    if (!parseResult.success) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: parseResult.error })
      };
    }

    const { patientId, geneVariants, variantsFound } = parseResult;

    const analysisResults = [];
    for (const drug of requestedDrugs) {
      const result = buildResult({
        patientId,
        drug,
        geneVariants,
        variantsFound
      });
      const llm = await generateExplanation(result);
      result.llm_generated_explanation = llm;
      analysisResults.push(result);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(analysisResults)
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Unexpected server error." })
    };
  }
};
