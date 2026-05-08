import path from "node:path";

export const APP_ROOT = process.cwd();
export const OUTPUTS_ROOT = path.join(APP_ROOT, "outputs");
export const TASK_FILE_NAME = "task.json";
export const MANIFEST_FILE_NAME = "manifest.json";

export function assertTaskId(taskId) {
  const id = String(taskId || "");
  if (!/^task_[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid task id.");
  }
  return id;
}

export function getTaskDir(taskId) {
  return path.join(OUTPUTS_ROOT, assertTaskId(taskId));
}

export function getTaskFile(taskId) {
  return path.join(getTaskDir(taskId), TASK_FILE_NAME);
}

export function normalizeOutputRelativePath(filePath) {
  const clean = String(filePath || "").replaceAll("\\", "/");
  const normalized = path.posix.normalize(clean);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    path.isAbsolute(normalized)
  ) {
    throw new Error("Invalid output file path.");
  }
  return normalized;
}
