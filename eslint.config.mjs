import { createRequire } from "node:module";
import js from "@eslint/js";
import globals from "globals";

const require = createRequire(import.meta.url);
const local = { rules: { "storage-in-try": require("./eslint-rules/storage-in-try.js") } };

export default [
  { ignores: ["node_modules/", "data/", "test-results/", "playwright-report/"] },
  js.configs.recommended,
  {
    files: ["app.js", "lib.js"], // classic scripts: top-level names are shared between them
    languageOptions: { sourceType: "script", globals: { ...globals.browser, L: "readonly", Chart: "readonly", module: "readonly" } },
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] }, // storage access is wrapped in try { ... } catch {}
  },
  { files: ["app.js"], languageOptions: { globals: Object.fromEntries(["STEPS", "band", "hasWind", "arrowOn", "lambert", "esc", "viennaKey", "keyMs", "anchorMs", "slice", "latest", "extreme", "refroze", "valueState", "misplaced", "goodOnly", "refreshStale", "staleAfter", "offlineAfter"].map((n) => [n, "readonly"])) } }, // from lib.js
  {
    files: ["**/*.mjs", "**/*.js"],
    ignores: ["app.js", "lib.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  { files: ["**/*.mjs"], languageOptions: { sourceType: "module" } },
  {
    files: ["app.js", "lib.js"],
    plugins: { local },
    rules: {
      "local/storage-in-try": "error",
      // charts must never draw a line across missing data (#40, #42)
      "no-restricted-syntax": ["error", { selector: "Property[key.name='spanGaps'][value.value=true]", message: "spanGaps: true draws across missing data." }],
    },
  },
];
