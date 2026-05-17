import { buildSkillManifest } from "./skill-manifest.js";

const INTENT_LABELS = {
  customer_analysis: "客户分析",
  customer_talktrack: "客户话术",
  general_chat: "通用问答",
  document_generation: "文档生成",
  skill_execution: "Skill 执行",
  rag_answer: "知识库问答",
  web_research: "联网调研",
  image_generation: "image2 生图",
  ppt_generation: "PPT 生成",
  planning: "规划拆解",
  work_analysis: "工作分析",
  file_analysis: "文件解析"
};

const ACTION_LABELS = {
  answer: "通用回答",
  analyze: "分析判断",
  write: "文档写作",
  execute_skill: "执行 Skill",
  generate_image: "生成图片",
  generate_ppt: "生成 PPT",
  plan: "规划拆解",
  parse_file: "文件解析"
};

const OUTPUT_LABELS = {
  text: "普通对话",
  analysis_card: "分析卡片",
  document_card: "文档卡片",
  image_job: "图片任务卡",
  task_card: "任务卡片"
};

export function routeAgentIntent({ body = {}, db = {} } = {}) {
  const message = String(body.message || "").trim();
  const skill = body.skillId
    ? (db.skills || []).find((item) => item.id === body.skillId && item.status !== "disabled") || null
    : null;
  const customer = body.customerId
    ? (db.customers || []).find((item) => item.id === body.customerId) || null
    : null;
  const hasAttachments = Array.isArray(body.extraContext?.chatAttachments) && body.extraContext.chatAttachments.length > 0;
  const candidates = [];
  const add = (intent, confidence, reason, extra = {}) => {
    candidates.push({
      intent,
      label: INTENT_LABELS[intent] || intent,
      confidence,
      reason,
      ...extra
    });
  };

  if (skill) {
    add("skill_execution", 0.98, `用户手动选择 Skill：${skill.name}`, {
      skillId: skill.id,
      responseMode: "document_card"
    });
  }

  if (hasAttachments) {
    add("file_analysis", 0.91, "用户上传了文件，必须解析文件内容并作为上下文。", {
      responseMode: shouldUseRemoteModel(body) ? "background" : "sync"
    });
  }

  if (!body.customerId && isExplicitImageIntent(message, body, skill)) {
    add("image_generation", 0.94, "输入明确要求生成图片、视觉稿、交互图或产品图。", {
      responseMode: "background",
      tools: ["image2.generate"]
    });
  }

  if (isPptIntent(message, skill)) {
    add("ppt_generation", 0.9, "输入要求生成 PPT 或演示文稿。", {
      responseMode: "background",
      tools: ["ppt.generate"]
    });
  }

  if (customer && isCustomerTalktrackIntent(message)) {
    add("customer_talktrack", 0.9, `已选择客户：${customer.name}，输入要求输出沟通话术或推进建议。`, {
      customerBinding: "explicit",
      tools: ["crm.getCustomerContext"]
    });
  } else if (customer) {
    add("customer_analysis", 0.82, `已选择客户：${customer.name}，按客户隔离上下文回答。`, {
      customerBinding: "explicit",
      tools: ["crm.getCustomerContext"]
    });
  } else if (isCustomerPortfolioIntent(message) || isCustomerTalktrackIntent(message)) {
    add(isCustomerTalktrackIntent(message) ? "customer_talktrack" : "customer_analysis", 0.86, "输入要求分析当前客户、多个客户或客户推进话术。", {
      customerBinding: "collection",
      tools: ["crm.searchCustomers", "crm.getCustomerContext"]
    });
  }

  if (isDocumentIntent(message)) {
    add("document_generation", 0.88, "输入要求生成需求文档、方案、报告或可交付文档。", {
      responseMode: shouldUseRemoteModel(body) ? "background" : "sync"
    });
  }

  if (isPlanningIntent(message)) {
    add("planning", 0.82, "输入要求拆解计划、流程或执行路径。");
  }

  if (isWorkAnalysisIntent(message)) {
    add("work_analysis", 0.82, "输入要求分析或复盘当前工作。");
  }

  if (isRagIntent(message, skill, body)) {
    add("rag_answer", 0.78, skill?.knowledgeBaseIds?.length ? "当前 Skill 绑定知识库。" : "输入要求引用知识库、资料、案例或方案库。", {
      tools: ["rag.search"]
    });
  }

  if (isWebResearchIntent(message, skill, body)) {
    add("web_research", 0.76, "输入需要最新信息、公开资料、公司名单、政策或网页检索。", {
      tools: ["web.search"]
    });
  }

  if (!candidates.length) {
    add("general_chat", 0.62, "没有检测到强工具意图，按通用 AI 助手回答。");
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const primary = candidates[0];
  const action = inferAction({ primary, message, body, skill });
  const contextPlan = inferContextPlan({ primary, candidates, body, skill, customer, hasAttachments });
  const output = inferOutputMode({ primary, action, body, skill });
  const skillManifest = buildSkillManifest(skill, {
    manual: Boolean(body.skillId),
    intent: primary.intent,
    action: action.key,
    confidence: primary.confidence
  });
  const toolPlan = unique([
    ...(primary.tools || []),
    ...contextPlan.tools
  ]);

  return {
    intent: primary.intent,
    label: primary.label,
    confidence: primary.confidence,
    reason: primary.reason,
    candidates: candidates.slice(0, 6),
    action,
    domain: inferDomain({ primary, message, customer }),
    contextPlan,
    output,
    skillManifest,
    customerBinding: primary.customerBinding || (customer ? "explicit" : "none"),
    selectedSkillId: skill?.id || "",
    selectedSkillName: skill?.name || "",
    tools: toolPlan,
    responseMode: output.mode === "image_job" ? "background" : output.mode
  };
}

function inferAction({ primary = {}, message = "", body = {}, skill = null } = {}) {
  let key = "answer";
  if (primary.intent === "skill_execution" || skill) key = "execute_skill";
  else if (primary.intent === "image_generation") key = "generate_image";
  else if (primary.intent === "ppt_generation") key = "generate_ppt";
  else if (primary.intent === "document_generation") key = "write";
  else if (["customer_analysis", "customer_talktrack", "work_analysis"].includes(primary.intent)) key = "analyze";
  else if (primary.intent === "planning") key = "plan";
  else if (primary.intent === "file_analysis") key = "parse_file";
  else if (isExplicitDocumentIntent(message)) key = "write";
  else if (Array.isArray(body.extraContext?.chatAttachments) && body.extraContext.chatAttachments.length > 0) key = "parse_file";

  return {
    key,
    label: ACTION_LABELS[key] || key,
    reason: buildActionReason(key, primary)
  };
}

function buildActionReason(key, primary = {}) {
  const reasons = {
    answer: "未命中强制 Skill、客户任务或明确交付物，按模型通用回答。",
    analyze: "输入要求基于客户、工作或上下文做判断与建议。",
    write: "输入明确要求生成可保存、可复制、可交付的文档正文。",
    execute_skill: "用户手动选择或系统明确命中 Skill。",
    generate_image: "输入明确要求产出图片或视觉结果。",
    generate_ppt: "输入明确要求产出 PPT 或演示文稿。",
    plan: "输入要求拆解目标、阶段、任务或执行路径。",
    parse_file: "本轮包含上传文件，需要先解析文件内容作为上下文。"
  };
  return primary.reason || reasons[key] || "";
}

function inferDomain({ primary = {}, message = "", customer = null } = {}) {
  let key = "general";
  if (customer || ["customer_analysis", "customer_talktrack"].includes(primary.intent)) key = "crm_customer";
  else if (/销售|客户|线索|商机|跟进|话术|报价|成交/.test(message)) key = "sales";
  else if (/需求|产品|PRD|prd|功能|小程序|App|APP|系统|平台/.test(message)) key = "product";
  else if (/agent|AI|模型|RAG|知识库|Skill|工作流/i.test(message)) key = "ai_system";
  else if (/工作|任务|计划|排期|复盘/.test(message)) key = "operations";
  return {
    key,
    label: {
      general: "通用",
      crm_customer: "CRM 客户",
      sales: "销售协作",
      product: "产品/需求",
      ai_system: "AI 系统",
      operations: "运营/工作"
    }[key] || key
  };
}

function inferContextPlan({ primary = {}, candidates = [], body = {}, skill = null, customer = null, hasAttachments = false } = {}) {
  const scopes = new Set(["current_message", "conversation_history"]);
  const tools = new Set();
  const reasons = [];

  if (customer || primary.customerBinding === "explicit") {
    scopes.add("selected_customer");
    tools.add("crm.getCustomerContext");
    reasons.push("已选择客户，读取单一客户隔离上下文。");
  } else if (primary.customerBinding === "collection" || ["customer_analysis", "customer_talktrack"].includes(primary.intent)) {
    scopes.add("customer_collection");
    tools.add("crm.searchCustomers");
    tools.add("crm.getCustomerContext");
    reasons.push("输入要求分析当前客户集合，读取 CRM 客户数据。");
  } else {
    scopes.add("default_workspace");
    reasons.push("默认工作台不读取客户档案，除非明确选择或命中客户。");
  }

  if (hasAttachments) {
    scopes.add("attachments");
    tools.add("file.parse");
    reasons.push("已检测到上传文件，文件解析结果进入模型上下文。");
  }
  if (skill) {
    scopes.add("skill_manifest");
    tools.add("skill.execute");
    reasons.push("手动选择 Skill，使用 Skill 配置和绑定能力。");
  }
  if (candidates.some((item) => item.intent === "rag_answer")) {
    scopes.add("knowledge_base");
    tools.add("rag.search");
    reasons.push("检测到知识库或资料引用诉求。");
  }
  if (candidates.some((item) => item.intent === "web_research")) {
    scopes.add("web");
    tools.add("web.search");
    reasons.push("检测到需要最新公开信息或网页检索。");
  }

  return {
    scopes: Array.from(scopes),
    tools: Array.from(tools),
    customerBinding: primary.customerBinding || (customer ? "explicit" : "none"),
    requiresCustomerContext: tools.has("crm.getCustomerContext"),
    requiresModelFallback: !skill && !["image_generation", "ppt_generation"].includes(primary.intent),
    reason: reasons.join(" ")
  };
}

function inferOutputMode({ primary = {}, action = {}, body = {}, skill = null } = {}) {
  let mode = "text";
  if (primary.intent === "image_generation") mode = "image_job";
  else if (primary.intent === "ppt_generation") mode = "document_card";
  else if (skill || primary.intent === "skill_execution") mode = "document_card";
  else if (primary.intent === "document_generation" || action.key === "write") mode = "document_card";
  else if (["customer_analysis", "customer_talktrack"].includes(primary.intent)) mode = "analysis_card";
  else if (Array.isArray(body.extraContext?.chatAttachments) && body.extraContext.chatAttachments.length > 0) mode = "document_card";

  return {
    mode,
    label: OUTPUT_LABELS[mode] || mode,
    reason: mode === "text"
      ? "普通问答直接展示正文。"
      : mode === "analysis_card"
        ? "客户或工作分析以结构化分析卡展示。"
        : mode === "image_job"
          ? "图片生成以后台任务卡展示。"
          : "明确交付物或手动 Skill 以文档卡片展示。"
  };
}

function shouldUseRemoteModel(body = {}) {
  const modelId = String(body.modelId || "");
  return modelId && modelId !== "model_local";
}

function isCustomerPortfolioIntent(message = "") {
  const text = String(message || "").trim();
  const mentionsCustomerGroup = /(我的|我手上|手上|当前|现在|名下|负责|这|这些|那几个|两个|2个|几个|所有).{0,10}(客户|线索|商机)|(客户|线索|商机).{0,10}(两个|2个|几个|这些|当前|现在|手上|名下|负责)/.test(text);
  const asksAnalysis = /(分析|复盘|判断|看看|为什么|原因|推进|跟进|失败|卡住|停滞|没办法|无法|不能|下一步|分别|优先级|做什么|话术|怎么说|发什么|沟通策略)/.test(text);
  return mentionsCustomerGroup && asksAnalysis;
}

function isCustomerTalktrackIntent(message = "") {
  return /(话术|怎么说|发什么|沟通策略|开场白|跟客户说|回复客户|客户回复|邀约|约客户|推进).{0,20}/.test(String(message || ""));
}

function isDocumentIntent(message = "") {
  return isExplicitDocumentIntent(message);
}

function isExplicitDocumentIntent(message = "") {
  const text = String(message || "");
  const documentTarget = /(需求文档|需求说明|prd|PRD|产品需求文档|业务需求文档|方案文档|方案大纲|解决方案|正式方案|报告|计划书|说明书|SOP|sop|会议纪要|项目计划|交付文档|文档)/i;
  const documentAction = /(写|生成|输出|出一份|做一份|整理成|拟|起草|产出|形成|保存为|创建)/;
  return documentTarget.test(text) && documentAction.test(text);
}

function isPptIntent(message = "", skill = null) {
  return /(ppt|PPT|幻灯片|演示文稿|路演|汇报材料|deck)/.test(`${message || ""} ${skill?.name || ""}`);
}

function isPlanningIntent(message = "") {
  return /(计划|排期|里程碑|任务|流程|工作流|规划|拆解|roadmap)/i.test(String(message || ""));
}

function isWorkAnalysisIntent(message = "") {
  return /(今天|今日|本日).*(工作|任务|事项|进展|复盘|总结|分析)|工作.*(分析|复盘|总结)|任务.*(分析|复盘|总结)/.test(String(message || ""));
}

function isRagIntent(message = "", skill = null, body = {}) {
  const text = `${message || ""} ${skill?.name || ""} ${skill?.description || ""} ${body.extraContext?.userIntent || ""}`;
  return Boolean(skill?.knowledgeBaseIds?.length)
    || /知识库|rag|RAG|资料库|历史方案|历史案例|案例库|参考案例|参考资料|公司能力|产品能力|话术库|根据资料|引用资料|查知识库/.test(text);
}

function isWebResearchIntent(message = "", skill = null, body = {}) {
  const text = `${message || ""} ${skill?.name || ""} ${skill?.toolType || ""} ${body.extraContext?.webResearch || ""}`;
  const companyListQuestion = /(有哪些|哪些|推荐|排名|名单|几家).{0,18}(公司|企业|服务商|供应商|机构|外包|开发商|厂商)|(公司|企业|服务商|供应商|机构|外包|开发商|厂商).{0,18}(有哪些|哪些|推荐|排名|名单|几家)/i.test(text);
  return /联网|搜索|最新|市场|竞品|政策|新闻|官网|网页|爬虫|公开资料/.test(text)
    || companyListQuestion
    || ["web_search", "web_crawl", "company_research", "industry_research", "competitive_research", "policy_research"].includes(String(skill?.toolType || ""));
}

function isExplicitImageIntent(message = "", body = {}, skill = null) {
  const text = String(message || "");
  if (body.toolMode === "image2" || body.extraContext?.toolMode === "image2") return true;
  if (String(skill?.toolType || "").toLowerCase() === "image2") return true;
  if (/image2|生图/.test(text) && /(生成|画|出|制作|创建|做一张|做个|做一个|帮我|我要|需要)/.test(text)) return true;
  if (/(生成图片|画一张|出图|做一张图|做个图|做一个图)/.test(text)) return true;
  const visualTarget = /(图片|视觉稿|海报|交互图|界面图|产品图|设计图|UI\s*图|原型图)/i;
  const visualAction = /(生成|画|出|设计|制作|创建|产出|做一张|做个|做一个)/;
  const knowledgeQuestion = /(是什么|有哪些|几个|多少|区别|怎么选|介绍|解释|了解|关于|模型|能力|价格|额度|恢复|原理|文档|教程|用法|支持)/;
  if (knowledgeQuestion.test(text) && !/(帮我|给我).{0,8}(生成|画|出|设计|制作|创建)/.test(text)) return false;
  return visualTarget.test(text) && visualAction.test(text);
}

function unique(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}
