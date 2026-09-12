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
   Approximate Row Profiles
========================================== */

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

  return Math.max(
    0,
    1 - ((totalDifference / firstProfile.length) / 255),
  );
}


/* ==========================================
   Fixed Edge Diagnostics
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
    const row = edge === "top"
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
    averageSimilarity: acceptedRows > 0
      ? similarityTotal / acceptedRows
      : 0,
  };
}


/* ==========================================
   Pairwise Overlap Detection
========================================== */

function findApproximateVerticalMatch(
  firstProfiles,
  secondProfiles,
  {
    firstContentStart,
    firstContentEnd,
    secondContentStart,
    secondContentEnd,
    minimumOverlapRows = 128,
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

    const averageSimilarity = sampleCount > 0
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
      };
    }
  }

  return best;
}

function analyzePair(
  firstProfiles,
  secondProfiles,
  {
    minimumApproximateOverlapRows = 128,
    minimumApproximateSimilarity = 0.96,
  } = {},
) {
  const fixedTop = estimateFixedEdgeRows(
    firstProfiles,
    secondProfiles,
    { edge: "top" },
  );
  const fixedBottom = estimateFixedEdgeRows(
    firstProfiles,
    secondProfiles,
    { edge: "bottom" },
  );

  const firstContentStart = fixedTop.rows;
  const secondContentStart = fixedTop.rows;
  const firstContentEnd = Math.max(
    firstContentStart,
    firstProfiles.length - fixedBottom.rows,
  );
  const secondContentEnd = Math.max(
    secondContentStart,
    secondProfiles.length - fixedBottom.rows,
  );

  const match = findApproximateVerticalMatch(
    firstProfiles,
    secondProfiles,
    {
      firstContentStart,
      firstContentEnd,
      secondContentStart,
      secondContentEnd,
      minimumOverlapRows: minimumApproximateOverlapRows,
    },
  );

  if (
    !match ||
    match.averageSimilarity < minimumApproximateSimilarity
  ) {
    throw new Error("OVERLAP_NOT_FOUND");
  }

  return {
    matchMode: "approximate",
    ...match,
    fixedTop,
    fixedBottom,
    contentRegion: {
      firstStartRow: firstContentStart,
      firstEndRow: firstContentEnd,
      secondStartRow: secondContentStart,
      secondEndRow: secondContentEnd,
    },
  };
}


/* ==========================================
   Image Roles and Output Segments
========================================== */

function resolveRole(index, imageCount) {
  if (index === 0) {
    return "first";
  }

  if (index === imageCount - 1) {
    return "last";
  }

  return "middle";
}

function buildSegments(bitmaps, pairMatches) {
  return bitmaps.map((bitmap, index) => {
    const role = resolveRole(index, bitmaps.length);

    let sourceStartRow;
    let sourceEndRow;

    if (role === "first") {
      sourceStartRow = 0;
      sourceEndRow = pairMatches[0].firstStartRow;
    } else if (role === "last") {
      sourceStartRow = pairMatches[index - 1].secondStartRow;
      sourceEndRow = bitmap.height;
    } else {
      sourceStartRow = pairMatches[index - 1].secondStartRow;
      sourceEndRow = pairMatches[index].firstStartRow;
    }

    if (sourceEndRow <= sourceStartRow) {
      throw new Error("INVALID_SEGMENT_GEOMETRY");
    }

    return {
      index,
      role,
      sourceStartRow,
      sourceEndRow,
      rowCount: sourceEndRow - sourceStartRow,
    };
  });
}


/* ==========================================
   Sequence Analysis
========================================== */

export function diagnoseImageSequence(bitmaps, options = {}) {
  if (bitmaps.length < 2) {
    throw new Error("NEED_AT_LEAST_TWO_IMAGES");
  }

  const width = bitmaps[0].width;

  if (bitmaps.some((bitmap) => bitmap.width !== width)) {
    throw new Error("WIDTH_MISMATCH");
  }

  const imageDataList = bitmaps.map(createImageDataFromBitmap);
  const profilesList = imageDataList.map(createRowProfiles);
  const pairMatches = [];

  for (let index = 0; index < bitmaps.length - 1; index += 1) {
    pairMatches.push(
      analyzePair(
        profilesList[index],
        profilesList[index + 1],
        options,
      ),
    );
  }

  const segments = buildSegments(bitmaps, pairMatches);

  return {
    width,
    imageCount: bitmaps.length,
    images: bitmaps.map((bitmap, index) => ({
      index,
      role: resolveRole(index, bitmaps.length),
      width: bitmap.width,
      height: bitmap.height,
      segment: segments[index],
    })),
    pairMatches,
  };
}


/* ==========================================
   Stitch Assembly
========================================== */

export async function stitchImages(bitmaps, options = {}) {
  const diagnostics = diagnoseImageSequence(bitmaps, options);
  const outputHeight = diagnostics.images.reduce(
    (total, image) => total + image.segment.rowCount,
    0,
  );

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = diagnostics.width;
  outputCanvas.height = outputHeight;

  const outputContext = outputCanvas.getContext("2d", {
    alpha: true,
  });

  let destinationY = 0;

  for (const image of diagnostics.images) {
    const bitmap = bitmaps[image.index];
    const segment = image.segment;

    outputContext.drawImage(
      bitmap,
      0,
      segment.sourceStartRow,
      bitmap.width,
      segment.rowCount,
      0,
      destinationY,
      bitmap.width,
      segment.rowCount,
    );

    destinationY += segment.rowCount;
  }

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
    outputWidth: outputCanvas.width,
    outputHeight: outputCanvas.height,
    diagnostics,
  };
}
