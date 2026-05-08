import path from "node:path";
import { loadDotEnv, getConfig } from "../../src/config.js";
import { handleApiRequest, handleApiStreamRequest } from "../../src/api-routes.js";

loadDotEnv(path.resolve(".env"));

process.env.JIMU_SERVERLESS_RUNTIME = process.env.JIMU_SERVERLESS_RUNTIME || "netlify";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-CRM-Token",
  "Content-Type": "application/json; charset=utf-8"
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ""
    };
  }

  try {
    const config = getConfig();
    const body = parseBody(event);
    const pathname = normalizeApiPath(event.path);
    const streamResponse = createBufferedStreamResponse();
    const streamed = await handleApiStreamRequest({
      method: event.httpMethod,
      pathname,
      body,
      headers: event.headers || {},
      config,
      response: streamResponse
    });
    if (streamed) {
      return streamResponse.toNetlifyResponse();
    }

    const apiResult = await handleApiRequest({
      method: event.httpMethod,
      pathname,
      body,
      headers: event.headers || {},
      config
    });

    if (!apiResult) {
      return json(404, { ok: false, error: "API route not found" });
    }

    if (apiResult.isRaw) {
      return {
        statusCode: apiResult.status,
        headers: apiResult.headers || {},
        body: Buffer.from(apiResult.body).toString("base64"),
        isBase64Encoded: true
      };
    }

    return json(apiResult.status, apiResult.body);
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || "Internal Server Error"
    });
  }
}

function createBufferedStreamResponse() {
  const chunks = [];
  let statusCode = 200;
  let headers = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform"
  };
  return {
    destroyed: false,
    writableEnded: false,
    writeHead(status, nextHeaders = {}) {
      statusCode = status;
      headers = { ...headers, ...nextHeaders };
    },
    write(chunk) {
      chunks.push(String(chunk || ""));
    },
    end(chunk = "") {
      if (chunk) chunks.push(String(chunk));
      this.writableEnded = true;
    },
    toNetlifyResponse() {
      return {
        statusCode,
        headers,
        body: chunks.join("")
      };
    }
  };
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function normalizeApiPath(rawPath = "") {
  let pathname = rawPath || "/";
  const functionPrefix = "/.netlify/functions/api";
  if (pathname.startsWith(functionPrefix)) {
    pathname = pathname.slice(functionPrefix.length) || "/";
  }
  if (pathname === "/") return "/api";
  return pathname.startsWith("/api/") ? pathname : `/api${pathname}`;
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(payload, null, 2)
  };
}
