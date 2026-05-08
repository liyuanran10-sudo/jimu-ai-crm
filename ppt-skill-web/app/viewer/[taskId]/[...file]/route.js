import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getTaskDir, normalizeOutputRelativePath } from "@/lib/paths.js";
import { getTask } from "@/lib/task-store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const { taskId, file } = await context.params;
  const task = await getTask(taskId);

  if (!task) {
    return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  }

  const relativePath = normalizeOutputRelativePath(Array.isArray(file) ? file.join("/") : file);
  const taskDir = getTaskDir(taskId);
  const absolutePath = path.join(taskDir, relativePath);
  const resolved = path.resolve(absolutePath);
  const relativeFromTaskDir = path.relative(path.resolve(taskDir), resolved);

  if (relativeFromTaskDir.startsWith("..") || path.isAbsolute(relativeFromTaskDir)) {
    return NextResponse.json({ error: "非法文件路径。" }, { status: 400 });
  }

  try {
    const buffer = await fs.readFile(resolved);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentTypeFor(resolved),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return NextResponse.json({ error: "文件不存在。" }, { status: 404 });
    }
    throw error;
  }
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const table = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  };

  return table[ext] || "application/octet-stream";
}
