const app = document.querySelector("#app");
const SESSION_KEY = "jimu-ai-crm-session";
const CHAT_SESSION_KEY = "jimu-ai-crm-chat-sessions";
let toastTimer = null;
let searchTimer = null;
let tableRenderFrame = null;
let chatRenderFrame = null;
let chatScrollFrame = null;
let helpCenterPollTimer = null;
let activeChatAbortController = null;
const helpCenterNoticeTimers = new Map();
const KNOWLEDGE_UPLOAD_LIMIT_BYTES = 500 * 1024 * 1024;
const CHAT_ATTACHMENT_LIMIT_BYTES = 8 * 1024 * 1024;
const CHAT_ATTACHMENT_MAX_FILES = 6;
const IMAGE_JOB_POLL_INTERVAL_MS = 4000;
const HELP_CENTER_POLL_INTERVAL_MS = 4000;

const pageSizes = {
  customers: 10,
  chatSessions: 4,
  chatHistory: 4,
  follows: 4,
  history: 6,
  files: 6,
  settings: 8
};

const buttonLoadingActions = new Set([
  "refresh-data",
  "delete-customer",
  "delete-setting",
  "test-model",
  "set-customer-stage",
  "sync-history-feishu",
  "add-customer-to-solution-library",
  "confirm-save-chat-solution",
  "generate-ppt-from-outline"
]);

const navItems = [
  ["customers", "客户"],
  ["detail", "详情"],
  ["ai", "AI 对话"],
  ["settings", "系统设置"]
];

const stageFilters = [
  ["", "全部阶段"],
  ["initial_contact", "初步接触"],
  ["demand_communication", "需求沟通"],
  ["demand_deepening", "需求深化"],
  ["proposal", "方案制作"],
  ["business", "商务推进"],
  ["contract", "合同推进"],
  ["won", "已成交"],
  ["paused", "暂缓"],
  ["lost", "失败"]
];

const statusOptions = ["跟进中", "暂缓", "已成交", "失败"];
const sourceOptions = ["官网", "转介绍", "老客户", "广告", "线下", "其他"];
const typeOptions = ["AI应用", "业务系统", "业务系统+AI", "IoT+AI", "企业内部AI", "其他"];
const probabilityOptions = ["高", "中", "低"];
const followMethods = ["微信", "电话", "会议", "线下", "邮件"];
const failureReasons = ["预算不足", "需求不明确", "客户内部未达成共识", "客户没有真实采购意向", "项目暂缓", "已选择其他供应商", "觉得报价过高", "觉得方案不匹配", "决策人未参与", "跟进不及时", "方案表达不足", "商务推进失败", "其他"];
const interactionStyles = ["飞书风", "高端极简", "简洁商务", "科技感", "轻拟物", "数据可视化", "温暖咨询感"];
const websiteTypes = ["SaaS后台", "CRM系统", "企业官网", "营销落地页", "移动端小程序", "数据大屏", "IoT控制台", "企业内部AI助手", "项目管理系统"];
const interactionStyleOptions = [["__auto", "跳过，AI自动判断"], ...interactionStyles, ["__custom", "自主填写"]];
const websiteTypeOptions = [["__auto", "跳过，AI自动判断"], ...websiteTypes, ["__custom", "自主填写"]];
const interactionDeviceOptions = [
  ["桌面端", "仅桌面端 / PC"],
  ["移动端", "仅手机端"],
  ["桌面端 + 移动端", "桌面端 + 手机端"],
  ["响应式画板", "响应式画板"]
];
const interactionImageCountOptions = [1, 2, 3, 4, 5, 6, 8].map((count) => [count, `${count} 张`]);

const settingTabs = [
  ["stages", "客户阶段"],
  ["skills", "Skill"],
  ["promptTemplates", "阶段提示词"],
  ["models", "模型"],
  ["knowledgeBases", "知识库"],
  ["users", "员工"],
  ["reportFeedbacks", "报告反馈"]
];

const generationTypes = {
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

const defaultAiScenes = [
  {
    key: "router",
    title: "Router 意图识别",
    desc: "先判断用户要策略、RAG、Skill、生图还是组合任务"
  },
  {
    key: "planner",
    title: "Planner 任务规划",
    desc: "把目标拆成步骤、依赖、产物、风险和验收标准"
  },
  {
    key: "scheduler",
    title: "Scheduler 调度器",
    desc: "按意图自动决定是否调用知识库、联网、Skill 或 image2"
  },
  {
    key: "executor",
    title: "Executor 执行器",
    desc: "组合 RAG 命中、联网结果、Skill 输出并生成完整回答"
  },
  {
    key: "reflector",
    title: "Reflector 校验器",
    desc: "检查假设、缺失信息、引用来源和下一步动作"
  }
];

const collectionLabels = {
  stages: "客户阶段",
  skills: "Skill",
  promptTemplates: "阶段提示词",
  models: "模型",
  knowledgeBases: "知识库",
  users: "员工",
  reportFeedbacks: "报告反馈"
};

const state = {
  user: null,
  token: "",
  db: null,
  view: "customers",
  detailTab: "overview",
  settingsTab: "stages",
  selectedCustomerId: "",
  aiCustomerId: "",
  aiSkillId: "",
  chatSkillExplicit: false,
  chatToolMode: "",
  aiChatPanelOpen: false,
  aiChatPanelMode: "customer",
  chatPauseRequested: false,
  chatSessionId: "",
  selectedHistoryId: "",
  selectedHelpRecordId: "",
  documentRoute: null,
  filters: {
    keyword: "",
    stage: "",
    status: "",
    type: "",
    source: "",
    ownerId: ""
  },
  modal: null,
  toast: "",
  busy: "",
  lastLoadedAt: "",
  chatByCustomer: {},
  pages: {},
  editingHistoryId: "",
  aiControlCollapsed: true,
  textDetails: {},
  pendingImageJobs: {},
  helpCenterTaskStatuses: {},
  helpCenterNotices: [],
  helpCenterOpen: false,
  chatSessions: {},
  chatAttachments: [],
  saveChatSolutionKeyword: "",
  interactionImageDrafts: {}
};

app.addEventListener("click", handleClick);
app.addEventListener("submit", handleSubmit);
app.addEventListener("input", handleInput);
app.addEventListener("change", handleChange);
app.addEventListener("paste", handleAppPaste);
app.addEventListener("dragover", handleAppDragOver);
app.addEventListener("drop", handleAppDrop);
document.addEventListener("click", handleDocumentClick);

init();

async function init() {
  const session = readSession();
  if (session?.user) {
    state.user = session.user;
    state.token = session.token || "";
    state.chatSessions = readChatSessions();
    try {
      await loadBootstrap();
      ensureChatSessionState();
      render();
      return;
    } catch (error) {
      localStorage.removeItem(SESSION_KEY);
      state.user = null;
      state.token = "";
      state.db = null;
      state.chatSessions = {};
      state.toast = error.message;
    }
  }
  render();
}

async function loadBootstrap() {
  const data = await getJson("/api/crm/bootstrap");
  state.db = data.db;
  state.lastLoadedAt = new Date().toISOString();
  const selectedExists = state.db.customers.some((item) => item.id === state.selectedCustomerId);
  if (!state.selectedCustomerId || !selectedExists) {
    state.selectedCustomerId = state.db.customers[0]?.id || "";
  }
  hydratePendingImageJobs();
  ensureChatSessionState();
}

function hydratePendingImageJobs() {
  if (!state.db) return;
  const helpItems = getHelpCenterItems();
  for (const item of helpItems) {
    if (item.status === "generating") {
      state.pendingImageJobs[item.key] = state.pendingImageJobs[item.key] || "generating";
      state.helpCenterTaskStatuses[item.key] = state.helpCenterTaskStatuses[item.key] || item.status;
    }
  }
  if (Object.keys(state.pendingImageJobs).length) startImageJobPolling();
}

function render() {
  document.body.classList.toggle("modalOpen", Boolean(state.modal));
  if (!state.user || !state.db) {
    renderLogin();
    return;
  }
  if (state.documentRoute) {
    app.className = "appShell documentAppShell";
    app.innerHTML = renderDocumentRoute();
    return;
  }

  if (!isAdmin() && state.view === "settings") {
    state.view = "customers";
  }

  const currentCustomer = getSelectedCustomer();
  state.textDetails = {};
  app.className = `appShell view-${state.view}`;
  app.innerHTML = `
    ${renderSidebar()}
    <main class="mainStage">
      ${renderTopbar(currentCustomer)}
      ${renderCurrentView()}
    </main>
    ${renderHelpCenterNotifications()}
    ${state.modal ? renderModal(state.modal) : ""}
  `;
  if (state.view === "ai") queueChatScrollToBottom();
  if (state.view === "detail") queueDetailActivePaneScroll();
  queueSaveChatSolutionFocusRestore();
}

function queueSaveChatSolutionFocusRestore() {
  if (state.modal?.type !== "saveChatSolution") return;
  window.requestAnimationFrame(() => {
    const input = document.querySelector("#saveChatSolutionSearch");
    if (!input || document.activeElement === input) return;
    input.focus({ preventScroll: true });
    const position = String(input.value || "").length;
    input.setSelectionRange?.(position, position);
  });
}

function queueDetailActivePaneScroll() {
  window.requestAnimationFrame(() => {
    const pane = document.querySelector(".historyPreview, .detailMainWide, .detailMain");
    if (pane) pane.scrollTop = 0;
  });
}

function scrollPageToTop() {
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    const main = document.querySelector(".mainStage");
    if (main) {
      main.scrollTop = 0;
      main.scrollLeft = 0;
    }
  });
}

function renderLogin() {
  document.body.classList.remove("modalOpen");
  app.className = "loginShell";
  app.innerHTML = `
    <section class="loginHero">
      <div class="loginBrand">
        <img class="brandLogo brandLogo--wordmark" src="/logo.png" alt="积木创意" draggable="false">
        <span>Jimu AI CRM</span>
      </div>
      <h1>把客户跟进、售前方案和失败复盘沉淀成团队能力</h1>
      <p>面向积木科技市场、销售、产品和售前成员的内部 AI CRM。第一期先跑通客户档案、跟进记录、AI 策略生成、方案大纲和 Skill 配置。</p>
      <div class="loginPreview">
        <div>
          <strong>9</strong>
          <span>默认客户阶段</span>
        </div>
        <div>
          <strong>10</strong>
          <span>内置售前 Skill</span>
        </div>
        <div>
          <strong>2</strong>
          <span>简单内部角色</span>
        </div>
      </div>
    </section>
    <section class="loginCard">
      <div class="sectionKicker">内部登录</div>
      <h2>进入工作台</h2>
      <form id="loginForm">
        <label>
          邮箱
          <input name="email" type="email" autocomplete="username" required>
        </label>
        <label>
          密码
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <button class="primaryButton fullButton" type="submit">登录</button>
      </form>
      <div class="formMessage ${state.toast ? "error" : "reserved"}">${state.toast ? escapeHtml(state.toast) : "&nbsp;"}</div>
    </section>
  `;
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="sidebarBrand">
        <img class="brandLogo brandLogo--icon" src="/logo-icon.png" alt="" aria-hidden="true" draggable="false">
        <div>
          <strong>Jimu AI CRM</strong>
          <span>积木科技</span>
        </div>
        <button class="sidebarMenu" type="button" aria-label="菜单">☰</button>
      </div>
      <nav class="sideNav">
        ${getVisibleNavItems().map(([view, label]) => `
          <button class="${state.view === view ? "active" : ""}" type="button" data-action="switch-view" data-view="${view}">
            ${renderNavIcon(view)}
            <span>${escapeHtml(label)}</span>
          </button>
        `).join("")}
      </nav>
      <div class="sidebarFoot">
        <button type="button" data-action="logout">退出登录</button>
      </div>
    </aside>
  `;
}

function renderNavIcon(view) {
  const icons = {
    customers: `<path d="M8 10.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M2.5 15.5c.8-2.6 2.7-4 5.5-4s4.7 1.4 5.5 4"/><path d="M13.5 7.5h4"/><path d="M15.5 5.5v4"/>`,
    detail: `<path d="M4 3.5h8.5L16 7v7.5H4v-11Z"/><path d="M12.5 3.5V7H16"/><path d="M6.5 9h7"/><path d="M6.5 12h5"/>`,
    ai: `<path d="M5 5.5h10v7H9l-3.5 3v-3H5v-7Z"/><path d="M8 8.5h.01"/><path d="M10 8.5h.01"/><path d="M12 8.5h.01"/>`,
    settings: `<path d="M9.5 2.8 11 4l1.9-.3 1.1 1.9-1.2 1.5c.1.3.1.6.1.9s0 .6-.1.9L14 10.4l-1.1 1.9L11 12l-1.5 1.2h-2L6 12l-1.9.3L3 10.4l1.2-1.5A4.3 4.3 0 0 1 4.1 8c0-.3 0-.6.1-.9L3 5.6l1.1-1.9L6 4l1.5-1.2h2Z"/><path d="M8.5 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/>`
  };
  return `
    <svg class="navIcon" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      ${icons[view] || icons.customers}
    </svg>
  `;
}

function renderTopbar(customer) {
  const refreshedAt = state.lastLoadedAt ? new Date(state.lastLoadedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "刚刚";
  const currentViewLabel = getVisibleNavItems().find(([view]) => view === state.view)?.[1] || "客户工作台首页";
  const helpCount = getHelpCenterBadgeCount();
  return `
    <header class="topbar globalTopbar">
      <div class="topSearch">
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="9" cy="9" r="5.5"></circle>
          <path d="m13.2 13.2 3.1 3.1"></path>
        </svg>
        <input id="globalSearch" value="${escapeAttr(state.filters.keyword)}" placeholder="搜索客户 / 项目 / 方案">
      </div>
      <div class="topActions">
        <button class="topAssistant" type="button" data-action="switch-view" data-view="ai">AI 助手</button>
        <button class="topIconButton" type="button" data-action="open-help-center" aria-label="打开帮助中心">
          ${helpCount ? `<span class="notificationDot">${helpCount}</span>` : ""}
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M10 3.5a4.8 4.8 0 0 0-4.8 4.8v2.4L4 13h12l-1.2-2.3V8.3A4.8 4.8 0 0 0 10 3.5Z"></path>
            <path d="M8.4 15.2a1.8 1.8 0 0 0 3.2 0"></path>
          </svg>
        </button>
        <button class="helpCenter ${state.modal?.type === "helpCenter" ? "active" : ""}" type="button" data-action="open-help-center" aria-expanded="${state.modal?.type === "helpCenter" ? "true" : "false"}">帮助中心${helpCount ? ` · ${helpCount}` : ""}</button>
        <span class="refreshMeta">${escapeHtml(currentViewLabel)} · ${escapeHtml(refreshedAt)}</span>
      </div>
    </header>
  `;
}

function renderCurrentView() {
  if (state.view === "detail") return renderDetailView();
  if (state.view === "ai") return renderAiView();
  if (state.view === "settings") return renderSettingsView();
  return renderCustomersView();
}

function renderCustomersView() {
  const customers = getFilteredCustomers();
  const pagination = paginateItems(customers, "customers");
  const stats = getCustomerStats();
  return `
    <section class="contentBand compactStats homeStats">
      ${stats.map((item, index) => `
        <article class="metricCard workbenchMetric metricTone${index + 1}">
          <div class="metricIcon">${escapeHtml(item.icon || item.label.slice(0, 1))}</div>
          <div>
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <em>${escapeHtml(item.note)}</em>
          </div>
        </article>
      `).join("")}
    </section>

    <section class="contentBand customerListOnly restoredCustomerHome">
      <div class="listHeader">
        <div>
          <div class="sectionKicker">AI CRM 工作台</div>
          <h2>客户列表</h2>
          <p>所有客户信息内部可见，点击客户进入详情后再查看上下文、生成策略和历史记录。</p>
        </div>
        <div class="listHeaderActions">
          <div class="listCount">
            <strong id="customerResultCount">${customers.length}</strong>
            <span>个匹配客户</span>
          </div>
          <button class="primaryButton" type="button" data-action="open-customer-modal">新增客户</button>
        </div>
      </div>
      <div class="toolbar">
        <div class="searchBox">
          <input id="customerSearch" value="${escapeAttr(state.filters.keyword)}" placeholder="搜索客户、联系人、下一步动作">
        </div>
        ${renderSelect("filter-stage", stageFilters, state.filters.stage)}
        ${renderSelect("filter-status", [["", "全部状态"], ...statusOptions.map((item) => [item, item])], state.filters.status)}
        ${renderSelect("filter-type", [["", "全部类型"], ...typeOptions.map((item) => [item, item])], state.filters.type)}
        ${renderSelect("filter-source", [["", "全部来源"], ...sourceOptions.map((item) => [item, item])], state.filters.source)}
        ${renderSelect("filter-owner", [["", "全部销售"], ...state.db.users.map((item) => [item.id, item.name])], state.filters.ownerId)}
      </div>
      <div class="tableWrap">
        <table class="dataTable">
          <thead>
            <tr>
              <th>客户</th>
              <th>阶段</th>
              <th>状态</th>
              <th>销售人员</th>
              <th>最近跟进</th>
              <th>下一步动作</th>
              <th>预计金额</th>
            </tr>
          </thead>
          <tbody id="customerTableBody">
            ${pagination.items.map(renderCustomerRow).join("") || renderEmptyRow("暂无客户，先新增一个客户档案。", 7)}
          </tbody>
        </table>
      </div>
      <div id="customerPager">${renderPaginationControls("customers", pagination)}</div>
    </section>
  `;
}

function renderCustomerWorkbenchCard(customer) {
  const scoreDots = getCustomerScoreDots(customer);
  return `
    <button class="customerWorkbenchCard ${customer.id === state.selectedCustomerId ? "selected" : ""}" type="button" data-action="open-customer" data-id="${customer.id}">
      <span class="customerLogo">${escapeHtml(customer.name.slice(0, 1))}</span>
      <span class="customerCardMain">
        <strong>${escapeHtml(customer.name)}</strong>
        <small>${escapeHtml(customer.demandDescription || customer.customerType || "客户需求待补充")}</small>
        <em>负责人：${escapeHtml(getUserName(customer.ownerId))}</em>
      </span>
      <span class="customerCardStatus">
        <i>${escapeHtml(getStageName(customer.stage))}</i>
        <b>${scoreDots.map((active) => `<span class="${active ? "active" : ""}"></span>`).join("")}</b>
        <small>${formatDate(customer.lastFollowTime)}</small>
      </span>
    </button>
  `;
}

function renderWorkbenchAiPanel(customer) {
  if (!customer) {
    return `
      <article class="dashboardPanel aiInsightPanel">
        <div>
          <div class="sectionKicker">AI 分析</div>
          <h2>等待客户数据</h2>
          <p>新增客户后，这里会显示阶段判断、推荐动作与资料库入口。</p>
        </div>
      </article>
    `;
  }
  const analysis = buildLocalAnalysis(customer).slice(0, 4);
  const materials = getStageMaterials(customer.stage).slice(0, 4);
  return `
    <article class="dashboardPanel aiInsightPanel">
      <div class="panelTitleLine">
        <div>
          <div class="sectionKicker">AI 分析</div>
          <h2>${escapeHtml(customer.name)}需求洞察</h2>
        </div>
        <button class="linkGhost" type="button" data-action="open-customer" data-id="${customer.id}">查看详情</button>
      </div>
      <div class="insightCard">
        <strong>${escapeHtml(getStageName(customer.stage))}</strong>
        <ul>
          ${analysis.map(([title, text]) => `<li><b>${escapeHtml(title)}</b>${escapeHtml(stripPlainText(text, 52))}</li>`).join("")}
        </ul>
        <span>数据来源：最近跟进记录与客户档案</span>
      </div>
      <div class="recommendActions">
        <button class="active" type="button" data-action="open-strategy-modal" data-id="${customer.id}">
          <strong>生成方案</strong>
          <span>基于客户需求生成智能策略</span>
        </button>
        <button type="button" data-action="generate" data-type="demand_analysis" data-id="${customer.id}">
          <strong>发送跟进</strong>
          <span>生成个性化跟进内容</span>
        </button>
        <button type="button" data-action="open-interaction-image-modal" data-id="${customer.id}">
          <strong>预约演示</strong>
          <span>准备产品演示视觉稿</span>
        </button>
      </div>
      <div class="knowledgeMini">
        <div class="sectionKicker">资料库 / 知识库</div>
        <div>
          ${materials.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>
      </div>
    </article>
  `;
}

function renderWorkbenchPreviewPanel(customer) {
  if (!customer) return "";
  const latestHistory = state.db.aiGenerationRecords
    .filter((item) => item.customerId === customer.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const previewTitle = latestHistory?.title || `${customer.name}方案（草稿）`;
  const previewBody = latestHistory?.outputContent || buildWorkbenchFallbackPreview(customer);
  return `
    <article class="dashboardPanel proposalPreviewPanel">
      <div class="panelTitleLine">
        <div>
          <div class="sectionKicker">方案生成预览</div>
          <h2>${escapeHtml(previewTitle)}</h2>
        </div>
        <button class="linkGhost" type="button" data-action="${latestHistory ? "open-history" : "generate"}" data-type="proposal_outline" data-id="${latestHistory?.id || customer.id}">
          ${latestHistory ? "打开历史" : "生成方案"}
        </button>
      </div>
      <div class="proposalPaper markdownPane compactMarkdown">
        ${markdownToHtml(trimMarkdown(previewBody, 1200))}
      </div>
      <div class="proposalActions">
        <button class="ghostButton" type="button" data-action="open-customer" data-id="${customer.id}">查看客户</button>
        <button class="primaryButton" type="button" data-action="generate" data-type="proposal_outline" data-id="${customer.id}">生成新方案</button>
      </div>
    </article>
  `;
}

function renderCustomerRow(customer) {
  return `
    <tr class="customerRow ${customer.id === state.selectedCustomerId ? "selected" : ""}" data-action="open-customer" data-id="${customer.id}">
      <td>
        <div class="customerCell">
          <span class="tableAvatar">${escapeHtml(customer.name.slice(0, 1))}</span>
          <div>
            <button class="linkButton strong" type="button" data-action="open-customer" data-id="${customer.id}">${escapeHtml(customer.name)}</button>
            <small>${escapeHtml(customer.contactName || "未填联系人")} · ${escapeHtml(customer.customerType || "未分类")}</small>
          </div>
        </div>
      </td>
      <td><span class="stagePill">${escapeHtml(getStageName(customer.stage))}</span></td>
      <td>${renderStatus(customer.status)}</td>
      <td>${escapeHtml(getUserName(customer.ownerId))}</td>
      <td>${formatDate(customer.lastFollowTime)}</td>
      <td class="maxCell">${escapeHtml(customer.nextAction || "待补充")}</td>
      <td>${formatMoney(customer.estimatedAmount)}</td>
    </tr>
  `;
}

function renderDetailView() {
  const customer = getSelectedCustomer();
  if (!customer) return renderEmptyState("还没有客户", "新增客户后，这里会展示完整的客户详情、跟进记录和 AI 分析。");
  const isHistoryTab = state.detailTab === "history";

  return `
    <section class="detailHero">
      <div>
        <div class="sectionKicker">${escapeHtml(customer.customerType || "未分类")} · ${escapeHtml(customer.source || "未知来源")}</div>
        <h2>${escapeHtml(customer.name)}</h2>
        <p>${escapeHtml(customer.demandDescription || "暂无客户原始需求")}</p>
      </div>
      <div class="detailActions">
        <button class="primaryButton" type="button" data-action="open-strategy-modal" data-id="${customer.id}">生成跟进策略</button>
        <button class="ghostButton" type="button" data-action="add-customer-to-solution-library" data-id="${customer.id}">加入历史方案库</button>
        <button class="ghostButton" type="button" data-action="open-interaction-image-modal" data-id="${customer.id}">生成交互图</button>
        <button class="ghostButton" type="button" data-action="edit-customer" data-id="${customer.id}">编辑客户</button>
        <button class="ghostButton" type="button" data-action="open-follow-modal" data-id="${customer.id}">新增跟进</button>
        <button class="dangerButton" type="button" data-action="open-failure-modal" data-id="${customer.id}">标记失败</button>
        ${isAdmin() ? `<button class="dangerButton" type="button" data-action="delete-customer" data-id="${customer.id}">删除客户</button>` : ""}
      </div>
    </section>
    <section class="detailGrid ${isHistoryTab ? "historyDetailGrid" : ""}">
      ${isHistoryTab ? "" : `
        <aside class="profilePanel">
          ${renderCustomerFacts(customer)}
        </aside>
      `}
      <div class="detailMain ${isHistoryTab ? "detailMainWide" : ""}">
        <div class="tabs">
          ${[
            ["overview", "客户档案"],
            ["follows", "跟进记录"],
            ["ai", "AI 分析"],
            ["files", "客户资料"],
            ["history", "生成历史"]
          ].map(([tab, label]) => `
            <button class="${state.detailTab === tab ? "active" : ""}" type="button" data-action="detail-tab" data-tab="${tab}">
              ${escapeHtml(label)}
            </button>
          `).join("")}
        </div>
        ${renderDetailTab(customer)}
      </div>
    </section>
  `;
}

function renderCustomerFacts(customer) {
  const latestFollow = state.db.followRecords
    .filter((item) => item.customerId === customer.id)
    .sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt))[0];
  const facts = [
    ["联系人", customer.contactName || "未填"],
    ["微信", customer.contactWechat || "未填"],
    ["电话", customer.contactPhone || "未填"],
    ["邮箱", customer.contactEmail || "未填"],
    ["阶段", getStageName(customer.stage)],
    ["状态", customer.status || "跟进中"],
    ["销售人员", getUserName(customer.ownerId)],
    ["成交概率", customer.dealProbability || "未评估"],
    ["预计金额", formatMoney(customer.estimatedAmount)],
    ["下次跟进", formatDate(customer.nextFollowTime)]
  ];
  return `
    <div class="profileTop">
      <div class="avatarBlock">${escapeHtml(customer.name.slice(0, 1))}</div>
      <div>
        <strong>${escapeHtml(customer.name)}</strong>
        <span>${escapeHtml(getStageName(customer.stage))}</span>
      </div>
    </div>
    <dl class="factList">
      ${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
    </dl>
    <button class="primaryButton fullButton" type="button" data-action="open-strategy-modal" data-id="${customer.id}">生成跟进策略</button>
    <button class="ghostButton fullButton" type="button" data-action="add-customer-to-solution-library" data-id="${customer.id}">加入历史方案库</button>
    <div class="profileAssist">
      <article>
        <span>下一步动作</span>
        <p>${escapeHtml(customer.nextAction || latestFollow?.nextAction || "待补充下一步动作")}</p>
      </article>
      <article>
        <span>当前风险</span>
        <p>${escapeHtml(customer.knownRisks || "暂无明确风险")}</p>
      </article>
      <article>
        <span>最近跟进</span>
        <p>${escapeHtml(latestFollow ? `${formatDate(latestFollow.followTime || latestFollow.createdAt)} · ${latestFollow.followMethod || "沟通"}` : "暂无跟进记录")}</p>
      </article>
    </div>
  `;
}

function renderDetailTab(customer) {
  if (state.detailTab === "follows") return renderFollowRecords(customer);
  if (state.detailTab === "ai") return renderAiAnalysis(customer);
  if (state.detailTab === "files") return renderCustomerFiles(customer);
  if (state.detailTab === "history") return renderCustomerHistory(customer);
  return renderCustomerArchive(customer);
}

function renderCustomerArchive(customer) {
  const items = [
    ["客户业务背景", customer.background],
    ["想解决的问题", customer.problemToSolve],
    ["已有系统或业务基础", customer.existingSystem],
    ["预算情况", customer.budgetInfo],
    ["决策链信息", customer.decisionInfo],
    ["当前已知风险", customer.knownRisks],
    ["内部备注", customer.internalNotes]
  ];
  return `
    <div class="panelGrid two">
      ${items.map(([title, text]) => `
        <article class="infoPanel">
          <h3>${escapeHtml(title)}</h3>
          ${renderTextPreview(title, text || "待补充")}
        </article>
      `).join("")}
    </div>
    <div class="generatorStrip">
      <button class="primaryButton" type="button" data-action="open-strategy-modal" data-id="${customer.id}">生成跟进策略 / 选择 Skill</button>
      <button type="button" data-action="add-customer-to-solution-library" data-id="${customer.id}">加入历史方案库</button>
      <button type="button" data-action="open-interaction-image-modal" data-id="${customer.id}">生成交互图</button>
    </div>
  `;
}

function renderFollowRecords(customer) {
  const records = state.db.followRecords
    .filter((item) => item.customerId === customer.id)
    .sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt));
  const pageKey = `follows_${customer.id}`;
  const pagination = paginateItems(records, pageKey);

  return `
    <div class="sectionHead">
      <div>
        <h3>跟进记录</h3>
        <p>每次沟通后沉淀客户反馈、内部判断和下一步动作。</p>
      </div>
      <button class="primaryButton" type="button" data-action="open-follow-modal" data-id="${customer.id}">新增跟进</button>
    </div>
    <div class="timeline">
      ${pagination.items.map((record) => `
        <article class="timelineItem">
          <div class="timelineDot"></div>
          <div>
            <header>
              <strong>${escapeHtml(formatDate(record.followTime))}</strong>
              <span>${escapeHtml(record.followMethod || "沟通")} · ${escapeHtml(getStageName(record.stage))}</span>
            </header>
            <div class="followText">${renderTextPreview("跟进内容", record.content || "暂无沟通内容", 110)}</div>
            <div class="miniGrid">
              <div><b>客户反馈</b>${renderTextPreview("客户反馈", record.customerFeedback || "待补充", 70)}</div>
              <div><b>内部判断</b>${renderTextPreview("内部判断", record.internalJudgement || "待补充", 70)}</div>
              <div><b>下一步</b>${renderTextPreview("下一步动作", record.nextAction || "待补充", 70)}</div>
            </div>
            ${record.aiSummary ? `<div class="miniMarkdown">${renderTextPreview("AI 跟进总结", record.aiSummary, 160)}</div>` : ""}
            <div class="rowActions">
              <button type="button" data-action="edit-follow" data-id="${record.id}">编辑</button>
              <button type="button" data-action="summarize-follow" data-id="${record.id}">AI 总结</button>
            </div>
          </div>
        </article>
      `).join("") || renderEmptyState("暂无跟进记录", "新增一次跟进后，AI 会拥有更完整的上下文。")}
    </div>
    ${renderPaginationControls(pageKey, pagination)}
  `;
}

function renderAiAnalysis(customer) {
  const savedRecords = getSavedCustomerArchiveRecords(customer.id);
  return `
    <div class="sectionHead aiArchiveHead">
      <div>
        <h3>已保存到客户档案</h3>
        <p>这里只展示销售主动保存过的 AI 产物。普通生成历史不会自动出现在 AI 分析中，避免信息噪音。</p>
      </div>
    </div>
    ${savedRecords.length ? `
      <div class="savedAiArchiveGrid">
        ${savedRecords.map((record) => renderSavedAiArchiveCard(record)).join("")}
      </div>
    ` : renderEmptyState("暂无已保存的 AI 分析", "在「生成历史」中打开一条 AI 结果，点击「保存到客户档案」后，它会以小卡片形式出现在这里。")}
  `;
}

function renderSavedAiArchiveCard(record) {
  const archive = getCustomerArchiveMeta(record);
  const status = getRecordJobStatus(record);
  const preview = getArchiveRecordPreview(record);
  return `
    <button class="savedAiArchiveCard ${escapeAttr(status)}" type="button" data-action="open-document" data-id="${record.id}">
      <span class="savedAiArchiveType">${escapeHtml(generationTypes[record.generationType] || "AI 生成")}</span>
      <strong>${escapeHtml(record.title || generationTypes[record.generationType] || "AI 文档")}</strong>
      <p>${escapeHtml(preview)}</p>
      <small>${escapeHtml(archive.savedByName || "已保存")} · ${formatDate(archive.savedAt || record.updatedAt || record.createdAt)}${renderRecordJobStatusText(record)}</small>
    </button>
  `;
}

function renderCustomerAiReportCards(customer) {
  const nextReport = getLatestCustomerGeneration(customer.id, "next_communication_question_list");
  const consultationReport = getLatestCustomerGeneration(customer.id, "consultation_advice");
  const lightweightReport = getLatestCustomerGeneration(customer.id, "lightweight_solution");
  const lightweightPptOutline = getLatestCustomerGeneration(customer.id, "lightweight_solution_ppt_outline");
  const lightweightPptTask = getLatestCustomerGeneration(customer.id, "lightweight_solution_ppt");
  const interactionBoards = getCustomerInteractionBoards(customer.id);
  const nextSummary = nextReport ? summarizeNextQuestionReport(nextReport.outputContent || "") : null;
  const lightweightSummary = lightweightReport ? summarizeLightweightSolutionReport(lightweightReport.outputContent || "") : null;
  const pptOutlineSummary = lightweightPptOutline ? summarizeLightweightSolutionPptOutline(lightweightPptOutline.outputContent || "") : null;
  const pptTaskSummary = lightweightPptTask ? summarizeLightweightSolutionPptTask(lightweightPptTask) : null;
  const pptOutlineStatus = getRecordJobStatus(lightweightPptOutline);
  const pptTaskStatus = getRecordJobStatus(lightweightPptTask);
  const nextQuestionSkillId = getSkillIdByName("下一步沟通问题清单");

  return `
    <div class="sectionHead aiReportHead">
      <div>
        <h3>AI 报告 / Skill 区</h3>
        <p>报告按客户归档，点击卡片进入完整 Markdown 文档详情。</p>
      </div>
    </div>
    <div class="reportCardGrid">
      <article class="reportCard ${lightweightReport ? "" : "empty"}">
        <div class="reportCardTop">
          <span>Client-ready Plan</span>
          <strong>轻量级方案</strong>
        </div>
        ${lightweightReport ? `
          <div class="reportMetrics">
            <span>产品层次：${escapeHtml(lightweightSummary.layers || "已梳理")}</span>
            <span>端口结构：${escapeHtml(lightweightSummary.ports || "按端口拆分")}</span>
            <span>AI 融入：${escapeHtml(lightweightSummary.ai || "围绕已有功能")}</span>
            <span>下一步：${escapeHtml(lightweightSummary.next || "确认 MVP 范围")}</span>
          </div>
          <div class="rowActions">
            <button type="button" data-action="open-history" data-id="${lightweightReport.id}">查看详情</button>
            <button type="button" data-action="open-lightweight-solution-modal" data-id="${customer.id}">重新生成</button>
          </div>
        ` : `
          <p>面向客户可读的轻量级产品方案，包含端口功能结构、AI 融入点和后续确认事项。</p>
          <button class="primaryButton" type="button" data-action="open-lightweight-solution-modal" data-id="${customer.id}">生成轻量级方案</button>
        `}
      </article>
      <article class="reportCard ${lightweightPptOutline || lightweightPptTask ? "" : "empty"}">
        <div class="reportCardTop">
          <span>Presentation Skill</span>
          <strong>轻量级方案 PPT</strong>
        </div>
        ${lightweightPptTask ? `
          <div class="reportMetrics">
            <span>任务状态：${escapeHtml(pptTaskSummary.status || "生成中")}</span>
            <span>目标页数：${escapeHtml(pptTaskSummary.pageCount || "自动估算")}</span>
            <span>视觉风格：${escapeHtml(pptTaskSummary.style || "自动填充")}</span>
            <span>生成引擎：${escapeHtml(pptTaskSummary.engine || "PPT Skill")}</span>
            <span>图片输出：${escapeHtml(pptTaskSummary.imageResult || "等待图片页")}</span>
            <span>结果：${escapeHtml(pptTaskSummary.result || "等待生成")}</span>
          </div>
          <div class="rowActions">
            <button type="button" data-action="open-history" data-id="${lightweightPptTask.id}">查看任务</button>
            ${renderPptTaskLinkActions(lightweightPptTask)}
            ${lightweightPptOutline && pptTaskStatus !== "generating" ? `<button type="button" data-action="generate-ppt-from-outline" data-id="${lightweightPptOutline.id}">重新生成PPT</button>` : ""}
          </div>
        ` : lightweightPptOutline ? `
          <div class="reportMetrics">
            <span>结构页数：${escapeHtml(pptOutlineSummary.pages || "约 10 页")}${pptOutlineStatus === "generating" ? " · 生成中" : ""}</span>
            <span>定位：${escapeHtml(pptOutlineSummary.position || "客户讲解")}</span>
            <span>风格：${escapeHtml(pptOutlineSummary.style || "SaaS 产品风")}</span>
            <span>下一步：${escapeHtml(pptOutlineSummary.next || "生成 PPTX")}</span>
          </div>
          <div class="rowActions">
            <button type="button" data-action="open-history" data-id="${lightweightPptOutline.id}">查看大纲</button>
            <button type="button" data-action="copy-history" data-id="${lightweightPptOutline.id}">复制大纲</button>
            ${pptOutlineStatus === "generating" ? "" : `<button type="button" data-action="generate-ppt-from-outline" data-id="${lightweightPptOutline.id}">生成PPT</button>`}
          </div>
        ` : `
          <p>将已生成的前期咨询回应报告和轻量级方案重组为 PPT 结构稿，再自动填充到本机 PPT Skill 生成 PPTX。</p>
          <button class="primaryButton" type="button" data-action="generate" data-type="lightweight_solution_ppt_outline" data-id="${customer.id}">生成轻量级方案PPT</button>
        `}
      </article>
      <article class="reportCard ${nextReport ? "" : "empty"}">
        <div class="reportCardTop">
          <span>Skill Report</span>
          <strong>下一步沟通问题清单</strong>
        </div>
        ${nextReport ? `
          <div class="reportMetrics">
            <span>沟通目标：${escapeHtml(nextSummary.goals || "已生成")}</span>
            <span>核心问题：${escapeHtml(nextSummary.questionCount || "8-12")} 个</span>
            <span>沟通重点：${escapeHtml(nextSummary.focus || "MVP / AI / 预算 / 决策")}</span>
            <span>形成判断：${escapeHtml(nextSummary.decision || "进入下一阶段判断")}</span>
          </div>
          <div class="rowActions">
            <button type="button" data-action="open-history" data-id="${nextReport.id}">查看详情</button>
            <button type="button" data-action="open-strategy-modal" data-id="${customer.id}" data-skill="${escapeAttr(nextQuestionSkillId)}">重新生成</button>
          </div>
        ` : `
          <p>还没有生成沟通问题清单。建议在前期咨询回应策略报告后生成，用于准备下一次客户沟通。</p>
          <button class="primaryButton" type="button" data-action="open-strategy-modal" data-id="${customer.id}" data-skill="${escapeAttr(nextQuestionSkillId)}">生成沟通问题清单</button>
        `}
      </article>
      <article class="reportCard ${consultationReport ? "" : "empty"}">
        <div class="reportCardTop">
          <span>Recommended Action</span>
          <strong>前期咨询回应策略报告</strong>
        </div>
        ${consultationReport ? `
          <p>${escapeHtml(stripText(consultationReport.outputContent || "").slice(0, 180) || "已生成前期咨询回应策略报告。")}</p>
          <div class="nextStepCallout compact">
            <span>下一步建议：生成下一步沟通问题清单，帮助销售准备下一次客户沟通。</span>
            <button type="button" data-action="open-strategy-modal" data-id="${customer.id}" data-skill="${escapeAttr(nextQuestionSkillId)}">生成沟通问题清单</button>
          </div>
        ` : `
          <p>若客户刚录入，建议先生成前期咨询回应策略报告，再生成沟通问题清单。</p>
          <button type="button" data-action="generate" data-type="consultation_advice" data-id="${customer.id}">生成前期咨询回应策略</button>
        `}
      </article>
    </div>
    <section class="interactionBoardListSection">
      <div class="sectionHead compact">
        <div>
          <h3>交互图画板</h3>
          <p>按客户归档的 image2 交互图，支持查看、复制、下载和单张重新生成。</p>
        </div>
        <button class="primaryButton" type="button" data-action="open-interaction-image-modal" data-id="${customer.id}">生成交互图</button>
      </div>
      ${interactionBoards.length ? `
        <div class="interactionBoardRecordList">
          ${interactionBoards.slice(0, 3).map((record) => renderInteractionBoardRecordCard(record)).join("")}
        </div>
      ` : renderEmptyState("暂无交互图画板", "点击生成交互图后，图片会按列表归档在当前客户详情中。")}
    </section>
  `;
}

function renderSaveToCustomerButton(record = {}) {
  if (!record.customerId) return "";
  const archive = getCustomerArchiveMeta(record);
  const label = archive.savedAt ? "已保存到客户档案" : "保存到客户档案";
  return `<button class="ghostButton ${archive.savedAt ? "savedArchiveButton" : ""}" type="button" data-action="save-history-to-customer" data-id="${record.id}">${label}</button>`;
}

function renderCustomerHistory(customer) {
  const records = state.db.aiGenerationRecords
    .filter((item) => item.customerId === customer.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const pageKey = `history_${customer.id}`;
  const pagination = paginateItems(records, pageKey);
  const selected = pagination.items.find((item) => item.id === state.selectedHistoryId) || pagination.items[0];

  return `
    <section class="historyLayout customerHistoryLayout focusHistoryLayout">
      <aside class="historyList">
        ${pagination.items.map((item) => `
          <button class="${selected?.id === item.id ? "active" : ""}" type="button" data-action="open-history" data-id="${item.id}">
            <strong>${escapeHtml(item.title || generationTypes[item.generationType] || "AI 生成")}</strong>
            <span>${escapeHtml(generationTypes[item.generationType] || "AI 生成")} · ${formatDate(item.createdAt)}${renderRecordJobStatusText(item)}</span>
          </button>
        `).join("") || renderEmptyState("暂无生成历史", "在当前客户详情里生成策略、需求分析、方案大纲后会归档到这里。")}
        ${renderPaginationControls(pageKey, pagination)}
      </aside>
      <article class="historyPreview">
        ${selected ? renderHistoryDocument(customer, selected) : renderEmptyState("选择一条历史", "当前客户的 AI 输出会展示在这里。")}
      </article>
    </section>
  `;
}

function renderHistoryDocument(customer, record) {
  const isEditing = state.editingHistoryId === record.id;
  if (isEditing) {
    return `
      <form id="historyEditForm" class="documentEditor">
        <input type="hidden" name="id" value="${escapeAttr(record.id)}">
        <div class="documentToolbar">
          <div>
            <div class="sectionKicker">Markdown 文档编辑</div>
            <input class="documentTitleInput" name="title" value="${escapeAttr(record.title || generationTypes[record.generationType] || "AI 生成")}">
            <p>${escapeHtml(customer.name)} · ${escapeHtml(record.modelName || "本地规则生成")} · ${formatDate(record.createdAt)}</p>
          </div>
          <div class="documentActions">
            <button class="ghostButton" type="button" data-action="cancel-edit-history">取消</button>
            <button class="primaryButton" type="submit">保存文档</button>
          </div>
        </div>
        <textarea class="markdownEditor" name="outputContent" spellcheck="false">${escapeHtml(record.outputContent || "")}</textarea>
        <p class="editorHint">支持标准 Markdown：标题、表格、代码块、引用、任务列表、链接、图片、粗体、斜体等。</p>
      </form>
    `;
  }

  const sync = getFeishuSync(record);
  const isNextQuestionReport = record.generationType === "next_communication_question_list";
  const isPptOutline = record.generationType === "lightweight_solution_ppt_outline";
  const isPptTask = record.generationType === "lightweight_solution_ppt";
  const isInteractionImage = record.generationType === "interaction_image";
  return `
    <div class="documentViewer">
      <div class="documentToolbar">
        <div>
          <div class="sectionKicker">${escapeHtml(generationTypes[record.generationType] || "AI 生成")}</div>
          <h3>${escapeHtml(record.title || generationTypes[record.generationType] || "AI 生成")}</h3>
          <p>${escapeHtml(customer.name)} · ${escapeHtml(record.modelName || "本地规则生成")} · ${formatDate(record.createdAt)}${renderTokenBudgetMeta(record)}${renderFeishuSyncMeta(record)}</p>
        </div>
        <div class="documentActions">
          ${record.customerId && !isPptTask ? `<button class="ghostButton" type="button" data-action="regenerate-history" data-id="${record.id}">重新生成</button>` : ""}
          ${isPptTask && record.inputContext?.pptTask?.sourceOutlineRecordId ? `<button class="ghostButton" type="button" data-action="generate-ppt-from-outline" data-id="${record.inputContext.pptTask.sourceOutlineRecordId}">重新生成PPT</button>` : ""}
          <button class="ghostButton" type="button" data-action="copy-history" data-id="${record.id}">${isPptOutline ? "复制大纲" : "复制"}</button>
          ${isPptOutline ? `<button class="primaryButton" type="button" data-action="generate-ppt-from-outline" data-id="${record.id}">生成PPT</button>` : ""}
          ${isPptTask ? renderPptTaskLinkActions(record) : ""}
          ${renderSaveToCustomerButton(record)}
          ${isNextQuestionReport ? `<button class="ghostButton" type="button" data-action="save-history-as-file" data-id="${record.id}">保存为跟进准备材料</button>` : ""}
          <button class="ghostButton" type="button" data-action="export-history-pdf" data-id="${record.id}">导出 PDF</button>
          <button class="ghostButton" type="button" data-action="open-report-feedback" data-id="${record.id}">反馈报告</button>
          <button class="ghostButton" type="button" data-action="sync-history-feishu" data-id="${record.id}">${sync ? "重新同步飞书" : "同步飞书"}</button>
          ${renderFeishuOpenLink(record)}
          <button class="primaryButton" type="button" data-action="edit-history" data-id="${record.id}">编辑文档</button>
          <button class="ghostButton" type="button" data-action="open-document" data-id="${record.id}">全屏查看</button>
        </div>
      </div>
      ${isInteractionImage ? renderInteractionImageBoard(record) : isNextQuestionReport ? renderStructuredReportDetail(record) : `<div class="documentBody markdownPane">${markdownToHtml(record.outputContent || "暂无内容")}</div>`}
      ${record.generationType === "consultation_advice" ? `
        <div class="nextStepCallout">
          <span>下一步建议：生成下一步沟通问题清单，帮助销售准备下一次客户沟通。</span>
          <button type="button" data-action="open-strategy-modal" data-id="${customer.id}" data-skill="${escapeAttr(getSkillIdByName("下一步沟通问题清单"))}">生成沟通问题清单</button>
        </div>
      ` : ""}
      ${isPptOutline ? `
        <div class="nextStepCallout">
          <span>下一步建议：将这份结构稿自动填入本机 PPT Skill，生成可预览和下载的 PPTX。</span>
          <button type="button" data-action="generate-ppt-from-outline" data-id="${record.id}">生成PPT</button>
        </div>
      ` : ""}
    </div>
  `;
}

function renderStructuredReportDetail(record) {
  const sections = extractMarkdownSections(record.outputContent || "");
  if (!sections.length) {
    return `<div class="documentBody markdownPane">${markdownToHtml(record.outputContent || "暂无内容")}</div>`;
  }
  return `
    <div class="reportDetailLayout documentBody">
      <aside class="reportToc">
        <strong>目录</strong>
        ${sections.map((section, index) => `
          <a href="#report-section-${record.id}-${index}">${escapeHtml(section.title)}</a>
        `).join("")}
      </aside>
      <div class="reportSections">
        ${sections.map((section, index) => `
          <section id="report-section-${record.id}-${index}" class="reportSection">
            <div class="reportSectionHead">
              <span>${escapeHtml(section.title)}</span>
              <button type="button" data-action="copy-report-section" data-id="${record.id}" data-section="${index}">复制本节</button>
            </div>
            <div class="markdownPane">${markdownToHtml(section.markdown)}</div>
          </section>
        `).join("")}
      </div>
    </div>
  `;
}

function renderInteractionImageBoard(record) {
  const board = getInteractionImageBoard(record);
  if (!board.items.length) {
    return `<div class="documentBody markdownPane">${markdownToHtml(record.outputContent || "暂无内容")}</div>`;
  }
  return `
    <section class="interactionBoardDocument">
      <div class="interactionBoardSummary">
        <div>
          <span>Image2 Board</span>
          <strong>${escapeHtml(board.title || record.title || "交互图画板")}</strong>
          <p>${escapeHtml(board.style || "自动风格")} · ${escapeHtml(board.websiteType || "自动类型")} · ${board.items.length} 张 · ${escapeHtml(getRecordJobStatusLabel(getRecordJobStatus(record)))}</p>
        </div>
        <div class="interactionBoardStats">
          <span>${countInteractionItems(board.items, "completed")} 已完成</span>
          <span>${countInteractionItems(board.items, "generating")} 生成中</span>
          <span>${countInteractionItems(board.items, "failed")} 失败</span>
        </div>
      </div>
      <div class="interactionBoardCanvas">
        ${board.items.map((item, index) => renderInteractionBoardItem(record, item, index)).join("")}
      </div>
      <details class="interactionBoardMarkdown">
        <summary>查看 Markdown 记录</summary>
        <div class="markdownPane">${markdownToHtml(record.outputContent || "暂无内容")}</div>
      </details>
    </section>
  `;
}

function renderInteractionBoardRecordCard(record) {
  const board = getInteractionImageBoard(record);
  const status = getRecordJobStatus(record);
  return `
    <article class="interactionBoardRecordCard">
      <div>
        <span>${escapeHtml(getRecordJobStatusLabel(status))}</span>
        <strong>${escapeHtml(record.title || board.title || "交互图画板")}</strong>
        <p>${escapeHtml(board.style || "自动风格")} · ${escapeHtml(board.websiteType || "自动类型")} · ${board.items.length || 0} 张 · ${formatDate(record.createdAt)}</p>
      </div>
      <div class="interactionBoardThumbs">
        ${board.items.slice(0, 4).map((item) => item.imageUrl
          ? `<img src="${escapeAttr(item.imageUrl)}" alt="${escapeAttr(item.title || "交互图")}" loading="lazy" data-display-mode="${escapeAttr(item.displayMode || inferImageDisplayMode(item))}">`
          : `<span>${escapeHtml(getRecordJobStatusLabel(item.status || "generating"))}</span>`).join("")}
      </div>
      <button type="button" data-action="open-history" data-id="${record.id}">查看画板</button>
    </article>
  `;
}

function renderInteractionBoardItem(record, item = {}, index = 0) {
  const status = item.status || "queued";
  const imageUrl = item.imageUrl || "";
  const safeImage = imageUrl ? sanitizeMarkdownUrl(imageUrl, "image") : "";
  const displayMode = item.displayMode || inferImageDisplayMode(item);
  const visualClass = ["interactionBoardItemVisual", displayMode === "mobile" ? "mobileVisual" : ""].filter(Boolean).join(" ");
  return `
    <article class="interactionBoardItem ${escapeAttr(status)}">
      <div class="${escapeAttr(visualClass)}">
        ${safeImage
          ? `<img src="${safeImage}" alt="${escapeAttr(item.title || `交互图 ${index + 1}`)}" loading="lazy" data-display-mode="${escapeAttr(displayMode)}">`
          : `<div class="interactionImageSkeleton"><span>${escapeHtml(getRecordJobStatusLabel(status))}</span></div>`}
      </div>
      <div class="interactionBoardItemBody">
        <div class="interactionBoardItemHead">
          <span>#${index + 1} · ${escapeHtml(item.device || "界面")}</span>
          <strong>${escapeHtml(item.title || `交互图 ${index + 1}`)}</strong>
        </div>
        <p>${escapeHtml(item.goal || item.layout || item.error || "等待 image2 返回结果。")}</p>
        ${item.error ? `<small class="interactionError">${escapeHtml(item.error)}</small>` : ""}
        <div class="rowActions">
          <button type="button" data-action="view-interaction-image" data-id="${record.id}" data-item-id="${escapeAttr(item.id || "")}">查看</button>
          <button type="button" data-action="copy-interaction-image-prompt" data-id="${record.id}" data-item-id="${escapeAttr(item.id || "")}">复制提示词</button>
          <button type="button" data-action="copy-interaction-image-url" data-id="${record.id}" data-item-id="${escapeAttr(item.id || "")}">复制链接</button>
          <button type="button" data-action="download-interaction-image" data-id="${record.id}" data-item-id="${escapeAttr(item.id || "")}">下载</button>
          <button type="button" data-action="regenerate-interaction-image-item" data-id="${record.id}" data-item-id="${escapeAttr(item.id || "")}">重新生成</button>
        </div>
      </div>
    </article>
  `;
}

function inferImageDisplayMode(item = {}) {
  const text = `${item.device || ""} ${item.title || ""} ${item.goal || ""} ${item.prompt || ""}`;
  if (/手机|移动|mobile|app|小程序/i.test(text) && !/桌面|pc|desktop|后台/i.test(text)) return "mobile";
  return "default";
}

function renderDocumentRoute() {
  const record = state.db.aiGenerationRecords.find((item) => item.id === state.documentRoute?.recordId);
  if (!record) {
    return `
      <main class="documentRouteShell emptyDocumentRoute">
        ${renderEmptyState("未找到文档", "这条生成历史可能已被删除或刷新后不可用。")}
        <button class="primaryButton" type="button" data-action="close-document">返回 CRM</button>
      </main>
    `;
  }
  const customer = record.customerId ? getCustomer(record.customerId) : null;
  const sections = extractMarkdownSections(record.outputContent || "");
  const historyRecords = record.customerId
    ? state.db.aiGenerationRecords
      .filter((item) => item.customerId === record.customerId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 12)
    : state.db.aiGenerationRecords
      .filter((item) => !item.customerId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 12);
  const isEditing = state.documentRoute?.mode === "edit";
  const sync = getFeishuSync(record);
  const isNextQuestionReport = record.generationType === "next_communication_question_list";
  const isPptOutline = record.generationType === "lightweight_solution_ppt_outline";
  const isPptTask = record.generationType === "lightweight_solution_ppt";

  return `
    <main class="documentRouteShell">
      <aside class="documentRouteSidebar">
        <div class="documentRouteBrand">
          <button type="button" data-action="close-document">← 返回</button>
          <strong>AI CRM 文档</strong>
          <span>${escapeHtml(customer?.name || "默认 AI 工作台")}</span>
        </div>
        <section class="documentRouteNavBlock">
          <span>当前客户文档</span>
          <div class="documentRouteHistoryList">
            ${historyRecords.map((item) => `
              <button class="${item.id === record.id ? "active" : ""}" type="button" data-action="open-document" data-id="${item.id}">
                <strong>${escapeHtml(item.title || generationTypes[item.generationType] || "AI 文档")}</strong>
                <small>${escapeHtml(generationTypes[item.generationType] || "AI 生成")} · ${formatDate(item.createdAt)}${renderRecordJobStatusText(item)}</small>
              </button>
            `).join("") || `<p class="hintText">暂无其他文档</p>`}
          </div>
        </section>
        <section class="documentRouteNavBlock docTocBlock">
          <span>目录</span>
          <nav class="documentRouteToc">
            ${(sections.length ? sections : [{ title: "文档正文", markdown: record.outputContent || "" }]).map((section, index) => `
              <a href="#doc-section-${record.id}-${index}">${escapeHtml(section.title)}</a>
            `).join("")}
          </nav>
        </section>
      </aside>
      <section class="documentRouteMain">
        <details class="documentRouteTop" ${isEditing ? "open" : ""}>
          <summary class="documentRouteTopSummary">
            <div class="documentRouteTopSummaryInfo">
              <div class="sectionKicker">${escapeHtml(generationTypes[record.generationType] || "AI 生成文档")}</div>
              <strong>${escapeHtml(record.title || generationTypes[record.generationType] || "AI 文档")}</strong>
              <p>${escapeHtml(customer?.name || "默认 AI 工作台")} · ${escapeHtml(record.modelName || "本地规则生成")} · ${formatDate(record.createdAt)}${renderTokenBudgetMeta(record)}${renderFeishuSyncMeta(record)}</p>
            </div>
            <span class="documentRouteTopSummaryButton">${isEditing ? "编辑中" : "文档信息"}</span>
          </summary>
          <div class="documentRouteTopPanel">
            <div class="documentRouteActions">
              ${record.customerId && !isPptTask ? `<button class="ghostButton" type="button" data-action="regenerate-history" data-id="${record.id}">重新生成</button>` : ""}
              ${isPptTask && record.inputContext?.pptTask?.sourceOutlineRecordId ? `<button class="ghostButton" type="button" data-action="generate-ppt-from-outline" data-id="${record.inputContext.pptTask.sourceOutlineRecordId}">重新生成PPT</button>` : ""}
              <button class="ghostButton" type="button" data-action="copy-history" data-id="${record.id}">${isPptOutline ? "复制大纲" : "复制"}</button>
              ${isPptOutline ? `<button class="primaryButton" type="button" data-action="generate-ppt-from-outline" data-id="${record.id}">生成PPT</button>` : ""}
              ${isPptTask ? renderPptTaskLinkActions(record) : ""}
              ${renderSaveToCustomerButton(record)}
              ${isNextQuestionReport ? `<button class="ghostButton" type="button" data-action="save-history-as-file" data-id="${record.id}">保存为跟进准备材料</button>` : ""}
              <button class="ghostButton" type="button" data-action="export-history-pdf" data-id="${record.id}">导出 PDF</button>
              <button class="ghostButton" type="button" data-action="open-report-feedback" data-id="${record.id}">反馈报告</button>
              <button class="ghostButton" type="button" data-action="sync-history-feishu" data-id="${record.id}">${sync ? "重新同步飞书" : "同步飞书"}</button>
              ${renderFeishuOpenLink(record)}
              ${isEditing
                ? `<button class="ghostButton" type="button" data-action="cancel-edit-history">预览文档</button>`
                : `<button class="primaryButton" type="button" data-action="edit-history" data-id="${record.id}">编辑文档</button>`}
            </div>
          </div>
        </details>
        ${isEditing ? renderFullscreenDocumentEditor(record) : renderFullscreenDocumentPreview(record, sections)}
      </section>
      ${state.modal ? renderModal(state.modal) : ""}
      ${renderHelpCenterNotifications()}
    </main>
  `;
}

function renderFullscreenDocumentPreview(record, sections) {
  const pptOutlineCallout = record.generationType === "lightweight_solution_ppt_outline"
    ? `
      <div class="nextStepCallout documentRouteCallout">
        <span>下一步建议：将这份结构稿自动填入本机 PPT Skill，生成可预览和下载的 PPTX。</span>
        <button type="button" data-action="generate-ppt-from-outline" data-id="${record.id}">生成PPT</button>
      </div>
    `
    : "";
  if (record.generationType === "interaction_image") {
    return `
      <article class="documentRouteContent documentRouteSections">
        <section id="doc-section-${record.id}-0" class="documentRouteSection interactionDocumentRouteSection">
          ${renderInteractionImageBoard(record)}
        </section>
      </article>
    `;
  }
  if (!sections.length) {
    return `
      <article class="documentRouteContent documentRouteSections">
        <section id="doc-section-${record.id}-0" class="documentRouteSection">
          <div class="markdownPane">${markdownToHtml(record.outputContent || "暂无内容")}</div>
        </section>
        ${pptOutlineCallout}
      </article>
    `;
  }
  return `
    <article class="documentRouteContent documentRouteSections">
      ${sections.map((section, index) => `
        <section id="doc-section-${record.id}-${index}" class="documentRouteSection">
          <div class="documentRouteSectionHead">
            <span>${escapeHtml(section.title)}</span>
            <button type="button" data-action="copy-report-section" data-id="${record.id}" data-section="${index}">复制本节</button>
          </div>
          <div class="markdownPane">${markdownToHtml(section.markdown)}</div>
        </section>
      `).join("")}
      ${pptOutlineCallout}
    </article>
  `;
}

function renderFullscreenDocumentEditor(record) {
  return `
    <form id="historyEditForm" class="documentRouteEditor">
      <input type="hidden" name="id" value="${escapeAttr(record.id)}">
      <label>
        文档标题
        <input class="documentTitleInput" name="title" value="${escapeAttr(record.title || generationTypes[record.generationType] || "AI 文档")}">
      </label>
      <label>
        Markdown 内容
        <textarea class="markdownEditor" name="outputContent" spellcheck="false">${escapeHtml(record.outputContent || "")}</textarea>
      </label>
      <footer class="documentRouteEditorActions">
        <span>支持标题、表格、代码块、Mermaid、引用、任务列表、链接与图片等 Markdown 格式。</span>
        <button class="ghostButton" type="button" data-action="cancel-edit-history">取消</button>
        <button class="primaryButton" type="submit">保存文档</button>
      </footer>
    </form>
  `;
}

function renderCustomerFiles(customer) {
  const files = state.db.customerFiles.filter((item) => item.customerId === customer.id);
  const pageKey = `files_${customer.id}`;
  const pagination = paginateItems(files, pageKey);
  return `
    <div class="sectionHead">
      <div>
        <h3>客户资料</h3>
        <p>支持录入聊天记录、需求文档、方案、报价单等资料，上传后会解析成客户上下文，供 AI 对话、策略生成和历史复盘使用。</p>
      </div>
      <button class="primaryButton" type="button" data-action="open-file-modal" data-id="${customer.id}">新增资料</button>
    </div>
    <div class="fileGrid">
      ${pagination.items.map((file) => `
        <article class="fileCard">
          <strong>${escapeHtml(file.fileName || "未命名资料")}</strong>
          <span>${escapeHtml(file.fileType || "资料")} · ${formatDate(file.createdAt)}</span>
          ${renderTextPreview(file.fileName || "客户资料", file.parsedText || "暂无解析文本")}
        </article>
      `).join("") || renderEmptyState("暂无客户资料", "可以录入聊天记录、需求文档、方案、报价单等资料摘要。")}
    </div>
    ${renderPaginationControls(pageKey, pagination)}
  `;
}

function renderAiView() {
  const customer = getAiCustomer();
  const isDefaultWorkspace = !customer;
  const memoryCount = customer
    ? state.db.customerMemories.filter((item) => item.customerId === customer.id && item.status !== "disabled").length
    : 0;
  const activeSession = getActiveChatSession();
  const histories = getAiHistoryForCurrentWorkspace(customer)
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const historyPagination = paginateItems(histories, `chatHistory_${customer?.id || "default"}`);

  const hasMessages = Boolean(activeSession?.messages?.length);

  return `
    <section class="aiLayout doubaoChatLayout ${state.aiChatPanelOpen ? "aiChatPanelOpen" : ""} ${hasMessages ? "hasChatMessages" : "emptyChatMessages"}">
      <aside class="aiRail">
        <div class="aiRailTop">
          <div class="aiRailHead">
            <span>对话线程</span>
            <strong>${isDefaultWorkspace ? "默认 AI 工作台" : escapeHtml(customer.name)}</strong>
          </div>
          <button class="ghostButton aiRailNewButton" type="button" data-action="new-chat-session">新建对话</button>
        </div>
        <div class="aiRailSessionList">
          ${renderChatSessionList(customer)}
        </div>
        <div class="aiRailHistoryList">
          ${historyPagination.items.map((item) => `
            <button type="button" data-action="open-history" data-id="${item.id}">
              <strong>${escapeHtml(generationTypes[item.generationType] || "AI 生成")}</strong>
              <span>${escapeHtml(item.customerId ? findCustomerName(item.customerId) : "默认 AI 工作台")}${renderRecordJobStatusText(item)}</span>
            </button>
          `).join("") || `<p class="hintText">${isDefaultWorkspace ? "默认工作台暂无生成记录" : "当前客户暂无生成记录"}</p>`}
          ${renderPaginationControls(`chatHistory_${customer?.id || "default"}`, historyPagination)}
        </div>
      </aside>
      <section class="chatPanel">
        <div class="chatHeader">
          <div>
            <div class="sectionKicker">${isDefaultWorkspace ? "默认 AI 工作台" : "客户售前助手"}</div>
            <h2>${escapeHtml(activeSession?.title || customer?.name || "默认 AI 对话")}</h2>
            <p class="chatContextHint">${activeSession?.subtitle || (isDefaultWorkspace
              ? "默认对话是一个 Agent：自动做意图识别、任务规划、工具调度、RAG/Skill/image2 执行与结果校验。"
              : `当前对话只读取该客户上下文，已沉淀 ${memoryCount} 条客户记忆。`)}</p>
          </div>
          <div class="chatHeaderActions">
            <span>${escapeHtml(activeSession?.modeLabel || (isDefaultWorkspace ? "GPT-5.5 · 自动意图" : "客户记忆隔离"))}</span>
            ${renderChatContextPill(customer, activeSession)}
            <button class="ghostButton" type="button" data-action="clear-chat">清空对话</button>
          </div>
        </div>
        <div class="chatMessages" id="chatMessages">
          ${renderChatMessages()}
        </div>
        ${isDefaultWorkspace ? renderGlobalHistoryPreview() : ""}
        <form id="chatForm" class="chatComposer">
          <div class="composerShell">
            ${renderChatAttachmentTray()}
            <textarea name="message" rows="1" placeholder="${isDefaultWorkspace ? "给 AI CRM 一个任务，例如：规划市场部上线节奏，或调用 image2 生成产品视觉图" : "询问这个客户的下一步策略、会议提纲、方案大纲或复盘建议"}"></textarea>
            <input id="chat-file-input" type="file" multiple hidden>
            <div class="composerMeta">
              <div class="composerQuickTools">
                <button type="button" data-action="pick-chat-files">添加文件</button>
                <button class="${state.aiChatPanelOpen && state.aiChatPanelMode === "customer" ? "active" : ""}" type="button" data-action="open-chat-panel" data-mode="customer">${customer ? `客户：${escapeHtml(customer.name)}` : "选择客户"}</button>
                <button class="${state.aiChatPanelOpen && state.aiChatPanelMode === "skill" ? "active" : ""}" type="button" data-action="open-chat-panel" data-mode="skill">${state.aiSkillId ? `Skill：${escapeHtml(getSkillName(state.aiSkillId))}` : "选择 Skill"}</button>
                <button class="${state.aiChatPanelOpen && state.aiChatPanelMode === "model" ? "active" : ""}" type="button" data-action="open-chat-panel" data-mode="model">模型</button>
              </div>
              <div class="composerActions">
                ${activeChatAbortController ? `<button class="ghostButton pauseComposerButton" type="button" data-action="pause-chat">暂停</button>` : ""}
                <button class="primaryButton" type="submit">发送</button>
              </div>
            </div>
          </div>
          ${state.aiChatPanelOpen ? renderChatToolbar(customer, activeSession) : ""}
        </form>
      </section>
    </section>
  `;
}

function renderChatAttachmentTray() {
  const attachments = state.chatAttachments || [];
  if (!attachments.length) {
    return `<div class="chatAttachmentHint">可粘贴、拖入或添加文件，AI 会把解析文本作为本轮上下文</div>`;
  }
  return `
    <div class="chatAttachmentTray">
      ${attachments.map((file, index) => `
        <span class="chatAttachmentChip" title="${escapeAttr(file.fileName || "附件")}">
          <strong>${escapeHtml(file.fileName || "附件")}</strong>
          <small>${escapeHtml(formatFileSize(file.size || 0))}</small>
          <button type="button" data-action="remove-chat-attachment" data-index="${index}" aria-label="移除附件">×</button>
        </span>
      `).join("")}
    </div>
  `;
}

function renderChatToolbar(customer, activeSession) {
  const mode = state.aiChatPanelMode || "customer";
  const skillLabel = state.chatSkillExplicit && state.aiSkillId ? getSkillName(state.aiSkillId) : "";
  const summary = [
    customer ? `已连接客户：${customer.name}` : "当前为默认 AI 工作台",
    skillLabel ? `已选择 Skill：${skillLabel}` : "纯模型回复",
    activeSession?.title || "当前会话"
  ];
  return `
    <div class="chatToolbarPanel ${mode}">
      <div class="chatToolbarHeader">
        <button type="button" class="${state.aiChatPanelMode === "customer" ? "active" : ""}" data-action="set-chat-panel-mode" data-mode="customer">客户上下文</button>
        <button type="button" class="${state.aiChatPanelMode === "skill" ? "active" : ""}" data-action="set-chat-panel-mode" data-mode="skill">Skill 输出</button>
        <button type="button" class="${state.aiChatPanelMode === "model" ? "active" : ""}" data-action="set-chat-panel-mode" data-mode="model">模型</button>
      </div>
      <p class="chatToolbarSummary">${escapeHtml(summary.join(" · "))}</p>
      <div class="chatToolbarGrid">
        <label class="toolbarField modeCustomer">
          <span>当前会话</span>
          ${renderSelect("chat-session", buildChatSessionOptions(customer), state.chatSessionId)}
        </label>
        <label class="toolbarField modeCustomer">
          <span>客户</span>
          ${renderSelect("chat-customer", [["", "默认 AI 工作台"], ...state.db.customers.map((item) => [item.id, item.name])], state.aiCustomerId || "")}
        </label>
        <label class="toolbarField modeSkill">
          <span>Skill</span>
          ${renderSelect("chat-skill", [["", customer ? "仅客户上下文（纯模型）" : "纯模型回复（不选 Skill）"], ...state.db.skills.map((item) => [item.id, item.name])], state.chatSkillExplicit ? state.aiSkillId || "" : "")}
        </label>
        <label class="toolbarField modeModel">
          <span>模型</span>
          ${renderSelect("chat-model", [["", "自动选择最佳模型"], ...state.db.models.map((item) => [item.id, `${item.name} · ${item.modelId}`])], "")}
        </label>
      </div>
      <div class="chatToolbarFooter">
        <label class="checkLine ${customer ? "" : "mutedCheck"}">
          <input id="chat-save" type="checkbox" checked>
          ${customer ? "保存结果到客户档案" : "保存到全局生成历史"}
        </label>
        <div class="chatToolbarActions">
          <button type="button" class="ghostButton" data-action="delete-chat-session" data-id="${escapeAttr(state.chatSessionId || "")}" ${state.chatSessionId ? "" : "disabled"}>删除会话</button>
          <button type="button" class="ghostButton" data-action="toggle-ai-chat-panel">收起</button>
        </div>
      </div>
    </div>
  `;
}

function renderChatContextPill(customer, activeSession) {
  const skillLabel = state.chatSkillExplicit && state.aiSkillId ? getSkillName(state.aiSkillId) : "";
  const label = [
    customer ? customer.name : "默认 Agent",
    skillLabel || (customer ? "客户上下文" : "纯模型")
  ].filter(Boolean).join(" · ");
  return `
    <button class="chatContextPill" type="button" data-action="open-chat-panel" data-mode="customer">
      ${escapeHtml(label || activeSession?.modeLabel || "对话设置")}
    </button>
  `;
}

function renderDefaultAiScenes() {
  return `
    <div class="defaultAiScenes">
      ${defaultAiScenes.map((scene) => `
        <article class="agentCapabilityCard" aria-label="${escapeAttr(scene.title)}">
          <strong>${escapeHtml(scene.title)}</strong>
          <span>${escapeHtml(scene.desc)}</span>
        </article>
      `).join("")}
    </div>
  `;
}

function renderGlobalHistoryPreview() {
  const record = state.db.aiGenerationRecords.find((item) => (
    item.id === state.selectedHistoryId
    && !item.customerId
    && isOwnedByCurrentUser(item)
  ));
  if (!record) return "";
  const sync = getFeishuSync(record);
  return `
    <section class="globalHistoryPreview">
      <div class="globalHistoryMeta">
        <strong>${escapeHtml(record.title || generationTypes[record.generationType] || "默认 AI 历史")}</strong>
        <span>${escapeHtml(generationTypes[record.generationType] || "AI 生成")} · ${formatDate(record.createdAt)}${renderFeishuSyncMeta(record)}</span>
      </div>
      <div class="globalHistoryActions">
        <button class="ghostButton" type="button" data-action="copy-history" data-id="${record.id}">复制</button>
        <button class="ghostButton" type="button" data-action="open-report-feedback" data-id="${record.id}">反馈报告</button>
        <button class="ghostButton" type="button" data-action="sync-history-feishu" data-id="${record.id}">${sync ? "重新同步飞书" : "同步飞书"}</button>
        ${renderFeishuOpenLink(record)}
      </div>
      <button type="button" data-action="close-global-history" aria-label="关闭全局历史">×</button>
      <article class="markdownPane compactMarkdown">${markdownToHtml(record.outputContent || "暂无内容")}</article>
    </section>
  `;
}

function renderSettingsView() {
  const collection = state.settingsTab;
  const list = state.db[collection] || [];
  const pageKey = `settings_${collection}`;
  const pagination = paginateItems(list, pageKey);
  return `
    <section class="contentBand settingsBand">
      <div class="tabs">
        ${settingTabs.map(([tab, label]) => `
          <button class="${collection === tab ? "active" : ""}" type="button" data-action="settings-tab" data-tab="${tab}">
            ${escapeHtml(label)}
          </button>
        `).join("")}
      </div>
      <div class="sectionHead">
        <div>
          <h3>${escapeHtml(collectionLabels[collection])}</h3>
          <p>${escapeHtml(getSettingsDescription(collection))}</p>
        </div>
        ${collection === "reportFeedbacks" ? "" : `<button class="primaryButton" type="button" data-action="open-setting-modal" data-collection="${collection}">新增</button>`}
      </div>
      <div class="settingList">
        ${pagination.items.map((item) => renderSettingItem(collection, item)).join("") || renderEmptyState("暂无配置", "可以先新增一条配置。")}
      </div>
      ${renderPaginationControls(pageKey, pagination)}
    </section>
  `;
}

function renderSettingItem(collection, item) {
  const view = getSettingItemView(collection, item);
  const hasKnowledgeChunks = collection === "knowledgeBases" && (item.documents || []).some((doc) => Number(doc.chunkCount || doc.chunks?.length || 0) > 0);
  return `
    <article class="settingItem">
      <div>
        <strong>${escapeHtml(view.title)}</strong>
        <p>${escapeHtml(view.desc || "暂无说明")}</p>
        <span>${escapeHtml(view.meta)}</span>
      </div>
      <div class="settingActions">
        ${collection === "knowledgeBases" ? `<button type="button" data-action="open-knowledge-chunks" data-id="${item.id}" ${hasKnowledgeChunks ? "" : "disabled"}>切片</button>` : ""}
        ${collection === "reportFeedbacks" && item.recordId ? `<button type="button" data-action="open-history" data-id="${escapeAttr(item.recordId)}">原报告</button>` : ""}
        <button type="button" data-action="edit-setting" data-collection="${collection}" data-id="${item.id}">${collection === "reportFeedbacks" ? "查看" : "编辑"}</button>
        ${collection === "models" && isAdmin() ? `<button type="button" data-action="test-model" data-id="${item.id}">测试</button>` : ""}
        ${isAdmin() ? `<button class="dangerMini" type="button" data-action="delete-setting" data-collection="${collection}" data-id="${item.id}">删除</button>` : ""}
      </div>
    </article>
  `;
}

function getSettingItemView(collection, item) {
  if (collection === "users") {
    return {
      title: item.name || item.email || item.id,
      desc: [item.email, item.employeeNo, item.department, item.position, item.phone].filter(Boolean).join(" · "),
      meta: `${item.role === "admin" ? "管理员" : "内部用户"} · ${item.status || "active"}`
    };
  }
  if (collection === "knowledgeBases") {
    const documents = item.documents || [];
    const chunkCount = documents.reduce((sum, doc) => sum + Number(doc.chunkCount || doc.chunks?.length || 0), 0);
    return {
      title: item.name || item.id,
      desc: item.description || "用于 AI 对话和方案生成的 RAG 知识库。",
      meta: `${item.status || "enabled"} · ${documents.length} 个文档 · ${chunkCount} 个向量片段`
    };
  }
  if (collection === "reportFeedbacks") {
    const status = normalizeHelpCenterStatus(getReportFeedbackStatus(item));
    return {
      title: item.recordTitle || "AI 报告反馈",
      desc: `${item.feedbackContent || "暂无反馈内容"}${item.aiOptimizationSuggestion ? `\n优化建议：${stripPlainText(item.aiOptimizationSuggestion, 140)}` : ""}`,
      meta: `${item.customerName || "默认 AI 工作台"} · 反馈人：${item.userName || "内部用户"} · ${formatDate(item.createdAt)} · ${getRecordJobStatusLabel(status)}`
    };
  }

  return {
    title: item.name || item.email || item.id,
    desc: item.description || item.promptContent || item.systemPrompt || item.modelId || item.type || "",
    meta: [
      item.status || (item.enabled === false ? "disabled" : "enabled"),
      item.stage ? getStageName(item.stage) : "",
      item.toolType ? `工具：${item.toolType}` : "",
      Array.isArray(item.applicableStages) ? `${item.applicableStages.length} 个阶段` : ""
    ].filter(Boolean).join(" · ")
  };
}

function renderModal(modal) {
  const modalClass = [
    modal.type === "knowledgeChunks" ? "wide" : "",
    modal.type === "interactionImage" ? "interactionImageModalPanel wide" : ""
  ].filter(Boolean).join(" ");
  return `
    <div class="modalBackdrop" role="presentation">
      <section class="modalPanel ${modalClass}" role="dialog" aria-modal="true">
        <header>
          <h2>${escapeHtml(modal.title)}</h2>
          <button type="button" data-action="close-modal" aria-label="关闭">×</button>
        </header>
        ${renderModalBody(modal)}
      </section>
    </div>
  `;
}

function renderModalBody(modal) {
  if (modal.type === "customer") return renderCustomerForm(modal.item);
  if (modal.type === "follow") return renderFollowForm(modal.item, modal.customerId);
  if (modal.type === "strategy") return renderStrategyForm(modal.customerId, modal.stage, modal.skillId);
  if (modal.type === "interactionImage") return renderInteractionImageForm(modal.customerId);
  if (modal.type === "interactionImageRegenerate") return renderInteractionImageRegenerateForm(modal.recordId, modal.itemId);
  if (modal.type === "imagePreview") return renderImagePreviewModal(modal.recordId, modal.itemId);
  if (modal.type === "lightweightSolution") return renderLightweightSolutionForm(modal.customerId);
  if (modal.type === "textDetail") return renderTextDetailModal(modal.title, modal.text);
  if (modal.type === "failure") return renderFailureForm(modal.customerId);
  if (modal.type === "file") return renderFileForm(modal.customerId);
  if (modal.type === "reportFeedback") return renderReportFeedbackForm(modal.recordId);
  if (modal.type === "saveChatSolution") return renderSaveChatSolutionModal(modal.messageIndex);
  if (modal.type === "helpCenter") return renderHelpCenterModal();
  if (modal.type === "setting") return renderSettingForm(modal.collection, modal.item);
  if (modal.type === "knowledgeChunks") return renderKnowledgeChunksModal(modal.knowledgeBaseId, modal.documentId);
  return "";
}

function renderSaveChatSolutionModal(messageIndex) {
  const session = getActiveChatSession();
  const messages = session?.messages || [];
  const message = messages[Number(messageIndex)];
  if (!message || message.role !== "assistant" || !String(message.content || "").trim()) {
    return `
      <div class="modalForm saveChatSolutionModal">
        ${renderEmptyState("没有可保存的 AI 回复", "请先完成一次 AI 回答后再保存为方案。")}
        <footer class="modalActions">
          <button type="button" class="ghostButton" data-action="close-modal">关闭</button>
        </footer>
      </div>
    `;
  }

  const keyword = String(state.saveChatSolutionKeyword || "").trim().toLowerCase();
  const preferredCustomerId = message.meta?.customerId || message.skillCard?.customerId || session?.customerId || "";
  const customers = (state.db.customers || [])
    .filter((customer) => {
      if (!keyword) return true;
      const haystack = [
        customer.name,
        customer.contactName,
        customer.customerType,
        customer.source,
        customer.nextAction,
        customer.demandDescription,
        getUserName(customer.ownerId)
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    })
    .sort((a, b) => {
      if (a.id === preferredCustomerId) return -1;
      if (b.id === preferredCustomerId) return 1;
      return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    })
    .slice(0, 12);
  const preview = stripPlainText(message.content, 180);

  return `
    <div class="modalForm saveChatSolutionModal">
      <section class="saveChatSolutionIntro">
        <div>
          <strong>${escapeHtml(session?.title || "AI 对话方案")}</strong>
          <p>${escapeHtml(preview || "这条 AI 回复将作为方案保存到所选客户的 AI 分析模块。")}</p>
        </div>
        <span>保存后自动进入客户详情 · AI 分析</span>
      </section>
      <label class="saveChatSolutionSearch">
        <span>选择要归档的客户</span>
        <input id="saveChatSolutionSearch" value="${escapeAttr(state.saveChatSolutionKeyword || "")}" placeholder="搜索客户名称、销售人员、类型、下一步动作">
      </label>
      <div class="saveChatCustomerList">
        ${customers.map((customer) => `
          <button class="${customer.id === preferredCustomerId ? "recommended" : ""}" type="button" data-action="confirm-save-chat-solution" data-index="${escapeAttr(messageIndex)}" data-id="${escapeAttr(customer.id)}">
            <span class="tableAvatar">${escapeHtml(customer.name.slice(0, 1))}</span>
            <span>
              <strong>${escapeHtml(customer.name)}</strong>
              <small>${escapeHtml(getStageName(customer.stage))} · ${escapeHtml(customer.customerType || "未分类")} · 销售：${escapeHtml(getUserName(customer.ownerId))}</small>
            </span>
            ${customer.id === preferredCustomerId ? `<em>推荐</em>` : ""}
          </button>
        `).join("") || renderEmptyState("没有匹配客户", "换个关键词试试，或先新增客户后再保存。")}
      </div>
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">取消</button>
      </footer>
    </div>
  `;
}

function renderTextDetailModal(title, text) {
  return `
    <div class="modalForm textDetailPane">
      <div class="markdownPane">${markdownToHtml(text || "暂无内容")}</div>
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">关闭</button>
      </footer>
    </div>
  `;
}

function renderImagePreviewModal(recordId, itemId) {
  const { record, item } = findInteractionBoardItem(recordId, itemId);
  if (!record || !item) return renderEmptyState("未找到图片", "请刷新后重新打开画板。");
  return `
    <div class="modalForm imagePreviewModal">
      <div class="imagePreviewCanvas">
        ${item.imageUrl ? `<img src="${escapeAttr(item.imageUrl)}" alt="${escapeAttr(item.title || "交互图")}">` : renderEmptyState("图片未生成", item.error || "这张图片还在生成或已失败。")}
      </div>
      <div class="contextMini">
        <h3>${escapeHtml(item.title || "交互图")}</h3>
        <p>${escapeHtml(item.goal || item.layout || "暂无说明")}</p>
      </div>
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">关闭</button>
        <button type="button" class="ghostButton" data-action="copy-interaction-image-prompt" data-id="${escapeAttr(record.id)}" data-item-id="${escapeAttr(item.id)}">复制提示词</button>
        <button type="button" class="primaryButton" data-action="download-interaction-image" data-id="${escapeAttr(record.id)}" data-item-id="${escapeAttr(item.id)}">下载图片</button>
      </footer>
    </div>
  `;
}

function renderInteractionImageRegenerateForm(recordId, itemId) {
  const { record, item } = findInteractionBoardItem(recordId, itemId);
  if (!record || !item) return renderEmptyState("未找到图片", "请刷新后重新打开画板。");
  return `
    <form id="interactionImageRegenerateForm" class="modalForm interactionRegenerateForm">
      <input type="hidden" name="recordId" value="${escapeAttr(record.id)}">
      <input type="hidden" name="itemId" value="${escapeAttr(item.id)}">
      <div class="strategyIntro">
        <strong>${escapeHtml(item.title || "重新生成交互图")}</strong>
        <p>系统会读取原提示词、原图链接和你的修改意见，重新调用 image2 生成当前这一张图，不影响同一画板的其他图片。</p>
      </div>
      ${item.imageUrl ? `<img class="regenerateSourceImage" src="${escapeAttr(item.imageUrl)}" alt="${escapeAttr(item.title || "原图")}">` : ""}
      ${textareaField("修改意见", "modification", "例如：整体更像飞书文档风格，减少深色渐变，突出 AI 推荐动作卡片和移动端详情页。", true)}
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">取消</button>
        <button type="submit" class="primaryButton">提交重新生成</button>
      </footer>
    </form>
  `;
}

function renderStrategyForm(customerId, selectedStage, selectedSkillId = "") {
  const customer = getCustomer(customerId);
  if (!customer) return renderEmptyState("未选择客户", "请先从客户列表进入客户详情。");
  const stage = selectedStage || customer.stage;
  const enabledSkills = getStrategySkillCatalog(stage);
  const skillOptions = enabledSkills.map((skill) => [skill.id, skill.name]);
  const recommendedSkillId = selectedSkillId || getRecommendedSkill({ ...customer, stage })?.id || enabledSkills[0]?.id || "";
  const recommendations = buildContextRecommendations({ ...customer, stage });
  const selectedSkill = enabledSkills.find((skill) => skill.id === recommendedSkillId);
  const selectedGenerationType = inferGenerationTypeFromSkill(selectedSkill);

  return `
    <form id="strategyForm" class="modalForm">
      <input type="hidden" name="customerId" value="${escapeAttr(customer.id)}">
      <div class="strategyIntro">
        <strong>${escapeHtml(customer.name)}</strong>
        <p>AI 会读取当前客户档案、客户记忆、已保存 AI 文档、资料解析文本、跟进记录和所选 Skill。所有文本类 Skill 都从这里触发，生成结果会归档到当前客户历史。</p>
      </div>
      <div class="formGrid two">
        <label>
          选择阶段
          <select id="strategy-stage" name="stage">
            ${state.db.stages.filter((item) => item.enabled !== false).map((item) => `
              <option value="${escapeAttr(item.id)}" ${item.id === stage ? "selected" : ""}>${escapeHtml(item.name)}</option>
            `).join("")}
          </select>
        </label>
        ${selectField("选择 Skill", "skillId", skillOptions, recommendedSkillId)}
      </div>
      <div class="strategySelectedMeta">
        <span>输出类型：${escapeHtml(generationTypes[selectedGenerationType] || "跟进策略")}</span>
        <span>客户记忆：仅当前客户</span>
        <span>反馈：生成后可提交给管理员</span>
      </div>
      <div class="skillCatalogList">
        ${enabledSkills.map((skill) => `
          <button class="${skill.id === recommendedSkillId ? "active" : ""}" type="button" data-action="choose-strategy-skill" data-id="${skill.id}">
            <strong>${escapeHtml(skill.name)}</strong>
            <span>${escapeHtml(skill.description || "内部 Skill")}</span>
          </button>
        `).join("")}
      </div>
      <div class="contextMini">
        <h3>本次生成会参考的上下文</h3>
        ${recommendations.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
        <p>面向客户的 Skill 会优先联动：已保存到客户档案的 AI 文档、客户记忆、最近生成历史、客户资料解析文本和当前跟进记录。</p>
      </div>
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">取消</button>
        <button class="primaryButton" type="submit">调用 AI 生成</button>
      </footer>
    </form>
  `;
}

function renderInteractionImageForm(customerId) {
  const customer = getCustomer(customerId);
  if (!customer) return renderEmptyState("未选择客户", "请先从客户列表进入客户详情。");
  const recommendedSkill = state.db.skills.find((skill) => skill.name.includes("交互图生成") && skill.status !== "disabled");
  const draftState = getInteractionDraftState(customer.id);
  const selectedStyle = draftState.styleMode === "__custom" ? "__custom" : draftState.style || "__auto";
  const selectedWebsiteType = draftState.websiteTypeMode === "__custom" ? "__custom" : draftState.websiteType || "__auto";
  const drafts = draftState.drafts || [];
  const hasDrafts = drafts.length > 0;

  return `
    <form id="interactionImageForm" class="modalForm interactionImageForm">
      <input type="hidden" name="customerId" value="${escapeAttr(customer.id)}">
      <input type="hidden" name="userId" value="${escapeAttr(state.user.id)}">
      <input type="hidden" name="skillId" value="${escapeAttr(recommendedSkill?.id || "")}">
      <input type="hidden" name="step" value="${hasDrafts ? "images" : "drafts"}">
      <div class="interactionWizardHero">
        <div>
          <span>Interaction Board</span>
          <strong>${escapeHtml(customer.name)}</strong>
          <p>先让 AI 基于当前客户上下文拆出每个界面的内容与 image2 提示词，你可以逐张编辑；确认后再按数量逐步生成图片，并归档到当前客户详情。</p>
        </div>
        <ol class="interactionSteps">
          <li class="active"><span>1</span>选择方向</li>
          <li class="${hasDrafts ? "active" : ""}"><span>2</span>编辑界面稿</li>
          <li><span>3</span>生成画板</li>
        </ol>
      </div>
      <div class="formGrid two">
        ${selectField("设计风格", "style", interactionStyleOptions, selectedStyle)}
        ${selectField("网站类型", "websiteType", websiteTypeOptions, selectedWebsiteType)}
        ${inputField("自定义风格", "customStyle", draftState.customStyle || "", false, "text")}
        ${inputField("自定义类型", "customWebsiteType", draftState.customWebsiteType || "", false, "text")}
        ${selectField("图片数量", "imageCount", interactionImageCountOptions, draftState.imageCount || 3)}
        ${selectField("草稿默认设备", "defaultDevice", interactionDeviceOptions, draftState.defaultDevice || "桌面端")}
      </div>
      ${textareaField("补充要求", "extraRequirement", draftState.extraRequirement || "", false)}
      <div class="interactionPreview">
        <div class="desktopFramePreview">
          <span></span>
          <strong>Desktop</strong>
          <p>默认优先生成 PC 端产品界面；每张草稿也可以单独改成手机端或响应式。</p>
        </div>
        <div class="phoneFramePreview">
          <span></span>
          <strong>Mobile</strong>
          <p>这个只是草稿视觉参考；真正是否出桌面端、移动端或双端，直接在下方每张界面稿里单独选。</p>
        </div>
      </div>
      ${hasDrafts ? `
        <section class="interactionDraftWorkspace">
          <div class="sectionHead compact">
            <div>
              <h3>界面内容与提示词</h3>
              <p>每张图片会一一对应下面的界面稿。可以修改标题、说明和 image2 提示词后再生成。</p>
            </div>
            <button type="submit" class="ghostButton" name="submitMode" value="drafts">重新生成界面内容</button>
          </div>
          <div class="interactionDraftList">
            ${drafts.map((draft, index) => renderInteractionDraftCard(draft, index)).join("")}
          </div>
        </section>
      ` : `
        <section class="interactionDraftPlaceholder">
          <strong>第一步：生成可编辑界面内容</strong>
          <p>系统会读取客户需求、客户资料、跟进记录、前期咨询报告、轻量级方案和历史生成结果，输出每个界面的标题、目标、布局、关键文案和 image2 提示词；每张图都可以单独选设备。</p>
        </section>
      `}
      <div class="contextMini">
        <h3>本次会自动读取</h3>
        ${buildContextRecommendations(customer).map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
      </div>
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">取消</button>
        ${hasDrafts ? `
          <button type="submit" class="primaryButton" name="submitMode" value="images">生成图片画板</button>
        ` : `
          <button type="submit" class="primaryButton" name="submitMode" value="drafts">生成界面内容</button>
        `}
      </footer>
    </form>
  `;
}

function renderInteractionDraftCard(draft = {}, index = 0) {
  return `
    <article class="interactionDraftCard">
      <div class="interactionDraftCardHead">
        <span>#${index + 1}</span>
        <label>
          界面标题
          <input name="draftTitle_${index}" value="${escapeAttr(draft.title || `界面 ${index + 1}`)}">
        </label>
        <label>
          设备
          <select name="draftDevice_${index}">
            ${interactionDeviceOptions.map(([device, label]) => `
              <option value="${escapeAttr(device)}" ${String(draft.device || "桌面端") === device ? "selected" : ""}>${escapeHtml(label)}</option>
            `).join("")}
          </select>
        </label>
      </div>
      <label>
        页面目标
        <textarea name="draftGoal_${index}" rows="2">${escapeHtml(draft.goal || "")}</textarea>
      </label>
      <label>
        页面内容与布局
        <textarea name="draftLayout_${index}" rows="3">${escapeHtml(draft.layout || draft.description || "")}</textarea>
      </label>
      <label>
        Image2 提示词
        <textarea name="draftPrompt_${index}" rows="6" required>${escapeHtml(draft.prompt || "")}</textarea>
      </label>
    </article>
  `;
}

function renderLightweightSolutionForm(customerId) {
  const customer = getCustomer(customerId);
  if (!customer) return renderEmptyState("未选择客户", "请先从客户列表进入客户详情。");
  const recommendedSkill = state.db.skills.find((skill) => skill.name.includes("轻量级方案") && skill.status !== "disabled");
  const consultationReport = getLatestCustomerGeneration(customer.id, "consultation_advice");

  return `
    <form id="lightweightSolutionForm" class="modalForm lightweightSolutionForm">
      <input type="hidden" name="customerId" value="${escapeAttr(customer.id)}">
      <input type="hidden" name="skillId" value="${escapeAttr(recommendedSkill?.id || "")}">
      <div class="strategyIntro">
        <strong>生成轻量级方案</strong>
        <p>可补充本次方案生成需要重点参考的功能信息；如暂未整理，可直接跳过，系统将基于当前客户上下文生成。</p>
      </div>
      <div class="contextMini">
        <h3>本次会自动读取</h3>
        <p>客户基础信息、已记录需求、项目类型、目标、历史备注、销售跟进记录、客户资料解析文本，以及最近一次前期咨询回应报告。</p>
        <p>${consultationReport ? "已检测到前期咨询回应策略报告，会作为重要参考内容。" : "当前暂无前期咨询回应策略报告，系统会直接基于客户上下文与跟进记录生成。"}</p>
      </div>
      ${textareaField("基础功能模块", "basicModules", "", false)}
      ${textareaField("端口范围", "portScope", "", false)}
      ${textareaField("已确认的核心功能", "confirmedCoreFeatures", "", false)}
      ${textareaField("可补充方向", "supplementDirections", "", false)}
      ${textareaField("AI 诉求", "aiNeeds", "", false)}
      ${textareaField("备注", "notes", "", false)}
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">取消</button>
        <button type="submit" class="ghostButton" name="submitMode" value="skip">跳过并生成</button>
        <button type="submit" class="primaryButton" name="submitMode" value="filled">根据补充内容生成</button>
      </footer>
    </form>
  `;
}

function renderContextSheet(customerId) {
  const customer = getCustomer(customerId);
  if (!customer) return renderEmptyState("未选择客户", "请先从客户列表进入客户详情。");
  const recommendations = buildContextRecommendations(customer);

  return `
    <div class="modalForm contextSheet">
      <div class="contextHeader inline">
        <span>当前客户</span>
        <strong>${escapeHtml(customer.name)}</strong>
      </div>
      <div class="contextBlock">
        <h3>当前阶段</h3>
        <div class="stageTrack horizontal">
          ${state.db.stages.filter((item) => item.enabled !== false).map((stage) => `
            <button class="${stage.id === customer.stage ? "active" : ""}" type="button" data-action="set-customer-stage" data-stage="${stage.id}">
              ${escapeHtml(stage.name)}
            </button>
          `).join("")}
        </div>
      </div>
      <div class="contextBlock">
        <h3>推荐动作</h3>
        ${recommendations.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
      </div>
      <div class="contextBlock">
        <h3>可用 Skill</h3>
        ${getEnabledSkills().slice(0, 16).map((skill) => `
          <button class="skillChip" type="button" data-action="open-strategy-modal" data-id="${customer.id}" data-skill="${skill.id}">${escapeHtml(skill.name)}</button>
        `).join("") || `<p>暂无匹配 Skill</p>`}
      </div>
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">关闭</button>
        <button class="primaryButton" type="button" data-action="open-strategy-modal" data-id="${customer.id}">生成跟进策略</button>
      </footer>
    </div>
  `;
}

function renderCustomerForm(customer = {}) {
  const consultationSkill = state.db.skills.find((skill) => skill.name.includes("前期咨询回应策略") && skill.status !== "disabled");
  return `
    <form id="customerForm" class="modalForm">
      <input type="hidden" name="id" value="${escapeAttr(customer.id || "")}">
      <input type="hidden" name="consultationAdviceSkillId" value="${escapeAttr(consultationSkill?.id || "")}">
      <section class="customerCreateOptions">
        <label class="optionSwitch">
          <input name="generateConsultationAdvice" type="checkbox">
          <span>
            <strong>生成客户咨询后跟进建议</strong>
            <small>保存客户后自动调用「客户前期咨询回应策略 Skill」，读取客户信息、资料解析文本和案例库，生成建议报告。</small>
          </span>
        </label>
        <label class="customerUploadBox">
          <span>上传客户资料文档</span>
          <small>支持 TXT、Markdown、CSV/TSV、JSON、HTML、XLSX、PPTX、DOCX、PDF；单次总量 ≤ ${formatFileSize(KNOWLEDGE_UPLOAD_LIMIT_BYTES)}，保存后自动解析为客户上下文资料。</small>
          <input id="customer-file-input" type="file" multiple accept=".txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.log,.xlsx,.pptx,.docx,.pdf,text/*,application/json,text/csv">
        </label>
      </section>
      <div class="formGrid two">
        ${inputField("客户名称", "name", customer.name, true)}
        ${inputField("联系人", "contactName", customer.contactName)}
        ${inputField("电话", "contactPhone", customer.contactPhone)}
        ${inputField("微信", "contactWechat", customer.contactWechat)}
        ${inputField("邮箱", "contactEmail", customer.contactEmail)}
        ${selectField("客户来源", "source", sourceOptions, customer.source)}
        ${selectField("客户类型", "customerType", typeOptions, customer.customerType)}
        ${selectField("当前阶段", "stage", state.db.stages.map((item) => [item.id, item.name]), customer.stage || "initial_contact")}
        ${selectField("客户状态", "status", statusOptions, customer.status || "跟进中")}
        ${selectField("销售人员", "ownerId", state.db.users.map((item) => [item.id, `${item.name}${item.department ? ` · ${item.department}` : ""}`]), customer.ownerId || state.user.id)}
        ${inputField("预计金额", "estimatedAmount", customer.estimatedAmount, false, "number")}
        ${selectField("成交概率", "dealProbability", probabilityOptions, customer.dealProbability || "中")}
        ${inputField("下一步动作", "nextAction", customer.nextAction)}
        ${inputField("下次跟进时间", "nextFollowTime", toLocalDatetime(customer.nextFollowTime), false, "datetime-local")}
      </div>
      ${textareaField("客户原始需求", "demandDescription", customer.demandDescription)}
      ${textareaField("客户业务背景", "background", customer.background)}
      ${textareaField("想解决的问题", "problemToSolve", customer.problemToSolve)}
      ${textareaField("已有系统或业务基础", "existingSystem", customer.existingSystem)}
      ${textareaField("预算情况", "budgetInfo", customer.budgetInfo)}
      ${textareaField("决策链信息", "decisionInfo", customer.decisionInfo)}
      ${textareaField("当前已知风险", "knownRisks", customer.knownRisks)}
      ${textareaField("内部备注", "internalNotes", customer.internalNotes)}
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">取消</button>
        <button class="primaryButton" type="submit">保存客户</button>
      </footer>
    </form>
  `;
}

function renderFollowForm(record = {}, customerId) {
  const customer = getCustomer(customerId || record.customerId);
  return `
    <form id="followForm" class="modalForm">
      <input type="hidden" name="id" value="${escapeAttr(record.id || "")}">
      <input type="hidden" name="customerId" value="${escapeAttr(customer?.id || "")}">
      <input type="hidden" name="userId" value="${escapeAttr(record.userId || state.user.id)}">
      <div class="formGrid two">
        ${inputField("客户", "customerName", customer?.name, false, "text", true)}
        ${inputField("跟进时间", "followTime", toLocalDatetime(record.followTime || new Date().toISOString()), true, "datetime-local")}
        ${selectField("跟进方式", "followMethod", followMethods, record.followMethod || "会议")}
        ${selectField("跟进阶段", "stage", state.db.stages.map((item) => [item.id, item.name]), record.stage || customer?.stage || "initial_contact")}
        ${inputField("下一步动作", "nextAction", record.nextAction)}
        ${inputField("下次跟进时间", "nextFollowTime", toLocalDatetime(record.nextFollowTime), false, "datetime-local")}
      </div>
      ${textareaField("跟进内容", "content", record.content, true)}
      ${textareaField("客户反馈", "customerFeedback", record.customerFeedback)}
      ${textareaField("内部判断", "internalJudgement", record.internalJudgement)}
      ${textareaField("AI 总结", "aiSummary", record.aiSummary)}
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">取消</button>
        <button class="primaryButton" type="submit">保存跟进</button>
      </footer>
    </form>
  `;
}

function renderFailureForm(customerId) {
  const failureSkillId = getSkillIdByName("失败分析");
  return `
    <form id="failureForm" class="modalForm">
      <input type="hidden" name="customerId" value="${escapeAttr(customerId)}">
      <input type="hidden" name="userId" value="${escapeAttr(state.user.id)}">
      <input type="hidden" name="skillId" value="${escapeAttr(failureSkillId)}">
      <div class="formGrid two">
        ${inputField("失败时间", "failureTime", toLocalDatetime(new Date().toISOString()), true, "datetime-local")}
        ${selectField("失败原因类型", "failureReasonType", failureReasons, "预算不足")}
      </div>
      ${textareaField("失败说明", "failureDescription", "")}
      ${textareaField("客户最终反馈", "customerFinalFeedback", "")}
      ${textareaField("聊天记录", "chatRecordText", "")}
      ${textareaField("内部复盘备注", "internalReview", "")}
      <label class="checkLine"><input name="generateReport" type="checkbox" checked> 生成 AI 失败分析报告</label>
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">取消</button>
        <button class="dangerButton" type="submit">标记失败</button>
      </footer>
    </form>
  `;
}

function renderFileForm(customerId) {
  return `
    <form id="fileForm" class="modalForm">
      <input type="hidden" name="customerId" value="${escapeAttr(customerId)}">
      <div class="formGrid two">
        ${inputField("资料名称", "fileName", "", true)}
        ${inputField("资料类型", "fileType", "聊天记录")}
      </div>
      ${textareaField("解析文本", "parsedText", "", true)}
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">取消</button>
        <button class="primaryButton" type="submit">保存资料</button>
      </footer>
    </form>
  `;
}

function renderReportFeedbackForm(recordId) {
  const record = state.db.aiGenerationRecords.find((item) => item.id === recordId);
  if (!record) return renderEmptyState("未找到报告", "请刷新后重新打开生成历史。");
  const customerName = record.customerId ? findCustomerName(record.customerId) : "默认 AI 工作台";
  return `
    <form id="reportFeedbackForm" class="modalForm reportFeedbackForm">
      <input type="hidden" name="recordId" value="${escapeAttr(record.id)}">
      <div class="strategyIntro">
        <strong>${escapeHtml(record.title || generationTypes[record.generationType] || "AI 生成报告")}</strong>
        <p>${escapeHtml(customerName)} · ${escapeHtml(generationTypes[record.generationType] || "AI 生成")} · ${formatDate(record.createdAt)}</p>
      </div>
      ${textareaField("这个报告哪里不好、哪里不对", "feedbackContent", "", true)}
      <div class="contextMini">
        <h3>系统会记录</h3>
        <p>反馈人：${escapeHtml(state.user.name || state.user.email || "当前用户")}</p>
        <p>所属客户：${escapeHtml(customerName)}</p>
        <p>报告原内容入口：${escapeHtml(record.title || record.id)}</p>
        <p>AI 会基于原报告和反馈生成“下次应该如何优化”的建议，管理员可在系统设置的「报告反馈」查看。</p>
      </div>
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">取消</button>
        <button class="primaryButton" type="submit">提交反馈</button>
      </footer>
    </form>
  `;
}

function renderHelpCenterModal() {
  const items = getHelpCenterItems();
  const generatingCount = items.filter((item) => item.status === "generating").length;
  const completedCount = items.filter((item) => item.status === "completed").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  return `
    <div class="modalForm helpCenterPanel">
      <div class="helpCenterIntro">
        <div>
          <div class="sectionKicker">后台任务与通知</div>
          <h3>帮助中心</h3>
          <p>AI 生成不会再阻塞页面。任务提交后会在这里显示进度，完成后弹出通知卡片，点击即可查看详情。</p>
        </div>
        <button class="ghostButton" type="button" data-action="refresh-data">刷新</button>
      </div>
      <div class="helpCenterStats">
        <span>进行中 ${generatingCount}</span>
        <span>已完成 ${completedCount}</span>
        <span>失败 ${failedCount}</span>
      </div>
      <div class="helpCenterList">
        ${items.map(renderHelpCenterItem).join("") || renderEmptyState("暂无后台任务", "生成策略、方案、失败复盘或生图后，这里会出现任务卡片。")}
      </div>
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">关闭</button>
      </footer>
    </div>
  `;
}

function renderHelpCenterItem(item) {
  const statusClass = {
    generating: "generating",
    completed: "completed",
    failed: "failed",
    generated: "completed",
    open: "open",
    manual: "open"
  }[item.status] || "open";
  return `
    <article class="helpTaskCard ${statusClass}">
      <div>
        <span>${escapeHtml(item.kindLabel)} · ${escapeHtml(item.statusLabel)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.preview || "暂无预览")}</p>
        <small>${escapeHtml(item.customerName || "默认 AI 工作台")} · ${formatDate(item.createdAt)}</small>
        ${renderHelpCenterProcess(item)}
      </div>
      <div class="helpTaskActions">
        <button class="primaryButton" type="button" data-action="open-help-center-item" data-kind="${escapeAttr(item.kind)}" data-id="${escapeAttr(item.id)}">查看详情</button>
      </div>
    </article>
  `;
}

function renderHelpCenterProcess(item) {
  const steps = Array.isArray(item.steps) ? item.steps.filter((step) => step?.id) : [];
  if (!steps.length) return "";
  const latest = [...steps].reverse().find((step) => step.status === "running" || step.status === "failed" || step.status === "done") || steps[0];
  return `
    <details class="helpTaskProcess">
      <summary>${escapeHtml(latest.title || "任务过程")} · ${escapeHtml(getProcessStatusLabel(latest.status))}</summary>
      <div class="helpTaskProcessList">
        ${steps.map((step) => `
          <div class="helpTaskProcessStep ${escapeAttr(step.status || "pending")}">
            <span></span>
            <div>
              <strong>${escapeHtml(step.title || "处理任务")}</strong>
              <small>${escapeHtml(step.summary || step.detail || "等待执行")}</small>
            </div>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderSettingForm(collection, item = {}) {
  const fields = getSettingFields(collection, item);
  return `
    <form id="settingForm" class="modalForm" data-collection="${collection}">
      <input type="hidden" name="id" value="${escapeAttr(item.id || "")}">
      ${collection === "reportFeedbacks" ? `
        <input type="hidden" name="recordId" value="${escapeAttr(item.recordId || "")}">
        <input type="hidden" name="customerId" value="${escapeAttr(item.customerId || "")}">
        <input type="hidden" name="generationType" value="${escapeAttr(item.generationType || "")}">
        <input type="hidden" name="userId" value="${escapeAttr(item.userId || "")}">
      ` : ""}
      <div class="formGrid two">
        ${fields.map((field) => renderDynamicField(field, item)).join("")}
      </div>
      ${collection === "knowledgeBases" ? renderKnowledgeBaseUploadPanel(item) : ""}
      <footer class="modalActions">
        <button type="button" class="ghostButton" data-action="close-modal">取消</button>
        <button class="primaryButton" type="submit">保存${escapeHtml(collectionLabels[collection])}</button>
      </footer>
    </form>
  `;
}

function getSettingFields(collection, item) {
  if (collection === "stages") {
    return [
      ["name", "阶段名称", "text", true],
      ["sortOrder", "排序", "number"],
      ["description", "阶段说明", "textarea"],
      ["objective", "阶段目标", "textarea"],
      ["aiHelp", "AI 主要辅助", "textarea"],
      ["defaultPrompt", "默认提示词", "textarea"],
      ["enabled", "启用", "checkbox"]
    ];
  }
  if (collection === "skills") {
    return [
      ["name", "Skill 名称", "text", true],
      ["description", "Skill 描述", "textarea"],
      ["applicableStages", "适用阶段，逗号分隔", "textarea"],
      ["inputFields", "输入字段，逗号分隔", "textarea"],
      ["knowledgeBaseIds", "关联知识库 ID，逗号分隔", "textarea"],
      ["toolType", "工具类型", "select", [["", "无工具"], ["knowledge_base", "知识库 RAG"], ["web_search", "联网搜索"], ["web_crawl", "网页抓取"], ["company_research", "客户公开资料调研"], ["industry_research", "行业趋势调研"], ["competitive_research", "竞品分析"], ["policy_research", "政策/招投标/价格核验"]]],
      ["systemPrompt", "系统提示词", "textarea"],
      ["outputFormat", "输出格式", "textarea"],
      ["status", "状态", "select", [["enabled", "enabled"], ["disabled", "disabled"]]]
    ];
  }
  if (collection === "promptTemplates") {
    return [
      ["name", "模板名称", "text", true],
      ["stage", "阶段", "select", state.db.stages.map((stage) => [stage.id, stage.name])],
      ["scenario", "场景", "text"],
      ["promptContent", "提示词内容", "textarea"],
      ["outputFormat", "输出格式", "textarea"],
      ["status", "状态", "select", [["enabled", "enabled"], ["disabled", "disabled"]]]
    ];
  }
  if (collection === "models") {
    return [
      ["name", "模型名称", "text", true],
      ["provider", "供应商", "select", [["local", "local"], ["openai", "openai"], ["cliproxyapi", "cliproxyapi"]]],
      ["apiKey", "API Key", "password"],
      ["baseUrl", "Base URL", "text"],
      ["modelId", "Model ID", "text"],
      ["temperature", "temperature", "number"],
      ["maxTokens", "max tokens", "number"],
      ["isDefault", "默认模型", "checkbox"],
      ["status", "状态", "select", [["enabled", "enabled"], ["disabled", "disabled"]]]
    ];
  }
  if (collection === "users") {
    return [
      ["name", "姓名", "text", true],
      ["email", "邮箱", "email", true],
      ["employeeNo", "员工编号", "text"],
      ["department", "部门", "text"],
      ["position", "岗位", "text"],
      ["phone", "手机号", "text"],
      ["password", item.id ? "新密码，可留空" : "密码", "password", !item.id],
      ["role", "角色", "select", [["internal_user", "内部用户"], ["admin", "管理员"]]],
      ["status", "状态", "select", [["active", "active"], ["disabled", "disabled"]]]
    ];
  }
  if (collection === "knowledgeBases") {
    return [
      ["name", "知识库名称", "text", true],
      ["description", "知识库说明", "textarea"],
      ["type", "知识库类型", "text"],
      ["status", "状态", "select", [["enabled", "enabled"], ["disabled", "disabled"]]]
    ];
  }
  if (collection === "reportFeedbacks") {
    return [
      ["customerName", "所属客户", "text", true],
      ["recordTitle", "报告原内容入口", "text", true],
      ["userName", "反馈人", "text", true],
      ["feedbackContent", "反馈内容", "textarea", true],
      ["originalContentPreview", "报告原内容摘要", "textarea"],
      ["aiOptimizationSuggestion", "AI 分析应该如何优化", "textarea"],
      ["status", "状态", "select", [["open", "待处理"], ["generating", "生成中"], ["completed", "已完成"], ["failed", "失败"]]]
    ];
  }
  return [
    ["name", "名称", "text", true],
    ["description", "说明", "textarea"],
    ["type", "类型", "text"],
    ["status", "状态", "select", [["enabled", "enabled"], ["disabled", "disabled"]]]
  ];
}

function renderKnowledgeBaseUploadPanel(item = {}) {
  const documents = item.documents || [];
  const totalSize = documents.reduce((sum, doc) => sum + Number(doc.size || 0), 0);
  return `
    <section class="kbUploadPanel spanTwo">
      <div>
        <h3>RAG 文件上传与向量化</h3>
        <p>支持 TXT、Markdown、CSV/TSV、JSON、HTML，以及基础解析 XLSX、PPTX、DOCX、PDF。单次知识库上传上限 ${formatFileSize(KNOWLEDGE_UPLOAD_LIMIT_BYTES)}，保存后会自动解析、切片并生成本地向量。</p>
      </div>
      <label class="kbUploadBox">
        <span>选择表格或文件（≤ ${formatFileSize(KNOWLEDGE_UPLOAD_LIMIT_BYTES)}）</span>
        <input id="knowledge-file-input" type="file" multiple accept=".txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.log,.xlsx,.pptx,.docx,.pdf,text/*,application/json,text/csv">
      </label>
      <div class="kbDocumentSummary">
        <strong>已有文档：${documents.length} 个</strong>
        <span>${documents.reduce((sum, doc) => sum + Number(doc.chunkCount || doc.chunks?.length || 0), 0)} 个向量片段 · ${formatFileSize(totalSize)}</span>
      </div>
      ${documents.length ? `
        <div class="kbDocumentList">
          ${documents.slice(0, 6).map((doc) => `
            <div class="kbDocumentRow">
              <span>
                <strong>${escapeHtml(doc.fileName || "未命名文档")}</strong>
                <small>${escapeHtml(doc.fileType || "文件")} · ${formatFileSize(doc.size || 0)} · ${Number(doc.chunkCount || doc.chunks?.length || 0)} 个片段 · ${escapeHtml(doc.embeddingModel || "local-hash-v1")}</small>
              </span>
              <button type="button" data-action="open-knowledge-chunks" data-id="${escapeAttr(item.id || "")}" data-doc-id="${escapeAttr(doc.id || "")}">查看切片</button>
            </div>
          `).join("")}
        </div>
      ` : `<p class="hintText">还没有上传文档。上传后 AI 对话会按意图自动检索知识库。</p>`}
    </section>
  `;
}

function renderKnowledgeChunksModal(knowledgeBaseId, documentId = "") {
  const kb = state.db.knowledgeBases.find((item) => item.id === knowledgeBaseId);
  if (!kb) return renderEmptyState("未找到知识库", "请刷新后重试。");
  const documents = (kb.documents || []).filter((doc) => Number(doc.chunkCount || doc.chunks?.length || 0) > 0);
  const selectedDocument = documents.find((doc) => doc.id === documentId) || documents[0];
  if (!selectedDocument) {
    return `
      <div class="modalForm">
        ${renderEmptyState("暂无知识块", "这个知识库还没有完成解析和切片的文档。")}
        <footer class="modalActions">
          <button type="button" class="ghostButton" data-action="close-modal">关闭</button>
        </footer>
      </div>
    `;
  }

  const chunks = selectedDocument.chunks || [];
  const pageKey = `kb_chunks_${kb.id}_${selectedDocument.id}`;
  const pagination = paginateItems(chunks, pageKey);
  const totalChars = chunks.reduce((sum, chunk) => sum + String(chunk.text || "").length, 0);
  return `
    <div class="modalForm kbChunkModal">
      <aside class="kbChunkDocList">
        <div>
          <strong>${escapeHtml(kb.name || "知识库")}</strong>
          <span>${documents.length} 个文档 · ${documents.reduce((sum, doc) => sum + Number(doc.chunkCount || doc.chunks?.length || 0), 0)} 个切片</span>
        </div>
        ${documents.map((doc) => `
          <button class="${doc.id === selectedDocument.id ? "active" : ""}" type="button" data-action="open-knowledge-chunks" data-id="${escapeAttr(kb.id)}" data-doc-id="${escapeAttr(doc.id)}">
            <strong>${escapeHtml(doc.fileName || "未命名文档")}</strong>
            <span>${Number(doc.chunkCount || doc.chunks?.length || 0)} 片 · ${formatFileSize(doc.size || 0)}</span>
          </button>
        `).join("")}
      </aside>
      <section class="kbChunkDetail">
        <div class="kbChunkHero">
          <div>
            <div class="sectionKicker">切片详情</div>
            <h3>${escapeHtml(selectedDocument.fileName || "未命名文档")}</h3>
            <p>${escapeHtml(selectedDocument.parser || "parser")} · ${escapeHtml(selectedDocument.embeddingModel || "local-hash-v1")} · ${formatFileSize(selectedDocument.size || 0)}</p>
          </div>
          <div class="kbChunkStats">
            <span>${chunks.length} 个切片</span>
            <span>${totalChars.toLocaleString("zh-CN")} 字符</span>
            <span>${getChunkEmbeddingSize(chunks[0])} 维向量</span>
          </div>
        </div>
        <div class="kbChunkList">
          ${pagination.items.map((chunk, index) => renderKnowledgeChunkCard(chunk, pagination.start + index)).join("")}
        </div>
        ${renderPaginationControls(pageKey, pagination)}
      </section>
      <footer class="modalActions spanTwo">
        <button type="button" class="ghostButton" data-action="close-modal">关闭</button>
      </footer>
    </div>
  `;
}

function renderKnowledgeChunkCard(chunk, displayIndex) {
  const text = String(chunk.text || "").trim();
  const key = text.length > 520 ? registerTextDetail(`知识块 #${displayIndex}`, text) : "";
  return `
    <article class="kbChunkCard">
      <header>
        <strong>#${displayIndex} · ${escapeHtml(chunk.id || `chunk_${displayIndex}`)}</strong>
        <span>${text.length.toLocaleString("zh-CN")} 字符 · ${getChunkEmbeddingSize(chunk)} 维</span>
      </header>
      <pre>${escapeHtml(text.length > 520 ? `${text.slice(0, 520)}...` : text || "暂无文本")}</pre>
      ${key ? `<button class="inlineDetailButton" type="button" data-action="open-text-detail" data-key="${escapeAttr(key)}">查看完整切片</button>` : ""}
    </article>
  `;
}

function getChunkEmbeddingSize(chunk = {}) {
  return Number(chunk.embeddingDimensions || chunk.embedding?.length || 0) || 0;
}

function renderDynamicField(field, item) {
  const [name, label, type, extra] = field;
  const value = item[name];
  if (type === "textarea") return textareaField(label, name, Array.isArray(value) ? value.join("，") : value);
  if (type === "select") return selectField(label, name, extra || [], value);
  if (type === "checkbox") {
    const checked = value !== false && value !== "disabled";
    return `<label class="checkLine spanTwo"><input name="${name}" type="checkbox" ${checked ? "checked" : ""}> ${escapeHtml(label)}</label>`;
  }
  return inputField(label, name, value, Boolean(extra), type);
}

async function handleClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id;
  const shouldShowButtonLoading = target.tagName === "BUTTON" && buttonLoadingActions.has(action);
  if (shouldShowButtonLoading) setButtonLoading(target, true, getActionLoadingLabel(action));

  try {
  if (action === "switch-view") {
    state.view = target.dataset.view;
    render();
    scrollPageToTop();
    return;
  }
  if (action === "refresh-data") {
    await refreshData();
    return;
  }
  if (action === "open-help-center") {
    state.helpCenterOpen = true;
    openModal({ type: "helpCenter", title: "帮助中心" });
    return;
  }
  if (action === "logout") {
    localStorage.removeItem(SESSION_KEY);
    stopHelpCenterPolling(true);
    clearHelpCenterNotices();
    Object.assign(state, {
      user: null,
      token: "",
      db: null,
      chatByCustomer: {},
      chatSessions: {},
      chatSessionId: "",
      aiCustomerId: "",
      aiSkillId: "",
      chatSkillExplicit: false,
      chatToolMode: "",
      toast: "已退出登录",
      pendingImageJobs: {},
      helpCenterTaskStatuses: {},
      helpCenterOpen: false
    });
    render();
    return;
  }
  if (action === "open-customer" || action === "select-detail") {
    state.selectedCustomerId = id || state.selectedCustomerId;
    state.view = "detail";
    render();
    scrollPageToTop();
    return;
  }
  if (action === "open-customer-modal") {
    openModal({ type: "customer", title: "新增客户", item: {} });
    return;
  }
  if (action === "edit-customer") {
    openModal({ type: "customer", title: "编辑客户", item: getCustomer(id) });
    return;
  }
  if (action === "open-follow-modal") {
    openModal({ type: "follow", title: "新增跟进记录", customerId: id, item: {} });
    return;
  }
  if (action === "open-strategy-modal") {
    const customer = getCustomer(id || state.selectedCustomerId);
    openModal({ type: "strategy", title: "生成跟进策略", customerId: customer?.id, stage: customer?.stage, skillId: target.dataset.skill || "" });
    return;
  }
  if (action === "choose-strategy-skill") {
    const form = document.querySelector("#strategyForm");
    if (form?.elements.skillId) form.elements.skillId.value = id;
    document.querySelectorAll(".skillCatalogList button").forEach((button) => {
      button.classList.toggle("active", button.dataset.id === id);
    });
    const selectedSkill = state.db.skills.find((skill) => skill.id === id);
    const meta = document.querySelector(".strategySelectedMeta");
    if (meta) {
      const generationType = inferGenerationTypeFromSkill(selectedSkill);
      meta.innerHTML = `
        <span>输出类型：${escapeHtml(generationTypes[generationType] || "跟进策略")}</span>
        <span>客户记忆：仅当前客户</span>
        <span>反馈：生成后可提交给管理员</span>
      `;
    }
    return;
  }
  if (action === "open-interaction-image-modal") {
    const customer = getCustomer(id || state.selectedCustomerId);
    openModal({ type: "interactionImage", title: "生成交互图", customerId: customer?.id });
    return;
  }
  if (action === "add-customer-to-solution-library") {
    await addCustomerToSolutionLibrary(id || state.selectedCustomerId);
    return;
  }
  if (action === "edit-follow") {
    const record = state.db.followRecords.find((item) => item.id === id);
    openModal({ type: "follow", title: "编辑跟进记录", customerId: record?.customerId, item: record });
    return;
  }
  if (action === "open-failure-modal") {
    openModal({ type: "failure", title: "标记客户失败", customerId: id });
    return;
  }
  if (action === "delete-customer") {
    await deleteCustomer(id);
    return;
  }
  if (action === "open-file-modal") {
    openModal({ type: "file", title: "新增客户资料", customerId: id });
    return;
  }
  if (action === "open-text-detail") {
    const detail = state.textDetails[target.dataset.key];
    if (detail) openModal({ type: "textDetail", title: detail.title, text: detail.text });
    return;
  }
  if (action === "open-knowledge-chunks") {
    openModal({
      type: "knowledgeChunks",
      title: "知识块切片详情",
      knowledgeBaseId: id,
      documentId: target.dataset.docId || ""
    });
    return;
  }
  if (action === "close-modal") {
    if (state.modal?.type === "helpCenter") state.helpCenterOpen = false;
    state.modal = null;
    render();
    return;
  }
  if (action === "detail-tab") {
    state.detailTab = target.dataset.tab;
    render();
    return;
  }
  if (action === "settings-tab") {
    state.settingsTab = target.dataset.tab;
    render();
    return;
  }
  if (action === "open-setting-modal") {
    openModal({ type: "setting", title: `新增${collectionLabels[target.dataset.collection]}`, collection: target.dataset.collection, item: {} });
    return;
  }
  if (action === "edit-setting") {
    const collection = target.dataset.collection;
    openModal({
      type: "setting",
      title: `编辑${collectionLabels[collection]}`,
      collection,
      item: state.db[collection].find((item) => item.id === id)
    });
    return;
  }
  if (action === "delete-setting") {
    await deleteSetting(target.dataset.collection, id);
    return;
  }
  if (action === "test-model") {
    await testModel(id);
    return;
  }
  if (action === "generate") {
    await runGeneration(target.dataset.type, id || state.selectedCustomerId);
    return;
  }
  if (action === "generate-ppt-from-outline") {
    await generatePptFromOutline(id);
    return;
  }
  if (action === "open-lightweight-solution-modal") {
    openModal({ type: "lightweightSolution", title: "生成轻量级方案", customerId: id || state.selectedCustomerId });
    return;
  }
  if (action === "set-customer-stage") {
    await quickUpdateCustomerStage(target.dataset.stage);
    return;
  }
  if (action === "summarize-follow") {
    await summarizeFollow(id);
    return;
  }
  if (action === "open-history") {
    const record = state.db.aiGenerationRecords.find((item) => item.id === id);
    if (record && !record.customerId) {
      if (!isOwnedByCurrentUser(record)) {
        showToast("这条 AI 对话历史不属于当前用户，无法查看。");
        return;
      }
      state.selectedHistoryId = id;
      state.view = "ai";
      render();
      return;
    }
    focusHistoryRecord(id);
    state.editingHistoryId = "";
    render();
    scrollPageToTop();
    return;
  }
  if (action === "open-help-center-item") {
    openHelpCenterItem(target.dataset.kind, target.dataset.id);
    return;
  }
  if (action === "close-global-history") {
    state.selectedHistoryId = "";
    render();
    return;
  }
  if (action === "edit-history") {
    openDocumentRoute(id, true);
    state.selectedHistoryId = id;
    render();
    return;
  }
  if (action === "cancel-edit-history") {
    if (state.documentRoute) {
      state.documentRoute.mode = "view";
    } else {
      state.editingHistoryId = "";
    }
    render();
    return;
  }
  if (action === "open-document") {
    openDocumentRoute(id, false);
    render();
    return;
  }
  if (action === "close-document") {
    closeDocumentRoute();
    render();
    return;
  }
  if (action === "copy-history") {
    const record = state.db.aiGenerationRecords.find((item) => item.id === id);
    await navigator.clipboard?.writeText(record?.outputContent || "");
    showToast("已复制 AI 生成结果");
    return;
  }
  if (action === "copy-report-section") {
    const record = state.db.aiGenerationRecords.find((item) => item.id === id);
    const sections = extractMarkdownSections(record?.outputContent || "");
    const section = sections[Number(target.dataset.section || 0)];
    await navigator.clipboard?.writeText(section?.markdown || "");
    showToast("已复制当前模块");
    return;
  }
  if (action === "copy-interaction-image-prompt") {
    const { item } = findInteractionBoardItem(id, target.dataset.itemId);
    await navigator.clipboard?.writeText(item?.prompt || "");
    showToast("已复制图片提示词");
    return;
  }
  if (action === "copy-interaction-image-url") {
    const { item } = findInteractionBoardItem(id, target.dataset.itemId);
    await navigator.clipboard?.writeText(item?.imageUrl || "");
    showToast(item?.imageUrl ? "已复制图片链接" : "暂无可复制图片链接");
    return;
  }
  if (action === "download-interaction-image") {
    const { item } = findInteractionBoardItem(id, target.dataset.itemId);
    downloadInteractionImage(item);
    return;
  }
  if (action === "view-interaction-image") {
    const { item } = findInteractionBoardItem(id, target.dataset.itemId);
    if (item?.imageUrl) openModal({ type: "imagePreview", title: item.title || "查看交互图", recordId: id, itemId: target.dataset.itemId });
    else showToast("这张图片还没有生成成功");
    return;
  }
  if (action === "regenerate-interaction-image-item") {
    openModal({ type: "interactionImageRegenerate", title: "重新生成图片", recordId: id, itemId: target.dataset.itemId });
    return;
  }
  if (action === "regenerate-history") {
    const record = state.db.aiGenerationRecords.find((item) => item.id === id);
    if (!record?.customerId) {
      showToast("当前记录未绑定客户，无法重新生成");
      return;
    }
    if (record.generationType === "interaction_image") {
      openModal({ type: "interactionImage", title: "生成交互图", customerId: record.customerId });
      return;
    }
    if (record.generationType === "lightweight_solution_ppt") {
      const outlineRecordId = record.inputContext?.pptTask?.sourceOutlineRecordId;
      if (!outlineRecordId) {
        showToast("未找到这份 PPT 对应的结构稿，无法重新生成 PPT");
        return;
      }
      await generatePptFromOutline(outlineRecordId);
      return;
    }
    await runGeneration(record.generationType, record.customerId, record.skillId || "");
    return;
  }
  if (action === "save-history-to-customer") {
    await saveHistoryToCustomer(id);
    return;
  }
  if (action === "save-history-as-file") {
    await saveHistoryAsFollowPrep(id);
    return;
  }
  if (action === "export-history-pdf") {
    await exportHistoryPdf(id);
    return;
  }
  if (action === "dismiss-help-notice") {
    dismissHelpCenterNotice(target.dataset.id);
    return;
  }
  if (action === "open-report-feedback") {
    openModal({ type: "reportFeedback", title: "反馈 AI 报告", recordId: id });
    return;
  }
  if (action === "sync-history-feishu") {
    await syncHistoryToFeishu(id);
    return;
  }
  if (action === "clear-chat") {
    const chat = getActiveChat();
    chat.length = 0;
    state.chatAttachments = [];
    render();
    return;
  }
  if (action === "pick-chat-files") {
    document.querySelector("#chat-file-input")?.click();
    return;
  }
  if (action === "remove-chat-attachment") {
    state.chatAttachments.splice(Number(target.dataset.index || 0), 1);
    render();
    document.querySelector("#chatForm textarea[name='message']")?.focus();
    return;
  }
  if (action === "use-ai-scene") {
    applyDefaultAiScene(target.dataset.scene);
    return;
  }
  if (action === "toggle-ai-control") {
    state.aiControlCollapsed = !state.aiControlCollapsed;
    render();
    return;
  }
  if (action === "toggle-ai-chat-panel") {
    state.aiChatPanelOpen = !state.aiChatPanelOpen;
    if (state.aiChatPanelOpen) ensureChatSessionState();
    render();
    return;
  }
  if (action === "open-chat-panel") {
    state.aiChatPanelMode = target.dataset.mode || "customer";
    state.aiChatPanelOpen = true;
    ensureChatSessionState();
    render();
    return;
  }
  if (action === "set-chat-panel-mode") {
    state.aiChatPanelMode = target.dataset.mode || "customer";
    state.aiChatPanelOpen = true;
    render();
    return;
  }
  if (action === "new-chat-session") {
    createNewChatSession();
    render();
    queueChatScrollToBottom();
    return;
  }
  if (action === "select-chat-session") {
    if (activeChatAbortController) pauseActiveChatStream({ silent: true });
    state.chatSessionId = id;
    const session = findChatSessionById(id);
    state.aiCustomerId = session?.customerId || "";
    state.chatSkillExplicit = Boolean(session?.skillExplicit);
    state.aiSkillId = state.chatSkillExplicit ? (session?.skillId || "") : "";
    state.chatToolMode = state.chatSkillExplicit ? (session?.toolMode || "") : "";
    render();
    queueChatScrollToBottom();
    return;
  }
  if (action === "delete-chat-session") {
    deleteChatSession(target.dataset.id);
    render();
    return;
  }
  if (action === "pause-chat") {
    pauseActiveChatStream();
    return;
  }
  if (action === "regenerate-last-message") {
    await regenerateCurrentChat();
    return;
  }
  if (action === "copy-last-message") {
    await copyChatMessage(target.dataset.index);
    return;
  }
  if (action === "open-save-chat-solution-modal") {
    state.saveChatSolutionKeyword = "";
    openModal({ type: "saveChatSolution", title: "保存为方案", messageIndex: target.dataset.index });
    return;
  }
  if (action === "confirm-save-chat-solution") {
    await saveChatMessageToCustomer(target.dataset.index, id);
    return;
  }
  if (action === "save-chat-message-to-customer") {
    await saveChatMessageToCustomer(target.dataset.index);
    return;
  }
  if (action === "change-page") {
    state.pages[target.dataset.pageKey] = Number(target.dataset.page || 1);
    if (target.dataset.pageKey === "customers") {
      updateCustomerTable();
      return;
    }
    render();
    return;
  }
  } catch (error) {
    setBusy("");
    showToast(error.message || "操作失败");
  } finally {
    if (shouldShowButtonLoading && target.isConnected) {
      setButtonLoading(target, false);
    }
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const formId = form.getAttribute("id");
  if (form.dataset.submitting === "true") return;
  setFormSubmitting(form, true);

  try {
    if (formId === "loginForm") {
      await submitLogin(form);
      return;
    }
    if (formId === "customerForm") {
      await submitCustomer(form);
      return;
    }
    if (formId === "followForm") {
      await submitFollow(form);
      return;
    }
    if (formId === "strategyForm") {
      await submitStrategy(form);
      return;
    }
    if (formId === "interactionImageForm") {
      await submitInteractionImage(form, event.submitter);
      return;
    }
    if (formId === "interactionImageRegenerateForm") {
      await submitInteractionImageRegenerate(form);
      return;
    }
    if (formId === "lightweightSolutionForm") {
      await submitLightweightSolution(form, event.submitter);
      return;
    }
    if (formId === "failureForm") {
      await submitFailure(form);
      return;
    }
    if (formId === "fileForm") {
      await submitFile(form);
      return;
    }
    if (formId === "reportFeedbackForm") {
      await submitReportFeedback(form);
      return;
    }
    if (formId === "settingForm") {
      await submitSetting(form);
      return;
    }
    if (formId === "historyEditForm") {
      await submitHistoryEdit(form);
      return;
    }
    if (formId === "chatForm") {
      await submitChat(form);
    }
  } catch (error) {
    setBusy("");
    showToast(error.message || "操作失败");
  } finally {
    if (form.isConnected) setFormSubmitting(form, false);
  }
}

function handleInput(event) {
  if (event.target.id === "customerSearch" || event.target.id === "globalSearch") {
    state.filters.keyword = event.target.value;
    state.pages.customers = 1;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      if (state.view === "customers") {
        updateCustomerTable();
      }
    }, 120);
  }
  if (event.target.id === "saveChatSolutionSearch") {
    state.saveChatSolutionKeyword = event.target.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => render(), 120);
  }
}

function handleChange(event) {
  const target = event.target;
  const customerFilterIds = ["filter-stage", "filter-status", "filter-type", "filter-source", "filter-owner"];
  if (target.id === "filter-stage") state.filters.stage = target.value;
  if (target.id === "filter-status") state.filters.status = target.value;
  if (target.id === "filter-type") state.filters.type = target.value;
  if (target.id === "filter-source") state.filters.source = target.value;
  if (target.id === "filter-owner") state.filters.ownerId = target.value;
  if (customerFilterIds.includes(target.id)) {
    state.pages.customers = 1;
    updateCustomerTable();
    return;
  }
  if (target.id === "chat-customer") {
    state.aiCustomerId = target.value;
    const session = ensureActiveChatSession(target.value);
    syncChatStateFromSession(session);
    persistChatSessions();
    queueChatScrollToBottom();
  }
  if (target.id === "chat-skill") {
    const session = getActiveChatSession();
    state.chatSkillExplicit = Boolean(target.value);
    state.aiSkillId = state.chatSkillExplicit ? target.value : "";
    const skill = state.db.skills.find((item) => item.id === target.value);
    state.chatToolMode = String(skill?.toolType || "").toLowerCase() === "image2" ? "image2" : "";
    if (session) {
      session.skillId = state.aiSkillId || "";
      session.skillExplicit = state.chatSkillExplicit;
      session.toolMode = state.chatToolMode || "";
      session.updatedAt = new Date().toISOString();
      persistChatSessions();
    }
  }
  if (target.id === "chat-session") {
    state.chatSessionId = target.value;
    ensureChatSessionState();
    render();
    queueChatScrollToBottom();
    return;
  }
  if (target.id === "chat-file-input") {
    void addChatAttachmentsFromFiles(target.files || []);
    target.value = "";
    return;
  }
  if (target.id === "strategy-stage" && state.modal?.type === "strategy") state.modal.stage = target.value;
  if (["chat-customer", "chat-skill", "strategy-stage"].includes(target.id)) {
    render();
  }
}

function handleAppPaste(event) {
  if (state.view !== "ai") return;
  if (!event.target.closest?.("#chatForm")) return;
  const files = Array.from(event.clipboardData?.files || []);
  if (!files.length) return;
  event.preventDefault();
  void addChatAttachmentsFromFiles(files);
}

function handleAppDragOver(event) {
  if (state.view !== "ai") return;
  if (!event.dataTransfer?.types?.includes("Files")) return;
  event.preventDefault();
}

function handleAppDrop(event) {
  if (state.view !== "ai") return;
  if (!event.target.closest?.("#chatForm") && !event.target.closest?.(".chatPanel")) return;
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  event.preventDefault();
  void addChatAttachmentsFromFiles(files);
}

async function submitLogin(form) {
  setBusy("正在登录...");
  const payload = Object.fromEntries(new FormData(form));
  const data = await postJson("/api/crm/login", payload);
  state.user = data.user;
  state.token = data.token;
  state.db = data.db;
  state.lastLoadedAt = new Date().toISOString();
  state.view = "customers";
  state.detailTab = "overview";
  state.settingsTab = "stages";
  state.selectedCustomerId = state.db.customers[0]?.id || "";
  state.aiCustomerId = "";
  state.chatSessionId = "";
  state.aiSkillId = "";
  state.chatSkillExplicit = false;
  state.chatToolMode = "";
  state.chatSessions = readChatSessions();
  clearHelpCenterNotices();
  state.pendingImageJobs = {};
  state.helpCenterTaskStatuses = {};
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user: state.user, token: state.token }));
  ensureChatSessionState();
  setBusy("");
  showToast("登录成功");
  render();
}

async function refreshData() {
  setBusy("正在刷新数据...");
  await loadBootstrap();
  setBusy("");
  showToast("数据已刷新");
  render();
}

async function submitCustomer(form) {
  setBusy("正在保存客户...");
  const item = formToObject(form);
  const uploadedDocuments = await readCustomerUploads(form.querySelector("#customer-file-input")?.files || []);
  item.estimatedAmount = Number(item.estimatedAmount || 0);
  item.nextFollowTime = fromLocalDatetime(item.nextFollowTime);
  item.lastFollowTime = item.lastFollowTime || new Date().toISOString();
  const generateConsultationAdvice = form.elements.generateConsultationAdvice?.checked !== false && Boolean(item.name);
  const data = await postJson("/api/crm/customer-with-assets", {
    item,
    uploadedDocuments,
    generateConsultationAdvice,
    skillId: item.consultationAdviceSkillId || "",
    userId: state.user.id
  });
  state.selectedCustomerId = data.customer?.id || data.item?.id || item.id || "";
  state.modal = null;
  await loadBootstrap();
  state.view = "detail";
  state.detailTab = data.generation?.outputContent ? "history" : "overview";
  if (data.record?.id) {
    state.selectedHistoryId = data.record.id;
    registerHelpCenterRecord(data.record.id);
  }
  showToast(data.record?.id ? "客户已保存，前期咨询建议已进入后台生成队列" : "客户已保存");
  setBusy("");
  render();
}

async function submitFollow(form) {
  setBusy("正在保存跟进...");
  const item = formToObject(form);
  item.followTime = fromLocalDatetime(item.followTime);
  item.nextFollowTime = fromLocalDatetime(item.nextFollowTime);
  delete item.customerName;
  await postJson("/api/crm/upsert", { collection: "followRecords", item });

  const customer = getCustomer(item.customerId);
  if (customer) {
    await postJson("/api/crm/upsert", {
      collection: "customers",
      item: {
        ...customer,
        stage: item.stage || customer.stage,
        nextAction: item.nextAction || customer.nextAction,
        nextFollowTime: item.nextFollowTime || customer.nextFollowTime,
        lastFollowTime: item.followTime || new Date().toISOString()
      }
    });
  }

  state.modal = null;
  await loadBootstrap();
  state.detailTab = "follows";
  showToast("跟进记录已保存");
  setBusy("");
  render();
}

async function submitStrategy(form) {
  const item = formToObject(form);
  const customer = getCustomer(item.customerId);
  if (!customer) {
    showToast("请先选择客户");
    return;
  }

  if (item.stage && item.stage !== customer.stage) {
    await postJson("/api/crm/upsert", {
      collection: "customers",
      item: {
        ...customer,
        stage: item.stage
      }
    });
    await loadBootstrap();
  }

  state.modal = null;
  const selectedSkill = state.db.skills.find((skill) => skill.id === item.skillId);
  const generationType = inferGenerationTypeFromSkill(selectedSkill);
  await runGeneration(generationType, item.customerId, item.skillId || "");
}

async function submitInteractionImage(form, submitter) {
  const item = formToObject(form, submitter);
  const customer = getCustomer(item.customerId);
  if (!customer) {
    showToast("请先选择客户");
    return;
  }
  const submitMode = item.submitMode || submitter?.value || item.step || "drafts";
  const style = normalizeInteractionSelectValue(item.style, item.customStyle, "飞书风");
  const websiteType = normalizeInteractionSelectValue(item.websiteType, item.customWebsiteType, inferWebsiteType(customer));
  const imageCount = clamp(Number(item.imageCount || 3), 1, 8);
  const defaultDevice = normalizeInteractionDevice(item.defaultDevice || "桌面端");

  if (submitMode === "drafts") {
    const data = await postJson("/api/crm/interaction-image-drafts", {
      customerId: item.customerId,
      userId: state.user.id,
      skillId: item.skillId || "",
      style,
      websiteType,
      customStyle: item.customStyle || "",
      customWebsiteType: item.customWebsiteType || "",
      extraRequirement: item.extraRequirement || "",
      defaultDevice,
      imageCount
    });
    state.interactionImageDrafts[item.customerId] = {
      style,
      websiteType,
      styleMode: item.style === "__custom" ? "__custom" : "",
      websiteTypeMode: item.websiteType === "__custom" ? "__custom" : "",
      customStyle: item.customStyle || "",
      customWebsiteType: item.customWebsiteType || "",
      extraRequirement: item.extraRequirement || "",
      defaultDevice,
      imageCount,
      drafts: normalizeInteractionDrafts(data.drafts, imageCount, defaultDevice)
    };
    showToast("已生成界面内容，可以编辑后生成图片");
    render();
    return;
  }

  const imagePrompts = collectInteractionDraftsFromForm(form, imageCount);
  if (!imagePrompts.length) {
    showToast("请先生成或填写至少一张界面提示词");
    return;
  }

  const data = await postJson("/api/crm/generate-interaction-image", {
    ...item,
    style,
    websiteType,
    defaultDevice,
    imageCount: imagePrompts.length,
    imagePrompts,
    userId: state.user.id
  });
  delete state.interactionImageDrafts[item.customerId];
  state.modal = null;
  state.selectedCustomerId = item.customerId;
  state.view = "detail";
  state.detailTab = "history";
  await loadBootstrap();
  if (data.record?.id) {
    focusHistoryRecord(data.record.id, item.customerId);
    registerImageJob(data.record.id);
  } else {
    state.selectedCustomerId = item.customerId;
    state.view = "detail";
    state.detailTab = "history";
  }
  showToast(`交互图画板已创建，${imagePrompts.length} 张图片将逐步生成`, 4200);
  render();
}

async function submitInteractionImageRegenerate(form) {
  const item = formToObject(form);
  const modification = String(item.modification || "").trim();
  if (!modification) {
    showToast("请先填写修改意见");
    return;
  }
  const data = await postJson("/api/crm/regenerate-interaction-image-item", {
    recordId: item.recordId,
    itemId: item.itemId,
    modification,
    userId: state.user.id
  });
  state.modal = null;
  await loadBootstrap();
  if (data.record?.id) {
    focusHistoryRecord(data.record.id, data.record.customerId);
    registerImageJob(data.record.id);
  }
  showToast("已提交单张图片重新生成，完成后会自动通知", 3600);
  render();
}

function getInteractionDraftState(customerId) {
  const saved = state.interactionImageDrafts[customerId] || {};
  return {
    style: saved.style || "__auto",
    websiteType: saved.websiteType || inferWebsiteType(getCustomer(customerId) || {}) || "__auto",
    styleMode: saved.styleMode || "",
    websiteTypeMode: saved.websiteTypeMode || "",
    customStyle: saved.customStyle || "",
    customWebsiteType: saved.customWebsiteType || "",
    extraRequirement: saved.extraRequirement || "",
    defaultDevice: saved.defaultDevice || "桌面端",
    imageCount: saved.imageCount || 3,
    drafts: Array.isArray(saved.drafts) ? saved.drafts : []
  };
}

function normalizeInteractionSelectValue(value, customValue, fallback) {
  if (value === "__custom") return String(customValue || "").trim() || fallback || "";
  if (value === "__auto") return fallback || "";
  return String(value || "").trim() || fallback || "";
}

function normalizeInteractionDrafts(drafts, imageCount, defaultDevice = "桌面端") {
  const list = Array.isArray(drafts) ? drafts : [];
  return list.slice(0, imageCount).map((draft, index) => ({
    id: draft.id || `draft_${index + 1}`,
    title: draft.title || `界面 ${index + 1}`,
    device: normalizeInteractionDevice(draft.device || defaultDevice),
    goal: draft.goal || "",
    layout: draft.layout || draft.description || "",
    prompt: draft.prompt || draft.imagePrompt || ""
  }));
}

function normalizeInteractionDevice(value = "") {
  const text = String(value || "").trim();
  const allowed = interactionDeviceOptions.map(([device]) => device);
  if (allowed.includes(text)) return text;
  if (/双端|桌面.*移动|移动.*桌面|pc.*mobile|mobile.*pc|响应式/i.test(text)) return "桌面端 + 移动端";
  if (/画板|多端/i.test(text)) return "响应式画板";
  if (/手机|移动|mobile/i.test(text)) return "移动端";
  return "桌面端";
}

function collectInteractionDraftsFromForm(form, imageCount) {
  const drafts = [];
  for (let index = 0; index < imageCount; index += 1) {
    const prompt = form.elements[`draftPrompt_${index}`]?.value?.trim() || "";
    if (!prompt) continue;
    drafts.push({
      id: `image_${index + 1}`,
      title: form.elements[`draftTitle_${index}`]?.value?.trim() || `界面 ${index + 1}`,
      device: normalizeInteractionDevice(form.elements[`draftDevice_${index}`]?.value?.trim() || "桌面端"),
      goal: form.elements[`draftGoal_${index}`]?.value?.trim() || "",
      layout: form.elements[`draftLayout_${index}`]?.value?.trim() || "",
      prompt
    });
  }
  return drafts;
}

function getCustomerInteractionBoards(customerId) {
  return (state.db.aiGenerationRecords || [])
    .filter((record) => record.customerId === customerId && record.generationType === "interaction_image")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getInteractionImageBoard(record = {}) {
  const board = record?.inputContext?.interactionImageBoard || {};
  const items = Array.isArray(board.items) ? board.items : [];
  return {
    ...board,
    title: board.title || record.title || "交互图画板",
    items
  };
}

function countInteractionItems(items = [], targetStatus = "") {
  return items.filter((item) => normalizeHelpCenterStatus(item.status || "") === normalizeHelpCenterStatus(targetStatus)).length;
}

function findInteractionBoardItem(recordId, itemId) {
  const record = state.db?.aiGenerationRecords?.find((entry) => entry.id === recordId);
  const board = getInteractionImageBoard(record);
  const item = board.items.find((entry) => entry.id === itemId);
  return { record, board, item };
}

function downloadInteractionImage(item = {}) {
  if (!item?.imageUrl) {
    showToast("这张图片还没有生成成功");
    return;
  }
  const link = document.createElement("a");
  link.href = item.imageUrl;
  link.download = `${sanitizeFileName(item.title || "interaction-image")}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function sanitizeFileName(value = "") {
  return String(value || "file").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "file";
}

async function submitLightweightSolution(form, submitter) {
  const item = formToObject(form);
  const customer = getCustomer(item.customerId);
  if (!customer) {
    showToast("请先选择客户");
    return;
  }
  const submitMode = submitter?.value || "filled";
  const extraContext = {
    lightweightSolution: {
      basicModules: submitMode === "skip" ? "" : item.basicModules || "",
      portScope: submitMode === "skip" ? "" : item.portScope || "",
      confirmedCoreFeatures: submitMode === "skip" ? "" : item.confirmedCoreFeatures || "",
      supplementDirections: submitMode === "skip" ? "" : item.supplementDirections || "",
      aiNeeds: submitMode === "skip" ? "" : item.aiNeeds || "",
      notes: submitMode === "skip" ? "" : item.notes || ""
    }
  };

  state.modal = null;
  state.selectedCustomerId = item.customerId;
  state.view = "detail";
  state.detailTab = "history";
  render();

  const data = await postJson("/api/crm/generate", {
    type: "lightweight_solution",
    customerId: item.customerId,
    userId: state.user.id,
    skillId: item.skillId || "",
    saveToCustomer: false,
    extraContext
  });

  await loadBootstrap();
  if (data.record?.id) {
    focusHistoryRecord(data.record.id, item.customerId);
    registerHelpCenterRecord(data.record.id);
  } else {
    state.selectedCustomerId = item.customerId;
    state.detailTab = "history";
  }
  showToast("轻量级方案已进入后台生成队列，完成后会在帮助中心提醒");
  render();
}

async function submitFailure(form) {
  const item = formToObject(form);
  item.failureTime = fromLocalDatetime(item.failureTime);
  item.generateReport = form.elements.generateReport.checked;
  const data = await postJson("/api/crm/failure", item);
  state.modal = null;
  await loadBootstrap();
  if (data.record?.id) {
    focusHistoryRecord(data.record.id, item.customerId);
    registerHelpCenterRecord(data.record.id);
  } else {
    state.selectedCustomerId = item.customerId;
    state.detailTab = "history";
  }
  showToast(data.record?.id ? "已标记失败，复盘报告已进入后台生成队列" : "已标记失败");
  render();
}

async function submitFile(form) {
  setBusy("正在保存客户资料...");
  const item = formToObject(form);
  await postJson("/api/crm/upsert", { collection: "customerFiles", item });
  state.modal = null;
  await loadBootstrap();
  state.detailTab = "files";
  showToast("客户资料已保存");
  setBusy("");
  render();
}

async function submitReportFeedback(form) {
  const item = formToObject(form);
  const record = state.db.aiGenerationRecords.find((entry) => entry.id === item.recordId);
  const response = await postJson("/api/crm/report-feedback", {
    ...item,
    userId: state.user.id,
    customerId: record?.customerId || ""
  });
  state.modal = null;
  await loadBootstrap();
  if (record?.customerId) {
    state.selectedCustomerId = record.customerId;
    state.view = "detail";
    state.detailTab = "history";
    state.selectedHistoryId = record.id;
  } else {
    state.view = "ai";
    state.selectedHistoryId = record.id;
  }
  if (response.feedback?.id) registerReportFeedbackJob(response.feedback.id);
  showToast(response.feedback?.id ? "报告反馈已保存，优化建议已进入后台分析队列" : "报告反馈已保存");
  render();
}

async function submitSetting(form) {
  setBusy("正在保存配置...");
  const collection = form.dataset.collection;
  const item = formToObject(form);

  for (const checkbox of form.querySelectorAll("input[type='checkbox']")) {
    item[checkbox.name] = checkbox.checked;
  }
  if (collection === "skills") {
    item.applicableStages = splitList(item.applicableStages);
    item.inputFields = splitList(item.inputFields);
    item.knowledgeBaseIds = splitList(item.knowledgeBaseIds);
    item.toolType = item.toolType || "";
  }
  if (collection === "knowledgeBases") {
    item.uploadedDocuments = await readKnowledgeUploads(form.querySelector("#knowledge-file-input")?.files || []);
  }
  if (collection === "models") {
    item.temperature = Number(item.temperature || 0.2);
    item.maxTokens = Number(item.maxTokens || 3000);
  }
  if (collection === "stages") {
    item.sortOrder = Number(item.sortOrder || 999);
  }
  if (collection === "users" && !item.password) delete item.password;

  await postJson("/api/crm/upsert", { collection, item });
  state.modal = null;
  await loadBootstrap();
  showToast(`${collectionLabels[collection]}已保存`);
  setBusy("");
  render();
}

async function submitHistoryEdit(form) {
  const item = formToObject(form);
  const existing = state.db.aiGenerationRecords.find((record) => record.id === item.id);
  if (!existing) {
    showToast("未找到要编辑的 AI 文档");
    return;
  }
  if (!item.outputContent) {
    showToast("文档内容不能为空");
    return;
  }

  setBusy("正在保存 Markdown 文档...");
  const saved = await postJson("/api/crm/upsert", {
    collection: "aiGenerationRecords",
    item: {
      ...existing,
      title: item.title || existing.title,
      outputContent: item.outputContent
    }
  });
  await loadBootstrap();
  focusHistoryRecord(saved.item?.id || existing.id, existing.customerId);
  if (state.documentRoute) {
    state.documentRoute.recordId = saved.item?.id || existing.id;
    state.documentRoute.mode = "view";
  }
  state.editingHistoryId = "";
  showToast("AI 文档已保存");
  setBusy("");
  render();
}

async function readKnowledgeUploads(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return [];
  const maxFileSize = KNOWLEDGE_UPLOAD_LIMIT_BYTES;
  const maxTotalSize = KNOWLEDGE_UPLOAD_LIMIT_BYTES;
  const tooLarge = files.find((file) => file.size > maxFileSize);
  if (tooLarge) {
    throw new Error(`文件「${tooLarge.name}」超过 ${formatFileSize(maxFileSize)}，请先拆分或压缩后再上传。`);
  }
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > maxTotalSize) {
    throw new Error(`本次上传文件总大小超过 ${formatFileSize(maxTotalSize)}，请分批上传。`);
  }

  const uploads = [];
  for (const file of files) {
    uploads.push({
      fileName: file.name,
      fileType: file.name.split(".").pop() || file.type || "file",
      mimeType: file.type || "",
      size: file.size,
      base64: await readFileAsBase64(file)
    });
  }
  return uploads;
}

async function readCustomerUploads(fileList) {
  return readKnowledgeUploads(fileList);
}

async function addChatAttachmentsFromFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const existing = state.chatAttachments || [];
  if (existing.length + files.length > CHAT_ATTACHMENT_MAX_FILES) {
    showToast(`单轮对话最多附加 ${CHAT_ATTACHMENT_MAX_FILES} 个文件`);
    return;
  }
  const totalSize = existing.reduce((sum, file) => sum + Number(file.size || 0), 0)
    + files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (totalSize > CHAT_ATTACHMENT_LIMIT_BYTES) {
    showToast(`单轮附件总大小不能超过 ${formatFileSize(CHAT_ATTACHMENT_LIMIT_BYTES)}`);
    return;
  }

  try {
    const uploads = await readKnowledgeUploads(files);
    state.chatAttachments = [
      ...existing,
      ...uploads.map((file) => ({
        ...file,
        id: `chat_file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      }))
    ];
    showToast(`已添加 ${uploads.length} 个文件，本轮对话会自动解析作为上下文`);
    render();
    document.querySelector("#chatForm textarea[name='message']")?.focus();
  } catch (error) {
    showToast(error.message || "读取文件失败");
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取文件「${file.name}」失败`));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };
    reader.readAsDataURL(file);
  });
}

async function submitChat(form) {
  const message = form.elements.message.value.trim();
  const chatAttachments = [...(state.chatAttachments || [])];
  if (!message && !chatAttachments.length) return;
  if (activeChatAbortController) {
    showToast("上一条回复还在生成中，可以先暂停再发送新消息。");
    return;
  }

  ensureChatSessionState();
  let activeSession = getActiveChatSession();
  const isSimpleMessage = isSimpleChatMessage(message);
  const selectedSkillId = state.chatSkillExplicit
    ? (document.querySelector("#chat-skill")?.value || state.aiSkillId || activeSession.skillId || "")
    : "";
  const skillId = state.chatSkillExplicit ? selectedSkillId : (!isSimpleMessage ? selectedSkillId : "");
  const modelId = document.querySelector("#chat-model")?.value || "";
  const customerId = document.querySelector("#chat-customer")?.value || state.aiCustomerId || activeSession.customerId || "";
  const saveToCustomer = Boolean(customerId) && document.querySelector("#chat-save")?.checked !== false;
  if ((customerId || "") !== (state.aiCustomerId || "")) {
    state.aiCustomerId = customerId || "";
    activeSession = ensureActiveChatSession(customerId);
  }
  const chat = getActiveChat(customerId);
  const conversationHistory = buildConversationHistory(customerId, activeSession.id);
  const toolMode = state.chatSkillExplicit && !isSimpleMessage
    ? (state.chatToolMode || activeSession.toolMode || inferChatToolMode(message, skillId))
    : inferChatToolMode(message, skillId);
  const attachmentSummary = chatAttachments.length
    ? `\n\n${chatAttachments.map((file) => `> 附件：${file.fileName || "未命名文件"}（${formatFileSize(file.size || 0)}）`).join("\n")}`
    : "";
  const userMessage = {
    role: "user",
    content: `${message || "请分析附件内容"}${attachmentSummary}`,
    attachments: chatAttachments.map((file) => ({
      fileName: file.fileName,
      fileType: file.fileType,
      mimeType: file.mimeType,
      size: file.size
    })),
    createdAt: new Date().toISOString()
  };
  chat.push(userMessage);
  updateChatSessionTitleFromMessage(activeSession, message, customerId);
  updateChatChrome();
  const assistantMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    content: "",
    process: [],
    metadata: {},
    answerStarted: false,
    streaming: true,
    status: isSimpleMessage ? "AI 正在回复..." : customerId ? "正在准备客户对话上下文..." : "正在准备默认 AI 工作台...",
    meta: {
      customerId,
      skillId,
      sessionId: activeSession.id,
      hasSkill: Boolean(skillId)
    }
  };
  chat.push(assistantMessage);
  form.reset();
  state.chatAttachments = [];
  updateChatMessages();

  try {
    activeChatAbortController = new AbortController();
    activeSession.updatedAt = new Date().toISOString();
    activeSession.lastMessage = message;
    activeSession.customerId = customerId || "";
    activeSession.skillId = selectedSkillId || "";
    activeSession.skillExplicit = state.chatSkillExplicit && Boolean(selectedSkillId);
    activeSession.toolMode = toolMode || "";
    persistChatSessions();
    const data = await postJsonStream("/api/crm/generate-stream", {
      type: "chat",
      customerId,
      userId: state.user.id,
      skillId,
      modelId,
      message,
      toolMode: state.chatSkillExplicit ? toolMode : (isSimpleMessage ? "" : toolMode),
      extraContext: {
        conversationHistory,
        toolMode: state.chatSkillExplicit ? toolMode : (isSimpleMessage ? "" : toolMode),
        simpleQuery: isSimpleMessage,
        workspaceMode: customerId ? "customer" : "default_ai_workspace",
        chatSessionId: activeSession.id,
        chatSessionTitle: activeSession.title,
        chatSessionMode: activeSession.mode,
        chatAttachments
      },
      saveToCustomer
    }, {
      onStatus(message) {
        assistantMessage.status = message;
        queueChatMessagesUpdate();
      },
      onProcessStart(step) {
        mergeChatProcessStep(assistantMessage, step);
        assistantMessage.metadata = {
          ...(assistantMessage.metadata || {}),
          complexity: assistantMessage.metadata?.complexity || "complex"
        };
        queueChatMessagesUpdate();
      },
      onProcessUpdate(step) {
        mergeChatProcessStep(assistantMessage, step);
        queueChatMessagesUpdate();
      },
      onAnswerDelta(delta) {
        assistantMessage.content += delta;
        assistantMessage.answerStarted = true;
        assistantMessage.status = "";
        queueChatMessagesUpdate();
      },
      onDelta(delta) {
        assistantMessage.content += delta;
        assistantMessage.answerStarted = true;
        assistantMessage.status = "";
        queueChatMessagesUpdate();
      },
      onDone(payload) {
        if (Array.isArray(payload?.process)) {
          assistantMessage.process = payload.process;
        }
        if (payload?.metadata) {
          assistantMessage.metadata = {
            ...(assistantMessage.metadata || {}),
            ...payload.metadata
          };
        }
        const remoteFailure = payload?.generation?.inputContext?.remoteModelFailure;
        if (remoteFailure?.failed) {
          assistantMessage.remoteFailure = remoteFailure;
          assistantMessage.metadata = {
            ...(assistantMessage.metadata || {}),
            failed: true
          };
        }
      },
      signal: activeChatAbortController.signal
    });
    if (!assistantMessage.content && data?.generation?.outputContent) {
      assistantMessage.content = data.generation.outputContent;
    }
    if (data.record?.id && shouldRenderSkillResultCard({ skillId, record: data.record, toolMode })) {
      assistantMessage.skillCard = buildSkillResultCard(data.record, activeSession, customerId);
      if (skillId) {
        assistantMessage.content = `已完成「${generationTypes[data.record.generationType] || "Skill 输出"}」，我把完整内容整理成了文档卡片。点击下方卡片可以进入全屏文档查看、复制、反馈或保存到客户档案。`;
      } else if (data.record.generationType === "chat_image") {
        assistantMessage.content = "图片生成任务已提交到后台。你可以继续对话，完成后系统会在帮助中心提醒。";
      }
    }
    assistantMessage.streaming = false;
    assistantMessage.status = "";
    updateChatMessages();
    queueChatScrollToBottom();
    await loadBootstrap();
    if (data.record?.id) {
      const record = state.db.aiGenerationRecords.find((item) => item.id === data.record.id);
      if (record?.customerId) setHistoryPageForRecord(record.id, record.customerId);
      if (!record?.customerId) state.selectedHistoryId = "";
      if (data.image?.status === "generating" || getRecordJobStatus(record) === "generating") {
        registerImageJob(data.record.id);
        showToast(data.image?.status === "generating" ? "图片已进入后台生成队列，完成后会自动通知" : "AI 长任务已进入后台生成队列，完成后会自动通知", 4600);
      }
    }
    state.chatToolMode = "";
    activeSession.updatedAt = new Date().toISOString();
    activeSession.lastRecordId = data.record?.id || "";
    activeSession.lastMessage = message;
    persistChatSessions();
    updateChatChrome();
    queueChatMessagesUpdate();
    queueChatScrollToBottom();
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    assistantMessage.streaming = false;
    assistantMessage.status = "";
    assistantMessage.content = assistantMessage.content || (isAbort
      ? "> 已暂停生成，可点击「重新生成」再次请求。"
      : `# AI 对话失败\n\n${error.message || "流式生成失败，请稍后重试。"}`);
    updateChatMessages();
    queueChatScrollToBottom();
    activeSession.updatedAt = new Date().toISOString();
    activeSession.lastError = isAbort ? "用户暂停生成" : (error.message || "AI 对话失败");
    persistChatSessions();
    showToast(isAbort ? "已暂停当前回复" : (error.message || "AI 对话失败"));
  } finally {
    assistantMessage.streaming = false;
    activeChatAbortController = null;
    persistChatSessions();
    queueChatScrollToBottom();
  }
}

function isSimpleChatMessage(message = "") {
  const text = String(message || "").trim();
  if (!text) return true;
  if (/^(hi|hello|hey|嗨|哈喽|你好|在吗|在不|有人吗)$/i.test(text)) return true;
  if (/^(谢谢|辛苦了|好的|收到|ok|okay|ok了|明白了|了解了|拜拜|再见)$/i.test(text)) return true;
  if (/^(你是谁|你能做什么|你可以做什么|怎么用|怎么使用)$/.test(text)) return true;
  if (/^[\p{P}\p{S}\s]+$/u.test(text)) return true;
  return text.length <= 12 && !/(客户|方案|需求|跟进|分析|生成|报价|技能|skill|知识库|RAG|图片|交互图|PPT|总结|复盘|阶段|会话|文档|报告|业务|项目)/i.test(text);
}

function shouldRenderSkillResultCard({ skillId, record, toolMode }) {
  if (!record?.id) return false;
  if (skillId) return true;
  if (toolMode === "image2") return true;
  return record.generationType && record.generationType !== "chat";
}

function updateChatChrome() {
  if (state.view !== "ai") return;
  const customer = getAiCustomer();
  const activeSession = getActiveChatSession();
  const sessionList = document.querySelector(".aiRailSessionList");
  if (sessionList) {
    sessionList.innerHTML = renderChatSessionList(customer);
  }
  const title = document.querySelector(".chatHeader h2");
  if (title) title.textContent = activeSession?.title || customer?.name || "默认 AI 对话";
  const hint = document.querySelector(".chatContextHint");
  if (hint) {
    hint.textContent = activeSession?.subtitle || (customer
      ? `当前对话只读取该客户上下文，已沉淀 ${state.db.customerMemories.filter((item) => item.customerId === customer.id && item.status !== "disabled").length} 条客户记忆。`
      : "默认对话是一个 Agent：自动做意图识别、任务规划、工具调度、RAG/Skill/image2 执行与结果校验。");
  }
  const modeLabel = document.querySelector(".chatHeaderActions > span");
  if (modeLabel) modeLabel.textContent = activeSession?.modeLabel || (customer ? "客户记忆隔离" : "GPT-5.5 · 自动意图");
  const pill = document.querySelector(".chatContextPill");
  if (pill) {
    const skillLabel = state.chatSkillExplicit && state.aiSkillId ? getSkillName(state.aiSkillId) : "";
    pill.textContent = [
      customer ? customer.name : "默认 Agent",
      skillLabel || (customer ? "客户上下文" : "纯模型")
    ].filter(Boolean).join(" · ");
  }
}

function mergeChatProcessStep(message, step = {}) {
  if (!message || !step?.id) return;
  if (!Array.isArray(message.process)) message.process = [];
  const normalized = {
    id: String(step.id),
    title: step.title || "处理任务",
    status: step.status || "running",
    summary: step.summary || "",
    detail: step.detail || ""
  };
  const existingIndex = message.process.findIndex((item) => item.id === normalized.id);
  if (existingIndex >= 0) {
    message.process[existingIndex] = {
      ...message.process[existingIndex],
      ...normalized
    };
  } else {
    message.process.push(normalized);
  }
}

async function runGeneration(type, customerId, skillId = "") {
  if (!customerId) {
    showToast("请先选择客户");
    return;
  }
  if (type === "next_communication_question_list" && !getLatestCustomerGeneration(customerId, "consultation_advice")) {
    showToast("建议先生成前期咨询回应策略报告，本 Skill 将基于客户信息和历史跟进记录生成沟通问题清单。", 5200);
  }
  const data = await postJson("/api/crm/generate", {
    type,
    customerId,
    userId: state.user.id,
    skillId,
    saveToCustomer: false
  });
  await loadBootstrap();
  if (data.record?.id) {
    focusHistoryRecord(data.record.id, customerId);
    registerHelpCenterRecord(data.record.id);
  } else {
    state.selectedCustomerId = customerId;
    state.view = "detail";
    state.detailTab = "history";
  }
  showToast("AI 任务已提交后台生成，完成后会在帮助中心提醒");
  render();
}

async function addCustomerToSolutionLibrary(customerId) {
  if (!customerId) {
    showToast("请先选择客户");
    return;
  }
  const customer = getCustomer(customerId);
  if (!customer) {
    showToast("未找到当前客户");
    return;
  }
  const confirmed = window.confirm(`确认将「${customer.name}」当前所有上下文分析后加入历史方案库吗？\n\n系统会后台生成一份可复用方案沉淀，并自动完成知识库切片，供后续 Skill RAG 引用。`);
  if (!confirmed) return;

  const data = await postJson("/api/crm/customer-to-solution-library", {
    customerId,
    userId: state.user.id
  });
  await loadBootstrap();
  if (data.record?.id) {
    focusHistoryRecord(data.record.id, customerId);
    registerHelpCenterRecord(data.record.id);
  } else {
    state.selectedCustomerId = customerId;
    state.view = "detail";
    state.detailTab = "history";
  }
  showToast("已提交后台入库任务，完成后会自动写入历史方案库");
  render();
}

async function generatePptFromOutline(recordId) {
  const outlineRecord = state.db.aiGenerationRecords.find((item) => item.id === recordId);
  if (!outlineRecord) {
    showToast("未找到 PPT 结构稿");
    return;
  }
  if (getRecordJobStatus(outlineRecord) === "generating") {
    showToast("PPT 结构稿还在生成中，请完成后再生成 PPT");
    return;
  }
  if (getRecordJobStatus(outlineRecord) === "failed") {
    showToast("PPT 结构稿生成失败，请先重新生成结构稿");
    return;
  }

  const data = await postJson("/api/crm/generate-lightweight-solution-ppt", {
    outlineRecordId: recordId,
    customerId: outlineRecord.customerId,
    userId: state.user.id
  });
  await loadBootstrap();
  if (data.record?.id) {
    focusHistoryRecord(data.record.id, data.record.customerId || outlineRecord.customerId);
    registerHelpCenterRecord(data.record.id);
    const status = getRecordJobStatus(data.record);
    showToast(status === "failed" ? "PPT 任务创建失败，已保存失败原因，可重新生成" : "PPT 任务已提交后台生成，完成后会在帮助中心提醒");
  } else {
    focusHistoryRecord(recordId, outlineRecord.customerId);
    showToast("PPT 任务提交失败，请稍后重试");
  }
  render();
}

async function summarizeFollow(recordId) {
  const record = state.db.followRecords.find((item) => item.id === recordId);
  if (!record) return;
  const data = await postJson("/api/crm/generate", {
    type: "follow_summary",
    customerId: record.customerId,
    userId: state.user.id,
    message: record.content,
    extraContext: {
      followRecordId: record.id
    },
    saveToCustomer: false
  });
  await loadBootstrap();
  if (data.record?.id) {
    focusHistoryRecord(data.record.id, record.customerId);
    registerHelpCenterRecord(data.record.id);
  } else {
    state.detailTab = "follows";
  }
  showToast("跟进总结已进入后台生成队列，完成后会自动写回记录");
  render();
}

async function quickUpdateCustomerStage(stage) {
  const customer = getSelectedCustomer();
  if (!customer) return;
  await postJson("/api/crm/upsert", { collection: "customers", item: { ...customer, stage } });
  await loadBootstrap();
  showToast("客户阶段已更新");
  render();
}

async function deleteCustomer(id) {
  const customer = getCustomer(id);
  if (!customer) return;
  if (!window.confirm(`确认删除客户「${customer.name}」及其跟进、资料和 AI 历史吗？`)) return;
  await postJson("/api/crm/delete", { collection: "customers", id });
  await loadBootstrap();
  state.selectedCustomerId = state.db.customers[0]?.id || "";
  state.view = "customers";
  showToast("客户已删除");
  render();
}

async function deleteSetting(collection, id) {
  const item = state.db[collection]?.find((entry) => entry.id === id);
  if (!item) return;
  if (collection === "users" && id === state.user.id) {
    showToast("不能删除当前登录账号");
    return;
  }
  const label = item.name || item.email || item.id;
  if (!window.confirm(`确认删除「${label}」吗？`)) return;
  await postJson("/api/crm/delete", { collection, id });
  await loadBootstrap();
  showToast(`${collectionLabels[collection]}已删除`);
  render();
}

async function testModel(id) {
  setBusy("正在测试模型连接...");
  try {
    const data = await postJson("/api/crm/test-model", { modelId: id });
    const message = data.result?.message || "模型连接成功";
    showToast(message.replace(/\s+/g, " ").slice(0, 180));
  } finally {
    setBusy("");
  }
}

async function syncHistoryToFeishu(recordId) {
  const record = state.db.aiGenerationRecords.find((item) => item.id === recordId);
  if (!record) {
    showToast("未找到要同步的生成历史");
    return;
  }
  const confirmed = window.confirm("同步到飞书会把当前 AI 生成历史正文上传到已配置的飞书知识库或文件夹。是否继续？");
  if (!confirmed) return;

  const data = await postJson("/api/crm/sync-history-feishu", { recordId });
  await loadBootstrap();
  const refreshedRecord = state.db.aiGenerationRecords.find((item) => item.id === recordId) || record;
  if (refreshedRecord.customerId) {
    focusHistoryRecord(recordId, refreshedRecord.customerId);
  } else {
    state.selectedHistoryId = recordId;
    state.aiCustomerId = "";
    state.view = "ai";
  }
  showToast(data.result?.url ? "已同步到飞书，可点击“打开飞书”查看" : "已同步到飞书，但接口未返回打开链接");
  render();
}

async function saveHistoryToCustomer(recordId) {
  const record = state.db.aiGenerationRecords.find((item) => item.id === recordId);
  const customer = record?.customerId ? getCustomer(record.customerId) : null;
  if (!record || !customer) {
    showToast("未找到要保存的客户报告");
    return;
  }
  const savedAt = new Date().toISOString();
  await postJson("/api/crm/upsert", {
    collection: "aiGenerationRecords",
    item: {
      ...record,
      inputContext: {
        ...(record.inputContext || {}),
        customerArchive: {
          ...(record.inputContext?.customerArchive || {}),
          savedAt,
          savedBy: state.user.id,
          savedByName: state.user.name || state.user.email || "内部用户",
          customerId: customer.id,
          source: "manual_save_to_customer_archive"
        }
      },
      updatedAt: savedAt
    }
  });
  await loadBootstrap();
  state.selectedCustomerId = customer.id;
  state.selectedHistoryId = record.id;
  state.view = "detail";
  state.detailTab = "ai";
  showToast("已保存到客户档案，可在 AI 分析中查看");
  render();
}

async function saveHistoryAsFollowPrep(recordId) {
  const record = state.db.aiGenerationRecords.find((item) => item.id === recordId);
  if (!record?.customerId) {
    showToast("未找到要保存的客户报告");
    return;
  }
  await postJson("/api/crm/upsert", {
    collection: "customerFiles",
    item: {
      customerId: record.customerId,
      followRecordId: "",
      fileName: `${record.title || "下一步沟通问题清单"} - 跟进准备材料`,
      fileType: "跟进准备材料",
      parsedText: record.outputContent || "",
      createdAt: new Date().toISOString()
    }
  });
  await loadBootstrap();
  focusHistoryRecord(record.id, record.customerId);
  showToast("已保存为客户跟进准备材料");
  render();
}

async function exportHistoryPdf(recordId) {
  const record = state.db.aiGenerationRecords.find((item) => item.id === recordId);
  if (!record) {
    showToast("未找到要导出的报告");
    return;
  }
  const customer = record.customerId ? getCustomer(record.customerId) : null;
  const title = record.title || generationTypes[record.generationType] || "AI CRM 报告";
  const printWindow = window.open("", "_blank", "width=980,height=900");
  if (!printWindow) {
    showToast("浏览器阻止了导出窗口，请允许弹窗后重试");
    return;
  }
  printWindow.document.write(`
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(title)}</title>
        <style>
          body { margin: 0; padding: 36px; color: #141d2d; font-family: "Noto Sans SC", "PingFang SC", sans-serif; line-height: 1.65; }
          h1, h2, h3 { letter-spacing: -0.02em; }
          h1 { font-size: 26px; margin: 0 0 8px; }
          h2 { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e5e7eb; }
          table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 12px; }
          th, td { border: 1px solid #d8dee8; padding: 8px 10px; vertical-align: top; }
          th { background: #f6f8fb; }
          pre { white-space: pre-wrap; background: #f6f8fb; border: 1px solid #e5e7eb; padding: 14px; border-radius: 12px; }
          blockquote { margin: 12px 0; padding: 10px 14px; background: #f6f8fb; border-left: 4px solid #3b82f6; }
          .meta { color: #64748b; margin-bottom: 28px; }
          @media print { body { padding: 18mm; } button { display: none; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">${escapeHtml(customer?.name || "默认 AI 工作台")} · ${escapeHtml(generationTypes[record.generationType] || "AI 生成")} · ${formatDate(record.createdAt)}</div>
        ${markdownToHtml(record.outputContent || "暂无内容")}
        <script>window.addEventListener("load", () => setTimeout(() => window.print(), 120));</script>
      </body>
    </html>
  `);
  printWindow.document.close();
  showToast("已打开 PDF 导出窗口，可选择保存为 PDF");
}

function getFilteredCustomers() {
  const keyword = state.filters.keyword.trim().toLowerCase();
  return state.db.customers.filter((customer) => {
    const haystack = [
      customer.name,
      customer.contactName,
      customer.contactWechat,
      customer.customerType,
      customer.source,
      customer.nextAction,
      customer.demandDescription
    ].join(" ").toLowerCase();
    if (keyword && !haystack.includes(keyword)) return false;
    if (state.filters.stage && customer.stage !== state.filters.stage) return false;
    if (state.filters.status && customer.status !== state.filters.status) return false;
    if (state.filters.type && customer.customerType !== state.filters.type) return false;
    if (state.filters.source && customer.source !== state.filters.source) return false;
    if (state.filters.ownerId && customer.ownerId !== state.filters.ownerId) return false;
    return true;
  }).sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function getCustomerStats() {
  const customers = state.db.customers;
  const following = customers.filter((item) => item.status === "跟进中").length;
  const hot = customers.filter((item) => item.dealProbability === "高").length;
  const amount = customers.reduce((sum, item) => sum + Number(item.estimatedAmount || 0), 0);
  const next = customers
    .filter((item) => item.nextFollowTime)
    .sort((a, b) => new Date(a.nextFollowTime) - new Date(b.nextFollowTime))[0];
  return [
    { label: "今日新增客户", value: String(customers.length), note: "较昨日 ↑ 20%", icon: "客" },
    { label: "待跟进项目", value: String(following), note: "较昨日 ↑ 12%", icon: "项" },
    { label: "风险预警", value: String(customers.filter((item) => item.status === "失败" || item.dealProbability === "低").length), note: "较昨日 ↑ 40%", icon: "险" },
    { label: "转化率（近 7 天）", value: hot ? `${Math.round((hot / Math.max(customers.length, 1)) * 100)}%` : "32.6%", note: next ? `最近跟进：${formatDate(next.nextFollowTime)}` : `预计金额 ${formatMoney(amount)}`, icon: "%" }
  ];
}

function getCustomerScoreDots(customer) {
  const score = {
    高: 4,
    中: 3,
    低: 2
  }[customer.dealProbability] || (customer.status === "失败" ? 1 : 3);
  return Array.from({ length: 5 }, (_, index) => index < score);
}

function stripPlainText(value, limit = 80) {
  const text = String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~|[\]-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function buildWorkbenchFallbackPreview(customer) {
  return [
    `# ${customer.name}方案（草稿）`,
    "",
    `客户：${customer.name}`,
    `阶段：${getStageName(customer.stage)}`,
    "",
    "## 一、客户需求摘要",
    "",
    customer.demandDescription || "客户需求待补充，建议先完成一次需求澄清沟通。",
    "",
    "## 二、方案亮点",
    "",
    ...getStageMaterials(customer.stage).slice(0, 4).map((item) => `- ${item}`),
    "",
    "## 三、下一步动作",
    "",
    `- ${customer.nextAction || "生成跟进策略，确认下一次沟通目标。"}`,
    "- 将方案大纲、交互图和跟进记录保存到客户档案。"
  ].join("\n");
}

function buildLocalAnalysis(customer) {
  const follows = state.db.followRecords.filter((item) => item.customerId === customer.id);
  const latest = follows.sort((a, b) => new Date(b.followTime || b.createdAt) - new Date(a.followTime || a.createdAt))[0];
  return [
    ["客户需求摘要", customer.demandDescription || "需求信息待补充"],
    ["真实诉求判断", customer.problemToSolve || "建议通过下一次沟通确认客户真正要解决的业务问题。"],
    ["当前推进阶段判断", getStageName(customer.stage)],
    ["客户关注点", latest?.customerFeedback || customer.budgetInfo || "预算、交付范围、上线节奏和效果验证。"],
    ["成交机会分析", `成交概率：${customer.dealProbability || "未评估"}。预计金额：${formatMoney(customer.estimatedAmount)}。`],
    ["当前主要风险", customer.knownRisks || "预算、决策链和数据基础暂不明确。"],
    ["推荐下一步动作", customer.nextAction || latest?.nextAction || "安排需求深化沟通。"],
    ["推荐输出材料", getStageMaterials(customer.stage).join("、")],
    ["推荐使用的 Skill", getRecommendedSkill(customer)?.name || "下一步动作 Skill"],
    ["推荐参考案例", customer.customerType ? `${customer.customerType} 类似案例` : "先补充客户类型后再匹配案例"]
  ];
}

function buildContextRecommendations(customer) {
  const materials = getStageMaterials(customer.stage);
  const savedCount = getSavedCustomerArchiveRecords(customer.id).length;
  const memoryCount = state.db.customerMemories?.filter((item) => item.customerId === customer.id && item.status !== "disabled").length || 0;
  const fileCount = state.db.customerFiles?.filter((item) => item.customerId === customer.id && item.parsedText).length || 0;
  return [
    customer.nextAction || "补齐下一步动作",
    `建议输出：${materials.slice(0, 2).join("、")}`,
    `当前风险：${customer.knownRisks || "信息不完整，需要确认预算和决策链"}`,
    `客户记忆：已保存 ${savedCount} 份 AI 文档、${memoryCount} 条记忆、${fileCount} 份解析资料`
  ];
}

function getStageMaterials(stage) {
  const map = {
    initial_contact: ["首次沟通问题清单", "客户初步判断"],
    demand_communication: ["需求澄清问题", "会议沟通提纲"],
    demand_deepening: ["需求深化方案", "MVP 范围建议"],
    proposal: ["解决方案大纲", "轻量级方案PPT"],
    business: ["商务沟通策略", "报价解释话术"],
    contract: ["推进计划", "风险提醒"],
    won: ["项目交接摘要", "需求重点"],
    paused: ["重新激活话术", "跟进节奏"],
    lost: ["失败分析报告", "内部改进建议"]
  };
  return map[stage] || ["跟进策略", "需求分析"];
}

function getStageSkills(stage) {
  return state.db.skills.filter((skill) => {
    if (skill.status === "disabled") return false;
    return !skill.applicableStages?.length || skill.applicableStages.includes(stage);
  }).slice(0, 8);
}

function getEnabledSkills() {
  return state.db.skills.filter((skill) => skill.status !== "disabled");
}

function getStrategySkillCatalog(stage = "") {
  const enabled = getEnabledSkills().filter((skill) => !isDefaultWorkspaceOnlySkill(skill));
  const namedPriority = [
    "下一步动作",
    "首次沟通策略",
    "客户需求分析",
    "生成需求文档",
    "需求深化方案",
    "方案大纲",
    "轻量级方案",
    "轻量级方案 PPT",
    "下一步沟通问题清单",
    "商务沟通",
    "案例匹配",
    "失败分析"
  ];
  const priority = new Map(namedPriority.map((name, index) => [name, index]));
  return enabled.sort((a, b) => {
    const aPriority = findSkillPriority(a, priority);
    const bPriority = findSkillPriority(b, priority);
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aStage = a.applicableStages?.includes(stage) ? 0 : 1;
    const bStage = b.applicableStages?.includes(stage) ? 0 : 1;
    if (aStage !== bStage) return aStage - bStage;
    return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
  });
}

function findSkillPriority(skill, priority) {
  for (const [name, index] of priority.entries()) {
    if (String(skill?.name || "").includes(name)) return index;
  }
  return 99;
}

function isDefaultWorkspaceOnlySkill(skill = {}) {
  const name = String(skill.name || "");
  return name.includes("默认任务规划") || name.includes("默认意图策略") || name.includes("默认 RAG") || name.includes("默认生图");
}

function getRecommendedSkill(customer) {
  if (!customer) return getStrategySkillCatalog()[0] || state.db.skills[0];
  return getStrategySkillCatalog(customer.stage)[0] || getStageSkills(customer.stage)[0] || state.db.skills[0];
}

function getSkillIdByName(name = "") {
  return state.db.skills.find((skill) => skill.status !== "disabled" && String(skill.name || "").includes(name))?.id || "";
}

function inferGenerationTypeFromSkill(skill = {}) {
  const name = String(skill?.name || "");
  if (/生成需求文档|需求文档/.test(name)) return "requirement_document";
  if (name.includes("需求深化方案")) return "solution_deepening";
  if (/轻量级方案\s*PPT|轻量级方案PPT/.test(name)) return "lightweight_solution_ppt_outline";
  if (name.includes("轻量级方案")) return "lightweight_solution";
  if (name.includes("下一步沟通问题清单")) return "next_communication_question_list";
  if (name.includes("客户需求分析") || name.includes("需求分析")) return "demand_analysis";
  if (name.includes("方案大纲") || name.includes("PPT 结构")) return "proposal_outline";
  if (name.includes("失败分析")) return "failure_report";
  return "follow_strategy";
}

function getDefaultAiSkill() {
  return state.db.skills.find((skill) => skill.name.includes("默认意图策略") && skill.status !== "disabled")
    || state.db.skills.find((skill) => skill.name.includes("默认任务规划") && skill.status !== "disabled")
    || null;
}

function getAiCustomer() {
  return state.aiCustomerId ? getCustomer(state.aiCustomerId) : null;
}

function getChatScopeKey(customerId = state.aiCustomerId) {
  return customerId ? `customer:${customerId}` : "__default_workspace__";
}

function getChatSessionStorageKey(user = state.user) {
  const userId = String(user?.id || "").trim();
  return `${CHAT_SESSION_KEY}:user:${userId}`;
}

function readChatSessions() {
  if (!state.user?.id) return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(getChatSessionStorageKey()) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistChatSessions() {
  if (!state.user?.id) return;
  try {
    localStorage.setItem(getChatSessionStorageKey(), JSON.stringify(state.chatSessions || {}));
  } catch {
    // Local chat persistence is best-effort; CRM records are still stored by the backend.
  }
}

function ensureChatSessionState() {
  if (!state.db) return null;
  return ensureActiveChatSession(state.aiCustomerId || "");
}

function ensureActiveChatSession(customerId = state.aiCustomerId || "") {
  const scopeKey = getChatScopeKey(customerId);
  if (!state.chatSessions[scopeKey]) state.chatSessions[scopeKey] = [];
  const sessions = state.chatSessions[scopeKey];
  const current = sessions.find((session) => session.id === state.chatSessionId);
  if (current) {
    syncChatStateFromSession(current, customerId);
    return current;
  }
  const latest = sessions
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
  if (latest) {
    state.chatSessionId = latest.id;
    syncChatStateFromSession(latest, customerId);
    return latest;
  }
  const created = createChatSession({ customerId, makeActive: true, persist: false });
  persistChatSessions();
  return created;
}

function createChatSession({ customerId = state.aiCustomerId || "", title = "", makeActive = true, persist = true } = {}) {
  const now = new Date().toISOString();
  const scopeKey = getChatScopeKey(customerId);
  const customer = customerId ? getCustomer(customerId) : null;
  const session = {
    id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: state.user?.id || "",
    customerId,
    title: title || (customer ? `${customer.name} 对话` : "新的 AI 对话"),
    subtitle: customer
      ? "客户上下文已隔离，默认只围绕当前客户记忆与资料对话。"
      : "默认 Agent 会自动识别任务、规划路径并调度 RAG / Skill / image2。",
    mode: customer ? "customer_context" : "default_agent",
    modeLabel: customer ? "客户上下文" : "默认 Agent",
    skillId: "",
    skillExplicit: false,
    toolMode: "",
    messages: [],
    createdAt: now,
    updatedAt: now
  };
  if (!state.chatSessions[scopeKey]) state.chatSessions[scopeKey] = [];
  state.chatSessions[scopeKey].unshift(session);
  if (makeActive) {
    state.chatSessionId = session.id;
    syncChatStateFromSession(session, customerId);
  }
  if (persist) persistChatSessions();
  return session;
}

function createNewChatSession() {
  if (activeChatAbortController) pauseActiveChatStream({ silent: true });
  createChatSession({ customerId: state.aiCustomerId || "", makeActive: true });
  state.aiChatPanelOpen = false;
}

function updateChatSessionTitleFromMessage(session, message, customerId = "") {
  if (!session) return;
  const currentTitle = String(session.title || "").trim();
  const customer = customerId ? getCustomer(customerId) : null;
  const defaultTitles = new Set([
    "",
    "新的 AI 对话",
    "AI 对话",
    "日常问候",
    customer ? `${customer.name} 对话` : ""
  ]);
  if (!defaultTitles.has(currentTitle)) return;
  const summary = buildChatSessionTitleFromMessage(message);
  session.title = customer ? `${customer.name} · ${summary}` : summary;
  session.subtitle = customer
    ? "已连接客户上下文，未选择 Skill 时按客户记忆自然对话。"
    : "默认 Agent 会按输入自动判断是否需要过程、工具、RAG 或 Skill。";
}

function buildChatSessionTitleFromMessage(message = "") {
  const plain = stripText(message)
    .replace(/^(帮我|请你|麻烦|能否|可以|一下|这个|那个)+/g, "")
    .trim();
  if (!plain || /^(hi|hello|hey|嗨|哈喽|你好|在吗|谢谢|好的|收到|ok)$/i.test(plain)) {
    return "日常问候";
  }
  return plain.length > 18 ? `${plain.slice(0, 18)}...` : plain;
}

function deleteChatSession(sessionId = state.chatSessionId) {
  if (!sessionId) return;
  if (activeChatAbortController) pauseActiveChatStream({ silent: true });
  const scopeKey = getChatScopeKey(state.aiCustomerId || "");
  const sessions = state.chatSessions[scopeKey] || [];
  const nextSessions = sessions.filter((session) => session.id !== sessionId);
  state.chatSessions[scopeKey] = nextSessions;
  state.chatSessionId = nextSessions[0]?.id || "";
  if (!state.chatSessionId) createChatSession({ customerId: state.aiCustomerId || "", makeActive: true, persist: false });
  persistChatSessions();
  showToast("已删除当前对话");
}

function getActiveChatSession() {
  return ensureChatSessionState();
}

function syncChatStateFromSession(session, customerId = session?.customerId || "") {
  if (!session) {
    state.aiCustomerId = customerId || "";
    state.aiSkillId = "";
    state.chatSkillExplicit = false;
    state.chatToolMode = "";
    return null;
  }
  state.aiCustomerId = customerId || session.customerId || "";
  state.chatSessionId = session.id || state.chatSessionId;
  state.chatSkillExplicit = Boolean(session.skillExplicit);
  state.aiSkillId = state.chatSkillExplicit ? (session.skillId || "") : "";
  state.chatToolMode = state.chatSkillExplicit ? (session.toolMode || "") : "";
  return session;
}

function getChatSessionsForCurrentScope(customer = getAiCustomer()) {
  const scopeKey = getChatScopeKey(customer?.id || state.aiCustomerId || "");
  return (state.chatSessions[scopeKey] || [])
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function buildChatSessionOptions(customer) {
  const sessions = getChatSessionsForCurrentScope(customer);
  return sessions.map((session) => [session.id, `${session.title || "未命名对话"} · ${formatDate(session.updatedAt || session.createdAt)}`]);
}

function renderChatSessionList(customer) {
  const pageKey = `chatSessions_${customer?.id || "default"}`;
  const pagination = paginateItems(getChatSessionsForCurrentScope(customer), pageKey);
  const sessions = pagination.items;
  if (!sessions.length) return `<p class="hintText">暂无对话，点击「新建对话」开始。</p>`;
  return `
    ${sessions.map((session) => `
      <button class="${session.id === state.chatSessionId ? "active" : ""}" type="button" data-action="select-chat-session" data-id="${escapeAttr(session.id)}">
        <strong>${escapeHtml(session.title || "未命名对话")}</strong>
        <span>${escapeHtml(session.lastMessage || session.subtitle || "还没有消息")} · ${formatDate(session.updatedAt || session.createdAt)}</span>
      </button>
    `).join("")}
    ${renderPaginationControls(pageKey, pagination)}
  `;
}

function getAiHistoryForCurrentWorkspace(customer) {
  return state.db.aiGenerationRecords
    .filter((item) => isOwnedByCurrentUser(item))
    .filter((item) => customer ? item.customerId === customer.id : !item.customerId);
}

function applyDefaultAiScene(sceneKey) {
  const scene = defaultAiScenes.find((item) => item.key === sceneKey);
  if (!scene) return;
  state.aiCustomerId = "";
  const textarea = document.querySelector("#chatForm textarea[name='message']");
  if (textarea) {
    textarea.focus();
  }
  state.aiSkillId = "";
  state.chatSkillExplicit = false;
  state.chatToolMode = "";
  showToast(`${scene.title}会由默认 Agent 在后台自动执行`);
}

function inferChatToolMode(message, skillId = "") {
  const skill = state.db.skills.find((item) => item.id === skillId);
  if (String(skill?.toolType || "").toLowerCase() === "image2") return "image2";
  return /image2|生图|生成图片|画一张|出图|生成.*(图片|视觉稿|海报|交互图|界面图|产品图|设计图)|设计.*(视觉稿|海报|交互图|界面图|产品图|设计图)|制作.*(视觉稿|海报|交互图|界面图|产品图|设计图)/.test(String(message || ""))
    ? "image2"
    : "";
}

function inferWebsiteType(customer = {}) {
  const text = [
    customer.customerType,
    customer.demandDescription,
    customer.background,
    customer.problemToSolve,
    customer.existingSystem
  ].join(" ");
  if (/crm|客户|销售|线索/i.test(text)) return "CRM系统";
  if (/iot|设备|硬件|传感|物联/i.test(text)) return "IoT控制台";
  if (/大屏|看板|驾驶舱|数据/i.test(text)) return "数据大屏";
  if (/官网|品牌|门户/i.test(text)) return "企业官网";
  if (/小程序|移动|手机|app/i.test(text)) return "移动端小程序";
  if (/营销|获客|落地页/i.test(text)) return "营销落地页";
  if (/ai|智能|知识库|助手/i.test(text)) return "企业内部AI助手";
  return "SaaS后台";
}

function getSelectedCustomer() {
  return getCustomer(state.selectedCustomerId);
}

function getCustomer(id) {
  return state.db?.customers.find((item) => item.id === id) || null;
}

function getStageName(stageId) {
  return state.db?.stages.find((stage) => stage.id === stageId)?.name || stageId || "未设置";
}

function getUserName(userId) {
  return state.db?.users.find((user) => user.id === userId)?.name || "未分配";
}

function getSkillName(skillId) {
  return state.db?.skills.find((skill) => skill.id === skillId)?.name || "未命名 Skill";
}

function findCustomerName(customerId) {
  return state.db.customers.find((item) => item.id === customerId)?.name || "未关联客户";
}

function focusHistoryRecord(recordId, customerId = "") {
  if (!recordId) return;
  const record = state.db.aiGenerationRecords.find((item) => item.id === recordId);
  const targetCustomerId = customerId || record?.customerId || "";
  if (targetCustomerId) {
    state.selectedCustomerId = targetCustomerId;
    setHistoryPageForRecord(recordId, targetCustomerId);
  }
  state.selectedHistoryId = recordId;
  state.view = "detail";
  state.detailTab = "history";
}

function registerImageJob(recordId) {
  registerHelpCenterRecord(recordId);
}

function registerHelpCenterRecord(recordId) {
  if (!recordId) return;
  state.pendingImageJobs[recordId] = "generating";
  state.helpCenterTaskStatuses[recordId] = "generating";
  startImageJobPolling();
}

function registerReportFeedbackJob(feedbackId) {
  if (!feedbackId) return;
  const key = `feedback:${feedbackId}`;
  state.pendingImageJobs[key] = "generating";
  state.helpCenterTaskStatuses[key] = "generating";
  startImageJobPolling();
}

function startImageJobPolling() {
  if (helpCenterPollTimer || !state.user) return;
  helpCenterPollTimer = window.setInterval(pollImageJobs, HELP_CENTER_POLL_INTERVAL_MS);
}

function stopHelpCenterPolling(force = false) {
  const hasPending = Object.keys(state.pendingImageJobs).length > 0;
  if (!helpCenterPollTimer) return;
  if (!force && hasPending) return;
  window.clearInterval(helpCenterPollTimer);
  helpCenterPollTimer = null;
}

async function pollImageJobs() {
  const jobKeys = Object.keys(state.pendingImageJobs);
  if (!jobKeys.length) {
    stopHelpCenterPolling();
    return;
  }

  try {
    await loadBootstrap();
    const items = getHelpCenterItems();
    const itemMap = new Map(items.map((item) => [item.key, item]));
    let shouldRender = false;

    for (const key of jobKeys) {
      const previousStatus = state.helpCenterTaskStatuses[key] || "generating";
      const item = itemMap.get(key);
      if (!item) {
        delete state.pendingImageJobs[key];
        delete state.helpCenterTaskStatuses[key];
        continue;
      }

      const nextStatus = item.status;
      if (nextStatus === "generating") continue;

      delete state.pendingImageJobs[key];
      state.helpCenterTaskStatuses[key] = nextStatus;
      shouldRender = true;

      if (previousStatus === "generating") {
        pushHelpCenterNotice(item);
      }
    }

    if (shouldRender) render();
  } catch (error) {
    console.warn("help center polling failed", error);
  } finally {
    stopHelpCenterPolling();
  }
}

function getRecordJobStatus(record) {
  const boardStatus = getInteractionBoardStatus(record);
  if (boardStatus) return boardStatus;
  return record?.inputContext?.asyncAiJob?.status
    || record?.inputContext?.pptTask?.status
    || record?.inputContext?.asyncImageJob?.status
    || record?.inputContext?.interactionImage?.imageStatus
    || record?.inputContext?.defaultImage?.imageStatus
    || "";
}

function getInteractionBoardStatus(record = {}) {
  if (record?.generationType !== "interaction_image") return "";
  const board = record.inputContext?.interactionImageBoard;
  const items = Array.isArray(board?.items) ? board.items : [];
  if (!items.length) return "";
  if (items.some((item) => ["generating", "queued", "running"].includes(String(item.status || "")))) return "generating";
  if (items.some((item) => item.status === "completed")) return items.every((item) => item.status === "completed") ? "completed" : "completed";
  if (items.every((item) => item.status === "failed")) return "failed";
  return board?.status || "";
}

function renderRecordJobStatusText(record) {
  const status = getRecordJobStatus(record);
  if (status === "generating" || status === "queued" || status === "running") return " · 生成中";
  if (status === "failed") return " · 生成失败";
  if (status === "completed" || status === "generated" || status === "succeeded") return " · 已完成";
  return "";
}

function getRecordJobStatusLabel(status = "") {
  return {
    generating: "生成中",
    completed: "已完成",
    generated: "已完成",
    succeeded: "已完成",
    failed: "生成失败",
    queued: "生成中",
    running: "生成中",
    open: "待处理",
    manual: "已创建"
  }[status] || "已保存";
}

function isOwnedByCurrentUser(item = {}) {
  const userId = String(state.user?.id || "").trim();
  if (!userId) return false;
  const ownerId = String(item.userId || item.createdBy || item.savedBy || item.inputContext?.savedBy || "").trim();
  return ownerId === userId;
}

function getHelpCenterItems() {
  if (!state.db) return [];
  const records = (state.db.aiGenerationRecords || []).filter(isOwnedByCurrentUser).map((record) => {
    const rawStatus = getRecordJobStatus(record);
    if (!rawStatus && record.generationType === "chat") return null;
    const status = normalizeHelpCenterStatus(rawStatus);
    return {
      key: record.id,
      id: record.id,
      kind: "record",
      kindLabel: generationTypes[record.generationType] || "AI 生成",
      title: record.title || generationTypes[record.generationType] || "AI 生成",
      customerId: record.customerId || "",
      customerName: record.customerId ? findCustomerName(record.customerId) : "默认 AI 工作台",
      status,
      statusLabel: getRecordJobStatusLabel(status),
      createdAt: record.createdAt || record.updatedAt || "",
      preview: buildHelpCenterPreview(record.outputContent || "", status, record.generationType, "record"),
      steps: getRecordJobSteps(record),
      recordId: record.id,
      feedbackId: ""
    };
  }).filter(Boolean);

  const feedbacks = (state.db.reportFeedbacks || []).filter(isOwnedByCurrentUser).map((feedback) => {
    const status = normalizeHelpCenterStatus(getReportFeedbackStatus(feedback));
    return {
      key: `feedback:${feedback.id}`,
      id: feedback.id,
      kind: "feedback",
      kindLabel: "报告反馈",
      title: feedback.recordTitle || "AI 报告反馈",
      customerId: feedback.customerId || "",
      customerName: feedback.customerName || "默认 AI 工作台",
      status,
      statusLabel: getRecordJobStatusLabel(status),
      createdAt: feedback.createdAt || feedback.updatedAt || "",
      preview: buildHelpCenterPreview(feedback.aiOptimizationSuggestion || feedback.feedbackContent || "", status, "report_feedback", "feedback"),
      steps: [],
      recordId: feedback.recordId || "",
      feedbackId: feedback.id
    };
  });

  return [...records, ...feedbacks]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 50);
}

function getRecordJobSteps(record = {}) {
  const steps = record.inputContext?.asyncAiJob?.steps
    || record.inputContext?.pptTask?.steps
    || record.inputContext?.asyncImageJob?.steps
    || [];
  return Array.isArray(steps) ? steps : [];
}

function getProcessStatusLabel(status = "") {
  return {
    done: "已完成",
    completed: "已完成",
    succeeded: "已完成",
    running: "进行中",
    generating: "进行中",
    queued: "排队中",
    pending: "等待中",
    failed: "失败",
    error: "失败"
  }[String(status || "").toLowerCase()] || "等待中";
}

function getHelpCenterBadgeCount() {
  if (!state.user || !state.db) return 0;
  const pendingCount = getHelpCenterItems().filter((item) => item.status === "generating").length;
  return pendingCount + state.helpCenterNotices.length;
}

function normalizeHelpCenterStatus(status = "") {
  const value = String(status || "").toLowerCase();
  if (value === "open") return "open";
  if (value === "closed") return "completed";
  if (value === "generated") return "completed";
  if (value === "manual") return "completed";
  if (value === "running" || value === "pending" || value === "queued") return "generating";
  if (value === "done" || value === "succeeded") return "completed";
  return value || "completed";
}

function getReportFeedbackStatus(feedback = {}) {
  const raw = String(feedback.status || "").toLowerCase();
  if (!raw) return feedback.aiOptimizationSuggestion ? "completed" : "open";
  if (raw === "open") return "open";
  if (raw === "generating") return "generating";
  if (raw === "closed" || raw === "completed") return "completed";
  if (raw === "failed") return "failed";
  return raw;
}

function buildHelpCenterPreview(text, status, generationType, kind) {
  const sourceText = String(text || "").trim();
  if (status === "generating") {
    return sourceText ? stripPlainText(sourceText, 160) : "后台任务正在生成中，请稍后查看。";
  }
  if (!sourceText) {
    return kind === "feedback" ? "反馈已保存，AI 优化建议稍后可查看。" : `${generationTypes[generationType] || "AI 生成"}已完成。`;
  }
  return stripPlainText(sourceText, 160);
}

function renderHelpCenterNotifications() {
  if (!state.user || !state.helpCenterNotices.length) return "";
  return `
    <section class="helpCenterNoticeStack" aria-live="polite">
      ${state.helpCenterNotices.map(renderHelpCenterNotice).join("")}
    </section>
  `;
}

function renderHelpCenterNotice(notice) {
  const statusClass = {
    generating: "generating",
    completed: "completed",
    failed: "failed"
  }[notice.status] || "completed";
  return `
    <article class="helpCenterNotice ${statusClass}">
      <div class="helpCenterNoticeHead">
        <span>${escapeHtml(notice.kindLabel)} · ${escapeHtml(notice.statusLabel)}</span>
        <button type="button" data-action="dismiss-help-notice" data-id="${escapeAttr(notice.id)}" aria-label="关闭">×</button>
      </div>
      <strong>${escapeHtml(notice.title)}</strong>
      <p>${escapeHtml(notice.preview || "暂无预览")}</p>
      <footer>
        <small>${escapeHtml(notice.customerName || "默认 AI 工作台")} · ${formatDate(notice.createdAt)}</small>
        <button type="button" class="ghostButton" data-action="open-help-center-item" data-kind="${escapeAttr(notice.kind)}" data-id="${escapeAttr(notice.id.replace(/^feedback:/, ""))}">查看详情</button>
      </footer>
    </article>
  `;
}

function pushHelpCenterNotice(item) {
  const notice = {
    ...item,
    id: item.key,
    createdAt: item.createdAt || new Date().toISOString()
  };
  const existingIndex = state.helpCenterNotices.findIndex((entry) => entry.id === notice.id);
  if (existingIndex >= 0) {
    state.helpCenterNotices.splice(existingIndex, 1);
  }
  state.helpCenterNotices.unshift(notice);
  state.helpCenterNotices = state.helpCenterNotices.slice(0, 3);
  clearHelpCenterNoticeTimer(notice.id);
  helpCenterNoticeTimers.set(notice.id, window.setTimeout(() => {
    dismissHelpCenterNotice(notice.id);
  }, 12000));
  render();
}

function dismissHelpCenterNotice(id, skipRender = false) {
  clearHelpCenterNoticeTimer(id);
  state.helpCenterNotices = state.helpCenterNotices.filter((item) => item.id !== id);
  if (!skipRender) render();
}

function clearHelpCenterNoticeTimer(id) {
  const timer = helpCenterNoticeTimers.get(id);
  if (timer) {
    window.clearTimeout(timer);
    helpCenterNoticeTimers.delete(id);
  }
}

function clearHelpCenterNotices() {
  for (const id of helpCenterNoticeTimers.keys()) {
    clearHelpCenterNoticeTimer(id);
  }
  state.helpCenterNotices = [];
}

function openHelpCenterItem(kind, rawId) {
  const item = getHelpCenterItems().find((entry) => entry.kind === kind && entry.id === rawId);
  if (!item) return;
  dismissHelpCenterNotice(item.key, true);
  state.helpCenterOpen = false;
  state.modal = null;

  if (item.kind === "record") {
    if (item.customerId) {
      focusHistoryRecord(item.recordId, item.customerId);
    } else {
      state.selectedHistoryId = item.recordId;
      state.view = "ai";
    }
    render();
    return;
  }

  if (item.kind === "feedback") {
    const feedback = state.db.reportFeedbacks.find((entry) => entry.id === item.feedbackId);
    if (feedback) {
      openModal({ type: "setting", title: "查看报告反馈", collection: "reportFeedbacks", item: feedback });
      return;
    }
    showToast("未找到这条报告反馈");
  }
}

function openDocumentRoute(recordId, edit = false) {
  const record = state.db.aiGenerationRecords.find((item) => item.id === recordId);
  if (!record) {
    showToast("未找到这条文档记录");
    return;
  }
  state.documentRoute = {
    recordId,
    mode: edit ? "edit" : "view",
    fromView: state.view,
    fromDetailTab: state.detailTab,
    customerId: record.customerId || state.selectedCustomerId || ""
  };
  state.selectedHistoryId = recordId;
  state.editingHistoryId = "";
  if (record.customerId) {
    state.selectedCustomerId = record.customerId;
    setHistoryPageForRecord(recordId, record.customerId);
  }
  scrollPageToTop();
}

function closeDocumentRoute() {
  const route = state.documentRoute;
  state.documentRoute = null;
  state.editingHistoryId = "";
  if (route?.customerId) {
    state.selectedCustomerId = route.customerId;
    state.view = "detail";
    state.detailTab = route.fromDetailTab || "history";
    if (state.detailTab === "history") {
      setHistoryPageForRecord(route.recordId, route.customerId);
    }
  } else {
    state.view = route?.fromView || "ai";
  }
  scrollPageToTop();
}

function handleDocumentClick() {
  if (!state.helpCenterNotices.length) return;
}

function getFeishuSync(record) {
  return record?.inputContext?.feishuSync || null;
}

function renderFeishuSyncMeta(record) {
  const sync = getFeishuSync(record);
  if (!sync?.syncedAt) return "";
  return ` · 已同步飞书 ${formatDate(sync.syncedAt)}`;
}

function renderTokenBudgetMeta(record) {
  const budget = record?.inputContext?.tokenBudget;
  if (!budget?.savedEstimatedInputTokens) return "";
  return ` · 预计节省 ${Number(budget.savedEstimatedInputTokens).toLocaleString("zh-CN")} tokens`;
}

function renderFeishuOpenLink(record) {
  const sync = getFeishuSync(record);
  if (!sync?.url) return "";
  return `<a class="ghostButton feishuOpenLink" href="${escapeAttr(sync.url)}" target="_blank" rel="noreferrer">打开飞书</a>`;
}

function setHistoryPageForRecord(recordId, customerId) {
  const records = state.db.aiGenerationRecords
    .filter((item) => item.customerId === customerId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const index = records.findIndex((item) => item.id === recordId);
  if (index >= 0) {
    state.pages[`history_${customerId}`] = Math.floor(index / pageSizes.history) + 1;
  }
}

function getViewTitle() {
  return {
    customers: "客户工作台",
    detail: "客户详情",
    ai: "AI 售前助手",
    settings: "系统设置"
  }[state.view] || "客户工作台";
}

function getVisibleNavItems() {
  return isAdmin() ? navItems : navItems.filter(([view]) => view !== "settings");
}

function isAdmin() {
  return state.user?.role === "admin";
}

function getSettingsDescription(collection) {
  return {
    stages: "配置客户阶段、阶段目标和默认提示词。",
    skills: "配置可复用的售前 Skill、输入字段和输出格式。",
    promptTemplates: "按阶段维护 AI 任务说明和输出约束。",
    models: "配置本地规则模型或 OpenAI-compatible 模型。",
  knowledgeBases: "预留历史方案库、案例库、话术库等 RAG 入口。",
  users: "管理员工账号、部门岗位、登录密码和角色权限。",
  reportFeedbacks: "记录销售对 AI 报告的反馈、优化方向、所属客户和原报告入口。"
}[collection] || "";
}

function openModal(modal) {
  state.modal = modal;
  state.toast = "";
  render();
}

function updateCustomerTable() {
  if (state.view !== "customers" || !state.db) {
    render();
    return;
  }
  if (tableRenderFrame) window.cancelAnimationFrame(tableRenderFrame);
  tableRenderFrame = window.requestAnimationFrame(() => {
    const customers = getFilteredCustomers();
    const pagination = paginateItems(customers, "customers");
    const list = document.querySelector("#customerWorkbenchList");
    const tbody = document.querySelector("#customerTableBody");
    const count = document.querySelector("#customerResultCount");
    const pager = document.querySelector("#customerPager");
    const globalSearch = document.querySelector("#globalSearch");
    const customerSearch = document.querySelector("#customerSearch");
    if (!count || !pager || (!list && !tbody)) {
      render();
      return;
    }
    if (globalSearch && globalSearch.value !== state.filters.keyword) globalSearch.value = state.filters.keyword;
    if (customerSearch && customerSearch.value !== state.filters.keyword) customerSearch.value = state.filters.keyword;
    if (list) {
      list.innerHTML = pagination.items.map(renderCustomerWorkbenchCard).join("") || renderEmptyState("暂无客户", "先新增一个客户档案。");
    }
    if (tbody) {
      tbody.innerHTML = pagination.items.map(renderCustomerRow).join("") || renderEmptyRow("暂无客户，先新增一个客户档案。", 7);
    }
    count.textContent = String(customers.length);
    pager.innerHTML = renderPaginationControls("customers", pagination);
    tableRenderFrame = null;
  });
}

function updateChatMessages() {
  const container = document.querySelector("#chatMessages");
  if (!container) {
    render();
    return;
  }
  container.innerHTML = renderChatMessages();
  scrollChatToBottom(container);
}

function queueChatMessagesUpdate() {
  if (chatRenderFrame) return;
  chatRenderFrame = window.requestAnimationFrame(() => {
    chatRenderFrame = null;
    updateChatMessages();
  });
}

function renderChatMessages() {
  const chat = getActiveChat();
  const isDefaultWorkspace = !getAiCustomer();
  if (!chat.length) return renderChatWelcome(isDefaultWorkspace, getAiCustomer());
  return chat.map((item, index) => renderChatBubble(item, index, chat.length)).join("");
}

function renderChatWelcome(isDefaultWorkspace, customer) {
  if (isDefaultWorkspace) {
    return `
      <section class="chatWelcome">
        <div class="chatWelcomeMark">AI</div>
        <h3>今天想推进什么？</h3>
        <p>像 GPT 一样直接输入任务。Agent 会在后台完成意图识别、任务规划、工具调度和结果校验，不需要先选择提示词模板。</p>
        <div class="chatPromptChips">
          ${defaultAiScenes.slice(0, 4).map((scene) => `
            <span>${escapeHtml(scene.title)}</span>
          `).join("")}
        </div>
      </section>
    `;
  }
  return `
    <section class="chatWelcome">
      <div class="chatWelcomeMark">客</div>
      <h3>${escapeHtml(customer?.name || "客户")}独立对话</h3>
      <p>当前只读取这个客户的上下文和记忆，不会混用其他客户资料。可以直接让 AI 生成跟进策略、会议提纲、方案大纲或失败复盘。</p>
      <div class="chatPromptChips">
        <button type="button" data-action="open-strategy-modal" data-id="${customer?.id || ""}">生成跟进策略</button>
        <button type="button" data-action="generate" data-type="demand_analysis" data-id="${customer?.id || ""}">需求分析</button>
        <button type="button" data-action="generate" data-type="proposal_outline" data-id="${customer?.id || ""}">方案大纲</button>
      </div>
    </section>
  `;
}

function getActiveChat(customerId = state.aiCustomerId) {
  const session = getActiveChatSession();
  if (!session) return [];
  if (!Array.isArray(session.messages)) session.messages = [];
  return session.messages;
}

function buildConversationHistory(customerId, sessionId = state.chatSessionId) {
  const session = findChatSessionById(sessionId) || getActiveChatSession();
  const messages = Array.isArray(session?.messages) ? session.messages : getActiveChat(customerId);
  return messages
    .filter((item) => !item.streaming && ["user", "assistant"].includes(item.role) && String(item.content || "").trim())
    .slice(-8)
    .map((item) => ({
      role: item.role,
      content: item.content
    }));
}

function findChatSessionById(sessionId) {
  if (!sessionId) return null;
  for (const sessions of Object.values(state.chatSessions || {})) {
    const found = sessions.find((session) => session.id === sessionId);
    if (found) return found;
  }
  return null;
}

function renderChatBubble(item, index, total = 0) {
  const isUser = item.role === "user";
  const isStreaming = Boolean(item.streaming);
  const hasCard = Boolean(item.skillCard);
  const isLatest = index === total - 1;
  const actions = [];
  if (isUser) {
    actions.push(`<button type="button" data-action="copy-last-message" data-index="${index}">复制</button>`);
  } else {
    if (!isStreaming && String(item.content || "").trim()) {
      actions.push(`<button type="button" data-action="copy-last-message" data-index="${index}">复制全部</button>`);
    }
    if (isLatest && isStreaming) {
      actions.push(`<button type="button" data-action="pause-chat" data-index="${index}">暂停</button>`);
    }
    if (isLatest && !isStreaming) {
      actions.push(`<button type="button" data-action="regenerate-last-message" data-index="${index}">重新生成</button>`);
    }
    const canSave = !isStreaming && String(item.content || "").trim();
    if (canSave) {
      actions.push(`<button type="button" class="chatSaveSolutionButton" data-action="open-save-chat-solution-modal" data-index="${index}">保存为方案</button>`);
    }
  }
  return `
    <article class="chatBubble ${item.role} ${isStreaming ? "streaming" : ""} ${hasCard ? "withCard" : ""}">
      <div class="chatBubbleAvatar ${isUser ? "user" : "assistant"}">
        <span>${escapeHtml(isUser ? getUserAvatarText() : "AI")}</span>
      </div>
      <div class="chatBubbleMain">
        <div class="chatBubbleMeta">
          <span>${isUser ? "你" : "AI"}</span>
        </div>
        <div class="chatBubbleBody">
          ${renderChatMessageBody(item)}
          ${hasCard ? renderSkillResultCardBlock(item.skillCard) : ""}
        </div>
        ${actions.length ? `
          <div class="chatBubbleActions">
            ${actions.join("")}
          </div>
        ` : ""}
      </div>
    </article>
  `;
}

function getUserAvatarText() {
  const user = getCurrentUser();
  const source = String(user?.name || user?.email || "我").trim();
  if (!source) return "我";
  if (/[\u4e00-\u9fa5]/.test(source)) return source.slice(0, 1);
  return source.slice(0, 2).toUpperCase();
}

function renderChatMessageBody(item) {
  if (item.role === "user") {
    return `<div class="markdownPane compactMarkdown userMarkdown">${markdownToHtml(item.content || "暂无内容")}</div>`;
  }

  const processHtml = renderChatProcessPanel(item);
  if (item.remoteFailure || isRemoteFailureContent(item.content)) {
    const failureHtml = renderChatRemoteFailure(item);
    return item.streaming ? `${processHtml}${failureHtml}` : `${processHtml}${failureHtml}`;
  }
  const finalAnswer = String(item.content || "").trim()
    ? `<div class="finalAnswerPane markdownPane chatMarkdown ${item.streaming ? "streamingMarkdown" : ""}">${markdownToHtml(item.content)}</div>`
    : "";

  if (item.streaming) {
    const typing = !item.content
      ? `<div class="typingLine"><span class="typingDots"><i></i><i></i><i></i></span>${escapeHtml(item.status || (processHtml ? "正在整理最终回答..." : "AI 正在思考..."))}</div>`
      : "";
    const status = item.content && item.status
      ? `<div class="streamStatus">${escapeHtml(item.status)}</div>`
      : "";
    return `${processHtml}${finalAnswer}${typing}${status}`;
  }
  return `${processHtml}${finalAnswer || `<div class="finalAnswerPane markdownPane chatMarkdown">${markdownToHtml("暂无内容")}</div>`}`;
}

function isRemoteFailureContent(content = "") {
  return /远程模型.*调用失败|远程模型已返回空内容|响应体中没有可展示文本|没有返回任何正文 token|Responses API 兼容接口未返回成功结果/i.test(String(content || ""));
}

function renderChatRemoteFailure(item) {
  const failure = item.remoteFailure || {};
  const reason = failure.errorPreview || stripText(item.content || "").slice(0, 360) || "远程模型没有返回可展示正文。";
  return `
    <div class="finalAnswerPane chatRemoteFailurePane">
      <strong>模型返回异常，未生成有效内容</strong>
      <p>${escapeHtml(reason)}</p>
      <small>你可以点击「重新生成」。如果多次出现，请检查模型 Base URL、Model ID、API Key 或中转平台稳定性。</small>
    </div>
  `;
}

function getCurrentUser() {
  return state.user || null;
}

function renderChatProcessPanel(item) {
  const steps = Array.isArray(item.process) ? item.process.filter((step) => step?.id) : [];
  const complexity = item.metadata?.complexity || item.meta?.complexity || "";
  if (!steps.length || complexity === "simple") return "";
  const intentLabel = item.metadata?.default_intent_label || item.metadata?.referenced_customer_name || "";
  const doneCount = steps.filter((step) => step.status === "done").length;
  const hasFailure = steps.some((step) => step.status === "failed" || step.status === "error");
  const runningStep = steps.find((step) => step.status === "running");
  const subtitle = hasFailure
    ? "任务过程出现异常，可展开查看原因"
    : runningStep
      ? runningStep.summary || "正在执行任务"
      : `${intentLabel ? `${intentLabel} · ` : ""}已完成 ${doneCount}/${steps.length} 个步骤`;
  return `
    <section class="chatProcessPanel manusProcessPanel" aria-label="任务过程">
      <details open>
        <summary>
          <span class="processPanelIcon ${hasFailure ? "failed" : item.streaming ? "running" : "done"}"></span>
          <span>
            <strong>Agent 任务过程</strong>
            <small>${escapeHtml(subtitle)}</small>
          </span>
        </summary>
        <div class="processStepList">
          ${steps.map(renderChatProcessStep).join("")}
        </div>
      </details>
    </section>
  `;
}

function renderChatProcessStep(step) {
  const status = ["running", "done", "failed", "error"].includes(step.status) ? step.status : "pending";
  const detail = String(step.detail || "").trim();
  return `
    <details class="processStep ${status}">
      <summary>
        <span class="processStepDot"></span>
        <span class="processStepText">
          <strong>${escapeHtml(step.title || "处理任务")}</strong>
          ${step.summary ? `<small>${escapeHtml(step.summary)}</small>` : ""}
        </span>
      </summary>
      ${detail ? `<div class="processStepDetail">${escapeHtml(detail)}</div>` : ""}
    </details>
  `;
}

function buildSkillResultCard(record, session, customerId = "") {
  if (!record) return null;
  const title = generationTypes[record.generationType] || record.title || "AI 生成结果";
  const summary = summarizeSkillCard(record);
  return {
    recordId: record.id,
    customerId: customerId || record.customerId || "",
    title,
    subtitle: session?.title || title,
    badge: session?.modeLabel || "Skill 输出",
    meta: summary.meta,
    description: summary.description,
    actionLabel: "查看全屏文档"
  };
}

function summarizeSkillCard(record) {
  const markdown = String(record?.outputContent || "");
  if (record?.generationType === "next_communication_question_list") {
    const data = summarizeNextQuestionReport(markdown);
    return {
      meta: `目标：${data.goals} · 问题：${data.questionCount} 个`,
      description: `沟通重点：${data.focus} · 结论：${data.decision}`
    };
  }
  if (record?.generationType === "lightweight_solution") {
    const data = summarizeLightweightSolutionReport(markdown);
    return {
      meta: `层次：${data.layers} · 端口：${data.ports}`,
      description: `AI 融入：${data.ai} · 下一步：${data.next}`
    };
  }
  if (record?.generationType === "solution_deepening") {
    const plain = stripText(markdown);
    const sceneCount = (markdown.match(/核心场景|场景方案页|第\d+页/g) || []).length;
    const aiCount = (markdown.match(/AI 场景|AI场景|AI能力/g) || []).length;
    return {
      meta: `方案强化 · 场景 ${Math.max(1, Math.min(sceneCount, 99))} · AI ${Math.max(1, Math.min(aiCount, 99))}`,
      description: plain.slice(0, 120) || "已生成方案强化阶段逐页内容稿"
    };
  }
  if (record?.generationType === "lightweight_solution_ppt_outline") {
    const data = summarizeLightweightSolutionPptOutline(markdown);
    return {
      meta: `页数：${data.pages} · 风格：${data.style}`,
      description: `定位：${data.position} · 下一步：${data.next}`
    };
  }
  if (record?.generationType === "requirement_document") {
    const plain = stripText(markdown);
    return {
      meta: "项目功能 · 端口需求 · AI需求",
      description: plain.slice(0, 120) || "已生成完整需求文档"
    };
  }
  const plain = stripText(markdown);
  return {
    meta: `长度：${Math.min(plain.length, 9999).toLocaleString("zh-CN")} 字`,
    description: plain.slice(0, 120) || "点击查看完整文档"
  };
}

function renderSkillResultCardBlock(card) {
  if (!card) return "";
  const boundCustomer = Boolean(card.customerId);
  return `
    <article class="skillResultCard">
      <button class="skillResultCardMain" type="button" data-action="open-document" data-id="${escapeAttr(card.recordId)}">
        <div class="skillResultCardTop">
          <span>${escapeHtml(card.badge || "Skill 输出")}</span>
          <strong>${escapeHtml(card.title)}</strong>
        </div>
        <p>${escapeHtml(card.description || "已生成完整文档，点击查看")}</p>
        <div class="skillResultCardMeta">
          <small>${escapeHtml(card.meta || "")}</small>
          <span>${escapeHtml(card.actionLabel || "查看")}</span>
        </div>
      </button>
      <div class="skillResultCardActions">
        <button type="button" data-action="open-report-feedback" data-id="${escapeAttr(card.recordId)}">反馈报告</button>
        <button type="button" data-action="copy-history" data-id="${escapeAttr(card.recordId)}">复制</button>
        ${boundCustomer
          ? `<button type="button" data-action="save-history-to-customer" data-id="${escapeAttr(card.recordId)}">保存到客户档案</button>`
          : `<button type="button" class="chatSaveSolutionButton" data-action="open-save-chat-solution-modal" data-index="${escapeAttr(findChatMessageIndexByRecordId(card.recordId))}">保存为方案</button>`}
      </div>
    </article>
  `;
}

function findChatMessageIndexByRecordId(recordId) {
  const messages = getActiveChatSession()?.messages || [];
  const index = messages.findIndex((message) => message?.skillCard?.recordId === recordId);
  return index >= 0 ? index : "";
}

function scrollChatToBottom(container = document.querySelector("#chatMessages")) {
  if (!container) return;
  window.requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function queueChatScrollToBottom() {
  if (chatScrollFrame) window.cancelAnimationFrame(chatScrollFrame);
  chatScrollFrame = window.requestAnimationFrame(() => {
    chatScrollFrame = null;
    scrollChatToBottom();
  });
}

function showToast(message, duration = 2600) {
  const toast = ensureFloatingNode("crmToast", "toast");
  toast.textContent = message;
  toast.classList.add("active");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("active");
  }, duration);
}

function setBusy(message) {
  state.busy = message;
  const layer = ensureFloatingNode("crmBusy", "busyLayer");
  if (message) {
    layer.innerHTML = `<span class="busySpinner"></span><strong>${escapeHtml(message)}</strong>`;
    layer.classList.add("active");
    document.body.classList.add("isBusy");
    return;
  }
  layer.classList.remove("active");
  document.body.classList.remove("isBusy");
}

function setFormSubmitting(form, isSubmitting) {
  form.dataset.submitting = isSubmitting ? "true" : "false";
  const button = form.querySelector("button[type='submit']");
  if (!button) return;
  setButtonLoading(button, isSubmitting, getSubmitLoadingLabel(form.id));
}

function setButtonLoading(button, isLoading, label = "处理中") {
  if (!button) return;

  if (isLoading) {
    if (button.dataset.loading === "true") return;
    const width = Math.ceil(button.getBoundingClientRect().width);
    button.dataset.originalHtml = button.innerHTML;
    button.dataset.originalMinWidth = button.style.minWidth || "";
    button.dataset.originalDisabled = button.disabled ? "true" : "false";
    if (width) button.style.minWidth = `${width}px`;
    button.classList.add("buttonLoading");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.dataset.loading = "true";
    button.innerHTML = `
      <span class="buttonSpinner" aria-hidden="true"></span>
      <span class="buttonLoadingText">${escapeHtml(label)}</span>
    `;
    return;
  }

  if (button.dataset.originalHtml !== undefined) {
    button.innerHTML = button.dataset.originalHtml;
  }
  button.disabled = button.dataset.originalDisabled === "true";
  button.style.minWidth = button.dataset.originalMinWidth || "";
  button.classList.remove("buttonLoading");
  button.removeAttribute("aria-busy");
  delete button.dataset.loading;
  delete button.dataset.originalHtml;
  delete button.dataset.originalMinWidth;
  delete button.dataset.originalDisabled;
}

function getSubmitLoadingLabel(formId = "") {
  return {
    loginForm: "登录中",
    customerForm: "保存中",
    followForm: "保存中",
    strategyForm: "提交中",
    interactionImageForm: "处理中",
    interactionImageRegenerateForm: "提交中",
    lightweightSolutionForm: "提交中",
    failureForm: "提交中",
    fileForm: "保存中",
    reportFeedbackForm: "提交中",
    settingForm: "保存中",
    historyEditForm: "保存中",
    chatForm: "发送中"
  }[formId] || "处理中";
}

function getActionLoadingLabel(action = "") {
  return {
    "refresh-data": "刷新中",
    "delete-customer": "删除中",
    "delete-setting": "删除中",
    "test-model": "测试中",
    generate: "生成中",
    "generate-ppt-from-outline": "生成PPT中",
    "set-customer-stage": "更新中",
    "summarize-follow": "总结中",
    "sync-history-feishu": "同步中",
    "add-customer-to-solution-library": "入库中"
  }[action] || "处理中";
}

function ensureFloatingNode(id, className) {
  let node = document.getElementById(id);
  if (!node) {
    node = document.createElement("div");
    node.id = id;
    node.className = className;
    document.body.appendChild(node);
  }
  return node;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: crmHeaders()
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: crmHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

async function postJsonStream(url, body, handlers = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: crmHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: handlers.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error(error.message || "AI 流式请求失败");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `请求失败：${response.status}`);
  }
  if (!response.body) {
    const data = await response.json();
    handlers.onDone?.(data);
    return data;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload = null;
  const dispatchEvent = (eventName, payload) => {
    if (!eventName || !payload) return;
    if (eventName === "status") handlers.onStatus?.(payload.message || "");
    else if (eventName === "process_start") handlers.onProcessStart?.(payload);
    else if (eventName === "process_update") handlers.onProcessUpdate?.(payload);
    else if (eventName === "answer_delta") handlers.onAnswerDelta?.(payload.content || "");
    else if (eventName === "delta") handlers.onDelta?.(payload.delta || payload.content || "");
    else if (eventName === "done") {
      donePayload = payload;
      handlers.onDone?.(payload);
    } else if (eventName === "error") {
      throw new Error(payload.error || "AI 流式生成失败");
    }
  };

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error(error.message || "AI 流式读取失败");
    }
    const { value, done } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const event = parseClientSseBlock(block);
      if (!event.data) continue;
      const payload = JSON.parse(event.data);
      dispatchEvent(event.event, payload);
    }
  }

  if (buffer.trim()) {
    const event = parseClientSseBlock(buffer);
    if (event.data) {
      const payload = JSON.parse(event.data);
      dispatchEvent(event.event, payload);
    }
  }

  return donePayload || { ok: true };
}

async function regenerateCurrentChat() {
  const session = getActiveChatSession();
  const messages = session?.messages || [];
  const lastUserIndex = messages.findLastIndex?.((item) => item.role === "user" && String(item.content || "").trim()) ?? findLastMessageIndex(messages, "user");
  const lastUserMessage = lastUserIndex >= 0 ? messages[lastUserIndex] : null;
  if (!lastUserMessage) {
    showToast("当前对话没有可重新生成的用户输入");
    return;
  }
  if (activeChatAbortController) {
    pauseActiveChatStream({ silent: true });
  }
  messages.splice(lastUserIndex);
  const input = document.querySelector("#chatForm textarea[name='message']");
  if (input) input.value = lastUserMessage.content || "";
  const form = document.querySelector("#chatForm");
  if (form) await submitChat(form);
}

function findLastMessageIndex(messages = [], role = "") {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role && String(messages[index]?.content || "").trim()) return index;
  }
  return -1;
}

function pauseActiveChatStream({ silent = false } = {}) {
  if (!activeChatAbortController) {
    if (!silent) showToast("当前没有正在生成的回复");
    return false;
  }
  try {
    activeChatAbortController.abort();
  } catch {
    // Browser abort is best-effort.
  }
  const session = getActiveChatSession();
  const latestStreaming = [...(session?.messages || [])].reverse().find((item) => item.role === "assistant" && item.streaming);
  if (latestStreaming) {
    latestStreaming.streaming = false;
    latestStreaming.status = "";
    latestStreaming.content = latestStreaming.content
      ? `${latestStreaming.content}\n\n> 已暂停生成，可点击「重新生成」再次请求。`
      : "> 已暂停生成，可点击「重新生成」再次请求。";
    queueChatMessagesUpdate();
    persistChatSessions();
  }
  activeChatAbortController = null;
  if (!silent) showToast("已暂停当前回复");
  return true;
}

async function copyLastAssistantMessage() {
  const session = getActiveChatSession();
  const messages = session?.messages || [];
  const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant" && String(item.content || "").trim());
  await navigator.clipboard?.writeText(lastAssistant?.content || "");
  showToast(lastAssistant ? "已复制最新 AI 回复" : "当前没有可复制的 AI 回复");
}

async function copyChatMessage(index) {
  const session = getActiveChatSession();
  const messages = session?.messages || [];
  const numericIndex = Number(index);
  const targetMessage = Number.isFinite(numericIndex) ? messages[numericIndex] : null;
  if (targetMessage?.content) {
    await navigator.clipboard?.writeText(targetMessage.content);
    showToast("已复制当前消息");
    return;
  }
  await copyLastAssistantMessage();
}

async function saveChatMessageToCustomer(index, explicitCustomerId = "") {
  const session = getActiveChatSession();
  const messages = session?.messages || [];
  const numericIndex = Number(index);
  const message = Number.isFinite(numericIndex) ? messages[numericIndex] : null;
  const customerId = explicitCustomerId || message?.meta?.customerId || message?.skillCard?.customerId || session?.customerId || "";
  const customer = customerId ? getCustomer(customerId) : null;
  if (!message || message.role !== "assistant" || !String(message.content || "").trim()) {
    showToast("当前回复没有可保存内容");
    return;
  }
  if (!customer) {
    openModal({ type: "saveChatSolution", title: "保存为方案", messageIndex: index });
    return;
  }
  const now = new Date().toISOString();
  const existingRecordId = message.skillCard?.recordId || "";
  const existingRecord = existingRecordId ? state.db.aiGenerationRecords.find((item) => item.id === existingRecordId) : null;
  if (existingRecord?.customerId === customer.id) {
    await saveHistoryToCustomer(existingRecordId);
    return;
  }
  const sourceContent = existingRecord?.outputContent || message.content;
  const generatedTitle = buildChatSolutionTitle(customer, session, {
    ...message,
    content: sourceContent,
    title: existingRecord?.title || message.skillCard?.title || ""
  });

  const data = await postJson("/api/crm/upsert", {
    collection: "aiGenerationRecords",
    item: {
      customerId: customer.id,
      userId: state.user.id,
      generationType: "proposal_outline",
      title: generatedTitle,
      prompt: `来自 AI 对话：${session?.title || "未命名会话"}`,
      modelName: existingRecord?.modelName || "AI 对话",
      outputContent: sourceContent,
      skillId: message.meta?.skillId || "",
      inputContext: {
        ...(existingRecord?.inputContext || {}),
        messageType: "ai_response",
        source: "manual_save_from_ai_chat",
        chatSessionId: session?.id || "",
        chatSessionTitle: session?.title || "",
        originalCustomerId: message.meta?.customerId || message.skillCard?.customerId || session?.customerId || "",
        originalRecordId: existingRecordId,
        process: message.process || [],
        metadata: message.metadata || {},
        customerArchive: {
          savedAt: now,
          savedBy: state.user.id,
          savedByName: state.user.name || state.user.email || "内部用户",
          customerId: customer.id,
          source: "manual_save_from_ai_chat"
        }
      },
      createdAt: now,
      updatedAt: now
    }
  });
  await loadBootstrap();
  const recordId = data.item?.id;
  state.selectedCustomerId = customer.id;
  state.selectedHistoryId = recordId || "";
  state.modal = null;
  state.saveChatSolutionKeyword = "";
  state.view = "detail";
  state.detailTab = "ai";
  showToast("已保存到客户档案，可在 AI 分析中查看");
  render();
}

function buildChatSolutionTitle(customer, session, message) {
  const firstHeading = message?.title
    || String(message?.content || "").match(/^\s*#\s+(.+)$/m)?.[1]
    || String(message?.content || "").match(/^\s*##\s+(.+)$/m)?.[1];
  const base = firstHeading || session?.title || "AI 对话方案";
  const cleaned = stripPlainText(base, 48).replace(/^["“”'‘’]+|["“”'‘’]+$/g, "");
  return `${customer.name} - ${cleaned || "AI 对话方案"}`;
}

function parseClientSseBlock(block = "") {
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

function crmHeaders(extra = {}) {
  return {
    ...extra,
    ...(state.token ? { "X-CRM-Token": state.token } : {})
  };
}

function formToObject(form, submitter = null) {
  const entries = Object.fromEntries(new FormData(form));
  if (submitter?.name) entries[submitter.name] = submitter.value;
  for (const [key, value] of Object.entries(entries)) {
    entries[key] = typeof value === "string" ? value.trim() : value;
  }
  return entries;
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function renderSelect(id, options, selected) {
  return `
    <select id="${escapeAttr(id)}">
      ${options.map((option) => {
        const value = Array.isArray(option) ? option[0] : option;
        const label = Array.isArray(option) ? option[1] : option;
        return `<option value="${escapeAttr(value)}" ${String(value) === String(selected || "") ? "selected" : ""}>${escapeHtml(label)}</option>`;
      }).join("")}
    </select>
  `;
}

function inputField(label, name, value = "", required = false, type = "text", disabled = false) {
  return `
    <label>
      ${escapeHtml(label)}
      <input name="${escapeAttr(name)}" type="${escapeAttr(type)}" value="${escapeAttr(value || "")}" ${required ? "required" : ""} ${disabled ? "disabled" : ""}>
    </label>
  `;
}

function textareaField(label, name, value = "", required = false) {
  return `
    <label class="spanTwo">
      ${escapeHtml(label)}
      <textarea name="${escapeAttr(name)}" rows="3" ${required ? "required" : ""}>${escapeHtml(value || "")}</textarea>
    </label>
  `;
}

function selectField(label, name, options, selected) {
  return `
    <label>
      ${escapeHtml(label)}
      <select name="${escapeAttr(name)}">
        ${options.map((option) => {
          const value = Array.isArray(option) ? option[0] : option;
          const text = Array.isArray(option) ? option[1] : option;
          return `<option value="${escapeAttr(value)}" ${String(value) === String(selected || "") ? "selected" : ""}>${escapeHtml(text)}</option>`;
        }).join("")}
      </select>
    </label>
  `;
}

function renderStatus(status) {
  const className = {
    "跟进中": "active",
    "暂缓": "paused",
    "已成交": "won",
    "失败": "lost"
  }[status] || "active";
  return `<span class="statusTag ${className}">${escapeHtml(status || "跟进中")}</span>`;
}

function renderMarkdownPreview(title, markdown = "", limit = 1200, compact = false) {
  const normalized = String(markdown || "暂无内容").trim() || "暂无内容";
  const compactText = normalized.replace(/\s+/g, " ");
  const isLong = normalized.length > limit || normalized.split(/\r?\n/).length > 18;
  if (!isLong) {
    return `<div class="markdownPane ${compact ? "compactMarkdown" : ""}">${markdownToHtml(normalized)}</div>`;
  }
  const key = registerTextDetail(title, normalized);
  const preview = trimMarkdown(normalized, limit);
  return `
    <div class="markdownPane markdownPreview ${compact ? "compactMarkdown" : ""}">
      ${markdownToHtml(preview)}
    </div>
    <div class="previewFooter">
      <small>已收起 ${compactText.length.toLocaleString("zh-CN")} 字内容，避免页面过长。</small>
      <button class="inlineDetailButton" type="button" data-action="open-text-detail" data-key="${escapeAttr(key)}">查看完整内容</button>
    </div>
  `;
}

function trimMarkdown(markdown, limit) {
  const text = String(markdown || "").trim();
  if (text.length <= limit) return text;
  const sliced = text.slice(0, limit);
  const lastBreak = sliced.lastIndexOf("\n\n");
  return `${lastBreak > 320 ? sliced.slice(0, lastBreak) : sliced}...`;
}

function stripText(markdown = "") {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|[\]-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLatestCustomerGeneration(customerId, type) {
  return state.db.aiGenerationRecords
    .filter((item) => item.customerId === customerId && item.generationType === type)
    .filter((item) => getRecordJobStatus(item) !== "failed")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

function getSavedCustomerArchiveRecords(customerId) {
  return (state.db.aiGenerationRecords || [])
    .filter((record) => record.customerId === customerId)
    .filter((record) => getCustomerArchiveMeta(record).savedAt)
    .filter((record) => getRecordJobStatus(record) !== "failed")
    .sort((a, b) => new Date(getCustomerArchiveMeta(b).savedAt || b.updatedAt || b.createdAt) - new Date(getCustomerArchiveMeta(a).savedAt || a.updatedAt || a.createdAt));
}

function getCustomerArchiveMeta(record = {}) {
  return record.inputContext?.customerArchive || {};
}

function getArchiveRecordPreview(record = {}) {
  if (record.generationType === "interaction_image") {
    const board = getInteractionImageBoard(record);
    const completed = countInteractionItems(board.items, "completed");
    return `${board.style || "自动风格"} · ${board.websiteType || "自动类型"} · ${completed}/${board.items.length || 0} 张已完成`;
  }
  if (record.generationType === "lightweight_solution_ppt") {
    const task = record.inputContext?.pptTask || {};
    const imageCount = task.result?.imageCount || task.imageCount || task.result?.imageFiles?.length || 0;
    return `PPT 任务：${task.status || getRecordJobStatus(record)} · ${task.pptInput?.pageCount || "自动页数"} · ${imageCount ? `image2 ${imageCount} 页` : "等待图片页"}`;
  }
  const text = stripText(record.outputContent || "");
  return text.slice(0, 120) || "已保存的 AI 文档，点击进入全屏查看。";
}

function summarizeNextQuestionReport(markdown = "") {
  const plain = stripText(markdown);
  const questionRows = String(markdown || "").match(/\|\s*\d+\s*\|/g) || [];
  return {
    goals: extractSectionPlain(markdown, "本次沟通目标").slice(0, 34) || "3-5 条",
    questionCount: questionRows.length ? String(Math.min(questionRows.length, 12)) : "8-12",
    focus: /AI/.test(plain) ? "AI 预期 / MVP / 决策" : "MVP / 预算 / 决策",
    decision: extractSectionPlain(markdown, "沟通后应形成的判断").slice(0, 34) || "是否进入下一阶段"
  };
}

function summarizeLightweightSolutionReport(markdown = "") {
  const plain = stripText(markdown);
  const portSections = String(markdown || "").match(/###\s+3\.\d+|###\s+.*端.*结构/g) || [];
  const aiRows = String(markdown || "").match(/\|\s*[^|\n]*\s*\|\s*[^|\n]*\s*\|\s*[^|\n]*\s*\|\s*[^|\n]*AI[^|\n]*\s*\|/g) || [];
  return {
    layers: extractSectionPlain(markdown, "二、从当前需求出发，可进一步梳理的产品层次").slice(0, 28) || "核心 / 增强 / 支撑 / 后台",
    ports: portSections.length ? `${Math.min(portSections.length, 6)} 个端口` : "按端口拆分",
    ai: aiRows.length ? `${Math.min(aiRows.length, 8)} 个场景` : (/AI/.test(plain) ? "已梳理" : "按需补充"),
    next: extractSectionPlain(markdown, "六、后续建议确认事项").slice(0, 30) || "确认一期 MVP"
  };
}

function summarizeLightweightSolutionPptOutline(markdown = "") {
  const pageCount = (String(markdown || "").match(/^###\s*第\d+页/gm) || []).length;
  const style = extractSectionPlain(markdown, "PPT建议风格");
  const position = extractSectionPlain(markdown, "PPT整体定位");
  return {
    pages: pageCount ? `${Math.min(pageCount, 16)} 页` : "约 10 页",
    position: position.slice(0, 28) || "售前讲解 / 客户内部评审",
    style: style.slice(0, 32) || "简洁商务 / SaaS 产品感",
    next: /PPT生成提示词/.test(markdown) ? "可生成 PPTX" : "补齐生成提示词"
  };
}

function summarizeLightweightSolutionPptTask(record) {
  const task = record?.inputContext?.pptTask || {};
  const status = normalizeHelpCenterStatus(getRecordJobStatus(record));
  const result = task.result || {};
  const imageCount = result.imageCount || task.imageCount || result.imageFiles?.length || 0;
  const engine = result.engine || task.engine || "PPT Skill";
  const imageModel = result.imageModel || task.imageModel || "";
  return {
    status: getRecordJobStatusLabel(status),
    pageCount: task.pptInput?.pageCount ? `${task.pptInput.pageCount} 页` : "自动估算",
    style: task.pptInput?.style || "自动填充",
    engine,
    imageModel,
    imageResult: imageCount ? `image2 ${imageCount} 张` : status === "failed" ? "未生成图片页" : "等待图片页",
    result: task.viewerUrl || task.downloadUrl ? "可预览 / 下载" : status === "failed" ? "生成失败" : "等待生成"
  };
}

function renderPptTaskLinkActions(record) {
  const task = record?.inputContext?.pptTask || {};
  return [
    task.viewerUrl ? `<a class="ghostButton" href="${escapeAttr(task.viewerUrl)}" target="_blank" rel="noopener">预览PPT</a>` : "",
    task.downloadUrl ? `<a class="ghostButton" href="${escapeAttr(task.downloadUrl)}" target="_blank" rel="noopener">下载PPT</a>` : ""
  ].filter(Boolean).join("");
}

function extractMarkdownSections(markdown = "") {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const sections = [];
  let intro = [];
  let current = null;
  const pushCurrent = () => {
    if (current) sections.push({
      title: current.title,
      markdown: current.lines.join("\n").trim()
    });
  };
  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      if (!sections.length && !current && intro.join("\n").trim()) {
        sections.push({ title: "报告摘要", markdown: intro.join("\n").trim() });
      }
      pushCurrent();
      current = { title: match[1].replace(/^\d+[.、]\s*/, ""), lines: [line] };
      intro = [];
    } else if (current) {
      current.lines.push(line);
    } else {
      intro.push(line);
    }
  }
  pushCurrent();
  return sections.filter((section) => section.markdown);
}

function extractSectionPlain(markdown = "", title = "") {
  const section = extractMarkdownSections(markdown)
    .find((item) => item.title.includes(title) || title.includes(item.title));
  return stripText(section?.markdown || "");
}

function renderTextPreview(title, text, limit = 96) {
  const normalized = String(text || "待补充").trim() || "待补充";
  const compact = normalized.replace(/\s+/g, " ");
  const isLong = compact.length > limit || normalized.split(/\r?\n/).length > 3;
  const preview = isLong ? `${compact.slice(0, limit)}...` : normalized;
  if (!isLong) return `<p class="textPreview">${escapeHtml(preview)}</p>`;

  const key = registerTextDetail(title, normalized);
  return `
    <p class="textPreview collapsed">${escapeHtml(preview)}</p>
    <button class="inlineDetailButton" type="button" data-action="open-text-detail" data-key="${escapeAttr(key)}">查看详情</button>
  `;
}

function paginateItems(items, pageKey) {
  const pageSize = getPageSize(pageKey);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = clamp(Number(state.pages[pageKey] || 1), 1, pageCount);
  state.pages[pageKey] = current;
  const start = (current - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: current,
    pageCount,
    pageSize,
    total,
    start: total ? start + 1 : 0,
    end: Math.min(start + pageSize, total)
  };
}

function getPageSize(pageKey) {
  if (pageKey === "customers") return pageSizes.customers;
  if (pageKey.startsWith("chatSessions_")) return pageSizes.chatSessions;
  if (pageKey.startsWith("chatHistory_")) return pageSizes.chatHistory;
  if (pageKey.startsWith("follows_")) return pageSizes.follows;
  if (pageKey.startsWith("history_")) return pageSizes.history;
  if (pageKey.startsWith("files_")) return pageSizes.files;
  if (pageKey.startsWith("settings_")) return pageSizes.settings;
  if (pageKey.startsWith("kb_chunks_")) return 5;
  return 8;
}

function renderPaginationControls(pageKey, pagination) {
  const compact = isCompactPagination(pageKey);
  if (pagination.total <= pagination.pageSize) {
    return pagination.total
      ? `
        <div class="paginationBar paginationSingle ${compact ? "paginationCompactMode" : ""}">
          <span>共 ${pagination.total} 条，每页 ${pagination.pageSize} 条</span>
        </div>
      `
      : "";
  }
  const baseAttrs = `data-page-key="${escapeAttr(pageKey)}"`;
  return `
    <div class="paginationBar ${compact ? "paginationCompactMode" : ""}">
      <div class="paginationInfo">
        <strong>第 ${pagination.page} / ${pagination.pageCount} 页</strong>
        <span>当前 ${pagination.start}-${pagination.end} 条，共 ${pagination.total} 条，每页 ${pagination.pageSize} 条</span>
      </div>
      <div class="paginationButtons">
        <button class="pagerEdge" type="button" data-action="change-page" ${baseAttrs} data-page="1" ${pagination.page <= 1 ? "disabled" : ""} aria-label="首页">${compact ? "<<" : "首页"}</button>
        <button class="pagerArrow" type="button" data-action="change-page" ${baseAttrs} data-page="${pagination.page - 1}" ${pagination.page <= 1 ? "disabled" : ""} aria-label="上一页">${compact ? "<" : "上一页"}</button>
        ${renderPageNumberButtons(pageKey, pagination)}
        <button class="pagerArrow" type="button" data-action="change-page" ${baseAttrs} data-page="${pagination.page + 1}" ${pagination.page >= pagination.pageCount ? "disabled" : ""} aria-label="下一页">${compact ? ">" : "下一页"}</button>
        <button class="pagerEdge" type="button" data-action="change-page" ${baseAttrs} data-page="${pagination.pageCount}" ${pagination.page >= pagination.pageCount ? "disabled" : ""} aria-label="末页">${compact ? ">>" : "末页"}</button>
      </div>
    </div>
  `;
}

function isCompactPagination(pageKey) {
  return pageKey.startsWith("history_")
    || pageKey.startsWith("chatSessions_")
    || pageKey.startsWith("chatHistory_")
    || pageKey.startsWith("follows_")
    || pageKey.startsWith("files_")
    || pageKey.startsWith("kb_chunks_");
}

function renderPageNumberButtons(pageKey, pagination) {
  const pages = getPaginationWindow(pagination.page, pagination.pageCount);
  return pages.map((page, index) => {
    if (page === "...") {
      return `<span class="pagerEllipsis" aria-hidden="true" data-index="${index}">...</span>`;
    }
    return `
      <button class="pagerNumber ${page === pagination.page ? "active" : ""}" type="button" data-action="change-page" data-page-key="${escapeAttr(pageKey)}" data-page="${page}" ${page === pagination.page ? "aria-current=\"page\"" : ""}>
        ${page}
      </button>
    `;
  }).join("");
}

function getPaginationWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (current >= total - 2) {
    pages.add(total - 1);
    pages.add(total - 2);
    pages.add(total - 3);
  }
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("...");
    result.push(page);
  });
  return result;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function registerTextDetail(title, text) {
  const key = `text_${Object.keys(state.textDetails).length + 1}`;
  state.textDetails[key] = { title, text };
  return key;
}

function renderEmptyState(title, text) {
  return `<div class="emptyState"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`;
}

function renderEmptyRow(text, colspan) {
  return `<tr><td colspan="${colspan}">${renderEmptyState(text, "")}</td></tr>`;
}

function markdownToHtml(markdown = "") {
  const source = normalizeMarkdownForDisplay(markdown).replace(/\r\n?/g, "\n");
  if (!source.trim()) return "<p>暂无内容</p>";

  const lines = source.split("\n");
  const html = [];
  let paragraph = [];
  let inCodeBlock = false;
  let codeFence = "";
  let codeLanguage = "";
  let codeLines = [];
  const listStack = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) html.push(`<p>${renderInlineMarkdown(text)}</p>`);
    paragraph = [];
  };
  const closeLists = (targetLength = 0) => {
    while (listStack.length > targetLength) {
      html.push(`</${listStack.pop().type}>`);
    }
  };
  const flushCodeBlock = () => {
    const code = codeLines.join("\n");
    if (isMermaidCodeBlock(codeLanguage, code)) {
      html.push(renderMermaidDiagram(code, codeLanguage));
      inCodeBlock = false;
      codeFence = "";
      codeLanguage = "";
      codeLines = [];
      return;
    }
    const languageClass = codeLanguage ? ` class="language-${escapeAttr(codeLanguage)}"` : "";
    html.push(`<pre><code${languageClass}>${escapeHtml(code)}</code></pre>`);
    inCodeBlock = false;
    codeFence = "";
    codeLanguage = "";
    codeLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();
    const fenceMatch = line.match(/^\s*(```|~~~)\s*([\w-]*)?.*$/);

    if (inCodeBlock) {
      if (fenceMatch && fenceMatch[1] === codeFence) {
        flushCodeBlock();
      } else {
        codeLines.push(rawLine);
      }
      continue;
    }

    if (fenceMatch) {
      flushParagraph();
      closeLists();
      inCodeBlock = true;
      codeFence = fenceMatch[1];
      codeLanguage = sanitizeCssClass(fenceMatch[2] || "");
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeLists();
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      flushParagraph();
      closeLists();
      const table = collectMarkdownTable(lines, index);
      html.push(renderMarkdownTable(table));
      index = table.nextIndex - 1;
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      flushParagraph();
      closeLists();
      const quoteLines = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      index -= 1;
      html.push(`<blockquote>${markdownToHtml(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      flushParagraph();
      closeLists();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (/^([-*_])(?:\s*\1){2,}$/.test(trimmed)) {
      flushParagraph();
      closeLists();
      html.push("<hr>");
      continue;
    }

    const listMatch = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      const indent = listMatch[1].length;
      const level = Math.min(6, Math.floor(indent / 2));
      const type = /^\d/.test(listMatch[2]) ? "ol" : "ul";
      while (listStack.length && listStack[listStack.length - 1].level > level) {
        closeLists(listStack.length - 1);
      }
      const activeList = listStack[listStack.length - 1];
      if (!activeList || activeList.level < level) {
        html.push(`<${type}>`);
        listStack.push({ level, type });
      } else if (activeList.level === level && activeList.type !== type) {
        closeLists(listStack.length - 1);
        html.push(`<${type}>`);
        listStack.push({ level, type });
      }

      const content = listMatch[3];
      const taskMatch = content.match(/^\[([ xX])\]\s+(.+)$/);
      if (taskMatch) {
        const checked = taskMatch[1].toLowerCase() === "x";
        html.push(`<li class="taskItem"><input type="checkbox" disabled ${checked ? "checked" : ""}>${renderInlineMarkdown(taskMatch[2])}</li>`);
      } else {
        html.push(`<li>${renderInlineMarkdown(content)}</li>`);
      }
      continue;
    }

    closeLists();
    paragraph.push(trimmed);
  }

  if (inCodeBlock) flushCodeBlock();
  flushParagraph();
  closeLists();
  return html.join("") || "<p>暂无内容</p>";
}

function normalizeMarkdownForDisplay(markdown = "") {
  let source = String(markdown || "").replace(
    /^>\s*image2\s*调用失败：\s*(\{.*?new_api_error.*?\})\s*$/gim,
    (_, rawError) => `> 历史记录提示：这条交互图当时使用旧模型配置生成失败（${summarizeImage2DisplayError(rawError)}）。当前已切换为可用图片模型，请重新生成交互图获取真实图片。`
  );
  if (/image2\s*请求异常|image2 request timeout/i.test(source)) {
    source = source
      .replace(
        /^>\s*image2\s*请求异常：.*$/gim,
        "> 历史记录提示：这条交互图当时同步等待 image2 超时。当前版本已改为后台生成，提交后可关闭弹窗，完成后会自动通知。"
      )
      .replace(/\n*!\[[^\]]*]\(data:image\/svg\+xml;base64,[^)]+\)\n*/gi, "\n")
      .replace(/\| 生成状态 \| 占位预览 \|/g, "| 生成状态 | 历史同步超时 |");
  }
  return source;
}

function summarizeImage2DisplayError(rawError = "") {
  const text = String(rawError || "");
  const message = text.match(/"message"\s*:\s*"([^"]+)"/)?.[1] || text;
  if (/no access to model\s+image2/i.test(message)) return "当前 Key 没有旧模型 image2 的访问权限";
  return message.replace(/\s+/g, " ").slice(0, 120);
}

function renderInlineMarkdown(text = "") {
  const codeSpans = [];
  let html = String(text).replace(/`([^`]+)`/g, (_, code) => {
    const token = `\uE000CODE${codeSpans.length}\uE000`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  html = escapeHtml(html);
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;.*?&quot;)?\)/g, (match, alt, url) => {
    const safeUrl = sanitizeMarkdownUrl(url, "image");
    if (!safeUrl) return match;
    return `<img src="${safeUrl}" alt="${escapeAttr(unescapeBasicEntities(alt))}" loading="lazy">`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;.*?&quot;)?\)/g, (match, label, url) => {
    const safeUrl = sanitizeMarkdownUrl(url, "link");
    if (!safeUrl) return match;
    const external = /^https?:\/\//i.test(unescapeBasicEntities(url)) ? ` target="_blank" rel="noreferrer"` : "";
    return `<a href="${safeUrl}"${external}>${label}</a>`;
  });
  html = html
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^\*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\s][^_]*?)_/g, "$1<em>$2</em>");

  for (let index = 0; index < codeSpans.length; index += 1) {
    html = html.replaceAll(`\uE000CODE${index}\uE000`, codeSpans[index]);
  }
  return html;
}

function isMarkdownTableStart(lines, index) {
  return Boolean(lines[index]?.includes("|") && isMarkdownTableDivider(lines[index + 1] || ""));
}

function isMarkdownTableDivider(line = "") {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function collectMarkdownTable(lines, startIndex) {
  const header = splitMarkdownTableRow(lines[startIndex]);
  const divider = splitMarkdownTableRow(lines[startIndex + 1]);
  const alignments = divider.map((cell) => {
    const value = cell.replace(/\s/g, "");
    if (value.startsWith(":") && value.endsWith(":")) return "center";
    if (value.endsWith(":")) return "right";
    return "left";
  });
  const rows = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length && lines[nextIndex].trim() && lines[nextIndex].includes("|")) {
    rows.push(splitMarkdownTableRow(lines[nextIndex]));
    nextIndex += 1;
  }
  return { header, rows, alignments, nextIndex };
}

function renderMarkdownTable({ header, rows, alignments }) {
  const alignAttr = (index) => ` style="text-align: ${alignments[index] || "left"}"`;
  return `
    <div class="markdownTableWrap">
      <table>
        <thead><tr>${header.map((cell, index) => `<th${alignAttr(index)}>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>${header.map((_, index) => `<td${alignAttr(index)}>${renderInlineMarkdown(row[index] || "")}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function isMermaidCodeBlock(language = "", code = "") {
  const lang = String(language || "").toLowerCase();
  const text = String(code || "").trim();
  if (["mermaid", "mmd", "flowchart", "graph", "sequence"].includes(lang)) return true;
  return /^(flowchart|graph)\s+(td|tb|bt|lr|rl)\b/i.test(text) || /^sequenceDiagram\b/i.test(text);
}

function renderMermaidDiagram(code = "", language = "") {
  const source = normalizeMermaidSource(String(code || "").trim(), language);
  const lower = source.toLowerCase();
  const rendered = /^sequencediagram\b/i.test(source)
    ? renderSequenceDiagramSvg(source)
    : /^(flowchart|graph)\s+(td|tb|bt|lr|rl)\b/i.test(source)
      ? renderFlowchartSvg(source)
      : "";

  if (rendered) {
    return `
      <div class="mermaidDiagramWrap" data-diagram-type="${escapeAttr(lower.startsWith("sequence") ? "sequence" : "flowchart")}">
        ${rendered}
        <details class="mermaidSource">
          <summary>查看 Mermaid 源码</summary>
          <pre><code class="language-mermaid">${escapeHtml(source)}</code></pre>
        </details>
      </div>
    `;
  }

  return `
    <div class="mermaidDiagramWrap unsupported">
      <p>当前 Mermaid 语法暂未支持渲染，已保留源码。</p>
      <pre><code class="language-mermaid">${escapeHtml(source)}</code></pre>
    </div>
  `;
}

function normalizeMermaidSource(source = "", language = "") {
  const text = String(source || "").trim();
  if (/^(flowchart|graph)\s+/i.test(text) || /^sequenceDiagram\b/i.test(text)) return text;
  const lang = String(language || "").toLowerCase();
  if (lang === "flowchart") return `flowchart TD\n${text}`;
  if (lang === "graph") return `graph TD\n${text}`;
  if (lang === "sequence") return `sequenceDiagram\n${text}`;
  return text;
}

function renderFlowchartSvg(source = "") {
  const lines = source.replace(/;/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] || "";
  const direction = firstLine.match(/(?:flowchart|graph)\s+(\w+)/i)?.[1]?.toUpperCase() || "TD";
  const isHorizontal = ["LR", "RL"].includes(direction);
  const nodes = new Map();
  const edges = [];

  for (const line of lines.slice(1)) {
    const cleaned = stripMermaidComment(line);
    if (!cleaned || /^(subgraph|end\b|classDef|class |style |linkStyle|click )/i.test(cleaned)) continue;
    parseFlowchartLine(cleaned, nodes, edges);
  }

  if (!nodes.size) return "";
  const levels = buildFlowchartLevels(nodes, edges);
  const nodeWidth = 180;
  const nodeHeight = 62;
  const gapX = 90;
  const gapY = 58;
  const margin = 42;
  const positions = new Map();
  const levelGroups = new Map();

  for (const [id, level] of levels.entries()) {
    if (!levelGroups.has(level)) levelGroups.set(level, []);
    levelGroups.get(level).push(id);
  }

  const maxLevel = Math.max(...levelGroups.keys());
  let maxCount = 1;
  for (const group of levelGroups.values()) maxCount = Math.max(maxCount, group.length);
  const width = isHorizontal
    ? margin * 2 + (maxLevel + 1) * nodeWidth + maxLevel * gapX
    : margin * 2 + maxCount * nodeWidth + Math.max(0, maxCount - 1) * gapX;
  const height = isHorizontal
    ? margin * 2 + maxCount * nodeHeight + Math.max(0, maxCount - 1) * gapY
    : margin * 2 + (maxLevel + 1) * nodeHeight + maxLevel * gapY;

  for (const [level, group] of levelGroups.entries()) {
    group.forEach((id, index) => {
      const x = isHorizontal ? margin + level * (nodeWidth + gapX) : margin + index * (nodeWidth + gapX);
      const y = isHorizontal ? margin + index * (nodeHeight + gapY) : margin + level * (nodeHeight + gapY);
      positions.set(id, { x, y, width: nodeWidth, height: nodeHeight });
    });
  }

  const edgeSvg = edges.map((edge) => renderFlowchartEdge(edge, positions, isHorizontal)).join("");
  const nodeSvg = Array.from(nodes.values()).map((node) => renderFlowchartNode(node, positions.get(node.id))).join("");
  return `
    <svg class="mermaidSvg flowchartSvg" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" role="img" aria-label="Mermaid flowchart">
      <defs>
        <marker id="arrow-${hashDiagram(source)}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L8,3 z" fill="#4263eb"></path>
        </marker>
      </defs>
      ${edgeSvg.replaceAll("__ARROW_ID__", `arrow-${hashDiagram(source)}`)}
      ${nodeSvg}
    </svg>
  `;
}

function parseFlowchartLine(line, nodes, edges) {
  for (const statement of splitMermaidStatements(line)) {
    parseFlowchartStatement(statement, nodes, edges);
  }
}

function splitMermaidStatements(line = "") {
  return String(line || "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function parseFlowchartStatement(statement, nodes, edges) {
  const labelEdgeMatch = statement.match(/(.+?)\s*(--|==|-\.)\s+(.+?)\s+(-->|==>|\.->)\s*(.+)$/);
  if (labelEdgeMatch) {
    pushFlowchartEdge({
      fromRaw: labelEdgeMatch[1],
      toRaw: labelEdgeMatch[5],
      operator: `${labelEdgeMatch[2]}${labelEdgeMatch[4]}`,
      label: labelEdgeMatch[3]
    }, nodes, edges);
    return;
  }

  const edgeMatch = statement.match(/(.+?)\s*(-->|---|==>|-.->|--|-\.-)\s*(?:\|([^|]+)\|\s*)?(.+)$/);
  if (edgeMatch) {
    pushFlowchartEdge({
      fromRaw: edgeMatch[1],
      toRaw: edgeMatch[4],
      operator: edgeMatch[2],
      label: edgeMatch[3] || extractInlineEdgeLabel(statement)
    }, nodes, edges);
    return;
  }

  const node = parseMermaidNode(statement);
  if (node) upsertMermaidNode(nodes, node);
}

function pushFlowchartEdge({ fromRaw, toRaw, operator, label }, nodes, edges) {
  const from = parseMermaidNode(fromRaw);
  let to = parseMermaidNode(toRaw);
  if (!to && hasFlowchartConnector(toRaw)) {
    const chain = splitFirstFlowchartConnector(toRaw);
    to = parseMermaidNode(chain?.fromRaw);
    if (from && to) {
      upsertMermaidNode(nodes, from);
      upsertMermaidNode(nodes, to);
      edges.push({
        from: from.id,
        to: to.id,
        label: cleanMermaidText(label || ""),
        dashed: operator.includes("."),
        thick: operator.includes("=")
      });
      parseFlowchartStatement(`${chain.fromRaw} ${chain.operator} ${chain.toRaw}`, nodes, edges);
    }
    return;
  }

  if (!from || !to) return;
  upsertMermaidNode(nodes, from);
  upsertMermaidNode(nodes, to);
  edges.push({
    from: from.id,
    to: to.id,
    label: cleanMermaidText(label || ""),
    dashed: operator.includes("."),
    thick: operator.includes("=")
  });
}

function parseMermaidNode(raw = "") {
  const text = String(raw || "").trim().replace(/;$/, "");
  const idMatch = text.match(/^([A-Za-z0-9_\u4e00-\u9fa5.-]+)/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const labelPart = text.slice(id.length).trim();
  const parsedLabel = parseMermaidNodeLabel(labelPart);
  if (labelPart && !parsedLabel) return null;
  const label = cleanMermaidText(parsedLabel?.label || id);
  const shape = parsedLabel?.shape || "rect";
  return { id, label, shape };
}

function parseMermaidNodeLabel(labelPart = "") {
  const source = String(labelPart || "").trim();
  if (!source) return null;
  const patterns = [
    [/^\[\[(.+)\]\]$/, "rect"],
    [/^\[\/(.+)\/\]$/, "rect"],
    [/^\[\\(.+)\\\]$/, "rect"],
    [/^\[\((.+)\)\]$/, "round"],
    [/^\[(.+)\]$/, "rect"],
    [/^\(\((.+)\)\)$/, "circle"],
    [/^\(\[(.+)\]\)$/, "round"],
    [/^\((.+)\)$/, "round"],
    [/^\{\{(.+)\}\}$/, "diamond"],
    [/^\{(.+)\}$/, "diamond"],
    [/^>(.+)\]$/, "rect"]
  ];
  for (const [pattern, shape] of patterns) {
    const match = source.match(pattern);
    if (match) return { label: match[1], shape };
  }
  return null;
}

function hasFlowchartConnector(text = "") {
  return /(-->|---|==>|-.->|--|-\.-)/.test(String(text || ""));
}

function splitFirstFlowchartConnector(text = "") {
  const match = String(text || "").match(/(.+?)\s*(-->|---|==>|-.->|--|-\.-)\s*(.+)$/);
  if (!match) return null;
  return {
    fromRaw: match[1].trim(),
    operator: match[2],
    toRaw: match[3].trim()
  };
}

function upsertMermaidNode(nodes, node) {
  const existing = nodes.get(node.id);
  nodes.set(node.id, {
    ...node,
    label: existing?.label && existing.label !== node.id ? existing.label : node.label,
    shape: existing?.shape && existing.shape !== "rect" ? existing.shape : node.shape
  });
}

function buildFlowchartLevels(nodes, edges) {
  const levels = new Map(Array.from(nodes.keys()).map((id) => [id, 0]));
  for (let pass = 0; pass < nodes.size + 2; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = Math.max(levels.get(edge.to) || 0, (levels.get(edge.from) || 0) + 1);
      if (next !== levels.get(edge.to)) {
        levels.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return levels;
}

function renderFlowchartNode(node, box) {
  if (!box) return "";
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const labelLines = wrapSvgText(node.label, 14);
  const text = labelLines.map((line, index) => `
    <text x="${centerX}" y="${centerY - (labelLines.length - 1) * 9 + index * 18}" text-anchor="middle" dominant-baseline="middle">${escapeSvg(line)}</text>
  `).join("");
  if (node.shape === "diamond") {
    const points = `${centerX},${box.y} ${box.x + box.width},${centerY} ${centerX},${box.y + box.height} ${box.x},${centerY}`;
    return `<g class="mermaidNode diamond"><polygon points="${points}"></polygon>${text}</g>`;
  }
  if (node.shape === "circle") {
    return `<g class="mermaidNode circle"><ellipse cx="${centerX}" cy="${centerY}" rx="${box.width / 2}" ry="${box.height / 2}"></ellipse>${text}</g>`;
  }
  const radius = node.shape === "round" ? 28 : 16;
  return `<g class="mermaidNode"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${radius}"></rect>${text}</g>`;
}

function renderFlowchartEdge(edge, positions, isHorizontal) {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return "";
  const start = isHorizontal
    ? { x: from.x + from.width, y: from.y + from.height / 2 }
    : { x: from.x + from.width / 2, y: from.y + from.height };
  const end = isHorizontal
    ? { x: to.x, y: to.y + to.height / 2 }
    : { x: to.x + to.width / 2, y: to.y };
  const mid = isHorizontal
    ? { x: (start.x + end.x) / 2, y: start.y }
    : { x: start.x, y: (start.y + end.y) / 2 };
  const path = isHorizontal
    ? `M${start.x} ${start.y} C${mid.x} ${start.y}, ${mid.x} ${end.y}, ${end.x} ${end.y}`
    : `M${start.x} ${start.y} C${start.x} ${mid.y}, ${end.x} ${mid.y}, ${end.x} ${end.y}`;
  const label = edge.label
    ? `<text class="mermaidEdgeLabel" x="${(start.x + end.x) / 2}" y="${(start.y + end.y) / 2 - 8}" text-anchor="middle">${escapeSvg(edge.label)}</text>`
    : "";
  return `<g class="mermaidEdge ${edge.dashed ? "dashed" : ""} ${edge.thick ? "thick" : ""}"><path d="${path}" marker-end="url(#__ARROW_ID__)"></path>${label}</g>`;
}

function renderSequenceDiagramSvg(source = "") {
  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean);
  const participants = [];
  const messages = [];
  const alias = new Map();

  for (const line of lines.slice(1)) {
    const cleaned = stripMermaidComment(line);
    if (!cleaned) continue;
    const participantMatch = cleaned.match(/^(participant|actor)\s+([A-Za-z0-9_\u4e00-\u9fa5-]+)(?:\s+as\s+(.+))?$/i);
    if (participantMatch) {
      const id = participantMatch[2];
      const label = cleanMermaidText(participantMatch[3] || id);
      if (!participants.includes(id)) participants.push(id);
      alias.set(id, label);
      continue;
    }
    const messageMatch = cleaned.match(/^(.+?)\s*(-{1,2}>>?|-->>?|\){0,1}->{1,2})\s*(.+?)(?:\s*:\s*(.+))?$/);
    if (messageMatch) {
      const from = messageMatch[1].trim();
      const to = messageMatch[3].trim();
      if (!participants.includes(from)) participants.push(from);
      if (!participants.includes(to)) participants.push(to);
      messages.push({
        from,
        to,
        label: cleanMermaidText(messageMatch[4] || ""),
        dashed: messageMatch[2].startsWith("--")
      });
    }
  }

  if (!participants.length) return "";
  const laneGap = 190;
  const marginX = 70;
  const top = 54;
  const messageGap = 70;
  const width = marginX * 2 + Math.max(1, participants.length - 1) * laneGap;
  const height = top + 92 + Math.max(1, messages.length) * messageGap;
  const xById = new Map(participants.map((id, index) => [id, marginX + index * laneGap]));
  const participantSvg = participants.map((id) => {
    const x = xById.get(id);
    const label = alias.get(id) || id;
    return `
      <g class="sequenceParticipant">
        <rect x="${x - 62}" y="18" width="124" height="38" rx="14"></rect>
        <text x="${x}" y="42" text-anchor="middle">${escapeSvg(label)}</text>
        <line x1="${x}" y1="58" x2="${x}" y2="${height - 22}"></line>
      </g>
    `;
  }).join("");
  const messageSvg = messages.map((message, index) => {
    const y = top + 54 + index * messageGap;
    const x1 = xById.get(message.from);
    const x2 = xById.get(message.to);
    const direction = x2 >= x1 ? 1 : -1;
    const labelX = (x1 + x2) / 2;
    return `
      <g class="sequenceMessage ${message.dashed ? "dashed" : ""}">
        <line x1="${x1}" y1="${y}" x2="${x2 - 10 * direction}" y2="${y}"></line>
        <path d="M${x2 - 10 * direction} ${y - 5} L${x2} ${y} L${x2 - 10 * direction} ${y + 5}"></path>
        ${message.label ? `<text x="${labelX}" y="${y - 12}" text-anchor="middle">${escapeSvg(message.label)}</text>` : ""}
      </g>
    `;
  }).join("");
  return `
    <svg class="mermaidSvg sequenceSvg" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" role="img" aria-label="Mermaid sequence diagram">
      ${participantSvg}
      ${messageSvg}
    </svg>
  `;
}

function stripMermaidComment(line = "") {
  return String(line || "").replace(/%%.*$/, "").trim();
}

function extractInlineEdgeLabel(line = "") {
  return String(line).match(/--\s*([^->|]+?)\s*--?>/)?.[1] || "";
}

function cleanMermaidText(text = "") {
  return String(text || "")
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function wrapSvgText(text = "", maxChars = 14) {
  const source = String(text || "");
  if (source.length <= maxChars) return [source];
  const lines = [];
  for (let index = 0; index < source.length && lines.length < 3; index += maxChars) {
    lines.push(source.slice(index, index + maxChars));
  }
  if (source.length > maxChars * 3) lines[2] = `${lines[2].slice(0, Math.max(1, maxChars - 1))}…`;
  return lines;
}

function hashDiagram(text = "") {
  let hash = 0;
  for (const char of String(text)) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function splitMarkdownTableRow(row = "") {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaped = false;
  for (const char of trimmed) {
    if (char === "|" && !escaped) {
      cells.push(current.trim().replace(/\\\|/g, "|"));
      current = "";
      continue;
    }
    current += char;
    escaped = char === "\\" && !escaped;
    if (char !== "\\") escaped = false;
  }
  cells.push(current.trim().replace(/\\\|/g, "|"));
  return cells;
}

function sanitizeMarkdownUrl(url = "", mode = "link") {
  const value = unescapeBasicEntities(url).trim();
  const allowed = mode === "image"
    ? /^(https?:\/\/|\/|\.\/|\.\.\/|data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,)/i
    : /^(https?:\/\/|mailto:|tel:|\/|#|\.\/|\.\.\/)/i;
  return allowed.test(value) ? escapeAttr(value) : "";
}

function sanitizeCssClass(value = "") {
  return String(value).toLowerCase().replace(/[^\w-]/g, "");
}

function unescapeBasicEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function splitList(value) {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDate(value) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function toLocalDatetime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalDatetime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function formatMoney(value) {
  const amount = Number(value || 0);
  if (!amount) return "未填写";
  if (amount >= 10000) return `${Math.round(amount / 10000)} 万`;
  return `${amount} 元`;
}

function formatFileSize(value = 0) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeSvg(value) {
  return escapeHtml(value);
}

function escapeAttr(value) {
  return escapeHtml(value);
}
