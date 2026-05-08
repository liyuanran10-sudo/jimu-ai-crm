import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_IMAGE_TIMEOUT_MS = 180000;
const GENERATED_IMAGE_ROUTE_PREFIX = "/api/crm/generated-image";

export async function generateInteractionImage({ prompt, style, websiteType, customerName, referenceImageUrl, config }) {
  const cleanPrompt = String(prompt || "").trim();
  let modelName = config.image2Model || "gpt-image-2";
  const timeoutMs = Number(config.image2TimeoutMs || DEFAULT_IMAGE_TIMEOUT_MS);
  const isMobileFocused = /手机|移动|mobile|app|小程序/i.test(`${style || ""} ${websiteType || ""} ${cleanPrompt}`);

  if (!config.image2ApiKey) {
    return buildFailureResult({
      prompt: cleanPrompt,
      style,
      websiteType,
      customerName,
      modelName,
      reason: "未配置 IMAGE2_API_KEY，无法调用 image2 生成真实图片。"
    });
  }

  try {
    const useReferenceImage = Boolean(String(referenceImageUrl || "").trim());
    let response = useReferenceImage
      ? await postImage2EditRequest({ config, prompt: cleanPrompt, modelName, referenceImageUrl })
      : await postImage2Json({
        config,
        body: buildImage2RequestBody({ prompt: cleanPrompt, config, modelName, timeoutMs })
      });
    if (useReferenceImage && !response.ok && isImageToolSchemaError(response.bodyText)) {
      response = await postImage2Json({
        config,
        body: await buildImage2EditRequestBody({
          prompt: cleanPrompt,
          config,
          imageModelName: modelName,
          referenceImageUrl,
          includeToolModel: false
        }),
        endpoint: "/responses",
        timeoutMs: getImage2EditTimeoutMs(config)
      });
    }

    if (!response.ok && isModelAccessError(response.bodyText)) {
      const resolvedModel = await resolveAccessibleImageModel(config, modelName);
      if (resolvedModel && resolvedModel !== modelName) {
        modelName = resolvedModel;
        response = useReferenceImage
          ? await postImage2EditRequest({ config, prompt: cleanPrompt, modelName, referenceImageUrl })
          : await postImage2Json({
            config,
            body: buildImage2RequestBody({ prompt: cleanPrompt, config, modelName, timeoutMs })
          });
        if (useReferenceImage && !response.ok && isImageToolSchemaError(response.bodyText)) {
          response = await postImage2Json({
            config,
            body: await buildImage2EditRequestBody({
              prompt: cleanPrompt,
              config,
              imageModelName: modelName,
              referenceImageUrl,
              includeToolModel: false
            }),
            endpoint: "/responses",
            timeoutMs: getImage2EditTimeoutMs(config)
          });
        }
      }
    }

    if (!response.ok) {
      return buildFailureResult({
        prompt: cleanPrompt,
        style,
        websiteType,
        customerName,
        modelName,
        reason: buildImage2FailureMessage({ bodyText: response.bodyText, modelName, status: response.status })
      });
    }

    const payload = safeJsonParse(response.bodyText);
    const image = extractImageFromPayload(payload);
    if (!image.imageUrl) {
      return buildFailureResult({
        prompt: cleanPrompt,
        style,
        websiteType,
        customerName,
        modelName,
        reason: `image2 已返回结果，但没有识别到图片 URL 或 base64 数据。`
      });
    }

    const imageUrl = await persistDataImageIfNeeded(image.imageUrl);
    return {
      ok: true,
      usedFallback: false,
      status: "generated",
      provider: "image2",
      modelName,
      imageUrl,
      revisedPrompt: image.revisedPrompt || "",
      displayMode: isMobileFocused ? "mobile" : "default",
      note: "图片已由 image2 生成。"
    };
  } catch (error) {
    return buildFailureResult({
      prompt: cleanPrompt,
      style,
      websiteType,
      customerName,
      modelName,
      reason: `image2 请求异常：${redactSecrets(error.message || "未知错误")}`
    });
  }
}

export function extractImagePrompt(markdown = "") {
  const source = String(markdown || "").trim();
  if (!source) return "";

  const promptSection = source.match(/(?:^|\n)#{2,4}\s*(?:Image2\s*)?提示词[^\n]*\n([\s\S]*?)(?=\n#{2,4}\s|\s*$)/i);
  if (promptSection?.[1]) {
    const sectionCode = longestCodeBlock(promptSection[1]);
    return cleanPromptText(sectionCode || promptSection[1]);
  }

  const longestBlock = longestCodeBlock(source);
  if (longestBlock) return cleanPromptText(longestBlock);

  return cleanPromptText(source);
}

export function buildInteractionImageMarkdown({ customer, style, websiteType, promptDraft, imagePrompt, imageResult }) {
  const statusLine = imageResult.usedFallback
    ? `> 云端图片未生成成功：${imageResult.note || imageResult.reason || "image2 暂未返回可用图片。"}`
    : `> 已调用 ${imageResult.modelName || "image2"} 生成交互图。`;
  const imageAlt = `${customer?.name || "客户"} ${websiteType || "项目"} 交互图`;
  const imageBlock = imageResult.usedFallback || !imageResult.imageUrl
    ? [
      "## 当前状态",
      "",
      "- 图片云端生成未完成或未返回可用图片，系统已保留本次提示词与参数。",
      "- 可以稍后重新生成，或检查 image2 Key、模型权限、Base URL 与中转站任务状态。"
    ].join("\n")
    : `![${imageAlt}](${imageResult.imageUrl})`;
  const revisedPrompt = imageResult.revisedPrompt
    ? [
      "## image2 修订提示词",
      "",
      "```text",
      imageResult.revisedPrompt,
      "```",
      ""
    ].join("\n")
    : "";

  return [
    `# ${customer?.name || "客户"} - 交互图`,
    "",
    statusLine,
    "",
    imageBlock,
    "",
    "## 生成参数",
    "",
    "| 字段 | 内容 |",
    "| --- | --- |",
    `| 设计风格 | ${style || "未指定"} |`,
    `| 网站类型 | ${websiteType || "未指定"} |`,
    `| 图片模型 | ${imageResult.modelName || "image2"} |`,
    `| 生成状态 | ${imageResult.usedFallback ? "未生成真实图片" : "已生成"} |`,
    "",
    "## Image2 提示词",
    "",
    "```text",
    imagePrompt,
    "```",
    "",
    revisedPrompt,
    "## Prompt 解析过程",
    "",
    promptDraft || "暂无解析过程。",
    "",
    "## 后续建议",
    "",
    "- 如果这张图用于客户沟通，建议先人工确认业务模块名称、关键流程和品牌颜色。",
    "- 如果要继续迭代，可以在详情页编辑本文档中的提示词，再按新提示词重新生成。",
    "- 当前图片已保存到本客户的生成历史，客户之间不会共享这段上下文。"
  ].filter(Boolean).join("\n").trim();
}

export function buildDefaultImageMarkdown({ message, style, imageType, promptDraft, imagePrompt, imageResult }) {
  const statusLine = imageResult.usedFallback
    ? `> 云端图片未生成成功：${imageResult.note || imageResult.reason || "image2 暂未返回可用图片。"}`
    : `> 已调用 ${imageResult.modelName || "image2"} 生成图片。`;
  const imageBlock = imageResult.usedFallback || !imageResult.imageUrl
    ? [
      "## 当前状态",
      "",
      "- 图片云端生成未完成或未返回可用图片，系统已保留本次提示词与参数。",
      "- 可以稍后重新生成，或检查 image2 Key、模型权限、Base URL 与中转站任务状态。"
    ].join("\n")
    : `![默认AI工作台 ${imageType || "生图"}](${imageResult.imageUrl})`;
  const revisedPrompt = imageResult.revisedPrompt
    ? [
      "## image2 修订提示词",
      "",
      "```text",
      imageResult.revisedPrompt,
      "```",
      ""
    ].join("\n")
    : "";

  return [
    "# 默认 AI 工作台 - image2 生图",
    "",
    statusLine,
    "",
    imageBlock,
    "",
    "## 生成参数",
    "",
    "| 字段 | 内容 |",
    "| --- | --- |",
    `| 图片类型 | ${imageType || "智能识别"} |`,
    `| 视觉风格 | ${style || "自动"} |`,
    `| 图片模型 | ${imageResult.modelName || "image2"} |`,
    `| 生成状态 | ${imageResult.usedFallback ? "未生成真实图片" : "已生成"} |`,
    "",
    "## 用户需求",
    "",
    message || "未提供具体生图需求。",
    "",
    "## Image2 提示词",
    "",
    "```text",
    imagePrompt,
    "```",
    "",
    revisedPrompt,
    "## Prompt 解析过程",
    "",
    promptDraft || "暂无解析过程。",
    "",
    "## 使用建议",
    "",
    "- 如果这张图用于具体客户项目，请切换到客户上下文后重新生成，确保客户记忆隔离。",
    "- 如果要继续迭代，请补充图片比例、品牌色、使用场景、目标受众和必须出现的元素。",
    "- 默认工作台生成结果已保存到全局生成历史，不会写入任何客户档案。"
  ].filter(Boolean).join("\n").trim();
}

export function buildPendingInteractionImageMarkdown({ customer, style, websiteType, extraRequirement }) {
  return [
    `# ${customer?.name || "客户"} - 交互图`,
    "",
    "> image2 云端生成任务已提交，系统正在后台解析客户上下文并生成图片。你可以关闭弹窗或切换页面，生成完成后会自动通知。",
    "",
    "## 当前状态",
    "",
    "- 状态：云端生成中",
    "- 处理方式：后台继续调用 image2，不阻塞当前 CRM 页面",
    "- 完成后：自动更新当前历史文档，并弹出完成通知",
    "",
    "## 生成参数",
    "",
    "| 字段 | 内容 |",
    "| --- | --- |",
    `| 客户 | ${customer?.name || "未选择"} |`,
    `| 设计风格 | ${style || "未指定"} |`,
    `| 网站类型 | ${websiteType || "未指定"} |`,
    `| 补充要求 | ${extraRequirement || "无"} |`,
    `| 生成状态 | 云端生成中 |`,
    "",
    "## 处理说明",
    "",
    "- 系统会先读取当前客户需求、跟进记录、资料和历史生成结果。",
    "- 然后生成 image2 专用提示词，并按用户选择的设备类型调用图片模型生成交互图。",
    "- 客户之间的上下文和记忆仍然保持隔离。"
  ].join("\n");
}

export function buildPendingInteractionImageBoardMarkdown({ customer, style, websiteType, extraRequirement, items = [] }) {
  return buildInteractionImageBoardMarkdown({
    customer,
    style,
    websiteType,
    extraRequirement,
    items: items.map((item, index) => ({
      ...item,
      id: item.id || `image_${index + 1}`,
      status: index === 0 ? "generating" : "queued",
      imageUrl: "",
      error: ""
    })),
    status: "generating"
  });
}

export function buildInteractionImageBoardMarkdown({ customer, style, websiteType, extraRequirement, items = [], status = "generating" }) {
  const statusLabel = {
    generating: "生成中",
    completed: "已完成",
    failed: "生成失败",
    queued: "排队中"
  }[status] || status || "已创建";
  const completedCount = items.filter((item) => item.status === "completed").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const itemSections = items.map((item, index) => {
    const imageBlock = item.imageUrl
      ? `![${cleanTableCell(item.title || `交互图 ${index + 1}`)}](${item.imageUrl})`
      : `> 当前状态：${item.status === "failed" ? `生成失败：${item.error || "image2 未返回可用图片"}` : item.status === "completed" ? "已完成但没有图片链接" : "等待 image2 生成"}`;
    const revisedPrompt = item.revisedPrompt
      ? ["", "### image2 修订提示词", "", "```text", item.revisedPrompt, "```"].join("\n")
      : "";
    return [
      `## ${index + 1}. ${item.title || `交互图 ${index + 1}`}`,
      "",
      imageBlock,
      "",
      "| 字段 | 内容 |",
      "| --- | --- |",
      `| 设备 | ${cleanTableCell(item.device || "桌面端")} |`,
      `| 页面目标 | ${cleanTableCell(item.goal || "未填写")} |`,
      `| 状态 | ${cleanTableCell(item.status || "queued")} |`,
      item.error ? `| 错误 | ${cleanTableCell(item.error)} |` : "",
      "",
      "### 页面内容与布局",
      "",
      item.layout || "暂无布局说明。",
      "",
      "### Image2 提示词",
      "",
      "```text",
      item.prompt || "",
      "```",
      revisedPrompt
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  return [
    `# ${customer?.name || "客户"} - 交互图画板`,
    "",
    `> 状态：${statusLabel}。共 ${items.length} 张，已完成 ${completedCount} 张，失败 ${failedCount} 张。`,
    "",
    "## 生成参数",
    "",
    "| 字段 | 内容 |",
    "| --- | --- |",
    `| 客户 | ${cleanTableCell(customer?.name || "未选择")} |`,
    `| 设计风格 | ${cleanTableCell(style || "自动")} |`,
    `| 网站类型 | ${cleanTableCell(websiteType || "自动")} |`,
    `| 图片数量 | ${items.length} |`,
    `| 补充要求 | ${cleanTableCell(extraRequirement || "无")} |`,
    `| 生成状态 | ${statusLabel} |`,
    "",
    "## 画板列表",
    "",
    "| 序号 | 界面 | 设备 | 状态 |",
    "| ---: | --- | --- | --- |",
    ...items.map((item, index) => `| ${index + 1} | ${cleanTableCell(item.title || `交互图 ${index + 1}`)} | ${cleanTableCell(item.device || "")} | ${cleanTableCell(item.status || "queued")} |`),
    "",
    itemSections || "暂无图片内容。",
    "",
    "## 使用建议",
    "",
    "- 点击画板中的单张图片可查看、复制提示词、下载或重新生成。",
    "- 重新生成时会保留原提示词和原图链接，并结合修改意见调用 image2。",
    "- 这条记录只归属于当前客户，客户之间的上下文和图片记忆保持隔离。"
  ].filter(Boolean).join("\n").trim();
}

export function buildPendingDefaultImageMarkdown({ message, style, imageType }) {
  return [
    "# 默认 AI Agent - image2 后台任务",
    "",
    "> Agent 已识别到生图意图，并把 image2 云端生成任务提交到后台。你可以继续对话或切换页面，生成完成后会自动通知。",
    "",
    "## Agent 执行摘要",
    "",
    "- Router：识别为 image2 生图任务。",
    "- Planner：先解析用户目标、图片类型、视觉风格和使用场景。",
    "- Scheduler：将真实图片生成交给后台任务，避免阻塞聊天输入框。",
    "- Executor：后台会生成 image2 专用提示词并调用图片模型。",
    "- Reflector：完成后更新全局生成历史，保留提示词和生成结果。",
    "",
    "## 当前状态",
    "",
    "- 状态：云端生成中",
    "- 处理方式：后台继续调用 image2，不阻塞当前对话",
    "- 完成后：自动更新全局生成历史，并弹出完成通知",
    "",
    "## 生成参数",
    "",
    "| 字段 | 内容 |",
    "| --- | --- |",
    `| 用户需求 | ${message || "未提供具体生图需求"} |`,
    `| 图片类型 | ${imageType || "智能识别"} |`,
    `| 视觉风格 | ${style || "自动"} |`,
    `| 生成状态 | 云端生成中 |`,
    "",
    "## 处理说明",
    "",
    "- 默认 AI 工作台不会读取任何客户档案或客户记忆。",
    "- 任务规划、意图识别和调度器是 Agent 内部策略，不是提示词模板。",
    "- 系统会先生成 image2 专用提示词，再由后台图片任务完成真实图片生成。"
  ].join("\n");
}

function buildImage2RequestBody({ prompt, config, modelName }) {
  const body = {
    model: modelName || config.image2Model || "gpt-image-2",
    prompt,
    n: 1,
    size: config.image2Size || "1792x1024"
  };
  if (config.image2ResponseFormat) body.response_format = config.image2ResponseFormat;
  return body;
}

async function buildImage2EditRequestBody({ prompt, config, imageModelName, referenceImageUrl, includeToolModel = true }) {
  const inputImage = await normalizeReferenceImageForResponses(referenceImageUrl);
  const imageTool = {
    type: "image_generation",
    size: config.image2Size || "1792x1024"
  };
  if (includeToolModel && imageModelName) imageTool.model = imageModelName;
  return {
    model: config.image2ResponsesModel || config.openaiModel || "gpt-5.5",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "请基于参考图重新生成一张高保真交互图。",
              "必须保留原图中的客户项目语义、中文 UI 文案风格、设备框、整体信息架构和业务逻辑。",
              "只根据用户修改意见调整相关视觉或内容，不要新增未确认的大功能。",
              "",
              prompt
            ].join("\n")
          },
          {
            type: "input_image",
            image_url: inputImage
          }
        ]
      }
    ],
    tools: [imageTool]
  };
}

async function postImage2EditRequest({ config, prompt, modelName, referenceImageUrl }) {
  const mode = String(config.image2EditMode || "auto").toLowerCase();
  if (mode !== "responses") {
    const editResponse = await postImage2Multipart({
      config,
      endpoint: config.image2EditEndpoint || "/images/edits",
      fields: {
        model: modelName || config.image2Model || "gpt-image-2",
        prompt,
        n: "1",
        size: config.image2Size || "1792x1024",
        ...(config.image2ResponseFormat ? { response_format: config.image2ResponseFormat } : {})
      },
      files: {
        image: await buildMultipartImageFile(referenceImageUrl)
      }
    });
    if (editResponse.ok || mode === "edits") return editResponse;
    if (!isImageEditUnsupportedError(editResponse.bodyText)) return editResponse;
  }

  return postImage2Json({
    config,
    body: await buildImage2EditRequestBody({
      prompt,
      config,
      imageModelName: modelName,
      referenceImageUrl,
      includeToolModel: true
    }),
    endpoint: "/responses",
    timeoutMs: getImage2EditTimeoutMs(config)
  });
}

async function postImage2Json({ config, body, endpoint, timeoutMs }) {
  const controller = new AbortController();
  const requestTimeoutMs = Number(timeoutMs || config.image2TimeoutMs || DEFAULT_IMAGE_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(endpoint ? buildImage2Url(config, endpoint) : buildImage2Url(config), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.image2ApiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return {
      ok: response.ok,
      status: response.status,
      bodyText: await response.text()
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`image2 request timeout after ${Math.round(requestTimeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function postImage2Multipart({ config, endpoint, fields = {}, files = {} }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getImage2EditTimeoutMs(config));
  try {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && value !== "") formData.append(key, String(value));
    }
    for (const [key, file] of Object.entries(files)) {
      if (file?.blob) formData.append(key, file.blob, file.fileName || "reference.png");
    }
    const response = await fetch(buildImage2Url(config, endpoint), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.image2ApiKey}`,
        "Accept": "application/json"
      },
      body: formData,
      signal: controller.signal
    });
    return {
      ok: response.ok,
      status: response.status,
      bodyText: await response.text()
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`image2 edit request timeout after ${Math.round(getImage2EditTimeoutMs(config) / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildImage2Url(config, endpointOverride = "") {
  const endpoint = String(endpointOverride || config.image2Endpoint || "/images/generations").trim();
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${buildImage2BaseUrl(config)}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

function buildImage2BaseUrl(config) {
  return String(config.image2BaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
}

async function resolveAccessibleImageModel(config, currentModel) {
  const models = await listImage2Models(config);
  if (!models.length) return "";
  const preferred = ["gpt-image-2", "image2", "gpt-image-1", "dall-e-3"];
  return preferred.find((model) => model !== currentModel && models.includes(model))
    || models.find((model) => model !== currentModel && /image|dall/i.test(model))
    || "";
}

async function listImage2Models(config) {
  try {
    const response = await fetch(`${buildImage2BaseUrl(config)}/models`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${config.image2ApiKey}`,
        "Accept": "application/json"
      }
    });
    if (!response.ok) return [];
    const payload = safeJsonParse(await response.text());
    if (!Array.isArray(payload?.data)) return [];
    return payload.data
      .map((item) => item?.id || item?.model || item?.name)
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => id.trim());
  } catch {
    return [];
  }
}

function isModelAccessError(bodyText = "") {
  return /no access to model|does not have access to model|model_not_found|模型.*权限|没有.*模型.*权限/i.test(String(bodyText || ""));
}

function isImageToolSchemaError(bodyText = "") {
  return /unknown parameter|invalid.*parameter|extra inputs are not permitted|unrecognized.*field|tools.*model|image_generation.*model/i.test(String(bodyText || ""));
}

function isImageEditUnsupportedError(bodyText = "") {
  return /not found|unsupported|unknown endpoint|invalid url|cannot post|route|endpoint|multipart|image.*required|model_not_found/i.test(String(bodyText || ""));
}

function buildImage2FailureMessage({ bodyText, modelName, status }) {
  const message = extractImage2ErrorMessage(bodyText);
  if (isModelAccessError(bodyText)) {
    return `当前 image2 Key 没有访问图片模型「${modelName}」的权限。请在中转站确认该 Key 已开通对应图片模型，或调整 IMAGE2_MODEL。`;
  }
  const statusText = status ? `HTTP ${status}` : "接口未返回成功状态";
  return `image2 暂时未生成真实图片（${statusText}）。诊断信息：${message || "未返回明确错误信息"}`;
}

function extractImage2ErrorMessage(bodyText = "") {
  const payload = safeJsonParse(bodyText);
  const message = payload?.error?.message || payload?.message || "";
  return redactSecrets(message || String(bodyText || "")).replace(/\s+/g, " ").trim().slice(0, 220);
}

function extractImageFromPayload(payload) {
  const first = payload?.data?.[0] || payload?.images?.[0] || null;
  const direct = normalizeImageCandidate(first);
  if (direct.imageUrl) return direct;

  const fromOutput = scanForImage(payload?.output);
  if (fromOutput.imageUrl) return fromOutput;

  return scanForImage(payload);
}

function scanForImage(value) {
  if (!value) return {};
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = scanForImage(item);
      if (image.imageUrl) return image;
    }
    return {};
  }
  if (typeof value !== "object") return {};

  const direct = normalizeImageCandidate(value);
  if (direct.imageUrl) return direct;

  for (const nested of Object.values(value)) {
    const image = scanForImage(nested);
    if (image.imageUrl) return image;
  }
  return {};
}

function normalizeImageCandidate(value) {
  if (!value || typeof value !== "object") return {};
  const url = value.url || value.image_url || value.imageUrl;
  const b64 = value.b64_json || value.base64 || value.image_base64 || value.result;
  const imageUrl = typeof url === "string" && url ? url : normalizeBase64Image(b64);
  return {
    imageUrl,
    revisedPrompt: value.revised_prompt || value.revisedPrompt || value.prompt || ""
  };
}

function normalizeBase64Image(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const clean = value.trim();
  if (clean.startsWith("data:image/")) return clean;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(clean) || clean.length < 200) return "";
  return `data:image/png;base64,${clean.replace(/\s+/g, "")}`;
}

function cleanTableCell(value = "") {
  return String(value || "")
    .replace(/\|/g, "｜")
    .replace(/\r?\n+/g, " ")
    .trim();
}

async function persistDataImageIfNeeded(imageUrl) {
  const match = String(imageUrl || "").match(/^data:image\/(png|jpe?g|webp|gif);base64,([\s\S]+)$/i);
  if (!match) return imageUrl;

  const extension = match[1].toLowerCase().replace("jpeg", "jpg");
  const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!bytes.length) return imageUrl;

  const imageDir = getGeneratedImageDir();
  await fs.mkdir(imageDir, { recursive: true });
  const fileName = `interaction-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  await writeGeneratedImageToBlobStore(fileName, bytes, mimeTypeFromFileName(fileName));
  await fs.writeFile(path.join(imageDir, fileName), bytes);
  return `${GENERATED_IMAGE_ROUTE_PREFIX}/${fileName}`;
}

async function normalizeReferenceImageForResponses(referenceImageUrl = "") {
  const source = String(referenceImageUrl || "").trim();
  if (!source) return "";
  if (/^data:image\//i.test(source) || /^https?:\/\//i.test(source)) return source;
  if (!isGeneratedImageUrl(source)) return source;

  const absolutePath = resolveGeneratedImagePath(source);
  const bytes = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const mimeType = ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : ext === ".webp" ? "image/webp" : "image/png";
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

async function buildMultipartImageFile(referenceImageUrl = "") {
  const source = String(referenceImageUrl || "").trim();
  if (!source) throw new Error("缺少原图参考，无法重新生成图片。");
  const { bytes, mimeType, fileName } = await readImageReference(source);
  return {
    blob: new Blob([bytes], { type: mimeType }),
    fileName
  };
}

function getImage2EditTimeoutMs(config = {}) {
  return Number(config.image2EditTimeoutMs || config.image2TimeoutMs || DEFAULT_IMAGE_TIMEOUT_MS);
}

async function readImageReference(source) {
  if (/^data:image\//i.test(source)) {
    const match = source.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
    if (!match) throw new Error("原图 data URL 无法解析。");
    return {
      bytes: Buffer.from(match[2].replace(/\s+/g, ""), "base64"),
      mimeType: match[1],
      fileName: `reference.${extensionFromMimeType(match[1])}`
    };
  }
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`无法读取原图参考：HTTP ${response.status}`);
    const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType,
      fileName: `reference.${extensionFromMimeType(mimeType)}`
    };
  }
  if (!isGeneratedImageUrl(source)) throw new Error("原图参考地址不是系统生成图片，无法安全读取。");

  const absolutePath = resolveGeneratedImagePath(source);
  const bytes = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const mimeType = ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : ext === ".webp" ? "image/webp" : "image/png";
  return {
    bytes,
    mimeType,
    fileName: `reference${ext || ".png"}`
  };
}

export async function readGeneratedImageAsset(fileName = "") {
  const safeName = safeGeneratedImageFileName(fileName);
  if (!safeName) throw new Error("图片文件名不合法");
  const blobAsset = await readGeneratedImageFromBlobStore(safeName);
  if (blobAsset) return blobAsset;

  const absolutePath = path.join(getGeneratedImageDir(), safeName);
  const bytes = await fs.readFile(absolutePath);
  return {
    bytes,
    mimeType: mimeTypeFromFileName(safeName),
    fileName: safeName
  };
}

async function writeGeneratedImageToBlobStore(fileName, bytes, mimeType) {
  const store = await getImageBlobStore();
  if (!store) return false;
  await store.set(fileName, bytes, {
    metadata: {
      mimeType,
      createdAt: new Date().toISOString()
    }
  });
  return true;
}

async function readGeneratedImageFromBlobStore(fileName) {
  const store = await getImageBlobStore();
  if (!store) return null;
  const value = await store.get(fileName, { type: "arrayBuffer" });
  if (!value) return null;
  return {
    bytes: Buffer.from(value),
    mimeType: mimeTypeFromFileName(fileName),
    fileName
  };
}

async function getImageBlobStore() {
  if (!process.env.NETLIFY || process.env.NETLIFY_BLOBS_DISABLED === "true") return null;
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore("aicrm-images");
  } catch {
    return null;
  }
}

function getGeneratedImageDir() {
  if (isServerlessRuntime()) {
    return path.join("/tmp", "generated", "interaction-images");
  }
  return path.resolve(process.cwd(), "public/generated/interaction-images");
}

function isServerlessRuntime() {
  const cwd = process.cwd();
  return Boolean(
    process.env.NETLIFY
    || process.env.AWS_LAMBDA_FUNCTION_NAME
    || process.env.AWS_EXECUTION_ENV
    || cwd.includes("/var/task")
  );
}

function isGeneratedImageUrl(source = "") {
  return String(source || "").startsWith("/generated/")
    || String(source || "").startsWith(`${GENERATED_IMAGE_ROUTE_PREFIX}/`);
}

function resolveGeneratedImagePath(source = "") {
  const safeName = safeGeneratedImageFileName(String(source || "").split("/").pop() || "");
  if (!safeName) throw new Error("系统生成图片地址不合法。");
  return path.join(getGeneratedImageDir(), safeName);
}

function safeGeneratedImageFileName(fileName = "") {
  const clean = path.basename(String(fileName || "").split("?")[0]);
  if (!/^interaction-[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp|gif)$/i.test(clean)) return "";
  return clean;
}

function mimeTypeFromFileName(fileName = "") {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function extensionFromMimeType(mimeType = "") {
  if (/jpe?g/i.test(mimeType)) return "jpg";
  if (/webp/i.test(mimeType)) return "webp";
  if (/gif/i.test(mimeType)) return "gif";
  return "png";
}

function buildFailureResult({ modelName, reason }) {
  return {
    ok: false,
    usedFallback: true,
    status: "failed",
    provider: "image2",
    modelName,
    imageUrl: "",
    revisedPrompt: "",
    displayMode: "default",
    reason,
    note: reason
  };
}

function longestCodeBlock(text = "") {
  const matches = Array.from(String(text).matchAll(/```(?:[\w-]+)?\s*([\s\S]*?)```/g));
  if (!matches.length) return "";
  return matches
    .map((match) => match[1].trim())
    .sort((a, b) => b.length - a.length)[0] || "";
}

function cleanPromptText(text = "") {
  return String(text || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, 5000);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function redactSecrets(text) {
  return String(text || "").replace(/sk-[^\s"'，。；、）)]+/g, "sk-***");
}
