/* ==========================================
   Image Loading
========================================== */

/*
 * createImageBitmap decodes without inserting images into the DOM.
 * That keeps decoding an implementation detail of the processing layer.
 */

export async function decodeImageFile(file) {
  return createImageBitmap(file);
}


/* ==========================================
   Pixel Extraction
========================================== */

function createImageDataFromBitmap(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d", {
    alpha: true,
    willReadFrequently: true,
  });

  context.drawImage(bitmap, 0, 0);

  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}


/* ==========================================
   Row Fingerprints
========================================== */

/*
 * The overlap problem is reduced from "compare every candidate rectangle"
 * to "find the longest row sequence that is a suffix of image A and
 * a prefix of image B".
 *
 * A lightweight 32-bit FNV-1a fingerprint makes that search linear in
 * the number of rows. The final candidate is still verified byte-for-byte,
 * so the fingerprint is only an accelerator, never the source of truth.
 */

function createRowFingerprints(imageData) {
  const { width, height, data } = imageData;
  const bytesPerRow = width * 4;
  const fingerprints = new Uint32Array(height);

  for (let row = 0; row < height; row += 1) {
    const rowStart = row * bytesPerRow;
    const rowEnd = rowStart + bytesPerRow;

    let hash = 0x811c9dc5;

    for (let index = rowStart; index < rowEnd; index += 1) {
      hash ^= data[index];
      hash = Math.imul(hash, 0x01000193);
    }

    fingerprints[row] = hash >>> 0;
  }

  return fingerprints;
}


/* ==========================================
   Prefix Table
========================================== */

/*
 * KMP is used here because it gives a deterministic linear-time search.
 * The prefix table represents repeated row patterns without introducing
 * heuristics or lossy image matching.
 */

function createPrefixTable(pattern) {
  const table = new Uint32Array(pattern.length);
  let matchedLength = 0;

  for (let index = 1; index < pattern.length; index += 1) {
    while (
      matchedLength > 0 &&
      pattern[index] !== pattern[matchedLength]
    ) {
      matchedLength = table[matchedLength - 1];
    }

    if (pattern[index] === pattern[matchedLength]) {
      matchedLength += 1;
    }

    table[index] = matchedLength;
  }

  return table;
}


/* ==========================================
   Exact Overlap Detection
========================================== */

function findSuffixPrefixCandidate(firstRows, secondRows) {
  const prefixTable = createPrefixTable(secondRows);
  let matchedLength = 0;

  for (const rowFingerprint of firstRows) {
    if (matchedLength === secondRows.length) {
      matchedLength = prefixTable[matchedLength - 1];
    }

    while (
      matchedLength > 0 &&
      rowFingerprint !== secondRows[matchedLength]
    ) {
      matchedLength = prefixTable[matchedLength - 1];
    }

    if (rowFingerprint === secondRows[matchedLength]) {
      matchedLength += 1;
    }
  }

  return matchedLength;
}

function verifyExactOverlap(firstImageData, secondImageData, overlapRows) {
  const width = firstImageData.width;
  const bytesPerRow = width * 4;

  const firstStart =
    (firstImageData.height - overlapRows) * bytesPerRow;
  const firstEnd = firstImageData.height * bytesPerRow;
  const secondEnd = overlapRows * bytesPerRow;

  const firstPixels = firstImageData.data.subarray(firstStart, firstEnd);
  const secondPixels = secondImageData.data.subarray(0, secondEnd);

  if (firstPixels.length !== secondPixels.length) {
    return false;
  }

  for (let index = 0; index < firstPixels.length; index += 1) {
    if (firstPixels[index] !== secondPixels[index]) {
      return false;
    }
  }

  return true;
}

export function detectExactVerticalOverlap(
  firstImageData,
  secondImageData,
  { minimumOverlapRows = 16 } = {},
) {
  const firstRows = createRowFingerprints(firstImageData);
  const secondRows = createRowFingerprints(secondImageData);

  let candidateRows = findSuffixPrefixCandidate(firstRows, secondRows);

  /*
   * A hash collision is unlikely, but this loop makes collision handling
   * explicit: if verification fails, fall back through shorter valid
   * border candidates instead of trusting the hash.
   */
  while (candidateRows >= minimumOverlapRows) {
    if (
      verifyExactOverlap(
        firstImageData,
        secondImageData,
        candidateRows,
      )
    ) {
      return candidateRows;
    }

    candidateRows -= 1;
  }

  return 0;
}


/* ==========================================
   Stitch Assembly
========================================== */

/*
 * The output contains only pixels copied from the two source images.
 * Canvas is used as a placement surface, not as a resampling stage:
 * both drawImage calls are made at native size with no scaling.
 */

export async function stitchTwoImages(
  firstBitmap,
  secondBitmap,
  options = {},
) {
  if (firstBitmap.width !== secondBitmap.width) {
    throw new Error("WIDTH_MISMATCH");
  }

  const firstImageData = createImageDataFromBitmap(firstBitmap);
  const secondImageData = createImageDataFromBitmap(secondBitmap);

  const overlapRows = detectExactVerticalOverlap(
    firstImageData,
    secondImageData,
    options,
  );

  if (overlapRows === 0) {
    throw new Error("OVERLAP_NOT_FOUND");
  }

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = firstBitmap.width;
  outputCanvas.height =
    firstBitmap.height +
    secondBitmap.height -
    overlapRows;

  const outputContext = outputCanvas.getContext("2d", {
    alpha: true,
  });

  outputContext.drawImage(firstBitmap, 0, 0);

  outputContext.drawImage(
    secondBitmap,
    0,
    overlapRows,
    secondBitmap.width,
    secondBitmap.height - overlapRows,
    0,
    firstBitmap.height,
    secondBitmap.width,
    secondBitmap.height - overlapRows,
  );

  const pngBlob = await new Promise((resolve, reject) => {
    outputCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("PNG_ENCODING_FAILED"));
      }
    }, "image/png");
  });

  return {
    pngBlob,
    overlapRows,
    outputWidth: outputCanvas.width,
    outputHeight: outputCanvas.height,
  };
}
