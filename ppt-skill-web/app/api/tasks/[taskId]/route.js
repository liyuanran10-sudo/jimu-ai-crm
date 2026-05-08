import { NextResponse } from "next/server";
import { getTask, readTaskLog } from "@/lib/task-store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const { taskId } = await context.params;
  const task = await getTask(taskId);

  if (!task) {
    return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  }

  const logs = await readTaskLog(taskId);
  return NextResponse.json({ task, logs });
}
