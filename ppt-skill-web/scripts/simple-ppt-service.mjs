import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { appendTaskLog, createTask, getTask, readTaskLog, updateTask, findTaskResultFiles } from "../lib/task-store.js";
import { getTaskDir, normalizeOutputRelativePath } from "../lib/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const AICRM_ROOT = path.resolve(APP_ROOT, "..");
const PORT = Number(process.env.PORT || 3100);
const PUBLIC_BASE_URL = process.env.PPT_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const BUNDLED_PYTHON = "/Users/mangolee/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const DEFAULT_SKILL_NAME = "gpt-image2-ppt";
const DEFAULT_SKILL_DIR = path.join(APP_ROOT, "vendor", "gpt-image2-ppt-skills");
const PYTHON_CANDIDATES = [
  process.env.PYTHON_BIN,
  "/usr/bin/python3",
  BUNDLED_PYTHON,
  "python3"
].filter(Boolean);
const TASK_ENV_FILES = [
  path.join(AICRM_ROOT, ".env"),
  path.join(AICRM_ROOT, ".env.local"),
  path.join(APP_ROOT, ".env"),
  path.join(APP_ROOT, ".env.local")
];

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", PUBLIC_BASE_URL);
    if (request.method === "GET" && url.pathname === "/") {
      return html(response, 200, renderHome());
    }
    if (request.method === "POST" && url.pathname === "/api/tasks") {
      const input = await parseTaskInput(request);
      const task = await createTask(input);
      runSimplePptTask(task.id).catch(async (error) => {
        await updateTask(task.id, {
          status: "failed",
          error: error?.message || "PPT 生成任务失败"
        });
      });
      return json(response, 201, { task: absolutizeTask(await getTask(task.id)) });
    }
    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (request.method === "GET" && taskMatch) {
      const task = await getTask(taskMatch[1]);
      if (!task) return json(response, 404, { error: "任务不存在。" });
      return json(response, 200, { task: absolutizeTask(task), logs: await readTaskLog(task.id) });
    }
    const downloadMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/download$/);
    if (request.method === "GET" && downloadMatch) {
      return sendTaskFile(response, downloadMatch[1], "pptx");
    }
    const viewerMatch = url.pathname.match(/^\/viewer\/([^/]+)\/(.+)$/);
    if (request.method === "GET" && viewerMatch) {
      return sendViewerFile(response, viewerMatch[1], viewerMatch[2]);
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 500, { error: error?.message || "PPT 服务异常" });
  }
});

server.listen(PORT, () => {
  console.log(`gpt-image2-ppt Skill service is running at ${PUBLIC_BASE_URL}`);
});

async function parseTaskInput(request) {
  const contentType = request.headers["content-type"] || "";
  if (contentType.includes("multipart/form-data")) {
    return normalizeInput(await parseMultipartForm(request, contentType));
  }
  if (contentType.includes("application/json")) {
    return normalizeInput(await readJson(request));
  }
  return normalizeInput(Object.fromEntries(new URLSearchParams(await readText(request))));
}

function normalizeInput(raw = {}) {
  const topic = String(raw.topic || "").trim();
  if (!topic) throw new Error("PPT 主题不能为空。");
  const pageCount = Math.max(1, Math.min(24, Number.parseInt(String(raw.pageCount || "10"), 10) || 10));
  return {
    topic,
    customerName: String(raw.customerName || "").trim(),
    projectBackground: String(raw.projectBackground || "").trim(),
    coreContent: String(raw.coreContent || "").trim(),
    pageCount,
    style: String(raw.style || "现代商务 / SaaS 产品方案风").trim(),
    hasTemplate: false,
    templateFileName: "",
    templatePath: ""
  };
}

async function runSimplePptTask(taskId) {
  const task = await getTask(taskId);
  if (!task || task.status !== "queued") return;
  await updateTask(taskId, { status: "running", error: "", result: null });
  const taskDir = getTaskDir(taskId);
  const skillDir = process.env.CODEX_SKILL_DIR || DEFAULT_SKILL_DIR;
  const pythonBin = await resolvePythonBin(taskId);
  const skillEnv = await resolveSkillEnvironment();
  const imageBackend = skillEnv.GPT_IMAGE_BACKEND || "openai";
  const imageConcurrency = skillEnv.GPT_IMAGE_CONCURRENCY || "1";
  const styleFile = mapStyleToSkillStyle(task.input.style);
  const stylePath = path.join(skillDir, "styles", styleFile);
  const slidesPlanMd = path.join(taskDir, "slides_plan.md");
  const slidesPlanJson = path.join(taskDir, "slides_plan.json");
  const viewerTemplate = path.join(skillDir, "templates", "viewer.html");

  await fs.appendFile(path.join(taskDir, "codex.log"), `[skill-runner] started ${new Date().toISOString()}\n`);
  await ensureSkillAvailable(skillDir);
  await fs.writeFile(slidesPlanMd, buildSlidesPlanMarkdown(task.input), "utf8");

  const childEnv = {
    ...process.env,
    ...skillEnv
  };

  await runCommand(pythonBin, [
    path.join(skillDir, "scripts", "md_to_plan.py"),
    slidesPlanMd,
    "-o",
    slidesPlanJson
  ], { cwd: APP_ROOT, env: childEnv, taskId });

  await runCommand(pythonBin, [
    path.join(skillDir, "scripts", "generate_ppt.py"),
    "--plan",
    slidesPlanJson,
    "--style",
    stylePath,
    "--template",
    viewerTemplate,
    "--output",
    taskDir,
    "--concurrency",
    imageConcurrency,
    "--backend",
    imageBackend
  ], { cwd: APP_ROOT, env: childEnv, taskId });

  let result = await findTaskResultFiles(taskId);
  if (!result.pptxFile) throw new Error("gpt-image2-ppt Skill 已执行，但没有找到 PPTX 文件。");
  if (!result.imageFiles?.length) {
    throw new Error("gpt-image2-ppt Skill 已执行，但没有检测到 images/slide-*.png，说明本次不是 image2 图片式 PPT 输出。");
  }

  await writeSkillManifest({
    taskId,
    input: task.input,
    result,
    skillDir,
    styleFile,
    skillEnv,
    imageBackend
  });
  result = await findTaskResultFiles(taskId);

  await updateTask(taskId, {
    status: "succeeded",
    result,
    error: ""
  });
  await fs.appendFile(path.join(taskDir, "codex.log"), `[skill-runner] succeeded ${new Date().toISOString()}\n`);
}

let cachedPythonBin = "";

async function resolvePythonBin(taskId) {
  if (cachedPythonBin) return cachedPythonBin;
  const moduleCheck = "import dotenv, requests, pptx, jsonschema, fitz; print('ok')";
  const failures = [];

  for (const candidate of PYTHON_CANDIDATES) {
    try {
      await runCommand(candidate, ["-c", moduleCheck], { cwd: APP_ROOT });
      cachedPythonBin = candidate;
      if (taskId) await appendTaskLog(taskId, `[skill-runner] python=${candidate}\n`);
      return cachedPythonBin;
    } catch (error) {
      failures.push(`${candidate}: ${String(error.message || error).split("\n")[0]}`);
    }
  }

  throw new Error(`没有找到可运行 gpt-image2-ppt 的 Python 环境，缺少 python-dotenv / requests / python-pptx / jsonschema / pymupdf。${failures.join("；")}`);
}

async function ensureSkillAvailable(skillDir) {
  const requiredFiles = [
    path.join(skillDir, "SKILL.md"),
    path.join(skillDir, "scripts", "md_to_plan.py"),
    path.join(skillDir, "scripts", "generate_ppt.py"),
    path.join(skillDir, "templates", "viewer.html")
  ];

  for (const filePath of requiredFiles) {
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error(`未找到本机 ${DEFAULT_SKILL_NAME} Skill 必需文件：${filePath}`);
    }
  }
}

function buildSlidesPlanMarkdown(input = {}) {
  const title = input.topic || "轻量级方案 PPT";
  const customer = input.customerName || "目标客户";
  const background = input.projectBackground || "基于当前 AICRM 客户上下文自动生成。";
  const core = input.coreContent || "";
  const pageCount = Number(input.pageCount || 10);
  const outlineSlides = extractOutlineSlides(core, pageCount);
  const slides = outlineSlides.length ? outlineSlides : buildFallbackSlides({ title, customer, background, core, pageCount });

  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    "---",
    "",
    ...slides.map((slide, index) => {
      const prefix = `## ${index + 1}. [${slide.pageType || inferPageType(slide.title, index, slides.length)}] ${cleanSlideTitle(slide.title)}`;
      const body = limitMarkdownSection(slide.body || "", 1800);
      return `${prefix}\n${body}`;
    })
  ].join("\n\n");
}

function extractOutlineSlides(markdown = "", pageCount = 10) {
  const source = String(markdown || "");
  const headingRegex = /^###\s*第\s*(\d+)\s*页\s*[：: ]+(.+)$/gm;
  const matches = Array.from(source.matchAll(headingRegex));
  if (!matches.length) return [];

  return matches.slice(0, pageCount).map((match, index) => {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? source.length;
    const title = cleanSlideTitle(match[2]);
    return {
      title,
      pageType: inferPageType(title, index, Math.min(matches.length, pageCount)),
      body: source.slice(bodyStart, bodyEnd).trim()
    };
  });
}

function buildFallbackSlides({ title, customer, background, core, pageCount }) {
  const plain = stripMarkdown(core || background);
  const chunks = chunkText(plain || background, 420);
  const titles = [
    title,
    "项目理解与建设目标",
    "软件产品整体承接方向",
    "当前需求下的产品层次梳理",
    "核心业务场景与使用路径",
    "按端口梳理的产品功能结构",
    "AI能力融入点与场景方案",
    "产品结构骨架与后续深化方向",
    "项目后续确认事项",
    "下一步推进建议"
  ].slice(0, pageCount);

  return titles.map((slideTitle, index) => ({
    title: slideTitle,
    pageType: inferPageType(slideTitle, index, titles.length),
    body: [
      index === 0 ? `客户：${customer}` : "基于当前客户上下文与轻量级方案结构稿生成。",
      "",
      chunks[index] || background || "请围绕客户业务目标、产品结构、核心场景和 AI 融入价值进行清晰表达。",
      "",
      "视觉要求：互联网科技公司 / SaaS 产品方案风，浅色背景，卡片式布局，信息层级清晰。"
    ].join("\n")
  }));
}

function inferPageType(title = "", index = 0, total = 1) {
  const text = String(title || "");
  if (index === 0 || /封面|首页|标题/.test(text)) return "cover";
  if (index === total - 1 || /数据|收益|价值|总结|下一步|建议/.test(text)) return "data";
  return "content";
}

function cleanSlideTitle(title = "") {
  return String(title || "未命名页面")
    .replace(/^【|】$/g, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim() || "未命名页面";
}

function limitMarkdownSection(markdown = "", limit = 1800) {
  const value = String(markdown || "").trim();
  if (value.length <= limit) return value;
  const sliced = value.slice(0, limit);
  const lastBreak = sliced.lastIndexOf("\n\n");
  return `${lastBreak > 240 ? sliced.slice(0, lastBreak) : sliced}...`;
}

function chunkText(text = "", size = 420) {
  const value = String(text || "").trim();
  if (!value) return [];
  const chunks = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

function stripMarkdown(markdown = "") {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~|[\]-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapStyleToSkillStyle(style = "") {
  const text = String(style || "").toLowerCase();
  if (/深色|aurora|dark/.test(text)) return "dark-aurora.md";
  if (/极简|白底|grid|swiss/.test(text)) return "swiss-grid.md";
  if (/咨询|mono|editorial|图表|汇报/.test(text)) return "editorial-mono.md";
  if (/投标|正式|tech|蓝绿|ai|产品|科技|saas/.test(text)) return "clean-tech-blue.md";
  return "gradient-glass.md";
}

async function resolveSkillEnvironment() {
  const fileEnv = await loadEnvFiles();
  const merged = { ...fileEnv, ...process.env };
  const configuredBackend = firstNonEmpty(merged.GPT_IMAGE_BACKEND, "openai");
  const image2ApiKey = firstNonEmpty(
    merged.IMAGE2_API_KEY,
    merged.OPENAI_IMAGE_API_KEY,
    merged.GPT_IMAGE_API_KEY,
    configuredBackend === "openai" ? merged.OPENAI_API_KEY : ""
  );
  const openAiApiKey = firstNonEmpty(
    configuredBackend === "openai" ? image2ApiKey : "",
    merged.OPENAI_API_KEY,
    image2ApiKey
  );
  const baseUrl = firstNonEmpty(
    configuredBackend === "openai" ? merged.IMAGE2_BASE_URL : "",
    configuredBackend === "openai" ? merged.OPENAI_IMAGE_BASE_URL : "",
    merged.OPENAI_BASE_URL,
    merged.IMAGE2_BASE_URL
  );
  const normalizedBaseUrl = normalizeSkillBaseUrl(baseUrl);
  const endpoint = normalizeSkillEndpoint(firstNonEmpty(
    merged.GPT_IMAGE_ENDPOINT,
    merged.IMAGE2_ENDPOINT,
    "images"
  ));
  const modelName = firstNonEmpty(
    merged.GPT_IMAGE_MODEL_NAME,
    merged.IMAGE2_MODEL,
    "gpt-image-2"
  );
  const imageSize = firstNonEmpty(
    merged.GPT_IMAGE_SIZE,
    merged.IMAGE2_SIZE,
    "1792x1024"
  );
  const quality = firstNonEmpty(merged.GPT_IMAGE_QUALITY, merged.IMAGE2_QUALITY, "high");
  const concurrency = firstNonEmpty(merged.GPT_IMAGE_CONCURRENCY, "1");
  const proxyUrl = firstNonEmpty(
    merged.OPENAI_PROXY_URL,
    merged.HTTPS_PROXY,
    merged.HTTP_PROXY,
    merged.ALL_PROXY,
    merged.https_proxy,
    merged.http_proxy,
    merged.all_proxy
  );

  if (!openAiApiKey) {
    throw new Error("未配置 IMAGE2_API_KEY / OPENAI_API_KEY，无法调用 gpt-image2-ppt 的 image2 出图链路。");
  }

  const env = {
    OPENAI_API_KEY: openAiApiKey,
    GPT_IMAGE_MODEL_NAME: modelName,
    GPT_IMAGE_SIZE: imageSize,
    GPT_IMAGE_ENDPOINT: endpoint,
    GPT_IMAGE_BACKEND: configuredBackend,
    GPT_IMAGE_CONCURRENCY: concurrency,
    GPT_IMAGE_QUALITY: quality
  };
  if (normalizedBaseUrl) env.OPENAI_BASE_URL = normalizedBaseUrl;
  if (baseUrl) env.IMAGE2_BASE_URL = baseUrl;

  if (proxyUrl && shouldUseProxyForBaseUrl(normalizedBaseUrl || baseUrl)) {
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    env.ALL_PROXY = proxyUrl;
    env.http_proxy = proxyUrl;
    env.https_proxy = proxyUrl;
    env.all_proxy = proxyUrl;
  } else {
    env.HTTP_PROXY = "";
    env.HTTPS_PROXY = "";
    env.ALL_PROXY = "";
    env.http_proxy = "";
    env.https_proxy = "";
    env.all_proxy = "";
  }

  return env;
}

async function loadEnvFiles() {
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

function parseEnvFile(raw = "") {
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

function normalizeSkillBaseUrl(value = "") {
  let url = String(value || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  url = url.replace(/\/v1\/images\/generations$/i, "");
  url = url.replace(/\/images\/generations$/i, "");
  url = url.replace(/\/v1$/i, "");
  return url;
}

function normalizeSkillEndpoint(value = "") {
  const endpoint = String(value || "").trim().toLowerCase();
  if (!endpoint) return "";
  if (endpoint === "chat" || endpoint.includes("chat/completions")) return "chat";
  if (endpoint === "images" || endpoint.includes("images/generations")) return "images";
  if (endpoint === "auto") return "auto";
  return endpoint.replace(/^\/+/, "");
}

function shouldUseProxyForBaseUrl(baseUrl = "") {
  const text = String(baseUrl || "").toLowerCase();
  if (!text) return true;
  return !/tokenrouter\.tech|cliproxyapi/.test(text);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

async function writeSkillManifest({ taskId, input, result, skillDir, styleFile, skillEnv, imageBackend }) {
  const taskDir = getTaskDir(taskId);
  const manifestPath = path.join(taskDir, "manifest.json");
  const existing = await readJsonFile(manifestPath);
  const manifest = {
    ...existing,
    title: input.topic || existing.title || "AICRM PPT",
    customerName: input.customerName || existing.customerName || "",
    slideCount: result.imageFiles?.length || input.pageCount || existing.slideCount || 0,
    pptxFile: result.pptxFile,
    htmlFile: result.htmlFile,
    promptsFile: result.promptsFile || "prompts.json",
    generatedAt: new Date().toISOString(),
    generatedBy: DEFAULT_SKILL_NAME,
    engine: DEFAULT_SKILL_NAME,
    usedImage2: true,
    imageModel: skillEnv.GPT_IMAGE_MODEL_NAME || "gpt-image-2",
    imageBackend,
    imageEndpoint: skillEnv.GPT_IMAGE_ENDPOINT || "images",
    imageSize: skillEnv.GPT_IMAGE_SIZE || "",
    imageCount: result.imageFiles?.length || 0,
    imageFiles: result.imageFiles || [],
    styleFile,
    skillDir
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    return {};
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env });
    let stderr = "";
    const log = (chunk) => {
      const text = chunk.toString();
      if (options.taskId) appendTaskLog(options.taskId, text).catch(() => {});
      return text;
    };
    child.stdout.on("data", log);
    child.stderr.on("data", (chunk) => { stderr += log(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

async function sendTaskFile(response, taskId, kind) {
  const result = await findTaskResultFiles(taskId);
  const relative = kind === "pptx" ? result.pptxFile : result.htmlFile;
  if (!relative) return json(response, 404, { error: "当前任务没有可下载文件。" });
  const filePath = path.join(getTaskDir(taskId), relative);
  const buffer = await fs.readFile(filePath);
  response.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(relative))}`,
    "Cache-Control": "no-store"
  });
  response.end(buffer);
}

async function sendViewerFile(response, taskId, rawRelative) {
  const relative = normalizeOutputRelativePath(decodeURIComponent(rawRelative));
  const filePath = path.join(getTaskDir(taskId), relative);
  const buffer = await fs.readFile(filePath);
  response.writeHead(200, {
    "Content-Type": relative.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream",
    "Cache-Control": "no-store"
  });
  response.end(buffer);
}

function absolutizeTask(task) {
  if (!task) return task;
  return {
    ...task,
    viewerUrl: task.viewerUrl ? new URL(task.viewerUrl, PUBLIC_BASE_URL).toString() : "",
    downloadUrl: task.downloadUrl ? new URL(task.downloadUrl, PUBLIC_BASE_URL).toString() : ""
  };
}

async function readText(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readBuffer(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function parseMultipartForm(request, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1]
    || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) throw new Error("multipart/form-data 缺少 boundary。");
  const raw = (await readBuffer(request)).toString("utf8");
  const fields = {};
  for (const part of raw.split(`--${boundary}`)) {
    const clean = part.replace(/^\r?\n/, "").replace(/\r?\n--\s*$/, "");
    if (!clean.trim()) continue;
    const separator = clean.indexOf("\r\n\r\n");
    if (separator < 0) continue;
    const headers = clean.slice(0, separator);
    let value = clean.slice(separator + 4);
    value = value.replace(/\r?\n$/, "");
    const name = headers.match(/name="([^"]+)"/)?.[1];
    const filename = headers.match(/filename="([^"]*)"/)?.[1];
    if (!name || filename) continue;
    fields[name] = value;
  }
  return fields;
}

async function readJson(request) {
  const text = await readText(request);
  return text ? JSON.parse(text) : {};
}

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function html(response, status, content) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(content);
}

function renderHome() {
  return "<!doctype html><meta charset='utf-8'><title>AICRM PPT Skill</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;background:#f5f8fc;color:#101828;padding:40px}main{max-width:760px;margin:auto;background:#fff;border:1px solid #e7edf5;border-radius:22px;padding:28px}code{background:#eef4ff;border-radius:8px;padding:2px 8px}</style><main><h1>AICRM PPT Skill Service</h1><p>当前服务会直接调用本机 <code>gpt-image2-ppt</code> Skill，并通过 image2 逐页生成图片式 PPT。</p><p>接口支持 <code>/api/tasks</code> 创建、轮询、HTML 预览和 PPTX 下载。</p></main>";
}
