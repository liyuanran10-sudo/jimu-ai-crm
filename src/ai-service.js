import http from "node:http";
import tls from "node:tls";
import { getStageName, getUserName, nowIso } from "./crm-store.js";
import { buildWebResearchContext } from "./web-research.js";
import { buildRagContext } from "./rag-service.js";

const GENERATION_LABELS = {
  follow_strategy: "客户跟进策略",
  demand_analysis: "客户需求分析",
  proposal_outline: "解决方案大纲",
  failure_report: "失败分析报告",
  chat: "AI 售前助手",
  follow_summary: "跟进记录总结",
  interaction_image_prompt: "交互图提示词",
  interaction_image_drafts: "交互图界面草稿",
  default_image_prompt: "默认生图提示词",
  consultation_advice: "客户前期咨询回应策略报告",
  next_communication_question_list: "下一步沟通问题清单",
  lightweight_solution: "轻量级方案",
  solution_deepening: "需求深化方案",
  historical_solution_entry: "历史方案库沉淀",
  requirement_document: "需求文档",
  lightweight_solution_ppt_outline: "轻量级方案PPT结构稿"
};

const TYPE_OUTPUTS = {
  follow_strategy: [
    "客户当前状态判断",
    "客户核心诉求",
    "当前推进难点",
    "本阶段跟进目标",
    "推进路径设计",
    "建议沟通问题",
    "推荐沟通话术",
    "推荐输出材料",
    "下一步动作",
    "风险提醒"
  ],
  demand_analysis: [
    "客户需求摘要",
    "真实诉求判断",
    "业务目标拆解",
    "现有基础与约束",
    "待澄清问题",
    "AI 融入点",
    "下一步建议"
  ],
  proposal_outline: [
    "方案定位",
    "客户痛点",
    "建设目标",
    "功能模块",
    "AI 融入点",
    "MVP 范围",
    "实施阶段",
    "PPT 结构",
    "会议讲解逻辑"
  ],
  failure_report: [
    "客户基本信息",
    "客户需求回顾",
    "跟进过程回顾",
    "失败原因分析",
    "核心失败原因",
    "可提前识别的问题",
    "内部改进建议",
    "是否值得重新激活"
  ],
  chat: [
    "直接回答",
    "意图判断",
    "执行路径",
    "可执行建议",
    "可沉淀内容"
  ],
  follow_summary: [
    "本次沟通摘要",
    "客户明确反馈",
    "内部判断",
    "下一步动作"
  ],
  interaction_image_prompt: [
    "设计目标",
    "页面结构",
    "交互重点",
    "视觉风格",
    "Image2 提示词",
    "负向提示词",
    "待确认信息"
  ],
  interaction_image_drafts: [
    "界面拆解策略",
    "JSON"
  ],
  default_image_prompt: [
    "意图解析",
    "画面目标",
    "视觉方向",
    "Image2 提示词",
    "负向提示词",
    "可迭代方向"
  ],
  consultation_advice: [
    "客户需求理解",
    "客户真实意图与隐性诉求",
    "客户关注点与对应解决方案",
    "业务系统 + AI 融入判断",
    "AI 原生应用升级判断",
    "案例匹配与销售讲法",
    "下一步客户期待的行动建议",
    "销售人员沟通策略",
    "销售人员行动汇总"
  ],
  next_communication_question_list: [
    "本次沟通目标",
    "沟通前客户状态判断",
    "必须确认的核心问题",
    "按主题拆分的问题清单",
    "顾问式提问话术",
    "不建议直接问的问题",
    "沟通后应形成的判断",
    "销售人员行动清单"
  ],
  lightweight_solution: [
    "一、项目理解与产品承接",
    "二、从当前需求出发，可进一步梳理的产品层次",
    "三、从核心功能到完整产品：按端口梳理功能结构",
    "四、AI 能力在本项目中的适合融入点",
    "五、产品结构可先作如下理解",
    "六、后续建议确认事项"
  ],
  solution_deepening: [
    "场景定义",
    "项目概述与建设目标",
    "项目整体方案",
    "核心场景方案",
    "AI能力与落地方案",
    "建设范围与落地策略",
    "积木科技介绍"
  ],
  historical_solution_entry: [
    "方案摘要",
    "客户与项目画像",
    "客户需求与真实诉求",
    "方案主线与产品结构",
    "核心场景与业务闭环",
    "AI 融入点",
    "MVP 范围与阶段规划",
    "交付依赖与风险",
    "可复用标签与检索关键词",
    "后续引用建议"
  ],
  requirement_document: [
    "一、项目背景与需求来源",
    "二、项目目标与建设范围",
    "三、用户角色与端口规划",
    "四、整体业务流程",
    "五、项目功能介绍",
    "六、各端口详细需求文档",
    "七、AI 需求文档",
    "八、数据、权限与系统集成需求",
    "九、非功能需求与交付边界",
    "十、MVP 范围建议",
    "十一、验收口径建议",
    "十二、待确认问题清单",
    "十三、下一步建议"
  ],
  lightweight_solution_ppt_outline: [
    "一、PPT整体定位",
    "二、PPT建议风格",
    "三、PPT页面结构",
    "四、每页详细内容稿",
    "五、PPT生成提示词"
  ]
};

const OUTPUT_RULES = [
  "输出必须使用 Markdown。",
  "整体结构必须采用「标题 + 分节列表」：每个主要结论用二级标题，每个标题下优先使用无序列表、编号列表或任务列表，避免大段连续散文。",
  "如需展示字段对比、阶段拆解、材料清单，可以使用 Markdown 表格；如需给出模板或提示词，可以使用 fenced code block。",
  "如需展示流程、Agent 编排、客户推进路径、RAG 链路或系统架构，可以使用 fenced code block 输出 Mermaid，例如 ```mermaid 的 flowchart TD 或 sequenceDiagram。",
  "先给结论，再给原因和行动。",
  "所有建议都要落到下一步动作、沟通问题、材料产出或风险提醒。",
  "不要编造客户未提供的预算、决策人、竞品、案例或时间节点。",
  "如果信息不足，用「待确认」明确列出要向客户确认的问题。",
  "推荐话术要能直接复制到微信、会议或邮件里使用。",
  "失败分析要区分客户原因、我方原因、商务原因和外部竞争原因。",
  "不要把意图识别、任务规划、工具调度、RAG/联网未执行、当前限制等系统过程写入最终正文；这些过程由界面单独展示。",
  "如果上下文包含知识库检索结果，必须标注知识库名称、文档名称和相关度；不要把未命中的知识库内容写成事实。",
  "如果上下文包含联网资料，必须标注引用来源链接和检索时间；不要把联网结果中没有出现的信息写成事实。"
];

const CUSTOMER_MEMORY_RULES = [
  "客户上下文是最高优先级边界：只能使用当前 customer.id 对应的客户档案、跟进记录、资料、AI 历史和客户记忆。",
  "不同客户的记忆必须隔离；即使行业、联系人或需求相似，也不得引用其他客户的事实、结论、预算、风险或话术。",
  "如果用户问题没有明确要求跨客户对比，默认只回答当前客户。",
  "需要沉淀的新信息必须写成可保存到当前客户档案的条目，不要写入其他客户。"
];

const DEFAULT_WORKSPACE_RULES = [
  "默认 AI 工作台没有选择客户时，不读取任何客户档案、客户跟进记录、客户资料或客户记忆。",
  "例外：如果用户输入明确命中某个客户名称、联系人、微信、电话或邮箱，则只读取该被命中的单一客户上下文，并继续保持客户间记忆隔离。",
  "默认 AI 工作台只能使用用户当前消息、全局 Skill 配置、知识库 RAG 命中内容、联网检索结果和全局生成历史。",
  "采用成熟 Agent 工作流：Router 意图识别 -> Planner 任务拆解 -> Retriever 检索知识库/联网资料 -> Skill Executor 调用匹配 Skill -> Reflector 输出校验与下一步。",
  "当用户要求任务规划、方案拆解、提示词、工作流、运营策略、市场打法、RAG 设计、Skill 编排或生图时，优先给结构化执行方案。",
  "Agent 的识别、规划、调度和工具状态是内部过程，不要输出到最终正文；最终正文只给用户可直接使用的结论、文档、话术或下一步动作。",
  "当信息不足时，先列出假设和待确认项，不要把默认推断写成客户事实。"
];

const DEFAULT_AGENT_OUTPUT_SECTIONS = [
  "直接结论",
  "可执行方案",
  "关键步骤",
  "待确认事项",
  "下一步动作"
];

const DEFAULT_REMOTE_TIMEOUT_MS = 60000;
const DEFAULT_AI_CONTEXT_MAX_CHARS = 16000;
const DEFAULT_AI_PROMPT_MAX_CHARS = 22000;

const CONTEXT_PROFILES = {
  follow_strategy: {
    conversationTurns: 3,
    followRecords: 5,
    followChars: 360,
    memories: 4,
    memoryChars: 420,
    files: 2,
    fileChars: 520,
    generations: 2,
    generationChars: 180,
    ragMatches: 4,
    ragChars: 420,
    webResults: 4,
    webPages: 1,
    webPageChars: 520,
    extraChars: 900
  },
  demand_analysis: {
    conversationTurns: 3,
    followRecords: 4,
    followChars: 320,
    memories: 4,
    memoryChars: 420,
    files: 3,
    fileChars: 1400,
    generations: 2,
    generationChars: 180,
    ragMatches: 5,
    ragChars: 480,
    webResults: 4,
    webPages: 1,
    webPageChars: 560,
    extraChars: 1000
  },
  proposal_outline: {
    conversationTurns: 3,
    followRecords: 4,
    followChars: 340,
    memories: 4,
    memoryChars: 420,
    files: 3,
    fileChars: 1600,
    generations: 3,
    generationChars: 220,
    ragMatches: 5,
    ragChars: 520,
    webResults: 4,
    webPages: 1,
    webPageChars: 620,
    extraChars: 1100
  },
  failure_report: {
    conversationTurns: 2,
    followRecords: 7,
    followChars: 300,
    memories: 4,
    memoryChars: 360,
    files: 2,
    fileChars: 420,
    generations: 2,
    generationChars: 160,
    ragMatches: 2,
    ragChars: 300,
    webResults: 2,
    webPages: 0,
    webPageChars: 0,
    extraChars: 1200
  },
  chat: {
    conversationTurns: 6,
    followRecords: 4,
    followChars: 300,
    memories: 4,
    memoryChars: 360,
    files: 2,
    fileChars: 420,
    generations: 3,
    generationChars: 180,
    ragMatches: 4,
    ragChars: 420,
    webResults: 3,
    webPages: 1,
    webPageChars: 480,
    extraChars: 1200
  },
  follow_summary: {
    conversationTurns: 1,
    followRecords: 2,
    followChars: 520,
    memories: 2,
    memoryChars: 260,
    files: 1,
    fileChars: 260,
    generations: 1,
    generationChars: 140,
    ragMatches: 0,
    ragChars: 0,
    webResults: 0,
    webPages: 0,
    webPageChars: 0,
    extraChars: 900
  },
  interaction_image_prompt: {
    conversationTurns: 2,
    followRecords: 3,
    followChars: 240,
    memories: 2,
    memoryChars: 260,
    files: 2,
    fileChars: 360,
    generations: 1,
    generationChars: 120,
    ragMatches: 2,
    ragChars: 300,
    webResults: 2,
    webPages: 0,
    webPageChars: 0,
    extraChars: 800
  },
  interaction_image_drafts: {
    conversationTurns: 2,
    followRecords: 5,
    followChars: 360,
    memories: 3,
    memoryChars: 360,
    files: 4,
    fileChars: 1400,
    generations: 3,
    generationChars: 420,
    ragMatches: 4,
    ragChars: 420,
    webResults: 0,
    webPages: 0,
    webPageChars: 0,
    extraChars: 1800
  },
  default_image_prompt: {
    conversationTurns: 4,
    followRecords: 0,
    followChars: 0,
    memories: 0,
    memoryChars: 0,
    files: 0,
    fileChars: 0,
    generations: 2,
    generationChars: 160,
    ragMatches: 3,
    ragChars: 380,
    webResults: 3,
    webPages: 1,
    webPageChars: 420,
    extraChars: 800,
    skillCatalog: 8
  },
  consultation_advice: {
    conversationTurns: 2,
    followRecords: 4,
    followChars: 420,
    memories: 3,
    memoryChars: 360,
    files: 4,
    fileChars: 2200,
    generations: 2,
    generationChars: 180,
    ragMatches: 6,
    ragChars: 620,
    webResults: 2,
    webPages: 0,
    webPageChars: 0,
    extraChars: 1400
  },
  next_communication_question_list: {
    conversationTurns: 2,
    followRecords: 5,
    followChars: 380,
    memories: 4,
    memoryChars: 360,
    files: 3,
    fileChars: 1200,
    generations: 3,
    generationChars: 240,
    ragMatches: 5,
    ragChars: 520,
    webResults: 2,
    webPages: 0,
    webPageChars: 0,
    extraChars: 2600
  },
  lightweight_solution: {
    conversationTurns: 2,
    followRecords: 6,
    followChars: 520,
    memories: 4,
    memoryChars: 520,
    files: 5,
    fileChars: 2400,
    generations: 4,
    generationChars: 520,
    ragMatches: 5,
    ragChars: 560,
    webResults: 2,
    webPages: 0,
    webPageChars: 0,
    extraChars: 3200
  },
  solution_deepening: {
    conversationTurns: 2,
    followRecords: 7,
    followChars: 560,
    memories: 6,
    memoryChars: 680,
    files: 6,
    fileChars: 2800,
    generations: 7,
    generationChars: 820,
    ragMatches: 8,
    ragChars: 760,
    webResults: 2,
    webPages: 0,
    webPageChars: 0,
    extraChars: 4600
  },
  historical_solution_entry: {
    conversationTurns: 1,
    followRecords: 8,
    followChars: 520,
    memories: 6,
    memoryChars: 640,
    files: 6,
    fileChars: 2600,
    generations: 8,
    generationChars: 900,
    ragMatches: 4,
    ragChars: 520,
    webResults: 0,
    webPages: 0,
    webPageChars: 0,
    extraChars: 4200
  },
  requirement_document: {
    conversationTurns: 2,
    followRecords: 7,
    followChars: 560,
    memories: 6,
    memoryChars: 620,
    files: 6,
    fileChars: 2600,
    generations: 6,
    generationChars: 720,
    ragMatches: 6,
    ragChars: 620,
    webResults: 2,
    webPages: 0,
    webPageChars: 0,
    extraChars: 3800
  },
  lightweight_solution_ppt_outline: {
    conversationTurns: 2,
    followRecords: 6,
    followChars: 520,
    memories: 4,
    memoryChars: 520,
    files: 4,
    fileChars: 2000,
    generations: 4,
    generationChars: 520,
    ragMatches: 0,
    ragChars: 0,
    webResults: 0,
    webPages: 0,
    webPageChars: 0,
    extraChars: 3600
  }
};

const DEFAULT_CONTEXT_PROFILE = CONTEXT_PROFILES.chat;
const OUTPUT_TOKEN_LIMITS = {
  follow_strategy: 2200,
  demand_analysis: 2200,
  proposal_outline: 2800,
  failure_report: 2400,
  chat: 2200,
  follow_summary: 900,
  interaction_image_prompt: 1200,
  interaction_image_drafts: 1800,
  default_image_prompt: 1200,
  consultation_advice: 5000,
  next_communication_question_list: 5200,
  lightweight_solution: 5600,
  solution_deepening: 6800,
  historical_solution_entry: 5600,
  requirement_document: 6200,
  lightweight_solution_ppt_outline: 5200
};

export async function generateCrmContent({ db, type, customerId, skillId, userId, message, extraContext, modelId, config }) {
  const prepared = await prepareCrmGeneration({ db, type, customerId, skillId, userId, message, extraContext, modelId, config });
  const { generationType, customer, skill, model, context, title, prompt, storedPrompt } = prepared;

  const remote = await maybeGenerateWithRemoteModel({
    model,
    config,
    prompt,
    title,
    generationType
  });

  if (remote && !isRemoteErrorFallbackText(remote)) {
    return {
      title,
      generationType,
      skillId: skill?.id || "",
      modelName: model?.name || config.openaiModel || "remote-model",
      prompt: storedPrompt,
      inputContext: context,
      outputContent: remote,
      createdAt: nowIso()
    };
  }

  if (!remote && !isRemoteProvider(model?.provider)) {
    const outputContent = generateLocalMarkdown({
      db,
      generationType,
      customer,
      skill,
      context,
      message,
      extraContext
    });
    return {
      title,
      generationType,
      skillId: skill?.id || "",
      modelName: "本地规则生成",
      prompt: storedPrompt,
      inputContext: context,
      outputContent,
      createdAt: nowIso()
    };
  }

  const failureOutput = remote || buildRemoteErrorFallback({
    title,
    generationType,
    modelId: model?.modelId || config.openaiModel || "未配置模型",
    baseUrl: model?.baseUrl || "",
    provider: model?.provider || "local",
    errorText: "当前没有可用远程模型或 API Key。系统已按配置停止生成，不再使用本地规则兜底。"
  });

  return {
    title,
    generationType,
    skillId: skill?.id || "",
    modelName: model?.name || config.openaiModel || "AI 模型调用失败",
    prompt: storedPrompt,
    inputContext: {
      ...context,
      remoteModelFailure: buildRemoteFailureMeta({ model, config, remoteOutput: failureOutput })
    },
    outputContent: failureOutput,
    createdAt: nowIso()
  };
}

export async function streamCrmContent({ db, type, customerId, skillId, userId, message, extraContext, modelId, config, onToken, onStatus }) {
  const isDefaultAgentChat = !customerId && normalizeGenerationType(type) === "chat";
  await onStatus?.(isDefaultAgentChat ? "正在准备默认 AI 回复..." : "正在读取上下文并生成回答...");
  const prepared = await prepareCrmGeneration({ db, type, customerId, skillId, userId, message, extraContext, modelId, config });
  const { generationType, customer, skill, model, context, title, prompt, storedPrompt } = prepared;

  await onStatus?.(isDefaultAgentChat ? "正在整理回答结构..." : "正在连接 AI 模型...");
  const remote = await maybeStreamWithRemoteModel({
    model,
    config,
    prompt,
    title,
    generationType,
    onToken,
    onStatus
  });

  const failed = !remote || isRemoteErrorFallbackText(remote);
  const shouldUseExplicitLocalModel = !remote && !isRemoteProvider(model?.provider);
  const outputContent = failed
    ? (shouldUseExplicitLocalModel
      ? generateLocalMarkdown({
        db,
        generationType,
        customer,
        skill,
        context,
        message,
        extraContext
      })
      : (remote || buildRemoteErrorFallback({
      title,
      generationType,
      modelId: model?.modelId || config.openaiModel || "未配置模型",
      baseUrl: model?.baseUrl || "",
      provider: model?.provider || "local",
      errorText: "当前没有可用远程模型或 API Key。系统已按配置停止生成，不再使用本地规则兜底。"
    })))
    : remote;

  if (failed && !shouldUseExplicitLocalModel) {
    await onStatus?.("远程模型调用失败，已返回失败原因，可修复配置后重新生成。");
    await streamTextChunks(outputContent, onToken);
  } else if (shouldUseExplicitLocalModel) {
    await onStatus?.(isDefaultAgentChat ? "Agent Executor 正在生成本地执行结果..." : "正在使用本地规则生成...");
    await streamTextChunks(outputContent, onToken);
  }

  return {
    title,
    generationType,
    skillId: skill?.id || "",
    modelName: shouldUseExplicitLocalModel
      ? "本地规则生成"
      : failed ? (model?.name || config.openaiModel || "AI 模型调用失败") : (model?.name || config.openaiModel || "remote-model"),
    prompt: storedPrompt,
    inputContext: failed && !shouldUseExplicitLocalModel
      ? { ...context, remoteModelFailure: buildRemoteFailureMeta({ model, config, remoteOutput: outputContent }) }
      : context,
    outputContent,
    createdAt: nowIso()
  };
}

export async function testCrmModel({ db, modelId, config }) {
  const model = pickModel(db, modelId, config);
  if (!model) {
    return {
      ok: false,
      provider: "none",
      modelName: "未配置模型",
      modelId: "",
      message: "系统还没有可用模型配置。"
    };
  }

  if (model.provider === "local") {
    return {
      ok: true,
      provider: "local",
      modelName: model.name,
      modelId: model.modelId,
      message: "本地规则生成可用。配置远程模型 API Key 后，AI 对话和策略会自动优先调用 GPT 模型。"
    };
  }

  if (isRemoteProvider(model.provider) && !(model.apiKey || config.openaiApiKey)) {
    return {
      ok: false,
      provider: model.provider,
      modelName: model.name,
      modelId: model.modelId || config.openaiModel,
      message: "远程模型还没有配置 API Key。请在系统设置的「模型」里填写 API Key，或在 `.env` 中配置 `OPENAI_API_KEY`。"
    };
  }

  const prompt = [
    "请用一句中文回答：积木科技 AI CRM 模型连通性测试成功。",
    "只返回测试结果，不要输出额外解释。"
  ].join("\n");
  const output = await maybeGenerateWithRemoteModel({
    model,
    config,
    prompt,
    title: "模型连通性测试",
    generationType: "chat"
  });
  const failed = isRemoteErrorFallbackText(output);

  return {
    ok: !failed,
    provider: model.provider,
    modelName: model.name,
    modelId: model.modelId || config.openaiModel,
    message: failed ? output : output || "模型连通性测试成功。"
  };
}

async function prepareCrmGeneration({ db, type, customerId, skillId, userId, message, extraContext, modelId, config }) {
  const generationType = normalizeGenerationType(type);
  const customer = db.customers.find((item) => item.id === customerId) || null;
  const referencedCustomer = !customer && generationType === "chat" && extraContext?.referencedCustomerId
    ? db.customers.find((item) => item.id === extraContext.referencedCustomerId) || null
    : null;
  const contextCustomer = customer || referencedCustomer;
  const explicitSkill = skillId ? db.skills.find((item) => item.id === skillId && item.status !== "disabled") || null : null;
  const skill = generationType === "chat"
    ? explicitSkill
    : (explicitSkill || pickSkillForType(db, generationType, contextCustomer?.stage));
  const model = pickModel(db, modelId, config);
  const rawContext = buildContext(db, contextCustomer, userId, {
    ...(extraContext || {}),
    defaultWorkspaceReferencedCustomer: referencedCustomer ? {
      id: referencedCustomer.id,
      name: referencedCustomer.name,
      reason: extraContext?.referencedCustomerReason || "用户默认对话输入命中客户信息。"
    } : null
  });
  let context = rawContext;
  context.webResearch = await buildWebResearchContext({
    db,
    customer: contextCustomer,
    skill,
    generationType,
    message,
    extraContext,
    config
  });
  context.knowledgeBase = buildRagContext({
    db,
    customer: contextCustomer,
    skill,
    generationType,
    message,
    extraContext
  });
  if (!customerId && generationType === "chat") {
    context.defaultAgent = buildDefaultAgentPlan({
      db,
      message,
      skill,
      extraContext,
      webResearch: context.webResearch,
      knowledgeBase: context.knowledgeBase
    });
  }
  context = optimizeContextForAi({
    context,
    generationType,
    customer: contextCustomer,
    skill,
    message,
    config
  });
  const title = buildTitle(generationType, contextCustomer);
  const prompt = buildPrompt({ db, generationType, customer: contextCustomer, skill, context, message });
  const storedPrompt = buildStoredPromptSummary({
    generationType,
    customer: contextCustomer,
    skill,
    prompt,
    context
  });

  return {
    generationType,
    customer: contextCustomer,
    skill,
    model,
    context,
    title,
    prompt,
    storedPrompt
  };
}

function normalizeGenerationType(type) {
  if (TYPE_OUTPUTS[type]) return type;
  return "follow_strategy";
}

function pickSkillForType(db, type, stage) {
  const fixedSkillNames = {
    consultation_advice: ["前期咨询回应策略"],
    next_communication_question_list: ["下一步沟通问题清单"],
    lightweight_solution: ["轻量级方案"],
    solution_deepening: ["需求深化方案"],
    historical_solution_entry: ["需求深化方案", "方案大纲", "轻量级方案"],
    requirement_document: ["生成需求文档", "需求文档"],
    lightweight_solution_ppt_outline: ["轻量级方案 PPT", "轻量级方案PPT"]
  }[type];
  if (fixedSkillNames) {
    const fixed = db.skills.find((skill) => {
      return skill.status !== "disabled" && fixedSkillNames.some((name) => skill.name.includes(name));
    });
    if (fixed) return fixed;
  }

  const names = {
    follow_strategy: ["下一步动作", "首次沟通策略"],
    demand_analysis: ["需求分析"],
    proposal_outline: ["方案大纲"],
    failure_report: ["失败分析"],
    follow_summary: ["跟进总结"],
    interaction_image_prompt: ["交互图生成", "方案大纲"],
    interaction_image_drafts: ["交互图生成", "轻量级方案", "方案大纲"],
    default_image_prompt: ["默认生图", "交互图生成"],
    consultation_advice: ["前期咨询回应策略", "首次沟通策略", "案例匹配"],
    next_communication_question_list: ["下一步沟通问题清单", "前期咨询回应策略", "下一步动作"],
    lightweight_solution: ["轻量级方案", "方案大纲", "需求深化方案"],
    solution_deepening: ["需求深化方案", "轻量级方案", "方案大纲"],
    historical_solution_entry: ["需求深化方案", "方案大纲", "轻量级方案"],
    requirement_document: ["生成需求文档", "需求文档", "轻量级方案", "需求深化方案"],
    lightweight_solution_ppt_outline: ["轻量级方案 PPT", "轻量级方案PPT", "PPT 结构"]
  }[type] || [];

  return db.skills.find((skill) => {
    const stageMatched = !stage || !skill.applicableStages?.length || skill.applicableStages.includes(stage);
    return stageMatched && names.some((name) => skill.name.includes(name));
  }) || db.skills.find((skill) => skill.status !== "disabled") || null;
}

function sortCustomerGenerationMemoryRecords(records = []) {
  return ensureArray(records).sort((a, b) => {
    const aSaved = a.inputContext?.customerArchive?.savedAt ? 1 : 0;
    const bSaved = b.inputContext?.customerArchive?.savedAt ? 1 : 0;
    if (aSaved !== bSaved) return bSaved - aSaved;
    const aLongForm = isCustomerFacingLongFormType(a.generationType) ? 1 : 0;
    const bLongForm = isCustomerFacingLongFormType(b.generationType) ? 1 : 0;
    if (aLongForm !== bLongForm) return bLongForm - aLongForm;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

function isCustomerFacingLongFormType(type = "") {
  return ["consultation_advice", "lightweight_solution", "solution_deepening", "historical_solution_entry", "requirement_document", "proposal_outline", "demand_analysis", "next_communication_question_list"].includes(type);
}

function pickModel(db, modelId, config = {}) {
  const selected = db.models.find((item) => item.id === modelId && item.status !== "disabled");
  if (selected) return selected;

  const enabledModels = db.models.filter((item) => item.status !== "disabled");
  const configuredRemote = enabledModels.find((item) => {
    return isRemoteProvider(item.provider) && (item.apiKey || config.openaiApiKey);
  });

  return configuredRemote
    || enabledModels.find((item) => item.isDefault)
    || enabledModels.find((item) => isRemoteProvider(item.provider))
    || enabledModels[0]
    || null;
}

function isRemoteProvider(provider) {
  return String(provider || "").toLowerCase() !== "local";
}

function buildTitle(type, customer) {
  const label = GENERATION_LABELS[type] || "AI 生成";
  return customer ? `${customer.name} - ${label}` : label;
}

function buildContext(db, customer, userId, extraContext = {}) {
  const { conversationHistory, ...safeExtraContext } = extraContext || {};
  const follows = customer
    ? db.followRecords
      .filter((item) => item.customerId === customer.id)
      .sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt))
      .slice(0, 8)
    : [];

  const history = customer
    ? sortCustomerGenerationMemoryRecords(db.aiGenerationRecords
      .filter((item) => item.customerId === customer.id))
      .slice(0, 8)
    : [];

  const files = customer
    ? db.customerFiles.filter((item) => item.customerId === customer.id).slice(0, 5)
    : [];

  const memories = customer
    ? db.customerMemories
      .filter((item) => item.customerId === customer.id && item.status !== "disabled")
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
      .slice(0, 8)
    : [];
  const globalHistory = !customer
    ? db.aiGenerationRecords
      .filter((item) => !item.customerId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 6)
    : [];

  return {
    generatedBy: getUserName(db, userId),
    isolation: {
      scope: customer ? "single_customer" : "global_workspace",
      customerId: customer?.id || "",
      rule: customer
        ? "本次 AI 只能读取和写入当前客户的上下文与记忆。"
        : "默认 AI 工作台不读取任何客户档案、跟进记录、客户资料或客户记忆。"
    },
    globalWorkspace: customer ? null : buildGlobalWorkspaceContext(db, globalHistory),
    customer: customer ? summarizeCustomer(db, customer) : null,
    customerMemoryStrategy: customer ? buildCustomerMemoryStrategy(db, customer) : null,
    customerMemories: memories.map((item) => ({
      memoryType: item.memoryType,
      strategy: item.strategy,
      title: item.title,
      content: String(item.content || "").slice(0, 1000),
      sourceType: item.sourceType,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    })),
    conversationHistory: normalizeConversationHistory(conversationHistory),
    followRecords: follows.map((item) => ({
      time: item.followTime,
      method: item.followMethod,
      stage: getStageName(db, item.stage),
      content: item.content,
      customerFeedback: item.customerFeedback,
      internalJudgement: item.internalJudgement,
      nextAction: item.nextAction,
      aiSummary: item.aiSummary
    })),
    files: files.map((item) => ({
      fileName: item.fileName,
      fileType: item.fileType,
      parsedText: String(item.parsedText || "").slice(0, 1200)
    })),
    recentGenerations: history.map((item) => ({
      type: item.generationType,
      title: item.title || GENERATION_LABELS[item.generationType] || "AI 生成",
      savedToCustomerArchive: Boolean(item.inputContext?.customerArchive?.savedAt),
      preview: String(item.outputContent || "").replace(/\s+/g, " ").slice(0, 1200)
    })),
    extra: safeExtraContext
  };
}

function buildGlobalWorkspaceContext(db, globalHistory) {
  return {
    mode: "default_ai_workspace",
    architecture: [
      "Router: 识别任务规划、意图策略、RAG 检索、Skill 调用、联网调研、生图等意图。",
      "Planner: 将目标拆成可执行步骤、产物、责任边界和验收标准。",
      "Retriever: 根据意图自动检索知识库或联网资料，不命中时明确说明。",
      "Skill Executor: 使用系统 Skill 的提示词、输出格式和工具类型完成任务。",
      "Reflector: 检查假设、风险、缺失信息和下一步动作。"
    ],
    skillCatalog: db.skills
      .filter((skill) => skill.status !== "disabled")
      .slice(0, 24)
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        toolType: skill.toolType || "",
        outputFormat: skill.outputFormat
      })),
    knowledgeBases: db.knowledgeBases
      .filter((kb) => kb.status !== "disabled")
      .map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
        type: kb.type,
        documentCount: kb.documents?.length || 0
      })),
    globalGenerationHistory: globalHistory.map((item) => ({
      type: item.generationType,
      title: item.title || GENERATION_LABELS[item.generationType] || "AI 生成",
      preview: String(item.outputContent || "").replace(/\s+/g, " ").slice(0, 260)
    })),
    imageGeneration: {
      provider: "image2",
      supported: true,
      note: "用户要求生图、交互图、海报、页面设计图、示意图或视觉稿时，默认走 image2 生图流程。"
    }
  };
}

function buildDefaultAgentPlan({ db, message, skill, extraContext = {}, webResearch = {}, knowledgeBase = {} }) {
  const intent = detectDefaultAgentIntent({ message, skill, extraContext, webResearch, knowledgeBase });
  const matchingSkills = pickAgentSkills(db, intent);
  const tools = buildAgentToolSchedule({ intent, matchingSkills, webResearch, knowledgeBase });
  const needsAsyncImage = intent.intents.some((item) => item.key === "image_generation");

  return {
    agentName: "AI CRM Default Agent",
    mode: "manus_like_agent",
    userGoal: limitText(message, 520) || "等待用户输入任务",
    router: {
      primaryIntent: intent.primaryIntent,
      confidence: intent.confidence,
      intents: intent.intents,
      reasoning: intent.reasoning
    },
    planner: {
      objective: buildAgentObjective(intent.primaryIntent, message),
      steps: buildAgentPlanSteps(intent),
      completionCriteria: [
        "回答必须直接解决用户当前输入，不输出空泛模板。",
        "如调用 RAG 或联网，需要说明命中情况与引用来源。",
        "如触发生图，先给设计解析和 image2 提示词，再将图片任务转入后台。"
      ]
    },
    scheduler: {
      tools,
      policy: "由 Agent 根据意图自动调度；任务规划、意图识别和调度器是内部策略，不是让用户点击的提示词模板。",
      asyncImageJob: needsAsyncImage ? "image2 后台生成，不阻塞连续对话" : ""
    },
    executor: {
      selectedSkills: matchingSkills,
      ragUsed: Boolean(knowledgeBase?.used),
      webUsed: Boolean(webResearch?.used),
      outputFormat: "完整 Markdown：标题、列表、表格、代码块、Mermaid 均可使用。"
    },
    reflector: {
      checks: [
        "是否把默认工作台内容误写成客户事实",
        "是否遗漏待确认信息",
        "是否给出了可执行下一步",
        "是否标注了 RAG/联网来源"
      ],
      memoryBoundary: "默认工作台只保存全局生成历史；不会读取或写入任何客户记忆。"
    }
  };
}

function detectDefaultAgentIntent({ message, skill, extraContext = {}, webResearch = {}, knowledgeBase = {} }) {
  const text = `${message || ""} ${skill?.name || ""} ${skill?.description || ""}`.toLowerCase();
  const candidates = [];
  const add = (key, label, score, reason) => {
    candidates.push({ key, label, score, reason });
  };

  if (/任务|计划|拆解|排期|里程碑|roadmap|执行|项目管理|规划/.test(text)) {
    add("task_planning", "任务规划", 0.86, "输入包含目标拆解、排期、执行或规划诉求。");
  }
  if (/agent|意图|路由|调度|工作流|编排|manus|自动判断|策略/.test(text)) {
    add("agent_strategy", "Agent 策略", 0.9, "输入关注 Agent、意图识别、调度或工作流架构。");
  }
  if (/知识库|rag|资料|文档|案例|引用|检索|向量|切片/.test(text) || knowledgeBase?.used) {
    add("rag_retrieval", "RAG 检索", knowledgeBase?.used ? 0.92 : 0.78, knowledgeBase?.used ? "知识库已经命中相关资料。" : "输入要求引用知识库、资料、文档或案例。");
  }
  if (/(需求文档|需求说明|prd|产品需求|功能清单|方案大纲|解决方案|报告|PPT|ppt|结构稿|计划书|说明书|文档)/i.test(text)
    && /(写|生成|出|做|整理|拟|起草|产出|给我|帮我|设计|规划|梳理|创建)/.test(text)) {
    add("document_generation", "文档生成", 0.88, "输入要求生成可交付文档，应直接输出完整结构，而不是要求先选择客户。");
  }
  if (/联网|搜索|最新|市场|竞品|政策|新闻|官网|网页|爬虫/.test(text) || webResearch?.used) {
    add("web_research", "联网调研", webResearch?.used ? 0.88 : 0.72, webResearch?.used ? "联网检索已经执行。" : "输入可能需要最新外部信息。");
  }
  if (/skill|技能|提示词|prompt|模板|复用能力/.test(text) || skill) {
    add("skill_execution", "Skill 执行", skill ? 0.86 : 0.74, skill ? `用户选择或系统匹配 Skill：${skill.name}` : "输入涉及 Skill、提示词或复用能力沉淀。");
  }
  if (extraContext?.toolMode === "image2" || isExplicitImageGenerationRequest(text)) {
    add("image_generation", "image2 生图", 0.9, "输入明确要求生成图片、视觉稿、交互图或设计图。");
  }
  if (!candidates.length) {
    add("general_answer", "通用咨询", 0.62, "没有检测到强工具意图，先按通用 AI CRM 助手回答。");
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    primaryIntent: candidates[0]?.label || "通用咨询",
    confidence: candidates[0]?.score || 0.62,
    intents: candidates.slice(0, 5),
    reasoning: candidates.map((item) => `${item.label}: ${item.reason}`).join(" ")
  };
}

function pickAgentSkills(db, intent) {
  const intentText = intent.intents.map((item) => `${item.key} ${item.label}`).join(" ");
  const patterns = [];
  if (/task_planning/.test(intentText)) patterns.push("任务", "下一步");
  if (/agent_strategy/.test(intentText)) patterns.push("意图", "策略", "工作流");
  if (/rag_retrieval/.test(intentText)) patterns.push("案例", "需求分析", "方案");
  if (/document_generation/.test(intentText)) patterns.push("需求文档", "需求分析", "方案大纲", "轻量级方案");
  if (/skill_execution/.test(intentText)) patterns.push("Skill", "提示词");
  if (/image_generation/.test(intentText)) patterns.push("生图", "交互图");

  return db.skills
    .filter((item) => item.status !== "disabled")
    .filter((item) => !patterns.length || patterns.some((pattern) => `${item.name} ${item.description}`.includes(pattern)))
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      name: item.name,
      toolType: item.toolType || "",
      description: limitText(item.description, 160)
    }));
}

function buildAgentToolSchedule({ intent, matchingSkills, webResearch = {}, knowledgeBase = {} }) {
  const toolMap = [
    {
      name: "Router",
      status: "completed",
      reason: `主意图：${intent.primaryIntent}，置信度：${Math.round((intent.confidence || 0) * 100)}%。`
    },
    {
      name: "Planner",
      status: "completed",
      reason: "已把用户输入拆成目标、步骤、产物和验收标准。"
    },
    {
      name: "RAG Retriever",
      status: knowledgeBase?.used ? "completed" : "skipped",
      reason: knowledgeBase?.reason || "当前问题未命中需要知识库的强意图。"
    },
    {
      name: "Web Retriever",
      status: webResearch?.used ? "completed" : "skipped",
      reason: webResearch?.reason || "当前问题未命中需要联网的强意图。"
    },
    {
      name: "Skill Executor",
      status: matchingSkills.length ? "ready" : "skipped",
      reason: matchingSkills.length ? `已匹配 ${matchingSkills.map((item) => item.name).join("、")}。` : "没有匹配到更具体的 Skill，使用默认 Agent 能力。"
    }
  ];

  if (intent.intents.some((item) => item.key === "image_generation")) {
    toolMap.push({
      name: "image2 Executor",
      status: "queued",
      reason: "识别到生图意图，图片任务应转入后台队列，避免阻塞对话输入。"
    });
  }

  return toolMap;
}

function buildAgentObjective(primaryIntent, message) {
  if (!message) return "等待用户输入后完成默认 Agent 编排。";
  return `围绕「${limitText(message, 180)}」完成${primaryIntent || "通用咨询"}，并输出可直接使用的结果。`;
}

function buildAgentPlanSteps(intent) {
  const steps = [
    "读取用户当前输入和最近对话摘要。",
    "通过 Router 判断主意图和可能的组合意图。",
    "由 Planner 拆解目标、产物、风险和验收标准。",
    "由 Scheduler 决定是否调用 RAG、联网、Skill 或 image2。"
  ];
  if (intent.intents.some((item) => item.key === "rag_retrieval")) steps.push("执行知识库检索并在回答中标注命中文档。");
  if (intent.intents.some((item) => item.key === "document_generation")) steps.push("按目标文档类型组织完整正文结构，包括背景、目标、范围、功能、流程、风险和待确认事项。");
  if (intent.intents.some((item) => item.key === "web_research")) steps.push("执行联网检索并标注来源链接和检索时间。");
  if (intent.intents.some((item) => item.key === "image_generation")) steps.push("生成 image2 提示词并把真实图片生成交给后台任务。");
  steps.push("由 Reflector 检查缺失信息、风险、引用和下一步动作。");
  return steps;
}

function summarizeCustomer(db, customer) {
  return {
    id: customer.id,
    name: customer.name,
    contactName: customer.contactName,
    contactPhone: customer.contactPhone,
    contactWechat: customer.contactWechat,
    contactEmail: customer.contactEmail,
    source: customer.source,
    customerType: customer.customerType,
    stage: getStageName(db, customer.stage),
    stageId: customer.stage,
    status: customer.status,
    salesPerson: getUserName(db, customer.ownerId),
    estimatedAmount: customer.estimatedAmount,
    dealProbability: customer.dealProbability,
    nextAction: customer.nextAction,
    nextFollowTime: customer.nextFollowTime,
    lastFollowTime: customer.lastFollowTime,
    demandDescription: customer.demandDescription,
    background: customer.background,
    problemToSolve: customer.problemToSolve,
    existingSystem: customer.existingSystem,
    budgetInfo: customer.budgetInfo,
    decisionInfo: customer.decisionInfo,
    knownRisks: customer.knownRisks,
    internalNotes: customer.internalNotes
  };
}

export function buildCustomerMemoryStrategy(db, customer) {
  const stageId = customer?.stage || "";
  const stageName = getStageName(db, stageId);
  const strategies = {
    initial_contact: {
      name: "初筛判断记忆",
      remember: ["客户来源与需求触发点", "真实采购意向线索", "预算/决策链是否出现", "下一次必须问清的问题"],
      avoid: ["不要过早沉淀完整方案承诺", "不要把未经确认的预算和决策人写成事实"]
    },
    demand_communication: {
      name: "需求澄清记忆",
      remember: ["客户原话", "业务流程与角色", "已确认边界", "待澄清问题", "客户关注点"],
      avoid: ["不要把我方猜测混入客户明确反馈", "不要跨客户复用需求结论"]
    },
    demand_deepening: {
      name: "方案落地记忆",
      remember: ["功能模块取舍", "AI 融入点", "MVP 范围", "数据/系统基础", "交付风险"],
      avoid: ["不要把二期能力写成一期承诺", "不要混入其他客户的方案结构"]
    },
    proposal: {
      name: "方案材料记忆",
      remember: ["已输出材料", "PPT 主线", "客户认可/反对点", "案例与演示需求"],
      avoid: ["不要引用未确认案例", "不要把通用方案当成客户专属结论"]
    },
    business: {
      name: "商务推进记忆",
      remember: ["预算口径", "报价解释", "范围锁定", "付款节点", "商务风险"],
      avoid: ["不要生成未授权价格承诺", "不要把其他客户报价作为事实依据"]
    },
    contract: {
      name: "签约交付记忆",
      remember: ["合同范围", "验收口径", "付款节点", "双方责任", "签约卡点"],
      avoid: ["不要遗漏签约前待确认事项", "不要写入未确认合同条款"]
    },
    won: {
      name: "交付交接记忆",
      remember: ["成交范围", "关键联系人", "承诺事项", "启动资料", "项目风险"],
      avoid: ["不要让售前假设进入交付事实", "不要跨客户共享交付细节"]
    },
    paused: {
      name: "暂缓激活记忆",
      remember: ["暂缓原因", "重新联系时机", "可激活价值点", "低打扰跟进节奏"],
      avoid: ["不要频繁推进", "不要把暂缓客户误判为失败"]
    },
    lost: {
      name: "失败复盘记忆",
      remember: ["失败原因", "客户真实顾虑", "我方改进点", "是否可重新激活", "激活条件"],
      avoid: ["不要模糊核心失败原因", "不要把失败客户结论迁移到其他客户"]
    }
  };
  const strategy = strategies[stageId] || {
    name: "通用客户记忆",
    remember: ["客户事实", "客户反馈", "内部判断", "下一步动作", "关键风险"],
    avoid: ["不要跨客户复用事实", "不要沉淀未经确认的信息"]
  };

  return {
    customerId: customer.id,
    stageId,
    stageName,
    strategyName: strategy.name,
    remember: strategy.remember,
    avoid: strategy.avoid,
    writePolicy: "只写入当前客户的 customerMemories 和 AI 生成历史。",
    isolationPolicy: "客户与客户之间的记忆完全隔离。"
  };
}

function normalizeConversationHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => ["user", "assistant"].includes(item?.role) && String(item.content || "").trim())
    .slice(-8)
    .map((item) => ({
      role: item.role,
      content: String(item.content || "").slice(0, 1200)
    }));
}

function optimizeContextForAi({ context, generationType, customer, skill, message, config = {} }) {
  const originalChars = measureJsonChars(context);
  const profile = getContextProfile(generationType, customer);
  const maxContextChars = Number(config.aiContextMaxChars || DEFAULT_AI_CONTEXT_MAX_CHARS);
  const maxPromptChars = Number(config.aiPromptMaxChars || DEFAULT_AI_PROMPT_MAX_CHARS);
  const optimized = {
    generatedBy: context.generatedBy,
    isolation: context.isolation,
    customer: context.customer ? compactCustomerContext(context.customer) : null,
    customerMemoryStrategy: compactMemoryStrategy(context.customerMemoryStrategy),
    customerMemories: compactCustomerMemories(context.customerMemories, profile),
    conversationHistory: compactConversationHistory(context.conversationHistory, profile),
    followRecords: compactFollowRecords(context.followRecords, profile),
    files: compactFiles(context.files, profile),
    recentGenerations: compactRecentGenerations(context.recentGenerations, profile),
    globalWorkspace: context.globalWorkspace ? compactGlobalWorkspace(context.globalWorkspace, profile) : null,
    defaultAgent: context.defaultAgent ? compactDefaultAgentPlan(context.defaultAgent, profile) : null,
    webResearch: compactWebResearch(context.webResearch, profile),
    knowledgeBase: compactKnowledgeBase(context.knowledgeBase, profile),
    extra: compactExtraContext(context.extra, profile),
    currentTask: {
      generationType,
      generationLabel: GENERATION_LABELS[generationType] || generationType,
      userMessage: limitText(message, profile.extraChars),
      skill: skill ? {
        id: skill.id,
        name: skill.name,
        toolType: skill.toolType || "",
        description: limitText(skill.description, 180)
      } : null
    }
  };

  const fitted = fitContextToMaxChars(optimized, maxContextChars);
  const compactChars = measureJsonChars(fitted);
  fitted.tokenBudget = {
    version: "ai_context_budget_v1",
    profile: generationType,
    maxContextChars,
    maxPromptChars,
    originalContextChars: originalChars,
    compactContextChars: compactChars,
    estimatedOriginalInputTokens: estimateTokensFromChars(originalChars),
    estimatedCompactInputTokens: estimateTokensFromChars(compactChars),
    savedEstimatedInputTokens: Math.max(0, estimateTokensFromChars(originalChars) - estimateTokensFromChars(compactChars)),
    policy: "只在模型请求中发送任务相关摘要；完整客户数据仍保存在 CRM 数据库。"
  };
  return fitted;
}

function getContextProfile(generationType, customer) {
  const profile = CONTEXT_PROFILES[generationType] || DEFAULT_CONTEXT_PROFILE;
  if (customer) return profile;
  return {
    ...profile,
    followRecords: 0,
    memories: 0,
    files: 0,
    skillCatalog: profile.skillCatalog || 10
  };
}

function compactCustomerContext(customer = {}) {
  return removeEmpty({
    id: customer.id,
    name: customer.name,
    customerType: customer.customerType,
    source: customer.source,
    stage: customer.stage,
    stageId: customer.stageId,
    status: customer.status,
    salesPerson: customer.salesPerson,
    estimatedAmount: customer.estimatedAmount,
    dealProbability: customer.dealProbability,
    nextAction: limitText(customer.nextAction, 220),
    nextFollowTime: customer.nextFollowTime,
    lastFollowTime: customer.lastFollowTime,
    demandDescription: limitText(customer.demandDescription, 520),
    background: limitText(customer.background, 420),
    problemToSolve: limitText(customer.problemToSolve, 420),
    existingSystem: limitText(customer.existingSystem, 300),
    budgetInfo: limitText(customer.budgetInfo, 220),
    decisionInfo: limitText(customer.decisionInfo, 260),
    knownRisks: limitText(customer.knownRisks, 320),
    internalNotes: limitText(customer.internalNotes, 260)
  });
}

function compactMemoryStrategy(strategy) {
  if (!strategy) return null;
  return removeEmpty({
    stageName: strategy.stageName,
    strategyName: strategy.strategyName,
    remember: ensureArray(strategy.remember).slice(0, 4),
    avoid: ensureArray(strategy.avoid).slice(0, 3),
    isolationPolicy: strategy.isolationPolicy
  });
}

function compactCustomerMemories(memories = [], profile) {
  return ensureArray(memories).slice(0, profile.memories).map((item) => removeEmpty({
    memoryType: item.memoryType,
    strategy: item.strategy,
    title: limitText(item.title, 100),
    content: limitText(item.content, profile.memoryChars),
    updatedAt: item.updatedAt || item.createdAt
  }));
}

function compactConversationHistory(history = [], profile) {
  return ensureArray(history).slice(-profile.conversationTurns).map((item) => ({
    role: item.role,
    content: limitText(item.content, 420)
  }));
}

function compactFollowRecords(records = [], profile) {
  return ensureArray(records).slice(0, profile.followRecords).map((item) => removeEmpty({
    time: item.time,
    method: item.method,
    stage: item.stage,
    content: limitText(item.content, profile.followChars),
    customerFeedback: limitText(item.customerFeedback, Math.floor(profile.followChars * 0.75)),
    internalJudgement: limitText(item.internalJudgement, Math.floor(profile.followChars * 0.65)),
    nextAction: limitText(item.nextAction, 180),
    aiSummary: limitText(item.aiSummary, Math.floor(profile.followChars * 0.75))
  }));
}

function compactFiles(files = [], profile) {
  return ensureArray(files).slice(0, profile.files).map((item) => removeEmpty({
    fileName: item.fileName,
    fileType: item.fileType,
    parsedText: compactDocumentText(item.parsedText, profile.fileChars)
  }));
}

function compactDocumentText(text = "", maxChars = 600) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length <= maxChars) return normalized;
  const keyPattern = /AI|Agent|Skill|项目|客户|需求|背景|业务|场景|小程序|无人|门店|营销|增长|洞察|策略|计划|数据|复盘|自动化|中台|渠道|接口|预算|周期|投入|维护|服务器|报价|风险|边界|阶段|价值|MVP|To C|To B/i;
  const sentences = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const picked = [];
  for (const sentence of sentences) {
    if (keyPattern.test(sentence)) picked.push(sentence);
    if (picked.join(" ").length >= Math.floor(maxChars * 0.58)) break;
  }
  const head = normalized.slice(0, Math.floor(maxChars * 0.28));
  const middle = picked.join(" ").slice(0, Math.floor(maxChars * 0.58));
  const tail = normalized.slice(-Math.floor(maxChars * 0.14));
  return [
    `资料开头：${head}`,
    middle ? `关键摘录：${middle}` : "",
    `资料结尾：${tail}`
  ].filter(Boolean).join("\n");
}

function compactRecentGenerations(records = [], profile) {
  return ensureArray(records).slice(0, profile.generations).map((item) => removeEmpty({
    type: item.type,
    title: limitText(item.title, 120),
    savedToCustomerArchive: item.savedToCustomerArchive,
    preview: limitText(item.preview, profile.generationChars)
  }));
}

function compactGlobalWorkspace(globalWorkspace = {}, profile) {
  return removeEmpty({
    mode: globalWorkspace.mode,
    architecture: ensureArray(globalWorkspace.architecture).slice(0, 5).map((item) => limitText(item, 120)),
    skillCatalog: ensureArray(globalWorkspace.skillCatalog).slice(0, profile.skillCatalog || 10).map((skill) => removeEmpty({
      id: skill.id,
      name: skill.name,
      toolType: skill.toolType,
      description: limitText(skill.description, 120),
      outputFormat: limitText(skill.outputFormat, 160)
    })),
    knowledgeBases: ensureArray(globalWorkspace.knowledgeBases).slice(0, 10).map((kb) => removeEmpty({
      id: kb.id,
      name: kb.name,
      type: kb.type,
      documentCount: kb.documentCount
    })),
    globalGenerationHistory: compactRecentGenerations(globalWorkspace.globalGenerationHistory, {
      generations: 3,
      generationChars: profile.generationChars || 160
    }),
    imageGeneration: globalWorkspace.imageGeneration
  });
}

function compactDefaultAgentPlan(agent = {}, profile) {
  return removeEmpty({
    agentName: agent.agentName,
    mode: agent.mode,
    userGoal: limitText(agent.userGoal, profile.extraChars || 800),
    router: agent.router ? removeEmpty({
      primaryIntent: agent.router.primaryIntent,
      confidence: agent.router.confidence,
      intents: ensureArray(agent.router.intents).slice(0, 5).map((item) => removeEmpty({
        key: item.key,
        label: item.label,
        score: item.score,
        reason: limitText(item.reason, 160)
      })),
      reasoning: limitText(agent.router.reasoning, 360)
    }) : null,
    planner: agent.planner ? removeEmpty({
      objective: limitText(agent.planner.objective, 260),
      steps: ensureArray(agent.planner.steps).slice(0, 8),
      completionCriteria: ensureArray(agent.planner.completionCriteria).slice(0, 4)
    }) : null,
    scheduler: agent.scheduler ? removeEmpty({
      tools: ensureArray(agent.scheduler.tools).slice(0, 8).map((tool) => removeEmpty({
        name: tool.name,
        status: tool.status,
        reason: limitText(tool.reason, 220)
      })),
      policy: limitText(agent.scheduler.policy, 240),
      asyncImageJob: agent.scheduler.asyncImageJob
    }) : null,
    executor: agent.executor ? removeEmpty({
      selectedSkills: ensureArray(agent.executor.selectedSkills).slice(0, 5),
      ragUsed: agent.executor.ragUsed,
      webUsed: agent.executor.webUsed,
      outputFormat: agent.executor.outputFormat
    }) : null,
    reflector: agent.reflector ? removeEmpty({
      checks: ensureArray(agent.reflector.checks).slice(0, 5),
      memoryBoundary: agent.reflector.memoryBoundary
    }) : null
  });
}

function compactWebResearch(webResearch = {}, profile) {
  if (!webResearch) return null;
  const used = Boolean(webResearch.used);
  return removeEmpty({
    enabled: webResearch.enabled,
    used,
    reason: limitText(webResearch.reason, 180),
    toolType: webResearch.toolType,
    searchedAt: webResearch.searchedAt,
    queries: ensureArray(webResearch.queries).slice(0, 3).map((item) => limitText(item, 120)),
    urls: ensureArray(webResearch.urls).slice(0, 3),
    results: used ? ensureArray(webResearch.results).slice(0, profile.webResults).map((item) => removeEmpty({
      title: limitText(item.title, 120),
      url: item.url,
      snippet: limitText(item.snippet, 220),
      source: item.source
    })) : [],
    pages: used ? ensureArray(webResearch.pages).slice(0, profile.webPages).map((item) => removeEmpty({
      title: limitText(item.title, 120),
      url: item.url,
      source: item.source,
      text: limitText(item.text, profile.webPageChars)
    })) : [],
    errors: ensureArray(webResearch.errors).slice(0, 3).map((item) => limitText(item, 180))
  });
}

function compactKnowledgeBase(knowledgeBase = {}, profile) {
  if (!knowledgeBase) return null;
  const used = Boolean(knowledgeBase.used);
  return removeEmpty({
    enabled: knowledgeBase.enabled,
    used,
    reason: limitText(knowledgeBase.reason, 180),
    searchedAt: knowledgeBase.searchedAt,
    query: limitText(knowledgeBase.query, 320),
    knowledgeBaseIds: ensureArray(knowledgeBase.knowledgeBaseIds).slice(0, 8),
    matches: used ? ensureArray(knowledgeBase.matches).slice(0, profile.ragMatches).map((item) => removeEmpty({
      knowledgeBaseName: item.knowledgeBaseName,
      documentName: item.documentName,
      chunkId: item.chunkId,
      score: item.score,
      lexicalOverlap: item.lexicalOverlap,
      anchorOverlap: item.anchorOverlap,
      requiredAnchorOverlap: item.requiredAnchorOverlap,
      nameOverlap: item.nameOverlap,
      text: limitText(item.text, profile.ragChars)
    })) : []
  });
}

function compactExtraContext(extra = {}, profile) {
  if (!extra || typeof extra !== "object") return {};
  const compact = {};
  for (const [key, value] of Object.entries(extra)) {
    if (key === "conversationHistory") continue;
    if (typeof value === "string") {
      compact[key] = limitText(value, profile.extraChars);
    } else if (Array.isArray(value)) {
      compact[key] = value.slice(0, 8).map((item) => limitText(JSON.stringify(item), 300));
    } else if (value && typeof value === "object") {
      compact[key] = limitText(JSON.stringify(value), Math.min(profile.extraChars, 900));
    } else {
      compact[key] = value;
    }
  }
  return removeEmpty(compact);
}

function fitContextToMaxChars(context, maxChars) {
  let fitted = cloneJson(context);
  if (measureJsonChars(fitted) <= maxChars) return fitted;

  for (const stringLimit of [600, 420, 280, 180]) {
    fitted = trimAllStrings(fitted, stringLimit);
    if (measureJsonChars(fitted) <= maxChars) return fitted;
  }

  fitted.followRecords = ensureArray(fitted.followRecords).slice(0, 3);
  fitted.customerMemories = ensureArray(fitted.customerMemories).slice(0, 3);
  fitted.files = ensureArray(fitted.files).slice(0, 1);
  fitted.recentGenerations = ensureArray(fitted.recentGenerations).slice(0, 1);
  if (fitted.knowledgeBase?.matches) fitted.knowledgeBase.matches = fitted.knowledgeBase.matches.slice(0, 3);
  if (fitted.webResearch?.pages) fitted.webResearch.pages = [];
  if (fitted.webResearch?.results) fitted.webResearch.results = fitted.webResearch.results.slice(0, 2);
  if (fitted.globalWorkspace?.skillCatalog) fitted.globalWorkspace.skillCatalog = fitted.globalWorkspace.skillCatalog.slice(0, 6);
  return trimAllStrings(fitted, 220);
}

function trimAllStrings(value, maxLength) {
  if (typeof value === "string") return limitText(value, maxLength);
  if (Array.isArray(value)) return value.map((item) => trimAllStrings(item, maxLength));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, trimAllStrings(child, maxLength)])
    );
  }
  return value;
}

function buildStoredPromptSummary({ generationType, customer, skill, prompt, context }) {
  return [
    `AI 请求摘要：${GENERATION_LABELS[generationType] || generationType}`,
    customer ? `客户：${customer.name}（${customer.id}）` : "上下文：默认 AI 工作台",
    skill ? `Skill：${skill.name}` : "",
    `压缩策略：${context.tokenBudget?.version || "ai_context_budget_v1"}`,
    `原始上下文估算：${context.tokenBudget?.estimatedOriginalInputTokens || 0} tokens`,
    `实际上下文估算：${context.tokenBudget?.estimatedCompactInputTokens || 0} tokens`,
    `预计节省：${context.tokenBudget?.savedEstimatedInputTokens || 0} tokens`,
    `模型请求字符数：${String(prompt || "").length}`
  ].filter(Boolean).join("\n");
}

function buildPrompt({ db, generationType, customer, skill, context, message }) {
  const stagePrompt = customer
    ? db.promptTemplates.find((item) => item.stage === customer.stage && item.status !== "disabled")
    : null;
  const longReportTypes = new Set(["consultation_advice", "next_communication_question_list", "lightweight_solution", "solution_deepening", "historical_solution_entry", "requirement_document", "lightweight_solution_ppt_outline"]);
  const skillPromptLimit = longReportTypes.has(generationType) ? 6200 : 1400;
  const skillOutputLimit = longReportTypes.has(generationType) ? 2600 : 900;
  const jsonOnlyInstruction = generationType === "interaction_image_drafts"
    ? "本任务必须优先只返回 JSON，不要输出额外解释。JSON 格式：{\"screens\":[{\"title\":\"界面标题\",\"device\":\"桌面端 / 移动端 / 桌面端 + 移动端 / 响应式画板\",\"goal\":\"页面目标\",\"layout\":\"页面内容与布局\",\"prompt\":\"可直接给 image2 的完整提示词\"}]}。device 字段请按页面目标单独选择，不要默认所有页面都双端。"
    : "";

  const prompt = [
    "角色：积木科技内部 AI CRM 的 GPT-5 售前策略助手。目标：给市场/销售/产品/售前可执行判断与推进方案。",
    compactOutputRules(),
    customer
      ? "客户记忆隔离规则：\n" + CUSTOMER_MEMORY_RULES.map((rule) => `- ${rule}`).join("\n")
      : "默认 AI 工作台规则：\n" + DEFAULT_WORKSPACE_RULES.map((rule) => `- ${rule}`).join("\n"),
    customer && skill
      ? "客户上下文联动要求：所有面向客户的 Skill 必须优先参考已保存到客户档案的 AI 文档、客户记忆、最近生成历史、客户资料解析文本和当前客户跟进记录；只能继承当前客户内容，不得引用其他客户。"
      : "",
    context.defaultAgent && generationType === "chat" ? buildDefaultAgentPromptBlock(context.defaultAgent) : "",
    customer ? `客户阶段：${getStageName(db, customer.stage)}` : "",
    stagePrompt ? `阶段提示词：${limitText(stagePrompt.promptContent, 900)}` : "",
    skill ? `当前 Skill：${skill.name}\nSkill 说明：${limitText(skill.description, 260)}\nSkill 提示词：${limitText(skill.systemPrompt, skillPromptLimit)}\n输出格式：${limitText(skill.outputFormat, skillOutputLimit)}` : "",
    context.webResearch?.used ? [
      "联网工具已自动执行。",
      `执行原因：${context.webResearch.reason}`,
      `检索时间：${context.webResearch.searchedAt}`,
      "请仅把联网资料作为参考，并在使用时标注来源链接。"
    ].join("\n") : [
      "联网工具未执行。",
      `原因：${context.webResearch?.reason || "未检测到联网意图。"}`
    ].join("\n"),
    context.knowledgeBase?.used ? [
      "知识库 RAG 已自动执行。",
      `执行原因：${context.knowledgeBase.reason}`,
      `检索时间：${context.knowledgeBase.searchedAt}`,
      "请优先引用命中的知识库片段，并标注知识库、文档名和相关度分数。"
    ].join("\n") : [
      "知识库 RAG 未执行。",
      `原因：${context.knowledgeBase?.reason || "未检测到知识库意图。"}`
    ].join("\n"),
    `任务类型：${GENERATION_LABELS[generationType] || generationType}`,
    jsonOnlyInstruction,
    message ? `用户补充问题：${message}` : "",
    "请参考以下紧凑上下文 JSON：",
    JSON.stringify(context)
  ].filter(Boolean).join("\n\n");

  const maxPromptChars = Number(context.tokenBudget?.maxPromptChars || DEFAULT_AI_PROMPT_MAX_CHARS);
  if (prompt.length <= maxPromptChars) return prompt;
  const reducedContext = fitContextToMaxChars(context, Math.max(6000, Math.floor(maxPromptChars * 0.52)));
  return [
    "角色：积木科技内部 AI CRM 的 GPT-5 售前策略助手。目标：输出可执行售前方案。",
    compactOutputRules(),
    customer ? "严格只使用当前客户上下文，客户间记忆隔离。" : "默认工作台不读取客户档案。",
    context.defaultAgent && generationType === "chat" ? buildDefaultAgentPromptBlock(context.defaultAgent, true) : "",
    customer ? `客户阶段：${getStageName(db, customer.stage)}` : "",
    stagePrompt ? `阶段提示词：${limitText(stagePrompt.promptContent, 520)}` : "",
    skill ? `Skill：${skill.name}\n提示词：${limitText(skill.systemPrompt, longReportTypes.has(generationType) ? 2400 : 760)}\n输出格式：${limitText(skill.outputFormat, longReportTypes.has(generationType) ? 1200 : 520)}` : "",
    `任务类型：${GENERATION_LABELS[generationType] || generationType}`,
    jsonOnlyInstruction,
    message ? `用户补充问题：${limitText(message, 1200)}` : "",
    "紧凑上下文 JSON：",
    JSON.stringify(reducedContext)
  ].filter(Boolean).join("\n\n").slice(0, maxPromptChars);
}

function compactOutputRules() {
  return [
    "输出规则：Markdown；先结论后行动；二级标题+列表为主；必要时用表格/代码块/Mermaid。",
    "不得编造未提供的客户事实；信息不足写「待确认」。",
    "建议必须落到下一步动作、沟通问题、材料产出或风险提醒。",
    "引用 RAG/联网内容时标注知识库/文档/相关度或来源链接/检索时间。"
  ].join("\n");
}

function buildDefaultAgentPromptBlock(agent, compact = false) {
  const sections = compact ? DEFAULT_AGENT_OUTPUT_SECTIONS.slice(0, 5) : DEFAULT_AGENT_OUTPUT_SECTIONS;
  return [
    "默认 AI 对话必须按 Agent 方式工作，而不是按某个提示词模板工作。",
    "任务规划、意图识别、调度器、RAG、Skill、image2 都是 Agent 内部策略；这些过程不要写进最终答案。",
    `本次最终答案建议覆盖：${sections.join("、")}。`,
    "如果任务需要多步执行，最终答案只输出可直接使用的结果、文档、表格、话术或下一步动作，不说明已执行/跳过的工具。",
    "回答结束后保持可继续追问的上下文，不要假设本轮对话结束。"
  ].join("\n");
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function limitText(value, maxLength = 400) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function removeEmpty(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === null || item === undefined || item === "") return false;
      if (Array.isArray(item) && !item.length) return false;
      return true;
    })
  );
}

function measureJsonChars(value) {
  try {
    return JSON.stringify(value || {}).length;
  } catch {
    return 0;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function estimateTokensFromChars(chars) {
  const value = Number(chars || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  // Chinese-heavy CRM prompts are roughly 1.4-2.0 chars per token; use a conservative middle value.
  return Math.ceil(value / 1.7);
}

async function maybeGenerateWithRemoteModel({ model, config, prompt, title, generationType }) {
  const provider = String(model?.provider || "").toLowerCase();
  const apiKey = model?.apiKey || config.openaiApiKey;
  const modelId = model?.modelId || config.openaiModel || "gpt-5.5";
  const baseUrl = (model?.baseUrl || defaultBaseUrlForProvider(provider)).replace(/\/$/, "");
  const proxyUrl = shouldUseOpenAiProxy({ baseUrl, provider, config }) ? config.openaiProxyUrl || "" : "";
  const timeoutMs = resolveRemoteTimeoutMs(model, config);

  if (!apiKey || provider === "local") return null;

  try {
    const requestBody = buildRemoteRequestBody({ model, modelId, prompt, generationType, config });

    const response = await postOpenAiJson({
      url: `${baseUrl}/responses`,
      apiKey,
      body: requestBody,
      proxyUrl,
      timeoutMs
    });

    if (!response.ok) {
      return buildRemoteErrorFallback({
        title,
        generationType,
        modelId,
        baseUrl,
        provider,
        errorText: JSON.stringify({
          status: response.status,
          body: safeJsonParse(response.bodyText) || response.bodyText
        }, null, 2)
      });
    }
    const payload = JSON.parse(response.bodyText);
    const text = extractOutputText(payload);
    return text || buildRemoteErrorFallback({
      title,
      generationType,
      modelId,
      baseUrl,
      provider,
      errorText: "远程模型返回成功状态，但响应体中没有可展示文本。"
    });
  } catch (error) {
    return buildRemoteErrorFallback({ title, generationType, modelId, baseUrl, provider, errorText: error.message });
  }
}

async function maybeStreamWithRemoteModel({ model, config, prompt, title, generationType, onToken, onStatus }) {
  const provider = String(model?.provider || "").toLowerCase();
  const apiKey = model?.apiKey || config.openaiApiKey;
  const modelId = model?.modelId || config.openaiModel || "gpt-5.5";
  const baseUrl = (model?.baseUrl || defaultBaseUrlForProvider(provider)).replace(/\/$/, "");
  const proxyUrl = shouldUseOpenAiProxy({ baseUrl, provider, config }) ? config.openaiProxyUrl || "" : "";
  const timeoutMs = resolveRemoteTimeoutMs(model, config);

  if (!apiKey || provider === "local") return null;

  if (config.disableRemoteStreaming) {
    await onStatus?.("正在等待 AI 生成完整回答...");
    const output = await maybeGenerateWithRemoteModel({ model, config, prompt, title, generationType });
    if (isRemoteErrorFallbackText(output)) return output;
    await streamTextChunks(output || "", onToken);
    return output;
  }

  if (proxyUrl) {
    await onStatus?.("当前代理链路不支持原生事件流，正在使用分段流降级...");
    const output = await maybeGenerateWithRemoteModel({ model, config, prompt, title, generationType });
    if (isRemoteErrorFallbackText(output)) return output;
    await streamTextChunks(output || "", onToken);
    return output;
  }

  try {
    const requestBody = {
      ...buildRemoteRequestBody({ model, modelId, prompt, generationType, config }),
      stream: true
    };
    const output = await streamOpenAiJson({
      url: `${baseUrl}/responses`,
      apiKey,
      body: requestBody,
      timeoutMs,
      onToken,
      onStatus
    });
    return output || buildRemoteErrorFallback({
      title,
      generationType,
      modelId,
      baseUrl,
      provider,
      errorText: "远程模型流式任务完成，但没有返回任何正文 token。"
    });
  } catch (error) {
    const fallback = buildRemoteErrorFallback({ title, generationType, modelId, baseUrl, provider, errorText: error.message });
    await onStatus?.("远程模型响应异常，正在返回失败原因...");
    return fallback;
  }
}

function buildRemoteRequestBody({ model, modelId, prompt, generationType, config = {} }) {
  const requestBody = {
    model: modelId,
    instructions: [
      "你是积木科技内部 AI CRM 的高级售前策略助手。",
      "请用专业、直接、可落地的中文回答。",
      "输出完整 Markdown，严格基于给定上下文，不虚构客户事实。",
      "默认用标题、列表、表格、引用和代码块组织内容，避免整页长段落；列表项要短、具体、可执行。"
    ].join("\n"),
    input: prompt,
    max_output_tokens: getMaxOutputTokens({ model, generationType, config })
  };

  const temperature = Number(model?.temperature ?? 0.3);
  if (Number.isFinite(temperature) && !String(modelId).toLowerCase().startsWith("gpt-5")) {
    requestBody.temperature = temperature;
  }
  if (String(modelId).toLowerCase().startsWith("gpt-5")) {
    requestBody.reasoning = {
      effort: normalizeReasoningEffort(model?.reasoningEffort || config.openaiReasoningEffort || "low")
    };
  }

  return requestBody;
}

function normalizeReasoningEffort(value) {
  const effort = String(value || "").trim().toLowerCase();
  if (["low", "medium", "high", "xhigh"].includes(effort)) return effort;
  if (effort === "minimal" || effort === "none") return "low";
  return "low";
}

function isExplicitImageGenerationRequest(message = "") {
  const text = String(message || "");
  if (!text) return false;
  if (/image2|生图/.test(text) && /(生成|画|出|制作|创建|做一张|做个|做一个|帮我|我要|需要)/.test(text)) return true;
  if (/(生成图片|画一张|出图|做一张图|做个图|做一个图)/.test(text)) return true;
  const visualTarget = /(图片|视觉稿|海报|交互图|界面图|产品图|设计图|UI\s*图|原型图)/i;
  const visualAction = /(生成|画|出|设计|制作|创建|产出|做一张|做个|做一个)/;
  const knowledgeQuestion = /(是什么|有哪些|几个|多少|区别|怎么选|介绍|解释|了解|关于|模型|能力|价格|额度|恢复|原理|文档|教程|用法|支持)/;
  if (knowledgeQuestion.test(text) && !/(帮我|给我).{0,8}(生成|画|出|设计|制作|创建)/.test(text)) return false;
  return visualTarget.test(text) && visualAction.test(text);
}

function resolveRemoteTimeoutMs(model = {}, config = {}) {
  const modelTimeout = Number(model?.timeoutMs || 0);
  const configTimeout = Number(config.openaiTimeoutMs || 0);
  const candidates = [modelTimeout, configTimeout].filter((item) => Number.isFinite(item) && item > 0);
  if (!candidates.length) return DEFAULT_REMOTE_TIMEOUT_MS;
  return Math.min(...candidates);
}

function getMaxOutputTokens({ model, generationType, config = {} }) {
  const typeLimit = OUTPUT_TOKEN_LIMITS[generationType] || OUTPUT_TOKEN_LIMITS.chat;
  const globalLimit = ["consultation_advice", "next_communication_question_list", "lightweight_solution", "solution_deepening", "historical_solution_entry", "requirement_document", "lightweight_solution_ppt_outline"].includes(generationType)
    ? Number(config.aiLongReportMaxTokens || 6200)
    : Number(config.aiOutputMaxTokens || 2800);
  const configured = Number(model?.maxTokens || 0);
  const candidates = [typeLimit, globalLimit].filter((item) => Number.isFinite(item) && item > 0);
  if (configured > 0) candidates.push(configured);
  return Math.max(700, Math.min(...candidates));
}

function defaultBaseUrlForProvider(provider) {
  if (String(provider || "").toLowerCase() === "cliproxyapi") return "https://www.tokenrouter.tech/v1";
  return "https://api.openai.com/v1";
}

function shouldUseOpenAiProxy({ baseUrl = "", provider = "", config = {} }) {
  if (!config.openaiProxyUrl) return false;
  const normalizedProvider = String(provider || "").toLowerCase();
  const hostname = (() => {
    try {
      return new URL(baseUrl || "").hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (normalizedProvider === "cliproxyapi" || hostname.includes("tokenrouter.tech")) return false;
  return hostname.includes("openai.com") || normalizedProvider === "openai";
}

async function streamOpenAiJson({ url, apiKey, body, timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS, onToken, onStatus }) {
  const controller = new AbortController();
  const timeoutError = `OpenAI-compatible stream timeout after ${Math.round(timeoutMs / 1000)}s`;
  const streamState = { text: "" };
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      const error = new Error(timeoutError);
      error.partialText = streamState.text;
      reject(error);
    }, timeoutMs);
  });
  try {
    const requestPromise = (async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Accept": "text/event-stream"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(JSON.stringify({
          status: response.status,
          body: safeJsonParse(bodyText) || bodyText
        }, null, 2));
      }
      if (!response.body) throw new Error("Streaming response body is unavailable.");

      await onStatus?.("AI 正在流式输出...");
      return readOpenAiEventStream(response.body, onToken, streamState);
    })();
    return await Promise.race([requestPromise, timeoutPromise]);
  } catch (error) {
    if (error?.partialText) throw new Error(timeoutError);
    if (error?.name === "AbortError") {
      throw new Error(timeoutError);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readOpenAiEventStream(body, onToken, streamState = null) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedText = "";
  let finalText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (!event.data || event.data === "[DONE]") continue;
      const payload = safeJsonParse(event.data);
      if (!payload) continue;

      const delta = extractStreamDelta(payload);
      if (delta) {
        streamedText += delta;
        if (streamState) streamState.text = streamedText;
        await onToken?.(delta);
      }

      const completedText = extractStreamFinalText(payload);
      if (completedText) {
        finalText = completedText;
        if (streamState && !streamState.text) streamState.text = completedText;
      }
    }
  }

  if (buffer.trim()) {
    const event = parseSseBlock(buffer);
    const payload = event.data && event.data !== "[DONE]" ? safeJsonParse(event.data) : null;
    const completedText = payload ? extractStreamFinalText(payload) : "";
    if (completedText) {
      finalText = completedText;
      if (streamState && !streamState.text) streamState.text = completedText;
    }
  }

  if (finalText && finalText !== streamedText && !streamedText) {
    await streamTextChunks(finalText, onToken);
  }
  return finalText || streamedText;
}

function parseSseBlock(block = "") {
  const lines = String(block).split(/\r?\n/);
  let event = "message";
  const data = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return {
    event,
    data: data.join("\n")
  };
}

function extractStreamDelta(payload) {
  if (typeof payload.delta === "string") return payload.delta;
  if (typeof payload.text === "string" && /delta/.test(String(payload.type || ""))) return payload.text;
  if (typeof payload.output_text === "string" && /delta/.test(String(payload.type || ""))) return payload.output_text;
  if (typeof payload.text?.delta === "string") return payload.text.delta;
  if (typeof payload.response?.output_text === "string" && /delta/.test(String(payload.type || ""))) return payload.response.output_text;
  const choiceDelta = payload.choices?.[0]?.delta?.content;
  if (typeof choiceDelta === "string") return choiceDelta;
  return "";
}

function extractStreamFinalText(payload) {
  if (payload.response) return extractOutputText(payload.response);
  if (/completed|done/.test(String(payload.type || ""))) return extractOutputText(payload);
  return "";
}

async function streamTextChunks(text = "", onToken) {
  const chunks = splitStreamText(text);
  for (const chunk of chunks) {
    await onToken?.(chunk);
    await delay(8);
  }
}

function splitStreamText(text = "") {
  const source = String(text || "");
  if (!source) return [];
  const chunks = [];
  let buffer = "";

  for (const char of source) {
    buffer += char;
    const shouldFlush = buffer.length >= 48 && /[\n。！？；.!?]$/.test(buffer);
    if (buffer.length >= 96 || shouldFlush) {
      chunks.push(buffer);
      buffer = "";
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postOpenAiJson({ url, apiKey, body, proxyUrl, timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS }) {
  const payload = JSON.stringify(body);
  if (!proxyUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: payload,
        signal: controller.signal
      });
      return {
        ok: response.ok,
        status: response.status,
        bodyText: await response.text()
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`OpenAI-compatible request timeout after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return postJsonThroughHttpProxy({
    url,
    proxyUrl,
    payload,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Accept-Encoding": "identity"
    }
  });
}

async function postJsonThroughHttpProxy({ url, proxyUrl, payload, headers }) {
  const target = new URL(url);
  if (target.protocol !== "https:") {
    throw new Error("OPENAI_PROXY_URL currently supports HTTPS OpenAI-compatible endpoints only.");
  }

  const proxy = normalizeProxyUrl(proxyUrl);
  const tunnelSocket = await connectHttpProxyTunnel(target, proxy);
  const response = await sendHttpsRequestOverTunnel({
    target,
    tunnelSocket,
    method: "POST",
    payload,
    headers
  });

  return {
    ok: response.statusCode >= 200 && response.statusCode < 300,
    status: response.statusCode,
    bodyText: response.bodyText
  };
}

function normalizeProxyUrl(proxyUrl) {
  const raw = String(proxyUrl || "").trim();
  if (!raw) throw new Error("OPENAI_PROXY_URL is empty.");
  const normalized = raw.includes("://") ? raw : `http://${raw}`;
  const proxy = new URL(normalized);
  if (proxy.protocol !== "http:") {
    throw new Error("Only HTTP proxy URLs are supported for OPENAI_PROXY_URL.");
  }
  return proxy;
}

function connectHttpProxyTunnel(target, proxy) {
  return new Promise((resolve, reject) => {
    const targetPort = target.port || "443";
    const request = http.request({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: "CONNECT",
      path: `${target.hostname}:${targetPort}`,
      headers: {
        Host: `${target.hostname}:${targetPort}`
      },
      timeout: 15000
    });

    request.once("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy tunnel failed with status ${response.statusCode}`));
        return;
      }
      resolve(socket);
    });
    request.once("timeout", () => request.destroy(new Error("Proxy tunnel timeout")));
    request.once("error", reject);
    request.end();
  });
}

function sendHttpsRequestOverTunnel({ target, tunnelSocket, method, payload, headers }) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({
      socket: tunnelSocket,
      servername: target.hostname
    });
    const chunks = [];

    secureSocket.setTimeout(120000);
    secureSocket.once("secureConnect", () => {
      const bodyBuffer = Buffer.from(payload, "utf8");
      const requestHeaders = {
        Host: target.host,
        ...headers,
        "Content-Length": bodyBuffer.length,
        Connection: "close"
      };
      const headerLines = [
        `${method} ${target.pathname}${target.search} HTTP/1.1`,
        ...Object.entries(requestHeaders).map(([key, value]) => `${key}: ${value}`),
        "",
        ""
      ];
      secureSocket.write(Buffer.concat([
        Buffer.from(headerLines.join("\r\n"), "utf8"),
        bodyBuffer
      ]));
    });
    secureSocket.on("data", (chunk) => chunks.push(chunk));
    secureSocket.once("end", () => {
      try {
        resolve(parseHttpResponse(Buffer.concat(chunks)));
      } catch (error) {
        reject(error);
      }
    });
    secureSocket.once("timeout", () => secureSocket.destroy(new Error("OpenAI request timeout")));
    secureSocket.once("error", reject);
  });
}

function parseHttpResponse(buffer) {
  const separator = buffer.indexOf("\r\n\r\n");
  if (separator === -1) throw new Error("Invalid HTTP response from OpenAI endpoint.");

  const headerText = buffer.slice(0, separator).toString("utf8");
  const bodyBuffer = buffer.slice(separator + 4);
  const [statusLine, ...headerLines] = headerText.split("\r\n");
  const statusCode = Number(statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1] || 0);
  const headers = Object.fromEntries(headerLines.map((line) => {
    const index = line.indexOf(":");
    if (index === -1) return [line.toLowerCase(), ""];
    return [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()];
  }));
  const decodedBody = headers["transfer-encoding"]?.toLowerCase().includes("chunked")
    ? decodeChunkedBody(bodyBuffer)
    : bodyBuffer;

  return {
    statusCode,
    headers,
    bodyText: decodedBody.toString("utf8")
  };
}

function decodeChunkedBody(buffer) {
  let position = 0;
  const chunks = [];
  while (position < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", position);
    if (lineEnd === -1) break;
    const sizeText = buffer.slice(position, lineEnd).toString("ascii").split(";")[0];
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size <= 0) break;
    const chunkStart = lineEnd + 2;
    chunks.push(buffer.slice(chunkStart, chunkStart + size));
    position = chunkStart + size + 2;
  }
  return Buffer.concat(chunks);
}

function buildRemoteErrorFallback({ title, generationType, modelId, baseUrl = "", provider = "", errorText }) {
  const detail = redactSecrets(String(errorText || "")).slice(0, 500);
  return [
    `# ${title}`,
    "",
    `> 远程模型 ${modelId} 调用失败。系统已按要求停止生成，不再使用本地规则兜底。`,
    "",
    "## 调用状态",
    "",
    "Responses API 兼容接口未返回成功结果。请检查 API Key、模型 ID、Base URL、供应商配置和账号模型权限。",
    "",
    `供应商：${provider || "未指定"}；Base URL：${baseUrl || "未指定"}`,
    "",
    "## 错误摘要",
    "",
    detail || "未知错误",
    "",
    "## 建议处理",
    "",
    "- 如果使用第三方中转平台，请确认 Base URL 指向中转平台，而不是 OpenAI 官方地址。",
    "- 在系统设置的「模型」里填写 API Key，或在 `.env` 中配置 `OPENAI_API_KEY`。",
    "- 默认模型建议使用 `gpt-5.5`；如果中转平台模型名不同，请按平台要求修改 Model ID。",
    `- 修好配置后重新生成「${GENERATION_LABELS[generationType] || "AI 内容"}」。`
  ].join("\n");
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

function isRemoteErrorFallbackText(text = "") {
  return /远程模型 .*调用失败|远程模型已返回空内容|Responses API 兼容接口未返回成功结果|## 错误摘要|调用状态/i.test(String(text || ""));
}

function buildRemoteFailureMeta({ model, config = {}, remoteOutput = "" }) {
  const provider = String(model?.provider || "").toLowerCase() || "remote";
  const modelId = model?.modelId || config.openaiModel || "remote-model";
  const baseUrl = (model?.baseUrl || defaultBaseUrlForProvider(provider) || "").replace(/\/$/, "");
  return {
    failed: true,
    fallbackDisabled: true,
    provider,
    modelId,
    modelName: model?.name || config.openaiModel || "remote-model",
    baseUrl,
    reason: "远程模型调用失败。系统不再使用本地规则兜底，已保留失败原因并允许重新生成。",
    failedAt: nowIso(),
    errorPreview: stripRemoteFallbackForMeta(remoteOutput)
  };
}

function stripRemoteFallbackForMeta(markdown = "") {
  return redactSecrets(String(markdown || "")
    .replace(/^# .+$/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim())
    .slice(0, 1200);
}

function extractOutputText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  if (typeof payload.text === "string") return payload.text.trim();
  if (typeof payload.content === "string") return payload.content.trim();
  if (typeof payload.response?.output_text === "string") return payload.response.output_text.trim();
  const parts = [];
  for (const item of payload.output || []) {
    if (typeof item.text === "string") parts.push(item.text);
    if (typeof item.output_text === "string") parts.push(item.output_text);
    if (typeof item.content === "string") parts.push(item.content);
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
      if (typeof content.output_text === "string") parts.push(content.output_text);
      if (typeof content.content === "string") parts.push(content.content);
      if (typeof content.text?.value === "string") parts.push(content.text.value);
      if (typeof content.output_text?.value === "string") parts.push(content.output_text.value);
    }
  }
  if (Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      const content = choice?.message?.content || choice?.delta?.content || choice?.text;
      if (typeof content === "string") parts.push(content);
      if (Array.isArray(content)) {
        for (const item of content) {
          if (typeof item?.text === "string") parts.push(item.text);
          if (typeof item?.content === "string") parts.push(item.content);
        }
      }
    }
  }
  return parts.filter(Boolean).join("\n").trim();
}

function generateLocalMarkdown({ db, generationType, customer, skill, context, message, extraContext }) {
  const title = buildTitle(generationType, customer);
  const stageName = customer ? getStageName(db, customer.stage) : "未选择客户";
  const customerName = customer?.name || "未选择客户";
  const pain = firstUseful([
    customer?.problemToSolve,
    customer?.demandDescription,
    customer?.background,
    "客户需求信息仍需补充，建议先确认业务目标、当前流程、预算和决策链。"
  ]);
  const lastFollow = context.followRecords[0];
  const sections = !customer && generationType === "chat"
    ? DEFAULT_AGENT_OUTPUT_SECTIONS
    : TYPE_OUTPUTS[generationType] || TYPE_OUTPUTS.follow_strategy;

  const lines = [
    `# ${title}`,
    "",
    `> 生成时间：${formatDateTime(nowIso())} · 模式：本地规则生成 · 阶段：${stageName}`,
    ""
  ];

  if (context.webResearch?.used) {
    lines.push("## 联网资料参考");
    lines.push("");
    lines.push(renderWebResearchSection(context.webResearch));
    lines.push("");
  }

  if (context.knowledgeBase?.used) {
    lines.push("## 知识库检索参考");
    lines.push("");
    lines.push(renderKnowledgeBaseSection(context.knowledgeBase));
    lines.push("");
  }

  for (const section of sections) {
    lines.push(`## ${section}`);
    lines.push("");
    lines.push(renderSection({
      section,
      generationType,
      customer,
      customerName,
      stageName,
      pain,
      lastFollow,
      skill,
      message,
      extraContext,
      context
    }));
    lines.push("");
  }

  return lines.join("\n").trim();
}

function renderWebResearchSection(webResearch) {
  const lines = [
    `检索时间：${formatDateTime(webResearch.searchedAt)}。执行原因：${webResearch.reason}`,
    ""
  ];
  if (webResearch.results?.length) {
    lines.push("可参考搜索结果：");
    for (const item of webResearch.results.slice(0, 5)) {
      lines.push(`- [${item.title || item.url}](${item.url})${item.snippet ? `：${item.snippet.slice(0, 120)}` : ""}`);
    }
  }
  if (webResearch.pages?.length) {
    lines.push("");
    lines.push("已读取网页摘要：");
    for (const page of webResearch.pages.slice(0, 3)) {
      lines.push(`- [${page.title || page.url}](${page.url})：${String(page.text || "").replace(/\s+/g, " ").slice(0, 180)}`);
    }
  }
  if (webResearch.errors?.length) {
    lines.push("");
    lines.push("联网工具提示：");
    for (const error of webResearch.errors.slice(0, 3)) lines.push(`- ${error}`);
  }
  return lines.join("\n");
}

function renderKnowledgeBaseSection(knowledgeBase) {
  const lines = [
    `检索时间：${formatDateTime(knowledgeBase.searchedAt)}。执行原因：${knowledgeBase.reason}`,
    `检索问题：${knowledgeBase.query || "未提供"}`,
    ""
  ];
  if (knowledgeBase.matches?.length) {
    lines.push("命中的知识库片段：");
    for (const item of knowledgeBase.matches.slice(0, 6)) {
      lines.push(`- ${item.knowledgeBaseName} / ${item.documentName}（相关度 ${item.score}）：${String(item.text || "").replace(/\s+/g, " ").slice(0, 220)}`);
    }
  } else {
    lines.push("- 没有命中足够相关的知识库片段。");
  }
  return lines.join("\n");
}

function renderSection({ section, generationType, customer, customerName, stageName, pain, lastFollow, skill, message, extraContext, context }) {
  const nextAction = customer?.nextAction || lastFollow?.nextAction || "安排下一次沟通，补齐需求、预算、决策链和交付边界。";
  const budget = customer?.budgetInfo || "预算信息暂不明确";
  const decision = customer?.decisionInfo || "决策链信息暂不明确";
  const risk = customer?.knownRisks || "信息不完整，容易导致方案范围和报价预期不一致。";
  const feedback = lastFollow?.customerFeedback || customer?.internalNotes || "暂无明确反馈记录";
  const defaultAgent = context?.defaultAgent;
  const agentToolRows = ensureArray(defaultAgent?.scheduler?.tools).map((tool) => `| ${tool.name || "工具"} | ${tool.status || "unknown"} | ${tool.reason || "未说明"} |`).join("\n");

  const shared = {
    "客户当前状态判断": `${customerName} 当前处于「${stageName}」阶段。已知重点是：${pain}。建议继续推进，但下一次沟通要把范围、预算和决策人确认清楚。`,
    "客户核心诉求": `客户表面需求是「${customer?.demandDescription || pain}」。更深层诉求可能是降低沟通/运营/交付成本，并希望看到可落地、可分阶段投入的方案。`,
    "当前推进难点": `主要卡点在于：${risk} 同时预算为「${budget}」，决策链为「${decision}」，需要避免过早进入报价。`,
    "本阶段跟进目标": `下一次沟通目标是确认业务流程、成功标准、MVP 范围、预算区间和决策节奏，形成可对外输出的下一版材料。`,
    "推进路径设计": bullet([
      "先用一次需求澄清会确认业务目标、现有基础、关键角色和成功标准。",
      "再输出 MVP 范围，把一期可交付内容和二期扩展内容拆开。",
      "随后用方案大纲或演示原型推动客户内部评审，避免直接进入价格拉扯。",
      "商务推进前同步锁定范围、验收口径和付款节点。"
    ]),
    "建议沟通问题": bullet([
      "这次项目最希望优先解决的 1 到 2 个业务问题是什么？",
      "当前流程里最耗时、最容易出错或最难管理的节点在哪里？",
      "已有系统、数据、文档或接口基础分别是什么情况？",
      "项目成功后，你们内部会用哪些指标判断效果？",
      "预算区间、上线时间和决策人参与节奏是否可以提前确认？",
      "如果先做 MVP，哪些范围必须保留，哪些可以放到二期？"
    ]),
    "推荐沟通话术": `可以这样表达：我们先不急着把方案做大，建议围绕「业务目标、现有基础、MVP 范围、上线节奏」开一次需求深化会。会后我们输出一版更贴近你们实际流程的方案大纲和阶段报价，方便内部判断投入产出。`,
    "推荐输出材料": bullet(["需求深化方案", "MVP 范围建议", "功能模块清单", "AI 融入点分析", "下一步推进计划"]),
    "下一步动作": bullet([nextAction, "整理客户现有资料和历史沟通记录", "准备一版可用于内部讨论的方案大纲", "约定下次会议时间并邀请关键决策角色"]),
    "风险提醒": `注意不要只围绕功能清单沟通。当前风险是「${risk}」，建议每次沟通都同步确认业务价值、交付边界和客户内部决策路径。`
  };

  const demand = {
    "客户需求摘要": `${customerName} 的需求可概括为：${customer?.demandDescription || pain}`,
    "真实诉求判断": `客户真正关心的不是单个功能，而是通过 AI 或系统能力解决「${pain}」带来的效率、成本或管理问题。`,
    "业务目标拆解": bullet(["降低重复人工处理成本", "沉淀可复用的数据与知识资产", "让关键流程可追踪、可评估、可持续优化"]),
    "现有基础与约束": `现有基础：${customer?.existingSystem || "暂未明确"}。预算/周期：${budget}。决策链：${decision}。`,
    "待澄清问题": bullet(["数据来源与质量", "核心业务流程", "用户角色与权限边界", "验收指标", "预算区间", "上线时间"]),
    "AI 融入点": bullet(["需求理解与信息抽取", "知识检索与智能问答", "流程节点辅助判断", "跟进总结与方案生成", "异常风险提醒"]),
    "下一步建议": `建议先组织一次需求深化会议，以业务流程为主线梳理 MVP 范围，再输出方案大纲。`
  };

  const proposal = {
    "方案定位": `面向 ${customerName} 的方案应定位为「业务流程优化 + AI 能力落地」的一体化方案。`,
    "客户痛点": pain,
    "建设目标": bullet(["统一客户关键资料", "降低重复沟通和人工整理成本", "形成可持续迭代的 AI 能力底座"]),
    "功能模块": bullet(["基础数据管理", "业务流程工作台", "AI 分析与生成", "资料/知识库管理", "权限与配置中心", "生成历史与复盘沉淀"]),
    "AI 融入点": bullet(["自动总结沟通记录", "生成需求分析", "生成方案大纲", "推荐下一步动作", "失败客户复盘"]),
    "MVP 范围": bullet(["客户/项目档案", "跟进记录", "AI 策略生成", "方案大纲生成", "基础配置", "历史记录"]),
    "实施阶段": bullet(["第 1 阶段：打通客户档案与跟进记录", "第 2 阶段：上线 AI 生成和 Skill 配置", "第 3 阶段：接入知识库 RAG 与工作流"]),
    "PPT 结构": bullet(["客户背景与现状", "核心问题", "方案目标", "系统架构", "功能模块", "AI 能力", "实施计划", "商务与下一步"]),
    "会议讲解逻辑": `先讲业务问题，再讲为什么需要 AI 和系统结合，最后用 MVP 范围降低客户决策压力。`
  };

  const failure = {
    "客户基本信息": bullet([
      `客户：${customerName}`,
      `类型：${customer?.customerType || "未填写"}`,
      `来源：${customer?.source || "未填写"}`,
      `最后阶段：${stageName}`,
      `预计金额：${formatMoney(customer?.estimatedAmount)}`
    ]),
    "客户需求回顾": `${customer?.demandDescription || pain}。过程中客户反馈：${feedback}。`,
    "跟进过程回顾": lastFollow
      ? `最近一次跟进为 ${formatDateTime(lastFollow.time)}，方式 ${lastFollow.method}，内容：${lastFollow.content}`
      : "当前缺少足够跟进记录，建议复盘时补齐关键沟通节点。",
    "失败原因分析": bullet([
      `需求原因：${customer?.demandDescription ? "需求方向存在，但范围和优先级需要更早锁定。" : "需求描述不足。"}`,
      `预算原因：${budget}`,
      `决策原因：${decision}`,
      `方案原因：需要判断方案表达是否足够贴合客户业务流程。`,
      `跟进原因：检查下一步动作是否明确、节奏是否及时。`
    ]),
    "核心失败原因": extraContext?.failureReasonType || "当前需要结合客户最终反馈进一步确认核心失败原因。",
    "可提前识别的问题": bullet(["预算区间未明确", "决策人参与不足", "MVP 范围未收敛", "客户真实采购意向不够强"]),
    "内部改进建议": bullet(["首次沟通增加预算和决策链判断", "需求阶段输出更清晰的问题清单", "方案阶段强化业务价值表达", "商务阶段避免只围绕价格沟通"]),
    "是否值得重新激活": "如果客户只是暂缓或预算原因，可在 30 到 60 天后用新案例、MVP 低风险试点方案重新激活。"
  };

  const chat = {
    "直接回答": message
      ? (customer
        ? `围绕你的问题「${message}」，建议优先结合 ${customerName} 的阶段「${stageName}」来判断下一步动作。`
        : `围绕你的问题「${message}」，下面给出可直接执行的建议。`)
      : (customer
        ? `当前可以先从 ${customerName} 的客户阶段和最近跟进记录切入。`
        : "可以直接输入目标，我会把结果整理成可复制的方案、话术、文档或行动清单。"),
    "意图判断": customer
      ? `${customerName} 当前阶段是「${stageName}」。核心问题：${pain}。最近反馈：${feedback}。预算：${budget}。决策链：${decision}。`
      : inferGlobalIntent(message, skill),
    "执行路径": customer
      ? bullet(["读取当前客户上下文", "匹配阶段提示词和 Skill", "输出可执行建议并保存到当前客户历史"])
      : bullet(["Router 识别任务类型", "Planner 拆解目标和产物", "Retriever 判断是否调用知识库/联网", "Skill Executor 使用匹配 Skill 输出", "Reflector 校验风险、假设和下一步"]),
    "可执行建议": customer
      ? bullet([nextAction, "把客户反馈整理成需求、风险、预算、决策四类信息", "生成一版可直接对外沟通的方案或问题清单"])
      : bullet(["先明确目标产物：策略、方案、提示词、流程图、知识库检索结果或图片", "如果涉及资料/案例/能力，使用 RAG 检索知识库", "如果涉及最新市场/竞品/政策，使用联网资料并标注来源", "如果涉及视觉稿或交互图，生成 image2 提示词并调用生图流程"]),
    "可沉淀内容": customer
      ? `阶段判断：${stageName}。核心问题：${pain}。推荐 Skill：${skill?.name || "下一步动作 Skill"}。`
      : `默认工作台产物可沉淀为全局生成历史；如需进入客户档案，请先切换到具体客户上下文。`
  };

  const agent = {
    "直接结论": message
      ? bullet([
        `围绕「${message}」，建议先明确目标产物，再按可交付内容组织输出。`,
        "如果是售前类任务，优先形成客户可读结论、内部执行动作和待确认问题。",
        "如果是资料类任务，优先沉淀可复用摘要、引用来源和后续补充清单。",
        "如果是视觉或文件类任务，优先明确用途、风格、数量、格式和验收方式。"
      ])
      : "请直接输入任务，我会把结果整理成可复制、可继续追问的正文内容。",
    "可执行方案": bullet([
      "先用一句话确定本轮目标和最终产物。",
      "再把内容拆成结论、依据、行动、风险和待确认事项。",
      "需要面向客户时，使用克制、专业、可复制的话术。",
      "需要内部推进时，输出负责人可执行的动作清单和材料清单。"
    ]),
    "关键步骤": bullet(ensureArray(defaultAgent?.planner?.steps).length
      ? defaultAgent.planner.steps.map((item) => String(item || "").replace(/Router|Planner|Scheduler|Retriever|Reflector/gi, "Agent").replace(/意图识别|工具调度/g, "任务处理"))
      : ["明确目标产物", "整理可用上下文", "形成结构化正文", "列出下一步动作"]),
    "待确认事项": bullet([
      "最终产物是给客户看，还是给内部团队执行。",
      "是否需要引用知识库、历史方案、案例或公开资料。",
      "是否需要生成文档、PPT、大纲、图片或普通文字建议。",
      "是否存在必须保留的业务边界、风格要求或输出格式。"
    ]),
    "下一步动作": bullet([
      "继续输入补充要求，我会保留当前默认工作台对话上下文继续完善。",
      "如果要关联具体客户，请在右侧选择客户，之后会切换为客户隔离记忆。",
      "如果要生成图片，请明确图片类型、风格、比例和使用场景，image2 会后台生成。",
      "如果要引用公司资料，请说明要查知识库、历史方案或案例库。"
    ])
  };

  const summary = {
    "本次沟通摘要": lastFollow?.content || message || "本次沟通内容较少，建议补充客户原话和明确反馈。",
    "客户明确反馈": lastFollow?.customerFeedback || "暂无明确客户反馈。",
    "内部判断": lastFollow?.internalJudgement || "建议补充我方判断，便于后续 AI 生成更准确。",
    "下一步动作": nextAction
  };

  const style = extraContext?.interactionStyle || extraContext?.style || "简洁商务";
  const websiteType = extraContext?.websiteType || "企业级 Web 系统";
  const extraRequirement = extraContext?.extraRequirement || "无额外补充";
  const requestedImageCount = clampNumber(extraContext?.imageCount, 1, 8, 3);
  const requestedDevice = normalizeInteractionDevice(extraContext?.defaultDevice || extraContext?.device || "桌面端");
  const imagePrompt = [
    `为「${customerName}」设计一张高保真交互图，项目类型：${websiteType}，视觉风格：${style}。`,
    `设备呈现：${buildInteractionDeviceInstruction(requestedDevice)}`,
    `基于客户需求：${customer?.demandDescription || pain}`,
    `业务背景：${customer?.background || "待确认"}`,
    `核心问题：${customer?.problemToSolve || pain}`,
    `界面重点展示：工作台首页、关键数据卡片、客户/项目列表、AI 分析区、任务推进区、资料/知识库区。`,
    requestedDevice === "移动端"
      ? "移动端布局：顶部客户摘要、关键动作按钮、纵向卡片列表、AI 推荐动作抽屉入口。"
      : "桌面端布局：左侧导航、顶部搜索与操作区、主内容看板、右侧智能建议面板；卡片高度统一，留白克制，信息层级清晰。",
    `交互状态：展示选中态、生成中轻量 loading、AI 输出预览、下一步动作 CTA。`,
    `画面要求：真实 SaaS 产品截图质感，中文 UI 文案，干净高级，避免杂乱，适合售前方案展示。`,
    `额外补充：${extraRequirement}`
  ].join("\n");

  const interactionImage = {
    "设计目标": `把 ${customerName} 的项目需求转成一张可用于售前沟通的高保真交互概念图，帮助客户快速理解系统形态、核心模块和 AI 能力入口。`,
    "页面结构": bullet([
      `设备选择：${requestedDevice}。`,
      requestedDevice === "移动端"
        ? "手机端：客户/项目摘要、关键动作、列表卡片、AI 推荐动作入口。"
        : `桌面端：左侧导航 + 顶部操作区 + ${websiteType} 核心工作台 + AI 建议侧栏。`,
      "如需双端对比，请在界面稿里把该张图的设备改为「桌面端 + 移动端」。"
    ]),
    "交互重点": bullet([
      "点击客户或项目卡片进入详情。",
      "AI 按钮根据当前上下文生成推荐动作、方案方向或待确认问题。",
      "生成内容以 Markdown 文档沉淀到客户历史。",
      "列表、卡片、按钮和加载态都保持稳定，不因内容过长撑开布局。"
    ]),
    "视觉风格": `采用「${style}」方向：克制留白、清晰层级、低噪声图表、统一圆角卡片和轻量阴影，整体参考高标准企业协作产品。`,
    "Image2 提示词": `\`\`\`text\n${imagePrompt}\n\`\`\``,
    "负向提示词": "避免低清晰度、夸张 3D、杂乱仪表盘、错误中文、过多渐变、塑料感按钮、无意义装饰、没有设备框、手机端与桌面端内容无关联。",
    "待确认信息": bullet([
      "客户真实品牌色或 Logo 是否需要出现在图里。",
      "首屏最需要突出业务数据、流程任务还是 AI 分析。",
      "这张图用于内部讨论、售前 PPT，还是客户演示页。"
    ])
  };

  const interactionDrafts = {
    "界面拆解策略": bullet([
      `本次输出 ${requestedImageCount} 张界面图草稿，每张都要有独立页面目标、布局说明和可直接给 image2 的提示词。`,
      `风格方向：${style}；网站/产品类型：${websiteType}。`,
      "必须只使用当前客户上下文，不得引用其他客户记忆；缺失信息写成待确认，不要伪造成客户已确认。",
      `默认设备为「${requestedDevice}」，但每张图可以根据页面目标单独选择桌面端、移动端、桌面端 + 移动端或响应式画板；不要默认每张都双端。`
    ]),
    "JSON": [
      "```json",
      JSON.stringify({
        screens: buildLocalInteractionDraftScreens({
          customerName,
          customer,
          websiteType,
          style,
          extraRequirement,
          imageCount: requestedImageCount,
          defaultDevice: requestedDevice,
          pain
        })
      }, null, 2),
      "```"
    ].join("\n")
  };

  const defaultImage = {
    "意图解析": `用户希望生成图片或视觉稿。当前不绑定客户，因此仅基于用户输入、全局 Skill、RAG/联网资料和明确补充信息生成。`,
    "画面目标": `围绕「${message || "默认 AI 工作台视觉稿"}」生成可用于市场、售前或内部方案沟通的图片。`,
    "视觉方向": `建议采用企业级 SaaS / 高端简洁 / 清晰信息层级的视觉方向；如果用户指定风格，则以用户指定为准。`,
    "Image2 提示词": `\`\`\`text\n${buildDefaultImagePromptText(message, extraContext)}\n\`\`\``,
    "负向提示词": "避免低清晰度、错误中文、杂乱排版、过度装饰、塑料感按钮、无意义图标、与用户主题无关的元素。",
    "可迭代方向": bullet(["补充品牌色、比例、使用场景和目标受众", "明确要生成海报、交互图、落地页、系统界面还是概念图", "如果要用于客户项目，请切换到对应客户上下文再生成"])
  };

  const consultation = {
    "客户需求理解": [
      `1. 客户想做什么：${customer?.demandDescription || pain}`,
      `2. 已有业务基础：${customer?.existingSystem || customer?.background || "待确认"}`,
      `3. 项目可能意味着什么：客户希望通过系统和 AI 把「${pain}」转成可管理、可追踪、可优化的业务流程。`,
      "4. 不能简单理解成：不能只理解成做一个功能列表或加一个 AI 聊天框，而是要判断业务主线、MVP 切口和 AI 真正嵌入的节点。",
      `5. 销售一句话复述：我们理解您不是单纯想做系统，而是希望围绕「${pain}」建立一套能落地、能分阶段推进、未来可叠加 AI 能力的业务工具。`
    ].join("\n"),
    "客户真实意图与隐性诉求": [
      "| 分析项 | 内容 |",
      "|---|---|",
      `| 客户表面需求 | ${customer?.demandDescription || "客户需求待补充"} |`,
      `| 客户真实想解决的问题 | ${pain} |`,
      "| 客户希望听到我们怎么理解 | 销售应先复述业务问题、现有基础和阶段目标，再说明我们会先帮他收敛 MVP，而不是一上来堆功能和报价。 |",
      "| 客户隐性诉求 | 希望乙方懂业务、能控制范围、能给可落地路径、能说明 AI 价值，且不要让项目变成不可控的大工程。 |",
      "| 我们应该给出的解决方向 | 先给业务流程梳理、MVP 切口、AI 融入点和案例参考，再推进需求深化会议。 |"
    ].join("\n"),
    "客户关注点与对应解决方案": [
      "| 客户关注点 | 为什么客户会关注 | 如果我是客户，我希望听到什么 | 我们应该给出的解决方案 | 销售沟通策略 |",
      "|---|---|---|---|---|",
      `| 业务主线是否讲得清 | 当前需求核心是「${pain}」，客户需要确认我们理解业务而不只是接功能 | 我希望你们先说清楚业务流程和目标 | 输出业务流程图、角色与场景拆解 | 下一次先问流程和目标，再谈功能 |`,
      `| MVP 范围是否可控 | ${budget}，客户大概率担心成本和周期失控 | 我希望先看到一期最小可行范围 | 拆一期必做、二期扩展、暂不承诺能力 | 用 MVP 降低客户决策压力 |`,
      "| AI 是否真的有价值 | 客户可能担心 AI 只是噱头 | 我希望知道 AI 解决效率、体验还是决策问题 | 把 AI 放到资料理解、内容生成、智能推荐、风险判断等节点 | 避免夸大模型能力，先讲业务价值 |",
      `| 与已有系统如何衔接 | 已有基础：${customer?.existingSystem || "待确认"} | 我希望知道不会推倒重来 | 做接口、数据、权限和流程边界调研 | 提前索要系统资料和接口说明 |`,
      `| 内部怎么推动决策 | 决策链：${decision} | 我希望拿到能给内部解释的材料 | 输出一页式需求理解、MVP 范围和阶段路径 | 帮客户准备内部汇报语言 |`
    ].join("\n"),
    "业务系统 + AI 融入判断": bullet([
      `业务系统主线：围绕「${pain}」搭建核心业务流程与数据沉淀。`,
      "AI 嵌入节点：需求理解、资料解析、智能推荐、内容生成、异常/风险提醒、运营分析。",
      "用户端 AI：个性化推荐、智能问答、内容辅助、表单/任务自动填充。",
      "后台/管理端 AI：数据摘要、运营洞察、风险识别、方案/文档生成。",
      "商家端/员工端 AI：工作提醒、知识检索、SOP 助手、跟进建议。",
      "当前最适合先做：围绕 MVP 流程做 AI 辅助，而不是承诺复杂模型训练。",
      "当前不建议承诺：没有数据基础的高准确率预测、完全自动决策、端到端无人值守流程。",
      "价值表达：业务系统负责流程闭环，AI 负责提升效率、体验、内容生产和判断质量。"
    ]),
    "AI 原生应用升级判断": bullet([
      "产品定位：如果客户具备数据和运营基础，可定位为围绕关键业务任务的 AI 原生工作台。",
      "核心体验：AI 不只是聊天框，而是贯穿搜索、推荐、生成、判断和行动。",
      "用户使用理由：用户因为 AI 能减少操作、给出建议、自动整理资料和辅助决策而持续使用。",
      "主入口：业务任务入口旁的 AI 推荐动作，而不是孤立聊天框。",
      "数据支撑：业务记录、文档资料、用户行为、历史决策、知识库和权限体系。",
      "机会：形成差异化体验和持续数据资产。",
      "风险：数据不足、预期过高、预算不足或运营能力不足会导致 AI 原生路径失真。",
      `当前建议：${customer?.customerType === "业务系统+AI" || /AI|智能/.test(customer?.customerType || customer?.demandDescription || "") ? "可以引导客户评估 AI 原生升级，但仍建议从业务系统 MVP 开始。" : "不建议一开始直接定义为 AI 原生应用，先走业务系统 + AI 辅助升级路径。"}`,
      "分阶段升级：一期业务流程和数据沉淀；二期 AI 助手和智能推荐；三期 Agent/工作流自动化。"
    ]),
    "案例匹配与销售讲法": context?.knowledgeBase?.used
      ? [
        "| 推荐案例 | 匹配原因 | 可借鉴内容 | 不可直接套用内容 | 销售应该怎么讲 |",
        "|---|---|---|---|---|",
        ...ensureArray(context.knowledgeBase.matches).slice(0, 4).map((item) => `| ${item.documentName || "知识库案例"} | 与「${customer?.customerType || "当前客户"}」需求或能力方向相近，相关度 ${item.score || "-"} | ${limitText(item.text, 120)} | 不能直接承诺相同范围、周期和结果 | 可以说“我们有类似方向经验，但会先按您当前流程重做 MVP 切口” |`)
      ].join("\n")
      : [
        "| 可参考案例类型 | 为什么适合参考 | 可以借鉴什么 | 销售应该怎么讲 |",
        "|---|---|---|---|",
        `| ${customer?.customerType || "业务系统 + AI"} 类项目 | 与当前客户需求方向接近 | MVP 范围、AI 融入点、实施节奏 | 我们先用类似项目的方法论帮您拆清楚流程和一期范围，不直接套模板 |`
      ].join("\n"),
    "下一步客户期待的行动建议": [
      "| 客户期待 | 说明 | 销售下一步应该做什么 | 交付给客户的内容 |",
      "|---|---|---|---|",
      "| 你们真的理解我的业务 | 客户已表达大概需求，希望被理解而不是被推功能 | 复述业务场景和核心问题 | 一页客户需求理解摘要 |",
      "| 给我一个可落地切口 | 客户担心方案过大 | 拆 MVP 范围和阶段路径 | MVP 范围建议 |",
      "| 告诉我 AI 放在哪里有用 | 客户希望听到 AI 的实际价值 | 结合流程说明 AI 节点 | AI 融入点清单 |",
      "| 帮我内部沟通 | 客户可能需要向老板或同事解释 | 输出适合内部评审的材料 | 方案大纲/沟通提纲 |",
      "| 下一次沟通更有效 | 客户希望少走弯路 | 发送待确认问题和资料清单 | 需求澄清问题清单 |"
    ].join("\n"),
    "销售人员沟通策略": [
      "### 8.1 下一次沟通目标",
      "确认客户业务流程、MVP 范围、AI 融入价值、预算区间、决策链和下一步材料交付。",
      "",
      "### 8.2 下一次必须确认的问题",
      bullet([
        "这个项目最优先解决的业务问题是什么？",
        "当前流程中最耗时或最容易出错的节点在哪里？",
        "已有系统、数据和文档分别有哪些？",
        "哪些能力必须一期上线，哪些可以二期？",
        "内部谁推动、谁使用、谁最终拍板？",
        "预算区间和期望上线时间大概是什么？",
        "项目成功后你们如何衡量效果？",
        "是否需要我们准备内部汇报材料？",
        "客户最担心乙方交付过程中的什么问题？",
        "是否有必须对接的第三方系统或硬件？"
      ]),
      "",
      "### 8.3 沟通中应该如何表达",
      "建议表达：我们先不急着做完整方案，先把您的业务目标、现有基础和一期可落地范围拆清楚。会后我们给您一份需求理解、MVP 范围和 AI 融入点建议，方便您内部判断。",
      "",
      "### 8.4 沟通中不要怎么说",
      bullet(["不要一开始承诺完整 AI 原生应用。", "不要在预算和范围不清楚时直接报价。", "不要把客户需求复述成单纯功能清单。", "不要承诺没有数据基础支撑的 AI 准确率。"])
    ].join("\n"),
    "销售人员行动汇总": [
      "### 9.1 当前跟进结论",
      `这个客户应先进入轻量需求澄清与 MVP 切口判断，重点验证「${pain}」是否具备真实投入价值。`,
      "",
      "### 9.2 下一步优先动作",
      "",
      "| 优先级 | 行动事项 | 目的 | 执行方式 | 产出物 |",
      "|---|---|---|---|---|",
      "| P0 | 发送需求复述和待确认问题 | 建立“我们懂你”的信任 | 微信/邮件发送一页摘要 | 需求理解摘要 |",
      "| P1 | 约需求澄清会 | 确认范围、预算、决策 | 邀请业务和决策相关人 | 会议纪要 |",
      "| P2 | 拆 MVP 范围 | 控制交付和商务风险 | 按一期/二期/暂缓拆分 | MVP 范围表 |",
      "| P3 | 梳理 AI 融入点 | 避免为 AI 而 AI | 绑定具体业务节点 | AI 融入点清单 |",
      "| P4 | 准备案例讲法 | 帮客户理解落地路径 | 引用相似案例类型 | 案例讲法材料 |",
      "",
      "### 9.3 本次应准备的材料",
      bullet(["客户需求理解摘要", "需求澄清问题清单", "MVP 范围建议", "AI 融入点分析", "类似案例讲法"]),
      "",
      "### 9.4 暂时不要做的事情",
      bullet(["不要直接做完整 PRD。", "不要直接给固定报价。", "不要承诺复杂 AI 自动化。", "不要在资料不足时做过度方案设计。"]),
      "",
      "### 9.5 是否进入下一阶段",
      `建议：${customer?.demandDescription ? "继续轻咨询，并准备进入需求沟通/需求深化。" : "先补齐客户需求信息，暂缓重投入。"} 判断原因：当前仍需要确认预算、决策链、MVP 范围和 AI 数据基础。`
    ].join("\n")
  };

  const followSummaryItems = ensureArray(context?.followRecords).slice(0, 5);
  const confirmedSummary = followSummaryItems
    .map((item) => item.customerFeedback || item.aiSummary || item.content)
    .filter(Boolean)
    .slice(0, 3);
  const missingFields = [
    customer?.demandDescription ? "" : "客户原始需求",
    customer?.background ? "" : "客户业务背景",
    customer?.problemToSolve ? "" : "想解决的问题",
    customer?.existingSystem ? "" : "已有基础",
    customer?.budgetInfo ? "" : "预算信息",
    customer?.decisionInfo ? "" : "决策链"
  ].filter(Boolean);
  const nextCommunication = {
    "本次沟通目标": bullet([
      `用一句专业复述确认客户是否认可我们对「${pain}」的理解。`,
      "判断客户是否具备启动条件：业务负责人、预算区间、时间窗口和内部决策节奏。",
      "收敛 MVP 范围，把一期必须验证的业务闭环和二期扩展项拆开。",
      "确认 AI 预期：AI 解决效率、体验、内容生产、分析判断还是运营决策问题。",
      "判断下一步进入需求深化、轻方案、MVP 方案、报价准备还是暂缓。"
    ]),
    "沟通前客户状态判断": bullet([
      `客户当前属于「${customer?.customerType || "待确认类型"}」线索，阶段为「${stageName}」，核心需求是「${customer?.demandDescription || pain}」。`,
      `最需要确认的关键点：${missingFields.length ? missingFields.join("、") : "MVP 范围、预算/周期、决策链和 AI 数据基础" }。`,
      "当前不适合直接做完整 PRD、固定报价或复杂 AI 能力承诺。",
      "本次沟通结束后必须形成：是否能启动、一期边界是什么、客户需要我们交付什么材料、谁参与下一轮决策。"
    ]),
    "必须确认的核心问题": [
      "| 序号 | 问题 | 提问目的 | 如何判断客户回答 | 对推进的影响 |",
      "|---:|---|---|---|---|",
      "| 1 | 这次项目最想优先解决的一个业务问题是什么？ | 找到启动动机 | 客户能否说出具体场景、成本或效率问题 | 决定是否进入需求深化 |",
      "| 2 | 如果只做一期 MVP，哪些流程必须跑通？ | 收敛范围 | 客户能否区分必做和可后置 | 决定方案边界和报价口径 |",
      "| 3 | 目前已有系统、数据、文档或接口分别是什么状态？ | 判断落地基础 | 客户是否能提供资料清单或系统负责人 | 决定技术调研深度 |",
      "| 4 | AI 这部分您更希望解决效率、体验、内容生产还是判断决策？ | 校准 AI 预期 | 客户是否能绑定业务节点而不是只说“智能” | 决定 AI 能力承诺范围 |",
      "| 5 | 项目成功后，内部会用什么指标判断值得继续投入？ | 形成验收标准 | 客户是否有明确业务指标或管理目标 | 决定 MVP 验证指标 |",
      "| 6 | 谁会日常使用，谁推动，谁最终拍板？ | 明确决策链 | 客户是否能说清角色和参与节奏 | 决定下一次会议邀请对象 |",
      `| 7 | 预算和上线时间目前有没有大致区间？ | 判断能否启动 | 客户是否愿意给范围或约束 | ${budget === "预算信息暂不明确" ? "预算缺失时暂不建议报价" : "用于匹配阶段方案"} |`,
      "| 8 | 会后您最希望我们先给哪类材料，需求理解、问题清单、MVP 方案还是案例？ | 站在客户期待组织交付 | 客户是否能明确内部沟通需要 | 决定销售下一步产出物 |",
      "| 9 | 有没有必须避开的交付风险或内部顾虑？ | 提前识别阻力 | 客户是否提到数据、安全、周期、预算或协同问题 | 决定风险话术和推进节奏 |",
      "| 10 | 如果我们先给轻方案，您希望哪些人一起评审？ | 推动下一阶段 | 客户是否愿意安排关键人参与 | 决定是否进入方案制作 |"
    ].join("\n"),
    "按主题拆分的问题清单": [
      "### 4.1 项目启动与决策",
      bullet(["这次项目由哪个部门发起，背后的业务压力是什么？", "内部有没有明确的启动时间窗口？", "谁是日常推进人，谁负责最终拍板？", "如果要进入下一阶段，客户内部需要看到什么材料？"]),
      "",
      "### 4.2 业务目标与第一阶段验证",
      bullet(["一期最希望验证哪个业务闭环？", "当前流程里最耗人、最慢或最不可控的节点是什么？", "项目成功后，内部最关注效率、成本、体验还是管理可视化？", "有哪些指标可以证明一期值得继续投入？"]),
      "",
      "### 4.3 MVP 范围收敛",
      bullet(["哪些功能不做就无法上线？", "哪些能力可以放到二期或运营成熟后再做？", "一期是否可以先服务一个部门、一个角色或一个场景？", "客户能否接受先用低风险 MVP 验证价值？"]),
      "",
      "### 4.4 产品形态与用户路径",
      bullet(["核心用户是谁，他们从哪里进入系统？", "用户完成一次关键任务需要经过哪些步骤？", "移动端、Web、后台、员工端分别是否必要？", "哪些环节需要降低操作门槛或减少重复录入？"]),
      "",
      "### 4.5 业务流程与运营",
      bullet(["现在线下或旧系统流程是怎么跑的？", "哪些节点需要审批、提醒、统计或留痕？", "运营人员需要看到哪些数据或异常？", "上线后谁维护内容、规则、资料和用户权限？"]),
      "",
      "### 4.6 AI 融入点",
      bullet(["AI 应该在流程哪个节点出现才最自然？", "AI 主要辅助生成、检索、总结、推荐还是风险判断？", "AI 使用的数据来源有哪些，是否有权限和质量问题？", "哪些 AI 能力当前不能承诺，需要先做验证？"]),
      "",
      "### 4.7 预算与周期",
      bullet(["预算是固定区间还是要先看方案再评估？", "有没有必须上线的时间节点？", "客户更倾向一次完整建设还是分阶段投入？", "报价前是否可以先确认一期范围和验收口径？"])
    ].join("\n"),
    "顾问式提问话术": [
      "| 提问话术 | 背后目的 | 销售接话建议 |",
      "|---|---|---|",
      "| 我们先不急着拆功能，我想先确认这个项目真正要解决的业务结果是什么。 | 从功能收集转向业务目标 | 客户回答后复述成“目标 + 场景 + 价值” |",
      "| 如果只做一期，您觉得哪一段流程跑通后，内部就会觉得这个项目值得继续投入？ | 收敛 MVP | 顺势拆必做、可后置、暂不做 |",
      "| AI 这块我们不建议为了智能而智能，您更希望它减少人工、提升体验、辅助判断还是做内容生产？ | 校准 AI 预期 | 把回答映射到具体 AI 节点 |",
      "| 会后如果我们给您一份轻量材料，您最希望它帮您内部解决什么问题？ | 判断客户期待 | 决定交付需求理解、MVP 或案例材料 |",
      "| 为了避免方案做大，我们想先把边界确认清楚，哪些能力您认为一期必须保留？ | 降低范围风险 | 明确一期范围和报价前提 |",
      "| 这个项目内部谁最关心结果，谁最担心风险？ | 识别决策链 | 为下一次会议邀请关键人 |",
      "| 我们可以先按低风险路径走，先验证业务闭环，再逐步叠加 AI 自动化，您看这个节奏是否符合内部预期？ | 建立专业推进感 | 用阶段路径替代一次性承诺 |"
    ].join("\n"),
    "不建议直接问的问题": [
      "| 不建议问法 | 为什么不建议 | 更好的问法 |",
      "|---|---|---|",
      "| 您要哪些功能？ | 容易变成功能堆叠 | 这次最想先跑通哪一段业务流程？ |",
      "| 预算是多少？ | 容易让客户产生报价压力 | 为了判断阶段方案，预算更接近试点投入还是完整系统建设？ |",
      "| 您要不要 AI？ | 太泛，无法判断价值 | AI 更适合帮您做检索、生成、总结、推荐还是风险判断？ |",
      "| 您什么时候签合同？ | 压迫感强 | 如果一期范围清楚，内部下一步评审节奏大概是怎样的？ |",
      "| 我们可以都做。 | 容易扩大承诺 | 建议先拆一期验证范围，二期再扩展复杂能力。 |",
      "| 您把需求文档发我。 | 显得被动 | 我们可以先帮您整理一版需求理解，再请您确认关键边界。 |"
    ].join("\n"),
    "沟通后应形成的判断": bullet([
      `是否进入需求深化：${customer?.demandDescription ? "倾向可以，但需要先确认 MVP、预算和决策链。" : "暂不建议，需先补齐原始需求。"}`,
      "是否输出轻方案：建议输出，内容聚焦需求理解、MVP 切口和 AI 融入点。",
      `是否需要案例：${context?.knowledgeBase?.used ? "可引用知识库命中的相近案例，但要说明不可直接套用。" : "需要准备相近案例类型，不要假设已有高度匹配案例。"}`,
      "是否需要 MVP 方案：如果客户能给出核心场景和启动窗口，应准备。",
      `是否可以报价：${budget === "预算信息暂不明确" ? "暂不建议，先确认范围和预算区间。" : "可准备阶段报价，但必须绑定范围和验收口径。"}`,
      "是否暂缓：如果客户无法说明业务目标、决策人和时间窗口，应暂缓重投入。"
    ]),
    "销售人员行动清单": [
      "### 沟通前",
      bullet([
        "整理一页客户需求复述，重点写业务问题而不是功能列表。",
        `准备围绕「${pain}」的 MVP 范围假设和待确认问题。`,
        confirmedSummary.length ? `复盘已确认事项：${confirmedSummary.join("；")}` : "把缺失信息列为本次必须确认的问题。",
        "准备相近案例类型或方法论讲法，不编造具体案例。"
      ]),
      "",
      "### 沟通中",
      bullet([
        "先复述业务理解，再确认客户是否认可。",
        "用顾问式提问引导客户区分目标、范围、AI 预期、预算和决策。",
        "遇到客户提出新功能时，先问它服务哪个业务目标，再判断是否进一期。",
        "不要直接报价，不承诺缺少数据基础的复杂 AI 能力。"
      ]),
      "",
      "### 沟通后",
      bullet([
        "输出会议纪要和已确认/待确认事项。",
        "根据客户反馈生成轻方案、MVP 范围或需求深化方案。",
        "把本次问题清单和客户回答保存为跟进记录。",
        "明确下一步会议对象、材料交付物和推进时间。"
      ])
    ].join("\n")
  };

  const lightweightPorts = parseLightweightSolutionPorts(extraContext?.salesSupplement?.portScope || extraContext?.lightweightSolution?.portScope || customer?.portScope || "");
  const preservedModules = collectLightweightSolutionItems(extraContext?.salesSupplement?.basicModules || extraContext?.lightweightSolution?.basicModules || "");
  const preservedCoreFeatures = collectLightweightSolutionItems(extraContext?.salesSupplement?.confirmedCoreFeatures || extraContext?.lightweightSolution?.confirmedCoreFeatures || "");
  const supplementDirections = collectLightweightSolutionItems(extraContext?.salesSupplement?.supplementDirections || extraContext?.lightweightSolution?.supplementDirections || "");
  const aiNeeds = collectLightweightSolutionItems(extraContext?.salesSupplement?.aiNeeds || extraContext?.lightweightSolution?.aiNeeds || "");
  const noteItems = collectLightweightSolutionItems(extraContext?.salesSupplement?.notes || extraContext?.lightweightSolution?.notes || "");
  const defaultPorts = lightweightPorts.length ? lightweightPorts : inferDefaultSolutionPorts(customer);
  const projectName = customer?.name || customerName;
  const directionLines = [
    `结合当前沟通内容，我方理解，贵方本次规划的软件部分，不仅是实现若干功能，而是要围绕「${pain}」建立一套可使用、可管理、可持续扩展的软件产品体系。`,
    `${customer?.background ? `从业务背景看，当前项目与「${customer.background}」直接相关，软件系统需要承接业务闭环、角色协同和后续数据沉淀。` : "从当前资料看，软件系统需要先把核心业务流程跑顺，再逐步扩展运营与 AI 能力。"} `,
    `在当前阶段，更适合先从产品层次、功能结构和端口规划角度梳理完整骨架，再结合预算、周期和优先级确认一期 MVP。`
  ].map((line) => line.trim()).filter(Boolean);
  const portSectionMarkdown = defaultPorts.map((port, index) => buildLightweightPortSection({
    index: index + 1,
    port,
    customer,
    preservedModules,
    preservedCoreFeatures,
    supplementDirections
  })).join("\n\n");
  const aiRows = buildLightweightAiRows({
    ports: defaultPorts,
    preservedModules,
    preservedCoreFeatures,
    aiNeeds,
    supplementDirections
  });
  const structureBlocks = defaultPorts.map((port) => {
    const modules = inferPortStructureModules({ port, preservedModules, preservedCoreFeatures, supplementDirections });
    return [
      `### ${port}结构`,
      ...modules.slice(0, 5).map((item) => `- ${item}`)
    ].join("\n");
  }).join("\n\n");
  const supplementSummary = [
    preservedModules.length ? `已保留基础功能模块：${preservedModules.join("、")}` : "",
    preservedCoreFeatures.length ? `已保留已确认核心功能：${preservedCoreFeatures.join("、")}` : "",
    aiNeeds.length ? `AI 诉求：${aiNeeds.join("、")}` : "",
    noteItems.length ? `补充备注：${noteItems.join("、")}` : ""
  ].filter(Boolean).join("；");
  const kbMatches = ensureArray(context?.knowledgeBase?.matches);
  const coreScenarioNames = inferSolutionScenarioNames({
    customer,
    pain,
    ports: defaultPorts,
    preservedCoreFeatures,
    preservedModules,
    limit: 3
  });
  const aiScenarioNames = inferSolutionAiScenarioNames({
    customer,
    pain,
    ports: defaultPorts,
    aiNeeds,
    preservedCoreFeatures,
    limit: 3
  });
  const solutionPage = ({ title: pageTitle, goal, content, visual }) => [
    `### 【${pageTitle}】`,
    `- 页面标题：${pageTitle}`,
    `- 页面目标：${goal}`,
    `- 页面内容：${content}`,
    `- 页面建议呈现方式：${visual}`
  ].join("\n");
  const solutionDeepening = {
    "场景定义": [
      `本项目建议设置 ${coreScenarioNames.length} 个核心业务场景、${aiScenarioNames.length} 个 AI 场景。场景数量以方案表达清晰为优先，不追求覆盖所有功能点。`,
      "",
      "| 类型 | 场景名称 | 单独成页理由 | 服务的客户认知目标 | 上下文依据 |",
      "|---|---|---|---|---|",
      ...coreScenarioNames.map((name) => `| 核心业务场景 | ${safeTableCell(name)} | 该场景直接承接「${safeTableCell(pain).slice(0, 60)}」的主业务闭环 | 让客户看懂系统如何跑起来 | 客户需求、业务背景、端口规划、跟进记录 |`),
      ...aiScenarioNames.map((name) => `| AI 场景 | ${safeTableCell(name)} | 该场景能说明 AI 如何嵌入现有业务节点 | 让客户理解 AI 不是概念，而是效率/体验/判断能力 | AI诉求、客户资料、知识库能力与已生成文档 |`),
      "",
      "说明：如果客户后续补充更多角色、硬件、第三方系统或业务流程，可再增加场景页；当前阶段不建议把方案拆得过细。"
    ].join("\n"),
    "项目概述与建设目标": [
      solutionPage({
        title: "项目背景",
        goal: "让客户快速进入语境，知道本方案是在已有沟通共识基础上的强化方案。",
        content: `结合当前客户信息，本项目可概括为：围绕「${pain}」建设一套可使用、可管理、可持续扩展的软件与 AI 能力体系。当前重点不是从零讲需求，而是把已沟通内容转成清晰的建设主线、产品结构和后续推进依据。`,
        visual: "简短引导文字 + 关键信息卡片，卡片包含客户类型、业务背景、核心问题、已有基础、当前阶段。"
      }),
      "",
      solutionPage({
        title: "本期建设目标",
        goal: "收敛后续方案判断标准，避免页面内容发散。",
        content: bullet([
          `围绕「${pain}」跑通一期核心业务闭环。`,
          `明确 ${defaultPorts.slice(0, 3).join("、")} 等端口在本期分别承接什么角色和业务目标。`,
          "建立基础数据沉淀、后台管理和关键状态流转能力，为后续运营和 AI 增强打底。",
          "把 AI 能力控制在可解释、可验证、可逐步增强的业务节点中，避免过度承诺。"
        ]),
        visual: "3-4 个目标卡片 / 分点概述，每个目标配一个对应的业务价值标签。"
      })
    ].join("\n\n"),
    "项目整体方案": [
      solutionPage({
        title: "项目全景与产品结构图",
        goal: "先建立全局认知，让客户一眼看懂项目由哪些端、层、角色和模块组成。",
        content: `建议以「${defaultPorts.join(" + ")}」为产品端口主线，向下承接基础数据、权限、资料、流程状态和运营管理，向上呈现用户使用路径、业务处理入口和 AI 辅助能力。`,
        visual: "综合总览图 / 分层结构图 / 系统全景图；左侧为角色与端口，中间为业务模块，右侧为 AI 与数据沉淀。"
      }),
      "",
      solutionPage({
        title: "核心业务闭环",
        goal: "让客户理解项目不是静态功能堆砌，而是一套可运转的业务系统。",
        content: `建议表达为：用户/业务对象进入系统 -> 完成核心操作或数据接入 -> 系统记录状态与资料 -> 后台处理、审核、配置或运营 -> AI 在关键节点提供摘要、推荐、生成或分析 -> 结果反馈给用户/运营人员 -> 数据持续沉淀。`,
        visual: "闭环图 / 业务链路图 / 流程闭环图，使用 6-7 个节点展示主业务链路。"
      }),
      "",
      solutionPage({
        title: "系统整体架构图",
        goal: "强化积木科技既懂产品也懂技术落地的认知。",
        content: `客户可理解版架构建议拆为：入口层（${defaultPorts.join("、")}）、应用层（核心业务模块）、平台层（权限、配置、消息、文件、日志）、AI 层（RAG/生成/总结/推荐/分析）、数据层（业务数据、资料、知识库、行为记录）、第三方/硬件/模型服务层（按项目实际待确认）。`,
        visual: "简化分层架构图，不展示过深技术细节，重点突出业务支撑关系。"
      })
    ].join("\n\n"),
    "核心场景方案": coreScenarioNames.map((name, index) => solutionPage({
      title: `核心场景${index + 1}：${name}`,
      goal: "通过单个关键业务场景说明系统如何落地、页面大概如何承接、客户能获得什么价值。",
      content: [
        `场景流程：用户/业务角色从「${name}」入口进入，完成信息查看、提交、处理或确认；系统记录关键状态和资料；后台根据规则进行配置、审核、跟进或运营；结果形成可追踪的数据沉淀。`,
        `页面示意图：建议展示一个主页面，包含顶部场景摘要、关键操作区、业务对象列表/详情、状态流转、资料区域和 AI 辅助入口。`,
        `价值总结：该场景帮助客户把「${pain}」从模糊需求转成可执行流程，降低沟通成本，提高业务可视化和后续运营能力。`
      ].join("\n"),
      visual: "单页模板：流程图 + 页面示意图 + 价值总结，页面右侧保留 3 个价值卡片。"
    })).join("\n\n"),
    "AI能力与落地方案": [
      solutionPage({
        title: "AI 总览",
        goal: "讲清楚 AI 在项目中用在哪里、怎么起作用，以及如何与整体业务结合。",
        content: `AI 不建议作为孤立模块堆砌，应围绕 ${defaultPorts.slice(0, 3).join("、")} 中已有的高频操作、资料理解、内容生成、运营分析和风险提醒节点融入。输入包括业务数据、客户资料、历史记录、知识库和用户操作；输出包括摘要、推荐、报告、提醒、问答或结构化内容。`,
        visual: "AI 应用位置总览 + AI 能力架构图；用输入、处理、输出三层表达。"
      }),
      "",
      aiScenarioNames.map((name, index) => solutionPage({
        title: `AI场景${index + 1}：${name}`,
        goal: "把单个 AI 场景讲透，避免 AI 只停留在概念层。",
        content: [
          `AI 场景流程：业务人员在「${name}」相关页面触发 AI，系统读取当前业务对象、资料、历史记录和必要知识库片段，AI 输出摘要、建议、文档、提醒或下一步动作，最后由人工确认后进入业务流程。`,
          "AI 结果示意图：建议展示 AI 输出卡片/报告/推荐列表，包含依据、结论、建议动作和待确认项。",
          "价值总结：该场景重点解决人工整理成本高、信息理解门槛高、判断不稳定或内容生产耗时的问题。"
        ].join("\n"),
        visual: "单页模板：AI 流程图 + AI 结果示意图 + 价值总结，突出输入/输出关系。"
      })).join("\n\n")
    ].join("\n\n"),
    "建设范围与落地策略": [
      solutionPage({
        title: "完整功能总览",
        goal: "用总览兜底，避免客户只看到场景页而对完整范围缺乏安全感。",
        content: `建议按端口输出模块树：${structureBlocks.replace(/\n/g, "；").slice(0, 900)}`,
        visual: "模块树 / 总览表 / 分栏结构图，按端口分栏展示。"
      }),
      "",
      solutionPage({
        title: "一期建设范围",
        goal: "为后续报价、排期和范围控制建立基础。",
        content: bullet([
          "一期优先保障核心业务闭环、基础账号权限、关键资料/数据沉淀和后台管理能力。",
          `一期重点围绕「${pain}」相关的最小可用路径建设。`,
          "暂不建议把复杂自动化、未验证 AI 准确率、过多角色端口和非必要第三方深度集成放入一期。",
          "所有扩展能力需结合预算、周期、数据基础和客户内部协同再确认。"
        ]),
        visual: "本期范围框图 / 分层清单，区分一期必做、一期建议、二期增强、暂不建议。"
      }),
      "",
      solutionPage({
        title: "后续扩展方向",
        goal: "体现方案有节奏、可持续，而不是一次性堆功能。",
        content: bullet(["二期可强化多角色协同、运营数据分析、更多 AI 辅助场景。", "三期可评估 Agent 工作流、自动化运营、深度知识库/RAG、更多外部系统集成。", "长期方向应以客户业务数据成熟度和使用反馈为依据。"]),
        visual: "阶段演进图 / 二期规划图。"
      }),
      "",
      solutionPage({
        title: "第三方服务与依赖",
        goal: "提前暴露落地复杂度，减少后续交付偏差。",
        content: "| 依赖类型 | 可能内容 | 当前判断 | 待确认 |\n|---|---|---|---|\n| AI 模型服务 | 大模型、Embedding、图片或语音模型 | 可按功能需要接入 | 模型供应商、成本、权限 |\n| 消息与通知 | 短信、邮件、微信、App 推送 | 视端口形态决定 | 账号、模板、频次 |\n| 支付/地图/物流/硬件 | 如项目涉及再确认 | 当前不默认承诺 | 是否进入一期 |\n| 备案/合规/数据安全 | 域名、隐私、权限、日志 | 企业系统需提前考虑 | 客户侧资料与政策要求 |",
        visual: "分类表格 / 依赖清单。"
      }),
      "",
      solutionPage({
        title: "项目落地方式 / 合作推进建议",
        goal: "让方案自然从“看懂了”过渡到“可以推进了”。",
        content: bullet(["第一步：确认一期目标、端口边界、关键业务流程和 AI 能力边界。", "第二步：输出 MVP 范围、页面原型或功能清单，供客户内部评审。", "第三步：结合范围确认报价、排期和双方配合事项。", "第四步：进入项目启动、需求确认、设计开发、测试验收和上线迭代。"]),
        visual: "时间轴 / 阶段图 / 推进清单。"
      })
    ].join("\n\n"),
    "积木科技介绍": [
      solutionPage({
        title: "积木科技公司定位与核心能力",
        goal: "说明为什么积木科技适合承接本项目。",
        content: kbMatches.length
          ? `建议引用知识库命中资料：${kbMatches.slice(0, 4).map((item) => `${item.knowledgeBaseName}/${item.documentName}（相关度 ${item.score}）`).join("；")}。表达重点：积木科技具备软件定制、AI 解决方案、业务系统 + AI、IoT + AI、RAG/Agent/工作流和企业系统交付能力。`
          : "知识库未命中足够明确的公司介绍或能力资料。建议管理员补充积木科技公司介绍、核心能力、产品能力和典型案例后再生成客户最终版。当前可表达为：积木科技定位为软件定制与 AI 解决方案服务商，擅长把业务系统、AI 能力、知识库、Agent 和工作流结合到客户实际业务中。",
        visual: "公司定位卡片 + 核心能力矩阵。"
      }),
      "",
      solutionPage({
        title: "相关案例与适配理由",
        goal: "用案例帮助客户理解项目如何落地，而不是简单证明我们做过。",
        content: kbMatches.length
          ? ["| 推荐资料/案例 | 匹配原因 | 可借鉴内容 | 不可直接套用内容 | 销售讲法 |", "|---|---|---|---|---|", ...kbMatches.slice(0, 4).map((item) => `| ${safeTableCell(item.documentName)} | 与当前客户类型或能力方向相关，相关度 ${item.score} | ${safeTableCell(limitText(item.text, 120))} | 不直接承诺相同范围、周期、价格或效果 | 可以说“我们会参考类似项目的方法论，但按贵方流程重做一期切口” |`)].join("\n")
          : "| 可参考案例类型 | 为什么适合参考 | 可以借鉴什么 | 销售应该怎么讲 |\n|---|---|---|---|\n| 业务系统 + AI / IoT + AI / 企业内部 AI 系统 | 与当前项目的软件系统和 AI 融入诉求接近 | MVP 收敛、端口规划、AI 节点设计、分阶段建设 | 我们先用类似项目的方法论帮您拆清楚流程和一期范围，不直接套模板 |",
        visual: "案例卡片 / 对比表格，重点放业务价值和落地路径。"
      }),
      "",
      solutionPage({
        title: "为什么适合由积木科技来做",
        goal: "把公司能力与本项目诉求建立直接关联。",
        content: bullet([
          "既能做业务系统，也能把 AI 能力嵌入业务流程，而不是只做聊天框。",
          "能从售前阶段帮助客户收敛 MVP、识别依赖、拆端口和设计 AI 融入点。",
          "适合需要软件定制、知识库/RAG、Agent、工作流、企业系统或 IoT 数据接入的项目。",
          "当前项目需要兼顾产品结构、业务闭环、AI 场景和落地边界，正适合用积木科技的软件 + AI 一体化方案能力承接。"
        ]),
        visual: "能力-项目匹配矩阵 / 四象限卡片。"
      })
    ].join("\n\n")
  };
  const historicalSolutionEntry = {
    "方案摘要": [
      `本方案来自客户「${customerName}」的真实 CRM 上下文沉淀，用于后续历史方案库 RAG 检索引用。`,
      `项目可概括为：围绕「${pain}」建设一套业务系统与 AI 能力结合的解决方案。`,
      "该文档优先沉淀可复用的业务场景、产品结构、AI 融入点、MVP 范围、交付依赖和风险，不用于直接对客户报价或承诺排期。"
    ].join("\n"),
    "客户与项目画像": [
      "| 字段 | 内容 |",
      "|---|---|",
      `| 客户名称 | ${safeTableCell(customerName)} |`,
      `| 客户类型 | ${safeTableCell(customer?.customerType || "待确认")} |`,
      `| 当前阶段 | ${safeTableCell(stageName)} |`,
      `| 客户来源 | ${safeTableCell(customer?.source || "待确认")} |`,
      `| 业务背景 | ${safeTableCell(customer?.background || "待确认")} |`,
      `| 已有基础 | ${safeTableCell(customer?.existingSystem || "待确认")} |`,
      `| 预算/决策 | ${safeTableCell(`${budget}；${decision}`)} |`
    ].join("\n"),
    "客户需求与真实诉求": bullet([
      `表面需求：${customer?.demandDescription || pain}`,
      `真实诉求：通过系统化能力解决「${pain}」，并形成可持续运营、管理和数据沉淀的业务闭环。`,
      `隐性关注点：${risk}`,
      "待确认：核心角色、一期 MVP 边界、预算区间、决策链、第三方/硬件/数据依赖、AI 数据基础。"
    ]),
    "方案主线与产品结构": [
      `方案主线：以 ${defaultPorts.join(" + ")} 为端口承接，以业务闭环、后台管理、数据沉淀和 AI 辅助为能力主线。`,
      "",
      "| 端口/层级 | 建议模块 | 复用价值 |",
      "|---|---|---|",
      ...defaultPorts.slice(0, 6).map((port) => {
        const modules = inferPortStructureModules({ port, preservedModules, preservedCoreFeatures, supplementDirections }).slice(0, 5).join("、");
        return `| ${safeTableCell(port)} | ${safeTableCell(modules)} | 后续类似项目可参考端口拆分、模块边界和管理能力设计 |`;
      })
    ].join("\n"),
    "核心场景与业务闭环": [
      "| 核心场景 | 场景流程 | 方案价值 |",
      "|---|---|---|",
      ...coreScenarioNames.map((name) => `| ${safeTableCell(name)} | 业务角色进入场景 -> 提交/查看/处理信息 -> 系统状态流转 -> 后台管理支撑 -> 数据沉淀 | 用场景方式帮助客户理解系统如何落地，避免只看功能清单 |`)
    ].join("\n"),
    "AI 融入点": [
      "| AI 场景 | 关联业务节点 | AI 输出 | 价值 | 建议阶段 |",
      "|---|---|---|---|---|",
      ...aiScenarioNames.map((name, index) => `| ${safeTableCell(name)} | ${safeTableCell(coreScenarioNames[index % coreScenarioNames.length] || "核心业务流程")} | 摘要、建议、报告、推荐、提醒或结构化内容 | 降低人工整理成本，提高判断和内容生产效率 | ${index === 0 ? "一期可简化支持" : "二期增强"} |`)
    ].join("\n"),
    "MVP 范围与阶段规划": [
      "| 阶段 | 建议范围 | 不建议范围 | 产出物 |",
      "|---|---|---|---|",
      `| 一期 MVP | 核心业务闭环、${defaultPorts.slice(0, 3).join("、")}基础能力、后台管理、资料/数据沉淀、简化 AI 辅助 | 复杂自动化、未验证准确率的 AI 决策、过多端口和深度第三方集成 | MVP 范围、功能清单、原型、报价依据 |`,
      "| 二期增强 | 运营分析、更多 AI 场景、多角色协同、知识库/RAG 深化 | 脱离业务流程的 AI 概念堆砌 | 迭代方案、运营看板、AI 能力增强清单 |",
      "| 长期规划 | Agent 工作流、自动化运营、更多系统/硬件/数据集成 | 无数据基础的全自动承诺 | 长期路线图 |"
    ].join("\n"),
    "交付依赖与风险": [
      "| 类型 | 内容 | 风险 | 处理建议 |",
      "|---|---|---|---|",
      `| 需求边界 | ${safeTableCell(customer?.demandDescription || "待确认")} | 范围过大导致报价和交付不稳定 | 先确认 MVP 闭环 |`,
      `| 数据/资料 | ${safeTableCell(customer?.existingSystem || "待确认")} | 数据质量不足会影响 AI 和运营分析 | 提前收集样例数据/资料 |`,
      "| 第三方/硬件/接口 | 按项目实际确认 | 接口不稳定会影响排期和验收 | 做接口清单和技术预研 |",
      `| 商务决策 | ${safeTableCell(decision)} | 决策链不清会拖慢推进 | 邀请关键角色参与评审 |`
    ].join("\n"),
    "可复用标签与检索关键词": [
      "| 类型 | 关键词 |",
      "|---|---|",
      `| 客户类型 | ${safeTableCell(customer?.customerType || "业务系统+AI")} |`,
      `| 行业/场景 | ${safeTableCell([customer?.background, customer?.demandDescription, customer?.problemToSolve].filter(Boolean).join(" / ").slice(0, 120) || "待确认")} |`,
      `| 端口 | ${safeTableCell(defaultPorts.join("、"))} |`,
      `| AI 能力 | ${safeTableCell(aiScenarioNames.join("、"))} |`,
      `| 复用关键词 | ${safeTableCell([customer?.customerType, "业务系统+AI", "软件定制", "AI融入点", "MVP范围", ...coreScenarioNames, ...aiScenarioNames].filter(Boolean).join("、"))} |`
    ].join("\n"),
    "后续引用建议": bullet([
      "后续生成前期咨询回应、需求深化、轻量级方案、方案大纲、PPT 结构稿时，可把本方案作为相近案例引用。",
      "引用时不要直接套用报价、周期、完整范围或客户专属细节。",
      "优先复用：业务闭环拆解方式、端口结构、AI 融入点、MVP 收敛逻辑和风险提示。",
      "如果后续客户行业不同，应只引用方法论和结构，不把本客户事实写成新客户事实。"
    ])
  };
  const lightweightSolution = {
    "一、项目理解与产品承接": [
      ...directionLines,
      "",
      bullet([
        `承接核心业务闭环：围绕「${pain}」先把关键流程跑通。`,
        "承接用户使用体验：让主要角色清楚、顺畅地完成核心任务。",
        "承接服务流程与业务管理：把配置、审核、协同、跟进和运营管理纳入后台能力。",
        "承接数据记录与运营分析：为后续复盘、优化和经营判断提供基础数据。",
        aiNeeds.length ? `承接 AI 辅助与效率提升能力：重点围绕 ${aiNeeds.join("、")} 落地。` : "承接 AI 辅助与效率提升能力：优先在高频、重复、理解成本高的环节引入 AI。"
      ]),
      supplementSummary ? `补充约束说明：${supplementSummary}` : ""
    ].filter(Boolean).join("\n\n"),
    "二、从当前需求出发，可进一步梳理的产品层次": [
      "### 2.1 核心使用场景",
      "| 核心场景 | 说明 |",
      "|---|---|",
      ...buildLightweightScenarioRows({
        sourceItems: preservedCoreFeatures.length ? preservedCoreFeatures : [customer?.demandDescription || pain, customer?.problemToSolve || pain],
        label: "核心"
      }),
      "",
      "### 2.2 体验增强场景",
      "| 增强场景 | 说明 |",
      "|---|---|",
      ...buildLightweightEnhancementRows(supplementDirections, customer),
      "",
      "### 2.3 软件基础支撑能力",
      "| 支撑能力 | 说明 |",
      "|---|---|",
      "| 权限与角色体系 | 保证不同角色看到合适的页面、数据与操作。 |",
      "| 数据留痕与状态流转 | 支撑业务闭环、复盘和后续自动化能力。 |",
      "| 消息提醒与待办机制 | 确保关键流程节点不遗漏。 |",
      "| 文件资料与内容沉淀 | 便于后续查询、复用和知识积累。 |",
      "",
      "### 2.4 后台管理能力",
      "| 后台能力 | 说明 |",
      "|---|---|",
      "| 基础配置 | 管理业务规则、参数、内容和分类。 |",
      "| 用户与权限管理 | 管理角色、账号和访问范围。 |",
      "| 服务处理与运营支持 | 支撑审核、跟进、处理记录和运营动作。 |",
      "| 数据统计与分析 | 提供业务进度、使用情况和运营表现观察。 |"
    ].join("\n"),
    "三、从核心功能到完整产品：按端口梳理功能结构": [
      "基于贵方当前已提出的核心功能方向，我方从完整产品角度，按不同端口对功能结构进行进一步补充整理。以下内容并不代表一期需要全部建设，而是用于帮助双方先看到完整产品可能形成的功能骨架，后续可结合预算、周期和业务优先级进一步确认一期 MVP 范围。",
      "",
      portSectionMarkdown
    ].join("\n\n"),
    "四、AI 能力在本项目中的适合融入点": [
      "结合当前项目阶段与已有功能结构来看，AI能力不建议作为独立模块强行堆砌，而应围绕各端口中已经存在的高频功能、人工处理成本较高的功能、信息理解门槛较高的功能、服务效率可被提升的功能进行融入。下面基于不同端口和已有功能，初步梳理 AI 可融入的场景方案。",
      "",
      "| 端口 | 关联模块 | 关联功能 | 普通流程 | AI融入方式 | 场景效果 | 建议阶段 |",
      "|---|---|---|---|---|---|---|",
      ...aiRows,
      "",
      "### AI 场景方案说明",
      ...buildLightweightAiNarratives(aiRows)
    ].join("\n"),
    "五、产品结构可先作如下理解": [
      structureBlocks,
      "",
      "这一结构的主要作用，是帮助从当前功能点出发，进一步看到一套完整软件产品通常会形成的骨架。后续可在此基础上继续细化一期范围、功能清单、页面原型、开发排期与报价方案。"
    ].join("\n\n"),
    "六、后续建议确认事项": [
      "1. 一期优先上线的核心业务闭环；",
      "2. 各端口的功能边界；",
      "3. 不同角色的权限范围；",
      "4. 关键业务流程与状态流转；",
      "5. 是否涉及第三方系统、支付、物流、硬件或数据接口；",
      "6. AI能力是否进入一期，以及具体进入哪些功能；",
      "7. 是否需要进一步输出 PRD、原型图、功能清单、开发排期和报价方案。",
      "",
      "收口建议：以上内容主要用于帮助双方先把软件产品的核心结构和阶段方向看清楚。若贵方认可这条产品承接思路，我们建议下一步结合一期目标、端口边界和关键流程，再进一步细化 MVP 范围与输出材料。"
    ].join("\n")
  };

  const pptPagePlan = [
    ["封面页", "建立项目身份和方案调性", `《${projectName}轻量方案》、客户名称、方案定位`, "封面 + 简洁产品感背景"],
    ["项目理解与建设目标", "让客户确认我们理解其业务目标", `围绕「${pain}」说明业务问题、建设目标和系统价值`, "左侧业务理解，右侧目标卡片"],
    ["软件产品整体承接方向", "把需求从功能点转成产品承接方向", "核心业务闭环、用户体验、运营管理、数据沉淀、AI效率提升", "五宫格卡片矩阵"],
    ["当前需求下的产品层次梳理", "帮助客户看见核心场景、增强场景和基础支撑", "核心使用场景、体验增强、软件基础支撑、后台管理能力", "分层架构图"],
    ["核心业务场景与使用路径", "把方案讲成客户能理解的业务路径", `从客户关键动作到平台承接「${pain}」的价值`, "流程图 / 用户路径图"],
    ["按端口梳理的产品功能结构", "展示完整产品骨架而不是散点功能", `${defaultPorts.slice(0, 4).join("、")} 的功能结构`, "端口结构图 + 模块卡片"],
    [`${defaultPorts[0] || "用户端"}功能规划`, "展开最重要使用端的功能结构", "核心功能、基础支撑、体验增强和后续扩展", "功能模块表格"],
    [`${defaultPorts.find((item) => /后台|管理/.test(item)) || "管理后台"}功能规划`, "说明管理、配置、审核、数据和运营能力", "权限、数据、内容、流程、服务处理和分析能力", "后台模块矩阵"],
    ["AI能力融入点与场景方案", "说明 AI 如何围绕已有端口和功能增强价值", "AI辅助理解、推荐、生成、分析、运营判断等场景", "AI场景对比表"],
    ["产品结构骨架与后续深化方向", "把本次轻方案收束成下一步可执行动作", "MVP范围、待确认事项、后续材料输出方向", "路线图 + 行动清单"]
  ];
  const pptPageStructure = pptPagePlan.map(([name, goal, content, visual], index) => [
    `### 第${index + 1}页：【${name}】`,
    `- 页面目标：${goal}`,
    `- 核心内容：${content}`,
    `- 建议呈现形式：${visual}`,
    "- 视觉建议：浅色背景、蓝灰色卡片、清晰标题层级、避免无关大图。",
    "- 备注：不新增未确认大功能，不讲报价、合同和排期。"
  ].join("\n")).join("\n\n");
  const pptPageDetail = pptPagePlan.map(([name, goal, content, visual], index) => [
    `### 第${index + 1}页：【${name}】`,
    `【页面主标题】${name}`,
    `一句话说明：本页用于${goal}。`,
    "",
    "【内容模块一】",
    `- 客户当前关注点：${pain}`,
    `- 已知基础：${customer?.existingSystem || customer?.background || "待确认"}`,
    `- 当前阶段重点：${stageName}`,
    "",
    "【内容模块二】",
    `- 页面内容：${content}`,
    `- 推荐端口：${defaultPorts.slice(0, 3).join("、") || "用户端、管理后台"}`,
    `- AI表达：围绕已有功能做效率、体验、内容生产或运营分析增强。`,
    "",
    "【建议呈现】",
    `适合使用：${visual}。`
  ].join("\n")).join("\n\n");
  const lightweightSolutionPpt = {
    "一、PPT整体定位": [
      `本 PPT 用于 ${customerName} 已完成前期咨询和轻量方案梳理后的售前沟通阶段。`,
      "面向客户业务负责人、项目推动人和内部评审相关人员讲解。",
      "核心目的不是重新写方案，而是把已形成的轻量级方案重组为客户容易理解的页面结构。",
      "客户看完应形成的认知：我们理解业务目标，产品结构清楚，AI 能力围绕真实流程融入，下一步可以继续细化 MVP 范围。"
    ].join("\n"),
    "二、PPT建议风格": bullet([
      "视觉风格：简洁、克制、专业、现代，偏互联网科技公司 / SaaS 产品方案风。",
      "版式风格：大标题 + 卡片矩阵 + 流程图 + 端口结构图，信息层级清晰。",
      "色彩建议：浅色背景、蓝灰色系、低饱和辅助色、轻阴影和圆角卡片。",
      "图形建议：业务流程图、分层架构图、AI场景对比图、端口功能矩阵。",
      "产品示意图建议：可以用低保真产品框架或 SaaS 截图感示意，不使用无关大图。",
      "不建议使用的风格：抽象科技海报、暗黑炫光、复杂 3D、无业务含义的大面积装饰。"
    ]),
    "三、PPT页面结构": pptPageStructure,
    "四、每页详细内容稿": pptPageDetail,
    "五、PPT生成提示词": [
      "```text",
      `请基于「${projectName}」当前客户上下文和上述轻量方案 PPT 结构稿生成 PPTX 文件。`,
      "页面比例为 16:9，风格为互联网科技公司 / SaaS 产品方案风。",
      "背景浅色，留白充足，使用卡片式布局、轻阴影、圆角、蓝灰色系。",
      "页面重点放在标题、产品结构、功能模块、流程图、AI场景对比和产品示意图。",
      "不要生成抽象科技海报，不要使用无关大图。",
      "保持内容完整，不要过度压缩具体功能页。",
      "不讲报价、不讲合同、不讲排期。",
      "生成 PPTX 文件，并返回可预览和下载的结果。",
      "```"
    ].join("\n")
  };

  return shared[section]
    || demand[section]
    || proposal[section]
    || failure[section]
    || consultation[section]
    || nextCommunication[section]
    || solutionDeepening[section]
    || historicalSolutionEntry[section]
    || lightweightSolution[section]
    || lightweightSolutionPpt[section]
    || agent[section]
    || chat[section]
    || summary[section]
    || interactionDrafts[section]
    || interactionImage[section]
    || defaultImage[section]
    || `${generationType} 的「${section}」建议结合客户资料进一步补充。`;
}

function collectLightweightSolutionItems(value = "") {
  return String(value || "")
    .split(/[\n,，;；、]/)
    .map((item) => item.replace(/^[-*•\d.、\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function inferSolutionScenarioNames({ customer, pain, ports = [], preservedCoreFeatures = [], preservedModules = [], limit = 3 }) {
  const candidates = [
    ...preservedCoreFeatures,
    customer?.demandDescription,
    customer?.problemToSolve,
    ...preservedModules,
    ports.some((port) => /设备|硬件|IoT|iot/.test(port)) || /IoT|iot|硬件|设备|手环|传感/.test(`${customer?.customerType || ""}${pain}`) ? "设备/数据接入与状态监控" : "",
    ports.some((port) => /商家|门店/.test(port)) || /商城|商品|订单|商家|门店/.test(`${customer?.customerType || ""}${pain}`) ? "商品/服务提交与审核发布" : "",
    ports.some((port) => /后台|管理/.test(port)) ? "后台运营管理与数据沉淀" : "",
    "核心业务闭环处理"
  ].filter(Boolean);
  return uniqueText(candidates)
    .map((item) => normalizeScenarioName(item, "核心场景"))
    .slice(0, limit);
}

function inferSolutionAiScenarioNames({ customer, pain, ports = [], aiNeeds = [], preservedCoreFeatures = [], limit = 3 }) {
  const text = `${customer?.customerType || ""} ${customer?.demandDescription || ""} ${customer?.problemToSolve || ""} ${pain}`;
  const candidates = [
    ...aiNeeds,
    /资料|文档|知识库|RAG|方案/.test(text) ? "资料解析与知识库问答" : "",
    /数据|监控|看板|统计|分析|IoT|iot|设备|手环/.test(text) ? "数据摘要、异常识别与运营分析" : "",
    /内容|营销|商城|商品|话术|文案/.test(text) ? "内容生成与智能推荐" : "",
    preservedCoreFeatures.length ? `${preservedCoreFeatures[0]}的 AI 辅助` : "",
    ports.some((port) => /后台|管理/.test(port)) ? "后台 AI 运营助手" : "",
    "AI 跟进建议与报告生成"
  ].filter(Boolean);
  return uniqueText(candidates)
    .map((item) => normalizeScenarioName(item, "AI 场景"))
    .slice(0, limit);
}

function normalizeScenarioName(value = "", fallback = "场景") {
  const text = String(value || "")
    .replace(/^客户想要|^客户希望|^需要|^实现/, "")
    .replace(/[。.!！?？；;].*$/, "")
    .trim();
  if (!text) return fallback;
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

function uniqueText(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item || "").replace(/\s+/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildLocalInteractionDraftScreens({ customerName, customer, websiteType, style, extraRequirement, imageCount, defaultDevice = "桌面端", pain }) {
  const baseScreens = [
    {
      title: "产品首页 / 工作台",
      device: "桌面端",
      goal: "让客户第一眼看到系统如何承接核心业务、关键数据和 AI 推荐动作。",
      layout: "桌面端左侧导航、顶部搜索、核心指标卡片、任务/客户列表、AI 建议侧栏。"
    },
    {
      title: "核心业务列表与详情",
      device: "桌面端",
      goal: "展示客户最关心的业务对象如何被统一管理，并能进入详情查看上下文。",
      layout: "列表卡片高度统一，支持筛选、阶段、状态、负责人；详情区展示业务信息、资料、沟通记录和下一步动作。"
    },
    {
      title: "AI 分析与推荐动作",
      device: "桌面端",
      goal: "说明 AI 如何读取上下文，生成策略、问题清单、方案建议和风险提醒。",
      layout: "桌面端为右侧 AI 面板和文档卡片，强调生成历史可归档。"
    },
    {
      title: "资料 / 知识库 / RAG 区",
      device: "桌面端",
      goal: "展示资料上传、解析、切片和作为 AI 上下文引用的流程。",
      layout: "文件列表、解析状态、知识块预览、引用来源标签、检索结果卡片。"
    },
    {
      title: "客户可读方案文档",
      device: "桌面端",
      goal: "把 AI 生成内容展示成适合客户阅读的 Markdown 文档和目录导航。",
      layout: "左侧目录、右侧正文、顶部复制/导出/同步按钮，正文含表格、流程图和图片占位。"
    },
    {
      title: "移动端关键路径",
      device: "移动端",
      goal: "验证移动场景下能快速查看摘要、执行动作和跟进客户。",
      layout: "顶部客户信息、阶段标签、关键 CTA、AI 推荐动作、最近跟进卡片、资料入口。"
    },
    {
      title: "运营数据与效果复盘",
      device: "桌面端",
      goal: "体现业务闭环和后续运营判断，不只是静态功能展示。",
      layout: "趋势图、漏斗、任务完成度、AI 建议采纳情况、风险预警和复盘卡片。"
    },
    {
      title: "多端协同结构",
      device: "响应式画板",
      goal: "展示用户端、管理端、员工端/商家端之间的协同关系。",
      layout: "中心业务流 + 多端卡片矩阵 + AI 能力穿插节点，适合放入售前 PPT。"
    }
  ];

  return baseScreens.slice(0, imageCount).map((screen, index) => ({
    id: `screen_${index + 1}`,
    ...screen,
    device: normalizeInteractionDevice(screen.device),
    prompt: [
      `为「${customerName}」生成第 ${index + 1} 张高保真产品交互设计图：${screen.title}。`,
      `项目类型：${websiteType || customer?.customerType || "企业级软件系统"}。视觉风格：${style || "简洁专业 SaaS 风格"}。`,
      `客户需求：${customer?.demandDescription || pain}`,
      `业务背景：${customer?.background || "待确认"}`,
      `核心问题：${customer?.problemToSolve || pain}`,
      `页面目标：${screen.goal}`,
      `页面布局：${screen.layout}`,
      `设备呈现：${buildInteractionDeviceInstruction(screen.device)}`,
      "画面必须具备真实产品截图质感，中文 UI 文案清晰，信息层级稳定，卡片高度统一，留白克制。",
      "请避免抽象科技海报、无意义大图、错误中文、杂乱仪表盘、过度炫光和与业务无关的元素。",
      `额外要求：${extraRequirement || "无"}`
    ].join("\n")
  }));
}

function normalizeInteractionDevice(value = "") {
  const text = String(value || "").trim();
  if (/响应式|画板|多端/i.test(text)) return "响应式画板";
  if (/双端|桌面.*移动|移动.*桌面|pc.*mobile|mobile.*pc|电脑.*手机|手机.*电脑/i.test(text)) return "桌面端 + 移动端";
  if (/手机|移动|mobile|小程序|app/i.test(text)) return "移动端";
  return "桌面端";
}

function buildInteractionDeviceInstruction(device = "桌面端") {
  const normalizedDevice = normalizeInteractionDevice(device);
  if (normalizedDevice === "移动端") return "仅生成手机端 / 移动端界面，使用手机框或移动端画布，重点呈现移动端关键路径；不要额外生成电脑框。";
  if (normalizedDevice === "桌面端 + 移动端") return "同时生成桌面端电脑框与手机端框，二者展示同一产品的响应式关键界面。";
  if (normalizedDevice === "响应式画板") return "生成响应式画板，可包含桌面、平板、手机等多端对比，但信息层级必须清晰。";
  return "仅生成桌面端 / PC 端界面，使用电脑框或宽屏 Web 产品画布；不要额外生成手机框。";
}

function parseLightweightSolutionPorts(value = "") {
  const ports = collectLightweightSolutionItems(value)
    .map((item) => item.replace(/端口|范围|：|:/g, "").trim())
    .filter(Boolean);
  return Array.from(new Set(ports)).slice(0, 6);
}

function inferDefaultSolutionPorts(customer) {
  const text = `${customer?.customerType || ""} ${customer?.demandDescription || ""} ${customer?.background || ""} ${customer?.problemToSolve || ""}`;
  const ports = ["用户端", "管理后台"];
  if (/商家|门店|店铺|渠道|加盟/.test(text)) ports.splice(1, 0, "商家端");
  if (/员工|内部|销售|客服|运营|老师|教师|顾问/.test(text)) ports.splice(1, 0, "员工端");
  if (/学生|学员/.test(text)) ports.splice(1, 0, "学生端");
  if (/家长/.test(text)) ports.splice(1, 0, "家长端");
  if (/设备|硬件|IoT|iot|传感器|手环/.test(text)) ports.splice(1, 0, "设备端");
  if (/小程序|App|APP|移动/.test(text) && !ports.includes("移动端")) ports.unshift("移动端");
  return Array.from(new Set(ports)).slice(0, 5);
}

function buildLightweightScenarioRows({ sourceItems, label }) {
  const items = ensureArray(sourceItems).filter(Boolean).slice(0, 4);
  const rows = items.length ? items : ["核心业务闭环", "关键用户操作", "业务管理流程"];
  return rows.map((item) => `| ${safeTableCell(`${label}场景：${limitText(item, 28)}`)} | 用户围绕「${safeTableCell(limitText(item, 70))}」完成关键动作，平台承接流程记录、状态管理和后续服务。 |`);
}

function buildLightweightEnhancementRows(supplementDirections, customer) {
  const items = supplementDirections.length
    ? supplementDirections
    : ["消息提醒与待办", "资料沉淀与查询", "数据看板与运营分析", customer?.customerType?.includes("AI") ? "AI 辅助体验" : "后续扩展能力"];
  return items.slice(0, 4).map((item) => `| ${safeTableCell(limitText(item, 34))} | 该方向不一定作为一期必做，但有助于提升产品体验、服务深度和后续转化效率。 |`);
}

function buildLightweightPortSection({ index, port, customer, preservedModules, preservedCoreFeatures, supplementDirections }) {
  const { audience, goal } = inferPortAudienceGoal(port, customer);
  const coreRows = (preservedCoreFeatures.length ? preservedCoreFeatures : [customer?.demandDescription || customer?.problemToSolve || "核心业务流程"])
    .slice(0, 4)
    .map((feature) => ["核心业务", feature, `承接已确认的核心需求「${feature}」，用于跑通主要业务闭环。`, "核心功能"]);
  const moduleRows = preservedModules.slice(0, 5)
    .map((module) => ["基础模块", module, `保留销售补充的基础功能模块「${module}」，后续再确认一期边界。`, "基础支撑"]);
  const defaultRows = inferPortDefaultRows(port, supplementDirections);
  const rows = [...coreRows, ...moduleRows, ...defaultRows].slice(0, 10);

  return [
    `### 3.${index} ${port}功能结构`,
    "",
    `该端口主要面向${audience}，用于承接${goal}。`,
    "",
    "| 模块 | 功能 | 功能描述 | 功能类型 |",
    "|---|---|---|---|",
    ...rows.map(([module, feature, desc, type]) => `| ${safeTableCell(module)} | ${safeTableCell(limitText(feature, 42))} | ${safeTableCell(limitText(desc, 90))} | ${type} |`)
  ].join("\n");
}

function inferPortAudienceGoal(port, customer) {
  if (/后台|管理/.test(port)) return { audience: "运营、管理和业务配置人员", goal: "业务配置、数据管理、审核处理、权限控制和运营分析" };
  if (/商家|门店/.test(port)) return { audience: "商家、门店或渠道角色", goal: "门店/商家侧业务处理、内容维护、订单或服务协同" };
  if (/员工|内部|销售|客服|教师|老师/.test(port)) return { audience: "内部员工或服务人员", goal: "日常工作处理、客户服务、任务跟进和资料协同" };
  if (/设备|硬件|IoT|iot/.test(port)) return { audience: "设备、硬件或运维角色", goal: "设备接入、状态监控、数据采集和异常处理" };
  if (/学生|学员/.test(port)) return { audience: "学生或学习用户", goal: "学习使用路径、任务完成、反馈互动和个人中心" };
  if (/家长/.test(port)) return { audience: "家长角色", goal: "查看进度、接收通知、反馈沟通和服务确认" };
  if (/移动|App|小程序/.test(port)) return { audience: "移动端用户", goal: "轻量访问、核心操作、消息提醒和个人中心" };
  return { audience: `${customer?.customerType || "业务"}用户`, goal: "核心使用路径、服务体验、个人中心和反馈闭环" };
}

function inferPortDefaultRows(port, supplementDirections) {
  const extra = supplementDirections.slice(0, 2).map((item) => ["AI补充建议", item, `作为完整产品骨架的补充方向，建议后续结合预算和优先级确认是否进入一期。`, "后续扩展"]);
  if (/后台|管理/.test(port)) {
    return [
      ["运营管理", "数据看板", "查看关键业务数据、进度状态和运营表现。", "运营管理"],
      ["权限管理", "角色与权限配置", "管理不同角色的访问范围、操作权限和数据边界。", "基础支撑"],
      ["内容配置", "基础资料维护", "维护分类、标签、规则、文案和业务配置。", "基础支撑"],
      ["服务处理", "审核与状态流转", "支撑业务审核、处理记录、状态推进和异常留痕。", "运营管理"],
      ...extra
    ];
  }
  if (/商家|门店/.test(port)) {
    return [
      ["业务处理", "任务/订单处理", "处理日常业务任务、订单或服务请求。", "核心功能"],
      ["内容维护", "商品/服务资料维护", "维护面向用户展示或业务处理所需的基础资料。", "运营管理"],
      ["消息协同", "通知与待办", "接收平台通知、处理待办事项。", "体验增强"],
      ...extra
    ];
  }
  if (/员工|内部|销售|客服|教师|老师/.test(port)) {
    return [
      ["工作台", "任务待办", "集中查看待处理任务、客户事项或服务进度。", "核心功能"],
      ["资料协同", "客户/业务资料查看", "查看当前业务对象的资料、记录和历史沟通。", "基础支撑"],
      ["服务记录", "处理记录与备注", "沉淀服务过程，便于团队协作和复盘。", "运营管理"],
      ...extra
    ];
  }
  if (/设备|硬件|IoT|iot/.test(port)) {
    return [
      ["设备接入", "设备绑定与管理", "管理设备基础信息、绑定关系和使用状态。", "核心功能"],
      ["数据采集", "状态与数据上报", "采集设备关键数据，为监控和分析提供基础。", "基础支撑"],
      ["异常处理", "告警与记录", "识别异常状态并形成处理记录。", "运营管理"],
      ...extra
    ];
  }
  return [
    ["首页入口", "核心服务入口", "让用户快速进入当前项目最核心的业务场景。", "核心功能"],
    ["流程操作", "业务表单/任务提交", "支撑用户完成关键业务动作并形成记录。", "核心功能"],
    ["个人中心", "资料与历史记录", "查看个人资料、历史记录、消息和反馈。", "基础支撑"],
    ["体验增强", "消息提醒与帮助反馈", "降低用户使用门槛，提高服务响应效率。", "体验增强"],
    ...extra
  ];
}

function buildLightweightAiRows({ ports, preservedModules, preservedCoreFeatures, aiNeeds, supplementDirections }) {
  const firstPort = ports[0] || "用户端";
  const adminPort = ports.find((port) => /后台|管理/.test(port)) || "管理后台";
  const coreFeature = preservedCoreFeatures[0] || preservedModules[0] || "核心业务流程";
  const aiNeed = aiNeeds[0] || "内容生成/信息理解/智能推荐";
  return [
    `| ${safeTableCell(firstPort)} | 核心业务 | ${safeTableCell(limitText(coreFeature, 32))} | 用户按页面流程提交、查询或完成业务操作 | AI 辅助理解信息、生成建议或减少重复填写 | 降低使用门槛，提高关键流程完成效率 | 一期可简化支持 |`,
    `| ${safeTableCell(adminPort)} | 运营管理 | 数据看板 | 运营人员人工查看数据并总结问题 | AI 对关键数据、异常和趋势做摘要提示 | 提升运营判断效率，帮助管理人员快速抓重点 | 二期增强 |`,
    `| ${safeTableCell(adminPort)} | 资料管理 | 文档/资料沉淀 | 人工上传、整理和检索资料 | AI 解析资料、提取要点并支持后续检索 | 提升资料复用效率，为后续知识库/RAG 打基础 | 一期建议建设 |`,
    `| ${safeTableCell(firstPort)} | 服务体验 | 消息/反馈 | 用户主动反馈或等待人工处理 | AI 辅助分类、总结反馈并推荐处理方向 | 缩短响应时间，提高服务体验 | 二期增强 |`,
    `| ${safeTableCell(ports[1] || adminPort)} | AI补充建议 | ${safeTableCell(limitText(aiNeed, 28))} | 当前依赖人工判断或人工生产内容 | 围绕已有功能加入 AI 辅助，不单独堆砌 AI 模块 | 让 AI 与业务流程产生实际关联 | ${supplementDirections.length ? "一期可简化支持" : "长期规划"} |`
  ];
}

function inferPortStructureModules({ port, preservedModules, preservedCoreFeatures, supplementDirections }) {
  const preserved = [...preservedCoreFeatures, ...preservedModules].slice(0, 4);
  const extra = supplementDirections.slice(0, 2).map((item) => `后续扩展建议：${item}`);
  if (/后台|管理/.test(port)) {
    return [...preserved, "数据看板", "角色与权限", "业务配置", "审核与状态流转", ...extra];
  }
  if (/商家|门店/.test(port)) {
    return [...preserved, "商家工作台", "业务处理", "内容维护", "消息待办", ...extra];
  }
  if (/员工|内部|销售|客服|教师|老师/.test(port)) {
    return [...preserved, "员工工作台", "任务待办", "资料查看", "处理记录", ...extra];
  }
  if (/设备|硬件|IoT|iot/.test(port)) {
    return [...preserved, "设备管理", "数据上报", "状态监控", "异常告警", ...extra];
  }
  if (/学生|学员/.test(port)) {
    return [...preserved, "学习首页", "任务列表", "进度记录", "消息反馈", ...extra];
  }
  if (/家长/.test(port)) {
    return [...preserved, "进度查看", "消息通知", "反馈沟通", "服务记录", ...extra];
  }
  return [...preserved, "首页入口", "核心业务操作", "个人中心", "消息提醒", "帮助反馈", ...extra];
}

function buildLightweightAiNarratives(rows) {
  const names = ["场景一：核心流程 AI 辅助", "场景二：资料解析与知识沉淀", "场景三：运营数据摘要", "场景四：服务反馈辅助"];
  return names.slice(0, 4).map((name, index) => [
    "",
    `#### ${name}`,
    "",
    "- 原有流程：由用户或运营人员人工填写、整理、查询或判断。",
    "- AI 融入后：AI 在已有功能旁提供摘要、建议、生成、分类或检索辅助。",
    "- 对用户/业务的价值：减少重复劳动，降低理解成本，让关键流程更容易被持续使用。",
    `- 落地建议：${index === 0 ? "一期可先做简化支持，避免过度承诺复杂自动化。" : "建议在核心业务流程稳定后逐步增强。"}`
  ].join("\n")).join("\n");
}

function safeTableCell(value = "") {
  return String(value || "待确认").replace(/\|/g, "/").replace(/\s+/g, " ").trim() || "待确认";
}

function inferGlobalIntent(message, skill) {
  const text = `${message || ""} ${skill?.name || ""} ${skill?.description || ""}`;
  const intents = [];
  if (/任务|计划|拆解|roadmap|里程碑|排期|执行/.test(text)) intents.push("任务规划");
  if (/意图|策略|路由|agent|工作流|编排/.test(text)) intents.push("意图策略");
  if (/知识库|RAG|资料|案例|引用|文档/.test(text)) intents.push("RAG 检索");
  if (/skill|技能|提示词|prompt/.test(text)) intents.push("Skill/提示词编排");
  if (/图|图片|生图|image2|交互图|海报|视觉|界面/.test(text)) intents.push("image2 生图");
  return `识别到的默认工作台意图：${intents.length ? intents.join("、") : "通用策略咨询"}。当前 Skill：${skill?.name || "自动路由 Skill"}。`;
}

function buildDefaultImagePromptText(message, extraContext = {}) {
  const style = extraContext?.imageStyle || "高端简洁、企业级 SaaS、清晰层级";
  const imageType = extraContext?.imageType || "概念视觉稿";
  return [
    `生成一张${imageType}，主题：${message || "AI CRM 默认工作台"}。`,
    `视觉风格：${style}。`,
    "画面应清晰表达核心信息，使用真实产品级构图、中文界面文案、克制留白和高级质感。",
    "如果是系统界面或交互图，请展示桌面端主界面、关键卡片、AI 分析/任务规划/RAG/Skill 编排入口。",
    "如果是市场物料，请展示主标题、副标题、关键卖点、行动号召和适合传播的视觉中心。",
    "输出适合用于内部方案、售前展示、市场物料或产品概念说明。"
  ].join("\n");
}

function bullet(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function firstUseful(values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function formatMoney(value) {
  const amount = Number(value || 0);
  if (!amount) return "未填写";
  if (amount >= 10000) return `${Math.round(amount / 10000)} 万`;
  return `${amount} 元`;
}

function formatDateTime(value) {
  if (!value) return "未填写";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
