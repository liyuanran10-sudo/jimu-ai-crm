import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv, getConfig } from "./config.js";
import { handleApiRequest, handleApiStreamRequest } from "./api-routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(projectRoot, "public");
const DEFAULT_JSON_BODY_LIMIT_BYTES = 20 * 1024 * 1024;
const KNOWLEDGE_UPLOAD_JSON_LIMIT_BYTES = 700 * 1024 * 1024;

loadDotEnv(path.join(projectRoot, ".env"));
const config = getConfig();

const server = http.createServer(async (request, response) => {
  try {
    applyCors(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    const streamed = await handleApiStreamRoute(request, response, url.pathname);
    if (streamed) return;

    const apiResult = await handleApiRoute(request, url.pathname);
    if (apiResult) {
      if (apiResult.isRaw) {
        response.writeHead(apiResult.status, apiResult.headers || {});
        response.end(apiResult.body);
        return;
      }
      sendJson(response, apiResult.status, apiResult.body);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { ok: false, error: "API route not found" });
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error.message || "Internal Server Error"
    });
  }
});

server.listen(config.port, () => {
  console.log(`Jimu AI CRM is running at http://localhost:${config.port}`);
});

async function handleApiRoute(request, pathname) {
  const body = request.method === "GET" ? {} : await readJson(request, pathname);
  return handleApiRequest({
    method: request.method,
    pathname,
    body,
    headers: request.headers,
    config
  });
}

async function handleApiStreamRoute(request, response, pathname) {
  if (pathname !== "/api/crm/generate-stream") return false;
  const body = request.method === "GET" ? {} : await readJson(request, pathname);
  return handleApiStreamRequest({
    method: request.method,
    pathname,
    body,
    headers: request.headers,
    config,
    response
  });
}

async function readJson(request, pathname = "") {
  const chunks = [];
  let total = 0;
  const limit = pathname === "/api/crm/upsert" || pathname === "/api/crm/customer-with-assets"
    ? KNOWLEDGE_UPLOAD_JSON_LIMIT_BYTES
    : DEFAULT_JSON_BODY_LIMIT_BYTES;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) {
      throw new Error(pathname === "/api/crm/upsert"
        ? "知识库上传请求过大：单次原始文件总量限制为 500MB。"
        : "Request body is too large.");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function applyCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CRM-Token");
}

async function serveStatic(pathname, response) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicRoot, safePath));

  if (!filePath.startsWith(publicRoot)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentType(filePath)
    });
    response.end(content);
  } catch {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end("Not Found");
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  return map[ext] || "application/octet-stream";
}
