export const AGENT_TOOL_REGISTRY = [
  {
    name: "crm.searchCustomers",
    category: "crm",
    mode: "sync",
    description: "按客户名称、联系人、阶段、需求和当前用户范围检索客户。"
  },
  {
    name: "crm.getCustomerContext",
    category: "crm",
    mode: "sync",
    description: "读取单个客户的档案、跟进、资料、记忆和历史生成。"
  },
  {
    name: "rag.search",
    category: "retrieval",
    mode: "sync",
    description: "检索内部知识库、历史方案、案例和资料片段。"
  },
  {
    name: "web.search",
    category: "retrieval",
    mode: "sync",
    description: "检索公开网页、公司名单、政策、新闻和行业资料。"
  },
  {
    name: "skill.execute",
    category: "skill",
    mode: "sync",
    description: "按 Skill manifest、提示词、知识库绑定和输出格式执行任务。"
  },
  {
    name: "file.parse",
    category: "context",
    mode: "sync",
    description: "解析用户上传文件，把文本内容作为对话上下文。"
  },
  {
    name: "image2.generate",
    category: "media",
    mode: "background",
    description: "提交 image2 图片生成或交互图任务。"
  },
  {
    name: "ppt.generate",
    category: "document",
    mode: "background",
    description: "调用 PPT Skill 服务生成演示文稿。"
  },
  {
    name: "feishu.createDoc",
    category: "sync",
    mode: "background",
    description: "将最终文档同步到飞书 Wiki 或文档空间。"
  }
];

export function resolveAgentTools({ routing = {}, policy = {} } = {}) {
  const requested = new Set(routing.tools || []);
  if (policy.shouldReadCustomerContext) requested.add("crm.getCustomerContext");
  if (policy.shouldUseSkill) requested.add("skill.execute");
  if (policy.shouldUseRag) requested.add("rag.search");
  if (policy.shouldUseWeb) requested.add("web.search");
  if (routing.intent === "file_analysis") requested.add("file.parse");
  if (routing.intent === "image_generation") requested.add("image2.generate");
  if (routing.intent === "ppt_generation") requested.add("ppt.generate");

  return AGENT_TOOL_REGISTRY
    .filter((tool) => requested.has(tool.name))
    .map((tool) => ({
      ...tool,
      status: tool.mode === "background" ? "queued" : "ready"
    }));
}
