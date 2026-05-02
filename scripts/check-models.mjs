import { readFileSync } from "fs";

const PROVIDER_MODELS = {
  anthropic: "claude-haiku-4-5-20251001",
  groq: "llama-3.1-8b-instant",
};

const handler = readFileSync("netlify/functions/groqHandler.mjs", "utf8");

const providerMatch = handler.match(/const PROVIDER = ["']([^"']+)["']/);
const provider = providerMatch?.[1] || "anthropic";

const modelMatch = handler.match(/model:\s*["']([^"']+)["']/);
const foundModel = modelMatch?.[1];

const expectedModel = PROVIDER_MODELS[provider];

if (foundModel === expectedModel) {
  console.log(`✓ Provider: ${provider}, Model: ${foundModel}`);
} else if (foundModel) {
  console.warn(`⚠ Handler uses '${foundModel}', expected '${expectedModel}' for ${provider}.`);
  console.warn("  Update the model field in templates/netlify/functions/groqHandler.mjs and re-run 'npm run setup'.");
  process.exit(1);
} else {
  console.error("Could not detect model in netlify/functions/groqHandler.mjs.");
  process.exit(1);
}