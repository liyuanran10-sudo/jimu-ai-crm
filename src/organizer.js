const MAX_INPUT_CHARS = 24000;

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "contentType", "tags", "markdown"],
  properties: {
    title: {
      type: "string",
      description: "A concise Notion page title in Chinese."
    },
    summary: {
      type: "string",
      description: "A short Chinese summary, 2 to 5 sentences."
    },
    contentType: {
      type: "string",
      enum: ["方案", "提示词", "代码", "知识卡片", "会议纪要", "待办", "灵感", "其他"]
    },
    tags: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string" }
    },
    markdown: {
      type: "string",
      description: "Clean Markdown body for Notion, preserving useful structure."
    }
  }
};

export async function organizeContent(input, config = {}) {
  const normalized = normalizeInput(input);
  if (!config.openaiApiKey) {
    return organizeWithFallback(normalized, "local-fallback");
  }

  try {
    const organized = await organizeWithOpenAI(normalized, config);
    return normalizeCapture(organized, normalized, "openai");
  } catch (error) {
    const fallback = organizeWithFallback(normalized, "local-fallback-after-openai-error");
    fallback.warning = `OpenAI organize failed, used local fallback: ${error.message}`;
    return fallback;
  }
}

function normalizeInput(input = {}) {
  const content = String(input.content || "").trim().slice(0, MAX_INPUT_CHARS);
  return {
    content,
    sourceTitle: String(input.sourceTitle || "").trim(),
    sourceUrl: String(input.sourceUrl || "").trim(),
    userNote: String(input.userNote || "").trim()
  };
}

async function organizeWithOpenAI(input, config) {
  const systemPrompt = [
    "You are a knowledge capture assistant.",
    "Turn useful GPT/chat content into a structured Notion note.",
    "Write in concise professional Chinese.",
    "Preserve code blocks, checklists, steps, tables, and key details when useful.",
    "Do not invent facts that are not present in the source.",
    "Return only valid JSON that matches the schema."
  ].join("\n");

  const userPrompt = [
    `Source title: ${input.sourceTitle || "N/A"}`,
    `Source URL: ${input.sourceUrl || "N/A"}`,
    input.userNote ? `User note: ${input.userNote}` : "",
    "",
    "Content:",
    input.content
  ].filter(Boolean).join("\n");

  const structuredBody = {
    model: config.openaiModel,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "notion_capture",
        strict: true,
        schema: JSON_SCHEMA
      }
    }
  };

  try {
    const payload = await postOpenAI(structuredBody, config);
    return parseModelJson(extractOutputText(payload));
  } catch (error) {
    const plainBody = {
      model: config.openaiModel,
      input: `${systemPrompt}\n\nJSON schema:\n${JSON.stringify(JSON_SCHEMA)}\n\n${userPrompt}`,
      temperature: 0.2
    };
    const payload = await postOpenAI(plainBody, config);
    return parseModelJson(extractOutputText(payload));
  }
}

async function postOpenAI(body, config) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errorText.slice(0, 500)}`);
  }

  return response.json();
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;

  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
      if (typeof content.output_text === "string") parts.push(content.output_text);
    }
  }
  return parts.join("\n").trim();
}

function parseModelJson(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace >= 0
    ? cleaned.slice(firstBrace, lastBrace + 1)
    : cleaned;

  return JSON.parse(jsonText);
}

function normalizeCapture(capture, input, organizer) {
  const fallback = organizeWithFallback(input, organizer);
  const title = cleanInline(capture.title) || fallback.title;
  const summary = cleanInline(capture.summary) || fallback.summary;
  const contentType = cleanInline(capture.contentType) || fallback.contentType;
  const tags = Array.isArray(capture.tags)
    ? unique(capture.tags.map(cleanInline).filter(Boolean)).slice(0, 8)
    : fallback.tags;
  const markdown = String(capture.markdown || "").trim() || fallback.markdown;

  return {
    title,
    summary,
    contentType,
    tags: tags.length ? tags : fallback.tags,
    markdown,
    rawContent: input.content,
    source: {
      title: input.sourceTitle,
      url: input.sourceUrl,
      capturedAt: new Date().toISOString()
    },
    organizer
  };
}

export function organizeWithFallback(input, organizer = "local-fallback") {
  const title = deriveTitle(input.content, input.sourceTitle);
  const summary = deriveSummary(input.content);
  const contentType = detectContentType(input.content);
  const tags = deriveTags(input.content, contentType);
  const sourceLine = input.sourceTitle || input.sourceUrl
    ? `来源：${[input.sourceTitle, input.sourceUrl].filter(Boolean).join(" - ")}`
    : "来源：GPT 内容采集";

  const markdown = [
    `# ${title}`,
    "",
    `> ${sourceLine}`,
    "",
    "## 摘要",
    "",
    summary,
    "",
    "## 正文",
    "",
    input.content
  ].join("\n");

  return {
    title,
    summary,
    contentType,
    tags,
    markdown,
    rawContent: input.content,
    source: {
      title: input.sourceTitle,
      url: input.sourceUrl,
      capturedAt: new Date().toISOString()
    },
    organizer
  };
}

function deriveTitle(content, sourceTitle) {
  const firstHeading = content.match(/^#{1,3}\s+(.+)$/m)?.[1];
  if (firstHeading) return cleanInline(firstHeading).slice(0, 80);

  const firstLine = content.split(/\r?\n/).find((line) => cleanInline(line).length > 0);
  if (firstLine) return cleanInline(firstLine).slice(0, 80);

  if (sourceTitle) return cleanInline(sourceTitle).slice(0, 80);
  return "GPT 内容采集";
}

function deriveSummary(content) {
  const cleaned = cleanInline(content.replace(/```[\s\S]*?```/g, " "));
  if (!cleaned) return "已采集一段 GPT 内容，建议后续补充摘要和标签。";

  const sentences = cleaned
    .split(/(?<=[。！？.!?])\s+|(?<=[。！？])/)
    .map((item) => cleanInline(item))
    .filter(Boolean);

  const summary = sentences.slice(0, 3).join("");
  return (summary || cleaned).slice(0, 240);
}

function detectContentType(content) {
  const text = content.toLowerCase();
  if (/```|function\s|const\s|class\s|import\s/.test(text)) return "代码";
  if (/prompt|提示词|system prompt|user prompt/.test(text)) return "提示词";
  if (/解决方案|方案|交付|mvp|模块|架构/.test(text)) return "方案";
  if (/todo|待办|行动项|checklist|\[ \]/.test(text)) return "待办";
  if (/会议|纪要|参会|决议/.test(text)) return "会议纪要";
  if (/想法|灵感|idea|创意/.test(text)) return "灵感";
  return "知识卡片";
}

function deriveTags(content, contentType) {
  const candidates = [contentType];
  const keywordMap = [
    ["Notion", /notion/i],
    ["AI", /\bai\b|人工智能|大模型|gpt|openai/i],
    ["自动化", /自动化|workflow|工作流/i],
    ["产品", /产品|用户|体验|需求/i],
    ["售前", /售前|客户|方案|报价/i],
    ["开发", /开发|接口|api|代码|工程/i],
    ["知识库", /知识库|知识|沉淀|文档/i],
    ["运营", /运营|增长|转化|留存/i]
  ];

  for (const [tag, pattern] of keywordMap) {
    if (pattern.test(content)) candidates.push(tag);
  }

  return unique(candidates).slice(0, 6);
}

function cleanInline(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[#*_`>\[\]]/g, "")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
