/* ==========================================
   Locale Catalog
========================================== */

const messageCatalog = {
  en: {
    appTitle: "Screenshot Stitcher",
    appDescription: "Images stay in this browser. Nothing is uploaded.",
    selectFiles: "Select Files",
    outputFileName: "Output File Name",
    stitch: "Stitch",
    reset: "Reset",
    savePng: "Save PNG",
    saveYaml: "Save YAML",
    noFilesSelected: "No files selected.",
    selectedFiles: (count) => `${count} file(s) selected.`,
    needAtLeastTwoFiles: "Select at least two images.",
    processing: "Finding overlapping content…",
    widthMismatch: "All images must have the same pixel width.",
    overlapNotFound: "No acceptable vertical overlap was found between one or more adjacent images.",
    invalidGeometry: "The detected overlaps produced an invalid middle-image segment.",
    complete: "PNG and YAML were created.",
    failed: "Processing failed.",
  },

  ja: {
    appTitle: "スクリーンショット・スティッチャー",
    appDescription: "画像はブラウザ内だけで処理し、サーバーへ送信しません。",
    selectFiles: "ファイルを選択",
    outputFileName: "出力ファイル名",
    stitch: "連結",
    reset: "リセット",
    savePng: "PNGを保存",
    saveYaml: "YAMLを保存",
    noFilesSelected: "ファイルは選択されていません。",
    selectedFiles: (count) => `${count}個のファイルを選択しました。`,
    needAtLeastTwoFiles: "画像を2枚以上選択してください。",
    processing: "隣接画像の重複部分を検出しています…",
    widthMismatch: "すべての画像は同じ画素幅である必要があります。",
    overlapNotFound: "隣接する画像のどこかで、採用可能な縦方向の重複を検出できませんでした。",
    invalidGeometry: "検出した重複関係から途中画像の有効な範囲を作れませんでした。",
    complete: "PNGとYAMLを生成しました。",
    failed: "処理に失敗しました。",
  },
};


/* ==========================================
   Locale Resolution
========================================== */

export function resolveLocale() {
  const requestedLanguages = navigator.languages ?? [navigator.language];

  for (const language of requestedLanguages) {
    const baseLanguage = language.toLowerCase().split("-")[0];

    if (messageCatalog[baseLanguage]) {
      return baseLanguage;
    }
  }

  return "en";
}

export function createTranslator(locale) {
  const messages = messageCatalog[locale] ?? messageCatalog.en;

  return function translate(key, ...parameters) {
    const message = messages[key];

    return typeof message === "function"
      ? message(...parameters)
      : message;
  };
}
