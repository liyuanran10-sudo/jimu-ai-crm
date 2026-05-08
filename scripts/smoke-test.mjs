import assert from "node:assert/strict";
import { handleApiRequest } from "../src/api-routes.js";
import { organizeContent } from "../src/organizer.js";
import { markdownToNotionBlocks } from "../src/markdown-to-notion.js";

const sample = [
  "# GPT 内容保存到 Notion 的方案",
  "",
  "目标：把 GPT 里好的回答整理成知识卡片，并写入 Notion。",
  "",
  "- 自动生成标题",
  "- 自动生成摘要",
  "- 推荐标签",
  "",
  "```js",
  "console.log('capture');",
  "```"
].join("\n");

const capture = await organizeContent({
  content: sample,
  sourceTitle: "Smoke Test",
  sourceUrl: "https://example.com"
}, {
  openaiApiKey: ""
});

assert.equal(capture.title, "GPT 内容保存到 Notion 的方案");
assert.ok(capture.summary.length > 0);
assert.ok(capture.tags.includes("AI"));
assert.ok(capture.markdown.includes("## 正文"));

const blocks = markdownToNotionBlocks(capture.markdown);
assert.ok(Array.isArray(blocks));
assert.ok(blocks.length > 3);
assert.ok(blocks.some((block) => block.type === "code"));

const config = {
  syncTarget: "local",
  openaiApiKey: "",
  openaiModel: "gpt-4.1-mini",
  notionApiKey: "",
  notionDatabaseId: "",
  notionParentPageId: "",
  feishuAppId: "",
  feishuAppSecret: "",
  feishuFolderToken: "",
  feishuWikiSpaceId: ""
};

const login = await handleApiRequest({
  method: "POST",
  pathname: "/api/crm/login",
  body: {
    email: "mango@gymoo.cn",
    password: "admin123"
  },
  config
});
assert.equal(login.status, 200);
assert.equal(login.body.user.role, "admin");

const bootstrap = await handleApiRequest({
  method: "GET",
  pathname: "/api/crm/bootstrap",
  body: {},
  headers: { "x-crm-token": login.body.token },
  config
});
assert.ok(bootstrap.body.db.customers.length >= 1);
assert.ok(bootstrap.body.db.skills.length >= 1);
assert.ok(bootstrap.body.db.skills.some((skill) => /轻量级方案\s*PPT/.test(skill.name)));

const generation = await handleApiRequest({
  method: "POST",
  pathname: "/api/crm/generate",
  body: {
    type: "follow_strategy",
    customerId: bootstrap.body.db.customers[0].id,
    userId: "user_admin"
  },
  headers: { "x-crm-token": login.body.token },
  config
});
assert.equal(generation.status, 200);
assert.equal(generation.body.record.inputContext.asyncAiJob.status, "generating");
assert.match(generation.body.generation.outputContent, /后台生成任务|帮助中心/);

const refreshedRecord = await waitForGenerationCompletion(generation.body.record.id, { "x-crm-token": login.body.token });
assert.equal(refreshedRecord?.inputContext?.asyncAiJob?.status, "completed");
assert.match(refreshedRecord?.outputContent || "", /客户当前状态判断/);

const feishuSyncWithoutConfig = await handleApiRequest({
  method: "POST",
  pathname: "/api/crm/sync-history-feishu",
  body: {
    recordId: generation.body.record.id
  },
  headers: { "x-crm-token": login.body.token },
  config
});
assert.equal(feishuSyncWithoutConfig.status, 400);
assert.match(feishuSyncWithoutConfig.body.error, /飞书未配置/);

console.log("Smoke test passed.");

async function waitForGenerationCompletion(recordId, headers, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let record = null;
  while (Date.now() < deadline) {
    const refreshed = await handleApiRequest({
      method: "GET",
      pathname: "/api/crm/bootstrap",
      body: {},
      headers,
      config
    });
    record = refreshed.body.db.aiGenerationRecords.find((item) => item.id === recordId);
    if (record?.inputContext?.asyncAiJob?.status !== "generating") return record;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return record;
}
