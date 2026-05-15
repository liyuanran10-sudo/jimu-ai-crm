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
  return {
    intent: primary.intent,
    label: primary.label,
    confidence: primary.confidence,
    reason: primary.reason,
    candidates: candidates.slice(0, 6),
    customerBinding: primary.customerBinding || (customer ? "explicit" : "none"),
    selectedSkillId: skill?.id || "",
    selectedSkillName: skill?.name || "",
    tools: unique(candidates.flatMap((item) => item.tools || [])),
    responseMode: primary.responseMode || "sync"
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
  const text = String(message || "");
  return /(需求文档|需求说明|prd|产品需求|功能清单|方案大纲|解决方案|报告|计划书|说明书|文档)/i.test(text)
    && /(写|生成|出|做|整理|拟|起草|产出|给我|帮我|设计|规划|梳理|创建)/.test(text);
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
