import fs from "node:fs";
import path from "node:path";

export function loadDotEnv(filePath = ".env") {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return;

  const lines = fs.readFileSync(resolved, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function getConfig() {
  return {
    port: Number(process.env.PORT || 8787),
    crmAuthSecret: process.env.CRM_AUTH_SECRET || "dev-only-change-me",
    crmSessionTtlHours: Number(process.env.CRM_SESSION_TTL_HOURS || 168),
    syncTarget: normalizeSyncTarget(process.env.SYNC_TARGET || "auto"),
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-5.5",
    openaiProxyUrl: process.env.OPENAI_PROXY_URL || "",
    openaiTimeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 120000),
    backgroundAiTimeoutMs: Number(process.env.BACKGROUND_AI_TIMEOUT_MS || 180000),
    pptTaskTimeoutMs: Number(process.env.PPT_TASK_TIMEOUT_MS || 1800000),
    aiContextMaxChars: Number(process.env.AI_CONTEXT_MAX_CHARS || 16000),
    aiPromptMaxChars: Number(process.env.AI_PROMPT_MAX_CHARS || 22000),
    aiOutputMaxTokens: Number(process.env.AI_OUTPUT_MAX_TOKENS || 2800),
    image2ApiKey: process.env.IMAGE2_API_KEY || process.env.OPENAI_IMAGE_API_KEY || "",
    image2BaseUrl: process.env.IMAGE2_BASE_URL || process.env.OPENAI_IMAGE_BASE_URL || "https://api.openai.com/v1",
    image2Endpoint: process.env.IMAGE2_ENDPOINT || "/images/generations",
    image2EditEndpoint: process.env.IMAGE2_EDIT_ENDPOINT || "/images/edits",
    image2Model: process.env.IMAGE2_MODEL || "gpt-image-2",
    image2ResponsesModel: process.env.IMAGE2_RESPONSES_MODEL || process.env.IMAGE2_EDIT_MODEL || process.env.OPENAI_MODEL || "gpt-5.5",
    image2EditMode: process.env.IMAGE2_EDIT_MODE || "auto",
    image2Size: process.env.IMAGE2_SIZE || "1792x1024",
    image2ResponseFormat: process.env.IMAGE2_RESPONSE_FORMAT || "",
    image2TimeoutMs: Number(process.env.IMAGE2_TIMEOUT_MS || 180000),
    image2EditTimeoutMs: process.env.IMAGE2_EDIT_TIMEOUT_MS === undefined
      ? 90000
      : Number(process.env.IMAGE2_EDIT_TIMEOUT_MS || 90000),
    image2PromptTimeoutMs: Number(process.env.IMAGE2_PROMPT_TIMEOUT_MS || 25000),
    pptSkillBaseUrl: process.env.PPT_SKILL_BASE_URL || (isServerlessRuntime() ? "" : "http://localhost:3100"),
    webResearchEnabled: process.env.WEB_RESEARCH_ENABLED !== "false",
    webSearchProvider: process.env.WEB_SEARCH_PROVIDER || "jina",
    webSearchApiKey: process.env.WEB_SEARCH_API_KEY || process.env.TAVILY_API_KEY || "",
    webCrawlerProvider: process.env.WEB_CRAWLER_PROVIDER || "direct",
    webResearchTimeoutMs: Number(process.env.WEB_RESEARCH_TIMEOUT_MS || 9000),
    webResearchMaxResults: Number(process.env.WEB_RESEARCH_MAX_RESULTS || 4),
    webResearchMaxCrawlUrls: Number(process.env.WEB_RESEARCH_MAX_CRAWL_URLS || 3),
    notionApiKey: process.env.NOTION_API_KEY || "",
    notionDatabaseId: process.env.NOTION_DATABASE_ID || "",
    notionParentPageId: process.env.NOTION_PARENT_PAGE_ID || "",
    notionVersion: process.env.NOTION_VERSION || "2022-06-28",
    feishuAppId: process.env.FEISHU_APP_ID || "",
    feishuAppSecret: process.env.FEISHU_APP_SECRET || "",
    feishuFolderToken: process.env.FEISHU_FOLDER_TOKEN || "",
    feishuWikiSpaceId: process.env.FEISHU_WIKI_SPACE_ID || "",
    feishuWikiParentNodeToken: process.env.FEISHU_WIKI_PARENT_NODE_TOKEN || "",
    feishuSiteUrl: process.env.FEISHU_SITE_URL || "",
    feishuWebhookUrl: process.env.FEISHU_WEBHOOK_URL || "",
    feishuWebhookSecret: process.env.FEISHU_WEBHOOK_SECRET || "",
    feishuChatId: process.env.FEISHU_CHAT_ID || ""
  };
}

function isServerlessRuntime() {
  const cwd = process.cwd();
  return Boolean(
    process.env.NETLIFY
    || process.env.AWS_LAMBDA_FUNCTION_NAME
    || process.env.AWS_EXECUTION_ENV
    || cwd.includes("/var/task")
  );
}

function normalizeSyncTarget(value) {
  const target = String(value || "auto").trim().toLowerCase();
  if (["auto", "notion", "feishu", "local"].includes(target)) return target;
  return "auto";
}
