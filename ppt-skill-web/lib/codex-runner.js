import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { APP_ROOT, getTaskDir, MANIFEST_FILE_NAME } from "./paths.js";
import {
  appendTaskLog,
  findTaskResultFiles,
  readTask,
  updateTask
} from "./task-store.js";

const DEFAULT_SKILL_NAME = "gpt-image2-ppt";
const DEFAULT_SKILL_DIR = "/Users/mangolee/.codex/skills/gpt-image2-ppt-skills";
const DEFAULT_IMAGE_BACKEND = String(process.env.GPT_IMAGE_BACKEND || "codex").trim() || "codex";
const DEFAULT_IMAGE_CONCURRENCY = String(
  process.env.GPT_IMAGE_CONCURRENCY || (DEFAULT_IMAGE_BACKEND === "codex" ? "1" : "3")
).trim();
const DEFAULT_CODEX_SANDBOX = "danger-full-access";
const DEFAULT_CODEX_IMAGE_TIMEOUT_SECS = 300;
const TASK_ENV_FILES = [
  path.resolve(APP_ROOT, "..", ".env"),
  path.resolve(APP_ROOT, "..", ".env.local"),
  path.resolve(APP_ROOT, ".env"),
  path.resolve(APP_ROOT, ".env.local")
];

export function startCodexTask(taskId) {
  setTimeout(() => {
    runCodexTask(taskId).catch(async (error) => {
      await updateTask(taskId, {
        status: "failed",
        error: error?.message || "Unknown task runner error."
      });
      await appendTaskLog(taskId, `\n[runner:error] ${error?.stack || error}\n`);
    });
  }, 0);
}

async function runCodexTask(taskId) {
  let task = await readTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== "queued") return;

  task = await updateTask(taskId, {
    status: "running",
    error: "",
    result: null
  });

  const taskDir = getTaskDir(taskId);
  await cleanTaskArtifacts(taskId);
  const prompt = buildCodexPrompt(task);
  const promptFile = path.join(taskDir, "codex-prompt.md");
  const slidesPlanMd = path.join(taskDir, "slides_plan.md");
  await fs.writeFile(slidesPlanMd, buildSlidesPlanMarkdown(task));
  await fs.writeFile(promptFile, prompt);
  await appendTaskLog(taskId, `[runner] Task ${taskId} started at ${new Date().toISOString()}\n`);
  await appendTaskLog(taskId, `[runner] Output directory: ${taskDir}\n`);

  const exit = await runCodexExec({ task, prompt });
  await appendTaskLog(taskId, `\n[runner] Codex exited with code ${exit.code ?? "null"} and signal ${exit.signal ?? "null"}.\n`);

  if (exit.timedOut) {
    const timedOutResult = await collectOrCreateResult(task);
    if (timedOutResult.pptxFile) {
      await updateTask(taskId, {
        status: "succeeded",
        result: timedOutResult,
        error: ""
      });
      await appendTaskLog(taskId, "[runner] Outputs were already present when timeout fired; task marked succeeded.\n");
      return;
    }

    await updateTask(taskId, {
      status: "failed",
      error: `Codex task timed out after ${Math.round(exit.timeoutMs / 1000)} seconds. See codex.log for details.`
    });
    return;
  }

  if (exit.code !== 0) {
    await updateTask(taskId, {
      status: "failed",
      error: await resolveTaskFailureMessage(
        task.id,
        `Codex CLI exited with code ${exit.code ?? "null"}. See codex.log for details.`
      )
    });
    return;
  }

  const result = await collectOrCreateResult(task);
  if (!result.pptxFile) {
    await updateTask(taskId, {
      status: "failed",
      error: await resolveTaskFailureMessage(
        task.id,
        "Codex completed, but no .pptx file was found in the task output directory."
      )
    });
    await appendTaskLog(taskId, "[runner] No .pptx output detected.\n");
    return;
  }

  await updateTask(taskId, {
    status: "succeeded",
    result,
    error: ""
  });
  await appendTaskLog(taskId, `[runner] Task succeeded. PPT: ${result.pptxFile}, HTML: ${result.htmlFile}\n`);
}

async function runCodexExec({ task, prompt }) {
  const skillEnv = await resolveSkillEnvironment();
  const taskTimeoutMs = resolveTaskTimeoutMs(task);

  return new Promise((resolve, reject) => {
    const codexBin = process.env.CODEX_BIN || "codex";
    const args = ["exec"];

    const model = String(process.env.CODEX_MODEL || "").trim();
    if (model) args.push("--model", model);

    args.push("--cd", APP_ROOT);

    const bypassSandbox = String(
      process.env.CODEX_BYPASS_SANDBOX || (DEFAULT_IMAGE_BACKEND === "codex" ? "true" : "")
    ).toLowerCase() === "true";

    if (bypassSandbox) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      args.push("--sandbox", process.env.CODEX_SANDBOX || DEFAULT_CODEX_SANDBOX);
    }

    args.push(
      "--skip-git-repo-check",
      "--output-last-message",
      path.join(getTaskDir(task.id), "codex-final-message.md"),
      "-"
    );

    appendTaskLog(task.id, `[runner] Command: ${codexBin} ${args.join(" ")}\n`);
    appendTaskLog(task.id, `[runner] Timeout: ${Math.round(taskTimeoutMs / 1000)}s\n`);

    const child = spawn(codexBin, args, {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        ...skillEnv,
        GPT_IMAGE_BACKEND: DEFAULT_IMAGE_BACKEND,
        GPT_IMAGE_CONCURRENCY: DEFAULT_IMAGE_CONCURRENCY,
        CODEX_TIMEOUT_SECS: process.env.CODEX_TIMEOUT_SECS || String(DEFAULT_CODEX_IMAGE_TIMEOUT_SECS),
        CODEX_CMD: process.env.CODEX_CMD || `${codexBin} exec --full-auto --skip-git-repo-check`,
        FORCE_COLOR: "0"
      },
      detached: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let timedOut = false;
    let killTimer = null;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      appendTaskLog(
        task.id,
        `\n[runner] Timed out after ${Math.round(taskTimeoutMs / 1000)}s. Terminating Codex process group.\n`
      );
      terminateProcessGroup(child.pid, "SIGTERM");
      killTimer = setTimeout(() => terminateProcessGroup(child.pid, "SIGKILL"), 8000);
    }, taskTimeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.stdout.on("data", (chunk) => appendTaskLog(task.id, chunk.toString()));
    child.stderr.on("data", (chunk) => appendTaskLog(task.id, chunk.toString()));
    child.on("close", (code, signal) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code, signal, timedOut, timeoutMs: taskTimeoutMs });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function buildCodexPrompt(task) {
  const skillName = process.env.CODEX_SKILL_NAME || DEFAULT_SKILL_NAME;
  const skillDir = process.env.CODEX_SKILL_DIR || DEFAULT_SKILL_DIR;
  const outputDir = getTaskDir(task.id);
  const styleFile = mapStyleToSkillStyle(task.input.style);
  const templateLine = task.input.templatePath
    ? `- PPT 模板文件：${task.input.templatePath}`
    : "- PPT 模板文件：未上传，请按用户选择的风格自行生成。";

  return [
    `请使用本机已安装的 Codex Skill：${skillName}。`,
    `如果本机同时存在目录名为 gpt-image2-ppt-skills 的技能，请优先识别其内部技能名 gpt-image2-ppt。`,
    `Skill 目录：${skillDir}`,
    "",
    "你正在被一个内部 Next.js 任务执行器调用，请不要反问，也不要修改输出目录以外的文件。",
    "",
    "## 任务目标",
    "根据下面的业务输入生成一份可交付的 PPT，并同时产出 HTML viewer 预览文件。",
    "",
    "## 输入信息",
    `- PPT 主题：${task.input.topic}`,
    `- 客户名称：${task.input.customerName || "未填写"}`,
    `- 项目背景：${task.input.projectBackground || "未填写"}`,
    `- 核心内容：${task.input.coreContent || "未填写"}`,
    `- 目标页数：${task.input.pageCount}`,
    `- 视觉风格：${task.input.style}`,
    templateLine,
    "",
    "## 输出要求",
    `- 所有结果必须保存到这个目录：${outputDir}`,
    "- 至少生成一个 `.pptx` 文件。",
    "- 至少生成一个 HTML 预览文件，优先命名为 `index.html`。",
    "- 请生成 `manifest.json`，包含 title、customerName、slideCount、pptxFile、htmlFile、generatedAt。",
    "- 如果使用图片生成，请使用环境变量中的 OPENAI_API_KEY，不要把密钥写入任何文件。",
    "- 如果模板存在，请参考模板版式、配色、字体和封面结构；不要覆盖模板原文件。",
    "- 如果生成失败，请在输出目录写入 `FAILURE.md`，说明失败原因和下一步排查建议。",
    "",
    "## 固定执行路径",
    "请严格按下面步骤执行，不要改成其它 PPT 生成方案：",
    `0. 不要重新设计执行方式，不要继续翻 README，不要切换到其它 Skill。直接使用已经准备好的大纲文件：${outputDir}/slides_plan.md`,
    `1. 运行：python3 "${skillDir}/scripts/md_to_plan.py" "${outputDir}/slides_plan.md" -o "${outputDir}/slides_plan.json"`,
    `2. 运行：python3 "${skillDir}/scripts/generate_ppt.py" --plan "${outputDir}/slides_plan.json" --style "${skillDir}/styles/${styleFile}" --template "${skillDir}/templates/viewer.html" --output "${outputDir}" --concurrency ${DEFAULT_IMAGE_CONCURRENCY} --backend ${DEFAULT_IMAGE_BACKEND}`,
    "3. 不要执行任何会写入输出目录以外位置的命令。",
    "4. 运行后确认输出目录内存在 `index.html` 和至少一个 `.pptx` 文件。",
    "5. 如果命令失败，直接把失败原因写进 `FAILURE.md`，不要进入其它替代方案。",
    "",
    "## 质量标准",
    "- PPT 结构要适合客户汇报：封面、背景/痛点、解决方案、核心页面、实施路径、价值总结。",
    "- 中文文案需要简洁可读，避免空泛口号。",
    "- HTML viewer 应能在浏览器中打开并帮助快速预览生成结果。",
    "",
    "开始执行。"
  ].join("\n");
}

function mapStyleToSkillStyle(style = "") {
  const text = String(style || "").toLowerCase();
  if (/深色|aurora|dark/.test(text)) return "dark-aurora.md";
  if (/极简|白底|grid|swiss/.test(text)) return "swiss-grid.md";
  if (/咨询|mono|editorial|图表/.test(text)) return "editorial-mono.md";
  if (/投标|正式|tech|蓝绿|ai|产品|科技/.test(text)) return "clean-tech-blue.md";
  return "gradient-glass.md";
}

function buildSlidesPlanMarkdown(task) {
  const title = task.input.topic || "未命名 PPT";
  const customer = task.input.customerName || "目标客户";
  const background = task.input.projectBackground || "围绕客户业务背景和当前需求展开。";
  const core = task.input.coreContent || "围绕关键模块、视觉界面和实施价值展开。";
  const requestedPageCount = Number.parseInt(task.input.pageCount, 10);
  const total = Math.min(80, Math.max(1, Number.isFinite(requestedPageCount) ? requestedPageCount : 8));
  const slides = [];

  const baseSlides = [
    ["cover", `${title}`, `${customer}\n${background}`],
    ["content", "项目背景与机会窗口", `${background}\n聚焦行业变化、业务场景和为什么现在值得做。`],
    ["content", "客户目标与成功标准", `客户名称：${customer}\n期望结果：围绕主题形成可汇报的产品方案、设计图展示和推进路径。`],
    ["content", "用户画像与核心使用场景", "拆解主要用户、关键触点、典型使用路径，以及真实使用环境。"],
    ["content", "产品总体方案", `${core}\n把产品分成若干模块，说明各模块之间如何协同。`],
    ["content", "AI 能力与系统架构", "说明数据流、AI 能力入口、设备/服务端协同，以及差异化价值。"],
    ["content", "App 设计总览", "展示产品首页 / 主导航 / 核心视觉语言，强调互联网风格与强产品感。"],
    ["content", "首页工作台设计图", "突出品牌头图、核心指标、关键入口、推荐动作和视觉层级。"],
    ["content", "设备连接与绑定流程", "展示新设备接入、状态反馈、引导路径、异常处理和成功页。"],
    ["content", "数据监控与实时看板", "展示实时数据卡片、趋势图、提醒状态、筛选控件和分析视图。"],
    ["content", "AI 分析与洞察页面", "展示 AI 结论卡、建议动作、异常解释、对比分析和可信度表达。"],
    ["content", "告警中心与消息触达", "展示风险提醒、消息分层、处理动作、闭环流转和优先级样式。"],
    ["content", "用户档案与画像页", "展示个人档案、关键标签、历史记录、设备状态和行为摘要。"],
    ["content", "服务流程与任务协同", "展示任务清单、跟进状态、责任人、时间轴和执行闭环。"],
    ["content", "运营后台 / 管理端设计图", "展示平台管理视角，包含角色权限、配置、内容管理和数据总览。"],
    ["content", "视觉系统与设计规范", "总结色板、字体、组件、图标、卡片、图表和图片风格规范。"],
    ["content", "实施路径与里程碑", "拆解从需求确认、原型、开发、测试到上线的阶段目标。"],
    ["content", "资源投入与协作方式", "说明产品、设计、开发、测试、客户侧配合方式和节奏。"],
    ["data", "预期价值与业务收益", "用关键指标、效率提升、体验提升和后续扩展空间做总结。"],
    ["data", "下一步合作建议", "明确下一次评审要看的内容、需要确认的材料和建议决策动作。"]
  ];

  for (let index = 0; index < total; index += 1) {
    const seed = baseSlides[Math.min(index, baseSlides.length - 1)];
    const [pageType, heading, body] = seed;
    slides.push(`## ${index + 1}. [${pageType}] ${heading}\n${body}`);
  }

  return [
    "---",
    `title: ${title}`,
    "---",
    "",
    ...slides
  ].join("\n\n");
}

function resolveTaskTimeoutMs(task) {
  const configured = Number.parseInt(String(process.env.CODEX_TASK_TIMEOUT_SECS || ""), 10);
  if (Number.isFinite(configured) && configured > 0) return configured * 1000;

  const requestedPageCount = Number.parseInt(task?.input?.pageCount, 10);
  const pageCount = Math.min(80, Math.max(1, Number.isFinite(requestedPageCount) ? requestedPageCount : 8));
  const perSlideSeconds = DEFAULT_IMAGE_BACKEND === "codex" ? DEFAULT_CODEX_IMAGE_TIMEOUT_SECS + 90 : 120;
  const baseSeconds = DEFAULT_IMAGE_BACKEND === "codex" ? 420 : 240;
  const minimumSeconds = DEFAULT_IMAGE_BACKEND === "codex" ? 420 : 420;

  return Math.max(minimumSeconds, baseSeconds + pageCount * perSlideSeconds) * 1000;
}

function terminateProcessGroup(pid, signal) {
  if (!pid) return;

  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code === "ESRCH") return;

    try {
      process.kill(pid, signal);
    } catch (innerError) {
      if (innerError?.code !== "ESRCH") {
        // Logging from here is intentionally avoided because this helper may run
        // after the task has already completed and closed its log stream.
      }
    }
  }
}

async function cleanTaskArtifacts(taskId) {
  const taskDir = getTaskDir(taskId);
  const keepFiles = new Set(["task.json", "template.ppt", "template.pptx", "template.potx"]);

  let entries = [];
  try {
    entries = await fs.readdir(taskDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  await Promise.all(entries.map(async (entry) => {
    if (keepFiles.has(entry.name)) return;
    await fs.rm(path.join(taskDir, entry.name), { recursive: true, force: true });
  }));

  await fs.writeFile(path.join(taskDir, "codex.log"), "");
}

async function resolveTaskFailureMessage(taskId, fallbackMessage) {
  const failureFile = path.join(getTaskDir(taskId), "FAILURE.md");

  try {
    const raw = await fs.readFile(failureFile, "utf8");
    const summary = summarizeFailureMarkdown(raw);
    if (!summary) return `${fallbackMessage} See ${failureFile}.`;
    return `${summary} See ${failureFile}.`;
  } catch (error) {
    if (error?.code === "ENOENT") return fallbackMessage;
    throw error;
  }
}

function summarizeFailureMarkdown(markdown) {
  const failureReasonMatch = markdown.match(/##\s*失败原因\s+([\s\S]*?)(?:\n##\s|\n```|$)/);
  const bulletMatch = failureReasonMatch?.[1]?.match(/-\s+(.+)/);
  if (bulletMatch?.[1]) return bulletMatch[1].trim();

  const textLine = String(markdown || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("```"));

  return textLine ? textLine.slice(0, 220) : "";
}

async function collectOrCreateResult(task) {
  const taskDir = getTaskDir(task.id);
  let result = await findTaskResultFiles(task.id);

  if (result.pptxFile && !result.htmlFile) {
    const fallbackHtml = "index.html";
    await fs.writeFile(
      path.join(taskDir, fallbackHtml),
      buildFallbackViewerHtml({ task, pptxFile: result.pptxFile })
    );
    result = await findTaskResultFiles(task.id);
  }

  if (result.pptxFile && !result.manifestFile) {
    const manifest = {
      title: task.input.topic,
      customerName: task.input.customerName,
      slideCount: task.input.pageCount,
      pptxFile: result.pptxFile,
      htmlFile: result.htmlFile,
      generatedAt: new Date().toISOString(),
      generatedBy: process.env.CODEX_SKILL_NAME || DEFAULT_SKILL_NAME
    };
    await fs.writeFile(path.join(taskDir, MANIFEST_FILE_NAME), JSON.stringify(manifest, null, 2));
    result = await findTaskResultFiles(task.id);
  }

  return result;
}

async function resolveSkillEnvironment() {
  const fileEnv = await loadTaskEnvFiles();
  const mergedEnv = { ...fileEnv, ...process.env };
  const aicrmEnv = await loadAicrmRootEnv();
  const skillEnv = {};
  const image2ApiKey = firstNonEmpty(
    aicrmEnv.IMAGE2_API_KEY,
    aicrmEnv.OPENAI_IMAGE_API_KEY,
    mergedEnv.IMAGE2_API_KEY,
    mergedEnv.GPT_IMAGE_API_KEY
  );
  const openAiApiKey = firstNonEmpty(
    DEFAULT_IMAGE_BACKEND === "openai" ? image2ApiKey : "",
    aicrmEnv.OPENAI_API_KEY,
    mergedEnv.OPENAI_API_KEY,
    image2ApiKey
  );
  const baseUrl = firstNonEmpty(
    DEFAULT_IMAGE_BACKEND === "openai" ? aicrmEnv.IMAGE2_BASE_URL : "",
    DEFAULT_IMAGE_BACKEND === "openai" ? aicrmEnv.OPENAI_IMAGE_BASE_URL : "",
    DEFAULT_IMAGE_BACKEND === "openai" ? mergedEnv.IMAGE2_BASE_URL : "",
    aicrmEnv.OPENAI_BASE_URL,
    mergedEnv.OPENAI_BASE_URL,
    mergedEnv.IMAGE2_BASE_URL
  );
  const normalizedBaseUrl = normalizeSkillBaseUrl(baseUrl);
  const endpoint = normalizeSkillEndpoint(firstNonEmpty(
    mergedEnv.GPT_IMAGE_ENDPOINT,
    aicrmEnv.IMAGE2_ENDPOINT,
    mergedEnv.IMAGE2_ENDPOINT
  ));
  const modelName = firstNonEmpty(
    mergedEnv.GPT_IMAGE_MODEL_NAME,
    aicrmEnv.IMAGE2_MODEL,
    mergedEnv.IMAGE2_MODEL
  );
  const imageSize = firstNonEmpty(
    mergedEnv.GPT_IMAGE_SIZE,
    aicrmEnv.IMAGE2_SIZE,
    mergedEnv.IMAGE2_SIZE
  );
  const quality = firstNonEmpty(
    mergedEnv.GPT_IMAGE_QUALITY,
    aicrmEnv.IMAGE2_QUALITY,
    mergedEnv.IMAGE2_QUALITY
  );
  const proxyUrl = firstNonEmpty(
    aicrmEnv.OPENAI_PROXY_URL,
    mergedEnv.OPENAI_PROXY_URL,
    mergedEnv.HTTPS_PROXY,
    mergedEnv.HTTP_PROXY,
    mergedEnv.ALL_PROXY,
    mergedEnv.https_proxy,
    mergedEnv.http_proxy,
    mergedEnv.all_proxy
  );

  if (openAiApiKey) skillEnv.OPENAI_API_KEY = openAiApiKey;
  if (image2ApiKey) skillEnv.IMAGE2_API_KEY = image2ApiKey;
  if (normalizedBaseUrl) skillEnv.OPENAI_BASE_URL = normalizedBaseUrl;
  if (baseUrl) skillEnv.IMAGE2_BASE_URL = baseUrl;
  if (endpoint) skillEnv.GPT_IMAGE_ENDPOINT = endpoint;
  if (modelName) skillEnv.GPT_IMAGE_MODEL_NAME = modelName;
  if (imageSize) skillEnv.GPT_IMAGE_SIZE = imageSize;
  if (quality) skillEnv.GPT_IMAGE_QUALITY = quality;
  if (proxyUrl) {
    skillEnv.HTTP_PROXY = proxyUrl;
    skillEnv.HTTPS_PROXY = proxyUrl;
    skillEnv.ALL_PROXY = proxyUrl;
    skillEnv.http_proxy = proxyUrl;
    skillEnv.https_proxy = proxyUrl;
    skillEnv.all_proxy = proxyUrl;
  }

  return skillEnv;
}

async function loadAicrmRootEnv() {
  const rootEnv = {};

  for (const filePath of [path.resolve(APP_ROOT, "..", ".env"), path.resolve(APP_ROOT, "..", ".env.local")]) {
    try {
      Object.assign(rootEnv, parseEnvFile(await fs.readFile(filePath, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return rootEnv;
}

async function loadTaskEnvFiles() {
  const env = {};

  for (const filePath of TASK_ENV_FILES) {
    try {
      Object.assign(env, parseEnvFile(await fs.readFile(filePath, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return env;
}

function parseEnvFile(raw) {
  const env = {};

  for (const rawLine of String(raw || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 0) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) env[key] = value;
  }

  return env;
}

function normalizeSkillBaseUrl(value) {
  let url = String(value || "").trim().replace(/\/+$/, "");
  if (!url) return "";

  url = url.replace(/\/v1\/images\/generations$/i, "");
  url = url.replace(/\/images\/generations$/i, "");
  url = url.replace(/\/v1$/i, "");
  return url;
}

function normalizeSkillEndpoint(value) {
  const endpoint = String(value || "").trim().toLowerCase();
  if (!endpoint) return "";
  if (endpoint === "chat" || endpoint.includes("chat/completions")) return "chat";
  if (endpoint === "images" || endpoint.includes("images/generations")) return "images";
  if (endpoint === "auto") return "auto";
  return endpoint.replace(/^\/+/, "");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }

  return "";
}

function buildFallbackViewerHtml({ task, pptxFile }) {
  const escapedTitle = escapeHtml(task.input.topic);
  const escapedCustomer = escapeHtml(task.input.customerName || "未填写客户");
  const escapedPptx = escapeHtml(pptxFile);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapedTitle} - PPT Preview</title>
  <style>
    body { margin: 0; font-family: Aptos, "PingFang SC", sans-serif; background: #eef2ef; color: #17211c; }
    main { width: min(880px, calc(100% - 40px)); margin: 56px auto; background: #fff; border: 1px solid #d7e0da; border-radius: 8px; padding: 32px; }
    h1 { margin: 0 0 12px; font-size: 34px; }
    p { line-height: 1.7; color: #64736c; }
    a { display: inline-flex; min-height: 42px; align-items: center; padding: 0 16px; border-radius: 7px; background: #0f6f4f; color: #fff; text-decoration: none; font-weight: 800; }
    code { background: #eef2ef; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <p>Codex PPT Skill Runner</p>
    <h1>${escapedTitle}</h1>
    <p>客户：${escapedCustomer}</p>
    <p>Codex 已生成 PPT 文件，但没有检测到 Skill 输出的 HTML 预览页，因此这里提供一个本地 fallback viewer。</p>
    <p>文件：<code>${escapedPptx}</code></p>
    <a href="./${encodeURI(pptxFile)}">下载 PPT</a>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
