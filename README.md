# Screenshot Stitcher — v0.1

A static, browser-only screenshot stitcher intended for GitHub Pages.

## v0.1 goal

Select exactly two same-width screenshots, detect an exact vertical overlap,
remove the duplicated rows, and download:

- one stitched PNG
- one YAML sidecar containing processing metadata and the PNG SHA-256

No source image is uploaded to a server.

## Important limitation

v0.1 only detects an overlap when the bottom rows of the first image are
pixel-identical to the top rows of the second image.

Screenshots containing fixed browser/app chrome, animation, timestamps,
scroll indicators, or other changing pixels may not match yet.

Those cases should be addressed in later versions with explicit filters or
masking rules rather than silently introducing fuzzy image synthesis.
