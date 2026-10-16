// Builds index.html (an artifact page body) from src/.
//   node tools/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8");

const head = `<title>Swing Lab</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">`;

const js = ["core.js", "checks.js", "ui.js"].map(read).join("\n\n");
const out = `${head}
<style>
${read("styles.css")}
</style>

${read("markup.html")}

<script>
"use strict";
${js}
</script>
`;
fs.writeFileSync(path.join(ROOT, "index.html"), out);
new Function(js); // syntax check
console.log(`index.html: ${(out.length / 1024).toFixed(0)} KB`);
