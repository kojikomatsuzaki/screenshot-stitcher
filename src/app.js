import {
  decodeImageFile,
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

/*
 * The first version keeps state intentionally small and local.
 * If more filters or reorderable inputs are added later, this object can
 * become the boundary between the UI and a richer processing pipeline.
 */

const applicationState = {
  selectedFiles: [],
  isProcessing: false,
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

  /*
   * Revocation is delayed by one event-loop turn because some mobile
   * browsers need the object URL to remain alive until download dispatch.
   */
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}


/* ==========================================
   Processing Workflow
========================================== */

async function handleStitch() {
  if (applicationState.selectedFiles.length !== 2) {
    elements.processStatus.textContent = t("needExactlyTwoFiles");
    return;
  }

  setProcessingState(true);
  elements.processStatus.textContent = t("processing");

  const [firstFile, secondFile] = applicationState.selectedFiles;

  let firstBitmap;
  let secondBitmap;

  try {
    firstBitmap = await decodeImageFile(firstFile);
    secondBitmap = await decodeImageFile(secondFile);

    const result = await stitchTwoImages(
      firstBitmap,
      secondBitmap,
      {
        minimumOverlapRows: 32,
      },
    );

    elements.processStatus.textContent =
      t("overlapFound", result.overlapRows);

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
      overlapRows: result.overlapRows,
      sourceFiles: applicationState.selectedFiles,
    });

    downloadBlob(result.pngBlob, pngFileName);

    downloadBlob(
      new Blob([yamlText], {
        type: "text/yaml;charset=utf-8",
      }),
      yamlFileName,
    );

    elements.processStatus.textContent = t("complete");
  } catch (error) {
    console.error(error);

    if (error.message === "WIDTH_MISMATCH") {
      elements.processStatus.textContent = t("widthMismatch");
    } else if (error.message === "OVERLAP_NOT_FOUND") {
      elements.processStatus.textContent = t("overlapNotFound");
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

  elements.processStatus.textContent = "";
  updateSelectedFilesStatus();
});

elements.stitchButton.addEventListener("click", handleStitch);
elements.resetButton.addEventListener("click", resetApplication);


/* ==========================================
   Application Start
========================================== */

applyLocalizedText();
