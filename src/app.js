import {
  decodeImageFile,
  diagnoseImagePair,
  stitchTwoImages,
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
  minimumOverlapRows: 32,
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

  elements.selectedFilesStatus.textContent =
    count === 0
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

function formatMatch(match) {
  if (!match) {
    return "none";
  }

  const parts = [
    `${match.rowCount} rows`,
    `firstStart=${match.firstStartRow}`,
    `secondStart=${match.secondStartRow}`,
    `offset=${match.verticalOffset}`,
  ];

  if (typeof match.averageSimilarity === "number") {
    parts.push(
      `similarity=${formatPercentage(match.averageSimilarity)}`,
    );
  }

  return parts.join(", ");
}

function formatDiagnosticReport(diagnostics) {
  return [
    "[debug] screenshot structure diagnostics",
    `image 1: ${diagnostics.firstWidth} × ${diagnostics.firstHeight}`,
    `image 2: ${diagnostics.secondWidth} × ${diagnostics.secondHeight}`,
    "",
    "fixed UI candidates:",
    `  top: ${diagnostics.fixedTop.rows} rows, similarity=${formatPercentage(diagnostics.fixedTop.averageSimilarity)}`,
    `  bottom: ${diagnostics.fixedBottom.rows} rows, similarity=${formatPercentage(diagnostics.fixedBottom.averageSimilarity)}`,
    "",
    "content search region:",
    `  image 1: y=${diagnostics.contentRegion.firstStartRow}–${diagnostics.contentRegion.firstEndRow}`,
    `  image 2: y=${diagnostics.contentRegion.secondStartRow}–${diagnostics.contentRegion.secondEndRow}`,
    "",
    "exact matching:",
    `  minimum overlap: ${diagnostics.minimumOverlapRows} rows`,
    `  matching row pairs: ${diagnostics.matchingRowPairs}`,
    `  best (any geometry): ${formatMatch(diagnostics.bestAny)}`,
    `  best (positive offset): ${formatMatch(diagnostics.bestPositiveOffset)}`,
    "",
    "approximate matching after fixed-UI exclusion:",
    `  minimum overlap: ${diagnostics.minimumApproximateOverlapRows} rows`,
    `  acceptance similarity: ${formatPercentage(stitchSettings.minimumApproximateSimilarity)}`,
    `  best: ${formatMatch(diagnostics.approximateMatch)}`,
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

/*
 * iOS Safari can suppress or reorder multiple synthetic downloads started
 * after asynchronous processing. Generated files are therefore kept in
 * memory and downloaded one at a time from an explicit user tap.
 */

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
  if (applicationState.selectedFiles.length !== 2) {
    elements.processStatus.textContent = t("needExactlyTwoFiles");
    return;
  }

  clearGeneratedFiles();
  setProcessingState(true);
  elements.processStatus.textContent = t("processing");

  const [firstFile, secondFile] = applicationState.selectedFiles;

  let firstBitmap;
  let secondBitmap;
  let diagnostics;

  try {
    firstBitmap = await decodeImageFile(firstFile);
    secondBitmap = await decodeImageFile(secondFile);

    diagnostics = diagnoseImagePair(
      firstBitmap,
      secondBitmap,
      stitchSettings,
    );

    const result = await stitchTwoImages(
      firstBitmap,
      secondBitmap,
      stitchSettings,
    );

    const baseFileName =
      normalizeBaseFileName(elements.outputFileName.value);

    const pngFileName = `${baseFileName}.png`;
    const yamlFileName = `${baseFileName}.yaml`;

    const sha256 =
      await calculateSha256Hex(result.pngBlob);

    const yamlText = createSidecarYaml({
      outputFileName: pngFileName,
      sha256,
      outputWidth: result.outputWidth,
      outputHeight: result.outputHeight,
      matchMode: result.matchMode,
      overlapRows: result.overlapRows,
      averageSimilarity: result.averageSimilarity,
      firstMatchStartRow: result.firstMatchStartRow,
      secondMatchStartRow: result.secondMatchStartRow,
      firstSpliceRow: result.firstSpliceRow,
      secondSpliceRow: result.secondSpliceRow,
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

    const matchDescription =
      result.matchMode === "exact"
        ? `exact overlap used: ${result.overlapRows} rows`
        : [
            `approximate overlap used: ${result.overlapRows} rows`,
            `similarity: ${formatPercentage(result.averageSimilarity)}`,
            `splice: image1 y=${result.firstSpliceRow}, image2 y=${result.secondSpliceRow}`,
          ].join("\n");

    elements.processStatus.textContent = [
      t("complete"),
      matchDescription,
      "",
      formatDiagnosticReport(diagnostics),
    ].join("\n");
  } catch (error) {
    console.error(error);

    if (error.message === "WIDTH_MISMATCH") {
      elements.processStatus.textContent = t("widthMismatch");
    } else if (
      error.message === "OVERLAP_NOT_FOUND" &&
      diagnostics
    ) {
      elements.processStatus.textContent = [
        t("overlapNotFound"),
        "",
        formatDiagnosticReport(diagnostics),
      ].join("\n");
    } else {
      elements.processStatus.textContent = t("failed");
    }
  } finally {
    firstBitmap?.close();
    secondBitmap?.close();
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
  applicationState.selectedFiles =
    Array.from(elements.fileInput.files ?? []);

  clearGeneratedFiles();
  elements.processStatus.textContent = "";
  updateSelectedFilesStatus();
});

elements.stitchButton.addEventListener("click", handleStitch);
elements.resetButton.addEventListener("click", resetApplication);

elements.downloadPngButton.addEventListener("click", () => {
  const generatedFiles = applicationState.generatedFiles;

  if (!generatedFiles) {
    return;
  }

  downloadBlob(
    generatedFiles.pngBlob,
    generatedFiles.pngFileName,
  );
});

elements.downloadYamlButton.addEventListener("click", () => {
  const generatedFiles = applicationState.generatedFiles;

  if (!generatedFiles) {
    return;
  }

  downloadBlob(
    generatedFiles.yamlBlob,
    generatedFiles.yamlFileName,
  );
});


/* ==========================================
   Application Start
========================================== */

applyLocalizedText();
