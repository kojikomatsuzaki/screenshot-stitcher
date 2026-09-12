/* ==========================================
   SHA-256
========================================== */

/*
 * Web Crypto is built into modern browsers and avoids adding a hashing
 * dependency merely to create provenance metadata.
 */

export async function calculateSha256Hex(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}


/* ==========================================
   YAML Serialization
========================================== */

/*
 * This sidecar has a deliberately small, fixed schema.
 * Hand-writing this limited YAML keeps the project dependency-free while
 * remaining readable. If the schema later becomes arbitrary or nested,
 * replacing this function with a real YAML serializer would be justified.
 */

function quoteYamlString(value) {
  return JSON.stringify(String(value));
}

function formatOptionalNumber(value) {
  return Number.isFinite(value) ? String(value) : "null";
}

export function createSidecarYaml({
  outputFileName,
  sha256,
  outputWidth,
  outputHeight,
  matchMode,
  overlapRows,
  averageSimilarity,
  firstMatchStartRow,
  secondMatchStartRow,
  firstSpliceRow,
  secondSpliceRow,
  sourceFiles,
}) {
  const sourceLines = sourceFiles
    .map((file) => [
      `  - name: ${quoteYamlString(file.name)}`,
      `    size_bytes: ${file.size}`,
      `    type: ${quoteYamlString(file.type || "unknown")}`,
    ].join("\n"))
    .join("\n");

  return [
    "schema_version: 1",
    "generator:",
    '  name: "screenshot-stitcher"',
    '  version: "0.2.0"',
    "processing:",
    `  mode: ${quoteYamlString(`${matchMode}_vertical_overlap`)}`,
    "  resampling: false",
    "  interpolation: false",
    "  generated_pixels: false",
    `  overlap_rows: ${overlapRows}`,
    `  similarity: ${formatOptionalNumber(averageSimilarity)}`,
    `  first_match_start_row: ${firstMatchStartRow}`,
    `  second_match_start_row: ${secondMatchStartRow}`,
    `  first_splice_row: ${firstSpliceRow}`,
    `  second_splice_row: ${secondSpliceRow}`,
    "output:",
    `  file_name: ${quoteYamlString(outputFileName)}`,
    '  media_type: "image/png"',
    `  width_px: ${outputWidth}`,
    `  height_px: ${outputHeight}`,
    `  sha256: ${quoteYamlString(sha256)}`,
    "sources:",
    sourceLines,
    "",
  ].join("\n");
}
