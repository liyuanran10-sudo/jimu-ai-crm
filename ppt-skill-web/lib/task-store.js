import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  getTaskDir,
  getTaskFile,
  MANIFEST_FILE_NAME,
  OUTPUTS_ROOT
} from "./paths.js";

const globalStore = globalThis.__codexPptSkillTasks || new Map();
globalThis.__codexPptSkillTasks = globalStore;

export async function ensureOutputsRoot() {
  await fs.mkdir(OUTPUTS_ROOT, { recursive: true });
}

export function createTaskId() {
  return `task_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export async function createTask(input) {
  await ensureOutputsRoot();

  const id = createTaskId();
  const taskDir = getTaskDir(id);
  await fs.mkdir(taskDir, { recursive: true });

  const now = new Date().toISOString();
  const task = {
    id,
    status: "queued",
    input,
    result: null,
    error: "",
    createdAt: now,
    updatedAt: now,
    outputDir: taskDir,
    logsFile: path.join(taskDir, "codex.log")
  };

  await saveTask(task);
  return toPublicTask(task);
}

export async function getTask(taskId) {
  const cached = globalStore.get(taskId);
  if (cached) return toPublicTask(cached);

  const task = await readTask(taskId);
  if (!task) return null;
  globalStore.set(task.id, task);
  return toPublicTask(task);
}

export async function readTask(taskId) {
  try {
    const raw = await fs.readFile(getTaskFile(taskId), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function saveTask(task) {
  const next = {
    ...task,
    updatedAt: new Date().toISOString()
  };

  globalStore.set(next.id, next);
  await fs.mkdir(getTaskDir(next.id), { recursive: true });
  await fs.writeFile(getTaskFile(next.id), JSON.stringify(next, null, 2));
  return next;
}

export async function updateTask(taskId, patch) {
  const current = await readTask(taskId);
  if (!current) throw new Error(`Task not found: ${taskId}`);
  return saveTask({ ...current, ...patch });
}

export async function appendTaskLog(taskId, chunk) {
  const task = await readTask(taskId);
  if (!task) return;
  const text = typeof chunk === "string" ? chunk : String(chunk || "");
  if (!text) return;
  await fs.appendFile(task.logsFile, text);
}

export async function readTaskLog(taskId, maxChars = 6000) {
  const task = await readTask(taskId);
  if (!task) return "";

  try {
    const raw = await fs.readFile(task.logsFile, "utf8");
    return raw.slice(-maxChars);
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

export async function findTaskResultFiles(taskId) {
  const taskDir = getTaskDir(taskId);
  const files = await listFiles(taskDir);
  const relativeFiles = files.map((file) => path.relative(taskDir, file).replaceAll("\\", "/"));
  const generatedFiles = relativeFiles.filter((file) => !/^template\.(ppt|pptx|potx)$/i.test(path.basename(file)));
  const pptxFile = generatedFiles.find((file) => /\.pptx$/i.test(file)) || "";
  const htmlFile =
    generatedFiles.find((file) => /^index\.html$/i.test(file)) ||
    generatedFiles.find((file) => /\.html?$/i.test(file)) ||
    "";
  const manifestFile = relativeFiles.find((file) => file === MANIFEST_FILE_NAME) || "";
  const promptsFile = generatedFiles.find((file) => file === "prompts.json") || "";
  const imageFiles = generatedFiles
    .filter((file) => /^images\/.+\.(png|jpe?g|webp)$/i.test(file))
    .sort((a, b) => a.localeCompare(b));
  const manifest = manifestFile ? await readJsonFile(path.join(taskDir, manifestFile)) : {};

  return {
    pptxFile,
    htmlFile,
    manifestFile,
    promptsFile,
    imageFiles,
    imageCount: imageFiles.length,
    engine: manifest.engine || (imageFiles.length ? "gpt-image2-ppt" : ""),
    usedImage2: typeof manifest.usedImage2 === "boolean" ? manifest.usedImage2 : imageFiles.length > 0,
    imageModel: manifest.imageModel || manifest.model || "",
    imageBackend: manifest.imageBackend || manifest.backend || "",
    imageEndpoint: manifest.imageEndpoint || "",
    files: relativeFiles
  };
}

async function listFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "task.json" || entry.name === "codex.log") continue;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    return {};
  }
}

export function toPublicTask(task) {
  const result = task.result || null;
  return {
    id: task.id,
    status: task.status,
    input: task.input,
    result,
    error: task.error || "",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    outputDir: task.outputDir,
    viewerUrl: result?.htmlFile ? `/viewer/${task.id}/${result.htmlFile}` : "",
    downloadUrl: result?.pptxFile ? `/api/tasks/${task.id}/download` : ""
  };
}
