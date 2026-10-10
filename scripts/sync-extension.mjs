// Copies the shared page extractor into the browser extension folder.
import { copyFileSync } from "node:fs";

copyFileSync(new URL("../public/extractor.js", import.meta.url), new URL("../extension/extractor.js", import.meta.url));
console.log("extension/extractor.js updated from public/extractor.js");
