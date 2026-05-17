const TOOL_LABELS = {
  knowledge_base: "知识库增强",
  rag: "知识库增强",
  web_search: "联网搜索",
  web_crawl: "网页抓取",
  company_research: "客户公开资料调研",
  industry_research: "行业调研",
  competitive_research: "竞品调研",
  policy_research: "政策/价格核验",
  image2: "image2 生图",
  ppt_outline: "PPT 结构",
  task_planning: "任务规划",
  intent_router: "意图路由"
};

const CARD_BY_TOOL = {
  image2: "image_job",
  ppt_outline: "document_card",
  knowledge_base: "document_card",
  rag: "document_card",
  web_search: "document_card",
  web_crawl: "document_card",
  company_research: "document_card",
  industry_research: "document_card",
  competitive_research: "document_card",
  policy_research: "document_card"
};

export function buildSkillManifest(skill = null, { manual = false, intent = "", action = "", confidence = 0 } = {}) {
  if (!skill) return null;
  const toolType = String(skill.toolType || "").trim();
  const outputSections = parseOutputSections(skill.outputFormat);
  const knowledgeBaseIds = ensureArray(skill.knowledgeBaseIds);
  const requiresCustomer = ensureArray(skill.applicableStages).length > 0;
  const triggerMode = manual ? "manual" : confidence >= 0.86 ? "auto_high_confidence" : "auto_guarded";
  const outputCard = CARD_BY_TOOL[toolType] || (action === "write" || manual ? "document_card" : "text");

  return {
    id: skill.id || "",
    name: skill.name || "未命名 Skill",
    description: skill.description || "",
    toolType,
    toolLabel: TOOL_LABELS[toolType] || (toolType ? toolType : "模型生成"),
    trigger: {
      mode: triggerMode,
      confidence,
      intent,
      action,
      manual,
      autoPolicy: manual
        ? "用户手动选择时强制执行。"
        : "自动命中必须满足高置信度和上下文边界，低置信度回退到通用模型回答。"
    },
    context: {
      requiresCustomer,
      applicableStages: ensureArray(skill.applicableStages),
      inputFields: ensureArray(skill.inputFields),
      knowledgeBaseIds,
      usesRag: knowledgeBaseIds.length > 0 || ["knowledge_base", "rag"].includes(toolType),
      usesWeb: /^web_|_research$/.test(toolType) || ["company_research", "industry_research", "competitive_research", "policy_research"].includes(toolType),
      usesImage: toolType === "image2",
      usesPpt: toolType === "ppt_outline"
    },
    output: {
      mode: outputCard,
      format: skill.outputFormat || "",
      sections: outputSections.slice(0, 16),
      cardTitle: skill.name || "Skill 输出",
      qualityChecklist: buildSkillQualityChecklist({ toolType, requiresCustomer, outputSections })
    },
    guardrails: buildSkillGuardrails({ toolType, requiresCustomer, knowledgeBaseIds })
  };
}

export function buildSkillCatalog(skills = []) {
  return ensureArray(skills)
    .filter((skill) => skill && skill.status !== "disabled")
    .map((skill) => buildSkillManifest(skill))
    .filter(Boolean);
}

function parseOutputSections(outputFormat = "") {
  return String(outputFormat || "")
    .split(/\n|[、,，]/)
    .map((item) => item.replace(/^#+\s*/, "").trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

function buildSkillQualityChecklist({ toolType = "", requiresCustomer = false, outputSections = [] } = {}) {
  const checklist = [
    "先给结论，再给依据和下一步动作。",
    "信息不足时明确标注待确认，不把推断写成事实。",
    "输出内容必须可复制、可执行、可沉淀。"
  ];
  if (requiresCustomer) checklist.push("客户事实只能来自当前客户上下文，不能跨客户复用。");
  if (["knowledge_base", "rag"].includes(toolType)) checklist.push("引用知识库时标注知识库、文档名和相关度。");
  if (/web|research/.test(toolType)) checklist.push("引用公开资料时标注来源链接和检索时间。");
  if (toolType === "image2") checklist.push("先生成可控提示词，再进入图片后台任务。");
  if (toolType === "ppt_outline") checklist.push("输出页结构、每页内容稿和可交给 PPT 生成服务的提示词。");
  if (outputSections.length) checklist.push(`覆盖核心章节：${outputSections.slice(0, 6).join("、")}。`);
  return checklist;
}

function buildSkillGuardrails({ toolType = "", requiresCustomer = false, knowledgeBaseIds = [] } = {}) {
  const guardrails = ["no_unverified_facts", "no_hidden_system_process_in_final"];
  if (requiresCustomer) guardrails.push("single_customer_memory_isolation");
  if (knowledgeBaseIds.length || ["knowledge_base", "rag"].includes(toolType)) guardrails.push("cite_rag_sources");
  if (/web|research/.test(toolType)) guardrails.push("cite_web_sources");
  if (toolType === "image2") guardrails.push("background_media_generation");
  return guardrails;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}
