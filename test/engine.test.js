import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVcf,
  parseMultipartBody,
  buildResult,
  buildFallbackExplanation,
  inferProfile,
  validateDrugs,
  normalizeStar,
  extractStarTokens
} from "../shared/engine.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const VCF_NO_GT = [
  "##fileformat=VCFv4.2",
  "##INFO=<ID=GENE,Number=1,Type=String,Description=\"Gene name\">",
  "##INFO=<ID=RS,Number=1,Type=String,Description=\"RSID\">",
  "##INFO=<ID=STAR,Number=1,Type=String,Description=\"Star allele\">",
  "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO",
  "22\t42128945\trs3892097\tC\tT\t100\tPASS\tGENE=CYP2D6;RS=rs3892097;STAR=*4",
  "10\t94942212\trs1799853\tC\tT\t100\tPASS\tGENE=CYP2C9;RS=rs1799853;STAR=*2",
  "19\t47177570\trs4149056\tT\tC\t100\tPASS\tGENE=SLCO1B1;RS=rs4149056;STAR=*5",
  "1\t1000\trs999\tA\tG\t100\tPASS\tGENE=NOT_TARGET;RS=rs999;STAR=*1"
].join("\n");

/** VCF with FORMAT/GT: one heterozygous variant, rest homozygous reference. */
const VCF_WITH_GT = [
  "##fileformat=VCFv4.2",
  "##INFO=<ID=GENE,Number=1,Type=String,Description=\"Gene name\">",
  "##INFO=<ID=STAR,Number=1,Type=String,Description=\"Star allele\">",
  "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tPATIENT_001",
  "chr22\t42128945\trs3892097\tC\tT\t99\tPASS\tGENE=CYP2D6;STAR=*4\tGT\t0/1",
  "chr22\t42522613\trs3892097b\tC\tT\t99\tPASS\tGENE=CYP2D6;STAR=*4\tGT\t0/0",
  "chr1\t97450058\trs3918290\tC\tT\t99\tPASS\tGENE=DPYD;STAR=*2A\tGT\t0/0",
  "chr6\t18138997\trs1800462\tC\tG\t99\tPASS\tGENE=TPMT;STAR=*2\tGT\t1/1"
].join("\n");

const VCF_INVALID = "##fileformat=VCFv4.2\nno header here\n";

/* ------------------------------------------------------------------ */
/* parseVcf                                                            */
/* ------------------------------------------------------------------ */

test("parseVcf: parses variants without FORMAT/GT as present", () => {
  const result = parseVcf(VCF_NO_GT);
  assert.equal(result.success, true);
  assert.equal(result.variantsFound, 3);
  assert.equal(result.gtAvailable, false);
  assert.equal(result.patientId, "PATIENT_XXX");
  const cyp2d6 = result.geneVariants.get("CYP2D6");
  assert.equal(cyp2d6.length, 1);
  assert.equal(cyp2d6[0].rsid, "rs3892097");
  assert.equal(cyp2d6[0].genotype, "unknown");
  // Non-target genes are ignored.
  assert.equal(result.geneVariants.get("CYP2C19").length, 0);
});

test("parseVcf: respects GT column (0/0 variants are NOT detected)", () => {
  const result = parseVcf(VCF_WITH_GT);
  assert.equal(result.success, true);
  assert.equal(result.gtAvailable, true);
  assert.equal(result.patientId, "PATIENT_001");
  assert.equal(result.variantsFound, 2); // rs3892097 (het) + rs1800462 (hom)
  const cyp2d6 = result.geneVariants.get("CYP2D6");
  assert.equal(cyp2d6.length, 1); // duplicate *4 marker at 0/0 excluded
  assert.equal(cyp2d6[0].genotype, "heterozygous");
  assert.equal(result.geneVariants.get("DPYD").length, 0); // 0/0 excluded
  assert.equal(result.geneVariants.get("TPMT")[0].genotype, "homozygous");
});

test("parseVcf: rejects files without a #CHROM header", () => {
  const result = parseVcf(VCF_INVALID);
  assert.equal(result.success, false);
  assert.match(result.error, /#CHROM/);
});

/* ------------------------------------------------------------------ */
/* Star allele helpers                                                 */
/* ------------------------------------------------------------------ */

test("normalizeStar strips gene prefixes", () => {
  assert.equal(normalizeStar("CYP2D6*4"), "*4");
  assert.equal(normalizeStar("CYP2D6*1/*4"), "*1/*4");
  assert.equal(normalizeStar("*2A"), "*2A");
});

test("extractStarTokens handles phased and composite values", () => {
  assert.deepEqual(extractStarTokens("*1/*4"), ["*1", "*4"]);
  assert.deepEqual(extractStarTokens("CYP2D6*4"), ["*4"]);
  assert.deepEqual(extractStarTokens("*1,*4"), ["*1", "*4"]);
  assert.deepEqual(extractStarTokens(""), []);
});

/* ------------------------------------------------------------------ */
/* Profile inference                                                   */
/* ------------------------------------------------------------------ */

test("inferProfile: single heterozygous allele pairs with wild type", () => {
  const { diplotype, phenotype, alleles } = inferProfile("CYP2D6", [
    { star: "*4", genotype: "heterozygous" }
  ]);
  assert.equal(diplotype, "*4/*1");
  assert.equal(phenotype, "IM");
  assert.deepEqual(alleles, ["*4"]);
});

test("inferProfile: homozygous allele produces homozygous diplotype", () => {
  const { diplotype, phenotype } = inferProfile("CYP2D6", [
    { star: "*4", genotype: "homozygous" }
  ]);
  assert.equal(diplotype, "*4/*4");
  assert.equal(phenotype, "PM");
});

test("inferProfile: deduplicates star alleles across multiple markers", () => {
  const { alleles, diplotype } = inferProfile("CYP2D6", [
    { star: "*4", genotype: "heterozygous" },
    { star: "*4", genotype: "heterozygous" },
    { star: "*4", genotype: "heterozygous" }
  ]);
  assert.deepEqual(alleles, ["*4"]);
  assert.equal(diplotype, "*4/*1");
});

test("inferProfile: two alleles produce compound diplotype", () => {
  const { diplotype, phenotype } = inferProfile("CYP2D6", [
    { star: "*2", genotype: "heterozygous" },
    { star: "*4", genotype: "heterozygous" }
  ]);
  assert.equal(diplotype, "*2/*4");
  assert.equal(phenotype, "IM");
});

test("inferProfile: CYP2C19 *1/*17 is a rapid metabolizer", () => {
  const { phenotype } = inferProfile("CYP2C19", [
    { star: "*17", genotype: "heterozygous" }
  ]);
  assert.equal(phenotype, "RM");
});

test("inferProfile: SLCO1B1 *5/*15 is poor function, *1/*5 intermediate", () => {
  assert.equal(
    inferProfile("SLCO1B1", [
      { star: "*5", genotype: "heterozygous" },
      { star: "*15", genotype: "heterozygous" }
    ]).phenotype,
    "PM"
  );
  assert.equal(
    inferProfile("SLCO1B1", [{ star: "*5", genotype: "heterozygous" }])
      .phenotype,
    "IM"
  );
});

test("inferProfile: CYP2D6 duplication is ultrarapid", () => {
  const { phenotype } = inferProfile("CYP2D6", [
    { star: "*1xN", genotype: "heterozygous" }
  ]);
  assert.equal(phenotype, "URM");
});

test("inferProfile: no variants -> unknown", () => {
  const { diplotype, phenotype } = inferProfile("DPYD", []);
  assert.equal(diplotype, "Unknown");
  assert.equal(phenotype, "Unknown");
});

/* ------------------------------------------------------------------ */
/* buildResult / risk assessment                                       */
/* ------------------------------------------------------------------ */

function analyzeWithStars(starFields) {
  const geneVariants = new Map();
  for (const gene of ["CYP2D6", "CYP2C19", "CYP2C9", "SLCO1B1", "TPMT", "DPYD"]) {
    geneVariants.set(gene, []);
  }
  for (const [gene, star] of starFields) {
    geneVariants.get(gene).push({
      rsid: `rs_${gene}_${star.replace(/[^a-z0-9]/gi, "")}`,
      gene,
      star,
      chrom: "chr1",
      pos: "1",
      ref: "A",
      alt: "G",
      genotype: "heterozygous"
    });
  }
  return buildResult({
    patientId: "TEST_001",
    drug: "CODEINE",
    geneVariants,
    variantsFound: starFields.length,
    gtAvailable: true
  });
}

test("buildResult: CODEINE + CYP2D6 *1/*4 -> Adjust Dosage (low)", () => {
  const result = analyzeWithStars([["CYP2D6", "*4"]]);
  assert.equal(result.pharmacogenomic_profile.diplotype, "*4/*1");
  assert.equal(result.pharmacogenomic_profile.phenotype, "IM");
  assert.equal(result.risk_assessment.risk_label, "Adjust Dosage");
  assert.equal(result.risk_assessment.severity, "low");
  assert.equal(result.quality_metrics.gene_variants_found, 1);
});

test("buildResult: CODEINE + CYP2D6 PM -> Ineffective", () => {
  const result = analyzeWithStars([
    ["CYP2D6", "*3"],
    ["CYP2D6", "*4"]
  ]);
  assert.equal(result.risk_assessment.risk_label, "Ineffective");
});

test("buildResult: AZATHIOPRINE + TPMT PM -> Toxic (critical)", () => {
  const geneVariants = new Map();
  for (const gene of ["CYP2D6", "CYP2C19", "CYP2C9", "SLCO1B1", "TPMT", "DPYD"]) {
    geneVariants.set(gene, []);
  }
  geneVariants.get("TPMT").push({
    rsid: "rs1800462",
    gene: "TPMT",
    star: "*2",
    chrom: "chr6",
    pos: "18138997",
    ref: "C",
    alt: "G",
    genotype: "homozygous"
  });
  const result = buildResult({
    patientId: "TEST_001",
    drug: "AZATHIOPRINE",
    geneVariants,
    variantsFound: 1,
    gtAvailable: true
  });
  assert.equal(result.risk_assessment.risk_label, "Toxic");
  assert.equal(result.risk_assessment.severity, "critical");
  assert.match(result.clinical_recommendation.recommendation, /Avoid azathioprine/i);
});

test("buildResult: no variants -> Unknown risk, honest explanation", () => {
  const result = analyzeWithStars([]);
  assert.equal(result.risk_assessment.risk_label, "Unknown");
  assert.equal(result.risk_assessment.severity, "none");
  const explanation = buildFallbackExplanation(result);
  assert.match(explanation.summary, /No variants affecting CYP2D6/i);
});

test("buildResult: CLOPIDOGREL + CYP2C19 PM -> Ineffective (high)", () => {
  const geneVariants = new Map();
  for (const gene of ["CYP2D6", "CYP2C19", "CYP2C9", "SLCO1B1", "TPMT", "DPYD"]) {
    geneVariants.set(gene, []);
  }
  geneVariants.get("CYP2C19").push({
    rsid: "rs4244285",
    gene: "CYP2C19",
    star: "*2",
    chrom: "chr10",
    pos: "94781859",
    ref: "G",
    alt: "A",
    genotype: "homozygous"
  });
  const result = buildResult({
    patientId: "TEST_001",
    drug: "CLOPIDOGREL",
    geneVariants,
    variantsFound: 1,
    gtAvailable: true
  });
  assert.equal(result.pharmacogenomic_profile.phenotype, "PM");
  assert.equal(result.risk_assessment.risk_label, "Ineffective");
  assert.equal(result.risk_assessment.severity, "high");
});

test("buildResult: FLUOROURACIL + DPYD *1/*2A -> Adjust Dosage (high)", () => {
  const geneVariants = new Map();
  for (const gene of ["CYP2D6", "CYP2C19", "CYP2C9", "SLCO1B1", "TPMT", "DPYD"]) {
    geneVariants.set(gene, []);
  }
  geneVariants.get("DPYD").push({
    rsid: "rs3918290",
    gene: "DPYD",
    star: "*2A",
    chrom: "chr1",
    pos: "97450058",
    ref: "C",
    alt: "T",
    genotype: "heterozygous"
  });
  const result = buildResult({
    patientId: "TEST_001",
    drug: "FLUOROURACIL",
    geneVariants,
    variantsFound: 1,
    gtAvailable: true
  });
  assert.equal(result.risk_assessment.risk_label, "Adjust Dosage");
  assert.equal(result.risk_assessment.severity, "high");
});

/* ------------------------------------------------------------------ */
/* validateDrugs                                                       */
/* ------------------------------------------------------------------ */

test("validateDrugs: accepts supported drugs, case/whitespace tolerant", () => {
  assert.equal(validateDrugs(" codeine, WARFARIN "), "");
});

test("validateDrugs: rejects unsupported drugs", () => {
  assert.match(validateDrugs("IBUPROFEN"), /Unsupported drug/);
});

test("validateDrugs: rejects empty input", () => {
  assert.match(validateDrugs("  , "), /required/i);
});

/* ------------------------------------------------------------------ */
/* parseMultipartBody                                                  */
/* ------------------------------------------------------------------ */

function buildMultipart(fields, { filename } = {}) {
  const boundary = "----PharmaGuardTestBoundary123";
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(`--${boundary}\r\n`);
    if (name === "vcf" && filename) {
      chunks.push(
        `Content-Disposition: form-data; name="vcf"; filename="${filename}"\r\n`
      );
      chunks.push("Content-Type: application/octet-stream\r\n");
    } else {
      chunks.push(`Content-Disposition: form-data; name="${name}"\r\n`);
    }
    chunks.push(`\r\n${value}\r\n`);
  }
  chunks.push(`--${boundary}--\r\n`);
  return Buffer.from(chunks.join(""), "latin1");
}

test("parseMultipartBody: extracts multi-line VCF and drugs fields", () => {
  const vcf = "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\nchr1\t1\trs1\nchr1\t2\trs2\n";
  const buffer = buildMultipart(
    { vcf: vcf, drugs: "CODEINE, WARFARIN" },
    { filename: "patient.vcf" }
  );
  const fields = parseMultipartBody(buffer);
  assert.equal(fields.vcf.filename, "patient.vcf");
  assert.equal(fields.vcf.content, vcf); // full multi-line content preserved
  assert.equal(fields.drugs, "CODEINE, WARFARIN");
});

test("parseMultipartBody: content that ends with a newline survives intact", () => {
  const vcf = "chr1\t1\trs1\n";
  const buffer = buildMultipart({ vcf }, { filename: "a.vcf" });
  const fields = parseMultipartBody(buffer);
  assert.equal(fields.vcf.content, vcf);
});

test("parseMultipartBody: rejects non-multipart bodies", () => {
  assert.throws(() => parseMultipartBody(Buffer.from("just text")), /multipart/);
});

/* ------------------------------------------------------------------ */
/* Integration: real repo sample files                                 */
/* ------------------------------------------------------------------ */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

test("integration: TC_P1_PATIENT_001_Normal.vcf (GT-aware) — only the 0/1 variant counts", () => {
  const text = readFileSync(path.join(repoRoot, "TC_P1_PATIENT_001_Normal.vcf"), "utf8");
  const parsed = parseVcf(text);
  assert.equal(parsed.success, true);
  assert.equal(parsed.patientId, "PATIENT_001");
  assert.equal(parsed.gtAvailable, true);
  // 26 target-gene rows in the file, but only rs16947 (CYP2D6 *2) is 0/1.
  assert.equal(parsed.variantsFound, 1);
  const cyp2d6 = parsed.geneVariants.get("CYP2D6");
  assert.equal(cyp2d6.length, 1);
  assert.equal(cyp2d6[0].rsid, "rs16947");
  assert.equal(cyp2d6[0].genotype, "heterozygous");

  // Build the CODEINE result: *2/*1 -> NM -> Safe.
  const geneVariants = parsed.geneVariants;
  const result = buildResult({
    patientId: parsed.patientId,
    drug: "CODEINE",
    geneVariants,
    variantsFound: parsed.variantsFound,
    variantsScanned: parsed.variantsScanned,
    gtAvailable: parsed.gtAvailable
  });
  assert.equal(result.pharmacogenomic_profile.diplotype, "*2/*1");
  assert.equal(result.pharmacogenomic_profile.phenotype, "NM");
  assert.equal(result.risk_assessment.risk_label, "Safe");
  assert.equal(result.risk_assessment.severity, "none");
  assert.equal(result.quality_metrics.variants_scanned, parsed.variantsScanned);
  assert.ok(result.quality_metrics.variants_scanned >= 26);
});

test("integration: sample_patient_data.vcf (no GT) — variants assumed present", () => {
  const text = readFileSync(path.join(repoRoot, "sample_patient_data.vcf"), "utf8");
  const parsed = parseVcf(text);
  assert.equal(parsed.success, true);
  assert.equal(parsed.gtAvailable, false);
  assert.equal(parsed.variantsFound, 3);

  const result = buildResult({
    patientId: parsed.patientId,
    drug: "WARFARIN",
    geneVariants: parsed.geneVariants,
    variantsFound: parsed.variantsFound,
    variantsScanned: parsed.variantsScanned,
    gtAvailable: parsed.gtAvailable
  });
  assert.equal(result.pharmacogenomic_profile.diplotype, "*2/*1");
  assert.equal(result.pharmacogenomic_profile.phenotype, "IM");
  assert.equal(result.risk_assessment.risk_label, "Adjust Dosage");
});

test("integration: public/sample.vcf demo file produces the expected 5x IM report", () => {
  const text = readFileSync(path.join(repoRoot, "public/sample.vcf"), "utf8");
  const parsed = parseVcf(text);
  assert.equal(parsed.success, true);
  assert.equal(parsed.patientId, "DEMO_001");
  assert.equal(parsed.variantsFound, 5); // DPYD row is 0/0 -> excluded

  const expectations = {
    CODEINE: { diplotype: "*4/*1", phenotype: "IM", label: "Adjust Dosage" },
    CLOPIDOGREL: { diplotype: "*2/*1", phenotype: "IM", label: "Adjust Dosage" },
    WARFARIN: { diplotype: "*3/*1", phenotype: "IM", label: "Adjust Dosage" },
    SIMVASTATIN: { diplotype: "*5/*1", phenotype: "IM", label: "Adjust Dosage" },
    AZATHIOPRINE: { diplotype: "*2/*1", phenotype: "IM", label: "Adjust Dosage" },
    FLUOROURACIL: { diplotype: "Unknown", phenotype: "Unknown", label: "Unknown" }
  };

  for (const [drug, expected] of Object.entries(expectations)) {
    const result = buildResult({
      patientId: parsed.patientId,
      drug,
      geneVariants: parsed.geneVariants,
      variantsFound: parsed.variantsFound,
      variantsScanned: parsed.variantsScanned,
      gtAvailable: parsed.gtAvailable
    });
    assert.equal(result.pharmacogenomic_profile.diplotype, expected.diplotype, `${drug} diplotype`);
    assert.equal(result.pharmacogenomic_profile.phenotype, expected.phenotype, `${drug} phenotype`);
    assert.equal(result.risk_assessment.risk_label, expected.label, `${drug} risk label`);
  }
});
