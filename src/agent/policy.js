export function resolveAgentPolicy({ body = {}, routing = {}, user = null } = {}) {
  const selectedModelId = String(body.modelId || "");
  const hasCustomer = Boolean(body.customerId);
  const hasSkill = Boolean(body.skillId);
  const hasAttachments = Array.isArray(body.extraContext?.chatAttachments) && body.extraContext.chatAttachments.length > 0;
  const isLocalModel = !selectedModelId || selectedModelId === "model_local";
  const isImage = routing.intent === "image_generation";
  const isPpt = routing.intent === "ppt_generation";
  const isManualSkill = hasSkill;
  const isCustomerBound = hasCustomer || ["customer_analysis", "customer_talktrack"].includes(routing.intent);

  let executionMode = "sync";
  let responseMode = "text";
  const guardrails = [];
  const reasons = [];

  if (!user) {
    guardrails.push("auth_required");
  }

  if (isCustomerBound) {
    guardrails.push("customer_memory_isolation");
    reasons.push("客户相关任务必须按客户边界读取和写入上下文。");
  } else {
    guardrails.push("default_workspace_no_customer_memory");
    reasons.push("默认工作台不读取客户档案，除非用户明确指定或命中客户。");
  }

  if (isImage || isPpt) {
    executionMode = "background";
    responseMode = isImage ? "image_job" : "document_card";
    reasons.push("图片/PPT 属于长任务，进入后台队列。");
  } else if (isManualSkill) {
    executionMode = "sync";
    responseMode = "document_card";
    reasons.push("手动选择 Skill 时优先同步执行，并以文档卡片展示结果。");
  } else if (hasCustomer || isLocalModel) {
    executionMode = "sync";
    responseMode = "text";
    reasons.push("客户短任务和本地模型任务同步返回，避免误入后台队列。");
  } else if (hasAttachments || ["document_generation", "planning", "work_analysis"].includes(routing.intent)) {
    executionMode = "background";
    responseMode = "document_card";
    reasons.push("远程长文档、附件解析或复杂规划任务进入后台完整生成。");
  } else if (routing.intent === "general_chat") {
    executionMode = "background";
    responseMode = "text";
    reasons.push("默认远程通用回答进入后台完整生成，减少同步超时。");
  }

  return {
    executionMode,
    responseMode,
    guardrails,
    shouldReadCustomerContext: isCustomerBound,
    shouldUseSkill: isManualSkill || routing.intent === "skill_execution",
    shouldUseRag: routing.tools?.includes("rag.search") || routing.intent === "rag_answer",
    shouldUseWeb: routing.tools?.includes("web.search") || routing.intent === "web_research",
    shouldUseBackground: executionMode === "background",
    reason: reasons.join(" ")
  };
}
