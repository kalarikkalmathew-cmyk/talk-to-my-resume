import { readFileSync } from "fs";

const EXPECTED_MODEL = "claude-haiku-4-5-20251001";

const handler = readFileSync("netlify/functions/groqHandler.mjs", "utf8");
const modelMatch = handler.match(/model:\s*["']([^"']+)["']/);
const foundModel = modelMatch?.[1];

if (foundModel === EXPECTED_MODEL) {
  console.log(`✓ Model confirmed: ${foundModel}`);
} else if (foundModel) {
  console.warn(`⚠ Handler uses '${foundModel}', expected '${EXPECTED_MODEL}'.`);
  console.warn("  Update the model field in templates/netlify/functions/groqHandler.mjs and re-run 'npm run setup'.");
  process.exit(1);
} else {
  console.error("Could not detect model in netlify/functions/groqHandler.mjs.");
  process.exit(1);
}
