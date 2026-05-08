import fs from "node:fs/promises";
import path from "node:path";
import { loadDotEnv, getConfig } from "../src/config.js";
import { organizeContent } from "../src/organizer.js";
import { createFeishuPage, isFeishuConfigured } from "../src/feishu.js";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node scripts/sync-file-to-feishu.mjs <file-path>");
  process.exit(1);
}

loadDotEnv(path.resolve(".env"));
const config = {
  ...getConfig(),
  syncTarget: "feishu"
};

if (!isFeishuConfigured(config)) {
  console.error("Feishu is not configured. Set FEISHU_APP_ID, FEISHU_APP_SECRET, and FEISHU_WIKI_SPACE_ID or FEISHU_FOLDER_TOKEN in .env.");
  process.exit(1);
}

const resolvedPath = path.resolve(filePath);
const stat = await fs.stat(resolvedPath);
if (!stat.isFile()) {
  console.error(`Not a file: ${resolvedPath}`);
  process.exit(1);
}

if (stat.size > 1024 * 1024) {
  console.error("This MVP supports files up to 1MB. Please split or summarize larger files first.");
  process.exit(1);
}

const content = await fs.readFile(resolvedPath, "utf8");
const capture = await organizeContent({
  content,
  sourceTitle: path.basename(resolvedPath),
  sourceUrl: "",
  userNote: "从本地文件一键同步到飞书知识库"
}, config);

const result = await createFeishuPage(capture, config);
console.log(JSON.stringify({
  ok: true,
  title: capture.title,
  url: result.url,
  id: result.id,
  nodeToken: result.nodeToken
}, null, 2));
