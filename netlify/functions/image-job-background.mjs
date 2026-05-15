import path from "node:path";
import { loadDotEnv, getConfig } from "../../src/config.js";
import { markBackgroundJobFailed, runImageBackgroundJob } from "../../src/api-routes.js";

loadDotEnv(path.resolve(".env"));

process.env.JIMU_SERVERLESS_RUNTIME = process.env.JIMU_SERVERLESS_RUNTIME || "netlify";

export async function handler(event) {
  let body = {};
  try {
    const config = getConfig();
    body = parseBody(event);
    const secret = event.headers?.["x-internal-job-secret"] || event.headers?.["X-Internal-Job-Secret"] || body.internalJobSecret || "";
    if (config.crmAuthSecret && secret !== config.crmAuthSecret) {
      return json(401, { ok: false, error: "unauthorized" });
    }

    if (!body?.kind || !body?.recordId) {
      return json(400, { ok: false, error: "kind and recordId are required" });
    }
    delete body.internalJobSecret;

    console.info("background job started", { kind: body.kind, recordId: body.recordId });
    await runImageBackgroundJob({
      kind: body.kind,
      recordId: body.recordId,
      body: body.body || {},
      itemId: body.itemId || "",
      modification: body.modification || "",
      actorUser: body.actorUser || { id: "system", name: "系统任务", role: "admin" },
      config
    });
    console.info("background job completed", { kind: body.kind, recordId: body.recordId });

    return json(202, { ok: true, message: "background job accepted" });
  } catch (error) {
    const errorText = error.message || "background job failed";
    console.error("background job failed", redactBackgroundError(errorText));
    if (body?.kind && body?.recordId) {
      try {
        await markBackgroundJobFailed({
          kind: body.kind,
          recordId: body.recordId,
          body: body.body || {},
          itemId: body.itemId || "",
          errorText: `Netlify 后台函数执行失败：${errorText}`
        });
        return json(202, { ok: false, error: "background job failed and was marked failed" });
      } catch (markError) {
        console.error("failed to mark background job", redactBackgroundError(markError.message || ""));
      }
    }
    return json(500, { ok: false, error: errorText });
  }
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload, null, 2)
  };
}

function redactBackgroundError(text = "") {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret|password)[\"']?\s*[:=]\s*[\"']?[^\"'\\s,}]+/gi, "$1=[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]");
}
