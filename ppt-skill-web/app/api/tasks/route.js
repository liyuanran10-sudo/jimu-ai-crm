import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getTaskDir } from "@/lib/paths.js";
import { createTask, getTask, updateTask } from "@/lib/task-store.js";
import { startCodexTask } from "@/lib/codex-runner.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const form = await request.formData();
    const input = buildInputFromForm(form);
    const template = form.get("template");

    if (input.hasTemplate && !isUploadedFile(template)) {
      return NextResponse.json({ error: "已选择上传 PPT 模板，但没有收到模板文件。" }, { status: 400 });
    }

    const task = await createTask(input);

    if (isUploadedFile(template)) {
      const templateInfo = await saveTemplateFile(task.id, template);
      await updateTask(task.id, {
        input: {
          ...input,
          hasTemplate: true,
          templateFileName: templateInfo.originalName,
          templatePath: templateInfo.path
        }
      });
    }

    startCodexTask(task.id);
    const startedTask = await getTask(task.id);
    return NextResponse.json({ task: startedTask }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "创建任务失败。" }, { status: 400 });
  }
}

function buildInputFromForm(form) {
  const topic = String(form.get("topic") || "").trim();
  if (!topic) throw new Error("PPT 主题不能为空。");

  const pageCount = Number.parseInt(String(form.get("pageCount") || "8"), 10);
  if (!Number.isFinite(pageCount) || pageCount < 1 || pageCount > 80) {
    throw new Error("页数必须是 1 到 80 之间的数字。");
  }

  return {
    topic,
    customerName: String(form.get("customerName") || "").trim(),
    projectBackground: String(form.get("projectBackground") || "").trim(),
    coreContent: String(form.get("coreContent") || "").trim(),
    pageCount,
    style: String(form.get("style") || "现代商务 / 清晰汇报").trim(),
    hasTemplate: String(form.get("hasTemplate") || "") === "true",
    templateFileName: "",
    templatePath: ""
  };
}

function isUploadedFile(value) {
  return value && typeof value === "object" && typeof value.arrayBuffer === "function" && Number(value.size || 0) > 0;
}

async function saveTemplateFile(taskId, file) {
  const originalName = sanitizeFileName(file.name || "template.pptx");
  const extension = path.extname(originalName).toLowerCase();
  if (![".ppt", ".pptx", ".potx"].includes(extension)) {
    throw new Error("模板文件仅支持 .ppt、.pptx、.potx。");
  }

  const targetName = `template${extension}`;
  const targetPath = path.join(getTaskDir(taskId), targetName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(targetPath, buffer);

  return {
    originalName,
    path: targetPath
  };
}

function sanitizeFileName(value) {
  return String(value || "template.pptx").replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_").slice(0, 120);
}
