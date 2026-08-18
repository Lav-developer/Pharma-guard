/**
 * PharmaGuard — shared pharmacogenomics analysis engine.
 *
 * Pure JavaScript, no dependencies, so it runs identically in:
 *   - the local Express server (server.js)
 *   - the Netlify function (netlify/functions/analyze.js)
 *   - the Node test-suite (test/engine.test.js)
 */

export const SUPPORTED_DRUGS = [
  "CODEINE",
  "WARFARIN",
  "CLOPIDOGREL",
  "SIMVASTATIN",
  "AZATHIOPRINE",
  "FLUOROURACIL"
];

export const TARGET_GENES = [
  "CYP2D6",
  "CYP2C19",
  "CYP2C9",
  "SLCO1B1",
  "TPMT",
  "DPYD"
];

/** Max number of drugs accepted per request. */
export const MAX_DRUGS_PER_REQUEST = 10;

/** Per-gene star-allele function classifications (CPIC-informed). */
const GENE_ALLELES = {
  CYP2D6: {
    NF: ["*3", "*4", "*5", "*6"],
    DF: ["*9", "*10", "*17", "*29", "*41"],
    IF: ["*1xN", "*2xN", "*dup"]
  },
  CYP2C19: {
    NF: ["*2", "*3", "*4", "*5", "*6", "*7", "*8"],
    DF: [],
    IF: ["*17"]
  },
  CYP2C9: {
    NF: [],
    DF: ["*2", "*3", "*5", "*6", "*8", "*11"],
    IF: []
  },
  SLCO1B1: {
    NF: [],
    DF: ["*5", "*15", "*17"],
    IF: []
  },
  TPMT: {
    NF: ["*2", "*3A", "*3B", "*3C", "*4"],
    DF: [],
    IF: []
  },
  DPYD: {
    NF: ["*2A", "*13"],
    DF: ["*6", "*9A"],
    IF: []
  }
};

/** Human-readable descriptions for phenotypes. */
export const PHENOTYPE_LABELS = {
  URM: "Ultrarapid metabolizer",
  RM: "Rapid metabolizer",
  NM: "Normal metabolizer",
  IM: "Intermediate metabolizer",
  PM: "Poor metabolizer",
  Unknown: "Not determined"
};

const DRUG_MECHANISMS = {
  CODEINE:
    "CYP2D6 activates codeine into morphine, the metabolite responsible for analgesia. Reduced enzyme activity lowers analgesic effect, while gene duplications raise toxicity risk.",
  WARFARIN:
    "CYP2C9 clears the more potent S-warfarin enantiomer. Reduced activity increases warfarin exposure and bleeding risk, so lower starting doses are recommended.",
  CLOPIDOGREL:
    "CYP2C19 converts clopidogrel into its active antiplatelet metabolite. Reduced activity leads to diminished platelet inhibition and a higher risk of stent thrombosis.",
  SIMVASTATIN:
    "SLCO1B1 transports simvastatin acid into the liver. Reduced transporter function raises systemic drug exposure and the risk of statin-induced myopathy.",
  AZATHIOPRINE:
    "TPMT inactivates azathioprine's active metabolites. Low TPMT activity leads to accumulation of thioguanine nucleotides and severe, potentially life-threatening myelotoxicity.",
  FLUOROURACIL:
    "DPYD catabolises >80% of fluorouracil. Reduced DPYD activity causes drug accumulation and severe, sometimes fatal, toxicity."
};

/**
 * Parse the VCF text into per-gene variant lists.
 *
 * Genotype-aware: when the file has FORMAT/GT columns, variants whose sample
 * genotype is 0/0 (or 0|0, ./. etc.) are NOT counted as present, because the
 * patient does not carry the alternate allele.
 *
 * @returns {{success: boolean, error?: string, patientId?: string,
 *   geneVariants?: Map<string, Array>, variantsFound?: number,
 *   variantsScanned?: number, gtAvailable?: boolean, sampleName?: string}}
 */
export function parseVcf(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  let headerColumns = null;
  const geneVariants = new Map();
  let variantsScanned = 0;
  let variantsFound = 0;
  let gtAvailable = false;

  for (const gene of TARGET_GENES) {
    geneVariants.set(gene, []);
  }

  for (const line of lines) {
    if (line.startsWith("##")) continue;
    if (line.startsWith("#CHROM")) {
      headerColumns = line.split("\t");
      gtAvailable =
        headerColumns.length >= 10 && headerColumns[8] === "FORMAT";
      continue;
    }

    const cols = line.split("\t");
    if (cols.length < 8) continue;

    const [chrom, pos, id, ref, alt, qual, filter, info] = cols;
    const infoMap = parseInfo(info);
    const gene = String(infoMap.GENE || "").toUpperCase();

    if (!gene || !geneVariants.has(gene)) continue;

    variantsScanned += 1;
    const rsid = String(infoMap.RS || id || "").trim();
    const star = String(infoMap.STAR || "").trim();

    // Genotype-aware detection (optional FORMAT/GT columns).
    let genotype = "unknown";
    let present = true;
    if (gtAvailable && cols.length >= 10 && cols[9]) {
      const formatFields = cols[8].split(":");
      const gtIdx = formatFields.indexOf("GT");
      const sample = cols[9];
      if (gtIdx !== -1 && sample) {
        const gt = sample.split(":")[gtIdx] || "";
        const alleleTokens = gt.split(/[/|]/).map((t) => t.trim());
        const altCount = alleleTokens.filter(
          (t) => t && t !== "0" && t !== "."
        ).length;
        present = altCount > 0;
        if (present) {
          genotype = altCount >= 2 ? "homozygous" : "heterozygous";
        }
      }
    }

    if (!present) continue;

    geneVariants.get(gene).push({
      rsid,
      gene,
      star,
      chrom,
      pos,
      ref,
      alt,
      genotype
    });
    variantsFound += 1;
  }

  if (!headerColumns) {
    return {
      success: false,
      error: "Invalid VCF: missing #CHROM header."
    };
  }

  const formatIdx = headerColumns.indexOf("FORMAT");
  let patientId = "PATIENT_XXX";
  if (formatIdx !== -1 && headerColumns[formatIdx + 1]) {
    patientId = headerColumns[formatIdx + 1];
  } else if (headerColumns[9]) {
    patientId = headerColumns[9];
  }

  return {
    success: true,
    patientId,
    geneVariants,
    variantsFound,
    variantsScanned,
    gtAvailable,
    sampleName: patientId
  };
}

export function parseInfo(info) {
  const map = {};
  if (!info) return map;
  const items = String(info).split(";");
  for (const item of items) {
    if (!item) continue;
    const eq = item.indexOf("=");
    if (eq === -1) {
      map[item] = true;
    } else {
      map[item.slice(0, eq)] = item.slice(eq + 1);
    }
  }
  return map;
}

export function drugToGene(drug) {
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

/** Normalise a star-allele token: strip gene prefix, uppercase. */
export function normalizeStar(raw) {
  if (!raw) return "";
  let token = String(raw).trim().toUpperCase();
  // Strip a leading gene name, e.g. "CYP2D6*4" -> "*4", "CYP2D6*1/*4" -> "*1/*4"
  token = token.replace(/^[A-Z][A-Z0-9]*\*/, "*");
  return token;
}

/** Extract the list of star-allele tokens from a STAR field value. */
export function extractStarTokens(starField) {
  if (!starField) return [];
  const normalized = normalizeStar(starField);
  return normalized
    .split(/[/,\s]+/)
    .map((t) => t.trim())
    .filter((t) => /^\*/.test(t));
}

/** Sort star alleles by numeric star number then alphabetically. */
export function sortStarAlleles(alleles) {
  const num = (a) => {
    const m = String(a).match(/\*(\d+)/);
    return m ? parseInt(m[1], 10) : 9999;
  };
  return [...alleles].sort((a, b) => num(a) - num(b) || a.localeCompare(b));
}

/**
 * Infer the diplotype, allele list and phenotype for one gene.
 *
 * Zygosity-aware: a single non-*1 allele with a heterozygous genotype is
 * assumed to pair with a wild-type (*1) allele; homozygous genotypes produce
 * a homozygous diplotype. Star-allele markers are deduplicated so multiple
 * variants defining the same allele (e.g. three CYP2D6 *4 markers) count once.
 */
export function inferProfile(gene, variants) {
  const alleleSet = new Set();
  const genotypeByAllele = new Map(); // allele -> "homozygous" | "heterozygous"
  let phasedDiplotype = "";

  for (const variant of variants) {
    const tokens = extractStarTokens(variant.star);
    if (variant.star && String(variant.star).includes("/")) {
      const phased = normalizeStar(variant.star);
      if (/^\*[^*]+\/\*[^*]+$/.test(phased)) phasedDiplotype = phased;
    }
    for (const token of tokens) {
      alleleSet.add(token);
      const existing = genotypeByAllele.get(token);
      if (variant.genotype === "homozygous") {
        genotypeByAllele.set(token, "homozygous");
      } else if (variant.genotype === "heterozygous" && existing !== "homozygous") {
        genotypeByAllele.set(token, "heterozygous");
      }
    }
  }

  const alleles = sortStarAlleles(alleleSet);
  let diplotype = "Unknown";
  let effectiveAlleles = [];

  if (phasedDiplotype) {
    diplotype = phasedDiplotype;
    effectiveAlleles = phasedDiplotype.split("/");
  } else if (alleles.length >= 2) {
    diplotype = alleles.join("/");
    effectiveAlleles = alleles;
  } else if (alleles.length === 1) {
    const a = alleles[0];
    if (genotypeByAllele.get(a) === "homozygous") {
      diplotype = `${a}/${a}`;
      effectiveAlleles = [a, a];
    } else {
      // Single heterozygous allele -> assume it pairs with wild type.
      diplotype = `${a}/*1`;
      effectiveAlleles = [a, "*1"];
    }
  }

  const phenotype = inferPhenotype(gene, effectiveAlleles);

  return { diplotype, alleles, phenotype, genotypeByAllele };
}

/**
 * Phenotype inference from the effective (full diploid) allele pair.
 *
 * Function scoring: NF = 0, DF = 0.5, NM = 1, IF = 1 (with an RM flag).
 *   - score >= 2      -> NM (RM when an increased-function allele is present)
 *   - 1 <= score < 2  -> IM
 *   - score < 1       -> PM (SLCO1B1 uses <= 1, so *5/*15 is poor function)
 *   - CYP2D6 duplication (*xN / *dup) -> URM
 */
export function inferPhenotype(gene, alleles) {
  const table = GENE_ALLELES[gene];
  if (!table || !alleles.length) return "Unknown";

  let score = 0;
  let hasIncreased = false;
  let hasDuplication = false;

  for (const raw of alleles) {
    const a = normalizeStar(raw);
    if (/xN|x\d|dup/i.test(a)) {
      hasIncreased = true;
      hasDuplication = true;
      score += 1;
      continue;
    }
    if (table.IF.includes(a)) {
      hasIncreased = true;
      score += 1;
      continue;
    }
    if (table.NF.includes(a)) {
      score += 0;
      continue;
    }
    if (table.DF.includes(a)) {
      score += 0.5;
      continue;
    }
    // Wild-type or unclassified alleles contribute normal function.
    score += 1;
  }

  if (hasDuplication && gene === "CYP2D6") return "URM";
  if (score >= 2) return hasIncreased ? "RM" : "NM";
  // SLCO1B1: *5/*5, *5/*15 and *15/*15 (score <= 1) are poor function per CPIC,
  // while *1/*5 (score 1.5) is intermediate function.
  if (gene === "SLCO1B1" && score <= 1) return "PM";
  if (score >= 1) return "IM";
  return "PM";
}

/** Map a phenotype to a risk label/severity for a given drug. */
export function assessRisk(drug, gene, phenotype, detectedVariants) {
  const hasVariants = detectedVariants.length > 0;
  let riskLabel = "Unknown";
  let severity = "none";
  let confidence = hasVariants ? 0.7 : 0.5;

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
    } else if (phenotype === "NM" || phenotype === "RM") {
      riskLabel = "Safe";
      severity = "none";
    }
  }

  if (drug === "CLOPIDOGREL") {
    if (phenotype === "PM") {
      riskLabel = "Ineffective";
      severity = "high";
    } else if (phenotype === "IM") {
      riskLabel = "Adjust Dosage";
      severity = "moderate";
    } else if (phenotype === "NM" || phenotype === "RM") {
      riskLabel = "Safe";
      severity = "none";
    }
  }

  if (drug === "WARFARIN") {
    if (phenotype === "IM") {
      riskLabel = "Adjust Dosage";
      severity = "moderate";
    } else if (phenotype === "PM") {
      riskLabel = "Toxic";
      severity = "high";
    } else if (phenotype === "NM" || phenotype === "RM") {
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
    } else if (phenotype === "NM" || phenotype === "RM") {
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
    } else if (phenotype === "NM" || phenotype === "RM") {
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
    } else if (phenotype === "NM" || phenotype === "RM") {
      riskLabel = "Safe";
      severity = "none";
    }
  }

  if (riskLabel === "Unknown") confidence = hasVariants ? 0.4 : 0.45;

  return { risk_label: riskLabel, confidence_score: confidence, severity };
}

const RECOMMENDATIONS = {
  CODEINE: {
    PM: "Avoid codeine — it will not provide adequate analgesia. Choose an alternative that does not require CYP2D6 activation (e.g. morphine or a non-opioid).",
    IM: "Consider an alternative analgesic. If codeine is used, monitor closely for inadequate pain relief.",
    URM: "Avoid codeine — rapid conversion to morphine creates a serious risk of respiratory depression and toxicity.",
    NM: "Use label-recommended dosing with standard monitoring.",
    RM: "Use label-recommended dosing with standard monitoring."
  },
  CLOPIDOGREL: {
    PM: "Avoid clopidogrel. Consider prasugrel or ticagrelor per current guidelines.",
    IM: "Consider an alternative antiplatelet (prasugrel/ticagrelor) or a genotype-guided increase in dose.",
    NM: "Use label-recommended dosing with standard monitoring.",
    RM: "Use label-recommended dosing with standard monitoring."
  },
  WARFARIN: {
    IM: "Initiate warfarin at a reduced dose (e.g. 3–4 mg/day) and titrate with frequent INR monitoring.",
    PM: "Initiate at a substantially reduced dose (e.g. 0.5–2 mg/day) with frequent INR monitoring; consider genotype-guided dosing.",
    NM: "Use label-recommended dosing with standard INR monitoring."
  },
  SIMVASTATIN: {
    IM: "Consider a lower simvastatin dose or an alternative statin (e.g. pravastatin or rosuvastatin) per CPIC guidance.",
    PM: "Avoid simvastatin. Select an alternative statin that is not primarily dependent on SLCO1B1 transport.",
    NM: "Use label-recommended dosing with standard monitoring."
  },
  AZATHIOPRINE: {
    IM: "Start at 30–50% of the standard dose and titrate based on tolerance and blood counts (CPIC).",
    PM: "Avoid azathioprine. Select an alternative immunosuppressant agent (CPIC).",
    NM: "Use label-recommended dosing with standard blood-count monitoring."
  },
  FLUOROURACIL: {
    IM: "Reduce the initial fluorouracil/capecitabine dose and monitor closely for severe toxicity (CPIC).",
    PM: "Avoid fluorouracil and capecitabine. Select an alternative chemotherapy regimen (CPIC).",
    NM: "Use label-recommended dosing with standard monitoring."
  }
};

export function buildRecommendation(drug, gene, phenotype, risk) {
  const perDrug = RECOMMENDATIONS[drug] || {};
  let recommendation = perDrug[phenotype] || perDrug[risk.risk_label];

  if (!recommendation) {
    recommendation =
      "No genotype-based dose adjustment is indicated from the variants detected. Follow standard of care and monitor as usual.";
  }

  return {
    primary_gene: gene,
    phenotype,
    recommendation,
    guideline: "CPIC Guideline"
  };
}

export function buildResult({ patientId, drug, geneVariants, variantsFound, variantsScanned, gtAvailable }) {
  const gene = drugToGene(drug);
  const variants = geneVariants.get(gene) || [];
  const { diplotype, alleles, phenotype } = inferProfile(gene, variants);
  const detectedVariants = variants.map((v) => ({
    rsid: v.rsid || "",
    gene: v.gene,
    star: extractStarTokens(v.star).join(","),
    chrom: v.chrom,
    pos: v.pos,
    ref: v.ref,
    alt: v.alt,
    genotype: v.genotype === "unknown" ? "Unknown" : v.genotype
  }));
  const risk = assessRisk(drug, gene, phenotype, detectedVariants);
  const recommendation = buildRecommendation(drug, gene, phenotype, risk);

  const genesCovered = Array.from(geneVariants.keys()).filter(
    (g) => geneVariants.get(g).length > 0
  );

  return {
    patient_id: patientId,
    drug,
    timestamp: new Date().toISOString(),
    risk_assessment: risk,
    pharmacogenomic_profile: {
      primary_gene: gene,
      diplotype,
      alleles,
      phenotype,
      phenotype_label: PHENOTYPE_LABELS[phenotype] || "Not determined",
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
      variants_scanned: variantsScanned || variantsFound,
      variants_found: variantsFound,
      gene_variants_found: detectedVariants.length,
      genes_covered: genesCovered,
      gt_available: Boolean(gtAvailable)
    }
  };
}

/** Rule-based explanation used when no LLM key is configured. */
export function buildFallbackExplanation(result) {
  const profile = result.pharmacogenomic_profile || {};
  const variants = profile.detected_variants || [];
  const gene = profile.primary_gene || "UNKNOWN";
  const phenotype = profile.phenotype || "Unknown";
  const diplotype = profile.diplotype || "Unknown";
  const drug = result.drug;
  const citations = variants.map((v) => v.rsid).filter(Boolean);

  if (!variants.length) {
    return {
      summary: `No variants affecting ${gene} were detected in this sample, so the ${drug} phenotype could not be determined from the provided VCF. No genotype-guided dose adjustment is indicated based on the available data; follow standard of care.`,
      mechanism: DRUG_MECHANISMS[drug] || "",
      evidence:
        "Based on the variants present in the uploaded VCF. Absence of a variant in the file does not guarantee absence of all rare alleles (limited coverage).",
      citations
    };
  }

  const rsids = citations.length ? ` (${citations.join(", ")})` : "";
  const riskSentence = {
    Safe: "No increased risk is predicted for this drug based on the detected genotype.",
    "Adjust Dosage": "A dose adjustment or alternative agent should be considered based on the detected phenotype.",
    Toxic: "A substantially reduced dose or an alternative agent is recommended due to elevated toxicity risk.",
    Ineffective: "Reduced efficacy is expected; an alternative therapy should be considered.",
    Unknown: "The clinical impact is unclear from the detected variants."
  }[result.risk_assessment?.risk_label] || "";

  const phenotypePhrase =
    phenotype === "Unknown"
      ? `the ${gene} phenotype could not be fully determined`
      : `predicted to be ${/^[aeiou]/i.test(PHENOTYPE_LABELS[phenotype] || phenotype) ? "an" : "a"} ${
          PHENOTYPE_LABELS[phenotype] || phenotype
        } (${phenotype}, ${diplotype})`;

  return {
    summary:
      `This sample is ${phenotypePhrase} for ${gene}${rsids}. ` + riskSentence,
    mechanism: DRUG_MECHANISMS[drug] || "",
    evidence:
      "Inference based on CPIC-informed star-allele function assignments and the genotypes present in the uploaded VCF.",
    citations
  };
}

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-3.7-flash"];

/**
 * Generate an LLM narrative explanation. Falls back to a rule-based
 * explanation when no API key is set or the API is unreachable.
 */
export async function generateExplanation(result) {
  const variants = result.pharmacogenomic_profile?.detected_variants || [];
  const citations = variants.map((v) => v.rsid).filter(Boolean);
  const fallback = buildFallbackExplanation(result);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return fallback;
  }

  const configured = (process.env.GEMINI_MODEL || "").trim();
  const models = [...new Set([configured, ...GEMINI_MODELS].filter(Boolean))];

  const promptText =
    "Generate a concise clinical explanation for this pharmacogenomic result. " +
    "Cite variants by rsID when available. Mention gene, diplotype, phenotype and drug. " +
    "Use plain language and keep to 4-6 sentences. Never contradict the provided data.\n\n" +
    JSON.stringify(result, null, 2);

  let lastError = null;
  for (const model of models) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 350 }
          })
        }
      );
      clearTimeout(timer);

      if (!response.ok) {
        lastError = new Error(`Gemini ${model} returned ${response.status}`);
        continue;
      }

      const data = await response.json();
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        "No explanation returned.";

      return {
        summary: text.trim(),
        mechanism: DRUG_MECHANISMS[result.drug] || "",
        evidence: `Generated with ${model}.`,
        citations
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) console.error("Gemini API error:", lastError.message);
  return {
    ...fallback,
    evidence: `${fallback.evidence} (LLM enrichment unavailable — ${lastError?.message || "API error"})`
  };
}

/**
 * Robust multipart/form-data parser for serverless environments.
 * Works on the raw request Buffer (handles base64-decoded bodies).
 */
export function parseMultipartBody(bodyBuffer) {
  const body = bodyBuffer.toString("latin1"); // byte-preserving
  const firstLineEnd = body.indexOf("\r\n");
  if (firstLineEnd === -1) {
    throw new Error("Expected multipart/form-data body.");
  }
  const firstLine = body.slice(0, firstLineEnd);
  if (!firstLine.startsWith("--")) {
    throw new Error("Expected multipart/form-data body.");
  }

  const boundary = firstLine;
  const fields = {};

  for (const part of body.split(boundary).slice(1)) {
    let p = part;
    if (p.startsWith("\r\n")) p = p.slice(2);
    else if (p.startsWith("\n")) p = p.slice(1);

    const headerEnd = p.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headers = p.slice(0, headerEnd);
    let content = p.slice(headerEnd + 4);

    // Content is followed by the next boundary's CRLF, and the final part by
    // "--" (the closing delimiter). Strip those separators.
    if (content.endsWith("\r\n")) content = content.slice(0, -2);
    if (content.endsWith("--")) content = content.slice(0, -2);

    const nameMatch = headers.match(/name="([^"]+)"/);
    if (!nameMatch) continue;

    const filenameMatch = headers.match(/filename="([^"]*)"/);
    const name = nameMatch[1];
    if (filenameMatch !== null) {
      fields[name] = { filename: filenameMatch[1], content };
    } else {
      fields[name] = content;
    }
  }

  return fields;
}

/** Validate a drug list; returns an error message or "" when valid. */
export function validateDrugs(drugs) {
  const requestedDrugs = drugs
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean);

  if (!requestedDrugs.length) return "Drug name is required.";
  if (requestedDrugs.length > MAX_DRUGS_PER_REQUEST) {
    return `Too many drugs. Maximum is ${MAX_DRUGS_PER_REQUEST}.`;
  }
  const invalid = requestedDrugs.filter((d) => !SUPPORTED_DRUGS.includes(d));
  if (invalid.length) {
    return `Unsupported drug(s): ${invalid.join(", ")}. Supported drugs: ${SUPPORTED_DRUGS.join(", ")}.`;
  }
  return "";
}
