/* ==========================================
   Locale Catalog
========================================== */

/*
 * UI strings live outside app.js so presentation language can grow
 * without coupling translation work to image-processing behavior.
 * No external i18n library is needed for a small mobile interface.
 */

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
    needExactlyTwoFiles: "For this first version, select exactly two images.",
    processing: "Finding overlap…",
    widthMismatch: "The two images must have the same pixel width.",
    overlapNotFound: "No usable vertical overlap was found.",
    overlapFound: (rows) => `Overlap: ${rows} row(s). Creating PNG…`,
    complete: "PNG and YAML were created. Save each file with the buttons below.",
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
    needExactlyTwoFiles: "最初の版では、画像を2枚ちょうど選択してください。",
    processing: "重複部分を検出しています…",
    widthMismatch: "2枚の画像は同じ画素幅である必要があります。",
    overlapNotFound: "利用できる縦方向の重複部分を検出できませんでした。",
    overlapFound: (rows) => `重複部分を${rows}行検出しました。PNGを生成しています…`,
    complete: "PNGとYAMLを生成しました。下のボタンからそれぞれ保存してください。",
    failed: "処理に失敗しました。",
  },
};


/* ==========================================
   Locale Resolution
========================================== */

/*
 * navigator.languages is preferred because it preserves the user's
 * language priority rather than assuming one fixed browser language.
 */

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
