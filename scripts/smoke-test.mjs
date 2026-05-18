import assert from "node:assert/strict";
import { handleApiRequest, handleApiStreamRequest, runImageBackgroundJob } from "../src/api-routes.js";
import { buildAgentDecision } from "../src/agent/runtime.js";
import { buildRagContext, normalizeKnowledgeBaseDocuments } from "../src/rag-service.js";
import { organizeContent } from "../src/organizer.js";
import { markdownToNotionBlocks } from "../src/markdown-to-notion.js";

const sample = [
  "# GPT 内容保存到 Notion 的方案",
  "",
  "目标：把 GPT 里好的回答整理成知识卡片，并写入 Notion。",
  "",
  "- 自动生成标题",
  "- 自动生成摘要",
  "- 推荐标签",
  "",
  "```js",
  "console.log('capture');",
  "```"
].join("\n");

const capture = await organizeContent({
  content: sample,
  sourceTitle: "Smoke Test",
  sourceUrl: "https://example.com"
}, {
  openaiApiKey: ""
});

assert.equal(capture.title, "GPT 内容保存到 Notion 的方案");
assert.ok(capture.summary.length > 0);
assert.ok(capture.tags.includes("AI"));
assert.ok(capture.markdown.includes("## 正文"));

const blocks = markdownToNotionBlocks(capture.markdown);
assert.ok(Array.isArray(blocks));
assert.ok(blocks.length > 3);
assert.ok(blocks.some((block) => block.type === "code"));

const config = {
  syncTarget: "local",
  openaiApiKey: "",
  openaiModel: "gpt-4.1-mini",
  notionApiKey: "",
  notionDatabaseId: "",
  notionParentPageId: "",
  feishuAppId: "",
  feishuAppSecret: "",
  feishuFolderToken: "",
  feishuWikiSpaceId: ""
};

const login = await handleApiRequest({
  method: "POST",
  pathname: "/api/crm/login",
  body: {
    email: "mango@gymoo.cn",
    password: "admin123"
  },
  config
});
assert.equal(login.status, 200);
assert.equal(login.body.user.role, "admin");

const bootstrap = await handleApiRequest({
  method: "GET",
  pathname: "/api/crm/bootstrap",
  body: {},
  headers: { "x-crm-token": login.body.token },
  config
});
assert.ok(bootstrap.body.db.customers.length >= 1);
assert.ok(bootstrap.body.db.skills.length >= 1);
assert.ok(bootstrap.body.db.skills.some((skill) => /轻量级方案\s*PPT/.test(skill.name)));

const agentDecisionGeneral = buildAgentDecision({
  body: {
    type: "chat",
    message: "关于生图模型，有几个不同的模型？",
    modelId: "model_openai",
    extraContext: { workspaceMode: "default_ai_workspace" }
  },
  db: bootstrap.body.db,
  user: login.body.user
});
assert.equal(agentDecisionGeneral.routing.intent, "general_chat");
assert.notEqual(agentDecisionGeneral.routing.intent, "image_generation");
assert.equal(agentDecisionGeneral.routing.action.key, "answer");
assert.equal(agentDecisionGeneral.routing.output.mode, "text");
assert.equal(agentDecisionGeneral.policy.executionMode, "background");

const agentDecisionFeatureQuestion = buildAgentDecision({
  body: {
    type: "chat",
    message: "智能手环 app 一般有哪些功能？",
    modelId: "model_openai",
    extraContext: { workspaceMode: "default_ai_workspace" }
  },
  db: bootstrap.body.db,
  user: login.body.user
});
assert.equal(agentDecisionFeatureQuestion.routing.intent, "general_chat");
assert.equal(agentDecisionFeatureQuestion.routing.action.key, "answer");
assert.equal(agentDecisionFeatureQuestion.routing.output.mode, "text");
assert.ok(agentDecisionFeatureQuestion.routing.contextPlan.scopes.includes("default_workspace"));

const agentDecisionDocument = buildAgentDecision({
  body: {
    type: "chat",
    message: "写一份智能手环的需求文档",
    modelId: "model_openai",
    extraContext: { workspaceMode: "default_ai_workspace" }
  },
  db: bootstrap.body.db,
  user: login.body.user
});
assert.equal(agentDecisionDocument.routing.intent, "document_generation");
assert.equal(agentDecisionDocument.routing.action.key, "write");
assert.equal(agentDecisionDocument.routing.output.mode, "document_card");

const agentDecisionCustomer = buildAgentDecision({
  body: {
    type: "chat",
    message: "帮我分析两个客户，我应该给他们发什么话术",
    modelId: "model_local",
    extraContext: { workspaceMode: "default_ai_workspace" }
  },
  db: bootstrap.body.db,
  user: login.body.user
});
assert.equal(agentDecisionCustomer.routing.intent, "customer_talktrack");
assert.equal(agentDecisionCustomer.routing.action.key, "analyze");
assert.ok(agentDecisionCustomer.routing.contextPlan.scopes.includes("customer_collection"));
assert.ok(agentDecisionCustomer.tools.some((tool) => tool.name === "crm.getCustomerContext"));

const agentDecisionCustomerSolution = buildAgentDecision({
  body: {
    type: "chat",
    message: "我应该给这两个客户出什么类型的方案",
    modelId: "model_openai",
    extraContext: { workspaceMode: "default_ai_workspace" }
  },
  db: bootstrap.body.db,
  user: login.body.user
});
assert.equal(agentDecisionCustomerSolution.routing.intent, "customer_analysis");
assert.equal(agentDecisionCustomerSolution.routing.action.key, "analyze");
assert.ok(agentDecisionCustomerSolution.routing.contextPlan.scopes.includes("customer_collection"));

const skillWithManifest = bootstrap.body.db.skills.find((skill) => /方案大纲/.test(skill.name || "")) || bootstrap.body.db.skills[0];
const agentDecisionSkillManifest = buildAgentDecision({
  body: {
    type: "chat",
    message: "按这个 Skill 输出方案",
    skillId: skillWithManifest.id,
    modelId: "model_local",
    extraContext: { workspaceMode: "default_ai_workspace" }
  },
  db: bootstrap.body.db,
  user: login.body.user
});
assert.equal(agentDecisionSkillManifest.routing.intent, "skill_execution");
assert.ok(agentDecisionSkillManifest.routing.skillManifest);
assert.equal(agentDecisionSkillManifest.routing.skillManifest.trigger.manual, true);
assert.ok(agentDecisionSkillManifest.routing.skillManifest.output.qualityChecklist.length >= 3);

const ragDb = {
  knowledgeBases: [{
    id: "kb_test",
    name: "测试知识库",
    status: "enabled",
    documents: normalizeKnowledgeBaseDocuments([], [{
      fileName: "AI CRM话术.md",
      text: "AI CRM 客户跟进话术知识库：客户停滞时先确认业务目标、预算口径、决策链和下一步材料。销售需要输出可复制话术和风险提醒。"
    }])
  }],
  customerFiles: []
};
const ragContext = buildRagContext({
  db: ragDb,
  customer: null,
  skill: { toolType: "rag", knowledgeBaseIds: ["kb_test"] },
  generationType: "chat",
  message: "根据知识库整理 AI CRM 客户跟进话术",
  extraContext: {}
});
assert.equal(ragContext.used, true);
assert.ok(["strong", "medium", "weak"].includes(ragContext.quality.level));
assert.ok(ragContext.citations.length >= 1);

const originalServerlessRuntime = process.env.JIMU_SERVERLESS_RUNTIME;
const originalFastPathFlag = process.env.AI_CHAT_FAST_PATH_ENABLED;
const originalBackgroundQueueFlag = process.env.AI_CHAT_BACKGROUND_QUEUE_ENABLED;
const originalUrl = process.env.URL;
process.env.JIMU_SERVERLESS_RUNTIME = "netlify";
delete process.env.AI_CHAT_FAST_PATH_ENABLED;
delete process.env.AI_CHAT_BACKGROUND_QUEUE_ENABLED;

try {
  await check("simple greeting stays fast", async () => {
    const result = await captureStream({
      body: {
        type: "chat",
        message: "你好",
        userId: "user_admin",
        modelId: "model_local",
        extraContext: {
          workspaceMode: "default_ai_workspace"
        }
      },
      headers: { "x-crm-token": login.body.token },
      config
    });
    assert.equal(result.statusCode, 200);
    const done = getSseEvent(result.events, "done");
    assert.ok(done?.generation);
    assert.equal(done.generation.prompt, "simple_query_shortcut");
    assert.match(done.generation.outputContent || "", /你好|我在/);
  });

  await check("identity question no longer uses simple shortcut", async () => {
    const result = await captureStream({
      body: {
        type: "chat",
        message: "你是谁",
        userId: "user_admin",
        modelId: "model_local",
        extraContext: {
          workspaceMode: "default_ai_workspace"
        }
      },
      headers: { "x-crm-token": login.body.token },
      config
    });
    assert.equal(result.statusCode, 200);
    const done = getSseEvent(result.events, "done");
    assert.ok(done?.generation);
    assert.notEqual(done.generation.prompt, "simple_query_shortcut");
    assert.doesNotMatch(done.generation.outputContent || "", /simple_query_shortcut|快速回复/);
  });

  await check("customer skill chat returns synchronously", async () => {
    const skillId = bootstrap.body.db.skills.find((skill) => /方案大纲/.test(skill.name || ""))?.id || bootstrap.body.db.skills[0]?.id || "";
    const result = await withBackgroundJobStub(async () => captureStream({
      body: {
        type: "chat",
        customerId: bootstrap.body.db.customers[0].id,
        message: "请直接生成方案大纲，按客户当前上下文输出。",
        userId: "user_admin",
        skillId,
        modelId: "model_local",
        extraContext: {
          workspaceMode: "customer",
          conversationHistory: [],
          chatAttachments: []
        }
      },
      headers: { "x-crm-token": login.body.token },
      config: {
        ...config,
        webCrawlerProvider: "jina",
        webResearchMaxCrawlUrls: 1
      }
    }));
    assert.equal(result.statusCode, 200);
    const agentDecision = getSseEvent(result.events, "agent_decision");
    assert.equal(agentDecision?.intent?.key, "skill_execution");
    assert.equal(agentDecision?.policy?.responseMode, "document_card");
    const done = getSseEvent(result.events, "done");
    assert.ok(done?.generation);
    assert.notEqual(done.metadata?.background_generation, true);
    assert.notEqual(done.metadata?.queued_remote_generation, true);
    assert.equal(done.metadata?.agent_runtime, "agent-runtime-v2");
    assert.equal(done.metadata?.agent_intent, "skill_execution");
    assert.equal(done.metadata?.agent_action, "execute_skill");
    assert.equal(done.metadata?.agent_response_mode, "document_card");
    assert.notEqual(done.record.inputContext?.asyncAiJob?.status, "generating");
    assert.doesNotMatch(done.generation.outputContent || "", /后台远程生成|帮助中心/);
    assert.ok(String(done.generation.outputContent || "").length > 120);
  });

  await check("document chat with local model returns synchronously", async () => {
    const result = await withBackgroundJobStub(async () => captureStream({
      body: {
        type: "chat",
        message: "帮我生成一个CRM需求文档，包含模块、流程和实施计划。",
        userId: "user_admin",
        modelId: "model_local",
        extraContext: {
          workspaceMode: "default_ai_workspace"
        }
      },
      headers: { "x-crm-token": login.body.token },
      config
    }));
    assert.equal(result.statusCode, 200);
    const agentDecision = getSseEvent(result.events, "agent_decision");
    assert.equal(agentDecision?.intent?.key, "document_generation");
    const done = getSseEvent(result.events, "done");
    assert.ok(done?.generation);
    assert.equal(done.metadata?.agent_runtime, "agent-runtime-v2");
    assert.equal(done.metadata?.agent_intent, "document_generation");
    assert.equal(done.metadata?.agent_action, "write");
    assert.notEqual(done.metadata?.background_generation, true);
    assert.notEqual(done.metadata?.queued_remote_generation, true);
    assert.notEqual(done.record.inputContext?.asyncAiJob?.status, "generating");
    assert.doesNotMatch(done.generation.outputContent || "", /后台生成中|帮助中心/);
    assert.ok(String(done.generation.outputContent || "").length > 120);
  });

  await check("feature inventory question stays a general model answer", async () => {
    const result = await withBackgroundJobStub(async () => captureStream({
      body: {
        type: "chat",
        message: "行政小程序应该有哪些功能",
        userId: "user_admin",
        modelId: "model_local",
        extraContext: {
          workspaceMode: "default_ai_workspace"
        }
      },
      headers: { "x-crm-token": login.body.token },
      config
    }));
    assert.equal(result.statusCode, 200);
    const done = getSseEvent(result.events, "done");
    assert.ok(done?.generation);
    assert.equal(done.metadata?.default_intent, "general_chat");
    assert.equal(done.metadata?.agent_runtime, "agent-runtime-v2");
    assert.equal(done.metadata?.agent_intent, "general_chat");
    assert.equal(done.metadata?.agent_action, "answer");
    assert.notEqual(done.metadata?.background_generation, true);
    assert.notEqual(done.metadata?.queued_remote_generation, true);
    assert.notEqual(done.record.inputContext?.asyncAiJob?.status, "generating");
    assert.doesNotMatch(done.generation.outputContent || "", /后台生成中|帮助中心/);
    assert.ok(String(done.generation.outputContent || "").length > 120);
  });

  await check("default workspace customer portfolio uses stable fast path without feature flag", async () => {
    const result = await withBackgroundJobStub(async () => captureStream({
      body: {
        type: "chat",
        message: "我目前的两个客户应该如何推进",
        userId: "user_admin",
        modelId: "model_openai",
        extraContext: {
          workspaceMode: "default_ai_workspace"
        }
      },
      headers: { "x-crm-token": login.body.token },
      config
    }));
    assert.equal(result.statusCode, 200);
    const agentDecision = getSseEvent(result.events, "agent_decision");
    assert.equal(agentDecision?.intent?.key, "customer_talktrack");
    assert.equal(agentDecision?.action?.key, "analyze");
    const done = getSseEvent(result.events, "done");
    assert.ok(done?.generation);
    assert.equal(done.generation.prompt, "serverless_default_workspace_fast_path");
    assert.equal(done.metadata?.serverless_fast_path, true);
    assert.notEqual(done.metadata?.background_generation, true);
    assert.match(done.generation.outputContent || "", /当前客户推进分析|优先级建议/);
  });

  await check("customer solution type question uses customer fast path", async () => {
    const result = await withBackgroundJobStub(async () => captureStream({
      body: {
        type: "chat",
        message: "我应该给这两个客户出什么类型的方案",
        userId: "user_admin",
        modelId: "model_openai",
        extraContext: {
          workspaceMode: "default_ai_workspace"
        }
      },
      headers: { "x-crm-token": login.body.token },
      config
    }));
    assert.equal(result.statusCode, 200);
    const agentDecision = getSseEvent(result.events, "agent_decision");
    assert.equal(agentDecision?.intent?.key, "customer_analysis");
    assert.equal(agentDecision?.action?.key, "analyze");
    const done = getSseEvent(result.events, "done");
    assert.ok(done?.generation);
    assert.equal(done.generation.prompt, "serverless_default_workspace_fast_path");
    assert.equal(done.metadata?.serverless_fast_path, true);
    assert.notEqual(done.metadata?.background_generation, true);
    assert.match(done.generation.outputContent || "", /当前客户推进分析|推荐方案类型/);
  });

  await check("referenced customer in default workspace uses stable customer fast path", async () => {
    const result = await withBackgroundJobStub(async () => captureStream({
      body: {
        type: "chat",
        message: "华东制造 AI 质检项目 · IoT+AI · demand_deepening",
        userId: "user_admin",
        modelId: "model_openai",
        extraContext: {
          workspaceMode: "default_ai_workspace"
        }
      },
      headers: { "x-crm-token": login.body.token },
      config
    }));
    assert.equal(result.statusCode, 200);
    const done = getSseEvent(result.events, "done");
    assert.ok(done?.generation);
    assert.equal(done.generation.prompt, "serverless_referenced_customer_fast_path");
    assert.equal(done.metadata?.serverless_fast_path, true);
    assert.equal(done.metadata?.referenced_customer_fast_path, true);
    assert.notEqual(done.metadata?.background_generation, true);
    assert.notEqual(done.metadata?.queued_remote_generation, true);
    assert.notEqual(done.record.inputContext?.asyncAiJob?.status, "generating");
    assert.match(done.generation.outputContent || "", /华东制造 AI 质检项目 客户上下文分析|推荐方案类型|MVP/);
  });

  await check("company list question uses web research answer without remote model", async () => {
    const result = await withWebResearchStub(async () => captureStream({
      body: {
        type: "chat",
        message: "深圳的软件外包公司有哪些",
        userId: "user_admin",
        modelId: "model_openai",
        extraContext: {
          workspaceMode: "default_ai_workspace"
        }
      },
      headers: { "x-crm-token": login.body.token },
      config
    }));
    assert.equal(result.statusCode, 200);
    const done = getSseEvent(result.events, "done");
    assert.ok(done?.generation);
    assert.equal(done.generation.modelName, "联网资料汇总");
    assert.equal(done.metadata?.agent_runtime, "agent-runtime-v2");
    assert.equal(done.metadata?.agent_intent, "web_research");
    assert.equal(done.generation.inputContext.webResearch.used, true);
    assert.match(done.generation.outputContent || "", /深圳软件外包公司A/);
    assert.doesNotMatch(done.generation.outputContent || "", /模型返回异常|远程模型 .*调用失败/);
  });
} finally {
  restoreEnv("JIMU_SERVERLESS_RUNTIME", originalServerlessRuntime);
  restoreEnv("AI_CHAT_FAST_PATH_ENABLED", originalFastPathFlag);
  restoreEnv("AI_CHAT_BACKGROUND_QUEUE_ENABLED", originalBackgroundQueueFlag);
  restoreEnv("URL", originalUrl);
}

const generation = await handleApiRequest({
  method: "POST",
  pathname: "/api/crm/generate",
  body: {
    type: "follow_strategy",
    customerId: bootstrap.body.db.customers[0].id,
    userId: "user_admin"
  },
  headers: { "x-crm-token": login.body.token },
  config
});
assert.equal(generation.status, 200);
assert.equal(generation.body.record.inputContext.asyncAiJob.status, "generating");
assert.match(generation.body.generation.outputContent, /后台生成任务|帮助中心/);

const refreshedRecord = await waitForGenerationCompletion(generation.body.record.id, { "x-crm-token": login.body.token });
assert.equal(refreshedRecord?.inputContext?.asyncAiJob?.status, "completed");
assert.match(refreshedRecord?.outputContent || "", /客户当前状态判断/);

const feishuSyncWithoutConfig = await handleApiRequest({
  method: "POST",
  pathname: "/api/crm/sync-history-feishu",
  body: {
    recordId: generation.body.record.id
  },
  headers: { "x-crm-token": login.body.token },
  config
});
assert.equal(feishuSyncWithoutConfig.status, 400);
assert.match(feishuSyncWithoutConfig.body.error, /飞书未配置/);

console.log("Smoke test passed.");

async function check(name, run) {
  try {
    return await run();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

async function waitForGenerationCompletion(recordId, headers, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let record = null;
  while (Date.now() < deadline) {
    const refreshed = await handleApiRequest({
      method: "GET",
      pathname: "/api/crm/bootstrap",
      body: {},
      headers,
      config
    });
    record = refreshed.body.db.aiGenerationRecords.find((item) => item.id === recordId);
    if (record?.inputContext?.asyncAiJob?.status !== "generating") return record;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return record;
}

async function captureStream({ body, headers, config }) {
  const response = createStreamRecorder();
  const streamed = await handleApiStreamRequest({
    method: "POST",
    pathname: "/api/crm/generate-stream",
    body,
    headers,
    config,
    response
  });
  assert.equal(streamed, true);
  return {
    statusCode: response.statusCode,
    events: parseSseEvents(response.body)
  };
}

async function withBackgroundJobStub(run) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.URL;
  process.env.URL = "https://example.com";
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/.netlify/functions/image-job-background")) {
      const payload = JSON.parse(String(options.body || "{}"));
      await runImageBackgroundJob({
        kind: payload.kind,
        recordId: payload.recordId,
        body: payload.body || {},
        itemId: payload.itemId || "",
        modification: payload.modification || "",
        actorUser: payload.actorUser || { id: "system", name: "系统任务", role: "admin" },
        config
      });
      return new Response(JSON.stringify({ ok: true, message: "background job accepted" }), {
        status: 202,
        headers: { "content-type": "application/json" }
      });
    }
    return originalFetch(url, options);
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("URL", originalUrl);
  }
}

async function withWebResearchStub(run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (/tokenrouter\.tech|api\.openai\.com/.test(textUrl)) {
      throw new Error(`remote model should not be called: ${textUrl}`);
    }
    if (textUrl.startsWith("https://s.jina.ai/")) {
      return new Response([
        "Title: 深圳软件外包公司A",
        "URL Source: https://example.com/company-a",
        "Description: 深圳本地软件外包与系统定制服务商。",
        "",
        "Title: 深圳软件外包公司B",
        "URL Source: https://example.com/company-b",
        "Description: 提供小程序、SaaS 和企业后台开发服务。"
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
    if (textUrl.startsWith("https://r.jina.ai/")) {
      return new Response("# 深圳软件外包公司A\n\n公开页面显示，该公司提供软件外包、小程序开发和企业系统定制服务。", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
    throw new Error(`unexpected external fetch: ${textUrl}`);
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createStreamRecorder() {
  const chunks = [];
  return {
    destroyed: false,
    writableEnded: false,
    statusCode: 0,
    headers: {},
    writeHead(status, nextHeaders = {}) {
      this.statusCode = status;
      this.headers = { ...this.headers, ...nextHeaders };
    },
    write(chunk) {
      chunks.push(String(chunk || ""));
    },
    end(chunk = "") {
      if (chunk) chunks.push(String(chunk));
      this.writableEnded = true;
    },
    get body() {
      return chunks.join("");
    }
  };
}

function parseSseEvents(text = "") {
  return String(text || "")
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block) => {
      const eventMatch = block.match(/^event:\s*(.+)$/m);
      const dataMatch = block.match(/^data:\s*(.+)$/m);
      const data = dataMatch ? JSON.parse(dataMatch[1]) : null;
      return {
        event: eventMatch ? eventMatch[1].trim() : "",
        data
      };
    });
}

function getSseEvent(events, eventName) {
  return events.find((item) => item.event === eventName)?.data || null;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
