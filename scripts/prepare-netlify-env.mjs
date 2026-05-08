import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const envPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(projectRoot, ".env");
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : "/tmp/jimu-crm-netlify.env";

const LOCAL_ONLY_KEYS = new Set([
  "PORT",
  "OPENAI_PROXY_URL"
]);

const lines = await readEnvLines(envPath);
const sharedLines = [];
const importedKeys = [];
const skippedKeys = [];

for (const line of lines) {
  const parsed = parseEnvLine(line);
  if (!parsed) continue;
  if (LOCAL_ONLY_KEYS.has(parsed.key)) {
    skippedKeys.push(parsed.key);
    continue;
  }
  if (parsed.key === "PPT_SKILL_BASE_URL" && isLocalhostUrl(parsed.value)) {
    skippedKeys.push(parsed.key);
    continue;
  }
  sharedLines.push(`${parsed.key}=${parsed.value}`);
  importedKeys.push(parsed.key);
}

await fs.writeFile(outputPath, `${sharedLines.join("\n")}\n`, "utf8");

console.log(`Prepared Netlify env file: ${outputPath}`);
console.log(`Shared keys: ${importedKeys.join(", ") || "(none)"}`);
console.log(`Skipped local-only keys: ${skippedKeys.join(", ") || "(none)"}`);

async function readEnvLines(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.split(/\r?\n/);
  } catch (error) {
    throw new Error(`Unable to read env file ${filePath}: ${error.message}`);
  }
}

function parseEnvLine(line = "") {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf("=");
  if (separator === -1) return null;
  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim();
  if (!key) return null;
  return { key, value };
}

function isLocalhostUrl(value = "") {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(String(value).trim());
}
