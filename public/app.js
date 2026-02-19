const vcfInput = document.getElementById("vcfInput");
const drugInput = document.getElementById("drugInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const template = document.getElementById("resultTemplate");
const dropzone = document.getElementById("dropzone");

const SUPPORTED_DRUGS = [
  "CODEINE",
  "WARFARIN",
  "CLOPIDOGREL",
  "SIMVASTATIN",
  "AZATHIOPRINE",
  "FLUOROURACIL"
];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#c0392b" : "#6b6257";
}

function riskClass(label) {
  const key = label.toLowerCase();
  if (key === "safe") return "risk-safe";
  if (key === "adjust dosage") return "risk-adjust";
  if (key === "toxic") return "risk-toxic";
  if (key === "ineffective") return "risk-ineffective";
  return "risk-adjust";
}

function validateFile(file) {
  if (!file) return "Please select a VCF file.";
  if (!file.name.toLowerCase().endsWith(".vcf")) {
    return "Only .vcf files are supported.";
  }
  if (file.size > 5 * 1024 * 1024) {
    return "File size exceeds 5 MB limit.";
  }
  return "";
}

function normalizeDrugs(input) {
  return input
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean);
}

function validateDrugs(drugs) {
  if (!drugs.length) return "Enter at least one drug.";
  const invalid = drugs.filter((d) => !SUPPORTED_DRUGS.includes(d));
  if (invalid.length) {
    return `Unsupported drug(s): ${invalid.join(", ")}.`;
  }
  return "";
}

function renderResults(results) {
  resultsEl.innerHTML = "";
  results.forEach((result) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".result-card");
    const drug = node.querySelector(".drug-name");
    const patient = node.querySelector(".patient");
    const badge = node.querySelector(".risk-badge");
    const meta = node.querySelector(".result-meta");
    const json = node.querySelector(".json");
    const copyBtn = node.querySelector(".copy-btn");
    const downloadBtn = node.querySelector(".download-btn");

    drug.textContent = result.drug;
    patient.textContent = `Patient: ${result.patient_id}`;
    badge.textContent = result.risk_assessment.risk_label;
    badge.classList.add(riskClass(result.risk_assessment.risk_label));

    meta.innerHTML = `
      <div><strong>Gene</strong><br>${result.pharmacogenomic_profile.primary_gene}</div>
      <div><strong>Diplotype</strong><br>${result.pharmacogenomic_profile.diplotype}</div>
      <div><strong>Phenotype</strong><br>${result.pharmacogenomic_profile.phenotype}</div>
      <div><strong>Severity</strong><br>${result.risk_assessment.severity}</div>
    `;

    json.textContent = JSON.stringify(result, null, 2);

    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(json.textContent);
      setStatus("JSON copied to clipboard.");
    });

    downloadBtn.addEventListener("click", () => {
      const blob = new Blob([json.textContent], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${result.patient_id}_${result.drug}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    resultsEl.appendChild(node);
  });
}

async function analyze() {
  const file = vcfInput.files[0];
  const fileError = validateFile(file);
  if (fileError) {
    setStatus(fileError, true);
    return;
  }

  const drugs = normalizeDrugs(drugInput.value);
  const drugError = validateDrugs(drugs);
  if (drugError) {
    setStatus(drugError, true);
    return;
  }

  setStatus("Analyzing VCF and generating recommendations...");

  const formData = new FormData();
  formData.append("vcf", file);
  formData.append("drugs", drugs.join(","));

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to analyze VCF.");
    }

    renderResults(Array.isArray(data) ? data : [data]);
    setStatus("Analysis complete.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

analyzeBtn.addEventListener("click", analyze);

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("hover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("hover");
  });
});


dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) {
    vcfInput.files = event.dataTransfer.files;
  }
});
