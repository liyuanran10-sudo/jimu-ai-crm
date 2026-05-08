import path from "node:path";
import { loadDotEnv, getConfig } from "../src/config.js";
import { sendFeishuTextMessage } from "../src/feishu.js";
import { buildDailySummaryRecord, saveDailySummaryRecord } from "../src/daily-summary.js";

loadDotEnv(path.resolve(".env"));
const config = getConfig();

const args = new Set(process.argv.slice(2));
const shouldSend = args.has("--send");
const shouldSave = !args.has("--no-save");
const dateArg = process.argv.find((arg) => arg.startsWith("--date="))?.split("=")[1];

const record = await buildDailySummaryRecord(config, { date: dateArg });

if (shouldSave) {
  await saveDailySummaryRecord(record);
}

console.log(record.summaryMarkdown);

if (shouldSend) {
  await sendFeishuTextMessage(record.summaryMarkdown, config);
  console.log("\nSent to Feishu group.");
}
