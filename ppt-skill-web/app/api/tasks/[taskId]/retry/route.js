import { NextResponse } from "next/server";
import { getTask, updateTask, appendTaskLog } from "@/lib/task-store.js";
import { startCodexTask } from "@/lib/codex-runner.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request, context) {
  const { taskId } = await context.params;
  const task = await getTask(taskId);

  if (!task) {
    return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  }

  if (!["failed", "succeeded"].includes(task.status)) {
    return NextResponse.json({ error: "只有失败或已完成任务可以重试。" }, { status: 400 });
  }

  await updateTask(taskId, {
    status: "queued",
    result: null,
    error: ""
  });
  await appendTaskLog(taskId, `\n[runner] Task retried at ${new Date().toISOString()}\n`);
  startCodexTask(taskId);

  const restartedTask = await getTask(taskId);
  return NextResponse.json({ task: restartedTask });
}
