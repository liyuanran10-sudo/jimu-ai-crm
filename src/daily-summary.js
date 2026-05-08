import fs from "node:fs/promises";
import path from "node:path";
import { getFeishuDocRawContent, listFeishuWikiNodes } from "./feishu.js";

const timezone = "Asia/Shanghai";
const historyPath = process.env.DAILY_SUMMARY_HISTORY_PATH
  ? path.resolve(process.env.DAILY_SUMMARY_HISTORY_PATH)
  : process.env.NETLIFY
    ? "/tmp/daily-summaries.json"
    : path.resolve("data/daily-summaries.json");

export async function buildDailySummaryRecord(config, options = {}) {
  const targetDate = options.date ? new Date(`${options.date}T12:00:00+08:00`) : new Date();
  const dateKey = formatDateKey(targetDate, timezone);
  const dateLabel = formatDate(targetDate, timezone);
  const todayStart = startOfDay(targetDate, timezone);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const memoryContext = await loadMemoryContext();

  const nodes = await listFeishuWikiNodes(config);
  const todayNodes = nodes
    .filter((node) => node.obj_type === "docx")
    .filter((node) => {
      const createdAt = Number(node.node_create_time || node.obj_create_time || 0) * 1000;
      const editedAt = Number(node.obj_edit_time || 0) * 1000;
      return inRange(createdAt, todayStart, tomorrowStart) || inRange(editedAt, todayStart, tomorrowStart);
    })
    .filter((node) => node.title !== "首页");

  const pages = [];
  for (const node of todayNodes) {
    const content = await getFeishuDocRawContent(node.obj_token, config);
    const copiedContent = extractCopiedContent(content, node.title);
    pages.push({
      title: node.title,
      nodeToken: node.node_token,
      documentId: node.obj_token,
      createdAt: toLocalTime(node.node_create_time || node.obj_create_time, timezone),
      editedAt: toLocalTime(node.obj_edit_time, timezone),
      copiedContent,
      localSummary: summarizeCopiedContent(copiedContent)
    });
  }

  const assets = deriveReusableAssets(pages);
  const tasks = deriveTaskSuggestions(pages);
  const memoryInsights = memoryContext ? deriveContextualInsights(pages, memoryContext) : [];
  const summaryMarkdown = await summarizePages({
    pages,
    dateLabel,
    config,
    memoryContext,
    assets,
    tasks,
    memoryInsights
  });

  return {
    id: dateKey,
    dateKey,
    dateLabel,
    generatedAt: new Date().toISOString(),
    timezone,
    pageCount: pages.length,
    pages,
    assets,
    tasks,
    memoryInsights,
    summaryMarkdown
  };
}

export async function readDailySummaryHistory() {
  const blobHistory = await readBlobHistory();
  if (blobHistory) return blobHistory;

  try {
    const raw = await fs.readFile(historyPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveDailySummaryRecord(record) {
  const history = await readDailySummaryHistory();
  const next = [
    record,
    ...history.filter((item) => item.dateKey !== record.dateKey)
  ].sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)));

  if (await writeBlobHistory(next)) {
    return next;
  }

  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.writeFile(historyPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

async function readBlobHistory() {
  const store = await getBlobStore();
  if (!store) return null;
  const history = await store.get("history", { type: "json" });
  return Array.isArray(history) ? history : [];
}

async function writeBlobHistory(history) {
  const store = await getBlobStore();
  if (!store) return false;
  await store.setJSON("history", history);
  return true;
}

async function getBlobStore() {
  if (!process.env.NETLIFY || process.env.NETLIFY_BLOBS_DISABLED === "true") return null;
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore("daily-summaries");
  } catch {
    return null;
  }
}

async function summarizePages({ pages, dateLabel, config, memoryContext, assets, tasks, memoryInsights }) {
  if (!pages.length) {
    return `# ${dateLabel} 飞书知识库采集汇总\n\n今天没有发现新增或编辑的知识库文档。`;
  }

  if (config.openaiApiKey) {
    const input = pages.map((page, index) => [
      `## ${index + 1}. ${page.title}`,
      `创建时间：${page.createdAt}`,
      `更新时间：${page.editedAt}`,
      `提炼摘要：${page.localSummary}`,
      "用户实际复制内容：",
      page.copiedContent.slice(0, 5000)
    ].join("\n")).join("\n\n---\n\n");

    const memoryBlock = memoryContext
      ? `\n\n可使用的用户长期上下文（用户明确放入本地文件，仅用于推理，不要逐字泄露）：\n${memoryContext.slice(0, 4000)}`
      : "";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openaiModel,
        input: [
          {
            role: "system",
            content: [
              "你是知识库运营助手。请用中文汇总当天采集到飞书知识库的内容，输出给业务群阅读。",
              "保持简洁、有条理，不要编造。",
              "必须包含：今日概览、重点内容、可复用资产、任务建议。",
              "任务建议按三类分组：个人提升、工作推进、公司管理。",
              "每条任务写成可执行标题，并补充一句目的或验收标准。",
              "优先总结用户实际复制的内容，而不是系统包装字段。",
              "如有用户长期上下文，只用它辅助判断优先级和适用场景，不要暴露隐私细节。"
            ].join("\n")
          },
          {
            role: "user",
            content: `日期：${dateLabel}\n文档数：${pages.length}${memoryBlock}\n\n${input}`
          }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI summary failed: ${text.slice(0, 600)}`);
    }

    const payload = await response.json();
    return extractOutputText(payload).trim();
  }

  const lines = [
    `# ${dateLabel} 飞书知识库采集汇总`,
    "",
    `今天共采集/更新 ${pages.length} 条知识库内容。`,
    "",
    "## 内容清单"
  ];

  for (const [index, page] of pages.entries()) {
    lines.push("");
    lines.push(`${index + 1}. ${page.title}`);
    lines.push(`   - 时间：${page.createdAt}`);
    lines.push(`   - 内容摘要：${page.localSummary || "暂无可读正文"}`);
  }

  if (memoryInsights.length) {
    lines.push("");
    lines.push("## 结合长期上下文的判断");
    for (const item of memoryInsights) lines.push(`- ${item}`);
  }

  lines.push("");
  lines.push("## 可复用资产");
  for (const asset of assets) lines.push(`- ${asset}`);

  lines.push("");
  lines.push("## 任务建议");
  lines.push("");
  lines.push("### 个人提升");
  for (const task of tasks.personal) lines.push(`- ${task}`);
  lines.push("");
  lines.push("### 工作推进");
  for (const task of tasks.work) lines.push(`- ${task}`);
  lines.push("");
  lines.push("### 公司管理");
  for (const task of tasks.management) lines.push(`- ${task}`);

  return lines.join("\n");
}

async function loadMemoryContext() {
  const memoryPath = path.resolve("data/gpt-memory-context.md");
  try {
    return (await fs.readFile(memoryPath, "utf8")).trim();
  } catch {
    return "";
  }
}

function extractCopiedContent(rawContent, title) {
  const lines = String(rawContent || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd());

  const bodyIndex = lines.findIndex((line) => line.trim() === "正文");
  let useful = bodyIndex >= 0 ? lines.slice(bodyIndex + 1) : lines;

  while (useful.length && !useful[0].trim()) useful = useful.slice(1);

  const normalizedTitle = compact(title);
  while (useful.length && compact(useful[0]) === normalizedTitle) {
    useful = useful.slice(1);
    while (useful.length && !useful[0].trim()) useful = useful.slice(1);
  }

  const cleaned = useful
    .filter((line) => !/^来源[:：]/.test(line.trim()))
    .join("\n")
    .trim();

  return cleaned || String(rawContent || "").trim();
}

function summarizeCopiedContent(content) {
  const text = compact(content);
  if (!text) return "";

  const sentences = text
    .split(/(?<=[。！？.!?])\s+|(?<=[。！？])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const selected = sentences.slice(0, 3).join("");
  return (selected || text).slice(0, 220);
}

function deriveReusableAssets(pages) {
  const assets = [];
  for (const page of pages) {
    const text = `${page.title} ${page.copiedContent}`;
    if (/流程|工作流|闭环/.test(text)) assets.push(`流程资产：${page.title}`);
    if (/报告|模板|提示词|prompt/i.test(text)) assets.push(`模板资产：${page.title}`);
    if (/配置|参数|设置/.test(text)) assets.push(`配置资产：${page.title}`);
  }
  return unique(assets).slice(0, 6).concat(
    assets.length ? [] : ["建议从今日内容中提炼固定模板、流程和配置清单。"]
  );
}

function deriveTaskSuggestions(pages) {
  const titles = pages.map((page) => page.title).join("；");
  const allText = pages.map((page) => `${page.title}\n${page.copiedContent}`).join("\n");
  const personal = [];
  const work = [];
  const management = [];

  if (/测试|自动化|AI/.test(allText)) {
    personal.push("复盘 AI 自动化测试方法：整理 3 条可立即复用的测试提示词和操作习惯。");
    work.push("沉淀外包项目自动化测试流程：把触发条件、执行步骤、输出报告格式整理成团队模板。");
  }

  if (/报告|项目经理/.test(allText)) {
    work.push("固化测试报告模板：形成项目经理可读的日报/验收报告结构。");
  }

  if (/配置|参数|设置/.test(allText)) {
    work.push("整理关键配置清单：补充适用场景、风险点和默认推荐值。");
  }

  if (/工作流|闭环|流程/.test(allText)) {
    management.push("建立知识资产归档规则：将流程、模板、配置分别归入固定目录并定义命名规范。");
    management.push("制定团队 AI 测试落地标准：明确输入材料、测试轮次、验收口径和责任人。");
  }

  if (!personal.length) {
    personal.push("从今日知识库内容中挑选 1 条能力提升主题，整理成 15 分钟学习笔记。");
  }
  if (!work.length) {
    work.push(`跟进今日采集内容：检查「${titles.slice(0, 80)}」是否需要转为项目资料或执行清单。`);
  }
  if (!management.length) {
    management.push("完善知识库治理：为今日新增内容补充分类、标签和可复用场景。");
  }

  return {
    personal: unique(personal).slice(0, 3),
    work: unique(work).slice(0, 4),
    management: unique(management).slice(0, 3)
  };
}

function deriveContextualInsights(pages, memoryContext) {
  const allText = pages.map((page) => `${page.title}\n${page.copiedContent || ""}`).join("\n");
  const memory = compact(memoryContext);
  const insights = [];

  if (/公司|管理|外包|项目|交付/.test(memory + allText)) {
    insights.push("今天的内容更偏向可落地的项目管理和交付资产，适合沉淀为团队标准流程。");
  }
  if (/AI|自动化|测试|工具/.test(memory + allText)) {
    insights.push("AI 自动化测试相关内容应优先转为可执行模板，而不只是知识记录。");
  }
  if (/售前|客户|方案/.test(memory + allText)) {
    insights.push("若用于客户沟通，可进一步提炼为售前方案素材和交付说明。");
  }

  return insights.length ? insights : ["建议根据个人目标和团队当前重点，挑选 1-2 条内容转为可执行任务。"];
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
      if (typeof content.output_text === "string") parts.push(content.output_text);
    }
  }
  return parts.join("\n");
}

function compact(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function inRange(timestamp, start, end) {
  return timestamp >= start.getTime() && timestamp < end.getTime();
}

function formatDate(date, timeZone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatDateKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year").value;
  const month = parts.find((part) => part.type === "month").value;
  const day = parts.find((part) => part.type === "day").value;
  return `${year}-${month}-${day}`;
}

function toLocalTime(epochSeconds, timeZone) {
  if (!epochSeconds) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(Number(epochSeconds) * 1000));
}

function startOfDay(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year").value);
  const month = Number(parts.find((part) => part.type === "month").value);
  const day = Number(parts.find((part) => part.type === "day").value);
  return new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000);
}
