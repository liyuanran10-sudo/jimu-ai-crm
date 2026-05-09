import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { organizeContent } from "./organizer.js";
import { createNotionPage } from "./notion.js";
import { createFeishuPage, isFeishuConfigured } from "./feishu.js";
import { buildDailySummaryRecord, readDailySummaryHistory, saveDailySummaryRecord } from "./daily-summary.js";
import { normalizeKnowledgeBaseDocuments } from "./rag-service.js";
import {
  deleteCollectionItem,
  getStageName,
  loginUser,
  nowIso,
  readCrmDb,
  sanitizeCrmDb,
  upsertCollectionItem,
  withCrmDb
} from "./crm-store.js";
import { generateCrmContent, streamCrmContent, testCrmModel } from "./ai-service.js";
import {
  buildDefaultImageMarkdown,
  buildInteractionImageBoardMarkdown,
  buildInteractionImageMarkdown,
  buildPendingDefaultImageMarkdown,
  buildPendingInteractionImageBoardMarkdown,
  buildPendingInteractionImageMarkdown,
  extractImagePrompt,
  generateInteractionImage,
  readGeneratedImageAsset
} from "./image2-service.js";

const ADMIN_COLLECTIONS = new Set(["users", "stages", "skills", "promptTemplates", "models", "knowledgeBases", "reportFeedbacks"]);
const MAX_CUSTOMER_UPLOAD_BYTES = 500 * 1024 * 1024;
const MIN_BACKGROUND_IMAGE_TIMEOUT_MS = 10 * 60 * 1000;
const GENERATION_LABELS_FOR_SYNC = {
  follow_strategy: "跟进策略",
  demand_analysis: "需求分析",
  proposal_outline: "方案大纲",
  failure_report: "失败复盘",
  chat: "AI 对话",
  follow_summary: "跟进总结",
  interaction_image: "交互图",
  interaction_image_drafts: "交互图界面草稿",
  chat_image: "AI 生图",
  consultation_advice: "前期咨询回应策略",
  next_communication_question_list: "下一步沟通问题清单",
  lightweight_solution: "轻量级方案",
  solution_deepening: "需求深化方案",
  historical_solution_entry: "历史方案库沉淀",
  requirement_document: "需求文档",
  lightweight_solution_ppt_outline: "轻量级方案PPT结构稿",
  lightweight_solution_ppt: "轻量级方案PPT"
};

const BACKGROUND_AI_MODEL_NAME = "AI 后台生成中";
const DEFAULT_BACKGROUND_AI_TIMEOUT_MS = 60 * 1000;
const LONG_BACKGROUND_AI_TIMEOUT_MS = 360 * 1000;
const PPT_TASK_POLL_INTERVAL_MS = 8000;
const PPT_TASK_POLL_TIMEOUT_MS = 30 * 60 * 1000;
const pptTaskPollers = globalThis.__jimuCrmPptTaskPollers || new Map();
globalThis.__jimuCrmPptTaskPollers = pptTaskPollers;

export async function handleApiRequest({ method, pathname, body = {}, headers = {}, config }) {
  if (pathname === "/api/health" && method === "GET") {
    return json(200, {
      ok: true,
      syncTarget: config.syncTarget,
      openaiConfigured: Boolean(config.openaiApiKey),
      notionConfigured: Boolean(config.notionApiKey && (config.notionDatabaseId || config.notionParentPageId)),
      notionTarget: config.notionDatabaseId ? "database" : config.notionParentPageId ? "page" : "local",
      feishuConfigured: isFeishuConfigured(config),
      feishuTarget: config.feishuWikiSpaceId ? "wiki" : config.feishuFolderToken ? "docx-folder" : "local",
      image2Configured: Boolean(config.image2ApiKey),
      image2Model: config.image2ApiKey ? config.image2Model : "not-configured",
      pptSkillBaseUrl: config.pptSkillBaseUrl || "",
      model: config.openaiApiKey ? config.openaiModel : "local-fallback",
      backgroundAiTimeoutMs: config.backgroundAiTimeoutMs || DEFAULT_BACKGROUND_AI_TIMEOUT_MS,
      pptTaskTimeoutMs: config.pptTaskTimeoutMs || PPT_TASK_POLL_TIMEOUT_MS
    });
  }

  const crmResult = await handleCrmApiRequest({ method, pathname, body, headers, config });
  if (crmResult) {
    void resumePendingPptTaskPolling(config);
    return crmResult;
  }

  if (pathname === "/api/organize" && method === "POST") {
    if (!String(body.content || "").trim()) {
      return json(400, { ok: false, error: "content is required" });
    }

    const capture = await organizeContent(body, config);
    return json(200, { ok: true, capture });
  }

  if (pathname === "/api/save" && method === "POST") {
    if (!body.capture) {
      return json(400, { ok: false, error: "capture is required" });
    }

    const result = await saveCapture(body.capture, config);
    return json(200, { ok: true, result });
  }

  if (pathname === "/api/capture" && method === "POST") {
    if (!String(body.content || "").trim()) {
      return json(400, { ok: false, error: "content is required" });
    }

    const capture = await organizeContent(body, config);
    const result = await saveCapture(capture, config);
    return json(200, { ok: true, capture, result });
  }

  if (pathname === "/api/daily-summaries" && method === "GET") {
    const history = await readDailySummaryHistory();
    return json(200, {
      ok: true,
      summaries: history.map((item) => ({
        id: item.id,
        dateKey: item.dateKey,
        dateLabel: item.dateLabel,
        generatedAt: item.generatedAt,
        pageCount: item.pageCount,
        taskCount: countTasks(item.tasks),
        topTitles: (item.pages || []).slice(0, 3).map((page) => page.title),
        summaryPreview: previewMarkdown(item.summaryMarkdown)
      }))
    });
  }

  const detailMatch = pathname.match(/^\/api\/daily-summaries\/([0-9]{4}-[0-9]{2}-[0-9]{2})$/);
  if (detailMatch && method === "GET") {
    const history = await readDailySummaryHistory();
    const summary = history.find((item) => item.dateKey === detailMatch[1]);
    if (!summary) {
      return json(404, { ok: false, error: "summary not found" });
    }
    return json(200, { ok: true, summary });
  }

  if (pathname === "/api/daily-summaries/generate" && method === "POST") {
    const record = await buildDailySummaryRecord(config, { date: body.date });
    await saveDailySummaryRecord(record);
    return json(200, { ok: true, summary: record });
  }

  return null;
}

export async function handleApiStreamRequest({ method, pathname, body = {}, headers = {}, config, response }) {
  if (pathname !== "/api/crm/generate-stream") return false;

  if (method !== "POST") {
    writeJsonResponse(response, 405, { ok: false, error: "Method not allowed" });
    return true;
  }

  const authDb = await readCrmDb();
  const actor = resolveCrmActor(authDb, headers, config);
  if (!actor.user) {
    writeJsonResponse(response, 401, { ok: false, error: actor.error });
    return true;
  }
  if (body.customerId && !authDb.customers.some((item) => item.id === body.customerId)) {
    writeJsonResponse(response, 404, { ok: false, error: "未找到当前客户，无法读取客户上下文" });
    return true;
  }

  writeSseHeaders(response);
  const send = (event, payload) => writeSseEvent(response, event, payload);

  try {
    const referencedCustomer = !body.customerId && !isSimpleChatQuery(body.message) ? findReferencedCustomer(authDb, body.message) : null;
    const streamBody = referencedCustomer
      ? {
        ...body,
        extraContext: {
          ...(body.extraContext || {}),
          referencedCustomerId: referencedCustomer.id,
          referencedCustomerName: referencedCustomer.name,
          referencedCustomerReason: "默认 AI 对话命中客户名称或联系人，按该客户隔离上下文融合回答。"
        }
      }
      : body;
    if (shouldAskForCustomerSelection(streamBody, referencedCustomer)) {
      const answer = buildCustomerSelectionClarification(authDb, streamBody.message);
      await streamSseText(answer, send, "answer_delta");
      const metadata = {
        complexity: "simple",
        used_skill: false,
        used_rag: false,
        used_tool: false,
        customer_context: false,
        needs_customer_selection: true
      };
      send("done", {
        ok: true,
        generation: {
          title: "默认 AI 对话",
          generationType: "chat",
          skillId: "",
          modelName: "快速澄清",
          prompt: "customer_context_required",
          inputContext: {
            messageType: "ai_response",
            process: [],
            metadata
          },
          outputContent: answer,
          createdAt: nowIso()
        },
        record: null,
        memory: null,
        process: [],
        metadata
      });
      return true;
    }
    const processPlan = buildChatProcessPlan({ body: streamBody, db: authDb });
    if (processPlan.metadata.complexity === "simple") {
      const simpleAnswer = buildSimpleChatAnswer(streamBody, authDb);
      await streamSseText(simpleAnswer, send, "answer_delta");
      send("done", {
        ok: true,
        generation: {
          title: body.customerId ? "客户 AI 对话" : "默认 AI 对话",
          generationType: "chat",
          skillId: "",
          modelName: "快速回复",
          prompt: "simple_query_shortcut",
          inputContext: {
            messageType: "ai_response",
            process: [],
            metadata: processPlan.metadata
          },
          outputContent: simpleAnswer,
          createdAt: nowIso()
        },
        record: null,
        memory: null,
        process: [],
        metadata: processPlan.metadata
      });
      return true;
    }

    emitProcessStep(send, processPlan.steps[0], "running");
    emitProcessStep(send, processPlan.steps[0], "done");
    emitProcessStep(send, processPlan.steps[1], "running");

    if (!body.customerId && shouldRouteToImage2(body, authDb)) {
      emitProcessStep(send, processPlan.steps[1], "done");
      emitProcessStep(send, processPlan.steps[2], "running");
      const result = await generateDefaultChatImage({ db: authDb, body: streamBody, actor, config, send });
      emitProcessStep(send, processPlan.steps[2], "done");
      emitProcessStep(send, processPlan.steps[3], "done");
      send("done", {
        ok: true,
        generation: result.generation,
        record: result.record,
        memory: null,
        image: result.image,
        process: processPlan.steps.map((step) => ({ ...step, status: "done" })),
        metadata: processPlan.metadata
      });
      return true;
    }

    emitProcessStep(send, processPlan.steps[1], "done");
    emitProcessStep(send, processPlan.steps[2], "running");

    if (shouldUseServerlessQuickDefaultWorkspaceChat(streamBody, processPlan)) {
      const quickGeneration = buildServerlessDefaultWorkspaceChatGeneration({
        db: authDb,
        body: streamBody,
        actor,
        processPlan
      });
      emitProcessStep(send, processPlan.steps[2], "done");
      emitProcessStep(send, processPlan.steps[3], "running");
      const result = await withCrmDb((db) => {
        const record = saveGenerationRecord(db, streamBody, actor, quickGeneration);
        return { record, memory: null };
      });
      emitProcessStep(send, processPlan.steps[3], "done");
      await streamSseText(quickGeneration.outputContent, send, "answer_delta");
      send("done", {
        ok: true,
        generation: quickGeneration,
        record: result.record,
        memory: result.memory,
        process: processPlan.steps.map((step) => ({ ...step, status: "done" })),
        metadata: {
          ...processPlan.metadata,
          serverless_fast_path: true
        }
      });
      return true;
    }

    if (shouldUseServerlessQuickCustomerDocumentChat(streamBody, processPlan)) {
      const quickGeneration = buildServerlessCustomerDocumentChatGeneration({
        db: authDb,
        body: streamBody,
        actor,
        processPlan
      });
      emitProcessStep(send, processPlan.steps[2], "done");
      emitProcessStep(send, processPlan.steps[3], "running");
      const result = await withCrmDb((db) => {
        const record = saveGenerationRecord(db, streamBody, actor, quickGeneration);
        const memory = saveCustomerMemoryFromGeneration(db, streamBody, actor, quickGeneration, record);
        saveGenerationToCustomerIfNeeded(db, streamBody, quickGeneration);
        return { record, memory };
      });
      emitProcessStep(send, processPlan.steps[3], "done");
      await streamSseText(quickGeneration.outputContent, send, "answer_delta");
      send("done", {
        ok: true,
        generation: quickGeneration,
        record: result.record,
        memory: result.memory,
        process: processPlan.steps.map((step) => ({ ...step, status: "done" })),
        metadata: {
          ...processPlan.metadata,
          serverless_fast_path: true
        }
      });
      return true;
    }

    if (shouldUseServerlessQuickCustomerChat(streamBody, processPlan)) {
      const quickGeneration = buildServerlessQuickCustomerChatGeneration({
        db: authDb,
        body: streamBody,
        actor,
        processPlan
      });
      emitProcessStep(send, processPlan.steps[2], "done");
      emitProcessStep(send, processPlan.steps[3], "running");
      const result = await withCrmDb((db) => {
        const record = saveGenerationRecord(db, streamBody, actor, quickGeneration);
        const memory = saveCustomerMemoryFromGeneration(db, streamBody, actor, quickGeneration, record);
        saveGenerationToCustomerIfNeeded(db, streamBody, quickGeneration);
        return { record, memory };
      });
      emitProcessStep(send, processPlan.steps[3], "done");
      await streamSseText(quickGeneration.outputContent, send, "answer_delta");
      send("done", {
        ok: true,
        generation: quickGeneration,
        record: result.record,
        memory: result.memory,
        process: processPlan.steps.map((step) => ({ ...step, status: "done" })),
        metadata: {
          ...processPlan.metadata,
          serverless_fast_path: true
        }
      });
      return true;
    }

    if (shouldQueueServerlessDefaultDocumentChat(streamBody, processPlan)) {
      const pendingGeneration = buildPendingBackgroundGeneration({
        db: authDb,
        type: "requirement_document",
        customer: null,
        skillId: "",
        userId: actor.user.id,
        message: streamBody.message,
        extraContext: streamBody.extraContext,
        reason: "长文档已转入后台生成，避免 Netlify 同步函数超时。完成后会在帮助中心提醒。"
      });
      pendingGeneration.inputContext = {
        ...(pendingGeneration.inputContext || {}),
        messageType: "ai_response",
        process: processPlan.steps.map((step) => ({ ...step, status: "done" })),
        metadata: {
          ...processPlan.metadata,
          background_generation: true
        }
      };
      const result = await withCrmDb((db) => {
        const record = saveGenerationRecord(db, {
          ...streamBody,
          type: "requirement_document",
          customerId: "",
          skillId: "",
          userId: streamBody.userId || actor.user.id,
          saveToCustomer: false
        }, actor, pendingGeneration);
        return { record, memory: null };
      });
      emitProcessStep(send, processPlan.steps[2], "done");
      emitProcessStep(send, processPlan.steps[3], "running");
      await queueCrmGenerationJob({
        recordId: result.record.id,
        body: {
          ...streamBody,
          type: "requirement_document",
          customerId: "",
          skillId: "",
          userId: streamBody.userId || actor.user.id
        },
        actorUser: actor.user,
        config
      });
      emitProcessStep(send, processPlan.steps[3], "done");
      await streamSseText(pendingGeneration.outputContent, send, "answer_delta");
      send("done", {
        ok: true,
        generation: pendingGeneration,
        record: result.record,
        memory: null,
        process: processPlan.steps.map((step) => ({ ...step, status: "done" })),
        metadata: {
          ...processPlan.metadata,
          background_generation: true
        }
      });
      return true;
    }

    const streamConfig = buildRuntimeStreamConfig(config, streamBody, processPlan);
    const remoteGenerationType = resolveRemoteDefaultWorkspaceGenerationType(streamBody, processPlan);
    let streamedAnswer = "";
    const shouldStreamRemoteTokens = false;
    const generation = await streamCrmContent({
      db: authDb,
      type: remoteGenerationType,
      customerId: streamBody.customerId || "",
      skillId: streamBody.skillId,
      userId: streamBody.userId || actor.user.id,
      message: streamBody.message,
      extraContext: streamBody.extraContext,
      modelId: streamBody.modelId,
      config: streamConfig,
      onStatus: () => {},
      onToken: (chunk) => {
        streamedAnswer += chunk || "";
        if (chunk && shouldStreamRemoteTokens) send("answer_delta", { content: chunk });
      }
    });
    emitProcessStep(send, processPlan.steps[2], "done");
    emitProcessStep(send, processPlan.steps[3], "running");

    const finalAnswer = cleanFinalChatAnswer(generation.outputContent || "", processPlan.metadata);
    generation.outputContent = finalAnswer;
    generation.inputContext = {
      ...(generation.inputContext || {}),
      messageType: "ai_response",
      process: processPlan.steps.map((step) => ({
        ...step,
        status: "done"
      })),
      metadata: processPlan.metadata
    };

    const result = await withCrmDb((db) => {
      const record = saveGenerationRecord(db, streamBody, actor, generation);
      const memory = saveCustomerMemoryFromGeneration(db, streamBody, actor, generation, record);
      saveGenerationToCustomerIfNeeded(db, streamBody, generation);
      return { record, memory };
    });
    emitProcessStep(send, processPlan.steps[3], "done");
    if (!streamedAnswer || !shouldStreamRemoteTokens) {
      await streamSseText(finalAnswer, send, "answer_delta");
    } else if (finalAnswer.startsWith(streamedAnswer) && finalAnswer.length > streamedAnswer.length) {
      await streamSseText(finalAnswer.slice(streamedAnswer.length), send, "answer_delta");
    }

    send("done", {
      ok: true,
      generation,
      record: result.record,
      memory: result.memory,
      process: processPlan.steps.map((step) => ({ ...step, status: "done" })),
      metadata: processPlan.metadata
    });
  } catch (error) {
    send("error", {
      ok: false,
      error: redactStreamError(error.message || "AI 流式生成失败")
    });
  } finally {
    response.end();
  }

  return true;
}

async function generateDefaultChatImage({ db, body, actor, config, send }) {
  await send("status", { message: "识别到 image2 生图意图，已切换为后台生成任务..." });
  const createdAt = nowIso();
  const outputContent = buildPendingDefaultImageMarkdown({
    message: body.message,
    style: body.extraContext?.imageStyle,
    imageType: body.extraContext?.imageType
  });
  const generation = {
    title: "默认 AI 工作台 - image2 生图",
    generationType: "chat_image",
    skillId: body.skillId || "",
    modelName: `${config.image2Model || "image2"} 后台生成中`,
    prompt: "background default image2 generation",
    inputContext: {
      asyncImageJob: {
        kind: "default_image",
        status: "generating",
        startedAt: createdAt,
        message: body.message || "",
        imageStyle: body.extraContext?.imageStyle || "",
        imageType: body.extraContext?.imageType || ""
      },
      defaultImage: {
        message: body.message || "",
        imageStyle: body.extraContext?.imageStyle || "",
        imageType: body.extraContext?.imageType || "",
        imageProvider: "image2",
        imageModel: config.image2Model || "image2",
        imageStatus: "generating",
        usedPlaceholder: false
      }
    },
    outputContent,
    createdAt
  };

  await streamSseText(outputContent, send, "answer_delta");

  const saved = await withCrmDb((nextDb) => {
    const record = saveGenerationRecord(nextDb, { ...body, customerId: "" }, actor, generation);
    return { record };
  });

  await queueDefaultImageJob({
    recordId: saved.record.id,
    body,
    actorUser: actor.user,
    config
  });

  return {
    generation,
    record: saved.record,
    image: {
      status: "generating",
      modelName: config.image2Model || "image2",
      usedFallback: false,
      note: "图片已进入后台生成队列。"
    }
  };
}

function queueDefaultImageJob({ recordId, body, actorUser, config }) {
  const jobBody = cloneJobPayload(body);
  const jobActor = { id: actorUser.id, name: actorUser.name, role: actorUser.role };
  if (isServerlessRuntime()) {
    return invokeNetlifyImageBackgroundJob({
      kind: "default_image",
      recordId,
      body: jobBody,
      actorUser: jobActor,
      config
    }).catch(async (error) => markImageJobFailed({
      recordId,
      title: "默认 AI 工作台 - image2 生图",
      errorText: `提交 Netlify 后台生图任务失败：${error.message || "未知错误"}`
    }));
  }
  setTimeout(() => {
    void runDefaultImageJob({ recordId, body: jobBody, actorUser: jobActor, config })
      .catch(async (error) => markImageJobFailed({
        recordId,
        title: "默认 AI 工作台 - image2 生图",
        errorText: error.message || "后台生图任务失败"
      }).catch((markError) => {
        console.error("failed to mark default image job", redactApiError(markError.message || ""));
      }));
  }, 0);
  return Promise.resolve(true);
}

export async function runImageBackgroundJob({ kind, recordId, body = {}, itemId = "", modification = "", actorUser, config }) {
  if (kind === "default_image") {
    return runDefaultImageJob({ recordId, body, actorUser, config });
  }
  if (kind === "interaction_image") {
    return runInteractionImageJob({ recordId, body, actorUser, config });
  }
  if (kind === "interaction_image_regenerate") {
    return runInteractionImageRegenerateJob({ recordId, itemId, modification, actorUser, config });
  }
  if (kind === "crm_generation") {
    return runCrmGenerationJob({ recordId, body, actorUser, config });
  }
  if (kind === "historical_solution") {
    return runCustomerHistoricalSolutionJob({ recordId, body, actorUser, config });
  }
  if (kind === "report_feedback") {
    return runReportFeedbackJob({ feedbackId: recordId, body, actorUser, config });
  }
  throw new Error(`Unsupported image background job: ${kind || "unknown"}`);
}

async function runDefaultImageJob({ recordId, body, actorUser, config }) {
  const db = await readCrmDb();
  const actor = { user: actorUser };
  const promptGeneration = await generateDefaultImagePromptWithFallback({ db, body, actor, config });
  let promptDraft = promptGeneration.outputContent || "";
  if (isRemoteFailureMarkdown(promptDraft)) {
    await markImageJobFailed({
      recordId,
      title: promptGeneration.title || "默认 AI 工作台 - image2 生图",
      errorText: stripMarkdown(promptDraft).slice(0, 1200) || "默认生图提示词生成失败"
    });
    return;
  }
  const extractedPrompt = extractImagePrompt(promptDraft);
  const useExtractedPrompt = isUsableDefaultImagePrompt(extractedPrompt, promptDraft);
  const imagePrompt = useExtractedPrompt
    ? extractedPrompt
    : "";
  if (!useExtractedPrompt) {
    await markImageJobFailed({
      recordId,
      title: promptGeneration.title || "默认 AI 工作台 - image2 生图",
      errorText: "默认生图提示词不可用或内容过短，已停止 image2 调用，请重新生成。"
    });
    return;
  }

  const imageResult = await generateInteractionImage({
    prompt: imagePrompt,
    style: body.extraContext?.imageStyle || "默认工作台",
    websiteType: body.extraContext?.imageType || "AI 生图",
    customerName: "默认 AI 工作台",
    config: buildBackgroundImageConfig(config)
  });
  const outputContent = buildDefaultImageMarkdown({
    message: body.message,
    style: body.extraContext?.imageStyle,
    imageType: body.extraContext?.imageType,
    promptDraft,
    imagePrompt,
    imageResult
  });
  const finishedAt = nowIso();
  const jobStatus = imageResult.usedFallback ? "failed" : "completed";

  await withCrmDb((nextDb) => {
    const existing = nextDb.aiGenerationRecords.find((item) => item.id === recordId);
    if (!existing) return null;
    return upsertCollectionItem(nextDb, "aiGenerationRecords", {
      ...existing,
      id: recordId,
      customerId: "",
      userId: body.userId || actorUser.id,
      generationType: "chat_image",
      inputContext: {
        ...promptGeneration.inputContext,
        asyncImageJob: {
          ...(existing.inputContext?.asyncImageJob || {}),
          kind: "default_image",
          status: jobStatus,
          finishedAt,
          error: imageResult.usedFallback ? imageResult.note || imageResult.reason || "image2 未生成真实图片" : ""
        },
        defaultImage: {
          message: body.message || "",
          imageStyle: body.extraContext?.imageStyle || "",
          imageType: body.extraContext?.imageType || "",
          imageProvider: imageResult.provider,
          imageModel: imageResult.modelName,
          imageStatus: imageResult.status,
          usedPlaceholder: Boolean(imageResult.usedFallback)
        }
      },
      prompt: promptGeneration.prompt,
      modelName: `${promptGeneration.modelName || "AI 模型"} / ${imageResult.modelName || "image2"}`,
      outputContent,
      skillId: promptGeneration.skillId || body.skillId || existing.skillId || "",
      title: existing.title || "默认 AI 工作台 - image2 生图",
      createdAt: existing.createdAt || finishedAt
    });
  });
}

function queueInteractionImageJob({ recordId, body, actorUser, config }) {
  const jobBody = cloneJobPayload(body);
  const jobActor = { id: actorUser.id, name: actorUser.name, role: actorUser.role };
  if (isServerlessRuntime()) {
    return invokeNetlifyImageBackgroundJob({
      kind: "interaction_image",
      recordId,
      body: jobBody,
      actorUser: jobActor,
      config
    }).catch(async (error) => markImageJobFailed({
      recordId,
      title: "交互图",
      errorText: `提交 Netlify 后台交互图任务失败：${error.message || "未知错误"}`
    }));
  }
  setTimeout(() => {
    void runInteractionImageJob({ recordId, body: jobBody, actorUser: jobActor, config })
      .catch(async (error) => markImageJobFailed({
        recordId,
        title: "交互图",
        errorText: error.message || "后台交互图任务失败"
      }).catch((markError) => {
        console.error("failed to mark interaction image job", redactApiError(markError.message || ""));
      }));
  }, 0);
  return Promise.resolve(true);
}

function queueInteractionImageRegenerateJob({ recordId, itemId, modification, actorUser, config }) {
  const jobActor = { id: actorUser.id, name: actorUser.name, role: actorUser.role };
  if (isServerlessRuntime()) {
    return invokeNetlifyImageBackgroundJob({
      kind: "interaction_image_regenerate",
      recordId,
      itemId,
      modification,
      actorUser: jobActor,
      config
    }).catch(async (error) => markInteractionImageItemFailed({
      recordId,
      itemId,
      errorText: `提交 Netlify 后台单图重生成任务失败：${error.message || "未知错误"}`
    }));
  }
  setTimeout(() => {
    void runInteractionImageRegenerateJob({ recordId, itemId, modification, actorUser: jobActor, config })
      .catch(async (error) => markInteractionImageItemFailed({
        recordId,
        itemId,
        errorText: error.message || "单张交互图重新生成失败"
      }).catch((markError) => {
        console.error("failed to mark interaction image item", redactApiError(markError.message || ""));
      }));
  }, 0);
  return Promise.resolve(true);
}

async function runInteractionImageRegenerateJob({ recordId, itemId, modification, actorUser, config }) {
  const db = await readCrmDb();
  const record = db.aiGenerationRecords.find((item) => item.id === recordId);
  if (!record) throw new Error("未找到交互图画板记录");
  const customer = db.customers.find((item) => item.id === record.customerId);
  if (!customer) throw new Error("未找到当前客户，无法重新生成图片");
  const board = record.inputContext?.interactionImageBoard || {};
  const items = Array.isArray(board.items) ? board.items : [];
  const targetItem = items.find((item) => item.id === itemId);
  if (!targetItem) throw new Error("未找到要重新生成的图片");

  const revisedPrompt = [
    targetItem.prompt,
    "",
    "请基于原图和以下修改意见重新生成这一张交互图。",
    targetItem.imageUrl ? `原图参考链接：${targetItem.imageUrl}` : "",
    `修改意见：${modification}`,
    "保留客户项目上下文、中文 UI 文案、设备框和整体产品逻辑；只调整用户提出的修改点。"
  ].filter(Boolean).join("\n");
  const imageResult = await generateInteractionImage({
    prompt: revisedPrompt,
    style: board.style || record.inputContext?.interactionImage?.style || "",
    websiteType: board.websiteType || record.inputContext?.interactionImage?.websiteType || "",
    customerName: customer.name,
    referenceImageUrl: targetItem.imageUrl || "",
    config: buildBackgroundImageConfig(config)
  });

  const nextItems = items.map((item) => item.id === itemId
        ? {
          ...item,
          status: imageResult.usedFallback ? "failed" : "completed",
          prompt: revisedPrompt,
          imageUrl: imageResult.usedFallback ? item.imageUrl || "" : imageResult.imageUrl || "",
          previousImageUrl: imageResult.usedFallback
            ? item.previousImageUrl || item.imageUrl || ""
            : item.imageUrl || item.previousImageUrl || "",
          revisedPrompt: imageResult.revisedPrompt || "",
          imageProvider: imageResult.provider || "image2",
          imageModel: imageResult.modelName || config.image2Model || "image2",
      error: imageResult.usedFallback ? imageResult.note || imageResult.reason || "image2 未生成真实图片" : "",
      finishedAt: nowIso()
    }
    : item);
  const finalStatus = nextItems.some((item) => ["generating", "queued", "running"].includes(item.status))
    ? "generating"
    : nextItems.some((item) => item.status === "completed") ? "completed" : "failed";
  await updateInteractionImageBoardRecord({
    recordId,
    customer,
    body: {
      customerId: customer.id,
      userId: actorUser.id,
      style: board.style || "",
      websiteType: board.websiteType || "",
      extraRequirement: board.extraRequirement || ""
    },
    actorUser,
    items: nextItems,
    status: finalStatus,
    modelName: `${imageResult.modelName || config.image2Model || "image2"} 单张重生成${imageResult.usedFallback ? "失败" : "完成"}`
  });
}

async function runInteractionImageJob({ recordId, body, actorUser, config }) {
  const db = await readCrmDb();
  const actor = { user: actorUser };
  const customer = db.customers.find((item) => item.id === body.customerId);
  if (!customer) throw new Error("未找到当前客户，无法继续生成交互图");

  const suppliedPrompts = normalizeInteractionImagePrompts(body.imagePrompts || []);
  if (suppliedPrompts.length) {
    await runInteractionImageBoardJob({ recordId, body, actorUser, config, customer, actor, imagePrompts: suppliedPrompts });
    return;
  }

  const promptGeneration = await generateInteractionPromptWithFallback({ db, body, actor, customer, config });
  let promptDraft = promptGeneration.outputContent || "";
  if (isRemoteFailureMarkdown(promptDraft)) {
    await markImageJobFailed({
      recordId,
      title: promptGeneration.title || "交互图",
      errorText: stripMarkdown(promptDraft).slice(0, 1200) || "交互图提示词生成失败"
    });
    return;
  }
  const extractedPrompt = extractImagePrompt(promptDraft);
  const useExtractedPrompt = isUsableImagePrompt(extractedPrompt, promptDraft);
  const imagePrompt = useExtractedPrompt
    ? extractedPrompt
    : "";
  if (!useExtractedPrompt) {
    await markImageJobFailed({
      recordId,
      title: promptGeneration.title || "交互图",
      errorText: "交互图提示词不可用或内容过短，已停止 image2 调用，请重新生成。"
    });
    return;
  }

  const imageResult = await generateInteractionImage({
    prompt: imagePrompt,
    style: body.style,
    websiteType: body.websiteType,
    customerName: customer.name,
    config: buildBackgroundImageConfig(config)
  });
  const title = `${customer.name} - 交互图`;
  const outputContent = buildInteractionImageMarkdown({
    customer,
    style: body.style,
    websiteType: body.websiteType,
    promptDraft,
    imagePrompt,
    imageResult
  });
  const finishedAt = nowIso();
  const jobStatus = imageResult.usedFallback ? "failed" : "completed";
  const generation = {
    title,
    generationType: "interaction_image",
    skillId: promptGeneration.skillId,
    modelName: `${promptGeneration.modelName || "AI 模型"} / ${imageResult.modelName || "image2"}`,
    prompt: promptGeneration.prompt,
    inputContext: {
      ...promptGeneration.inputContext,
      asyncImageJob: {
        status: jobStatus,
        kind: "interaction_image",
        customerId: body.customerId,
        finishedAt,
        error: imageResult.usedFallback ? imageResult.note || imageResult.reason || "image2 未生成真实图片" : ""
      },
      interactionImage: {
        style: body.style || "",
        websiteType: body.websiteType || "",
        extraRequirement: body.extraRequirement || "",
        imageProvider: imageResult.provider,
        imageModel: imageResult.modelName,
        imageStatus: imageResult.status,
        usedPlaceholder: Boolean(imageResult.usedFallback)
      }
    },
    outputContent,
    createdAt: finishedAt
  };

  await withCrmDb((nextDb) => {
    const existing = nextDb.aiGenerationRecords.find((item) => item.id === recordId);
    if (!existing) return null;
    const record = upsertCollectionItem(nextDb, "aiGenerationRecords", {
      ...existing,
      id: recordId,
      customerId: body.customerId,
      userId: body.userId || actorUser.id,
      generationType: generation.generationType,
      inputContext: {
        ...generation.inputContext,
        asyncImageJob: {
          ...(existing.inputContext?.asyncImageJob || {}),
          ...generation.inputContext.asyncImageJob
        }
      },
      prompt: generation.prompt,
      modelName: generation.modelName,
      outputContent: generation.outputContent,
      skillId: generation.skillId,
      title: generation.title,
      createdAt: existing.createdAt || finishedAt
    });
    if (!imageResult.usedFallback) {
      saveCustomerMemoryFromGeneration(nextDb, body, actor, generation, record);
    }
    return record;
  });
}

async function runInteractionImageBoardJob({ recordId, body, actorUser, config, customer, actor, imagePrompts }) {
  const startedAt = nowIso();
  let items = imagePrompts.map((item, index) => ({
    id: item.id || `image_${index + 1}`,
    title: item.title || `界面 ${index + 1}`,
    device: normalizeInteractionDevice(item.device || body.defaultDevice || "桌面端"),
    goal: item.goal || "",
    layout: item.layout || "",
    prompt: item.prompt || "",
    status: index === 0 ? "generating" : "queued",
    imageUrl: "",
    revisedPrompt: "",
    error: "",
    startedAt: index === 0 ? startedAt : "",
    finishedAt: ""
  }));
  await updateInteractionImageBoardRecord({
    recordId,
    customer,
    body,
    actorUser,
    items,
    status: "generating",
    modelName: `${config.image2Model || "image2"} 后台生成中`
  });

  const imageConfig = buildBackgroundImageConfig(config);
  const results = [];
  for (let index = 0; index < items.length; index += 1) {
    items = items.map((item, itemIndex) => itemIndex === index
      ? { ...item, status: "generating", startedAt: nowIso(), error: "" }
      : item);
    await updateInteractionImageBoardRecord({
      recordId,
      customer,
      body,
      actorUser,
      items,
      status: "generating",
      modelName: `${config.image2Model || "image2"} 后台生成中`
    });

    const current = items[index];
    const imageResult = await generateInteractionImage({
      prompt: current.prompt,
      style: body.style,
      websiteType: body.websiteType,
      customerName: customer.name,
      config: imageConfig
    });
    results.push(imageResult);
    items = items.map((item, itemIndex) => itemIndex === index
      ? {
        ...item,
        status: imageResult.usedFallback ? "failed" : "completed",
        imageUrl: imageResult.usedFallback ? "" : imageResult.imageUrl || "",
        revisedPrompt: imageResult.revisedPrompt || "",
        imageProvider: imageResult.provider || "image2",
        imageModel: imageResult.modelName || config.image2Model || "image2",
        error: imageResult.usedFallback ? imageResult.note || imageResult.reason || "image2 未生成真实图片" : "",
        finishedAt: nowIso()
      }
      : item);
  }

  const hasCompleted = items.some((item) => item.status === "completed");
  const hasFailed = items.some((item) => item.status === "failed");
  const finalStatus = hasCompleted ? "completed" : hasFailed ? "failed" : "completed";
  await updateInteractionImageBoardRecord({
    recordId,
    customer,
    body,
    actorUser,
    items,
    status: finalStatus,
    modelName: `${results.find((item) => item?.modelName)?.modelName || config.image2Model || "image2"} 画板生成${finalStatus === "failed" ? "失败" : "完成"}`
  });

  if (hasCompleted) {
    const generation = {
      title: `${customer.name} - 交互图画板`,
      generationType: "interaction_image",
      outputContent: buildInteractionImageBoardMarkdown({
        customer,
        style: body.style,
        websiteType: body.websiteType,
        extraRequirement: body.extraRequirement,
        items,
        status: finalStatus
      }),
      inputContext: {
        customerMemoryStrategy: buildCustomerMemoryStrategyLikeContext(customer)
      },
      createdAt: nowIso()
    };
    await withCrmDb((db) => {
      const existing = db.aiGenerationRecords.find((item) => item.id === recordId);
      return saveCustomerMemoryFromGeneration(db, body, actor, generation, existing);
    });
  }
}

async function updateInteractionImageBoardRecord({ recordId, customer, body, actorUser, items, status, modelName }) {
  const now = nowIso();
  await withCrmDb((db) => {
    const existing = db.aiGenerationRecords.find((item) => item.id === recordId);
    if (!existing) return null;
    const failedItems = items.filter((item) => item.status === "failed");
    return upsertCollectionItem(db, "aiGenerationRecords", {
      ...existing,
      id: recordId,
      customerId: body.customerId || customer?.id || "",
      userId: body.userId || actorUser.id,
      generationType: "interaction_image",
      inputContext: {
        ...(existing.inputContext || {}),
        asyncImageJob: {
          ...(existing.inputContext?.asyncImageJob || {}),
          kind: "interaction_image_board",
          status,
          customerId: body.customerId || customer?.id || "",
          imageCount: items.length,
          finishedAt: status === "completed" || status === "failed" ? now : "",
          error: status === "failed" ? failedItems.map((item) => `${item.title}：${item.error}`).join("；").slice(0, 900) : ""
        },
        interactionImage: {
          ...(existing.inputContext?.interactionImage || {}),
          style: body.style || "",
          websiteType: body.websiteType || "",
          extraRequirement: body.extraRequirement || "",
          imageProvider: "image2",
          imageModel: modelName || "",
          imageStatus: status,
          usedPlaceholder: false
        },
        interactionImageBoard: {
          version: "interaction_board_v1",
          status,
          title: `${customer?.name || "客户"} - 交互图画板`,
          customerId: body.customerId || customer?.id || "",
          style: body.style || "",
          websiteType: body.websiteType || "",
          extraRequirement: body.extraRequirement || "",
          imageCount: items.length,
          items,
          updatedAt: now
        }
      },
      prompt: "background interaction image2 board generation",
      modelName: modelName || existing.modelName || "image2 后台生成",
      outputContent: buildInteractionImageBoardMarkdown({
        customer,
        style: body.style,
        websiteType: body.websiteType,
        extraRequirement: body.extraRequirement,
        items,
        status
      }),
      title: `${customer?.name || "客户"} - 交互图画板`,
      createdAt: existing.createdAt || now,
      updatedAt: now
    });
  });
}

function buildCustomerMemoryStrategyLikeContext(customer) {
  return {
    strategyName: "交互图画板记忆",
    remember: ["已生成的页面方向", "图片提示词", "客户认可或后续修改意见"],
    avoid: ["不要把图片中的推测功能写成客户已确认事实"],
    customerId: customer?.id || ""
  };
}

async function markImageJobFailed({ recordId, title, errorText }) {
  const safeError = redactApiError(errorText || "后台生图任务失败");
  const finishedAt = nowIso();
  await withCrmDb((db) => {
    const existing = db.aiGenerationRecords.find((item) => item.id === recordId);
    if (!existing) return null;
    return upsertCollectionItem(db, "aiGenerationRecords", {
      ...existing,
      id: recordId,
      inputContext: {
        ...(existing.inputContext || {}),
        asyncImageJob: {
          ...(existing.inputContext?.asyncImageJob || {}),
          status: "failed",
          finishedAt,
          error: safeError
        }
      },
      modelName: existing.modelName || "image2 后台生成",
      outputContent: [
        `# ${existing.title || title || "image2 生图"}`,
        "",
        `> 云端图片生成失败：${safeError}`,
        "",
        "## 当前状态",
        "",
        "- 状态：生成失败",
        "- 系统已停止等待本次图片任务，原始参数和上下文仍保留在本条历史记录中。",
        "- 建议检查 image2 Key、模型权限、Base URL、中转站任务状态后重新生成。"
      ].join("\n")
    });
  });
}

async function markInteractionImageItemFailed({ recordId, itemId, errorText }) {
  const safeError = redactApiError(errorText || "单张图片生成失败");
  const db = await readCrmDb();
  const record = db.aiGenerationRecords.find((item) => item.id === recordId);
  if (!record) return;
  const customer = record.customerId ? db.customers.find((item) => item.id === record.customerId) : null;
  const board = record.inputContext?.interactionImageBoard || {};
  const items = (board.items || []).map((item) => item.id === itemId
    ? { ...item, status: "failed", error: safeError, finishedAt: nowIso() }
    : item);
  const status = items.some((item) => ["generating", "queued", "running"].includes(item.status))
    ? "generating"
    : items.some((item) => item.status === "completed") ? "completed" : "failed";
  await withCrmDb((nextDb) => {
    const existing = nextDb.aiGenerationRecords.find((item) => item.id === recordId);
    if (!existing) return null;
    const existingBoard = existing.inputContext?.interactionImageBoard || {};
    return upsertCollectionItem(nextDb, "aiGenerationRecords", {
      ...existing,
      inputContext: {
        ...(existing.inputContext || {}),
        asyncImageJob: {
          ...(existing.inputContext?.asyncImageJob || {}),
          kind: "interaction_image_board",
          status,
          error: status === "failed" ? safeError : ""
        },
        interactionImageBoard: {
          ...existingBoard,
          status,
          items,
          updatedAt: nowIso()
        }
      },
      outputContent: buildInteractionImageBoardMarkdown({
        customer,
        style: existingBoard.style || "",
        websiteType: existingBoard.websiteType || "",
        extraRequirement: existingBoard.extraRequirement || "",
        items,
        status
      }),
      updatedAt: nowIso()
    });
  });
}

function buildBackgroundImageConfig(config) {
  return {
    ...config,
    image2TimeoutMs: Math.max(
      Number(config.image2TimeoutMs || 0),
      MIN_BACKGROUND_IMAGE_TIMEOUT_MS
    ),
    image2EditTimeoutMs: Math.max(
      Number(config.image2EditTimeoutMs || 0),
      5 * 60 * 1000
    ),
    image2PromptTimeoutMs: Math.max(
      Number(config.image2PromptTimeoutMs || 0),
      60 * 1000
    )
  };
}

async function invokeNetlifyImageBackgroundJob({ kind, recordId, body = {}, itemId = "", modification = "", actorUser, config }) {
  const baseUrl = String(process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("Netlify 未提供站点 URL，无法提交后台任务。");
  }
  const response = await fetch(`${baseUrl}/.netlify/functions/image-job-background`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Job-Secret": config.crmAuthSecret || ""
    },
    body: JSON.stringify({
      kind,
      recordId,
      body,
      itemId,
      modification,
      actorUser
    })
  });
  if (!response.ok && response.status !== 202) {
    const text = await response.text().catch(() => "");
    throw new Error(`Netlify 后台任务提交失败：HTTP ${response.status} ${text.slice(0, 220)}`);
  }
  return true;
}

function queueCrmGenerationJob({ recordId, body, actorUser, config }) {
  const jobBody = cloneJobPayload(body);
  const jobActor = { id: actorUser.id, name: actorUser.name, role: actorUser.role };
  if (isServerlessRuntime()) {
    return invokeNetlifyImageBackgroundJob({
      kind: "crm_generation",
      recordId,
      body: jobBody,
      actorUser: jobActor,
      config
    }).catch(async (error) => markCrmGenerationJobFailed({
      recordId,
      title: GENERATION_LABELS_FOR_SYNC[body.type] || body.type || "AI 生成",
      errorText: `提交 Netlify 后台 AI 任务失败：${error.message || "未知错误"}`
    }));
  }
  setTimeout(() => {
    void runCrmGenerationJob({ recordId, body: jobBody, actorUser: jobActor, config })
      .catch(async (error) => markCrmGenerationJobFailed({
        recordId,
        title: GENERATION_LABELS_FOR_SYNC[body.type] || body.type || "AI 生成",
        errorText: error.message || "后台 AI 任务失败"
      }).catch((markError) => {
        console.error("failed to mark crm ai job", redactApiError(markError.message || ""));
      }));
  }, 0);
  return Promise.resolve(true);
}

function queueCustomerHistoricalSolutionJob({ recordId, body, actorUser, config }) {
  const jobBody = cloneJobPayload(body);
  const jobActor = { id: actorUser.id, name: actorUser.name, role: actorUser.role };
  if (isServerlessRuntime()) {
    return invokeNetlifyImageBackgroundJob({
      kind: "historical_solution",
      recordId,
      body: jobBody,
      actorUser: jobActor,
      config
    }).catch(async (error) => markCrmGenerationJobFailed({
      recordId,
      title: "加入历史方案库",
      errorText: `提交 Netlify 历史方案后台任务失败：${error.message || "未知错误"}`
    }));
  }
  setTimeout(() => {
    void runCustomerHistoricalSolutionJob({ recordId, body: jobBody, actorUser: jobActor, config })
      .catch(async (error) => markCrmGenerationJobFailed({
        recordId,
        title: "加入历史方案库",
        errorText: error.message || "历史方案入库任务失败"
      }).catch((markError) => {
        console.error("failed to mark historical solution job", redactApiError(markError.message || ""));
      }));
  }, 0);
  return Promise.resolve(true);
}

async function runCrmGenerationJob({ recordId, body, actorUser, config }) {
  const db = await readCrmDb();
  const actor = { user: actorUser };
  const customer = body.customerId ? db.customers.find((item) => item.id === body.customerId) : null;
  await updateCrmGenerationJobStep(recordId, {
    id: "read_context",
    title: "读取客户上下文",
    status: "done",
    summary: customer ? `已读取 ${customer.name} 的客户信息、跟进记录和资料。` : "已读取默认工作台上下文。"
  });
  await updateCrmGenerationJobStep(recordId, {
    id: "call_model",
    title: "调用 AI 与 Skill",
    status: "running",
    summary: "正在调用模型生成结果。"
  });

  const generation = await withSoftTimeout(
    generateCrmContent({
      db,
      type: body.type,
      customerId: body.customerId || "",
      skillId: body.skillId,
      userId: body.userId || actorUser.id,
      message: body.message,
      extraContext: body.extraContext,
      modelId: body.modelId,
      config
    }),
    getBackgroundAiJobTimeoutMs(body.type, config),
    () => buildTimedOutGeneration({ db, body, customer, actorUser, config })
  );
  const finishedAt = nowIso();
  const failed = isRemoteFailureMarkdown(generation.outputContent);

  await withCrmDb((nextDb) => {
    const existing = nextDb.aiGenerationRecords.find((item) => item.id === recordId);
    if (!existing) return null;
    const record = upsertCollectionItem(nextDb, "aiGenerationRecords", {
      ...existing,
      id: recordId,
      customerId: body.customerId || existing.customerId || "",
      userId: body.userId || actorUser.id,
      generationType: generation.generationType,
      inputContext: {
        ...generation.inputContext,
        asyncAiJob: {
          ...(existing.inputContext?.asyncAiJob || {}),
          status: failed ? "failed" : "completed",
          finishedAt,
          error: failed ? extractFailureSummary(generation.outputContent) || "远程模型返回失败内容，已保存可见错误" : "",
          steps: mergeAsyncJobSteps(existing.inputContext?.asyncAiJob?.steps, [
            buildAsyncJobStep("read_context", "读取客户上下文", "done", customer ? `已读取 ${customer.name} 的客户信息、跟进记录和资料。` : "已读取默认工作台上下文。"),
            buildAsyncJobStep("call_model", "调用 AI 与 Skill", failed ? "failed" : "done", failed ? extractFailureSummary(generation.outputContent) || "模型或 Skill 调用失败。" : "模型已返回结果。"),
            buildAsyncJobStep("write_result", "写入生成结果", failed ? "failed" : "done", failed ? "已写入失败原因，可重新生成。" : "已保存到生成历史。")
          ])
        }
      },
      prompt: generation.prompt,
      modelName: generation.modelName || BACKGROUND_AI_MODEL_NAME,
      outputContent: generation.outputContent,
      skillId: generation.skillId || existing.skillId || "",
      title: generation.title || existing.title,
      createdAt: existing.createdAt || finishedAt
    });

    if (!failed) {
      saveCustomerMemoryFromGeneration(nextDb, body, actor, generation, record);
      saveGenerationToCustomerIfNeeded(nextDb, body, generation);
    }

    if (body.type === "follow_summary" && body.extraContext?.followRecordId) {
      const follow = nextDb.followRecords.find((item) => item.id === body.extraContext.followRecordId);
      if (follow) {
        follow.aiSummary = generation.outputContent;
        follow.updatedAt = finishedAt;
      }
    }

    if (body.type === "failure_report" && body.extraContext?.failureReportId) {
      const report = nextDb.failureReports.find((item) => item.id === body.extraContext.failureReportId);
      if (report) {
        report.aiReport = generation.outputContent;
        report.reactivateSuggestion = extractReactivateSuggestion(generation.outputContent || "");
        report.status = failed ? "failed" : "completed";
        report.updatedAt = finishedAt;
      }
    }

    return record;
  });
}

async function recoverStuckCrmGenerationJobs({ db, config }) {
  if (!isServerlessRuntime()) return false;
  const now = Date.now();
  const recoverableTypes = new Set([
    "follow_strategy",
    "demand_analysis",
    "proposal_outline",
    "failure_report",
    "follow_summary",
    "chat",
    "consultation_advice",
    "next_communication_question_list",
    "lightweight_solution",
    "solution_deepening",
    "historical_solution_entry",
    "requirement_document",
    "lightweight_solution_ppt_outline"
  ]);
  const stuckRecords = db.aiGenerationRecords
    .filter((record) => {
      const job = record.inputContext?.asyncAiJob;
      if (job?.status !== "generating") return false;
      if (!recoverableTypes.has(record.generationType)) return false;
      const startedAt = Date.parse(job.startedAt || record.createdAt || "");
      if (!Number.isFinite(startedAt)) return false;
      const timeoutMs = Number(job.timeoutMs || getBackgroundAiJobTimeoutMs(job.kind || record.generationType, config));
      return now - startedAt > Math.max(timeoutMs + 10 * 1000, 60 * 1000);
    })
    .slice(0, 1);

  if (!stuckRecords.length) return false;

  for (const record of stuckRecords) {
    await recoverStuckCrmGenerationJob(record, db, config);
  }
  return true;
}

async function recoverStuckCrmGenerationJob(record, db, config) {
  const customerId = record.customerId || record.inputContext?.customerId || record.inputContext?.asyncAiJob?.customerId || "";
  const customer = customerId ? db.customers.find((item) => item.id === customerId) : null;
  const generation = await generateCrmContent({
    db,
    type: record.generationType || record.inputContext?.asyncAiJob?.kind || "follow_strategy",
    customerId,
    skillId: record.skillId || "",
    userId: record.userId || record.inputContext?.generatedBy || "system",
    message: record.inputContext?.message || "",
    extraContext: {
      ...(record.inputContext?.extra || {}),
      recoveredFromServerlessQueue: true,
      recoveryReason: "Netlify 后台任务未及时写回，轮询时自动生成兜底结果，避免销售端长期卡在生成中。"
    },
    modelId: "model_local",
    config: {
      ...config,
      openaiApiKey: ""
    }
  });
  const finishedAt = nowIso();

  await withCrmDb((nextDb) => {
    const existing = nextDb.aiGenerationRecords.find((item) => item.id === record.id);
    if (!existing) return null;
    const saved = upsertCollectionItem(nextDb, "aiGenerationRecords", {
      ...existing,
      inputContext: {
        ...generation.inputContext,
        asyncAiJob: {
          ...(existing.inputContext?.asyncAiJob || {}),
          status: "completed",
          finishedAt,
          recovered: true,
          recoveryNote: "Netlify 后台任务未及时写回，已由 bootstrap 轮询兜底完成。",
          steps: mergeAsyncJobSteps(existing.inputContext?.asyncAiJob?.steps, [
            buildAsyncJobStep("read_context", "读取客户上下文", "done", customer ? `已读取 ${customer.name} 的客户上下文。` : "已读取当前上下文。"),
            buildAsyncJobStep("call_model", "生成兜底结果", "done", "后台任务未及时写回，已生成可用兜底结果。"),
            buildAsyncJobStep("write_result", "写入生成结果", "done", "已保存到生成历史。")
          ])
        }
      },
      prompt: generation.prompt,
      modelName: `${generation.modelName || "本地规则生成"} / 线上兜底`,
      outputContent: generation.outputContent,
      title: generation.title || existing.title,
      updatedAt: finishedAt
    });

    const actor = {
      user: nextDb.users.find((user) => user.id === (record.userId || record.inputContext?.generatedBy)) || { id: "system", name: "系统任务", role: "admin" }
    };
    saveCustomerMemoryFromGeneration(nextDb, {
      customerId,
      userId: record.userId || actor.user.id,
      type: record.generationType,
      saveToCustomer: false
    }, actor, generation, saved);

    if (record.generationType === "follow_summary" && existing.inputContext?.extra?.followRecordId) {
      const follow = nextDb.followRecords.find((item) => item.id === existing.inputContext.extra.followRecordId);
      if (follow) {
        follow.aiSummary = generation.outputContent;
        follow.updatedAt = finishedAt;
      }
    }

    if (record.generationType === "failure_report" && existing.inputContext?.extra?.failureReportId) {
      const report = nextDb.failureReports.find((item) => item.id === existing.inputContext.extra.failureReportId);
      if (report) {
        report.aiReport = generation.outputContent;
        report.reactivateSuggestion = extractReactivateSuggestion(generation.outputContent || "");
        report.status = "completed";
        report.updatedAt = finishedAt;
      }
    }

    return saved;
  });
}

async function runCustomerHistoricalSolutionJob({ recordId, body, actorUser, config }) {
  const db = await readCrmDb();
  const actor = { user: actorUser };
  const customer = db.customers.find((item) => item.id === body.customerId);
  if (!customer) throw new Error("未找到当前客户，无法加入历史方案库");
  await updateCrmGenerationJobStep(recordId, {
    id: "read_context",
    title: "读取客户上下文",
    status: "done",
    summary: `已读取 ${customer.name} 的完整客户上下文。`
  });
  await updateCrmGenerationJobStep(recordId, {
    id: "call_model",
    title: "生成历史方案",
    status: "running",
    summary: "正在分析客户上下文并生成可复用方案库内容。"
  });

  const generation = await withSoftTimeout(
    generateCrmContent({
      db,
      type: "historical_solution_entry",
      customerId: customer.id,
      skillId: body.skillId,
      userId: body.userId || actorUser.id,
      message: body.message,
      extraContext: body.extraContext,
      modelId: body.modelId,
      config
    }),
    getBackgroundAiJobTimeoutMs("historical_solution_entry", config),
    () => buildTimedOutGeneration({ db, body: { ...body, type: "historical_solution_entry" }, customer, actorUser, config })
  );
  const finishedAt = nowIso();
  const failed = isRemoteFailureMarkdown(generation.outputContent);

  await withCrmDb((nextDb) => {
    const existing = nextDb.aiGenerationRecords.find((item) => item.id === recordId);
    if (!existing) return null;
    const record = upsertCollectionItem(nextDb, "aiGenerationRecords", {
      ...existing,
      id: recordId,
      customerId: customer.id,
      userId: body.userId || actorUser.id,
      generationType: generation.generationType,
      inputContext: {
        ...generation.inputContext,
        asyncAiJob: {
          ...(existing.inputContext?.asyncAiJob || {}),
          status: failed ? "failed" : "completed",
          finishedAt,
          error: failed ? extractFailureSummary(generation.outputContent) || "远程模型返回失败内容，历史方案库未入库" : "",
          steps: mergeAsyncJobSteps(existing.inputContext?.asyncAiJob?.steps, [
            buildAsyncJobStep("read_context", "读取客户上下文", "done", `已读取 ${customer.name} 的完整客户上下文。`),
            buildAsyncJobStep("call_model", "生成历史方案", failed ? "failed" : "done", failed ? extractFailureSummary(generation.outputContent) || "历史方案生成失败。" : "已生成历史方案内容。"),
            buildAsyncJobStep("write_result", "写入历史方案库", failed ? "failed" : "done", failed ? "生成失败，未写入知识库。" : "已完成知识库切片与入库。")
          ])
        }
      },
      prompt: generation.prompt,
      modelName: generation.modelName || BACKGROUND_AI_MODEL_NAME,
      outputContent: generation.outputContent,
      skillId: generation.skillId || existing.skillId || "",
      title: generation.title || existing.title,
      createdAt: existing.createdAt || finishedAt
    });

    if (!failed) {
      const kbResult = addCustomerSolutionToKnowledgeBase(nextDb, {
        customer,
        generation,
        actor: actorUser,
        sourceRecordId: recordId,
        createdAt: finishedAt
      });
      record.inputContext = {
        ...(record.inputContext || {}),
        historicalSolutionKnowledgeBase: kbResult
      };
      saveCustomerMemoryFromGeneration(nextDb, body, actor, generation, record);
    }
    return record;
  });
}

async function markCrmGenerationJobFailed({ recordId, title, errorText }) {
  const safeError = redactApiError(errorText || "后台 AI 任务失败");
  const finishedAt = nowIso();
  await withCrmDb((db) => {
    const existing = db.aiGenerationRecords.find((item) => item.id === recordId);
    if (!existing) return null;
    const saved = upsertCollectionItem(db, "aiGenerationRecords", {
      ...existing,
      id: recordId,
      inputContext: {
        ...(existing.inputContext || {}),
        asyncAiJob: {
          ...(existing.inputContext?.asyncAiJob || {}),
          status: "failed",
          finishedAt,
          error: safeError,
          steps: mergeAsyncJobSteps(existing.inputContext?.asyncAiJob?.steps, [
            buildAsyncJobStep("call_model", "调用 AI 与 Skill", "failed", safeError),
            buildAsyncJobStep("write_result", "写入失败原因", "done", "已停止等待本次任务，可重新生成。")
          ])
        }
      },
      modelName: existing.modelName || BACKGROUND_AI_MODEL_NAME,
      outputContent: [
        `# ${existing.title || title || "AI 生成"}`,
        "",
        `> 后台 AI 任务失败：${safeError}`,
        "",
        "## 当前状态",
        "",
        "- 状态：生成失败",
        "- 系统已停止等待本次任务，原始参数和上下文仍保留在历史记录中。",
        "- 建议稍后重新触发生成。"
      ].join("\n")
    });
    const failureReportId = existing.inputContext?.extra?.failureReportId;
    if (failureReportId) {
      const report = db.failureReports.find((item) => item.id === failureReportId);
      if (report) {
        report.status = "failed";
        report.aiReport = saved.outputContent;
        report.updatedAt = finishedAt;
      }
    }
    return saved;
  });
}

async function resumePendingPptTaskPolling(config) {
  try {
    const db = await readCrmDb();
    for (const record of db.aiGenerationRecords || []) {
      const pptTask = record.inputContext?.pptTask || {};
      if (record.generationType !== "lightweight_solution_ppt") continue;
      if (getAsyncRecordStatus(record) !== "generating") continue;
      if (!pptTask.taskId || pptTaskPollers.has(record.id)) continue;
      startPptTaskPolling({
        recordId: record.id,
        taskId: pptTask.taskId,
        baseUrl: pptTask.baseUrl || getPptSkillBaseUrl(config),
        config
      });
    }
  } catch (error) {
    console.warn("resume ppt task polling failed", redactApiError(error.message || ""));
  }
}

function startPptTaskPolling({ recordId, taskId, baseUrl, config }) {
  if (!recordId || !taskId || pptTaskPollers.has(recordId)) return;
  const startedAt = Date.now();
  const resolvedBaseUrl = baseUrl || getPptSkillBaseUrl(config);

  const stop = () => {
    const current = pptTaskPollers.get(recordId);
    if (current?.timer) clearInterval(current.timer);
    pptTaskPollers.delete(recordId);
  };

  const tick = async () => {
    try {
      const task = await fetchPptSkillTask({ taskId, baseUrl: resolvedBaseUrl });
      const status = normalizePptSkillTaskStatus(task.status);
      await updatePptTaskRecord({
        recordId,
        task,
        baseUrl: resolvedBaseUrl,
        status
      });
      if (status === "completed" || status === "failed") stop();
    } catch (error) {
      if (/任务不存在|not found|404/i.test(error.message || "")) {
        await updatePptTaskRecord({
          recordId,
          task: null,
          baseUrl: resolvedBaseUrl,
          status: "failed",
          errorText: `PPT 任务不存在或已被清理：${error.message || "未知错误"}`
        });
        stop();
        return;
      }
      if (Date.now() - startedAt > PPT_TASK_POLL_TIMEOUT_MS) {
        await updatePptTaskRecord({
          recordId,
          task: null,
          baseUrl: resolvedBaseUrl,
          status: "failed",
          errorText: `PPT 任务轮询超时或服务不可达：${error.message || "未知错误"}`
        });
        stop();
        return;
      }
      console.warn("ppt task polling failed", redactApiError(error.message || ""));
    }
  };

  const timer = setInterval(tick, PPT_TASK_POLL_INTERVAL_MS);
  timer.unref?.();
  pptTaskPollers.set(recordId, { timer, taskId, baseUrl: resolvedBaseUrl, startedAt });
  const kickoff = setTimeout(tick, 800);
  kickoff.unref?.();
}

async function updatePptTaskRecord({ recordId, task, baseUrl, status, errorText = "" }) {
  await withCrmDb((db) => {
    const existing = db.aiGenerationRecords.find((item) => item.id === recordId);
    if (!existing) return null;
    const customer = db.customers.find((item) => item.id === existing.customerId) || null;
    const outlineRecordId = existing.inputContext?.pptTask?.sourceOutlineRecordId || "";
    const outlineRecord = outlineRecordId
      ? db.aiGenerationRecords.find((item) => item.id === outlineRecordId)
      : null;
    const pptInput = existing.inputContext?.pptTask?.pptInput || {};
    return upsertCollectionItem(db, "aiGenerationRecords", mergePptTaskIntoRecord({
      record: existing,
      customer,
      outlineRecord,
      pptInput,
      pptTask: task ? normalizePptSkillTask(task, baseUrl) : null,
      status,
      errorText: errorText || task?.error || ""
    }));
  });
}

function getAsyncRecordStatus(record = {}) {
  return record.inputContext?.asyncAiJob?.status
    || record.inputContext?.pptTask?.status
    || record.inputContext?.asyncImageJob?.status
    || "";
}

async function expireStaleCrmAsyncJobs(config = {}) {
  const now = Date.now();
  await withCrmDb((db) => {
    let changed = false;
    for (const record of db.aiGenerationRecords || []) {
      const job = record.inputContext?.asyncAiJob;
      if (!job || job.status !== "generating") continue;
      const startedAt = Date.parse(job.startedAt || record.createdAt || record.updatedAt || "");
      if (!Number.isFinite(startedAt)) continue;
      const timeoutMs = Number(job.timeoutMs || getBackgroundAiJobTimeoutMs(job.kind || record.generationType, config));
      if (now - startedAt < timeoutMs) continue;
      const safeError = `后台生成超过 ${Math.round(timeoutMs / 1000)} 秒，系统已停止等待，请重新生成。`;
      record.inputContext = {
        ...(record.inputContext || {}),
        asyncAiJob: {
          ...job,
          status: "failed",
          finishedAt: nowIso(),
          error: safeError,
          steps: mergeAsyncJobSteps(job.steps, [
            buildAsyncJobStep("call_model", "调用 AI 与 Skill", "failed", safeError),
            buildAsyncJobStep("write_result", "写入失败原因", "done", "已停止等待本次任务，可重新生成。")
          ])
        }
      };
      record.modelName = record.modelName || BACKGROUND_AI_MODEL_NAME;
      record.outputContent = [
        `# ${record.title || GENERATION_LABELS_FOR_SYNC[record.generationType] || "AI 生成"}`,
        "",
        `> 后台生成超时：${safeError}`,
        "",
        "## 当前状态",
        "",
        "- 状态：生成失败",
        "- 这条任务已从“生成中”改为“生成失败”，避免无限等待。",
        "- 可以点击「重新生成」再次提交。"
      ].join("\n");
      record.updatedAt = nowIso();
      changed = true;
    }
    return changed ? db : null;
  });
}

function buildLightweightSolutionPptTaskInput(db, customer, outlineRecord) {
  const latestConsultationReport = db.aiGenerationRecords
    .filter((record) => record.customerId === customer.id && record.generationType === "consultation_advice")
    .filter((record) => getAsyncRecordStatus(record) !== "generating" && getAsyncRecordStatus(record) !== "failed")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const latestLightweightSolution = db.aiGenerationRecords
    .filter((record) => record.customerId === customer.id && record.generationType === "lightweight_solution")
    .filter((record) => getAsyncRecordStatus(record) !== "generating" && getAsyncRecordStatus(record) !== "failed")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const recentFollows = db.followRecords
    .filter((record) => record.customerId === customer.id)
    .sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt))
    .slice(0, 5);
  const outlineMarkdown = String(outlineRecord.outputContent || "").trim();
  const topic = `${customer.name || "客户"}轻量级方案PPT`;
  const projectBackground = trimText([
    `客户名称：${customer.name || "未填写"}`,
    `客户类型：${customer.customerType || "未填写"}`,
    `当前阶段：${customer.stage || "未填写"}`,
    `客户原始需求：${customer.demandDescription || "待补充"}`,
    `客户业务背景：${customer.background || "待补充"}`,
    `想解决的问题：${customer.problemToSolve || "待补充"}`,
    `已有系统或业务基础：${customer.existingSystem || "待补充"}`,
    latestConsultationReport ? `前期咨询回应报告摘要：${stripMarkdown(latestConsultationReport.outputContent || "").slice(0, 1600)}` : "前期咨询回应报告：暂无或未完成。",
    latestLightweightSolution ? `轻量级方案摘要：${stripMarkdown(latestLightweightSolution.outputContent || "").slice(0, 2200)}` : "轻量级方案：暂无或未完成。",
    recentFollows.length ? `最近跟进摘要：${summarizeFollowRecordsForLightweightSolution(customer, recentFollows)}` : "最近跟进摘要：暂无。"
  ].join("\n"), 5600);
  const coreContent = trimMarkdownForRecord([
    "请严格基于下面的轻量方案 PPT 结构稿生成 PPT，不要新增明显未确认的大功能，不讲报价、不讲合同、不讲排期。",
    "如果结构稿中已经明确页面目标、核心内容、建议呈现形式和视觉建议，请优先保留。",
    "",
    outlineMarkdown
  ].join("\n"), 14000);

  return {
    topic,
    customerName: customer.name || "",
    projectBackground,
    coreContent,
    pageCount: inferPptPageCount(outlineMarkdown),
    style: inferPptStyle({ customer, outlineMarkdown, latestLightweightSolution }),
    hasTemplate: false,
    sourceOutlineRecordId: outlineRecord.id,
    sourceOutlineTitle: outlineRecord.title || "",
    builtAt: nowIso()
  };
}

function buildPendingPptTaskGeneration({ customer, outlineRecord, pptInput, actor, createdAt = nowIso(), status = "generating" }) {
  const title = `${customer?.name || "客户"} - 轻量级方案PPT`;
  const startedAt = createdAt || nowIso();
  return {
    title,
    generationType: "lightweight_solution_ppt",
    skillId: outlineRecord?.skillId || "",
    modelName: "PPT Skill 后台生成中",
    prompt: "ppt skill task generation",
    inputContext: {
      asyncAiJob: {
        kind: "lightweight_solution_ppt",
        status,
        startedAt,
        customerId: customer?.id || "",
        reason: "轻量方案 PPT 已提交到 PPT Skill 服务后台生成。",
        timeoutMs: getBackgroundAiJobTimeoutMs("lightweight_solution_ppt"),
        steps: [
          buildAsyncJobStep("queued", "任务已排队", "done", "PPT 任务已创建。", startedAt),
          buildAsyncJobStep("read_context", "读取轻量方案结构稿", "running", "正在读取轻量级方案和 PPT 结构稿。", startedAt),
          buildAsyncJobStep("call_model", "调用 PPT Skill", "pending", "等待 PPT Skill 生成图片式 PPT。", startedAt),
          buildAsyncJobStep("write_result", "写入结果", "pending", "等待生成完成后保存预览和下载链接。", startedAt)
        ]
      },
      pptTask: {
        status,
        baseUrl: "",
        taskId: "",
        sourceOutlineRecordId: outlineRecord?.id || "",
        sourceOutlineTitle: outlineRecord?.title || "",
        pptInput,
        createdBy: actor?.id || "",
        createdByName: actor?.name || "",
        startedAt: createdAt
      },
      generatedBy: actor?.id || ""
    },
    outputContent: buildPptTaskRecordMarkdown({
      customer,
      outlineRecord,
      pptInput,
      pptTask: null,
      status
    }),
    createdAt: startedAt
  };
}

function mergePptTaskIntoRecord({ record, customer, outlineRecord, pptInput = {}, pptTask = null, status = "generating", errorText = "" }) {
  const safeError = errorText ? redactApiError(errorText) : "";
  const now = nowIso();
  const previousContext = record.inputContext || {};
  const previousTask = previousContext.pptTask || {};
  const nextTask = {
    ...previousTask,
    ...(pptTask || {}),
    status,
    baseUrl: pptTask?.baseUrl || previousTask.baseUrl || "",
    taskId: pptTask?.id || pptTask?.taskId || previousTask.taskId || "",
    sourceOutlineRecordId: outlineRecord?.id || previousTask.sourceOutlineRecordId || "",
    sourceOutlineTitle: outlineRecord?.title || previousTask.sourceOutlineTitle || "",
    pptInput: pptInput && Object.keys(pptInput).length ? pptInput : previousTask.pptInput || {},
    error: safeError,
    updatedAt: now,
    finishedAt: status === "completed" || status === "failed" ? now : previousTask.finishedAt || ""
  };

  return {
    ...record,
    inputContext: {
      ...previousContext,
      asyncAiJob: {
        ...(previousContext.asyncAiJob || {}),
        kind: "lightweight_solution_ppt",
        status,
        customerId: record.customerId || customer?.id || "",
        finishedAt: status === "completed" || status === "failed" ? now : "",
        error: safeError,
        steps: mergeAsyncJobSteps(previousContext.asyncAiJob?.steps, [
          buildAsyncJobStep("read_context", "读取轻量方案结构稿", "done", "已完成 PPT 参数自动填充。"),
          buildAsyncJobStep("call_model", "调用 PPT Skill", status === "failed" ? "failed" : status === "completed" ? "done" : "running", status === "failed" ? safeError || "PPT Skill 调用失败。" : status === "completed" ? "PPT Skill 已返回结果。" : "PPT Skill 正在生成图片式 PPT。"),
          buildAsyncJobStep("write_result", "写入结果", status === "completed" ? "done" : status === "failed" ? "failed" : "pending", status === "completed" ? "已保存 PPT 预览和下载链接。" : status === "failed" ? "已写入失败原因，可重新生成。" : "等待 PPT 服务完成。")
        ])
      },
      pptTask: nextTask
    },
    modelName: status === "completed" ? "PPT Skill 生成完成" : status === "failed" ? "PPT Skill 生成失败" : "PPT Skill 后台生成中",
    outputContent: buildPptTaskRecordMarkdown({
      customer,
      outlineRecord,
      pptInput: nextTask.pptInput,
      pptTask: nextTask,
      status,
      errorText: safeError
    }),
    updatedAt: now
  };
}

async function createPptSkillTask(pptInput, config) {
  const baseUrl = getPptSkillBaseUrl(config);
  if (!baseUrl) {
    throw new Error("正式环境尚未配置 PPT_SKILL_BASE_URL。PPT Skill 需要单独部署 ppt-skill-web 后填写线上地址。");
  }
  const form = new FormData();
  for (const [key, value] of Object.entries({
    topic: pptInput.topic,
    customerName: pptInput.customerName,
    projectBackground: pptInput.projectBackground,
    coreContent: pptInput.coreContent,
    pageCount: pptInput.pageCount,
    style: pptInput.style,
    hasTemplate: "false"
  })) {
    form.append(key, String(value ?? ""));
  }

  const payload = await fetchJsonWithTimeout(new URL("/api/tasks", baseUrl).toString(), {
    method: "POST",
    body: form
  }, 25000);
  if (!payload?.task?.id) throw new Error("PPT Skill 服务未返回任务 ID。");
  return normalizePptSkillTask(payload.task, baseUrl);
}

async function fetchPptSkillTask({ taskId, baseUrl }) {
  const payload = await fetchJsonWithTimeout(new URL(`/api/tasks/${taskId}`, baseUrl).toString(), {
    method: "GET"
  }, 12000);
  if (!payload?.task?.id) throw new Error("PPT Skill 服务未返回任务状态。");
  return normalizePptSkillTask(payload.task, baseUrl);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    const payload = text ? safeJsonParse(text) : {};
    if (!response.ok) {
      const message = payload?.error || payload?.message || text || `HTTP ${response.status}`;
      throw new Error(redactApiError(message));
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`PPT Skill 服务请求超时：${url}`);
    }
    if (/fetch failed|ECONNREFUSED|connect ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(error.message || "")) {
      const base = new URL(url).origin;
      throw new Error(`PPT Skill 服务未启动或无法连接：${base}。请先启动 ppt-skill-web（端口 3100）或检查 PPT_SKILL_BASE_URL。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizePptSkillTask(task = {}, baseUrl = "") {
  return {
    ...task,
    taskId: task.id || task.taskId || "",
    baseUrl,
    viewerUrl: absolutizeUrl(baseUrl, task.viewerUrl || ""),
    downloadUrl: absolutizeUrl(baseUrl, task.downloadUrl || ""),
    taskStatus: task.status || ""
  };
}

function normalizePptSkillTaskStatus(status = "") {
  const value = String(status || "").toLowerCase();
  if (value === "succeeded" || value === "completed" || value === "done") return "completed";
  if (value === "failed" || value === "error") return "failed";
  return "generating";
}

function getPptSkillBaseUrl(config = {}) {
  return String(config.pptSkillBaseUrl || "").replace(/\/+$/, "");
}

function absolutizeUrl(baseUrl, value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return new URL(raw.startsWith("/") ? raw : `/${raw}`, baseUrl).toString();
}

function buildPptTaskRecordMarkdown({ customer, outlineRecord, pptInput = {}, pptTask = null, status = "generating", errorText = "" }) {
  const title = `${customer?.name || pptInput.customerName || "客户"} - 轻量级方案PPT`;
  const safeError = errorText ? redactApiError(errorText) : "";
  const statusText = status === "completed" ? "PPT 已生成完成" : status === "failed" ? `PPT 生成失败：${safeError || "未知错误"}` : "PPT 已提交后台生成，完成后会在帮助中心提醒";
  const viewerUrl = pptTask?.viewerUrl || "";
  const downloadUrl = pptTask?.downloadUrl || "";
  const taskId = pptTask?.taskId || pptTask?.id || "";
  const pptResult = pptTask?.result || {};
  const engine = pptTask?.engine || pptResult.engine || "";
  const imageModel = pptTask?.imageModel || pptResult.imageModel || "";
  const imageBackend = pptTask?.imageBackend || pptResult.imageBackend || "";
  const imageEndpoint = pptTask?.imageEndpoint || pptResult.imageEndpoint || "";
  const imageCount = pptTask?.imageCount || pptResult.imageCount || pptResult.imageFiles?.length || 0;
  const usedImage2 = typeof pptResult.usedImage2 === "boolean" ? pptResult.usedImage2 : imageCount > 0;

  return [
    `# ${title}`,
    "",
    `> ${statusText}`,
    "",
    "## 自动填充的 PPT 参数",
    "",
    `- PPT 主题：${pptInput.topic || title}`,
    `- 客户名称：${pptInput.customerName || customer?.name || "未填写"}`,
    `- 目标页数：${pptInput.pageCount || "自动估算"} 页`,
    `- 视觉风格：${pptInput.style || "现代商务 / 清晰汇报"}`,
    `- 结构稿来源：${outlineRecord?.title || pptInput.sourceOutlineTitle || "轻量级方案 PPT 结构稿"}`,
    taskId ? `- PPT Skill 任务 ID：${taskId}` : "",
    engine ? `- 生成引擎：${engine}` : "",
    status === "completed" ? `- image2 出图：${usedImage2 ? `是，已生成 ${imageCount} 张幻灯片图片` : "否，未检测到图片页"}` : "",
    imageModel ? `- 图片模型：${imageModel}` : "",
    imageBackend ? `- 图片后端：${imageBackend}${imageEndpoint ? ` / ${imageEndpoint}` : ""}` : "",
    "",
    "## 任务结果",
    "",
    status === "completed" ? [
      viewerUrl ? `- HTML 预览：[打开 PPT 预览](${viewerUrl})` : "- HTML 预览：未返回预览链接。",
      downloadUrl ? `- PPTX 下载：[下载 PPT 文件](${downloadUrl})` : "- PPTX 下载：未返回下载链接。"
    ].join("\n") : status === "failed" ? [
      `- 失败原因：${safeError || "PPT Skill 服务未返回明确错误。"}`,
      "- 系统没有启用本地兜底生成；请检查 PPT Skill 服务、Codex CLI、image2 Key 或任务日志后重新生成。"
    ].join("\n") : [
      "- 状态：后台生成中",
      "- 说明：你可以继续使用 CRM，PPT 完成后会自动更新本条历史记录。"
    ].join("\n"),
    "",
    "## 大纲摘要",
    "",
    trimMarkdownForRecord(outlineRecord?.outputContent || pptInput.coreContent || "暂无结构稿内容。", 1800)
  ].filter(Boolean).join("\n");
}

function inferPptPageCount(markdown = "") {
  const matches = String(markdown || "").match(/^###\s*第\d+页/gm) || [];
  const count = matches.length || 10;
  return Math.min(16, Math.max(8, count));
}

function inferPptStyle({ customer, outlineMarkdown = "", latestLightweightSolution = null }) {
  const text = [
    customer?.customerType,
    customer?.demandDescription,
    customer?.background,
    customer?.problemToSolve,
    outlineMarkdown,
    latestLightweightSolution?.outputContent
  ].filter(Boolean).join("\n");
  if (/AI|智能|Agent|RAG|SaaS|互联网|数据|平台|系统/i.test(text)) return "科技蓝绿 / AI 产品感";
  return "现代商务 / 清晰汇报";
}

function trimText(text = "", limit = 4000) {
  const value = String(text || "").replace(/\s+\n/g, "\n").trim();
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

function trimMarkdownForRecord(markdown = "", limit = 1800) {
  const value = String(markdown || "").trim();
  if (value.length <= limit) return value;
  const sliced = value.slice(0, limit);
  const lastBreak = sliced.lastIndexOf("\n\n");
  return `${lastBreak > 320 ? sliced.slice(0, lastBreak) : sliced}...`;
}

function safeJsonParse(text = "") {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: String(text || "") };
  }
}

function queueReportFeedbackJob({ feedbackId, body, actorUser, config }) {
  const jobBody = cloneJobPayload(body);
  const jobActor = { id: actorUser.id, name: actorUser.name, role: actorUser.role };
  if (isServerlessRuntime()) {
    return invokeNetlifyImageBackgroundJob({
      kind: "report_feedback",
      recordId: feedbackId,
      body: jobBody,
      actorUser: jobActor,
      config
    }).catch(async (error) => markReportFeedbackJobFailed({
      feedbackId,
      errorText: `提交 Netlify 报告反馈后台任务失败：${error.message || "未知错误"}`
    }));
  }
  setTimeout(() => {
    void runReportFeedbackJob({ feedbackId, body: jobBody, actorUser: jobActor, config })
      .catch(async (error) => markReportFeedbackJobFailed({
        feedbackId,
        errorText: error.message || "报告反馈优化失败"
      }).catch((markError) => {
        console.error("failed to mark report feedback job", redactApiError(markError.message || ""));
      }));
  }, 0);
  return Promise.resolve(true);
}

async function runReportFeedbackJob({ feedbackId, body, actorUser, config }) {
  const db = await readCrmDb();
  const sourceRecord = db.aiGenerationRecords.find((item) => item.id === body.recordId);
  if (!sourceRecord) throw new Error("未找到要反馈的 AI 报告");
  const sourceCustomer = sourceRecord.customerId
    ? db.customers.find((item) => item.id === sourceRecord.customerId)
    : null;
  const optimization = await generateReportFeedbackOptimization({
    db,
    record: sourceRecord,
    customer: sourceCustomer,
    feedbackContent: body.feedbackContent,
    actor: actorUser,
    config
  });

  await withCrmDb((nextDb) => {
    const existing = nextDb.reportFeedbacks.find((item) => item.id === feedbackId);
    if (!existing) return null;
    return upsertCollectionItem(nextDb, "reportFeedbacks", {
      ...existing,
      id: feedbackId,
      customerId: sourceCustomer?.id || existing.customerId || "",
      customerName: sourceCustomer?.name || existing.customerName || "默认 AI 工作台",
      recordId: sourceRecord.id,
      recordTitle: sourceRecord.title || existing.recordTitle || "",
      generationType: sourceRecord.generationType || existing.generationType || "",
      userId: actorUser.id,
      userName: actorUser.name || existing.userName || "",
      feedbackContent: body.feedbackContent || existing.feedbackContent || "",
      originalContentPreview: stripMarkdown(sourceRecord.outputContent || "").slice(0, 1600),
      aiOptimizationSuggestion: optimization || "暂无优化建议",
      status: "completed",
      createdAt: existing.createdAt || nowIso(),
      updatedAt: nowIso()
    });
  });
}

async function markReportFeedbackJobFailed({ feedbackId, errorText }) {
  const safeError = redactApiError(errorText || "报告反馈优化失败");
  const finishedAt = nowIso();
  await withCrmDb((db) => {
    const existing = db.reportFeedbacks.find((item) => item.id === feedbackId);
    if (!existing) return null;
    return upsertCollectionItem(db, "reportFeedbacks", {
      ...existing,
      id: feedbackId,
      aiOptimizationSuggestion: [
        "# 报告优化建议",
        "",
        `> 优化失败：${safeError}`,
        "",
        "AI 已先保存反馈内容，稍后可重新打开反馈卡片查看或再次提交。"
      ].join("\n"),
      status: "failed",
      updatedAt: finishedAt
    });
  });
}

function cloneJobPayload(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

async function generateDefaultImagePromptWithFallback({ db, body, actor, config }) {
  const promptPromise = generateCrmContent({
    db,
    type: "default_image_prompt",
    customerId: "",
    skillId: body.skillId,
    userId: body.userId || actor.user.id,
    message: body.message,
    extraContext: {
      conversationHistory: body.extraContext?.conversationHistory || [],
      imageStyle: body.extraContext?.imageStyle || "",
      imageType: body.extraContext?.imageType || "",
      outputTarget: "image2",
      workspaceMode: "default_ai_workspace"
    },
    modelId: body.modelId,
    config
  }).catch((error) => buildFallbackDefaultImageGeneration({
    body,
    reason: `远程提示词生成失败：${redactApiError(error.message || "未知错误")}`
  }));

  return withSoftTimeout(
    promptPromise,
    Number(config.image2PromptTimeoutMs || 25000),
    () => buildFallbackDefaultImageGeneration({
      body,
      reason: `远程提示词生成超过 ${Math.round(Number(config.image2PromptTimeoutMs || 25000) / 1000)} 秒，系统已停止生成，不再使用本地提示词兜底。`
    })
  );
}

function buildFallbackDefaultImageGeneration({ body, reason }) {
  const imagePrompt = buildDeterministicDefaultImagePrompt(body);
  return {
    title: "默认 AI 工作台 - 生图提示词",
    generationType: "default_image_prompt",
    skillId: body.skillId || "skill_21",
    modelName: "系统提示词生成器",
    prompt: "remote default image prompt failed",
    inputContext: {
      isolation: {
        scope: "global_workspace",
        customerId: "",
        rule: "默认 AI 工作台不读取任何客户档案、跟进记录、客户资料或客户记忆。"
      },
      extra: {
        message: body.message || "",
        imageStyle: body.extraContext?.imageStyle || "",
        imageType: body.extraContext?.imageType || "",
        fallbackReason: reason
      }
    },
    outputContent: [
      "# 默认 AI 工作台 - 生图提示词",
      "",
      `> 远程提示词生成未成功，系统已使用稳定的生图提示词构造器继续调用 image2：${reason || "未知原因"}`,
      "",
      "## Image2 提示词",
      "",
      "```text",
      imagePrompt,
      "```"
    ].join("\n"),
    createdAt: nowIso()
  };
}

function buildDeterministicDefaultImagePrompt(body = {}) {
  const message = stripMarkdown(body.message || "").slice(0, 1200) || "AI CRM 产品视觉图";
  const style = body.extraContext?.imageStyle || "简洁专业、现代 SaaS、飞书式信息层级、浅色背景";
  const imageType = body.extraContext?.imageType || "产品设计图";
  return [
    `请生成一张${imageType}，主题：${message}`,
    `视觉风格：${style}。`,
    "画面要求：高保真 UI 设计稿质感，中文界面文案准确，信息层级清晰，留白充足，卡片式布局，圆角、轻阴影、蓝灰色系。",
    "如果主题是 App 或小程序，请优先呈现移动端主界面；如果主题是后台、CRM 或管理系统，请优先呈现桌面端管理后台。",
    "必须包含：顶部标题区、核心功能卡片、数据/流程区域、关键操作按钮和真实业务内容。",
    "避免：乱码中文、低清晰度、过度 3D、无关人物照片、抽象科技海报、杂乱背景。"
  ].join("\n");
}

function shouldRouteToImage2(body, db) {
  if (body.toolMode === "image2" || body.extraContext?.toolMode === "image2") return true;
  const skill = db.skills.find((item) => item.id === body.skillId);
  if (String(skill?.toolType || "").toLowerCase() === "image2") return true;
  return isExplicitImageIntent(body.message);
}

function isExplicitImageIntent(message = "") {
  const text = String(message || "");
  if (/image2|生图/.test(text) && /(生成|画|出|制作|创建|做一张|做个|做一个|帮我|我要|需要)/.test(text)) return true;
  if (/(生成图片|画一张|出图|做一张图|做个图|做一个图)/.test(text)) return true;
  const visualTarget = /(图片|视觉稿|海报|交互图|界面图|产品图|设计图|UI\s*图|原型图)/i;
  const visualAction = /(生成|画|出|设计|制作|创建|产出|做一张|做个|做一个)/;
  const knowledgeQuestion = /(是什么|有哪些|几个|多少|区别|怎么选|介绍|解释|了解|关于|模型|能力|价格|额度|恢复|原理|文档|教程|用法|支持)/;
  if (knowledgeQuestion.test(text) && !/(帮我|给我).{0,8}(生成|画|出|设计|制作|创建)/.test(text)) return false;
  return visualTarget.test(text) && visualAction.test(text);
}

function isUsableDefaultImagePrompt(imagePrompt = "", promptDraft = "") {
  const prompt = String(imagePrompt || "").trim();
  if (prompt.length < 80) return false;
  if (/调用失败|错误摘要|未返回成功结果|API Key|Base URL/i.test(promptDraft)) return false;
  return /图|图片|画面|视觉|海报|界面|构图|image2/i.test(prompt);
}

function buildImagePromptFailureMarkdown({ title, reason, generationType }) {
  const label = GENERATION_LABELS_FOR_SYNC[generationType] || "生图提示词";
  return [
    `# ${title}`,
    "",
    `> ${reason || "远程模型生成提示词失败。系统已停止生成，不再使用本地提示词兜底。"}`,
    "",
    "## 调用状态",
    "",
    "- 状态：生成失败",
    "- 系统没有继续调用 image2，避免用本地猜测提示词生成不准确图片。",
    "- 失败原因已保留在当前历史记录中。",
    "",
    "## 建议处理",
    "",
    "- 检查文本模型的 API Key、Base URL、Model ID 和中转平台权限。",
    `- 修复后重新生成「${label}」。`
  ].join("\n");
}

function buildChatProcessPlan({ body = {}, db }) {
  const message = String(body.message || "").trim();
  const customer = body.customerId ? db.customers.find((item) => item.id === body.customerId) || null : null;
  const rawSkill = body.skillId ? db.skills.find((item) => item.id === body.skillId && item.status !== "disabled") || null : null;
  const referencedCustomer = !customer && body.extraContext?.referencedCustomerId
    ? db.customers.find((item) => item.id === body.extraContext.referencedCustomerId) || null
    : null;
  const usesImage2 = !body.customerId && shouldRouteToImage2(body, db);
  const isSimple = !rawSkill && isSimpleChatQuery(message) && !usesImage2;
  const defaultIntent = classifyDefaultWorkspaceIntent(message);
  const skill = isSimple ? null : rawSkill;
  const usedRag = Boolean(
    /知识库|RAG|资料|案例|方案库|历史方案|文档|切片|检索/.test(message)
    || body.extraContext?.useKnowledgeBase
    || body.extraContext?.knowledgeBaseId
  );
  const usedTool = Boolean(skill || usesImage2 || body.toolMode || usedRag);
  const metadata = {
    complexity: isSimple ? "simple" : usesImage2 ? "tool" : usedTool ? "complex" : "complex",
    used_skill: Boolean(skill),
    used_rag: usedRag,
    used_tool: usedTool,
    customer_context: Boolean(customer),
    referenced_customer_context: Boolean(referencedCustomer),
    referenced_customer_id: referencedCustomer?.id || "",
    referenced_customer_name: referencedCustomer?.name || "",
    image_job: usesImage2,
    default_intent: !customer && !referencedCustomer ? defaultIntent?.key || "" : "",
    default_intent_label: !customer && !referencedCustomer ? defaultIntent?.label || "" : "",
    customer_intent: customer ? defaultIntent?.key || "" : "",
    customer_intent_label: customer ? defaultIntent?.label || "" : ""
  };

  if (isSimple) {
    return {
      metadata,
      steps: []
    };
  }

  if (usesImage2) {
    return {
      metadata,
      steps: [
        buildProcessStep("step_1", "Router 意图识别", "识别为 image2 生图任务", "将用户输入识别为图片、视觉稿、交互图或产品图生成请求。"),
        buildProcessStep("step_2", "Planner 任务规划", "规划图片生成路径", "提炼图片用途、画面主题、设备类型、风格、比例和禁止项。"),
        buildProcessStep("step_3", "Executor 工具执行", "调用 image2 后台任务", "将稳定提示词交给 image2 云端服务，等待生成结果。"),
        buildProcessStep("step_4", "Reflector 结果整理", "整理图片结果与说明", "返回生成图片、提示词、下载入口和后续修改入口。")
      ]
    };
  }

  if (skill) {
    return {
      metadata,
      steps: [
        buildProcessStep("step_1", "Router 意图识别", "识别为 Skill 任务", customer ? `当前客户：${customer.name}` : "当前是默认 AI 工作台任务。"),
        buildProcessStep("step_2", "Planner 任务规划", "规划 Skill 执行路径", `已匹配 Skill：${skill.name}。`),
        buildProcessStep("step_3", customer ? "Context 上下文关联" : "Retriever 工作台检索", customer ? "读取客户基础信息、跟进记录、资料解析和客户记忆。" : "读取默认工作台、Skill 配置、知识库命中和全局生成历史。"),
        buildProcessStep("step_4", "Executor/Reflector 输出", "执行 Skill 并校验结果", skill.description || "调用匹配 Skill 生成可直接使用的结果，并校验输出可执行性。")
      ]
    };
  }

  if (referencedCustomer) {
    return {
      metadata,
      steps: [
        buildProcessStep("step_1", "Router 意图识别", "识别默认对话输入", "当前未手动选择客户，但输入命中了客户信息。"),
        buildProcessStep("step_2", "Planner 任务规划", `规划围绕「${referencedCustomer.name}」回答`, "将默认 Agent 的通用能力切换到单一客户隔离上下文。"),
        buildProcessStep("step_3", "Context 上下文关联", `已命中客户：${referencedCustomer.name}`, "系统只读取该客户的档案、跟进记录、资料解析和客户记忆，不混用其他客户。"),
        buildProcessStep("step_4", "Executor/Reflector 输出", "融合客户上下文回答", "正文只保留结论、建议、文档或话术，并校验客户事实边界。")
      ]
    };
  }

  if (customer) {
    return {
      metadata,
      steps: [
        buildProcessStep("step_1", "Router 意图识别", "识别客户问题", `客户：${customer.name} · 阶段：${getStageName(db, customer.stage)}`),
        buildProcessStep("step_2", "Planner 任务规划", "规划客户分析路径", "确定要输出客户判断、推进建议、沟通问题、材料建议或方案文档。"),
        buildProcessStep("step_3", "Context 上下文关联", "读取资料与跟进记录", "优先使用当前客户的档案、跟进记录、资料解析、生成历史和客户记忆。"),
        buildProcessStep("step_4", "Executor/Reflector 输出", "输出销售可用内容", "整理成可直接用于客户沟通的建议，并校验客户间记忆隔离。")
      ]
    };
  }

  if (defaultIntent?.key === "customer_work") {
    return {
      metadata,
      steps: [
        buildProcessStep("step_1", "Router 意图识别", "识别为客户推进任务", defaultIntent.reason || "输入要求分析当前负责或手上的客户。"),
        buildProcessStep("step_2", "Planner 任务规划", "规划客户集合分析路径", "确定要比较客户阶段、推进阻塞、失败原因、优先级和下一步动作。"),
        buildProcessStep("step_3", "Context 上下文关联", "读取 CRM 客户数据", "读取当前用户负责的客户档案、跟进记录、资料解析、客户记忆和历史 AI 输出。"),
        buildProcessStep("step_4", "Executor/Reflector 输出", "融合客户上下文回答", "输出可直接用于推进的客户判断和行动建议，并校验事实边界。")
      ]
    };
  }

  return {
    metadata,
    steps: [
      buildProcessStep("step_1", "Router 意图识别", `识别为${defaultIntent?.label || "默认工作台任务"}`, defaultIntent?.reason || "识别用户希望我完成的输出类型与目标。"),
      buildProcessStep("step_2", "Planner 任务规划", "规划执行路径", defaultIntent?.outputHint || "根据任务判断是否进入知识库、联网、Skill 或生图流程。"),
      buildProcessStep("step_3", "Scheduler 工具调度", "判断上下文与工具", defaultIntent?.toolHint || "按需调用默认 Agent、RAG、联网或 Skill 结果。"),
      buildProcessStep("step_4", "Executor/Reflector 输出", "生成并校验最终结果", "把过程收束为自然语言答案、表格、文档或下一步动作，并检查假设、风险和待确认信息。")
    ]
  };
}

function isSimpleChatQuery(message = "") {
  const text = String(message || "").trim();
  if (!text) return true;
  if (text.length <= 8 && /^(hi|hello|hey|嗨|哈喽|你好|你好呀|嗨呀|在吗|在不|有人吗|早上好|下午好|晚上好)$/i.test(text)) return true;
  if (/^(谢谢|辛苦了|好的|收到|ok|okay|ok了|明白了|了解了|拜拜|再见)$/i.test(text)) return true;
  if (/^(你是谁|你能做什么|你可以做什么|怎么用|怎么使用)$/.test(text)) return true;
  if (/^[\p{P}\p{S}\s]+$/u.test(text)) return true;
  if (text.length <= 12 && !/(客户|方案|需求|跟进|分析|生成|报价|技能|skill|知识库|RAG|图片|交互图|PPT|总结|复盘|阶段|会话|文档|报告|业务|项目)/i.test(text)) return true;
  return false;
}

function buildRuntimeStreamConfig(config = {}, body = {}, processPlan = {}) {
  if (!isServerlessRuntime() || String(body.type || "chat") !== "chat") {
    return config;
  }

  const intent = processPlan?.metadata?.default_intent || "";
  const isOpenDocumentTask = !body.customerId && !body.skillId && intent === "document_generation";
  const chatContextMaxChars = Math.min(Number(config.aiContextMaxChars || 16000), isOpenDocumentTask ? 6500 : 9000);
  const chatPromptMaxChars = Math.min(Number(config.aiPromptMaxChars || 22000), isOpenDocumentTask ? 10000 : 14000);
  const chatOutputMaxTokens = Math.min(Number(config.aiOutputMaxTokens || 2800), isOpenDocumentTask ? 1800 : 1800);
  const longReportMaxTokens = Math.min(Number(config.aiLongReportMaxTokens || 6200), isOpenDocumentTask ? 1800 : 3600);
  const chatTimeoutMs = Math.min(Number(config.openaiTimeoutMs || 60000), 60000);

  return {
    ...config,
    aiContextMaxChars: chatContextMaxChars,
    aiPromptMaxChars: chatPromptMaxChars,
    aiOutputMaxTokens: chatOutputMaxTokens,
    aiLongReportMaxTokens: longReportMaxTokens,
    openaiTimeoutMs: chatTimeoutMs
  };
}

function resolveRemoteDefaultWorkspaceGenerationType(body = {}, processPlan = {}) {
  if (String(body.type || "chat") !== "chat") return body.type || "chat";
  if (body.customerId || body.skillId) return body.type || "chat";
  const intent = processPlan?.metadata?.default_intent || "";
  if (intent === "document_generation") return "requirement_document";
  return body.type || "chat";
}

function isServerlessRuntime() {
  const cwd = process.cwd();
  return Boolean(
    process.env.JIMU_SERVERLESS_RUNTIME
    || process.env.NETLIFY
    || process.env.AWS_LAMBDA_FUNCTION_NAME
    || process.env.AWS_EXECUTION_ENV
    || cwd.includes("/var/task")
  );
}

function shouldUseServerlessQuickCustomerChat(body = {}, processPlan = {}) {
  if (!isServerlessRuntime()) return false;
  if (String(body.type || "chat") !== "chat") return false;
  if (!body.customerId) return false;
  if (body.skillId) return false;
  if (body.toolMode || body.extraContext?.toolMode === "image2") return false;
  if (processPlan?.metadata?.used_skill || processPlan?.metadata?.used_tool || processPlan?.metadata?.used_rag) return false;
  const message = String(body.message || "").trim();
  return isCustomerQuickAnalysisIntent(message);
}

function shouldUseServerlessQuickDefaultWorkspaceChat(body = {}, processPlan = {}) {
  if (!isServerlessRuntime()) return false;
  if (String(body.type || "chat") !== "chat") return false;
  if (body.customerId) return false;
  if (body.skillId) return false;
  if (body.toolMode || body.extraContext?.toolMode === "image2") return false;
  if (processPlan?.metadata?.image_job) return false;
  return processPlan?.metadata?.default_intent === "customer_work";
}

function shouldQueueServerlessDefaultDocumentChat(body = {}, processPlan = {}) {
  if (!isServerlessRuntime()) return false;
  if (String(body.type || "chat") !== "chat") return false;
  if (body.customerId) return false;
  if (body.skillId) return false;
  if (body.toolMode || body.extraContext?.toolMode === "image2") return false;
  if (processPlan?.metadata?.image_job) return false;
  return processPlan?.metadata?.default_intent === "document_generation";
}

function shouldUseServerlessQuickCustomerDocumentChat(body = {}, processPlan = {}) {
  if (!isServerlessRuntime()) return false;
  if (String(body.type || "chat") !== "chat") return false;
  if (!body.customerId) return false;
  if (body.skillId) return false;
  if (body.toolMode || body.extraContext?.toolMode === "image2") return false;
  if (processPlan?.metadata?.used_skill || processPlan?.metadata?.image_job) return false;
  return isDefaultWorkspaceDocumentIntent(body.message);
}

function buildServerlessDefaultWorkspaceChatGeneration({ db, body = {}, actor, processPlan = {} }) {
  const message = String(body.message || "").trim();
  const intent = processPlan?.metadata?.default_intent || classifyDefaultWorkspaceIntent(message).key;
  const attachmentContext = buildChatAttachmentContext(body.extraContext?.chatAttachments || []);
  const markdown = buildDefaultWorkspaceMarkdown({
    db,
    body,
    actor,
    intent,
    attachmentContext
  });

  return {
    title: "默认 AI 对话",
    generationType: "chat",
    skillId: "",
    modelName: "AICRM 默认 Agent 快速生成",
    prompt: "serverless_default_workspace_fast_path",
    inputContext: {
      messageType: "ai_response",
      process: (processPlan.steps || []).map((step) => ({ ...step, status: "done" })),
      metadata: {
        ...(processPlan.metadata || {}),
        serverless_fast_path: true
      },
      defaultWorkspace: {
        intent,
        userGoal: message,
        generatedBy: actor.user.id,
        attachmentCount: attachmentContext.attachments.length,
        note: "默认工作台快速路径，不读取任何客户档案。"
      }
    },
    outputContent: markdown,
    createdAt: nowIso()
  };
}

function buildDefaultWorkspaceMarkdown({ db, body = {}, actor, intent, attachmentContext }) {
  const message = String(body.message || "").trim();
  if (attachmentContext.attachments.length) {
    return buildAttachmentAwareMarkdown({ message, intent, attachmentContext });
  }
  if (intent === "customer_work") return buildDefaultCustomerPortfolioMarkdown({ db, actor, message });
  if (intent === "planning") return buildDefaultPlanningMarkdown(message);
  if (intent === "document_generation") return buildDefaultDocumentMarkdown(message);
  if (intent === "work_analysis") return buildDefaultWorkAnalysisMarkdown({ db, actor, message });
  return buildDefaultGeneralChatMarkdown(message);
}

function buildChatAttachmentContext(attachments = []) {
  const normalized = normalizeKnowledgeBaseDocuments([], Array.isArray(attachments) ? attachments : []);
  const parsed = normalized.map((doc) => {
    const chunks = Array.isArray(doc.chunks) ? doc.chunks : [];
    const text = chunks.map((chunk) => String(chunk.text || "").trim()).filter(Boolean).join("\n\n")
      || doc.parsedTextPreview
      || "";
    return {
      fileName: doc.fileName || "未命名文件",
      fileType: doc.fileType || "file",
      mimeType: doc.mimeType || "",
      size: Number(doc.size || 0),
      parser: doc.parser || "",
      text: stripMarkdown(text).slice(0, 12000)
    };
  }).filter((doc) => doc.text);
  return {
    attachments: parsed,
    combinedText: parsed.map((doc) => `# ${doc.fileName}\n${doc.text}`).join("\n\n---\n\n").slice(0, 24000)
  };
}

function buildAttachmentAwareMarkdown({ message = "", intent = "", attachmentContext }) {
  const files = attachmentContext.attachments || [];
  const summaries = files.map((file, index) => {
    const plain = file.text.replace(/\s+/g, " ").trim();
    return `${index + 1}. ${file.fileName}（${file.parser || file.fileType || "文本解析"}）：${plain.slice(0, 520)}${plain.length > 520 ? "..." : ""}`;
  }).join("\n");
  const requested = message || "请分析附件内容";
  const outputMode = intent === "document_generation" ? "需求/文档输出" : intent === "planning" ? "计划拆解" : "内容分析";
  return [
    `# 基于附件的${outputMode}`,
    "",
    "## 1. 本轮输入",
    "",
    `- 用户要求：${requested}`,
    `- 附件数量：${files.length}`,
    "",
    "## 2. 附件解析摘要",
    "",
    summaries || "- 附件已上传，但未解析出可用文本。",
    "",
    "## 3. 关键结论",
    "",
    ...buildAttachmentConclusions(attachmentContext.combinedText, requested),
    "",
    "## 4. 建议下一步",
    "",
    "- 如果要形成正式文档，可以继续要求我按 PRD、需求清单、方案大纲或会议纪要格式重排。",
    "- 如果附件里有表格或多份资料，建议指定关注字段、业务范围或输出粒度。",
    "- 如果需要保存到客户档案，请先选择客户，再让我把本轮内容沉淀为客户资料或方案。"
  ].join("\n");
}

function buildAttachmentConclusions(text = "", requested = "") {
  const plain = stripMarkdown(text).replace(/\s+/g, " ").trim();
  if (!plain) return ["- 暂未解析到可分析的正文。"];
  const hasRequirement = /需求|功能|模块|流程|角色|页面|接口|验收|范围/.test(plain + requested);
  const hasWork = /今日|今天|工作|任务|完成|计划|待办|会议|客户|跟进/.test(plain + requested);
  if (hasRequirement) {
    return [
      "- 附件中已经包含可拆解为需求清单的业务信息，建议优先按角色、流程、模块、数据和验收标准整理。",
      "- 需要进一步确认一期 MVP 范围、必须上线端口、第三方接口、权限边界和验收口径。",
      "- 高风险点通常集中在数据来源、状态流转、支付/消息/外部系统对接、以及后台权限配置。"
    ];
  }
  if (hasWork) {
    return [
      "- 可以把附件内容按已完成、进行中、阻塞项和明日优先级四类整理。",
      "- 建议先识别真正影响交付或客户推进的事项，再把零散任务收敛成 3 到 5 个重点。",
      "- 如果需要复盘效率，可以继续补充时间线、会议记录或待办列表。"
    ];
  }
  return [
    `- 附件核心内容集中在：${plain.slice(0, 180)}${plain.length > 180 ? "..." : ""}`,
    "- 建议先明确你希望输出摘要、清单、方案、纪要还是风险分析。",
    "- 如需更精确分析，可以继续补充目标受众和使用场景。"
  ];
}

function buildServerlessCustomerDocumentChatGeneration({ db, body, actor, processPlan }) {
  const customer = db.customers.find((item) => item.id === body.customerId) || null;
  const follows = customer
    ? db.followRecords
      .filter((item) => item.customerId === customer.id)
      .sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt))
      .slice(0, 8)
    : [];
  const files = customer
    ? db.customerFiles
      .filter((item) => item.customerId === customer.id && item.parsedText)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 5)
    : [];
  const latestGenerations = customer
    ? db.aiGenerationRecords
      .filter((item) => item.customerId === customer.id)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 4)
    : [];
  const markdown = buildCustomerRequirementDocumentMarkdown({
    db,
    customer,
    follows,
    files,
    latestGenerations,
    message: body.message
  });

  return {
    title: `${customer?.name || "客户"} - 需求文档`,
    generationType: "chat",
    skillId: "",
    modelName: "AICRM 客户上下文文档生成",
    prompt: "serverless_customer_document_fast_path",
    inputContext: {
      messageType: "ai_response",
      process: processPlan.steps.map((step) => ({ ...step, status: "done" })),
      metadata: {
        ...processPlan.metadata,
        serverless_fast_path: true,
        document_intent: classifyDefaultWorkspaceIntent(body.message).key
      },
      customerDocument: {
        customerId: customer?.id || "",
        customerName: customer?.name || "",
        stage: customer ? getStageName(db, customer.stage) : "",
        followRecordCount: follows.length,
        fileCount: files.length,
        generationCount: latestGenerations.length,
        generatedBy: actor.user.id
      }
    },
    outputContent: markdown,
    createdAt: nowIso()
  };
}

function buildCustomerRequirementDocumentMarkdown({ db, customer, follows = [], files = [], latestGenerations = [], message = "" }) {
  const stageName = customer ? getStageName(db, customer.stage) : "未设置阶段";
  const demand = firstNonEmpty([
    customer?.demandDescription,
    customer?.background,
    files.map((file) => stripMarkdown(file.parsedText || "").slice(0, 220)).join("\n")
  ]) || "客户需求资料仍需补充，以下按当前客户档案和阶段输出可沟通初稿。";
  const isQualityInspection = /质检|检测|视觉|摄像头|产线|工厂|制造|MES|异常/i.test([
    customer?.name,
    customer?.customerType,
    customer?.demandDescription,
    customer?.background,
    message
  ].filter(Boolean).join(" "));
  const modules = isQualityInspection
    ? [
      ["数据采集接入", "接入产线摄像头、图片/视频采集、质检工位、MES 或现有业务系统数据。"],
      ["样本与标注管理", "沉淀合格/缺陷样本、缺陷类型、标注规则、训练集与验证集管理。"],
      ["AI 质检识别", "按产品、工位、缺陷类型配置检测模型，输出缺陷定位、置信度和判定结果。"],
      ["异常预警闭环", "对疑似缺陷、连续异常、设备波动进行提醒，并记录处理结果。"],
      ["质检看板", "展示质检通过率、缺陷分布、工位趋势、批次问题和人工复核结果。"],
      ["后台管理", "管理账号权限、产品型号、检测规则、工位配置、日志和基础数据。"]
    ]
    : [
      ["业务资料管理", "管理客户业务对象、资料、附件、状态和基础配置。"],
      ["核心流程处理", "支持业务提交、审核、流转、反馈和结果记录。"],
      ["AI 辅助分析", "围绕资料总结、风险识别、内容生成、智能问答提供辅助能力。"],
      ["数据看板", "展示关键指标、进度、状态分布和异常提醒。"],
      ["后台管理", "管理账号权限、字典配置、操作日志和系统参数。"]
    ];
  const followSummary = summarizeRecentFollowRecords(follows) || "- 暂无跟进记录，建议先补充最近一次沟通内容。";
  const fileSummary = files.length
    ? files.map((file) => `- ${file.fileName}：${stripMarkdown(file.parsedText || "").slice(0, 260)}`).join("\n")
    : "- 暂无已解析客户资料。";
  const generationSummary = latestGenerations.length
    ? latestGenerations.map((item) => `- ${item.title || item.generationType || "AI 生成"}：${stripMarkdown(item.outputContent || "").slice(0, 180)}`).join("\n")
    : "- 暂无历史 AI 生成内容。";

  return [
    `# ${customer?.name || "客户"}需求文档`,
    "",
    "## 1. 文档说明",
    "",
    "本文档基于当前客户档案、跟进记录、资料解析和历史 AI 生成内容整理，用于内部售前沟通、需求澄清和方案深化。若客户尚未确认范围，本文档应作为 V1 初稿继续向客户核对。",
    "",
    "## 2. 客户基础信息",
    "",
    `- 客户名称：${customer?.name || "待确认"}`,
    `- 客户类型：${customer?.customerType || "待确认"}`,
    `- 客户来源：${customer?.source || "待确认"}`,
    `- 当前阶段：${stageName}`,
    `- 当前状态：${customer?.status || "待确认"}`,
    `- 负责人：${customer?.ownerName || "待确认"}`,
    `- 预计金额：${customer?.estimatedAmount || "待确认"}`,
    `- 成交概率：${customer?.dealProbability || "待确认"}`,
    "",
    "## 3. 项目背景",
    "",
    customer?.background || demand,
    "",
    "## 4. 客户原始需求",
    "",
    customer?.demandDescription || demand,
    "",
    "## 5. 已知业务基础与约束",
    "",
    `- 预算情况：${customer?.budgetInfo || "待确认"}`,
    `- 决策链信息：${customer?.decisionInfo || "待确认"}`,
    `- 当前风险：${customer?.riskInfo || customer?.knownRisk || "待确认"}`,
    `- 内部备注：${customer?.internalNotes || "暂无"}`,
    "",
    "## 6. 跟进记录摘要",
    "",
    followSummary,
    "",
    "## 7. 客户资料摘要",
    "",
    fileSummary,
    "",
    "## 8. 历史 AI 生成参考",
    "",
    generationSummary,
    "",
    "## 9. 项目目标",
    "",
    "- 明确客户当前业务痛点和一期必须落地的核心范围。",
    `- ${isQualityInspection ? "通过 AI 识别、异常预警和质检数据闭环，降低人工抽检压力并提升质检稳定性。" : "通过系统化建设打通核心业务流程，降低人工沟通和重复处理成本。"}`,
    "- 建立可持续沉淀的数据基础，为后续模型优化、运营分析和二期扩展提供依据。",
    "- 控制一期范围，优先交付能验证价值的 MVP。",
    "",
    "## 10. 功能需求",
    "",
    "| 模块 | 功能范围 |",
    "| --- | --- |",
    ...modules.map(([module, scope]) => `| ${module} | ${scope} |`),
    "",
    "## 11. AI 融入点",
    "",
    isQualityInspection
      ? "- 缺陷识别：基于图片或视频帧识别缺陷类型、位置和置信度。\n- 异常判断：结合工位、批次、时间趋势判断异常是否需要人工复核。\n- 质检总结：自动汇总缺陷分布、批次问题和改进建议。\n- 知识沉淀：沉淀缺陷样本、处理经验和复盘结论，辅助后续模型迭代。"
      : "- 资料总结：对客户资料、沟通记录和业务文档做结构化摘要。\n- 智能问答：围绕业务制度、项目资料和历史方案进行检索问答。\n- 内容生成：生成需求分析、方案大纲、沟通话术和跟进计划。\n- 风险提醒：识别范围不清、预算不明、决策链缺失等推进风险。",
    "",
    "## 12. MVP 一期范围建议",
    "",
    isQualityInspection
      ? "- 接入 1 到 2 条代表性产线或工位。\n- 聚焦 2 到 4 类高频或高价值缺陷。\n- 完成样本管理、模型检测、人工复核、异常记录和基础看板。\n- 暂不把所有产品型号、全部工位和复杂 MES 深度集成一次性纳入。"
      : "- 跑通核心业务流程和最关键的数据对象。\n- 完成基础后台、权限、附件、日志和数据看板。\n- AI 能力先接入资料总结、内容生成和风险提示。\n- 暂不把复杂审批、深度 BI 和多系统集成一次性纳入。",
    "",
    "## 13. 非功能需求",
    "",
    "- 稳定性：关键页面和接口应可长期稳定使用，异常时有明确提示和日志。",
    "- 安全性：内部账号权限隔离，客户资料和生成内容不得跨客户混用。",
    "- 可扩展性：阶段、字段、Skill、模型和知识库需要可配置。",
    "- 可追溯性：跟进记录、AI 生成结果、资料解析和客户记忆需要留痕。",
    "",
    "## 14. 待确认问题",
    "",
    isQualityInspection
      ? "- 当前优先检测的产品型号、工位和缺陷类型分别是什么？\n- 是否已有稳定采集的图片/视频样本，样本量和标注质量如何？\n- AI 判定结果是辅助人工复核，还是要直接联动产线动作？\n- MES、摄像头、工控机、看板系统分别由谁负责对接？\n- 一期验收指标是准确率、漏检率、误检率、效率提升，还是成本下降？"
      : "- 一期必须上线的角色、流程和页面有哪些？\n- 当前已有系统、数据和文档分别是什么状态？\n- 是否需要对接第三方系统、支付、消息、企业微信或飞书？\n- 预算、排期、验收标准和决策人是否已经明确？\n- AI 输出结果是否需要人工审核后才能进入正式档案？",
    "",
    "## 15. 下一步建议",
    "",
    "- 用本文档与客户进行一次需求核对会议。",
    "- 会前让客户补充样本资料、业务流程图、现有系统清单和验收指标。",
    "- 会后输出功能清单、MVP 范围、实施计划和报价边界。",
    "- 若客户确认方向，再进入方案大纲或售前 PPT 结构生成。"
  ].join("\n");
}

function buildDefaultDocumentMarkdown(message = "") {
  const target = inferDocumentTarget(message);
  const isMall = /商城|电商|购物|商品|订单|支付|购物车/.test(message);
  const projectName = isMall ? "商城系统" : target.projectName;
  const userRoles = isMall
    ? ["消费者/会员", "商家或运营人员", "平台管理员", "客服人员"]
    : ["终端用户", "业务人员", "管理员", "运营人员"];
  const modules = isMall
    ? [
      ["用户端", "注册登录、首页推荐、商品搜索、商品详情、购物车、下单支付、订单跟踪、售后申请、会员中心"],
      ["运营后台", "商品管理、分类管理、订单管理、库存管理、营销活动、优惠券、会员管理、售后处理、数据看板"],
      ["基础能力", "权限管理、消息通知、支付配置、物流配置、内容配置、操作日志"],
      ["AI 可选能力", "商品文案生成、智能客服、用户偏好推荐、评论摘要、经营数据分析"]
    ]
    : [
      ["用户端", "注册登录、信息浏览、核心业务提交、状态查看、消息通知、个人中心"],
      ["业务后台", "数据管理、流程审核、内容配置、用户管理、统计分析"],
      ["基础能力", "权限管理、附件管理、日志记录、系统配置、消息通知"],
      ["AI 可选能力", "资料总结、智能问答、内容生成、风险提醒、数据洞察"]
    ];

  return [
    `# ${projectName}需求文档`,
    "",
    "## 1. 项目背景",
    "",
    `${projectName}用于承接线上业务的展示、交易、运营和管理流程。当前需求描述较简略，以下先按通用软件定制项目输出一版可沟通的需求文档初稿，后续可根据业务模式、用户角色、支付/物流/库存边界继续细化。`,
    "",
    "## 2. 项目目标",
    "",
    "- 建立清晰的用户使用路径，让用户可以完成从浏览、选择、提交到结果查看的完整闭环。",
    "- 建立运营后台，让内部人员可以管理核心数据、业务状态、内容配置和运营活动。",
    "- 沉淀订单、用户、商品/内容、售后等关键业务数据，为后续运营分析和 AI 能力接入打基础。",
    "- 一期优先跑通核心业务闭环，二期再扩展营销、精细化运营和 AI 增强能力。",
    "",
    "## 3. 用户角色",
    "",
    userRoles.map((role) => `- ${role}`).join("\n"),
    "",
    "## 4. 核心业务流程",
    "",
    isMall
      ? "用户进入商城 -> 浏览/搜索商品 -> 查看商品详情 -> 加入购物车或立即购买 -> 提交订单 -> 支付 -> 商家/平台处理订单 -> 物流/履约 -> 用户确认收货 -> 售后/评价。"
      : "用户进入系统 -> 浏览信息 -> 提交业务请求 -> 后台处理 -> 状态流转 -> 用户查看结果 -> 运营人员沉淀数据并持续优化。",
    "",
    "## 5. 功能需求",
    "",
    "| 模块 | 功能范围 |",
    "| --- | --- |",
    ...modules.map(([module, scope]) => `| ${module} | ${scope} |`),
    "",
    "## 6. MVP 一期范围建议",
    "",
    "- 用户登录/注册或手机号快捷登录。",
    `- ${isMall ? "商品列表、商品详情、购物车、下单支付、订单列表。" : "核心信息列表、详情、提交入口、状态查看。"}`,
    `- ${isMall ? "后台商品管理、订单管理、基础运营配置。" : "后台数据管理、流程处理、用户管理和基础配置。"}`,
    "- 基础权限、操作日志、消息通知。",
    "- 数据统计先做基础看板，不建议一期做过复杂的 BI。",
    "",
    "## 7. 非功能需求",
    "",
    "- 性能：常用页面首屏加载应保持流畅，列表支持分页和条件筛选。",
    "- 安全：后台必须有账号权限控制，关键操作需要日志留痕。",
    "- 可扩展：核心业务对象、状态流转、支付/通知/物流等能力应预留扩展点。",
    "- 可维护：后台配置项、基础字典、内容数据应可视化维护。",
    "",
    "## 8. 待确认问题",
    "",
    "- 商城是自营、平台招商、多商户，还是单品牌商城？",
    "- 是否需要微信/支付宝支付、退款、发票、优惠券、积分、会员等级？",
    "- 是否涉及真实库存、ERP、WMS、物流接口或第三方商品库？",
    "- 一期是否必须支持小程序、H5、Web 管理后台，还是只做其中一部分？",
    "- 订单状态、售后规则、发货方式、退款规则分别是什么？",
    "- 是否需要接入 AI 客服、商品文案生成、推荐或经营分析？",
    "",
    "## 9. 下一步建议",
    "",
    "- 先确认业务模式和一期端口范围。",
    "- 再输出一版功能清单和页面结构。",
    "- 确认支付、物流、库存、售后这些高风险边界。",
    "- 之后再进入原型、排期和报价。"
  ].join("\n");
}

function buildDefaultPlanningMarkdown(message = "") {
  return [
    "# 执行规划",
    "",
    "## 1. 目标理解",
    "",
    `当前目标：${message || "待补充"}`,
    "",
    "## 2. 执行阶段",
    "",
    "- 阶段一：明确目标、范围、角色和成功标准。",
    "- 阶段二：梳理核心流程、关键页面、数据对象和系统边界。",
    "- 阶段三：形成 MVP 范围、任务拆解、排期和风险清单。",
    "- 阶段四：确认交付物、验收标准和下一步责任人。",
    "",
    "## 3. 待确认事项",
    "",
    "- 这份规划是给内部执行，还是给客户沟通？",
    "- 是否已有业务背景、资料、预算和时间要求？",
    "- 是否需要输出成 PRD、方案大纲、PPT 结构或任务表？"
  ].join("\n");
}

function inferDocumentTarget(message = "") {
  if (/商城|电商|购物|商品/.test(message)) return { projectName: "商城系统" };
  if (/CRM|客户管理/i.test(message)) return { projectName: "CRM 系统" };
  if (/知识库|问答|RAG/i.test(message)) return { projectName: "AI 知识库系统" };
  if (/小程序/.test(message)) return { projectName: "小程序系统" };
  if (/App|APP|移动端/.test(message)) return { projectName: "移动端应用" };
  return { projectName: "业务系统" };
}

function isCustomerQuickAnalysisIntent(message = "") {
  const text = String(message || "").trim();
  if (!text) return false;
  return /分析一下这个客户|分析这个客户|帮我分析这个客户|这个客户.*怎么跟进|下一步怎么跟进|客户.*下一步|客户.*分析|跟进建议|推进建议|该怎么跟进/.test(text);
}

function buildServerlessQuickCustomerChatGeneration({ db, body, actor, processPlan }) {
  const customer = db.customers.find((item) => item.id === body.customerId) || null;
  const follows = customer
    ? db.followRecords
      .filter((item) => item.customerId === customer.id)
      .sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt))
      .slice(0, 5)
    : [];
  const latestAdvice = customer
    ? db.aiGenerationRecords
      .filter((item) => item.customerId === customer.id)
      .filter((item) => item.generationType === "consultation_advice" || item.generationType === "follow_strategy" || item.generationType === "next_communication_question_list")
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null
    : null;
  const latestMemory = customer
    ? db.customerMemories
      .filter((item) => item.customerId === customer.id && item.status !== "disabled")
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0] || null
    : null;
  const latestFiles = customer
    ? db.customerFiles.filter((item) => item.customerId === customer.id && item.parsedText).slice(0, 3)
    : [];
  const stageName = customer ? getStageName(db, customer.stage) : "未设置阶段";
  const followSummary = summarizeRecentFollowRecords(follows);
  const adviceSummary = latestAdvice ? stripMarkdown(latestAdvice.outputContent || "").slice(0, 1200) : "暂无历史分析记录";
  const memorySummary = latestMemory ? stripMarkdown(latestMemory.content || "").slice(0, 400) : "暂无客户记忆";
  const fileSummary = latestFiles.length
    ? latestFiles.map((file) => `- ${file.fileName}：${stripMarkdown(file.parsedText || "").slice(0, 240)}`).join("\n")
    : "- 暂无上传资料";

  const markdown = [
    `# ${customer?.name || "客户"} 跟进建议`,
    "",
    "## 结论",
    "",
    `这个客户当前处于 **${stageName}**，建议先围绕现有业务基础、历史跟进记录和资料内容继续推进，不要直接扩展到过大的范围。`,
    "",
    "## 当前判断",
    "",
    `- 客户名称：${customer?.name || "待确认"}`,
    `- 客户类型：${customer?.customerType || "待确认"}`,
    `- 当前阶段：${stageName}`,
    `- 负责人：${customer?.ownerName || "待确认"}`,
    `- 预算信息：${customer?.budgetInfo || "待确认"}`,
    "",
    "## 历史跟进摘要",
    "",
    followSummary || "- 暂无可用跟进记录",
    "",
    "## 最近一次前期咨询/方案判断",
    "",
    adviceSummary,
    "",
    "## 客户记忆",
    "",
    memorySummary,
    "",
    "## 客户资料",
    "",
    fileSummary,
    "",
    "## 建议动作",
    "",
    "- 下一步建议先确认客户最关心的业务结果和必须落地的范围。",
    "- 如果当前资料与历史记录存在不一致，以最新客户信息为准。",
    "- 先推动一次范围收敛的沟通，再决定是否进入方案深化或报价。",
    "- 如需更完整的方案，可以继续生成「前期咨询回应策略报告」或「需求深化方案」。",
    "",
    "## 推荐提问方向",
    "",
    "- 这次项目里最想先解决的核心问题是什么？",
    "- 当前已有的系统、流程和资料里，哪部分已经准备好？",
    "- 这次推进最重要的决策人和确认节点是谁？",
    "- 一期最小可落地范围希望怎么定义？"
  ].join("\n");

  return {
    title: `${customer?.name || "客户"} - AI 对话`,
    generationType: "chat",
    skillId: "",
    modelName: "AICRM 客户快速分析",
    prompt: "serverless_customer_quick_analysis",
    inputContext: {
      messageType: "ai_response",
      process: processPlan.steps.map((step) => ({ ...step, status: "done" })),
      metadata: {
        ...processPlan.metadata,
        serverless_fast_path: true
      },
      quickAnalysis: {
        customerId: customer?.id || "",
        customerName: customer?.name || "",
        stage: stageName,
        generatedBy: actor.user.id
      }
    },
    outputContent: markdown,
    createdAt: nowIso()
  };
}

function summarizeRecentFollowRecords(records = []) {
  if (!records.length) return "";
  const lines = [];
  for (const item of records) {
    lines.push(`- ${item.followTime || item.createdAt || "未知时间"} · ${item.followMethod || "未记录方式"} · ${item.content || "无内容"}`.slice(0, 420));
  }
  return lines.join("\n");
}

function findReferencedCustomer(db, message = "") {
  const text = normalizeMatchText(message);
  if (!text || isSimpleChatQuery(message)) return null;
  const candidates = (db.customers || []).map((customer) => {
    const fields = [
      customer.name,
      customer.contactName,
      customer.contactWechat,
      customer.contactPhone,
      customer.contactEmail
    ].filter(Boolean);
    const score = fields.reduce((total, field) => {
      const normalized = normalizeMatchText(field);
      if (!normalized || normalized.length < 2) return total;
      if (text.includes(normalized)) return total + Math.min(10, normalized.length);
      if (normalized.includes(text) && text.length >= 3) return total + 4;
      return total;
    }, 0);
    return { customer, score };
  }).filter((item) => item.score > 0);
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.customer || null;
}

function shouldAskForCustomerSelection(body = {}, referencedCustomer = null) {
  if (body.customerId || referencedCustomer || body.skillId) return false;
  if (shouldRouteToImage2(body, { skills: [] })) return false;
  const text = String(body.message || "");
  if (isDefaultWorkspaceDocumentIntent(text)) return false;
  if (isDefaultWorkspaceCustomerPortfolioIntent(text)) return false;
  const asksCustomerWork = /(这个客户|该客户|这个线索|该线索|这个商机|该商机|客户.*(跟进|推进|分析|复盘|成交|阶段|报价|下一步)|线索.*(跟进|推进|分析)|商机.*(跟进|推进|分析)|销售下一步|下一步怎么跟进)/.test(text);
  const hasNamedCustomer = /(客户[:：]|公司[:：]|项目[:：]|[\u4e00-\u9fa5A-Za-z0-9]{2,}(公司|项目|系统|平台|科技|集团|门店|学校|医院|工厂))/.test(text);
  return asksCustomerWork && !hasNamedCustomer;
}

function classifyDefaultWorkspaceIntent(message = "") {
  const text = String(message || "").trim();
  if (isDefaultWorkspaceDocumentIntent(text)) {
    return {
      key: "document_generation",
      label: "文档生成",
      reason: "输入要求生成需求文档、方案、报告、PPT 结构或可交付文档，不强制要求选择客户。",
      outputHint: "先识别目标文档类型，再补齐背景、目标、范围、功能、流程、风险和待确认事项。",
      toolHint: "默认使用通用 Agent 文档生成能力；如果用户明确要求案例/知识库/联网，再自动补充检索。"
    };
  }
  if (isDefaultWorkspaceCustomerPortfolioIntent(text)) {
    return {
      key: "customer_work",
      label: "客户推进任务",
      reason: "输入要求分析当前负责或手上的多个客户，需要读取 CRM 客户档案、跟进记录和历史生成。",
      outputHint: "调取当前用户负责的客户数据，比较推进阻塞、失败原因、优先级和下一步动作。",
      toolHint: "读取 CRM 客户集合上下文，包含客户档案、跟进记录、资料解析、客户记忆和历史 AI 输出。"
    };
  }
  if (/(跟进|推进|报价|复盘|成交|阶段|客户分析|线索分析|商机分析)/.test(text)) {
    return {
      key: "customer_work",
      label: "客户推进任务",
      reason: "输入像客户推进或售前协作任务；如果命中客户名称会自动关联客户，否则在必要时提示选择客户。",
      outputHint: "围绕客户阶段、跟进目标、沟通问题和下一步动作组织回答。",
      toolHint: "如已选择或命中客户，读取该客户隔离上下文；否则只输出通用打法。"
    };
  }
  if (/(计划|排期|里程碑|任务|流程|工作流|规划)/.test(text)) {
    return {
      key: "planning",
      label: "规划拆解",
      reason: "输入要求拆解计划、流程或执行路径。",
      outputHint: "输出目标、阶段、任务清单、风险和验收标准。",
      toolHint: "默认用 Agent Planner；需要资料时再调用知识库或联网。"
    };
  }
  if (/(今天|今日|本日).*(工作|任务|事项|进展|复盘|总结|分析)|工作.*(分析|复盘|总结)|任务.*(分析|复盘|总结)/.test(text)) {
    return {
      key: "work_analysis",
      label: "工作分析",
      reason: "输入要求分析或复盘当天工作，按工作总结和下一步优先级输出。",
      outputHint: "整理已完成、进行中、阻塞风险、明日重点和建议动作。",
      toolHint: "默认使用当前用户的全局生成历史和本轮对话上下文，不等待远程模型。"
    };
  }
  return {
    key: "general_chat",
    label: "默认对话",
    reason: "未检测到强客户绑定意图，按默认 AI 工作台直接回答。",
    outputHint: "输出可直接使用的结论和下一步。",
    toolHint: "默认不读取客户档案，保持全局工作台上下文。"
  };
}

function isDefaultWorkspaceCustomerPortfolioIntent(message = "") {
  const text = String(message || "").trim();
  if (!text) return false;
  const mentionsCustomerGroup = /(我的|我手上|手上|当前|现在|名下|负责|这|这些|那几个|两个|2个|几个|所有).{0,10}(客户|线索|商机)|(客户|线索|商机).{0,10}(两个|2个|几个|这些|当前|现在|手上|名下|负责)/.test(text);
  const asksAnalysis = /(分析|复盘|判断|看看|为什么|原因|推进|跟进|失败|卡住|停滞|没办法|无法|不能|下一步|分别|优先级|做什么)/.test(text);
  return mentionsCustomerGroup && asksAnalysis;
}

function buildDefaultWorkAnalysisMarkdown({ db, actor, message = "" }) {
  const userId = actor?.user?.id || "";
  const todayPrefix = nowIso().slice(0, 10);
  const todayRecords = (db?.aiGenerationRecords || [])
    .filter((record) => !userId || record.userId === userId)
    .filter((record) => String(record.createdAt || "").startsWith(todayPrefix))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 8);
  const recordLines = todayRecords.length
    ? todayRecords.map((record) => `- ${record.createdAt?.slice(11, 16) || "今日"} · ${record.title || GENERATION_LABELS_FOR_SYNC[record.generationType] || record.generationType || "AI 生成"}：${stripMarkdown(record.outputContent || "").slice(0, 160)}`).join("\n")
    : "- 当前系统没有检索到今天属于你的 AI 生成记录。可以粘贴今日待办、会议纪要或工作日志，我会继续按实际内容分析。";
  return [
    "# 今日工作分析",
    "",
    "## 1. 你刚才的目标",
    "",
    message || "分析今天的工作",
    "",
    "## 2. 今日系统内可见工作线索",
    "",
    recordLines,
    "",
    "## 3. 初步判断",
    "",
    todayRecords.length
      ? "- 今天已经有可追踪的 AI 生成或客户协作记录，建议把这些事项按客户推进、方案产出、内部配置和待复盘问题归类。"
      : "- 当前缺少具体工作明细，不能凭空判断完成质量；建议先补充今天的待办、聊天记录、会议纪要或任务列表。",
    "- 真正值得优先复盘的是：是否推动了客户决策、是否产出了可交付材料、是否消除了阻塞、是否留下了可追踪记录。",
    "",
    "## 4. 建议你按这个格式补全",
    "",
    "| 类别 | 事项 | 结果 | 风险/阻塞 | 下一步 |",
    "| --- | --- | --- | --- | --- |",
    "| 客户推进 | 待补充 | 待补充 | 待补充 | 待补充 |",
    "| 方案/文档 | 待补充 | 待补充 | 待补充 | 待补充 |",
    "| 内部协作 | 待补充 | 待补充 | 待补充 | 待补充 |",
    "",
    "## 5. 明日优先级建议",
    "",
    "- 先处理会影响客户回复、报价、方案确认或交付排期的事项。",
    "- 再补齐今天没有沉淀成记录的关键沟通和结论。",
    "- 最后整理可复用的方案、话术或需求清单，减少下次重复劳动。"
  ].join("\n");
}

function buildDefaultCustomerPortfolioMarkdown({ db, actor, message = "" }) {
  const customers = selectDefaultWorkspaceCustomersForAnalysis(db, actor, message);
  if (!customers.length) {
    return [
      "# 客户推进分析",
      "",
      "我理解你要分析当前手上的客户，但系统里没有找到归属于你或可用的客户记录。",
      "",
      "你可以先创建客户，或直接发客户名称。我会读取客户档案、跟进记录、资料解析和历史 AI 输出后再分析。"
    ].join("\n");
  }

  const customerBlocks = customers.map((customer, index) => {
    const follows = (db.followRecords || [])
      .filter((item) => item.customerId === customer.id)
      .sort((a, b) => new Date(b.followTime || b.createdAt || 0) - new Date(a.followTime || a.createdAt || 0))
      .slice(0, 4);
    const latestGenerations = (db.aiGenerationRecords || [])
      .filter((item) => item.customerId === customer.id)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 2);
    const memories = (db.customerMemories || [])
      .filter((item) => item.customerId === customer.id && item.status !== "disabled")
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
      .slice(0, 2);
    const files = (db.customerFiles || [])
      .filter((item) => item.customerId === customer.id && item.parsedText)
      .slice(0, 2);
    const stageName = getStageName(db, customer.stage);
    const stallReasons = inferCustomerStallReasons({ customer, follows, latestGenerations, message });
    const nextActions = inferCustomerNextActions({ customer, follows, stageName });
    return [
      `## ${index + 1}. ${customer.name}`,
      "",
      `- 阶段：${stageName}`,
      `- 状态：${customer.status || "未设置"}`,
      `- 类型：${customer.customerType || "未设置"}`,
      `- 成交概率：${customer.dealProbability || "未设置"}`,
      `- 预算：${customer.budgetInfo || "未确认"}`,
      `- 决策信息：${customer.decisionInfo || "未确认"}`,
      `- 当前下一步：${customer.nextAction || "未设置"}`,
      "",
      "### 为什么推进慢/可能失败",
      "",
      ...stallReasons,
      "",
      "### 可用上下文",
      "",
      `- 客户需求：${firstNonEmpty([customer.demandDescription, customer.problemToSolve, customer.background]) || "未补充"}`,
      `- 已知风险：${customer.knownRisks || "未记录"}`,
      `- 最近跟进：${summarizeRecentFollowRecords(follows) || "暂无跟进记录"}`,
      `- 客户记忆：${memories.map((item) => stripMarkdown(item.content || item.title || "").slice(0, 180)).filter(Boolean).join("；") || "暂无客户记忆"}`,
      `- 资料解析：${files.map((file) => `${file.fileName}：${stripMarkdown(file.parsedText || "").slice(0, 180)}`).join("；") || "暂无已解析资料"}`,
      `- 历史 AI 输出：${latestGenerations.map((item) => `${item.title || GENERATION_LABELS_FOR_SYNC[item.generationType] || "AI 输出"}：${stripMarkdown(item.outputContent || "").slice(0, 180)}`).join("；") || "暂无历史 AI 输出"}`,
      "",
      "### 你分别要做什么",
      "",
      ...nextActions
    ].join("\n");
  });

  return [
    "# 当前客户推进分析",
    "",
    `> 已按你的问题「${message || "分析当前客户"}」读取 CRM 客户数据。本次默认选取 ${customers.length} 个当前最相关客户；如要指定客户，直接输入客户名称即可。`,
    "",
    "## 总体判断",
    "",
    "- 推进不了通常不是因为缺少 AI 回复，而是客户需求边界、预算/决策链、下一步动作和跟进节奏没有被收敛。",
    "- 这类问题必须结合客户档案和跟进记录判断，不能只按通用话术回答。",
    "- 建议每个客户只推进一个最小闭环：确认决策人、确认一期范围、确认预算口径、确认下一次会议目标。",
    "",
    ...customerBlocks,
    "",
    "## 优先级建议",
    "",
    ...buildCustomerPriorityLines(db, customers),
    "",
    "## 下一轮你可以直接让我做",
    "",
    "- 为每个客户生成一段微信跟进话术。",
    "- 把其中一个客户转成「前期咨询回应策略报告」。",
    "- 对两个客户做成交概率、风险和下一步动作表格。"
  ].join("\n");
}

function selectDefaultWorkspaceCustomersForAnalysis(db, actor, message = "") {
  const text = String(message || "");
  const requestedCount = /两个|2个/.test(text) ? 2 : /三个|3个/.test(text) ? 3 : 2;
  const includeLost = /(失败|丢单|没成|为什么)/.test(text);
  const userId = actor?.user?.id || "";
  const activeStatuses = new Set(["跟进中", "潜在", "活跃", "active", "open", ""]);
  const scored = (db.customers || [])
    .filter((customer) => includeLost || activeStatuses.has(String(customer.status || "")) || customer.status !== "失败")
    .map((customer) => {
      let score = 0;
      if (customer.ownerId === userId) score += 30;
      if (customer.status !== "失败") score += 8;
      if (customer.stage === "lost") score += includeLost ? 8 : -5;
      if (customer.nextAction) score += 6;
      if (customer.lastFollowTime) score += 5;
      if (customer.demandDescription) score += 4;
      score += Math.max(0, 5 - daysSince(customer.updatedAt || customer.lastFollowTime || customer.createdAt));
      return { customer, score };
    })
    .sort((a, b) => b.score - a.score || new Date(b.customer.updatedAt || b.customer.createdAt || 0) - new Date(a.customer.updatedAt || a.customer.createdAt || 0));
  return scored.slice(0, requestedCount).map((item) => item.customer);
}

function daysSince(value) {
  const time = new Date(value || 0).getTime();
  if (!time) return 999;
  return Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000));
}

function inferCustomerStallReasons({ customer, follows = [], latestGenerations = [], message = "" }) {
  const lines = [];
  const context = [
    customer.demandDescription,
    customer.background,
    customer.problemToSolve,
    customer.budgetInfo,
    customer.decisionInfo,
    customer.knownRisks,
    customer.nextAction,
    follows.map((item) => item.content || item.customerFeedback || item.internalJudgement).join("\n"),
    latestGenerations.map((item) => item.outputContent).join("\n"),
    message
  ].filter(Boolean).join("\n");
  if (!customer.budgetInfo || /没有|待确认|未知|等|不明确/.test(customer.budgetInfo)) {
    lines.push("- 预算口径没有被确认，客户很难进入报价、排期或立项判断。");
  }
  if (!customer.decisionInfo || /老板|负责人|待确认|核心决策/.test(customer.decisionInfo)) {
    lines.push("- 决策链还不够清楚，需要确认谁拍板、谁使用、谁验收。");
  }
  if (/不知道|不明确|长什么样|范围|边界|一期|没立项|未立项/.test(context)) {
    lines.push("- 需求边界没有收敛，客户有兴趣但还没有形成可执行的一期范围。");
  }
  if (!follows.length || daysSince(follows[0]?.followTime || follows[0]?.createdAt) > 7) {
    lines.push("- 最近跟进记录不足或间隔偏久，推进节奏没有形成连续压力。");
  }
  if (/接口|对接|数据|ERP|第三方|资料|支付/.test(context)) {
    lines.push("- 存在数据、接口或资料确认项，这些会直接影响方案可信度和交付判断。");
  }
  if (!lines.length) {
    lines.push("- 当前没有明显单点阻塞，更像是下一步动作不够具体：需要把沟通目标从“继续聊”改成“确认范围/预算/决策/时间”。");
  }
  return lines.slice(0, 4);
}

function inferCustomerNextActions({ customer, follows = [], stageName = "" }) {
  const actions = [];
  if (!customer.budgetInfo || /没有|待确认|未知|等/.test(customer.budgetInfo)) {
    actions.push("- 先问预算口径：客户希望先看轻量方案、区间报价，还是完整建设报价。");
  }
  if (!customer.decisionInfo || /老板|负责人|待确认|核心决策/.test(customer.decisionInfo)) {
    actions.push("- 再问决策链：下一次沟通要不要把老板/业务负责人/实际使用人拉齐。");
  }
  if (/初步|接触|initial/i.test(customer.stage || stageName)) {
    actions.push("- 当前阶段优先产出一页式方案或前期咨询回应，不要急着进入大而全 PRD。");
  } else if (/方案|proposal/i.test(customer.stage || stageName)) {
    actions.push("- 当前阶段要推动客户确认方案边界、验收标准和报价前提。");
  } else if (/lost|失败/.test(customer.stage || customer.status || "")) {
    actions.push("- 如果已失败，先复盘失败原因，再判断是否保留后续唤醒机会。");
  }
  if (!follows.length) {
    actions.push("- 补一条跟进记录，把客户原话、判断和下一步时间写清楚。");
  }
  actions.push("- 本周只设一个明确推进目标：让客户确认下一次会议议题和需要谁参加。");
  return actions.slice(0, 4);
}

function buildCustomerPriorityLines(db, customers = []) {
  return customers.map((customer, index) => {
    const stageName = getStageName(db, customer.stage);
    const risk = (!customer.budgetInfo || /没有|待确认|未知|等/.test(customer.budgetInfo))
      ? "先补预算/决策"
      : customer.nextAction || "推进下一次确认";
    return `- P${index + 1}：${customer.name}（${stageName}）- ${risk}`;
  });
}

function buildDefaultGeneralChatMarkdown(message = "") {
  return [
    "# 默认 AI 工作台回复",
    "",
    "## 结论",
    "",
    message
      ? `我已收到你的问题：「${message}」。当前线上环境会优先使用稳定快速路径回复，避免长时间等待远程模型导致 504。`
      : "我已收到你的问题。",
    "",
    "## 我可以继续怎么帮你",
    "",
    "- 生成需求清单、PRD、方案大纲、PPT 结构稿或工作计划。",
    "- 分析你粘贴或上传的文件内容，并整理成摘要、清单、风险或下一步动作。",
    "- 如果需要结合某个客户，请点「选择客户」或直接提到客户名称。"
  ].join("\n");
}

function isDefaultWorkspaceDocumentIntent(message = "") {
  const text = String(message || "").trim();
  if (!text) return false;
  const documentTarget = /(需求文档|需求说明|需求清单|prd|产品需求|功能清单|业务清单|模块清单|方案|方案大纲|解决方案|报告|文档|PPT|ppt|结构稿|大纲|计划书|流程图|说明书|模板|话术|提示词)/i;
  const documentAction = /(写|生成|出|做|整理|拟|起草|产出|给我|帮我|设计|规划|梳理|创建)/;
  return documentTarget.test(text) && documentAction.test(text);
}

function buildCustomerSelectionClarification(db, message = "") {
  const candidates = (db.customers || [])
    .filter((item) => item.status !== "失败")
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, 5);
  const lines = [
    "可以，我需要先知道你要分析哪个客户。",
    "",
    "你可以在输入框底部点「选择客户」，或者直接把客户名称发给我。选中客户后，我会读取该客户的档案、跟进记录、资料解析和客户记忆，再给出下一步推进建议。"
  ];
  if (candidates.length) {
    lines.push("", "最近可选客户：");
    candidates.forEach((customer, index) => {
      lines.push(`${index + 1}. ${customer.name} · ${customer.customerType || "未设置类型"} · ${customer.stage || "未设置阶段"}`);
    });
  }
  if (String(message || "").trim()) {
    lines.push("", `你刚才的问题是：「${String(message).trim()}」。选中客户后我会继续按这个问题分析。`);
  }
  return lines.join("\n");
}

function normalizeMatchText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s\-—_()（）【】\[\].。,:：;；/\\]+/g, "")
    .trim();
}

function buildSimpleChatAnswer(body = {}, db) {
  const message = String(body.message || "").trim();
  const customer = body.customerId ? db.customers.find((item) => item.id === body.customerId) || null : null;
  if (/^(谢谢|辛苦了|好的|收到|ok|okay|ok了|明白了|了解了|拜拜|再见)$/i.test(message)) {
    return customer
      ? `不客气，我会继续围绕「${customer.name}」的上下文帮你推进。`
      : "不客气，有需要继续直接发我。";
  }
  if (/^(你是谁|你能做什么|你可以做什么|怎么用|怎么使用)$/.test(message)) {
    return customer
      ? `我是你的 AICRM 助手，当前只围绕「${customer.name}」的客户上下文工作。你可以直接让我分析客户、生成方案、整理文档或输出下一步跟进建议。`
      : "我是 AICRM 助手，你可以直接让我分析客户、生成方案、整理文档或输出可复制的话术。";
  }
  if (/^(hi|hello|hey|嗨|哈喽|你好|在吗|在不|有人吗)$/i.test(message)) {
    return customer
      ? `你好，我在。当前正在围绕「${customer.name}」继续处理，你可以直接告诉我下一步要分析什么。`
      : "你好，我在。你可以直接告诉我要分析哪个客户、生成什么内容，或者要我帮你整理成文档。";
  }
  if (customer) {
    return `我在，当前客户是「${customer.name}」。你可以直接告诉我下一步要分析的问题，或者让我帮你生成跟进建议、方案和文档。`;
  }
  return "我在。你可以直接告诉我要分析客户、生成方案、调用 Skill，或者整理成可复制的文档。";
}

function buildProcessStep(id, title, summary, detail) {
  return {
    id,
    title,
    status: "pending",
    summary,
    detail
  };
}

function emitProcessStep(send, step, status, overrides = {}) {
  if (!step) return;
  const payload = {
    id: step.id,
    title: step.title,
    status,
    summary: overrides.summary || step.summary || "",
    detail: overrides.detail || step.detail || ""
  };
  send(status === "running" ? "process_start" : "process_update", payload);
}

function cleanFinalChatAnswer(markdown = "", metadata = {}) {
  let text = String(markdown || "").replace(/\r\n?/g, "\n").trim();
  if (!text) {
    return metadata?.complexity === "simple"
      ? "我在，你可以继续告诉我下一步要做什么。"
      : "本次生成完成，但没有可展示的正文内容。你可以点击重新生成，或者补充更明确的目标后再试。";
  }

  if (metadata?.default_intent === "document_generation") {
    text = stripLeadingDocumentMetaBlock(text);
  }

  const bannedHeadingNames = new Set([
    "agent 执行摘要",
    "意图识别",
    "任务规划",
    "任务规划器",
    "工具调度",
    "工具调用",
    "执行路径",
    "执行轨迹",
    "任务轨迹",
    "当前限制",
    "限制说明",
    "联网工具未执行",
    "联网未执行",
    "知识库 rag 未执行",
    "rag 未执行",
    "未检测到知识库意图",
    "可执行 skill",
    "调度结果",
    "过程信息"
  ]);
  const bannedLinePatterns = [
    /当前未使用知识库/i,
    /当前未使用联网/i,
    /未检测到知识库意图/i,
    /未检测到联网意图/i,
    /RAG 未执行/i,
    /联网未执行/i,
    /可执行 Skill/i,
    /工具调度/i,
    /工具调用/i,
    /任务规划/i,
    /任务规划器/i,
    /意图识别/i,
    /意图策略/i,
    /调度器/i,
    /Router|Planner|Scheduler|Reflector/i,
    /当前限制/i
  ];

  const lines = text.split("\n");
  const kept = [];
  let skipHeadingLevel = 0;
  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      const headingText = headingMatch[2].trim().toLowerCase();
      if (bannedHeadingNames.has(headingText)) {
        skipHeadingLevel = headingMatch[1].length;
        continue;
      }
      if (skipHeadingLevel && headingMatch[1].length <= skipHeadingLevel) {
        skipHeadingLevel = 0;
      }
      if (skipHeadingLevel) continue;
      kept.push(line);
      continue;
    }
    if (skipHeadingLevel) continue;
    if (bannedLinePatterns.some((pattern) => pattern.test(line))) continue;
    kept.push(line);
  }

  let cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  cleaned = cleaned
    .replace(/^(>?\s*)?(当前未使用知识库|当前未使用联网|知识库 RAG 未执行|联网工具未执行|联网未执行|RAG 未执行).*$/gim, "")
    .replace(/^\s*-\s*(当前未使用知识库|当前未使用联网|知识库 RAG 未执行|联网工具未执行|联网未执行|RAG 未执行).*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) {
    return metadata?.complexity === "simple"
      ? "我在，你可以继续告诉我下一步要做什么。"
      : "本次生成完成，但模型返回的主要是过程信息。你可以重新生成，或补充更明确的目标后再试。";
  }

  return cleaned;
}

function stripLeadingDocumentMetaBlock(markdown = "") {
  const lines = String(markdown || "").split("\n");
  if (!lines[0]?.startsWith("# ")) return markdown;
  let index = 1;
  while (index < lines.length && lines[index].trim() === "") index += 1;
  const metaStart = index;
  if (!lines[index]?.trim().startsWith(">")) return markdown;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === "---") {
      index += 1;
      break;
    }
    if (trimmed && !trimmed.startsWith(">")) break;
    index += 1;
  }
  while (index < lines.length && lines[index].trim() === "") index += 1;
  return [lines[0], "", ...lines.slice(index)].join("\n").trim() || lines.slice(0, metaStart).join("\n").trim() || markdown;
}

async function streamSseText(text = "", send, eventName = "delta") {
  for (const chunk of splitForSse(text)) {
    if (eventName === "answer_delta") {
      send("answer_delta", { content: chunk });
    } else {
      send(eventName, { delta: chunk });
    }
    await new Promise((resolve) => setTimeout(resolve, 6));
  }
}

function splitForSse(text = "") {
  const source = String(text || "");
  if (!source) return [];
  const chunks = [];
  for (let index = 0; index < source.length; index += 90) {
    chunks.push(source.slice(index, index + 90));
  }
  return chunks;
}

async function handleCrmApiRequest({ method, pathname, body, headers, config }) {
  const generatedImageMatch = pathname.match(/^\/api\/crm\/generated-image\/([^/]+)$/);
  if (generatedImageMatch && method === "GET") {
    try {
      const asset = await readGeneratedImageAsset(decodeURIComponent(generatedImageMatch[1]));
      return {
        status: 200,
        body: asset.bytes,
        headers: {
          "Content-Type": asset.mimeType,
          "Cache-Control": "public, max-age=31536000, immutable"
        },
        isRaw: true
      };
    } catch (error) {
      return json(404, { ok: false, error: "图片不存在或已过期，请重新生成。" });
    }
  }

  if (pathname === "/api/crm/login" && method === "POST") {
    const db = await readCrmDb();
    const result = loginUser(db, body.email, body.password);
    if (!result) {
      return json(401, { ok: false, error: "邮箱或密码不正确" });
    }
    return json(200, {
      ok: true,
      ...result,
      token: createCrmToken(result.user.id, config),
      db: sanitizeCrmDb(db)
    });
  }

  if (pathname === "/api/crm/bootstrap" && method === "GET") {
    await expireStaleCrmAsyncJobs(config);
    const db = await readCrmDb();
    const actor = resolveCrmActor(db, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });
    const recovered = await recoverStuckCrmGenerationJobs({ db, config });
    const nextDb = recovered ? await readCrmDb() : db;
    return json(200, { ok: true, db: sanitizeCrmDb(nextDb) });
  }

  if (pathname === "/api/crm/sync-history-feishu" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });
    if (!body.recordId) {
      return json(400, { ok: false, error: "recordId is required" });
    }
    if (!isFeishuConfigured(config)) {
      return json(400, { ok: false, error: "飞书未配置：请先设置 FEISHU_APP_ID、FEISHU_APP_SECRET，并配置 FEISHU_WIKI_SPACE_ID 或 FEISHU_FOLDER_TOKEN。" });
    }

    const record = authDb.aiGenerationRecords.find((item) => item.id === body.recordId);
    if (!record) {
      return json(404, { ok: false, error: "未找到这条 AI 生成历史" });
    }

    const customer = record.customerId
      ? authDb.customers.find((item) => item.id === record.customerId)
      : null;
    const syncedAt = nowIso();
    const capture = buildHistoryFeishuCapture({ record, customer, actor: actor.user, syncedAt });
    let page;
    try {
      page = await createFeishuPage(capture, config);
    } catch (error) {
      return json(502, {
        ok: false,
        error: redactApiError(error.message || "飞书同步失败，请检查飞书应用权限与知识库配置。")
      });
    }

    const saved = await withCrmDb((db) => {
      const nextRecord = db.aiGenerationRecords.find((item) => item.id === record.id);
      if (!nextRecord) return null;
      return upsertCollectionItem(db, "aiGenerationRecords", {
        ...nextRecord,
        inputContext: {
          ...(nextRecord.inputContext || {}),
          feishuSync: {
            syncedAt,
            syncedBy: actor.user.id,
            syncedByName: actor.user.name || "",
            documentId: page.id,
            nodeToken: page.nodeToken || "",
            url: page.url || "",
            title: page.title || capture.title
          }
        }
      });
    });

    return json(200, {
      ok: true,
      result: {
        mode: "feishu",
        id: page.id,
        nodeToken: page.nodeToken || "",
        url: page.url || "",
        title: page.title || capture.title,
        syncedAt
      },
      record: saved
    });
  }

  if (pathname === "/api/crm/customer-with-assets" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });

    const item = body.item || {};
    const validationError = validateCrmUpsert(authDb, "customers", item);
    if (validationError) {
      return json(400, { ok: false, error: validationError });
    }
    const uploadError = validateUploadedDocuments(body.uploadedDocuments || []);
    if (uploadError) {
      return json(400, { ok: false, error: uploadError });
    }

    let queuedJob = null;
    const result = await withCrmDb(async (db) => {
      const customer = upsertCollectionItem(db, "customers", {
        ...item,
        ownerId: item.ownerId || actor.user.id,
        lastFollowTime: item.lastFollowTime || nowIso(),
        updatedAt: nowIso()
      });
      const files = saveUploadedCustomerFiles(db, {
        customer,
        uploadedDocuments: body.uploadedDocuments || [],
        actor: actor.user
      });

      let generation = null;
      let record = null;
      let memory = null;
      if (body.generateConsultationAdvice) {
        const skill = db.skills.find((item) => item.id === body.skillId && item.status !== "disabled")
          || pickConsultationAdviceSkill(db);
        generation = buildPendingConsultationAdviceGeneration({
          customer,
          files,
          skillId: skill?.id || body.skillId || "",
          userId: actor.user.id,
          reason: "客户保存后进入后台生成队列。"
        });
        record = saveGenerationRecord(db, {
          customerId: customer.id,
          userId: actor.user.id,
          skillId: skill?.id || body.skillId || "",
          type: "consultation_advice",
          saveToCustomer: false
        }, actor, generation);
        queuedJob = {
          recordId: record.id,
          body: {
            type: "consultation_advice",
            customerId: customer.id,
            skillId: skill?.id || body.skillId || "",
            userId: actor.user.id,
            message: "客户录入 CRM 后，生成客户咨询后跟进建议。",
            extraContext: {
              consultationAdvice: true,
              ownerNotes: customer.internalNotes || "",
              uploadedFiles: files.map((file) => ({
                fileName: file.fileName,
                fileType: file.fileType,
                parsedTextPreview: String(file.parsedText || "").slice(0, 800)
              })),
              matchedCases: "本次优先使用客户上传资料作为上下文；如需引用案例库，请在报告中提示销售准备相近案例，不要自动套用无关历史资料。"
            },
            modelId: body.modelId
          },
          actorUser: actor.user,
          config
        };
      }

      if (generation && !record) {
        const skill = db.skills.find((item) => item.id === body.skillId && item.status !== "disabled")
          || pickConsultationAdviceSkill(db);
        record = saveGenerationRecord(db, {
          customerId: customer.id,
          userId: actor.user.id,
          skillId: skill?.id || body.skillId || "",
          type: "consultation_advice",
          saveToCustomer: false
        }, actor, generation);
      }

      return {
        customer,
        files,
        generation,
        record,
        memory
      };
    });

    if (queuedJob) {
      await queueCrmGenerationJob(queuedJob);
    }

    return json(200, { ok: true, ...result });
  }

  if (pathname === "/api/crm/report-feedback" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });
    if (!body.recordId) return json(400, { ok: false, error: "recordId is required" });
    if (!String(body.feedbackContent || "").trim()) {
      return json(400, { ok: false, error: "请先填写报告哪里不好、哪里不对" });
    }

    const sourceRecord = authDb.aiGenerationRecords.find((item) => item.id === body.recordId);
    if (!sourceRecord) return json(404, { ok: false, error: "未找到要反馈的 AI 报告" });
    const sourceCustomer = sourceRecord.customerId
      ? authDb.customers.find((item) => item.id === sourceRecord.customerId)
      : null;

    const feedback = await withCrmDb((db) => upsertCollectionItem(db, "reportFeedbacks", {
      customerId: sourceCustomer?.id || "",
      customerName: sourceCustomer?.name || "默认 AI 工作台",
      recordId: sourceRecord.id,
      recordTitle: sourceRecord.title || "",
      generationType: sourceRecord.generationType || "",
      userId: actor.user.id,
      userName: actor.user.name || "",
      feedbackContent: body.feedbackContent,
      originalContentPreview: stripMarkdown(sourceRecord.outputContent || "").slice(0, 1600),
      aiOptimizationSuggestion: "AI 正在分析反馈...",
      status: "generating",
      createdAt: nowIso()
    }));

    await queueReportFeedbackJob({
      feedbackId: feedback.id,
      body: {
        recordId: sourceRecord.id,
        feedbackContent: body.feedbackContent,
        customerId: sourceCustomer?.id || "",
        userId: actor.user.id
      },
      actorUser: actor.user,
      config
    });

    return json(200, { ok: true, feedback });
  }

  if (pathname === "/api/crm/customer-to-solution-library" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });
    const customerId = String(body.customerId || "").trim();
    if (!customerId) return json(400, { ok: false, error: "customerId is required" });
    const customer = authDb.customers.find((item) => item.id === customerId);
    if (!customer) return json(404, { ok: false, error: "未找到当前客户，无法加入历史方案库" });

    let queuedJob = null;
    const result = await withCrmDb((db) => {
      const nextCustomer = db.customers.find((item) => item.id === customerId);
      const skill = db.skills.find((item) => item.id === "skill_3" && item.status !== "disabled")
        || db.skills.find((item) => item.name?.includes("需求深化方案") && item.status !== "disabled")
        || db.skills.find((item) => item.status !== "disabled");
      const generationBody = {
        type: "historical_solution_entry",
        customerId,
        skillId: skill?.id || "",
        userId: actor.user.id,
        message: "请分析当前客户所有上下文，生成一份可沉淀到历史方案库、可被后续 RAG 检索复用的客户方案内容。",
        extraContext: {
          disableWebResearch: true,
          disableRag: true,
          historicalSolutionLibrary: true,
          targetKnowledgeBaseId: "kb_solutions",
          contextScope: "current_customer_all_context",
          contextRules: [
            "输出用于历史方案库 RAG，不是直接发给客户的正式材料。",
            "必须沉淀客户画像、需求、真实诉求、方案主线、端口结构、核心场景、AI融入点、MVP范围、依赖风险、可复用标签。",
            "不得编造客户未确认事实；缺失信息写待确认。",
            "后续引用时不得直接套用客户专属细节、报价、周期或承诺。"
          ].join("\n")
        },
        modelId: body.modelId || ""
      };
      const generation = buildPendingBackgroundGeneration({
        db,
        type: generationBody.type,
        customer: nextCustomer,
        skillId: generationBody.skillId,
        userId: actor.user.id,
        message: generationBody.message,
        extraContext: generationBody.extraContext,
        reason: "正在分析当前客户上下文，并准备写入历史方案库。"
      });
      const record = saveGenerationRecord(db, generationBody, actor, generation);
      queuedJob = {
        recordId: record.id,
        body: generationBody,
        actorUser: actor.user,
        config
      };
      return { generation, record };
    });

    if (queuedJob) await queueCustomerHistoricalSolutionJob(queuedJob);
    return json(200, { ok: true, generation: result.generation, record: result.record });
  }

  if (pathname === "/api/crm/upsert" && method === "POST") {
    const { collection } = body;
    let { item } = body;
    if (!collection || !item) {
      return json(400, { ok: false, error: "collection and item are required" });
    }

    const validationDb = await readCrmDb();
    const actor = resolveCrmActor(validationDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });
    if (!canMutateCollection(actor.user, collection)) {
      return json(403, { ok: false, error: "当前账号没有权限修改该配置" });
    }

    const validationError = validateCrmUpsert(validationDb, collection, item);
    if (validationError) {
      return json(400, { ok: false, error: validationError });
    }

    const saved = await withCrmDb((db) => {
      item = preserveSensitiveFields(db, collection, item);
      applyCollectionSideEffects(db, collection, item);
      const next = {
        ...item,
        updatedAt: nowIso()
      };
      return upsertCollectionItem(db, collection, next);
    });

    return json(200, { ok: true, item: sanitizeCrmItem(collection, saved) });
  }

  if (pathname === "/api/crm/delete" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });
    if (actor.user.role !== "admin") {
      return json(403, { ok: false, error: "只有管理员可以删除数据" });
    }

    const { collection, id } = body;
    if (!collection || !id) {
      return json(400, { ok: false, error: "collection and id are required" });
    }
    if (collection === "users" && id === actor.user.id) {
      return json(400, { ok: false, error: "不能删除当前登录账号" });
    }
    if (collection === "users") {
      const targetUser = authDb.users.find((user) => user.id === id);
      const activeAdmins = authDb.users.filter((user) => user.role === "admin" && user.status === "active");
      if (targetUser?.role === "admin" && activeAdmins.length <= 1) {
        return json(400, { ok: false, error: "至少需要保留一个可用管理员账号" });
      }
    }

    const deleted = await withCrmDb((db) => deleteCollectionItem(db, collection, id));
    return json(200, { ok: true, deleted });
  }

  if (pathname === "/api/crm/generate" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });
    if (body.type === "lightweight_solution_ppt") {
      return json(400, { ok: false, error: "生成 PPT 请先打开轻量级方案 PPT 结构稿，再点击「生成PPT」。" });
    }
    if (!body.customerId) {
      return json(400, { ok: false, error: "AI 生成必须先选择客户，不能使用游离上下文" });
    }
    if (!authDb.customers.some((item) => item.id === body.customerId)) {
      return json(404, { ok: false, error: "未找到当前客户，无法读取客户上下文" });
    }

    let queuedJob = null;
    const result = await withCrmDb((db) => {
      const customer = db.customers.find((item) => item.id === body.customerId);
      const generationBody = buildGenerationRequestBody(db, body, customer, actor.user);
      const generation = buildPendingBackgroundGeneration({
        db,
        type: generationBody.type,
        customer,
        skillId: generationBody.skillId,
        userId: generationBody.userId || actor.user.id,
        message: generationBody.message,
        extraContext: generationBody.extraContext,
        reason: "已提交后台生成任务，请在帮助中心查看进度。"
      });
      const record = saveGenerationRecord(db, generationBody, actor, generation);
      queuedJob = {
        recordId: record.id,
        body: {
          ...generationBody,
          customerId: generationBody.customerId,
          userId: generationBody.userId || actor.user.id
        },
        actorUser: actor.user,
        config
      };

      return {
        generation,
        record,
        memory: null
      };
    });

    if (queuedJob) await queueCrmGenerationJob(queuedJob);

    return json(200, { ok: true, generation: result.generation, record: result.record });
  }

  if (pathname === "/api/crm/generate-lightweight-solution-ppt" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });

    const outlineRecordId = String(body.outlineRecordId || body.recordId || "").trim();
    if (!outlineRecordId) {
      return json(400, { ok: false, error: "请先选择一份轻量级方案 PPT 结构稿" });
    }

    const outlineRecord = authDb.aiGenerationRecords.find((record) => record.id === outlineRecordId);
    if (!outlineRecord) return json(404, { ok: false, error: "未找到轻量级方案 PPT 结构稿" });
    if (outlineRecord.generationType !== "lightweight_solution_ppt_outline") {
      return json(400, { ok: false, error: "当前记录不是轻量级方案 PPT 结构稿，不能直接生成 PPT" });
    }

    const outlineStatus = getAsyncRecordStatus(outlineRecord);
    if (outlineStatus === "generating") return json(400, { ok: false, error: "PPT 结构稿仍在生成中，请完成后再生成 PPT" });
    if (outlineStatus === "failed" || isRemoteFailureMarkdown(outlineRecord.outputContent || "")) {
      return json(400, { ok: false, error: "PPT 结构稿生成失败，请先重新生成结构稿" });
    }

    const customer = authDb.customers.find((item) => item.id === outlineRecord.customerId);
    if (!customer) return json(404, { ok: false, error: "未找到结构稿对应客户" });

    const pptInput = buildLightweightSolutionPptTaskInput(authDb, customer, outlineRecord);
    const createdAt = nowIso();
    const pendingGeneration = buildPendingPptTaskGeneration({
      customer,
      outlineRecord,
      pptInput,
      actor: actor.user,
      createdAt,
      status: "generating"
    });

    let record = await withCrmDb((db) => saveGenerationRecord(db, {
      customerId: customer.id,
      userId: body.userId || actor.user.id,
      type: "lightweight_solution_ppt",
      saveToCustomer: false
    }, actor, pendingGeneration));

    try {
      const pptTask = await createPptSkillTask(pptInput, config);
      record = await withCrmDb((db) => {
        const existing = db.aiGenerationRecords.find((item) => item.id === record.id);
        if (!existing) return record;
        return upsertCollectionItem(db, "aiGenerationRecords", mergePptTaskIntoRecord({
          record: existing,
          customer,
          outlineRecord,
          pptInput,
          pptTask,
          status: "generating"
        }));
      });
      startPptTaskPolling({
        recordId: record.id,
        taskId: pptTask.id,
        baseUrl: getPptSkillBaseUrl(config),
        config
      });
    } catch (error) {
      record = await withCrmDb((db) => {
        const existing = db.aiGenerationRecords.find((item) => item.id === record.id);
        if (!existing) return record;
        return upsertCollectionItem(db, "aiGenerationRecords", mergePptTaskIntoRecord({
          record: existing,
          customer,
          outlineRecord,
          pptInput,
          pptTask: null,
          status: "failed",
          errorText: error.message || "PPT 任务创建失败"
        }));
      });
    }

    return json(200, { ok: true, record, pptTask: record.inputContext?.pptTask || null });
  }

  if (pathname === "/api/crm/interaction-image-drafts" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });
    if (!body.customerId) return json(400, { ok: false, error: "生成交互图必须先选择客户" });
    const customer = authDb.customers.find((item) => item.id === body.customerId);
    if (!customer) return json(404, { ok: false, error: "未找到当前客户，无法读取客户上下文" });

    const imageCount = clampNumber(body.imageCount, 1, 8, 3);
    const skill = authDb.skills.find((item) => item.id === body.skillId && item.status !== "disabled")
      || authDb.skills.find((item) => item.name?.includes("交互图") && item.status !== "disabled");
    const generation = await generateCrmContent({
      db: authDb,
      type: "interaction_image_drafts",
      customerId: body.customerId,
      skillId: skill?.id || body.skillId || "",
      userId: body.userId || actor.user.id,
      message: [
        `请基于当前客户上下文生成 ${imageCount} 张交互图的界面内容草稿。`,
        "只输出可解析 JSON，字段为 screens，数组内包含 title、device、goal、layout、prompt。",
        `默认设备：${normalizeInteractionDevice(body.defaultDevice || "桌面端")}。每张图的 device 可以根据页面价值调整为「桌面端」「移动端」「桌面端 + 移动端」或「响应式画板」，但不要默认每张都双端。`,
        "每个 prompt 都必须可直接给 image2 使用，并明确该张图选择的设备呈现方式、中文 UI 文案、页面布局和禁止项。",
        "如果 device 是桌面端，只生成电脑框或宽屏 Web 画布；如果 device 是移动端，只生成手机框；只有 device 明确为桌面端 + 移动端时才同时生成电脑框与手机框。",
        body.extraRequirement ? `补充要求：${body.extraRequirement}` : ""
      ].filter(Boolean).join("\n"),
      extraContext: {
        interactionStyle: body.style || "",
        websiteType: body.websiteType || "",
        extraRequirement: body.extraRequirement || "",
        defaultDevice: normalizeInteractionDevice(body.defaultDevice || "桌面端"),
        imageCount,
        outputTarget: "image2",
        draftMode: "editable_screen_prompts",
        responseContract: "Return JSON with screens[] only when possible."
      },
      modelId: body.modelId,
      config
    });
    if (isRemoteFailureMarkdown(generation.outputContent || "")) {
      return json(502, {
        ok: false,
        error: stripMarkdown(generation.outputContent || "").slice(0, 900) || "交互图界面内容生成失败"
      });
    }

    const drafts = extractInteractionDrafts(generation.outputContent, imageCount, {
      customer,
      style: body.style,
      websiteType: body.websiteType,
      extraRequirement: body.extraRequirement,
      defaultDevice: body.defaultDevice || "桌面端"
    });
    if (!drafts.length) {
      return json(502, { ok: false, error: "AI 未返回可解析的界面内容，请重新生成或减少图片数量。" });
    }
    return json(200, { ok: true, drafts, generation });
  }

  if (pathname === "/api/crm/generate-interaction-image" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });
    if (!body.customerId) {
      return json(400, { ok: false, error: "生成交互图必须先选择客户" });
    }
    if (!authDb.customers.some((item) => item.id === body.customerId)) {
      return json(404, { ok: false, error: "未找到当前客户，无法读取客户上下文" });
    }

    const result = await withCrmDb((db) => {
      const customer = db.customers.find((item) => item.id === body.customerId);
      if (!customer) throw new Error("customer not found");

      const title = `${customer.name} - 交互图`;
      const createdAt = nowIso();
      const imagePrompts = normalizeInteractionImagePrompts(body.imagePrompts || []);
      const outputContent = imagePrompts.length
        ? buildPendingInteractionImageBoardMarkdown({
          customer,
          style: body.style,
          websiteType: body.websiteType,
          extraRequirement: body.extraRequirement,
          items: imagePrompts
        })
        : buildPendingInteractionImageMarkdown({
          customer,
          style: body.style,
          websiteType: body.websiteType,
          extraRequirement: body.extraRequirement
        });
      const generation = {
        title,
        generationType: "interaction_image",
        skillId: body.skillId || "",
        modelName: `${config.image2Model || "image2"} 后台生成中`,
        prompt: "background interaction image2 generation",
        inputContext: {
          asyncImageJob: {
            kind: imagePrompts.length ? "interaction_image_board" : "interaction_image",
            status: "generating",
            startedAt: createdAt,
            customerId: body.customerId,
            style: body.style || "",
            websiteType: body.websiteType || "",
            extraRequirement: body.extraRequirement || "",
            imageCount: imagePrompts.length || 1
          },
          interactionImage: {
            style: body.style || "",
            websiteType: body.websiteType || "",
            extraRequirement: body.extraRequirement || "",
            imageProvider: "image2",
            imageModel: config.image2Model || "image2",
            imageStatus: "generating",
            usedPlaceholder: false
          },
          ...(imagePrompts.length ? {
            interactionImageBoard: {
              version: "interaction_board_v1",
              status: "generating",
              title: `${customer.name} - 交互图画板`,
              customerId: body.customerId,
              style: body.style || "",
              websiteType: body.websiteType || "",
              extraRequirement: body.extraRequirement || "",
              imageCount: imagePrompts.length,
              items: imagePrompts.map((item, index) => ({
                ...item,
                id: item.id || `image_${index + 1}`,
                status: index === 0 ? "generating" : "queued",
                imageUrl: "",
                revisedPrompt: "",
                error: "",
                startedAt: index === 0 ? createdAt : "",
                finishedAt: ""
              })),
              updatedAt: createdAt
            }
          } : {})
        },
        outputContent,
        createdAt
      };

      const record = upsertCollectionItem(db, "aiGenerationRecords", {
        customerId: body.customerId,
        userId: body.userId || actor.user.id,
        generationType: generation.generationType,
        inputContext: generation.inputContext,
        prompt: generation.prompt,
        modelName: generation.modelName,
        outputContent: generation.outputContent,
        skillId: generation.skillId,
        title: generation.title,
        createdAt: generation.createdAt
      });

      return {
        generation,
        record,
        memory: null,
        image: {
          status: "generating",
          modelName: config.image2Model || "image2",
          usedFallback: false,
          note: "图片已进入后台生成队列。"
        }
      };
    });

    await queueInteractionImageJob({
      recordId: result.record.id,
      body,
      actorUser: actor.user,
      config
    });

    return json(200, { ok: true, ...result });
  }

  if (pathname === "/api/crm/regenerate-interaction-image-item" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });
    const recordId = String(body.recordId || "").trim();
    const itemId = String(body.itemId || "").trim();
    const modification = String(body.modification || "").trim();
    if (!recordId || !itemId) return json(400, { ok: false, error: "缺少要重新生成的图片记录" });
    if (!modification) return json(400, { ok: false, error: "请填写修改意见" });
    const record = authDb.aiGenerationRecords.find((item) => item.id === recordId);
    if (!record || record.generationType !== "interaction_image") {
      return json(404, { ok: false, error: "未找到交互图画板记录" });
    }
    const customer = authDb.customers.find((item) => item.id === record.customerId);
    if (!customer) return json(404, { ok: false, error: "未找到当前客户，无法读取客户上下文" });
    const board = record.inputContext?.interactionImageBoard || {};
    const items = Array.isArray(board.items) ? board.items : [];
    const targetItem = items.find((item) => item.id === itemId);
    if (!targetItem) return json(404, { ok: false, error: "未找到要重新生成的图片" });

    const updatedRecord = await withCrmDb((db) => {
      const existing = db.aiGenerationRecords.find((item) => item.id === recordId);
      if (!existing) return record;
      const existingBoard = existing.inputContext?.interactionImageBoard || {};
      const nextItems = (existingBoard.items || []).map((item) => item.id === itemId
        ? {
          ...item,
          status: "generating",
          error: "",
          modification,
          regenerationHistory: [
            ...(item.regenerationHistory || []),
            {
              at: nowIso(),
              userId: actor.user.id,
              userName: actor.user.name || "",
              modification,
              previousImageUrl: item.imageUrl || "",
              previousPrompt: item.prompt || ""
            }
          ].slice(-8)
        }
        : item);
      return upsertCollectionItem(db, "aiGenerationRecords", {
        ...existing,
        inputContext: {
          ...(existing.inputContext || {}),
          asyncImageJob: {
            ...(existing.inputContext?.asyncImageJob || {}),
            kind: "interaction_image_board",
            status: "generating",
            customerId: customer.id,
            imageCount: nextItems.length,
            error: ""
          },
          interactionImageBoard: {
            ...existingBoard,
            status: "generating",
            items: nextItems,
            updatedAt: nowIso()
          }
        },
        outputContent: buildInteractionImageBoardMarkdown({
          customer,
          style: existingBoard.style || record.inputContext?.interactionImage?.style || "",
          websiteType: existingBoard.websiteType || record.inputContext?.interactionImage?.websiteType || "",
          extraRequirement: existingBoard.extraRequirement || "",
          items: nextItems,
          status: "generating"
        }),
        updatedAt: nowIso()
      });
    });

    await queueInteractionImageRegenerateJob({
      recordId,
      itemId,
      modification,
      actorUser: actor.user,
      config
    });

    return json(200, { ok: true, record: updatedRecord });
  }

  if (pathname === "/api/crm/test-model" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });
    if (actor.user.role !== "admin") {
      return json(403, { ok: false, error: "只有管理员可以测试模型配置" });
    }

    const result = await testCrmModel({
      db: authDb,
      modelId: body.modelId,
      config
    });

    return json(200, { ok: true, result });
  }

  if (pathname === "/api/crm/failure" && method === "POST") {
    const authDb = await readCrmDb();
    const actor = resolveCrmActor(authDb, headers, config);
    if (!actor.user) return json(401, { ok: false, error: actor.error });

    if (!body.customerId) {
      return json(400, { ok: false, error: "customerId is required" });
    }

    let queuedJob = null;
    const result = await withCrmDb((db) => {
      const customer = db.customers.find((item) => item.id === body.customerId);
      if (!customer) throw new Error("customer not found");
      const failureSkill = db.skills.find((skill) => skill.status !== "disabled" && String(skill.name || "").includes("失败分析")) || null;
      const failureSkillId = failureSkill?.id || "";

      customer.status = "失败";
      customer.stage = "lost";
      customer.updatedAt = nowIso();

      const generation = body.generateReport === false
        ? null
        : buildPendingBackgroundGeneration({
          db,
          type: "failure_report",
          customer,
          skillId: failureSkillId,
          userId: body.userId || actor.user.id,
          message: body.failureDescription,
          extraContext: {
            failureReasonType: body.failureReasonType,
            failureDescription: body.failureDescription,
            customerFinalFeedback: body.customerFinalFeedback,
            chatRecordText: body.chatRecordText,
            internalReview: body.internalReview
          },
          reason: "失败复盘已提交后台生成。"
        });

      const report = upsertCollectionItem(db, "failureReports", {
        customerId: body.customerId,
        failureTime: body.failureTime || nowIso(),
        failureReasonType: body.failureReasonType || "其他",
        failureDescription: body.failureDescription || "",
        customerFinalFeedback: body.customerFinalFeedback || "",
        chatRecordText: body.chatRecordText || "",
        internalReview: body.internalReview || "",
        aiReport: generation?.outputContent || "",
        reactivateSuggestion: extractReactivateSuggestion(generation?.outputContent || ""),
        status: generation ? "generating" : "manual",
        createdAt: nowIso(),
        updatedAt: nowIso()
      });

      let record = null;
      if (generation) {
        record = upsertCollectionItem(db, "aiGenerationRecords", {
          customerId: body.customerId,
          userId: body.userId || actor.user.id,
          generationType: "failure_report",
          inputContext: generation.inputContext,
          prompt: generation.prompt,
          modelName: generation.modelName,
          outputContent: generation.outputContent,
          skillId: failureSkillId || generation.skillId,
          title: generation.title,
          createdAt: generation.createdAt
        });
        queuedJob = {
          recordId: record.id,
          body: {
            type: "failure_report",
            customerId: body.customerId,
            skillId: failureSkillId,
            userId: body.userId || actor.user.id,
            message: body.failureDescription,
            extraContext: {
              failureReasonType: body.failureReasonType,
              failureDescription: body.failureDescription,
              customerFinalFeedback: body.customerFinalFeedback,
              chatRecordText: body.chatRecordText,
              internalReview: body.internalReview,
              failureReportId: report.id
            },
            modelId: body.modelId
          },
          actorUser: actor.user,
          config
        };
      }

      return {
        customer,
        report,
        generation,
        record
      };
    });

    if (queuedJob) await queueCrmGenerationJob(queuedJob);

    return json(200, { ok: true, ...result });
  }

  return null;
}

function validateUploadedDocuments(uploadedDocuments = []) {
  if (!Array.isArray(uploadedDocuments)) return "uploadedDocuments must be an array";
  const totalSize = uploadedDocuments.reduce((sum, file) => {
    const declared = Number(file?.size || 0);
    if (Number.isFinite(declared) && declared > 0) return sum + declared;
    const base64Length = String(file?.base64 || "").length;
    return sum + Math.floor(base64Length * 0.75);
  }, 0);
  if (totalSize > MAX_CUSTOMER_UPLOAD_BYTES) {
    return `客户资料上传总大小不能超过 ${Math.round(MAX_CUSTOMER_UPLOAD_BYTES / 1024 / 1024)}MB`;
  }
  return "";
}

function saveUploadedCustomerFiles(db, { customer, uploadedDocuments = [], actor }) {
  if (!uploadedDocuments.length) return [];
  const parsedDocuments = normalizeKnowledgeBaseDocuments([], uploadedDocuments);
  const files = [];
  for (const doc of parsedDocuments) {
    const parsedText = buildCustomerParsedText(doc);
    if (!parsedText) continue;
    const file = upsertCollectionItem(db, "customerFiles", {
      customerId: customer.id,
      followRecordId: "",
      fileName: doc.fileName || "未命名资料",
      fileUrl: "",
      fileType: doc.fileType || "file",
      mimeType: doc.mimeType || "",
      parser: doc.parser || "",
      source: "customer_create_upload",
      uploadedBy: actor?.id || "",
      parsedText,
      chunkCount: Number(doc.chunkCount || doc.chunks?.length || 0),
      createdAt: nowIso()
    });
    files.push(file);
  }
  return files;
}

function buildCustomerParsedText(doc = {}) {
  const chunks = Array.isArray(doc.chunks) ? doc.chunks : [];
  const chunkText = chunks.map((chunk) => String(chunk.text || "").trim()).filter(Boolean).join("\n\n");
  return (chunkText || doc.parsedTextPreview || "").slice(0, 60000);
}

function pickConsultationAdviceSkill(db) {
  return db.skills.find((skill) => skill.id === "skill_22" && skill.status !== "disabled")
    || db.skills.find((skill) => skill.name?.includes("前期咨询回应策略") && skill.status !== "disabled")
    || db.skills.find((skill) => skill.name?.includes("首次沟通策略") && skill.status !== "disabled")
    || null;
}

function addCustomerSolutionToKnowledgeBase(db, { customer, generation, actor, sourceRecordId, createdAt = nowIso() }) {
  const kb = db.knowledgeBases.find((item) => item.id === "kb_solutions")
    || db.knowledgeBases.find((item) => item.name?.includes("历史方案"))
    || db.knowledgeBases[0];
  if (!kb) throw new Error("未找到历史方案库，请先在系统设置中启用知识库");

  const markdown = buildHistoricalSolutionKnowledgeMarkdown({ customer, generation, actor, sourceRecordId, createdAt });
  const fileName = `${safeFileName(customer.name || "客户方案")}_历史方案库沉淀_${createdAt.slice(0, 10)}.md`;
  const documentId = `doc_customer_solution_${customer.id}_${sourceRecordId || crypto.randomUUID()}`;
  const existingDocuments = (kb.documents || []).filter((doc) => doc.id !== documentId && doc.sourceRecordId !== sourceRecordId);
  const normalized = normalizeKnowledgeBaseDocuments([
    {
      id: documentId,
      fileName,
      fileType: "markdown",
      mimeType: "text/markdown",
      parser: "aicrm_customer_solution",
      sourceType: "customer_solution_library",
      sourceCustomerId: customer.id,
      sourceCustomerName: customer.name || "",
      sourceRecordId,
      generatedBy: actor?.id || "",
      generatedByName: actor?.name || "",
      text: markdown,
      parsedTextPreview: markdown.slice(0, 1200),
      status: "enabled",
      createdAt,
      updatedAt: createdAt
    },
    ...existingDocuments
  ], []);

  kb.documents = normalized;
  kb.status = kb.status || "enabled";
  kb.updatedAt = createdAt;

  const savedDoc = normalized.find((doc) => doc.id === documentId) || normalized[0];
  return {
    knowledgeBaseId: kb.id,
    knowledgeBaseName: kb.name,
    documentId: savedDoc?.id || documentId,
    documentName: savedDoc?.fileName || fileName,
    chunkCount: Number(savedDoc?.chunkCount || savedDoc?.chunks?.length || 0),
    savedAt: createdAt
  };
}

function buildHistoricalSolutionKnowledgeMarkdown({ customer, generation, actor, sourceRecordId, createdAt }) {
  return [
    `# ${customer.name || "客户"}历史方案库沉淀`,
    "",
    "## 入库信息",
    "",
    `- 客户：${customer.name || "未命名客户"}`,
    `- 客户类型：${customer.customerType || "待确认"}`,
    `- 当前阶段：${customer.stage || "待确认"}`,
    `- 生成类型：${GENERATION_LABELS_FOR_SYNC[generation.generationType] || generation.generationType}`,
    `- 来源记录：${sourceRecordId || "未记录"}`,
    `- 入库人：${actor?.name || "内部用户"}`,
    `- 入库时间：${formatSyncDate(createdAt)}`,
    "",
    "## RAG 使用边界",
    "",
    "- 本文档用于后续相似项目方案参考、结构复用和售前方法论引用。",
    "- 引用时不得把本客户事实、预算、周期、决策链或交付承诺直接套用到其他客户。",
    "- 优先复用：需求理解方式、方案主线、端口结构、AI 融入点、MVP 收敛逻辑和风险提示。",
    "",
    "## 方案内容",
    "",
    generation.outputContent || "暂无方案内容"
  ].join("\n");
}

function safeFileName(value = "") {
  return String(value || "未命名")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "未命名";
}

async function generateReportFeedbackOptimization({ db, record, customer, feedbackContent, actor, config }) {
  const message = [
    "你是积木科技 AI CRM 的报告质量与 Skill 优化负责人。",
    "请基于销售人员对 AI 报告的反馈，分析这份报告下次应该如何优化。",
    "只输出 Markdown，结构包含：问题归因、提示词/Skill 优化建议、客户上下文补充建议、下次生成校验点。",
    "",
    `反馈内容：${feedbackContent}`,
    "",
    `报告标题：${record.title || ""}`,
    `报告类型：${record.generationType || ""}`,
    `客户：${customer?.name || "默认 AI 工作台"}`,
    "",
    "报告原内容摘要：",
    stripMarkdown(record.outputContent || "").slice(0, 2200)
  ].join("\n");

  try {
    const generation = await withSoftTimeout(generateCrmContent({
      db,
      type: "chat",
      customerId: customer?.id || "",
      skillId: "",
      userId: actor.id,
      message,
      extraContext: {
        reportFeedback: true,
        sourceRecordId: record.id,
        sourceGenerationType: record.generationType,
        feedbackContent
      },
      config
    }), Number(config.reportFeedbackTimeoutMs || 18000), () => ({
      outputContent: buildLocalReportFeedbackOptimization({ feedbackContent, record })
    }));
    const output = generation.outputContent || "";
    return isRemoteFailureMarkdown(output)
      ? buildLocalReportFeedbackOptimization({ feedbackContent, record })
      : output || buildLocalReportFeedbackOptimization({ feedbackContent, record });
  } catch (error) {
    return [
      buildLocalReportFeedbackOptimization({ feedbackContent, record }),
      "",
      "> AI 优化分析生成时出现异常，已先保存本地优化建议。",
      "",
      `错误摘要：${redactApiError(error.message || "未知错误")}`
    ].join("\n");
  }
}

function buildLocalReportFeedbackOptimization({ feedbackContent, record }) {
  return [
    "# 报告优化建议",
    "",
    "## 问题归因",
    "",
    `- 销售反馈重点：${String(feedbackContent || "").slice(0, 500)}`,
    `- 原报告类型：${record?.generationType || "AI 生成报告"}，需要检查是否真正结合了客户业务背景、阶段、资料和销售下一步动作。`,
    "",
    "## 提示词 / Skill 优化建议",
    "",
    "- 在 Skill 中增加“先判断客户希望听到什么，再给对应解决方案”的约束。",
    "- 对表格项增加“必须结合客户业务背景”的校验，避免输出泛泛结论。",
    "- 对话术和行动项要求可直接复制使用，并明确交付物。",
    "",
    "## 客户上下文补充建议",
    "",
    "- 补充客户原始资料、业务背景、已有系统、预算、决策链和客户原话。",
    "- 如果报告偏离客户事实，优先检查客户档案和上传资料解析是否完整。",
    "",
    "## 下次生成校验点",
    "",
    "- 是否有客户真实意图判断。",
    "- 是否每个关注点都有对应解决方案。",
    "- 是否给出下一步客户期待的交付内容。",
    "- 是否标注待确认信息，避免把推断写成事实。"
  ].join("\n");
}

function buildGenerationRequestBody(db, body, customer, actorUser) {
  const generationType = normalizeBackgroundGenerationType(body.type);
  const rawExtraContext = body.extraContext || {};
  const baseExtraContext = {
    ...rawExtraContext,
    ...(customer ? buildCustomerSkillMemoryContext(db, customer) : {})
  };
  const base = {
    ...body,
    type: generationType,
    userId: body.userId || actorUser.id,
    extraContext: baseExtraContext
  };
  if (generationType === "next_communication_question_list" && customer) {
    const recommendedSkill = db.skills.find((skill) => skill.name.includes("下一步沟通问题清单") && skill.status !== "disabled");
    return {
      ...base,
      skillId: base.skillId || recommendedSkill?.id || "",
      message: base.message || "基于当前客户信息、前期咨询回应策略报告和最近跟进记录，生成下一步沟通问题清单。",
      extraContext: {
        ...base.extraContext,
        ...buildNextCommunicationQuestionContext(db, customer)
      }
    };
  }
  if (generationType === "lightweight_solution" && customer) {
    const recommendedSkill = db.skills.find((skill) => skill.name.includes("轻量级方案") && skill.status !== "disabled");
    return {
      ...base,
      skillId: base.skillId || recommendedSkill?.id || "",
      message: base.message || "基于当前客户完整上下文和销售补充信息，生成一份可直接发给客户的轻量级方案。",
      extraContext: {
        ...base.extraContext,
        ...buildLightweightSolutionContext(db, customer, rawExtraContext)
      }
    };
  }
  if (generationType === "solution_deepening" && customer) {
    const recommendedSkill = db.skills.find((skill) => skill.name.includes("需求深化方案") && skill.status !== "disabled");
    return {
      ...base,
      skillId: base.skillId || recommendedSkill?.id || "",
      message: base.message || "基于当前客户上下文、已保存 AI 文档、客户资料、知识库案例和积木科技能力，生成方案强化阶段逐页页面内容稿。",
      extraContext: {
        ...base.extraContext,
        ...buildSolutionDeepeningContext(db, customer)
      }
    };
  }
  if (generationType === "requirement_document" && customer) {
    const recommendedSkill = db.skills.find((skill) => /生成需求文档|需求文档/.test(skill.name || "") && skill.status !== "disabled");
    return {
      ...base,
      skillId: base.skillId || recommendedSkill?.id || "",
      message: base.message || "基于当前客户上下文、已保存 AI 文档、客户资料和跟进记录，生成项目功能介绍、各端口详细需求文档和 AI 需求文档。",
      extraContext: {
        ...base.extraContext,
        ...buildRequirementDocumentContext(db, customer)
      }
    };
  }
  if (generationType === "lightweight_solution_ppt_outline" && customer) {
    const recommendedSkill = db.skills.find((skill) => /轻量级方案\s*PPT/i.test(skill.name || "") && skill.status !== "disabled");
    return {
      ...base,
      skillId: base.skillId || recommendedSkill?.id || "",
      message: base.message || "基于当前客户上下文、前期咨询回应报告和轻量级方案，生成轻量方案 PPT 结构稿，并输出可交给 PPT 生成 Skill 的提示词。",
      extraContext: {
        ...base.extraContext,
        ...buildLightweightSolutionPptContext(db, customer)
      }
    };
  }
  return base;
}

function buildCustomerSkillMemoryContext(db, customer) {
  const savedRecords = db.aiGenerationRecords
    .filter((record) => record.customerId === customer.id && record.inputContext?.customerArchive?.savedAt)
    .filter((record) => record.inputContext?.asyncAiJob?.status !== "generating" && record.inputContext?.asyncAiJob?.status !== "failed")
    .sort((a, b) => new Date(b.inputContext?.customerArchive?.savedAt || b.updatedAt || b.createdAt) - new Date(a.inputContext?.customerArchive?.savedAt || a.updatedAt || a.createdAt))
    .slice(0, 5)
    .map((record) => `- ${record.title || record.generationType || "已保存AI文档"}：${stripMarkdown(record.outputContent || "").slice(0, 900)}`)
    .join("\n");
  const memories = (db.customerMemories || [])
    .filter((memory) => memory.customerId === customer.id && memory.status !== "disabled")
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, 5)
    .map((memory) => `- ${memory.title || memory.memoryType || "客户记忆"}：${stripMarkdown(memory.content || "").slice(0, 520)}`)
    .join("\n");

  return {
    customerCenteredSkillContext: true,
    customerMemoryScope: "single_customer_only",
    savedCustomerArchiveSummary: savedRecords || "暂无已保存到客户档案的 AI 文档。",
    customerMemorySummary: memories || "暂无客户记忆沉淀。",
    customerSkillContextRules: [
      "本次 Skill 只允许读取当前客户上下文，不得引用其他客户。",
      "面向客户的输出必须继承当前客户已保存的 AI 文档、客户记忆、资料解析文本和跟进记录。",
      "如果历史结论与最新客户档案冲突，以最新客户档案和最近跟进记录为准，并标注待确认。",
      "没有依据的信息必须写为待确认，不得编造。"
    ].join("\n")
  };
}

function buildNextCommunicationQuestionContext(db, customer) {
  const latestConsultationReport = db.aiGenerationRecords
    .filter((record) => record.customerId === customer.id && record.generationType === "consultation_advice")
    .filter((record) => record.inputContext?.asyncAiJob?.status !== "generating" && record.inputContext?.asyncAiJob?.status !== "failed")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const recentFollows = db.followRecords
    .filter((record) => record.customerId === customer.id)
    .sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt))
    .slice(0, 5);
  const matchedCases = db.aiGenerationRecords
    .filter((record) => record.customerId === customer.id)
    .filter((record) => /案例|case/i.test(`${record.generationType || ""}\n${record.title || ""}`))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 3)
    .map((record) => `- ${record.title || "案例匹配记录"}：${stripMarkdown(record.outputContent || "").slice(0, 700)}`)
    .join("\n");

  return {
    nextCommunicationQuestionList: true,
    disableWebResearch: true,
    disableRag: true,
    contextPriority: "客户当前信息 > 最近一次前期咨询回应策略报告 > 最近5条跟进摘要 > 当前客户案例匹配结果",
    missingConsultationAdvice: !latestConsultationReport,
    consultingStrategyReport: latestConsultationReport
      ? String(latestConsultationReport.outputContent || "").slice(0, 7000)
      : "暂无前期咨询回应策略报告。本次应只基于客户信息和历史跟进记录生成，并把缺失信息转成必须确认的问题。",
    followRecordsSummary: summarizeFollowRecordsForNextQuestions(customer, recentFollows),
    matchedCases: matchedCases || "暂无当前客户已匹配的案例库结果。不要假设案例存在；如需案例，只提示销售准备相近案例类型。",
    contextRules: [
      "如果客户当前信息与历史跟进记录冲突，以最新客户信息为准。",
      "如果前期咨询回应策略报告已有明确判断，不要重复大篇幅分析，要转化为沟通目标、问题、话术和推进判断。",
      "缺失信息必须转化为本次沟通必须确认的问题，不允许编造。",
      "历史跟进记录只作为摘要参考，不要把内部判断写成客户已确认事实。"
    ].join("\n")
  };
}

function buildLightweightSolutionContext(db, customer, extraContext = {}) {
  const latestConsultationReport = db.aiGenerationRecords
    .filter((record) => record.customerId === customer.id && record.generationType === "consultation_advice")
    .filter((record) => record.inputContext?.asyncAiJob?.status !== "generating" && record.inputContext?.asyncAiJob?.status !== "failed")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const recentFollows = db.followRecords
    .filter((record) => record.customerId === customer.id)
    .sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt))
    .slice(0, 6);
  const files = db.customerFiles
    .filter((file) => file.customerId === customer.id)
    .slice(0, 5)
    .map((file) => `- ${file.fileName || "客户资料"}（${file.fileType || "资料"}）：${stripMarkdown(file.parsedText || "").slice(0, 900)}`)
    .join("\n");
  const supplement = normalizeLightweightSolutionSupplement(extraContext.lightweightSolution || extraContext);

  return {
    lightweightSolution: true,
    disableWebResearch: true,
    contextPriority: "客户详情完整上下文 > 最近一次前期咨询回应报告 > 最近6条跟进记录 > 客户资料解析文本 > 本次弹窗补充信息",
    consultingStrategyReport: latestConsultationReport
      ? String(latestConsultationReport.outputContent || "").slice(0, 9000)
      : "暂无前期咨询回应策略报告。本次应基于客户基础信息、需求、资料和跟进记录生成轻量级方案，并把缺失信息写入后续确认事项。",
    followRecordsSummary: summarizeFollowRecordsForLightweightSolution(customer, recentFollows),
    customerFilesSummary: files || "暂无已上传或已录入的客户资料解析文本。",
    salesSupplement: supplement,
    contextRules: [
      "默认继承当前客户/项目完整上下文，不要求销售重复填写项目背景。",
      "弹窗补充内容是本次生成的重要约束，尤其是基础功能模块、端口范围、已确认核心功能。",
      "如果基础功能模块、端口范围或已确认核心功能有填写，必须优先保留，不得擅自删除、替换或改变含义。",
      "AI 可以补充完整产品结构，但必须标注为「AI补充建议」或「后续扩展建议」。",
      "不得把补充功能默认写成一期必做范围。",
      "输出必须面向客户可读，不是 PRD、报价单或开发说明。",
      "AI 融入点必须围绕已有端口、已有模块、已有功能展开，不要脱离业务场景堆 AI 概念。"
    ].join("\n")
  };
}

function buildLightweightSolutionPptContext(db, customer) {
  const latestConsultationReport = db.aiGenerationRecords
    .filter((record) => record.customerId === customer.id && record.generationType === "consultation_advice")
    .filter((record) => record.inputContext?.asyncAiJob?.status !== "generating" && record.inputContext?.asyncAiJob?.status !== "failed")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const latestLightweightSolution = db.aiGenerationRecords
    .filter((record) => record.customerId === customer.id && record.generationType === "lightweight_solution")
    .filter((record) => record.inputContext?.asyncAiJob?.status !== "generating" && record.inputContext?.asyncAiJob?.status !== "failed")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const recentFollows = db.followRecords
    .filter((record) => record.customerId === customer.id)
    .sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt))
    .slice(0, 6);
  const files = db.customerFiles
    .filter((file) => file.customerId === customer.id)
    .slice(0, 5)
    .map((file) => `- ${file.fileName || "客户资料"}（${file.fileType || "资料"}）：${stripMarkdown(file.parsedText || "").slice(0, 900)}`)
    .join("\n");

  return {
    lightweightSolutionPpt: true,
    disableWebResearch: true,
    disableRag: true,
    contextPriority: "客户基础信息 > 前期咨询回应报告 > 轻量级方案 > 客户资料解析文本 > 最近6条跟进记录 > 历史生成结果",
    consultingStrategyReport: latestConsultationReport
      ? String(latestConsultationReport.outputContent || "").slice(0, 7000)
      : "暂无前期咨询回应策略报告。本次应基于客户基础信息、资料和跟进记录生成 PPT 结构稿，并把缺失信息转化为待确认内容。",
    lightweightSolutionReport: latestLightweightSolution
      ? String(latestLightweightSolution.outputContent || "").slice(0, 10000)
      : "暂无轻量级方案。生成 PPT 结构稿时不要编造已确认功能，只能基于客户档案和当前资料做初步结构，并提示建议先生成轻量级方案。",
    followRecordsSummary: summarizeFollowRecordsForLightweightSolution(customer, recentFollows),
    customerFilesSummary: files || "暂无已上传或已录入的客户资料解析文本。",
    contextRules: [
      "这一步不是重新写方案，不是 PRD，也不是报价方案，只把已有轻量方案重组为 PPT 页面结构。",
      "必须继承前期咨询回应报告和轻量级方案中的客户需求、关注点、项目判断、端口功能结构和 AI 融入点。",
      "不新增明显未确认的大功能；不改变已确认核心功能；不讲报价、合同和排期。",
      "每一页都要说明页面目标、核心内容、建议呈现形式、视觉建议和备注。",
      "PPT 生成提示词必须适合直接交给本机 PPT 生成 Skill 使用。"
    ].join("\n")
  };
}

function buildRequirementDocumentContext(db, customer) {
  const successfulCustomerRecords = db.aiGenerationRecords
    .filter((record) => record.customerId === customer.id)
    .filter((record) => record.inputContext?.asyncAiJob?.status !== "generating" && record.inputContext?.asyncAiJob?.status !== "failed")
    .sort((a, b) => {
      const aSaved = a.inputContext?.customerArchive?.savedAt ? 1 : 0;
      const bSaved = b.inputContext?.customerArchive?.savedAt ? 1 : 0;
      if (aSaved !== bSaved) return bSaved - aSaved;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  const latestConsultationReport = successfulCustomerRecords.find((record) => record.generationType === "consultation_advice");
  const latestLightweightSolution = successfulCustomerRecords.find((record) => record.generationType === "lightweight_solution");
  const latestProposalOutline = successfulCustomerRecords.find((record) => record.generationType === "proposal_outline");
  const savedArchiveRecords = successfulCustomerRecords
    .filter((record) => record.inputContext?.customerArchive?.savedAt)
    .slice(0, 5)
    .map((record) => `- ${record.title || record.generationType || "已保存AI文档"}：${stripMarkdown(record.outputContent || "").slice(0, 1400)}`)
    .join("\n");
  const recentGenerations = successfulCustomerRecords
    .filter((record) => !record.inputContext?.customerArchive?.savedAt)
    .slice(0, 5)
    .map((record) => `- ${record.title || record.generationType || "AI生成历史"}：${stripMarkdown(record.outputContent || "").slice(0, 900)}`)
    .join("\n");
  const recentFollows = db.followRecords
    .filter((record) => record.customerId === customer.id)
    .sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt))
    .slice(0, 7);
  const files = db.customerFiles
    .filter((file) => file.customerId === customer.id)
    .slice(0, 6)
    .map((file) => `- ${file.fileName || "客户资料"}（${file.fileType || "资料"}）：${stripMarkdown(file.parsedText || "").slice(0, 1100)}`)
    .join("\n");
  const memories = (db.customerMemories || [])
    .filter((memory) => memory.customerId === customer.id && memory.status !== "disabled")
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, 6)
    .map((memory) => `- ${memory.title || memory.memoryType || "客户记忆"}：${stripMarkdown(memory.content || "").slice(0, 700)}`)
    .join("\n");

  return {
    requirementDocument: true,
    disableWebResearch: true,
    contextPriority: "客户基础信息 > 已保存到客户档案的AI文档 > 客户记忆 > 客户资料解析文本 > 最近跟进记录 > 前期咨询回应报告 > 轻量级方案 > 方案大纲 > 最近生成历史",
    savedCustomerArchiveDocuments: savedArchiveRecords || "暂无已保存到客户档案的 AI 文档。本次需基于客户档案、资料和跟进记录生成，并把缺失项写入待确认问题。",
    customerMemoriesSummary: memories || "暂无客户记忆沉淀。",
    consultingStrategyReport: latestConsultationReport
      ? String(latestConsultationReport.outputContent || "").slice(0, 7000)
      : "暂无前期咨询回应策略报告。",
    lightweightSolutionReport: latestLightweightSolution
      ? String(latestLightweightSolution.outputContent || "").slice(0, 9000)
      : "暂无轻量级方案。",
    proposalOutlineReport: latestProposalOutline
      ? String(latestProposalOutline.outputContent || "").slice(0, 5200)
      : "暂无方案大纲。",
    followRecordsSummary: summarizeFollowRecordsForLightweightSolution(customer, recentFollows),
    customerFilesSummary: files || "暂无已上传或已录入的客户资料解析文本。",
    recentGenerationsSummary: recentGenerations || "暂无其他历史生成内容。",
    contextRules: [
      "需求文档必须继承当前客户的上下文记忆和已保存 AI 文档，不得跨客户引用。",
      "如果历史报告已有明确结论，需要转化为功能、端口、业务规则、AI需求和待确认项，不要重复大段复述。",
      "如果某些端口、角色、流程、权限、数据或 AI 能力缺失，不要编造，写入待确认问题。",
      "一期范围必须收敛，后续扩展能力要标注为二期增强或长期规划。",
      "AI 需求必须绑定已有业务流程、端口和功能，不要孤立堆 AI 概念。"
    ].join("\n")
  };
}

function buildSolutionDeepeningContext(db, customer) {
  const successfulCustomerRecords = db.aiGenerationRecords
    .filter((record) => record.customerId === customer.id)
    .filter((record) => record.inputContext?.asyncAiJob?.status !== "generating" && record.inputContext?.asyncAiJob?.status !== "failed")
    .sort((a, b) => {
      const aSaved = a.inputContext?.customerArchive?.savedAt ? 1 : 0;
      const bSaved = b.inputContext?.customerArchive?.savedAt ? 1 : 0;
      if (aSaved !== bSaved) return bSaved - aSaved;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  const latestConsultationReport = successfulCustomerRecords.find((record) => record.generationType === "consultation_advice");
  const latestLightweightSolution = successfulCustomerRecords.find((record) => record.generationType === "lightweight_solution");
  const latestRequirementDocument = successfulCustomerRecords.find((record) => record.generationType === "requirement_document");
  const latestProposalOutline = successfulCustomerRecords.find((record) => record.generationType === "proposal_outline");
  const latestPptOutline = successfulCustomerRecords.find((record) => record.generationType === "lightweight_solution_ppt_outline");
  const savedArchiveRecords = successfulCustomerRecords
    .filter((record) => record.inputContext?.customerArchive?.savedAt)
    .slice(0, 6)
    .map((record) => `- ${record.title || record.generationType || "已保存AI文档"}：${stripMarkdown(record.outputContent || "").slice(0, 1300)}`)
    .join("\n");
  const recentGenerations = successfulCustomerRecords
    .filter((record) => !record.inputContext?.customerArchive?.savedAt)
    .slice(0, 5)
    .map((record) => `- ${record.title || record.generationType || "AI生成历史"}：${stripMarkdown(record.outputContent || "").slice(0, 850)}`)
    .join("\n");
  const recentFollows = db.followRecords
    .filter((record) => record.customerId === customer.id)
    .sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt))
    .slice(0, 7);
  const files = db.customerFiles
    .filter((file) => file.customerId === customer.id)
    .slice(0, 6)
    .map((file) => `- ${file.fileName || "客户资料"}（${file.fileType || "资料"}）：${stripMarkdown(file.parsedText || "").slice(0, 1200)}`)
    .join("\n");
  const memories = (db.customerMemories || [])
    .filter((memory) => memory.customerId === customer.id && memory.status !== "disabled")
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, 6)
    .map((memory) => `- ${memory.title || memory.memoryType || "客户记忆"}：${stripMarkdown(memory.content || "").slice(0, 760)}`)
    .join("\n");

  return {
    solutionDeepening: true,
    disableWebResearch: true,
    userIntent: "方案强化阶段逐页页面内容稿，需要引用知识库、历史方案、客户案例、公司介绍、产品能力和售前话术。",
    ragQuery: [
      "积木科技 公司介绍 核心能力 AI解决方案 软件定制",
      `${customer.name || ""} ${customer.customerType || ""} ${customer.demandDescription || ""}`,
      "相关案例 历史方案 产品能力 售前方案强化"
    ].filter(Boolean).join("\n"),
    contextPriority: "当前客户档案 > 已保存到客户档案的AI文档 > 客户资料解析文本 > 客户记忆 > 最近跟进记录 > 前期咨询回应报告 > 轻量级方案 > 需求文档 > 方案大纲 > 知识库案例/公司介绍/产品能力 > 最近生成历史",
    savedCustomerArchiveDocuments: savedArchiveRecords || "暂无已保存到客户档案的 AI 文档。本次需基于客户档案、资料和跟进记录生成，并把缺失内容标注为待确认。",
    customerMemoriesSummary: memories || "暂无客户记忆沉淀。",
    customerFilesSummary: files || "暂无已上传或已录入的客户资料解析文本。",
    followRecordsSummary: summarizeFollowRecordsForLightweightSolution(customer, recentFollows),
    consultingStrategyReport: latestConsultationReport
      ? String(latestConsultationReport.outputContent || "").slice(0, 6500)
      : "暂无前期咨询回应策略报告。",
    lightweightSolutionReport: latestLightweightSolution
      ? String(latestLightweightSolution.outputContent || "").slice(0, 8500)
      : "暂无轻量级方案。",
    requirementDocumentReport: latestRequirementDocument
      ? String(latestRequirementDocument.outputContent || "").slice(0, 8500)
      : "暂无需求文档。",
    proposalOutlineReport: latestProposalOutline
      ? String(latestProposalOutline.outputContent || "").slice(0, 5200)
      : "暂无方案大纲。",
    pptOutlineReport: latestPptOutline
      ? String(latestPptOutline.outputContent || "").slice(0, 4200)
      : "暂无轻量级方案 PPT 结构稿。",
    recentGenerationsSummary: recentGenerations || "暂无其他历史生成内容。",
    pageTemplateRules: [
      "先输出场景定义，再输出逐页页面内容稿。",
      "每页都必须包含页面标题、页面目标、页面内容、页面建议呈现方式。",
      "核心场景页按 1 个场景 = 1 页输出，每页包含场景流程、页面示意图、价值总结。",
      "AI 场景页按 1 个 AI 场景 = 1 页输出，每页包含 AI 场景流程、AI 结果示意图、价值总结。",
      "积木科技介绍必须优先引用知识库命中的公司介绍、核心能力和相关案例；未命中时明确说明。",
      "输出为售前方案强化阶段内容稿，不是 PRD、报价单、合同、排期或开发说明。"
    ].join("\n"),
    contextRules: [
      "严格只使用当前客户上下文，不得跨客户引用。",
      "如果历史报告已有明确结论，要转化为方案强化页面内容，不要重复需求深化阶段的大段功能说明。",
      "如果客户资料、历史记录和当前档案冲突，以当前客户档案和最近跟进记录为准，并标注待确认。",
      "不要新增明显未确认的大功能；补充项必须标注为建议补充、待确认或后续扩展。",
      "场景数量必须服务方案表达，不宜过多，不要发散。",
      "AI 场景必须绑定已有业务流程、端口、模块、数据或用户操作，不要堆概念。",
      "第三方服务、硬件、接口、合规等依赖必须根据上下文或项目类型谨慎列出；没有事实依据时写依赖类型和待确认。"
    ].join("\n")
  };
}

function normalizeLightweightSolutionSupplement(value = {}) {
  return {
    basicModules: String(value.basicModules || "").trim(),
    portScope: String(value.portScope || "").trim(),
    confirmedCoreFeatures: String(value.confirmedCoreFeatures || "").trim(),
    supplementDirections: String(value.supplementDirections || "").trim(),
    aiNeeds: String(value.aiNeeds || "").trim(),
    notes: String(value.notes || "").trim()
  };
}

function summarizeFollowRecordsForLightweightSolution(customer, follows) {
  const rows = follows.map((record) => {
    const time = record.followTime || record.createdAt || "";
    const stage = record.stage || customer.stage || "";
    const content = stripMarkdown(record.content || "").slice(0, 220);
    const feedback = stripMarkdown(record.customerFeedback || "").slice(0, 220);
    const nextAction = stripMarkdown(record.nextAction || "").slice(0, 180);
    return `- ${time ? `${time} ` : ""}${stage ? `阶段：${stage}。` : ""}${content ? `沟通内容：${content}。` : ""}${feedback ? `客户反馈：${feedback}。` : ""}${nextAction ? `下一步：${nextAction}。` : ""}`;
  });
  return rows.length ? rows.join("\n") : "暂无跟进记录。请基于客户基础信息生成，并在后续建议确认事项中提示需要补齐沟通记录。";
}

function summarizeFollowRecordsForNextQuestions(customer, follows) {
  const confirmed = follows
    .map((record) => record.customerFeedback || record.aiSummary || record.content)
    .filter(Boolean)
    .slice(0, 5);
  const promises = follows
    .map((record) => record.nextAction || record.internalJudgement)
    .filter(Boolean)
    .slice(0, 5);
  const missing = [
    customer.demandDescription ? "" : "客户原始需求",
    customer.background ? "" : "客户业务背景",
    customer.problemToSolve ? "" : "想解决的问题",
    customer.existingSystem ? "" : "已有系统或业务基础",
    customer.budgetInfo ? "" : "预算信息",
    customer.decisionInfo ? "" : "决策链信息"
  ].filter(Boolean);
  const concernSource = [
    customer.problemToSolve,
    customer.knownRisks,
    customer.nextAction,
    ...follows.map((record) => record.customerFeedback || record.content)
  ].filter(Boolean).join("；");

  return [
    "## 已确认事项",
    confirmed.length ? confirmed.map((item) => `- ${stripMarkdown(item).slice(0, 220)}`).join("\n") : "- 暂无明确已确认事项。",
    "",
    "## 未确认事项",
    missing.length ? missing.map((item) => `- ${item}`).join("\n") : "- 仍需确认 MVP 范围、AI 预期、预算区间、决策链、上线时间和验收指标。",
    "",
    "## 客户反复关注点",
    concernSource ? `- ${stripMarkdown(concernSource).slice(0, 520)}` : "- 暂无足够跟进记录，需在本次沟通中确认客户真实关注点。",
    "",
    "## 我方已承诺事项",
    promises.length ? promises.map((item) => `- ${stripMarkdown(item).slice(0, 220)}`).join("\n") : "- 暂无明确承诺事项。",
    "",
    "## 下一步待办",
    customer.nextAction ? `- ${stripMarkdown(customer.nextAction).slice(0, 260)}` : "- 本次沟通后需要明确下一步材料、会议对象和推进时间。"
  ].join("\n");
}

function buildPendingConsultationAdviceGeneration({ customer, files = [], skillId = "", userId = "", reason = "" }) {
  const title = `${customer?.name || "客户"} - 客户前期咨询回应策略报告`;
  const startedAt = nowIso();
  return {
    title,
    generationType: "consultation_advice",
    skillId,
    modelName: BACKGROUND_AI_MODEL_NAME,
    prompt: "background consultation advice generation",
    inputContext: {
      asyncAiJob: {
        kind: "consultation_advice",
        status: "generating",
        startedAt,
        customerId: customer?.id || "",
        uploadedFileCount: files.length,
        reason,
        timeoutMs: getBackgroundAiJobTimeoutMs("consultation_advice"),
        steps: [
          buildAsyncJobStep("queued", "任务已排队", "done", "客户已保存，已创建前期咨询建议任务。", startedAt),
          buildAsyncJobStep("read_context", "解析客户资料", "running", files.length ? `正在读取 ${files.length} 份客户资料和客户基础信息。` : "正在读取客户基础信息。", startedAt),
          buildAsyncJobStep("call_model", "调用前期咨询 Skill", "pending", "等待模型生成咨询回应策略。", startedAt),
          buildAsyncJobStep("write_result", "写入生成结果", "pending", "等待生成完成后写入历史记录。", startedAt)
        ]
      },
      consultationAdvice: {
        customerId: customer?.id || "",
        customerName: customer?.name || "",
        uploadedFiles: files.map((file) => ({
          fileName: file.fileName,
          fileType: file.fileType,
          parsedTextPreview: String(file.parsedText || "").slice(0, 800)
        }))
      },
      generatedBy: userId
    },
    outputContent: [
      `# ${title}`,
      "",
      `> ${reason || "后台生成中，请稍后查看。"}`
    ].join("\n"),
    createdAt: startedAt
  };
}

function buildPendingBackgroundGeneration({ db, type, customer, skillId = "", userId = "", message = "", extraContext = {}, reason = "" }) {
  const generationType = normalizeBackgroundGenerationType(type);
  const label = GENERATION_LABELS_FOR_SYNC[generationType] || generationType || "AI 生成";
  const title = customer ? `${customer.name} - ${label}` : label;
  const startedAt = nowIso();
  return {
    title,
    generationType,
    skillId,
    modelName: BACKGROUND_AI_MODEL_NAME,
    prompt: "background ai generation",
    inputContext: {
      asyncAiJob: {
        kind: generationType,
        status: "generating",
        startedAt,
        customerId: customer?.id || "",
        reason,
        timeoutMs: getBackgroundAiJobTimeoutMs(generationType),
        steps: [
          buildAsyncJobStep("queued", "任务已排队", "done", "已创建后台生成任务。", startedAt),
          buildAsyncJobStep("read_context", "读取客户上下文", "running", customer ? "正在读取客户基础信息、跟进记录、资料和历史生成记录。" : "正在读取默认工作台上下文。", startedAt),
          buildAsyncJobStep("call_model", "调用 AI 与 Skill", "pending", "等待模型与 Skill 执行。", startedAt),
          buildAsyncJobStep("write_result", "写入生成结果", "pending", "等待生成完成后写入历史记录。", startedAt)
        ]
      },
      customerId: customer?.id || "",
      message: String(message || "").slice(0, 2000),
      extra: extraContext,
      generatedBy: userId
    },
    outputContent: [
      `# ${title}`,
      "",
      `> ${reason || "后台生成中，请稍后在帮助中心查看结果。"}`
    ].join("\n"),
    createdAt: startedAt
  };
}

function normalizeBackgroundGenerationType(type = "") {
  const value = String(type || "").trim();
  return GENERATION_LABELS_FOR_SYNC[value] ? value : "follow_strategy";
}

function buildConsultationAdviceTimeoutGeneration({ customer, files = [], skillId = "", reason = "" }) {
  const demand = customer?.demandDescription || customer?.problemToSolve || "客户需求仍需补充";
  const foundation = customer?.existingSystem || customer?.background || "待确认";
  const pain = customer?.problemToSolve || demand;
  const fileList = files.length
    ? files.map((file) => `- ${file.fileName}：${String(file.parsedText || "").replace(/\s+/g, " ").slice(0, 160)}`).join("\n")
    : "- 暂无上传资料或资料未解析出有效文本";

  return {
    title: `${customer?.name || "客户"} - 客户前期咨询回应策略报告`,
    generationType: "consultation_advice",
    skillId,
    modelName: "本地快速报告",
    prompt: "local consultation advice timeout fallback",
    inputContext: {
      timeoutFallback: true,
      reason,
      customerId: customer?.id || "",
      uploadedFileCount: files.length
    },
    outputContent: [
      `# ${customer?.name || "客户"} - 客户前期咨询回应策略报告`,
      "",
      `> ${reason || "已使用本地快速报告，客户和资料已正常保存。"}`,
      "",
      "## 1. 客户需求理解",
      "",
      `- 客户想做什么：${demand}`,
      `- 已有业务基础：${foundation}`,
      `- 这个项目对客户意味着：围绕「${pain}」建立可落地、可分阶段推进的业务系统和 AI 能力。`,
      "- 不能简单理解成：不是单纯做功能清单，也不是只加一个 AI 聊天框。",
      `- 销售一句话复述：我们理解您是希望先把核心业务流程跑顺，再在关键节点加入 AI，降低人工整理和重复沟通成本。`,
      "",
      "## 2. 客户真实意图与隐性诉求",
      "",
      "| 分析项 | 内容 |",
      "|---|---|",
      `| 客户表面需求 | ${demand} |`,
      `| 客户真实想解决的问题 | ${pain} |`,
      "| 客户希望听到我们怎么理解 | 先复述业务问题、已有基础和 MVP 切口，再说明 AI 应该嵌入哪些节点。 |",
      "| 客户隐性诉求 | 控制范围、降低交付风险、拿到能内部沟通的材料。 |",
      "| 我们应该给出的解决方向 | 输出需求理解、MVP 范围、AI 融入点和下一步澄清问题。 |",
      "",
      "## 3. 客户关注点与对应解决方案",
      "",
      "| 客户关注点 | 为什么客户会关注 | 如果我是客户，我希望听到什么 | 我们应该给出的解决方案 | 销售沟通策略 |",
      "|---|---|---|---|---|",
      "| MVP 范围 | 客户担心项目过大 | 先告诉我一期做什么 | 拆一期必做、二期扩展、暂缓事项 | 用范围收敛推动下一次会议 |",
      "| AI 价值 | 客户担心 AI 只是噱头 | 告诉我 AI 放在哪里有效 | 绑定资料解析、总结、推荐、风险判断 | 不夸大模型能力 |",
      "| 现有系统衔接 | 客户已有基础 | 不要推倒重来 | 做接口、数据、权限调研 | 索要系统和资料清单 |",
      "| 成本周期 | 预算未必明确 | 给我阶段路径 | 分阶段报价和交付 | 避免一开始完整报价 |",
      "| 内部决策 | 客户需要向内部解释 | 给我能汇报的材料 | 一页式需求理解和方案大纲 | 帮客户降低内部沟通成本 |",
      "",
      "## 4. 业务系统 + AI 融入判断",
      "",
      "- 业务系统主线：先围绕客户核心业务流程搭建数据和任务闭环。",
      "- AI 嵌入节点：资料解析、需求总结、智能推荐、内容生成、风险提醒。",
      "- 当前阶段最适合先做：AI 辅助理解、总结和推荐，不建议先承诺复杂自动决策。",
      "",
      "## 5. AI 原生应用升级判断",
      "",
      "- 当前不建议直接把项目定义成完整 AI 原生应用。",
      "- 建议路径：一期业务系统 + 数据沉淀；二期 AI 助手和智能推荐；三期 Agent/工作流自动化。",
      "",
      "## 6. 案例匹配与销售讲法",
      "",
      "| 可参考案例类型 | 为什么适合参考 | 可以借鉴什么 | 销售应该怎么讲 |",
      "|---|---|---|---|",
      "| 业务系统 + AI 类项目 | 与当前客户类型相近 | MVP 拆分、AI 融入点、实施节奏 | 我们不会直接套模板，会先按您当前流程重做一期切口 |",
      "",
      "## 7. 下一步客户期待的行动建议",
      "",
      "| 客户期待 | 说明 | 销售下一步应该做什么 | 交付给客户的内容 |",
      "|---|---|---|---|",
      "| 被理解 | 客户希望乙方听懂业务 | 发送需求复述 | 客户需求理解摘要 |",
      "| 看到切口 | 客户担心范围失控 | 拆 MVP | MVP 范围建议 |",
      "| 有下次会议价值 | 客户不想空聊 | 发问题清单 | 需求澄清问题清单 |",
      "",
      "## 8. 销售人员沟通策略",
      "",
      "### 8.1 下一次沟通目标",
      "确认业务流程、MVP 范围、AI 融入点、预算区间和决策链。",
      "",
      "### 8.2 下一次必须确认的问题",
      "- 项目最优先解决的业务问题是什么？",
      "- 哪些流程必须一期上线？",
      "- 目前有哪些数据、文档和系统？",
      "- 谁推动、谁使用、谁最终决策？",
      "- 预算区间和上线时间是否有预期？",
      "- 项目成功的衡量指标是什么？",
      "- 是否需要我们准备内部汇报材料？",
      "- 是否有必须对接的系统或硬件？",
      "",
      "### 8.3 沟通中应该如何表达",
      "我们先不急着做完整方案，建议先把业务目标、现有基础和一期可落地范围拆清楚。会后我们给您一份需求理解、MVP 范围和 AI 融入点建议。",
      "",
      "### 8.4 沟通中不要怎么说",
      "- 不要直接承诺完整 AI 原生应用。",
      "- 不要在预算和范围不清楚时直接报价。",
      "- 不要把客户需求只复述成功能清单。",
      "",
      "## 9. 销售人员行动汇总",
      "",
      "### 9.1 当前跟进结论",
      "先做轻量需求澄清和 MVP 切口判断，暂不重投入完整方案。",
      "",
      "### 9.2 下一步优先动作",
      "| 优先级 | 行动事项 | 目的 | 执行方式 | 产出物 |",
      "|---|---|---|---|---|",
      "| P0 | 发送需求复述 | 建立理解感 | 微信/邮件 | 需求理解摘要 |",
      "| P1 | 约澄清会 | 确认范围和决策 | 会议 | 会议纪要 |",
      "| P2 | 拆 MVP | 控制风险 | 内部售前评估 | MVP 范围表 |",
      "| P3 | 梳理 AI 节点 | 说明 AI 价值 | 结合流程 | AI 融入点清单 |",
      "| P4 | 准备案例讲法 | 帮客户理解落地 | 引用案例类型 | 案例讲法材料 |",
      "",
      "### 9.3 本次应准备的材料",
      "- 客户需求理解摘要",
      "- MVP 范围建议",
      "- 需求澄清问题清单",
      "- AI 融入点分析",
      "",
      "### 9.4 暂时不要做的事情",
      "- 暂时不要做完整 PRD、固定报价或复杂 AI 承诺。",
      "",
      "### 9.5 是否进入下一阶段",
      "建议继续轻咨询，并准备进入需求沟通/需求深化。",
      "",
      "## 已解析客户资料",
      "",
      fileList
    ].join("\n"),
    createdAt: nowIso()
  };
}

function extractInteractionDrafts(markdown = "", imageCount = 3, fallbackContext = {}) {
  const parsed = parseFirstJsonObject(markdown);
  const rawScreens = Array.isArray(parsed?.screens)
    ? parsed.screens
    : Array.isArray(parsed?.items) ? parsed.items : [];
  const screens = rawScreens.length
    ? rawScreens
    : buildFallbackInteractionDrafts(fallbackContext, imageCount);
  return normalizeInteractionImagePrompts(screens).slice(0, imageCount);
}

function parseFirstJsonObject(text = "") {
  const source = String(text || "");
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidates = [fenced, source.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

function normalizeInteractionImagePrompts(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      const prompt = String(item.prompt || item.imagePrompt || item.image2Prompt || "").trim();
      if (!prompt) return null;
      const device = normalizeInteractionDevice(item.device || "桌面端");
      return {
        id: String(item.id || `image_${index + 1}`).trim(),
        title: String(item.title || item.name || `界面 ${index + 1}`).trim().slice(0, 80),
        device,
        goal: String(item.goal || item.objective || "").trim().slice(0, 800),
        layout: String(item.layout || item.description || item.content || "").trim().slice(0, 1600),
        prompt: ensureInteractionPromptDevice(prompt, device)
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeInteractionDevice(value = "") {
  const text = String(value || "").trim();
  if (/响应式|画板|多端/i.test(text)) return "响应式画板";
  if (/双端|桌面.*移动|移动.*桌面|pc.*mobile|mobile.*pc|电脑.*手机|手机.*电脑/i.test(text)) return "桌面端 + 移动端";
  if (/手机|移动|mobile|小程序|app/i.test(text)) return "移动端";
  return "桌面端";
}

function ensureInteractionPromptDevice(prompt = "", device = "桌面端") {
  const cleanPrompt = String(prompt || "").trim();
  const deviceInstruction = buildInteractionDeviceInstruction(device);
  if (!deviceInstruction) return cleanPrompt;
  const negativeInstruction = device === "桌面端"
    ? "除非用户特别要求，不要额外生成手机端框。"
    : device === "移动端"
      ? "除非用户特别要求，不要额外生成电脑端框。"
      : "";
  return [
    cleanPrompt,
    "",
    `设备呈现要求：${deviceInstruction}`,
    negativeInstruction
  ].filter(Boolean).join("\n");
}

function buildInteractionDeviceInstruction(device = "桌面端") {
  if (device === "移动端") return "仅生成手机端 / 移动端界面，使用手机框或移动端画布，重点呈现移动端关键路径。";
  if (device === "桌面端 + 移动端") return "同时生成桌面端电脑框与手机端框，二者展示同一产品的响应式关键界面。";
  if (device === "响应式画板") return "生成响应式画板，可包含桌面、平板、手机等多端对比，但需要保持一张图内的信息层级清晰。";
  return "仅生成桌面端 / PC 端界面，使用电脑框或宽屏 Web 产品画布，重点呈现工作台、列表、详情或管理后台。";
}

function buildFallbackInteractionDrafts({ customer, style, websiteType, extraRequirement, defaultDevice = "桌面端" } = {}, imageCount = 3) {
  const demand = customer?.demandDescription || customer?.problemToSolve || "客户业务系统";
  const normalizedDefaultDevice = normalizeInteractionDevice(defaultDevice);
  const base = [
    ["产品首页 / 工作台", "桌面端", "展示项目核心业务入口、关键数据、AI 推荐动作和下一步任务。"],
    ["核心业务列表与详情", "桌面端", "展示业务对象如何被统一管理，并能进入详情查看上下文与记录。"],
    ["AI 分析与方案生成", "桌面端", "展示 AI 如何读取客户上下文，生成策略、问题清单、方案和风险提醒。"],
    ["资料与知识库", "桌面端", "展示上传资料、解析、切片、RAG 引用和文档沉淀流程。"],
    ["移动端关键路径", "移动端", "展示移动端摘要、操作 CTA、消息提醒和 AI 推荐动作。"],
    ["数据复盘看板", "桌面端", "展示运营数据、进度状态、风险提醒和结果复盘。"],
    ["多端协同结构", "响应式画板", "展示用户端、管理端、员工端/商家端之间的协同关系。"],
    ["客户可读文档", "桌面端", "展示目录导航、Markdown 正文、表格、流程图和导出操作。"]
  ];
  return base.slice(0, imageCount).map(([title, recommendedDevice, goal], index) => {
    const device = normalizedDefaultDevice === "桌面端"
      ? normalizeInteractionDevice(recommendedDevice)
      : normalizedDefaultDevice;
    return {
      id: `image_${index + 1}`,
      title,
      device,
      goal,
      layout: device === "移动端"
        ? "移动端顶部摘要、关键操作 CTA、纵向卡片列表、AI 推荐动作入口。"
        : device === "桌面端 + 移动端"
          ? "桌面端左侧导航、顶部操作区、主内容卡片、右侧 AI 建议；移动端为纵向卡片和底部操作入口。"
          : device === "响应式画板"
            ? "中心业务流 + 多端卡片矩阵 + AI 能力穿插节点，适合放入售前 PPT。"
            : "桌面端左侧导航、顶部操作区、主内容卡片、右侧 AI 建议，适合宽屏 Web 产品展示。",
      prompt: ensureInteractionPromptDevice([
        `为「${customer?.name || "客户项目"}」生成第 ${index + 1} 张高保真产品交互设计图：${title}。`,
        `项目类型：${websiteType || customer?.customerType || "企业级 Web 系统"}；视觉风格：${style || "飞书风、简洁专业、浅色 SaaS"}。`,
        `客户需求：${demand}`,
        `页面目标：${goal}`,
        `设备呈现：${buildInteractionDeviceInstruction(device)}`,
        "中文 UI 文案清晰，真实 SaaS 产品截图质感，卡片高度统一，信息层级克制。",
        "避免抽象科技海报、无意义大图、错误中文、杂乱仪表盘和与业务无关的装饰。",
        extraRequirement ? `额外要求：${extraRequirement}` : ""
      ].filter(Boolean).join("\n"), device)
    };
  });
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function isRemoteFailureMarkdown(markdown = "") {
  return /调用失败|错误摘要|未返回成功结果|invalid_api_key|Incorrect API key|Responses API 兼容接口未返回成功结果/i.test(String(markdown || ""));
}

async function generateInteractionPromptWithFallback({ db, body, actor, customer, config }) {
  const promptPromise = generateCrmContent({
    db,
    type: "interaction_image_prompt",
    customerId: body.customerId,
    skillId: body.skillId,
    userId: body.userId || actor.user.id,
    message: body.extraRequirement,
      extraContext: {
        interactionStyle: body.style,
        websiteType: body.websiteType,
        extraRequirement: body.extraRequirement,
        outputTarget: "image2",
        defaultDevice: normalizeInteractionDevice(body.defaultDevice || "桌面端")
      },
    modelId: body.modelId,
    config
  }).catch((error) => buildFallbackPromptGeneration({
    customer,
    body,
    reason: `远程提示词生成失败：${redactApiError(error.message || "未知错误")}`
  }));

  return withSoftTimeout(
    promptPromise,
    Number(config.image2PromptTimeoutMs || 25000),
    () => buildFallbackPromptGeneration({
      customer,
      body,
      reason: `远程提示词生成超过 ${Math.round(Number(config.image2PromptTimeoutMs || 25000) / 1000)} 秒，系统已停止生成，不再使用本地提示词兜底。`
    })
  );
}

function buildFallbackPromptGeneration({ customer, body, reason }) {
  return {
    title: `${customer?.name || "客户"} - 交互图提示词`,
    generationType: "interaction_image_prompt",
    skillId: body.skillId || "skill_17",
    modelName: "AI 提示词生成失败",
    prompt: "remote interaction image prompt failed",
    inputContext: {
      isolation: {
        scope: "single_customer",
        customerId: customer?.id || "",
        rule: "本次 AI 只能读取和写入当前客户的上下文与记忆。"
      },
      customer: {
        id: customer?.id || "",
        name: customer?.name || "",
        customerType: customer?.customerType || "",
        stage: customer?.stage || "",
        demandDescription: customer?.demandDescription || "",
        background: customer?.background || "",
        problemToSolve: customer?.problemToSolve || "",
        existingSystem: customer?.existingSystem || "",
        knownRisks: customer?.knownRisks || ""
      },
      extra: {
        interactionStyle: body.style || "",
        websiteType: body.websiteType || "",
        extraRequirement: body.extraRequirement || "",
        fallbackReason: reason
      }
    },
    outputContent: buildImagePromptFailureMarkdown({
      title: `${customer?.name || "客户"} - 交互图提示词`,
      reason,
      generationType: "interaction_image_prompt"
    }),
    createdAt: nowIso()
  };
}

function withSoftTimeout(promise, timeoutMs, onTimeout) {
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(onTimeout()), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function getBackgroundAiJobTimeoutMs(type = "", config = {}) {
  const generationType = normalizeBackgroundGenerationType(type);
  if (generationType === "lightweight_solution_ppt") {
    return Math.max(Number(config.pptTaskTimeoutMs || 0), PPT_TASK_POLL_TIMEOUT_MS);
  }
  if (["historical_solution_entry", "consultation_advice", "solution_deepening", "lightweight_solution", "requirement_document"].includes(generationType)) {
    return Math.max(Number(config.backgroundAiTimeoutMs || 0), LONG_BACKGROUND_AI_TIMEOUT_MS);
  }
  return Math.max(Number(config.backgroundAiTimeoutMs || 0), DEFAULT_BACKGROUND_AI_TIMEOUT_MS);
}

function buildAsyncJobStep(id, title, status, summary, startedAt = nowIso()) {
  return {
    id,
    title,
    status,
    summary,
    detail: summary,
    updatedAt: startedAt
  };
}

function mergeAsyncJobSteps(existingSteps = [], nextSteps = []) {
  const map = new Map();
  for (const step of ensureArray(existingSteps)) {
    if (step?.id) map.set(step.id, step);
  }
  for (const step of ensureArray(nextSteps)) {
    if (step?.id) map.set(step.id, { ...map.get(step.id), ...step });
  }
  return Array.from(map.values());
}

async function updateCrmGenerationJobStep(recordId, stepPatch) {
  await withCrmDb((db) => {
    const existing = db.aiGenerationRecords.find((item) => item.id === recordId);
    if (!existing) return null;
    const currentSteps = existing.inputContext?.asyncAiJob?.steps || [];
    const nextSteps = mergeAsyncJobSteps(currentSteps, [stepPatch]);
    return upsertCollectionItem(db, "aiGenerationRecords", {
      ...existing,
      inputContext: {
        ...(existing.inputContext || {}),
        asyncAiJob: {
          ...(existing.inputContext?.asyncAiJob || {}),
          steps: nextSteps,
          status: stepPatch.status === "failed" ? "failed" : "generating",
          updatedAt: nowIso()
        }
      }
    });
  });
}

function buildTimedOutGeneration({ db, body, customer, actorUser, config }) {
  const type = normalizeBackgroundGenerationType(body.type);
  const label = GENERATION_LABELS_FOR_SYNC[type] || type || "AI 生成";
  const timeoutMs = getBackgroundAiJobTimeoutMs(type, config);
  return {
    title: `${customer?.name || "客户"} - ${label}`,
    generationType: type,
    skillId: body.skillId || "",
    modelName: BACKGROUND_AI_MODEL_NAME,
    prompt: "background ai generation timeout",
    inputContext: {
      generatedBy: actorUser.id,
      customer: customer ? {
        id: customer.id,
        name: customer.name,
        stage: customer.stage,
        customerType: customer.customerType,
        demandDescription: customer.demandDescription,
        problemToSolve: customer.problemToSolve
      } : null,
      message: String(body.message || "").slice(0, 2000),
      extra: body.extraContext || {},
      asyncAiJob: {
        kind: type,
        status: "failed",
        startedAt: nowIso(),
        finishedAt: nowIso(),
        customerId: customer?.id || "",
        timeoutMs,
        error: `后台生成超过 ${Math.round(timeoutMs / 1000)} 秒，系统已停止等待，请重新生成。`,
        steps: [
          buildAsyncJobStep("queued", "任务已排队", "done", "已创建后台生成任务。"),
          buildAsyncJobStep("read_context", "读取客户上下文", "done", customer ? `已读取 ${customer.name} 的客户上下文。` : "已读取默认工作台上下文。"),
          buildAsyncJobStep("call_model", "调用 AI 与 Skill", "failed", `后台生成超过 ${Math.round(timeoutMs / 1000)} 秒，系统已停止等待。`),
          buildAsyncJobStep("write_result", "写入结果", "failed", "未写入结果，请重新生成。")
        ]
      },
      timeoutReason: `超过 ${Math.round(timeoutMs / 1000)} 秒`
    },
    outputContent: [
      `# ${customer?.name || "客户"} - ${label}`,
      "",
      `> 后台生成超时：超过 ${Math.round(timeoutMs / 1000)} 秒，系统已停止等待，请重新生成。`,
      "",
      "## 当前状态",
      "",
      "- 状态：生成失败",
      "- 原因：后台任务超时或模型/Skill 执行过慢。",
      "- 建议：先检查模型配置、API Key 和该 Skill 的输入上下文大小，再重新生成。"
    ].join("\n"),
    createdAt: nowIso()
  };
}

function extractFailureSummary(markdown = "") {
  const text = String(markdown || "");
  const match = text.match(/>\s*([^>\n]{8,220})/);
  return match ? match[1].trim() : "";
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function saveGenerationRecord(db, body, actor, generation) {
  return upsertCollectionItem(db, "aiGenerationRecords", {
    customerId: body.customerId || "",
    userId: body.userId || actor.user.id,
    generationType: generation.generationType,
    inputContext: generation.inputContext,
    prompt: generation.prompt,
    modelName: generation.modelName,
    outputContent: generation.outputContent,
    skillId: generation.skillId,
    title: generation.title,
    createdAt: generation.createdAt
  });
}

function isUsableImagePrompt(imagePrompt = "", promptDraft = "") {
  const prompt = String(imagePrompt || "").trim();
  if (prompt.length < 120) return false;
  if (/调用失败|错误摘要|未返回成功结果|API Key|Base URL/i.test(promptDraft)) return false;
  return /电脑|桌面|desktop|手机|mobile|frame|界面|UI|交互/i.test(prompt);
}

function redactApiError(text = "") {
  return String(text || "").replace(/sk-[^\s"'，。；、）)]+/g, "sk-***").slice(0, 500);
}

function firstNonEmpty(values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function buildHistoryFeishuCapture({ record, customer, actor, syncedAt = nowIso() }) {
  const generationLabel = GENERATION_LABELS_FOR_SYNC[record.generationType] || record.generationType || "AI 生成";
  const title = [
    customer?.name || "默认 AI 工作台",
    record.title || generationLabel
  ].filter(Boolean).join(" - ").slice(0, 96);
  const markdown = [
    `# ${record.title || generationLabel}`,
    "",
    "## 同步信息",
    "",
    `- 客户：${customer?.name || "默认 AI 工作台"}`,
    `- 生成类型：${generationLabel}`,
    `- 生成模型：${record.modelName || "未记录"}`,
    `- 生成时间：${formatSyncDate(record.createdAt)}`,
    `- 同步人：${actor?.name || "内部用户"}`,
    `- 同步时间：${formatSyncDate(syncedAt)}`,
    "",
    "## 正文",
    "",
    record.outputContent || "暂无内容"
  ].join("\n");

  return {
    title,
    summary: stripMarkdown(record.outputContent || "").slice(0, 220) || "AI CRM 生成历史同步",
    contentType: "crm_ai_generation_history",
    tags: ["AI CRM", "生成历史", generationLabel, customer?.name || "默认工作台"].filter(Boolean),
    markdown,
    sourceTitle: record.title || generationLabel,
    sourceUrl: "",
    userNote: "从 AI CRM 生成历史同步到飞书"
  };
}

function saveGenerationToCustomerIfNeeded(db, body, generation) {
  if (!body.saveToCustomer || !body.customerId) return;
  const customer = db.customers.find((item) => item.id === body.customerId);
  if (!customer) return;
  customer.internalNotes = [
    customer.internalNotes,
    `AI保存：${generation.title}\n${generation.outputContent.slice(0, 1000)}`
  ].filter(Boolean).join("\n\n");
  customer.updatedAt = nowIso();
}

function saveCustomerMemoryFromGeneration(db, body, actor, generation, record) {
  if (!body.customerId || !generation?.outputContent || !db.customerMemories) return null;
  const customer = db.customers.find((item) => item.id === body.customerId);
  if (!customer) return null;

  const strategy = generation.inputContext?.customerMemoryStrategy || {};
  const memoryType = generation.generationType === "chat"
    ? "conversation_memory"
    : `${generation.generationType}_memory`;
  const title = `${customer.name} · ${generation.title || "AI 记忆"}`;
  const sourceRecordId = record?.id || "";
  const existing = sourceRecordId
    ? db.customerMemories.find((item) => item.sourceRecordId === sourceRecordId)
    : null;

  return upsertCollectionItem(db, "customerMemories", {
    id: existing?.id,
    customerId: body.customerId,
    userId: body.userId || actor.user.id,
    memoryType,
    strategy: strategy.strategyName || "通用客户记忆",
    title,
    content: buildCustomerMemoryContent({ body, generation, strategy }),
    sourceType: "ai_generation",
    sourceRecordId,
    status: "active",
    createdAt: generation.createdAt || nowIso()
  });
}

function buildCustomerMemoryContent({ body, generation, strategy }) {
  const userInput = String(body.message || body.extraContext?.failureDescription || "").trim();
  return [
    `记忆策略：${strategy?.strategyName || "通用客户记忆"}`,
    strategy?.remember?.length ? `本阶段重点记忆：${strategy.remember.join("、")}` : "",
    userInput ? `用户输入：${userInput.slice(0, 500)}` : "",
    `AI 生成类型：${generation.generationType}`,
    `AI 结论摘要：${stripMarkdown(generation.outputContent).slice(0, 1200)}`
  ].filter(Boolean).join("\n");
}

function stripMarkdown(markdown = "") {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, (match) => match.replace(/^\[|\]\([^)]*\)$/g, ""))
    .replace(/[#>*_`~|[\]-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSyncDate(value) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function resolveCrmActor(db, headers = {}, config = {}) {
  const token = getHeader(headers, "x-crm-token");
  if (!token) return { user: null, error: "请先登录" };

  try {
    const verified = verifyCrmToken(token, config);
    if (!verified.ok) return { user: null, error: verified.error };
    const userId = verified.userId;
    const user = db.users.find((item) => item.id === userId && item.status === "active");
    if (!user) return { user: null, error: "登录已失效，请重新登录" };
    return { user, error: "" };
  } catch {
    return { user: null, error: "登录已失效，请重新登录" };
  }
}

function createCrmToken(userId, config = {}) {
  const issuedAt = Date.now();
  const payload = Buffer.from(JSON.stringify({ userId, issuedAt }), "utf8").toString("base64url");
  const signature = signCrmPayload(payload, config);
  return `${payload}.${signature}`;
}

function verifyCrmToken(token, config = {}) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return { ok: false, error: "登录已失效，请重新登录" };

  const expected = signCrmPayload(payload, config);
  if (!safeEqual(signature, expected)) return { ok: false, error: "登录已失效，请重新登录" };

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const ttlMs = Number(config.crmSessionTtlHours || 168) * 60 * 60 * 1000;
  if (!parsed.userId || !parsed.issuedAt || Date.now() - Number(parsed.issuedAt) > ttlMs) {
    return { ok: false, error: "登录已过期，请重新登录" };
  }
  return { ok: true, userId: parsed.userId };
}

function signCrmPayload(payload, config = {}) {
  const secret = String(config.crmAuthSecret || "dev-only-change-me");
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getHeader(headers, name) {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === lowerName) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return "";
}

function canMutateCollection(user, collection) {
  if (user.role === "admin") return true;
  return !ADMIN_COLLECTIONS.has(collection);
}

function validateCrmUpsert(db, collection, item = {}) {
  const requiredNameCollections = ["customers", "stages", "skills", "promptTemplates", "models", "knowledgeBases"];
  if (requiredNameCollections.includes(collection) && !String(item.name || "").trim()) {
    return `${collection} name is required`;
  }

  if (collection === "users") {
    const email = String(item.email || "").trim().toLowerCase();
    if (!String(item.name || "").trim()) return "用户姓名不能为空";
    if (!email) return "用户邮箱不能为空";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "用户邮箱格式不正确";
    if (!item.id && !String(item.password || "").trim()) return "新增用户必须设置密码";
    if (String(item.password || "").trim() && String(item.password).length < 6) return "密码至少需要 6 位";
    if (item.role && !["admin", "internal_user"].includes(item.role)) return "用户角色不正确";
    if (item.status && !["active", "disabled"].includes(item.status)) return "用户状态不正确";
    const duplicated = db.users.find((user) => user.email.toLowerCase() === email && user.id !== item.id);
    if (duplicated) return "该邮箱已存在，请换一个邮箱或编辑已有用户";
    const existing = item.id ? db.users.find((user) => user.id === item.id) : null;
    if (existing?.role === "admin" && item.status === "disabled") {
      const otherActiveAdmins = db.users.filter((user) => user.id !== item.id && user.role === "admin" && user.status === "active");
      if (!otherActiveAdmins.length) return "至少需要保留一个可用管理员账号";
    }
  }

  if (collection === "followRecords") {
    if (!item.customerId) return "跟进记录必须关联客户";
    if (!String(item.content || "").trim()) return "跟进内容不能为空";
  }

  if (collection === "customerFiles") {
    if (!item.customerId) return "客户资料必须关联客户";
    if (!String(item.fileName || "").trim()) return "资料名称不能为空";
  }

  if (collection === "customerMemories") {
    if (!item.customerId) return "客户记忆必须关联客户";
    if (!String(item.content || "").trim()) return "客户记忆内容不能为空";
  }

  if (collection === "reportFeedbacks") {
    if (!item.recordId) return "报告反馈必须关联 AI 生成历史";
    if (!String(item.feedbackContent || "").trim()) return "反馈内容不能为空";
  }

  return "";
}

function applyCollectionSideEffects(db, collection, item) {
  if (collection === "models" && item.isDefault) {
    for (const model of db.models) {
      if (model.id !== item.id) model.isDefault = false;
    }
  }

  if (collection === "users") {
    item.email = String(item.email || "").trim().toLowerCase();
  }
}

function preserveSensitiveFields(db, collection, item) {
  if (!item?.id) return item;
  const existing = db[collection]?.find((entry) => entry.id === item.id);
  if (!existing) return item;

  if (collection === "users" && !item.password && !item.passwordHash) {
    return {
      ...item,
      passwordHash: existing.passwordHash
    };
  }

  if (collection === "models" && item.apiKey === "已配置") {
    return {
      ...item,
      apiKey: existing.apiKey
    };
  }

  if (collection === "knowledgeBases" && !Array.isArray(item.documents)) {
    return {
      ...item,
      documents: existing.documents || []
    };
  }

  return item;
}

function sanitizeCrmItem(collection, item) {
  if (collection === "users") {
    const { passwordHash, ...rest } = item;
    return rest;
  }

  if (collection === "models") {
    return {
      ...item,
      apiKey: item.apiKey ? "已配置" : ""
    };
  }

  return item;
}

function extractReactivateSuggestion(markdown) {
  const match = String(markdown || "").match(/## 是否值得重新激活\s+([\s\S]+?)(?:\n## |$)/);
  return match ? match[1].trim().slice(0, 800) : "";
}

function writeJsonResponse(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function writeSseHeaders(response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
}

function writeSseEvent(response, event, payload) {
  if (response.destroyed || response.writableEnded) return;
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function redactStreamError(text) {
  return String(text || "")
    .replace(/sk-[^\s"'，。；、）)]+/g, "sk-***")
    .slice(0, 1200);
}

function json(status, body) {
  return { status, body };
}

async function saveCapture(capture, config) {
  if (config.syncTarget === "notion" && !isNotionConfigured(config)) {
    throw new Error("SYNC_TARGET is notion, but NOTION_API_KEY and NOTION_DATABASE_ID or NOTION_PARENT_PAGE_ID are not fully configured.");
  }

  if (config.syncTarget === "feishu" && !isFeishuConfigured(config)) {
    throw new Error("SYNC_TARGET is feishu, but FEISHU_APP_ID, FEISHU_APP_SECRET, and FEISHU_WIKI_SPACE_ID or FEISHU_FOLDER_TOKEN are not fully configured.");
  }

  if (shouldUseNotion(config)) {
    const page = await createNotionPage(capture, config);
    return {
      mode: "notion",
      id: page.id,
      url: page.url
    };
  }

  if (shouldUseFeishu(config)) {
    const page = await createFeishuPage(capture, config);
    return {
      mode: "feishu",
      id: page.id,
      nodeToken: page.nodeToken,
      url: page.url,
      title: page.title
    };
  }

  const dataDir = getWritableDataDir();
  await fs.mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, "captures.jsonl");
  await fs.appendFile(filePath, `${JSON.stringify({
    savedAt: new Date().toISOString(),
    capture
  })}\n`, "utf8");

  return {
    mode: "local",
    path: filePath,
    message: "No remote sync target is configured, so the capture was saved locally."
  };
}

function shouldUseNotion(config) {
  const configured = isNotionConfigured(config);
  if (config.syncTarget === "notion") return configured;
  return config.syncTarget === "auto" && configured;
}

function shouldUseFeishu(config) {
  const configured = isFeishuConfigured(config);
  if (config.syncTarget === "feishu") return configured;
  return config.syncTarget === "auto" && !shouldUseNotion(config) && configured;
}

function isNotionConfigured(config) {
  return Boolean(config.notionApiKey && (config.notionDatabaseId || config.notionParentPageId));
}

function countTasks(tasks = {}) {
  return ["personal", "work", "management"].reduce((total, key) => {
    return total + (Array.isArray(tasks[key]) ? tasks[key].length : 0);
  }, 0);
}

function previewMarkdown(markdown = "") {
  return String(markdown)
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function getWritableDataDir() {
  const cwd = process.cwd();
  if (
    process.env.NETLIFY
    || process.env.AWS_LAMBDA_FUNCTION_NAME
    || process.env.AWS_EXECUTION_ENV
    || cwd.includes("/var/task")
  ) {
    return "/tmp";
  }
  return path.resolve("data");
}
