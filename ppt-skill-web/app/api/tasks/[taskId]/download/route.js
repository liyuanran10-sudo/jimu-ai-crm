import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getTaskDir } from "@/lib/paths.js";
import { findTaskResultFiles, getTask } from "@/lib/task-store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const { taskId } = await context.params;
  const task = await getTask(taskId);

  if (!task) {
    return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  }

  const result = await findTaskResultFiles(taskId);
  if (!result.pptxFile) {
    return NextResponse.json({ error: "当前任务没有可下载的 PPT 文件。" }, { status: 404 });
  }

  const absolutePath = path.join(getTaskDir(taskId), result.pptxFile);
  const buffer = await fs.readFile(absolutePath);
  const fileName = encodeURIComponent(path.basename(result.pptxFile));

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
      "Cache-Control": "no-store"
    }
  });
}
