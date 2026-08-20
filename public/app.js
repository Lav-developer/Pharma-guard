/* ==================================================================== */
/* PharmaGuard front-end                                                */
/* ==================================================================== */

const vcfInput = document.getElementById("vcfInput");
const drugInput = document.getElementById("drugInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const sampleBtn = document.getElementById("sampleBtn");
const statusEl = document.getElementById("status");
const uploadStatusEl = document.getElementById("uploadStatus");
const progressBar = document.getElementById("progressBar");
const resultsEl = document.getElementById("results");
const resultsPanel = document.getElementById("resultsPanel");
const resultsHeader = document.getElementById("resultsHeader");
const resultsSummary = document.getElementById("resultsSummary");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const drugChipsEl = document.getElementById("drugChips");
const template = document.getElementById("resultTemplate");
const skeletonTemplate = document.getElementById("skeletonTemplate");
const dropzone = document.getElementById("dropzone");
const themeToggle = document.getElementById("themeToggle");

const SUPPORTED_DRUGS = [
  "CODEINE",
  "WARFARIN",
  "CLOPIDOGREL",
  "SIMVASTATIN",
  "AZATHIOPRINE",
  "FLUOROURACIL"
];

const DRUG_META = {
  CODEINE: { gene: "CYP2D6", class: "Opioid" },
  WARFARIN: { gene: "CYP2C9", class: "Anticoagulant" },
  CLOPIDOGREL: { gene: "CYP2C19", class: "Antiplatelet" },
  SIMVASTATIN: { gene: "SLCO1B1", class: "Statin" },
  AZATHIOPRINE: { gene: "TPMT", class: "Immunosuppressant" },
  FLUOROURACIL: { gene: "DPYD", class: "Chemotherapy" }
};

const PHENOTYPE_META = {
  URM: { cls: "pheno-urm", label: "Ultrarapid metabolizer" },
  RM: { cls: "pheno-rm", label: "Rapid metabolizer" },
  NM: { cls: "pheno-nm", label: "Normal metabolizer" },
  IM: { cls: "pheno-im", label: "Intermediate metabolizer" },
  PM: { cls: "pheno-pm", label: "Poor metabolizer" },
  Unknown: { cls: "pheno-unknown", label: "Not determined" }
};

let lastResults = [];
let lastFileName = "";
let analyzing = false;

/* -------------------------------------------------------------------- */
/* Small DOM helpers (XSS-safe: everything goes through textContent)    */
/* -------------------------------------------------------------------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function formatTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatBytes(bytes) {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/* -------------------------------------------------------------------- */
/* Status + progress                                                    */
/* -------------------------------------------------------------------- */

function setStatus(message, statusType = "info") {
  statusEl.textContent = message || "";
  statusEl.className = "status" + (statusType ? ` ${statusType}` : "");
}

function setUploadStatus(message, isGood = false, isBad = false) {
  uploadStatusEl.textContent = message;
  uploadStatusEl.classList.toggle("file-selected", isGood);
  uploadStatusEl.classList.toggle("file-error", isBad);
}

function setProgress(value) {
  const clamped = Math.max(0, Math.min(100, value));
  progressBar.style.width = `${clamped}%`;
  progressBar.classList.toggle("loading", clamped > 0 && clamped < 100);
  progressBar.classList.toggle("done", clamped >= 100);
}

function setButtonState(disabled, isLoading = false) {
  analyzeBtn.disabled = disabled;
  analyzeBtn.classList.toggle("loading", isLoading);
  analyzeBtn.textContent = isLoading ? "Analyzing…" : "Analyze";
}

/* -------------------------------------------------------------------- */
/* File handling                                                        */
/* -------------------------------------------------------------------- */

function validateFile(file) {
  if (!file) return "Please select a VCF file.";
  const name = file.name.toLowerCase();
  if (!name.endsWith(".vcf") && !name.endsWith(".vcf.gz") && !name.endsWith(".txt")) {
    return "Only .vcf files are supported.";
  }
  if (file.size > 5 * 1024 * 1024) {
    return "File size exceeds the 5 MB limit.";
  }
  return "";
}

function setSelectedFile(file) {
  if (!file) {
    setUploadStatus("No file selected.");
    return;
  }
  const error = validateFile(file);
  if (error) {
    setStatus(error, "error");
    setUploadStatus("Invalid file.", false, true);
    return false;
  }
  setUploadStatus(
    `✓ Selected: ${file.name} (${formatBytes(file.size)})`,
    true
  );
  setStatus("");
  return true;
}

async function loadSample() {
  try {
    sampleBtn.disabled = true;
    sampleBtn.textContent = "Loading…";
    const response = await fetch("sample.vcf", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();
    const file = new File([content], "sample.vcf", {
      type: "text/plain",
      lastModified: Date.now()
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    vcfInput.files = transfer.files;
    setSelectedFile(file);

    // Pre-select a representative set of drugs.
    const drugs = ["CODEINE", "CLOPIDOGREL", "WARFARIN", "SIMVASTATIN", "AZATHIOPRINE", "FLUOROURACIL"];
    syncDrugChips(drugs);
    drugInput.value = drugs.join(", ");
    setStatus("Sample VCF loaded — pick the Analyze button to run the demo.", "success");
  } catch (error) {
    setStatus(`Could not load the sample file: ${error.message}`, "error");
  } finally {
    sampleBtn.disabled = false;
    sampleBtn.textContent = "Use sample data";
  }
}

/* -------------------------------------------------------------------- */
/* Drug chips                                                           */
/* -------------------------------------------------------------------- */

function syncDrugChips(selectedDrugs) {
  clearNode(drugChipsEl);
  for (const drug of SUPPORTED_DRUGS) {
    const chip = el("button", "chip");
    chip.type = "button";
    chip.dataset.drug = drug;
    const meta = DRUG_META[drug];
    chip.append(el("span", "chip-name", drug));
    chip.append(el("span", "chip-gene", meta ? meta.gene : ""));
    chip.setAttribute("aria-pressed", selectedDrugs.includes(drug) ? "true" : "false");
    chip.classList.toggle("active", selectedDrugs.includes(drug));
    chip.addEventListener("click", () => {
      const current = normalizeDrugs(drugInput.value);
      const idx = current.indexOf(drug);
      if (idx === -1) {
        current.push(drug);
      } else {
        current.splice(idx, 1);
      }
      syncDrugChips(current);
      drugInput.value = current.join(", ");
      drugInput.classList.remove("error");
    });
    drugChipsEl.appendChild(chip);
  }
}

/* -------------------------------------------------------------------- */
/* Validation                                                           */
/* -------------------------------------------------------------------- */

function normalizeDrugs(input) {
  return String(input || "")
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean);
}

function validateDrugs(drugs) {
  if (!drugs.length) return "Enter at least one drug.";
  if (drugs.length > 10) return "Too many drugs. Maximum is 10.";
  const invalid = drugs.filter((d) => !SUPPORTED_DRUGS.includes(d));
  if (invalid.length) {
    return `Unsupported drug(s): ${invalid.join(", ")}.`;
  }
  return "";
}

/* -------------------------------------------------------------------- */
/* Rendering                                                            */
/* -------------------------------------------------------------------- */

function riskClass(label) {
  const key = String(label || "").toLowerCase();
  if (key === "safe") return "risk-safe";
  if (key === "adjust dosage") return "risk-adjust";
  if (key === "toxic") return "risk-toxic";
  if (key === "ineffective") return "risk-ineffective";
  return "risk-unknown";
}

function severityClass(severity) {
  const key = String(severity || "none").toLowerCase();
  return ["none", "low", "moderate", "high", "critical"].includes(key)
    ? key
    : "none";
}

function capitalize(value) {
  return String(value || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

function showSkeletonLoaders(count = 1) {
  clearNode(resultsEl);
  for (let i = 0; i < count; i++) {
    resultsEl.appendChild(skeletonTemplate.content.cloneNode(true));
  }
}

function showEmptyState(message) {
  clearNode(resultsEl);
  const wrap = el("div", "empty-state");
  wrap.innerHTML = `
    <div class="empty-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
      </svg>
    </div>
    <h3>No analysis yet</h3>
    <p>Upload a VCF file and choose at least one drug above to see the risk report here.</p>
  `;
  if (message) {
    wrap.querySelector("p").textContent = message;
  }
  resultsEl.appendChild(wrap);
}

function renderResults(results) {
  lastResults = Array.isArray(results) ? results : [];
  clearNode(resultsEl);

  if (!lastResults.length) {
    showEmptyState("The analysis returned no results. Check your VCF content and try again.");
    resultsHeader.hidden = true;
    return;
  }

  const first = lastResults[0];
  const genesCovered = first?.quality_metrics?.genes_covered || [];
  const parts = [];
  parts.push(`Patient: ${first?.patient_id || "Unknown"}`);
  if (lastFileName) parts.push(`File: ${lastFileName}`);
  const ts = formatTimestamp(first?.timestamp);
  if (ts) parts.push(`Analyzed: ${ts}`);
  parts.push(`${first?.quality_metrics?.variants_found ?? 0} variant(s) detected`);
  if (genesCovered.length) parts.push(`Genes: ${genesCovered.join(", ")}`);
  resultsSummary.textContent = parts.join(" · ");
  resultsHeader.hidden = false;

  lastResults.forEach((result, index) => {
    resultsEl.appendChild(buildResultCard(result, index));
  });
}

function buildResultCard(result, index) {
  const node = template.content.cloneNode(true);
  const card = node.querySelector(".result-card");
  card.style.animationDelay = `${0.08 * index}s`;

  const profile = result.pharmacogenomic_profile || {};
  const risk = result.risk_assessment || {};
  const recommendation = result.clinical_recommendation || {};
  const explanation = result.llm_generated_explanation || {};

  const drugName = String(result.drug || "UNKNOWN");
  const gene = profile.primary_gene || DRUG_META[drugName]?.gene || "—";
  const diplotype = profile.diplotype || "Unknown";
  const phenotype = profile.phenotype || "Unknown";
  const severity = risk.severity || "none";
  const confidence = Number(risk.confidence_score || 0);
  const variants = Array.isArray(profile.detected_variants)
    ? profile.detected_variants
    : [];

  node.querySelector(".drug-name").textContent = drugName;
  node.querySelector(".gene-chip").textContent = gene;
  node.querySelector(".diplotype").textContent = diplotype;

  const badge = node.querySelector(".risk-badge");
  badge.textContent = risk.risk_label || "Unknown";
  badge.classList.add(riskClass(risk.risk_label));

  const phenoMeta = PHENOTYPE_META[phenotype] || PHENOTYPE_META.Unknown;
  node.querySelector(".phenotype").textContent = phenotype;
  node.querySelector(".phenotype").classList.add("pheno-chip", phenoMeta.cls);
  node.querySelector(".phenotype-desc").textContent =
    profile.phenotype_label || phenoMeta.label;

  const sevEl = node.querySelector(".severity");
  sevEl.textContent = capitalize(severity);
  sevEl.classList.add(`sev-${severityClass(severity)}`, "sev-chip");

  node.querySelector(".confidence").textContent =
    `${Math.round(confidence * 100)}%`;
  const bar = node.querySelector(".confidence-bar i");
  bar.style.width = `${Math.round(confidence * 100)}%`;

  node.querySelector(".variant-count").textContent = String(variants.length);

  // Recommendation callout.
  node.querySelector(".rec-text").textContent =
    recommendation.recommendation ||
    "No genotype-based dose adjustment is indicated from the variants detected.";
  node.querySelector(".rec-guideline").textContent =
    recommendation.guideline || "CPIC Guideline";
  const recClass = riskClass(risk.risk_label).replace("risk-", "rec-");
  node.querySelector(".recommendation").classList.add(recClass);

  // Variants table.
  const tbody = node.querySelector(".variant-table tbody");
  if (variants.length) {
    for (const v of variants) {
      const row = el("tr");
      row.append(el("td", "", v.rsid || "—"));
      row.append(el("td", "", v.star || "—"));
      row.append(el("td", "", `${v.chrom || "?"}:${v.pos || "?"}`));
      row.append(el("td", "", v.genotype || "Unknown"));
      tbody.appendChild(row);
    }
  } else {
    const row = el("tr");
    const cell = el("td", "", "No variants detected for this gene.");
    cell.colSpan = 4;
    row.appendChild(cell);
    tbody.appendChild(row);
  }

  // AI explanation.
  node.querySelector(".expl-summary").textContent =
    explanation.summary || "No explanation available.";
  if (explanation.mechanism) {
    const m = el("p", "expl-mechanism");
    m.append(el("strong", "", "Mechanism: "));
    m.append(document.createTextNode(explanation.mechanism));
    node.querySelector(".explanation").appendChild(m);
  }
  if (explanation.evidence) {
    const e = el("p", "expl-evidence");
    e.append(el("strong", "", "Evidence: "));
    e.append(document.createTextNode(explanation.evidence));
    node.querySelector(".explanation").appendChild(e);
  }
  const citations = Array.isArray(explanation.citations)
    ? explanation.citations.filter(Boolean)
    : [];
  if (citations.length) {
    const wrap = node.querySelector(".citations");
    wrap.append(el("span", "citations-label", "Citations:"));
    for (const rsid of citations) {
      const chip = el("a", "citation-chip", rsid);
      chip.href = `https://www.ncbi.nlm.nih.gov/snp/${encodeURIComponent(rsid)}`;
      chip.target = "_blank";
      chip.rel = "noopener noreferrer";
      wrap.appendChild(chip);
    }
  }

  // JSON export.
  const jsonText = JSON.stringify(result, null, 2);
  node.querySelector(".json").textContent = jsonText;
  node.querySelector(".copy-btn").addEventListener("click", () => {
    copyText(jsonText);
  });
  node.querySelector(".download-btn").addEventListener("click", () => {
    downloadJson(jsonText, `${result.patient_id || "patient"}_${drugName}.json`);
  });

  return node;
}

/* -------------------------------------------------------------------- */
/* Analysis flow                                                        */
/* -------------------------------------------------------------------- */

function sendWithProgress(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/analyze");

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 90);
        setProgress(percent);
      }
    });

    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Failed to analyze VCF."));
        }
      } catch {
        reject(new Error("Invalid server response."));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload."));
    });

    xhr.send(formData);
  });
}

async function analyze() {
  if (analyzing) return;
  const file = vcfInput.files[0];
  const fileError = validateFile(file);
  if (fileError) {
    setStatus(fileError, "error");
    return;
  }

  const drugs = normalizeDrugs(drugInput.value);
  const drugError = validateDrugs(drugs);
  if (drugError) {
    drugInput.classList.add("error");
    setStatus(drugError, "error");
    return;
  }
  drugInput.classList.remove("error");

  analyzing = true;
  setButtonState(true, true);
  setStatus("Uploading and analyzing…", "info");
  setUploadStatus(`Uploading ${file.name}…`);
  setProgress(0);
  lastFileName = file.name;
  showSkeletonLoaders(drugs.length);

  const formData = new FormData();
  formData.append("vcf", file);
  formData.append("drugs", drugs.join(","));

  try {
    const data = await sendWithProgress(formData);
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("The server returned no results.");
    }
    renderResults(data);
    setStatus("✓ Analysis complete.", "success");
    setUploadStatus(`✓ Uploaded: ${file.name}`, true);
    setProgress(100);
    resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    clearNode(resultsEl);
    resultsHeader.hidden = true;
    setStatus(error.message, "error");
    setUploadStatus("Upload failed.", false, true);
    setProgress(0);
    showEmptyState(
      `${error.message} — check the file format and try again, or load the sample data.`
    );
  } finally {
    analyzing = false;
    setButtonState(false, false);
  }
}

/* -------------------------------------------------------------------- */
/* Export helpers                                                       */
/* -------------------------------------------------------------------- */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus("✓ JSON copied to clipboard.", "success");
  } catch {
    // Fallback for non-secure contexts.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setStatus("✓ JSON copied to clipboard.", "success");
    } catch {
      setStatus("Failed to copy. Try again.", "error");
    }
  }
}

function downloadJson(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

downloadAllBtn.addEventListener("click", () => {
  if (!lastResults.length) return;
  downloadJson(JSON.stringify(lastResults, null, 2), "pharmaguard_results.json");
});

/* -------------------------------------------------------------------- */
/* Events                                                               */
/* -------------------------------------------------------------------- */

analyzeBtn.addEventListener("click", analyze);

drugInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    analyze();
  }
});

drugInput.addEventListener("input", () => {
  syncDrugChips(normalizeDrugs(drugInput.value));
  drugInput.classList.remove("error");
});

drugInput.addEventListener("focus", () => {
  drugInput.classList.remove("error");
});

sampleBtn.addEventListener("click", loadSample);

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("drag-over");
  });
});

dropzone.addEventListener("drop", (event) => {
  const files = event.dataTransfer.files;
  if (!files.length) return;
  if (setSelectedFile(files[0])) {
    vcfInput.files = files;
    drugInput.focus();
  }
});

vcfInput.addEventListener("change", () => {
  setSelectedFile(vcfInput.files[0]);
});

/* -------------------------------------------------------------------- */
/* Theme                                                                */
/* -------------------------------------------------------------------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  try {
    localStorage.setItem("pharmaguard-theme", theme);
  } catch {
    /* storage unavailable — ignore */
  }
}

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark");
});

(function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("pharmaguard-theme");
  } catch {
    /* ignore */
  }
  if (saved === "dark" || saved === "light") {
    applyTheme(saved);
  } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    applyTheme("dark");
  } else {
    applyTheme("light");
  }
})();

/* -------------------------------------------------------------------- */
/* Init                                                                 */
/* -------------------------------------------------------------------- */

syncDrugChips([]);
showEmptyState();
setProgress(0);
