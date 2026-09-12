/* ==========================================
   SHA-256
========================================== */

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

function quoteYamlString(value) {
  return JSON.stringify(String(value));
}

export function createSidecarYaml({
  outputFileName,
  sha256,
  outputWidth,
  outputHeight,
  diagnostics,
  sourceFiles,
}) {
  const imageLines = diagnostics.images.flatMap((image) => {
    const sourceFile = sourceFiles[image.index];

    return [
      `  - index: ${image.index + 1}`,
      `    role: ${quoteYamlString(image.role)}`,
      `    name: ${quoteYamlString(sourceFile.name)}`,
      `    size_bytes: ${sourceFile.size}`,
      `    type: ${quoteYamlString(sourceFile.type || "unknown")}`,
      `    width_px: ${image.width}`,
      `    height_px: ${image.height}`,
      `    retained_start_row: ${image.segment.sourceStartRow}`,
      `    retained_end_row: ${image.segment.sourceEndRow}`,
      `    retained_rows: ${image.segment.rowCount}`,
    ];
  });

  const pairLines = diagnostics.pairMatches.flatMap((pair, index) => [
    `  - first_image: ${index + 1}`,
    `    second_image: ${index + 2}`,
    `    mode: ${quoteYamlString(`${pair.matchMode}_vertical_overlap`)}`,
    `    vertical_offset_rows: ${pair.verticalOffset}`,
    `    overlap_rows: ${pair.rowCount}`,
    `    similarity: ${pair.averageSimilarity}`,
    `    first_seam_row: ${pair.seam.firstRow}`,
    `    second_seam_row: ${pair.seam.secondRow}`,
    `    first_match_start_row: ${pair.matchedRegion.firstStartRow}`,
    `    first_match_end_row: ${pair.matchedRegion.firstEndRow}`,
    `    second_match_start_row: ${pair.matchedRegion.secondStartRow}`,
    `    second_match_end_row: ${pair.matchedRegion.secondEndRow}`,
    `    first_search_start_row: ${pair.searchRegion.firstStartRow}`,
    `    first_search_end_row: ${pair.searchRegion.firstEndRow}`,
    `    second_search_start_row: ${pair.searchRegion.secondStartRow}`,
    `    second_search_end_row: ${pair.searchRegion.secondEndRow}`,
    `    fixed_top_candidate_rows: ${pair.fixedTop.rows}`,
    `    fixed_bottom_candidate_rows: ${pair.fixedBottom.rows}`,
  ]);

  return [
    "schema_version: 1",
    "generator:",
    '  name: "screenshot-stitcher"',
    '  version: "0.2.4"',
    "processing:",
    '  mode: "central_region_approximate_vertical_overlap"',
    "  resampling: false",
    "  interpolation: false",
    "  generated_pixels: false",
    `  image_count: ${diagnostics.imageCount}`,
    "  role_policy:",
    '    first: "keep from top edge through the first overlap seam"',
    '    middle: "keep rows between incoming and outgoing overlap seams"',
    '    last: "keep from the final overlap seam through the bottom edge"',
    "pairs:",
    ...pairLines,
    "output:",
    `  file_name: ${quoteYamlString(outputFileName)}`,
    '  media_type: "image/png"',
    `  width_px: ${outputWidth}`,
    `  height_px: ${outputHeight}`,
    `  sha256: ${quoteYamlString(sha256)}`,
    "sources:",
    ...imageLines,
    "",
  ].join("\n");
}
