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
 * Each full-width source row receives a lightweight 32-bit FNV-1a
 * fingerprint. The fingerprints make candidate discovery practical on a
 * phone, but they never become the source of truth: the winning rectangle
 * is verified byte-for-byte before it is used.
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
   Internal Vertical Match Detection
========================================== */

/*
 * Mobile screenshots often contain browser chrome at both ends of the
 * image. Therefore the shared page area is not necessarily a suffix of the
 * first screenshot and a prefix of the second screenshot.
 *
 * Instead, find the longest common contiguous sequence of full-width rows
 * anywhere inside both images. A positive vertical offset is required:
 * the matching content must appear lower in the first screenshot than in
 * the second screenshot, which is the geometry of a downward scroll.
 *
 * Dynamic programming is used with two one-dimensional buffers, keeping
 * memory proportional to image height rather than height squared.
 */

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

    for (
      let secondRow = 0;
      secondRow < secondRows.length;
      secondRow += 1
    ) {
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

/*
 * Kept as a small compatibility wrapper because the first public version
 * exposed an overlap-row count. New stitching code uses the richer match
 * object above so it also knows where the shared rectangle begins.
 */
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
   Stitch Assembly
========================================== */

/*
 * The splice is made at the end of the verified shared rectangle.
 * Everything above that point comes from screenshot 1; everything below
 * it comes from screenshot 2. This naturally removes the first screenshot's
 * lower browser chrome while retaining the second screenshot's final lower
 * edge.
 *
 * No source pixels are resized, interpolated, or generated. Canvas is only
 * used as a native-size placement surface and PNG encoder.
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
