import {
  decodeImageFile,
  stitchImages,
} from "./stitch-core.js";

import {
  calculateSha256Hex,
  createSidecarYaml,
} from "./metadata.js";

import {
  createTranslator,
  resolveLocale,
} from "./i18n.js";


/* ==========================================
   Application State
========================================== */

const applicationState = {
  selectedFiles: [],
  isProcessing: false,
  generatedFiles: null,
};


/* ==========================================
   Stitch Settings
========================================== */

const stitchSettings = {
  minimumApproximateOverlapRows: 128,
  minimumApproximateSimilarity: 0.96,
};


/* ==========================================
   DOM References
========================================== */

const elements = {
  appTitle: document.querySelector("#app-title"),
  appDescription: document.querySelector("#app-description"),
  fileInput: document.querySelector("#file-input"),
  selectFilesButton: document.querySelector("#select-files-button"),
  selectedFilesStatus: document.querySelector("#selected-files-status"),
  outputFileNameLabel: document.querySelector("#output-file-name-label"),
  outputFileName: document.querySelector("#output-file-name"),
  stitchButton: document.querySelector("#stitch-button"),
  resetButton: document.querySelector("#reset-button"),
  downloadControls: document.querySelector("#download-controls"),
  downloadPngButton: document.querySelector("#download-png-button"),
  downloadYamlButton: document.querySelector("#download-yaml-button"),
  processStatus: document.querySelector("#process-status"),
};

const locale = resolveLocale();
const t = createTranslator(locale);


/* ==========================================
   Presentation
========================================== */

function applyLocalizedText() {
  document.documentElement.lang = locale;

  elements.appTitle.textContent = t("appTitle");
  elements.appDescription.textContent = t("appDescription");
  elements.selectFilesButton.textContent = t("selectFiles");
  elements.outputFileNameLabel.textContent = t("outputFileName");
  elements.stitchButton.textContent = t("stitch");
  elements.resetButton.textContent = t("reset");
  elements.downloadPngButton.textContent = t("savePng");
  elements.downloadYamlButton.textContent = t("saveYaml");

  updateSelectedFilesStatus();
}

function updateSelectedFilesStatus() {
  const count = applicationState.selectedFiles.length;

  elements.selectedFilesStatus.textContent = count === 0
    ? t("noFilesSelected")
    : t("selectedFiles", count);
}

function setProcessingState(isProcessing) {
  applicationState.isProcessing = isProcessing;

  elements.selectFilesButton.disabled = isProcessing;
  elements.stitchButton.disabled = isProcessing;
  elements.resetButton.disabled = isProcessing;
  elements.outputFileName.disabled = isProcessing;
}

function formatPercentage(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDiagnosticReport(diagnostics) {
  const imageLines = diagnostics.images.flatMap((image) => [
    `image ${image.index + 1}: role=${image.role}, ${image.width} × ${image.height}`,
    `  keep y=${image.segment.sourceStartRow}–${image.segment.sourceEndRow} (${image.segment.rowCount} rows)`,
  ]);

  const pairLines = diagnostics.pairMatches.flatMap((pair, index) => [
    `pair ${index + 1}→${index + 2}:`,
    `  overlap=${pair.rowCount} rows, similarity=${formatPercentage(pair.averageSimilarity)}`,
    `  firstStart=${pair.firstStartRow}, secondStart=${pair.secondStartRow}`,
    `  fixed top=${pair.fixedTop.rows}, fixed bottom=${pair.fixedBottom.rows}`,
  ]);

  return [
    "[debug] role-aware screenshot diagnostics",
    `images: ${diagnostics.imageCount}`,
    "",
    "image roles / retained segments:",
    ...imageLines,
    "",
    "pairwise overlap:",
    ...pairLines,
    "",
    `minimum overlap: ${stitchSettings.minimumApproximateOverlapRows} rows`,
    `acceptance similarity: ${formatPercentage(stitchSettings.minimumApproximateSimilarity)}`,
  ].join("\n");
}


/* ==========================================
   File Naming
========================================== */

function normalizeBaseFileName(rawValue) {
  const trimmed = rawValue.trim();
  const withoutExtensions = trimmed.replace(/\.(png|ya?ml)$/i, "");

  return withoutExtensions || "stitched-screenshot";
}


/* ==========================================
   Browser Downloads
========================================== */

function downloadBlob(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;

  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function clearGeneratedFiles() {
  applicationState.generatedFiles = null;
  elements.downloadControls.hidden = true;
}

function showGeneratedFiles({ pngBlob, pngFileName, yamlBlob, yamlFileName }) {
  applicationState.generatedFiles = {
    pngBlob,
    pngFileName,
    yamlBlob,
    yamlFileName,
  };

  elements.downloadControls.hidden = false;
}


/* ==========================================
   Processing Workflow
========================================== */

async function handleStitch() {
  if (applicationState.selectedFiles.length < 2) {
    elements.processStatus.textContent = t("needAtLeastTwoFiles");
    return;
  }

  clearGeneratedFiles();
  setProcessingState(true);
  elements.processStatus.textContent = t("processing");

  const bitmaps = [];

  try {
    for (const file of applicationState.selectedFiles) {
      bitmaps.push(await decodeImageFile(file));
    }

    const result = await stitchImages(bitmaps, stitchSettings);

    const baseFileName = normalizeBaseFileName(
      elements.outputFileName.value,
    );
    const pngFileName = `${baseFileName}.png`;
    const yamlFileName = `${baseFileName}.yaml`;
    const sha256 = await calculateSha256Hex(result.pngBlob);

    const yamlText = createSidecarYaml({
      outputFileName: pngFileName,
      sha256,
      outputWidth: result.outputWidth,
      outputHeight: result.outputHeight,
      diagnostics: result.diagnostics,
      sourceFiles: applicationState.selectedFiles,
    });

    const yamlBlob = new Blob([yamlText], {
      type: "text/yaml;charset=utf-8",
    });

    showGeneratedFiles({
      pngBlob: result.pngBlob,
      pngFileName,
      yamlBlob,
      yamlFileName,
    });

    elements.processStatus.textContent = [
      t("complete"),
      "",
      formatDiagnosticReport(result.diagnostics),
    ].join("\n");
  } catch (error) {
    console.error(error);

    if (error.message === "WIDTH_MISMATCH") {
      elements.processStatus.textContent = t("widthMismatch");
    } else if (error.message === "OVERLAP_NOT_FOUND") {
      elements.processStatus.textContent = t("overlapNotFound");
    } else if (error.message === "INVALID_SEGMENT_GEOMETRY") {
      elements.processStatus.textContent = t("invalidGeometry");
    } else {
      elements.processStatus.textContent = t("failed");
    }
  } finally {
    for (const bitmap of bitmaps) {
      bitmap.close();
    }

    setProcessingState(false);
  }
}


/* ==========================================
   Reset Workflow
========================================== */

function resetApplication() {
  applicationState.selectedFiles = [];
  clearGeneratedFiles();

  elements.fileInput.value = "";
  elements.outputFileName.value = "stitched-screenshot";
  elements.processStatus.textContent = "";

  updateSelectedFilesStatus();
}


/* ==========================================
   Event Wiring
========================================== */

elements.selectFilesButton.addEventListener("click", () => {
  elements.fileInput.click();
});

elements.fileInput.addEventListener("change", () => {
  applicationState.selectedFiles = Array.from(
    elements.fileInput.files ?? [],
  );

  clearGeneratedFiles();
  elements.processStatus.textContent = "";
  updateSelectedFilesStatus();
});

elements.stitchButton.addEventListener("click", handleStitch);
elements.resetButton.addEventListener("click", resetApplication);

elements.downloadPngButton.addEventListener("click", () => {
  const generatedFiles = applicationState.generatedFiles;

  if (generatedFiles) {
    downloadBlob(generatedFiles.pngBlob, generatedFiles.pngFileName);
  }
});

elements.downloadYamlButton.addEventListener("click", () => {
  const generatedFiles = applicationState.generatedFiles;

  if (generatedFiles) {
    downloadBlob(generatedFiles.yamlBlob, generatedFiles.yamlFileName);
  }
});


/* ==========================================
   Application Start
========================================== */

applyLocalizedText();
