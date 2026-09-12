/* ==========================================
   Image Loading
========================================== */

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
   Approximate Row Profiles
========================================== */

/*
 * Exact pixel equality is useful for final verification, but screenshots
 * often contain small changes in status bars and app chrome. For diagnosis,
 * each row is also represented by a low-resolution luminance profile.
 *
 * This profile deliberately ignores tiny local changes while preserving the
 * broad visual structure of the row. It is used only for diagnostics in the
 * current version; production stitching still uses exact verification.
 */

function createRowProfiles(
  imageData,
  {
    horizontalBins = 24,
    horizontalSampleStep = 4,
  } = {},
) {
  const { width, height, data } = imageData;
  const profiles = new Array(height);

  for (let row = 0; row < height; row += 1) {
    const profile = new Float32Array(horizontalBins);
    const counts = new Uint32Array(horizontalBins);

    for (let x = 0; x < width; x += horizontalSampleStep) {
      const bin = Math.min(
        horizontalBins - 1,
        Math.floor((x / width) * horizontalBins),
      );

      const pixelIndex = (row * width + x) * 4;
      const red = data[pixelIndex];
      const green = data[pixelIndex + 1];
      const blue = data[pixelIndex + 2];

      const luminance =
        (0.2126 * red) +
        (0.7152 * green) +
        (0.0722 * blue);

      profile[bin] += luminance;
      counts[bin] += 1;
    }

    for (let bin = 0; bin < horizontalBins; bin += 1) {
      if (counts[bin] > 0) {
        profile[bin] /= counts[bin];
      }
    }

    profiles[row] = profile;
  }

  return profiles;
}

function calculateProfileSimilarity(firstProfile, secondProfile) {
  let totalDifference = 0;

  for (let index = 0; index < firstProfile.length; index += 1) {
    totalDifference += Math.abs(
      firstProfile[index] - secondProfile[index],
    );
  }

  const meanDifference =
    totalDifference / firstProfile.length;

  return Math.max(0, 1 - (meanDifference / 255));
}


/* ==========================================
   Exact Match Verification
========================================== */

function verifyExactRectangle(
  firstImageData,
  secondImageData,
  firstStartRow,
  secondStartRow,
  rowCount,
) {
  const bytesPerRow = firstImageData.width * 4;

  const firstStart = firstStartRow * bytesPerRow;
  const firstEnd = (firstStartRow + rowCount) * bytesPerRow;
  const secondStart = secondStartRow * bytesPerRow;
  const secondEnd = (secondStartRow + rowCount) * bytesPerRow;

  const firstPixels = firstImageData.data.subarray(firstStart, firstEnd);
  const secondPixels = secondImageData.data.subarray(secondStart, secondEnd);

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


/* ==========================================
   Exact Vertical Match Detection
========================================== */

export function detectExactVerticalMatch(
  firstImageData,
  secondImageData,
  { minimumOverlapRows = 32 } = {},
) {
  const firstRows = createRowFingerprints(firstImageData);
  const secondRows = createRowFingerprints(secondImageData);

  let previousMatches = new Uint32Array(secondRows.length + 1);
  let currentMatches = new Uint32Array(secondRows.length + 1);

  let bestMatch = null;

  for (let firstRow = 0; firstRow < firstRows.length; firstRow += 1) {
    currentMatches.fill(0);

    for (let secondRow = 0; secondRow < secondRows.length; secondRow += 1) {
      if (firstRows[firstRow] !== secondRows[secondRow]) {
        continue;
      }

      const rowCount = previousMatches[secondRow] + 1;
      currentMatches[secondRow + 1] = rowCount;

      if (rowCount < minimumOverlapRows) {
        continue;
      }

      const firstStartRow = firstRow - rowCount + 1;
      const secondStartRow = secondRow - rowCount + 1;
      const verticalOffset = firstStartRow - secondStartRow;

      if (verticalOffset <= 0) {
        continue;
      }

      if (
        bestMatch === null ||
        rowCount > bestMatch.rowCount ||
        (
          rowCount === bestMatch.rowCount &&
          verticalOffset > bestMatch.verticalOffset
        )
      ) {
        bestMatch = {
          firstStartRow,
          secondStartRow,
          rowCount,
          verticalOffset,
        };
      }
    }

    const swapBuffer = previousMatches;
    previousMatches = currentMatches;
    currentMatches = swapBuffer;
  }

  if (bestMatch === null) {
    return null;
  }

  if (
    !verifyExactRectangle(
      firstImageData,
      secondImageData,
      bestMatch.firstStartRow,
      bestMatch.secondStartRow,
      bestMatch.rowCount,
    )
  ) {
    return null;
  }

  return bestMatch;
}

export function detectExactVerticalOverlap(
  firstImageData,
  secondImageData,
  options = {},
) {
  return detectExactVerticalMatch(
    firstImageData,
    secondImageData,
    options,
  )?.rowCount ?? 0;
}


/* ==========================================
   Fixed UI Diagnostics
========================================== */

function estimateFixedEdgeRows(
  firstProfiles,
  secondProfiles,
  {
    similarityThreshold = 0.94,
    maximumFraction = 0.35,
    edge = "top",
  } = {},
) {
  const comparableRows = Math.min(
    firstProfiles.length,
    secondProfiles.length,
  );

  const maximumRows = Math.floor(
    comparableRows * maximumFraction,
  );

  let acceptedRows = 0;
  let similarityTotal = 0;

  for (let index = 0; index < maximumRows; index += 1) {
    const row =
      edge === "top"
        ? index
        : comparableRows - 1 - index;

    const similarity = calculateProfileSimilarity(
      firstProfiles[row],
      secondProfiles[row],
    );

    if (similarity < similarityThreshold) {
      break;
    }

    acceptedRows += 1;
    similarityTotal += similarity;
  }

  return {
    rows: acceptedRows,
    averageSimilarity:
      acceptedRows > 0
        ? similarityTotal / acceptedRows
        : 0,
    similarityThreshold,
  };
}


/* ==========================================
   Approximate Overlap Diagnostics
========================================== */

function findApproximateVerticalMatch(
  firstProfiles,
  secondProfiles,
  {
    firstContentStart,
    firstContentEnd,
    secondContentStart,
    secondContentEnd,
    minimumOverlapRows = 64,
    verticalSampleStep = 4,
  },
) {
  let best = null;

  const maximumOffset = Math.max(
    1,
    firstContentEnd - firstContentStart - minimumOverlapRows,
  );

  for (let offset = 1; offset <= maximumOffset; offset += 1) {
    const firstStart = Math.max(
      firstContentStart,
      secondContentStart + offset,
    );

    const secondStart = firstStart - offset;

    const rowCount = Math.min(
      firstContentEnd - firstStart,
      secondContentEnd - secondStart,
    );

    if (rowCount < minimumOverlapRows) {
      continue;
    }

    let similarityTotal = 0;
    let sampleCount = 0;

    for (
      let relativeRow = 0;
      relativeRow < rowCount;
      relativeRow += verticalSampleStep
    ) {
      similarityTotal += calculateProfileSimilarity(
        firstProfiles[firstStart + relativeRow],
        secondProfiles[secondStart + relativeRow],
      );
      sampleCount += 1;
    }

    const averageSimilarity =
      sampleCount > 0
        ? similarityTotal / sampleCount
        : 0;

    if (
      best === null ||
      averageSimilarity > best.averageSimilarity
    ) {
      best = {
        firstStartRow: firstStart,
        secondStartRow: secondStart,
        rowCount,
        verticalOffset: offset,
        averageSimilarity,
        sampleCount,
      };
    }
  }

  return best;
}


/* ==========================================
   Diagnostic Analysis
========================================== */

export function diagnoseImagePair(
  firstBitmap,
  secondBitmap,
  { minimumOverlapRows = 32 } = {},
) {
  const firstImageData = createImageDataFromBitmap(firstBitmap);
  const secondImageData = createImageDataFromBitmap(secondBitmap);

  const firstRows = createRowFingerprints(firstImageData);
  const secondRows = createRowFingerprints(secondImageData);

  const firstProfiles = createRowProfiles(firstImageData);
  const secondProfiles = createRowProfiles(secondImageData);

  let previousMatches = new Uint32Array(secondRows.length + 1);
  let currentMatches = new Uint32Array(secondRows.length + 1);

  let matchingRowPairs = 0;
  let bestAny = null;
  let bestPositiveOffset = null;

  for (let firstRow = 0; firstRow < firstRows.length; firstRow += 1) {
    currentMatches.fill(0);

    for (let secondRow = 0; secondRow < secondRows.length; secondRow += 1) {
      if (firstRows[firstRow] !== secondRows[secondRow]) {
        continue;
      }

      matchingRowPairs += 1;

      const rowCount = previousMatches[secondRow] + 1;
      currentMatches[secondRow + 1] = rowCount;

      const candidate = {
        firstStartRow: firstRow - rowCount + 1,
        secondStartRow: secondRow - rowCount + 1,
        rowCount,
      };

      candidate.verticalOffset =
        candidate.firstStartRow - candidate.secondStartRow;

      if (bestAny === null || rowCount > bestAny.rowCount) {
        bestAny = candidate;
      }

      if (
        candidate.verticalOffset > 0 &&
        (
          bestPositiveOffset === null ||
          rowCount > bestPositiveOffset.rowCount
        )
      ) {
        bestPositiveOffset = candidate;
      }
    }

    const swapBuffer = previousMatches;
    previousMatches = currentMatches;
    currentMatches = swapBuffer;
  }

  const fixedTop = estimateFixedEdgeRows(
    firstProfiles,
    secondProfiles,
    {
      edge: "top",
    },
  );

  const fixedBottom = estimateFixedEdgeRows(
    firstProfiles,
    secondProfiles,
    {
      edge: "bottom",
    },
  );

  const firstContentStart = fixedTop.rows;
  const secondContentStart = fixedTop.rows;
  const firstContentEnd = Math.max(
    firstContentStart,
    firstBitmap.height - fixedBottom.rows,
  );
  const secondContentEnd = Math.max(
    secondContentStart,
    secondBitmap.height - fixedBottom.rows,
  );

  const approximateMatch = findApproximateVerticalMatch(
    firstProfiles,
    secondProfiles,
    {
      firstContentStart,
      firstContentEnd,
      secondContentStart,
      secondContentEnd,
      minimumOverlapRows: Math.max(64, minimumOverlapRows),
    },
  );

  return {
    firstWidth: firstBitmap.width,
    firstHeight: firstBitmap.height,
    secondWidth: secondBitmap.width,
    secondHeight: secondBitmap.height,
    minimumOverlapRows,
    matchingRowPairs,
    bestAny,
    bestPositiveOffset,
    fixedTop,
    fixedBottom,
    contentRegion: {
      firstStartRow: firstContentStart,
      firstEndRow: firstContentEnd,
      secondStartRow: secondContentStart,
      secondEndRow: secondContentEnd,
    },
    approximateMatch,
  };
}


/* ==========================================
   Stitch Assembly
========================================== */

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

  const match = detectExactVerticalMatch(
    firstImageData,
    secondImageData,
    options,
  );

  if (match === null) {
    throw new Error("OVERLAP_NOT_FOUND");
  }

  const firstSpliceRow =
    match.firstStartRow + match.rowCount;
  const secondSpliceRow =
    match.secondStartRow + match.rowCount;

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = firstBitmap.width;
  outputCanvas.height =
    firstSpliceRow +
    (secondBitmap.height - secondSpliceRow);

  const outputContext = outputCanvas.getContext("2d", {
    alpha: true,
  });

  outputContext.drawImage(
    firstBitmap,
    0,
    0,
    firstBitmap.width,
    firstSpliceRow,
    0,
    0,
    firstBitmap.width,
    firstSpliceRow,
  );

  outputContext.drawImage(
    secondBitmap,
    0,
    secondSpliceRow,
    secondBitmap.width,
    secondBitmap.height - secondSpliceRow,
    0,
    firstSpliceRow,
    secondBitmap.width,
    secondBitmap.height - secondSpliceRow,
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
    overlapRows: match.rowCount,
    firstMatchStartRow: match.firstStartRow,
    secondMatchStartRow: match.secondStartRow,
    verticalOffset: match.verticalOffset,
    outputWidth: outputCanvas.width,
    outputHeight: outputCanvas.height,
  };
}
