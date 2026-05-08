import path from "node:path";
import { loadDotEnv, getConfig } from "../../src/config.js";
import { runImageBackgroundJob } from "../../src/api-routes.js";

loadDotEnv(path.resolve(".env"));

process.env.JIMU_SERVERLESS_RUNTIME = process.env.JIMU_SERVERLESS_RUNTIME || "netlify";

export async function handler(event) {
  try {
    const config = getConfig();
    const secret = event.headers?.["x-internal-job-secret"] || event.headers?.["X-Internal-Job-Secret"] || "";
    if (config.crmAuthSecret && secret !== config.crmAuthSecret) {
      return json(401, { ok: false, error: "unauthorized" });
    }

    const body = parseBody(event);
    if (!body?.kind || !body?.recordId) {
      return json(400, { ok: false, error: "kind and recordId are required" });
    }

    await runImageBackgroundJob({
      kind: body.kind,
      recordId: body.recordId,
      body: body.body || {},
      itemId: body.itemId || "",
      modification: body.modification || "",
      actorUser: body.actorUser || { id: "system", name: "系统任务", role: "admin" },
      config
    });

    return json(202, { ok: true, message: "background job accepted" });
  } catch (error) {
    return json(500, { ok: false, error: error.message || "background job failed" });
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
