import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Read the Vite build output (single HTML file with inlined JS/CSS)
const htmlPath = resolve(
  projectRoot,
  "dist/intermediate/template/format.html"
);
const html = readFileSync(htmlPath, "utf-8");

// Read format metadata
const formatMeta = JSON.parse(
  readFileSync(resolve(projectRoot, "format.json"), "utf-8")
);

// Build the story format JSONP payload
const formatData = {
  name: formatMeta.name,
  version: formatMeta.version,
  author: formatMeta.author,
  description: formatMeta.description,
  image: formatMeta.image || "",
  url: formatMeta.url || "",
  license: formatMeta.license || "",
  proofing: false,
  source: html,
};

// Write the format.js file
const output = `window.storyFormat(${JSON.stringify(formatData)})`;
const outputDir = resolve(projectRoot, "dist");
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "format.js"), output, "utf-8");

console.log(`Built dist/format.js (${(output.length / 1024).toFixed(1)} KB)`);
