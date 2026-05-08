let summaries = [];
let selectedDateKey = "";

const nodes = {
  generateBtn: document.querySelector("#generateBtn"),
  summaryDate: document.querySelector("#summaryDate"),
  summaryList: document.querySelector("#summaryList"),
  summaryCount: document.querySelector("#summaryCount"),
  detailEmpty: document.querySelector("#detailEmpty"),
  summaryDetail: document.querySelector("#summaryDetail"),
  detailTitle: document.querySelector("#detailTitle"),
  detailMeta: document.querySelector("#detailMeta"),
  metricPages: document.querySelector("#metricPages"),
  metricTasks: document.querySelector("#metricTasks"),
  metricAssets: document.querySelector("#metricAssets"),
  personalTasks: document.querySelector("#personalTasks"),
  workTasks: document.querySelector("#workTasks"),
  managementTasks: document.querySelector("#managementTasks"),
  sourceCards: document.querySelector("#sourceCards"),
  markdownDetail: document.querySelector("#markdownDetail"),
  toast: document.querySelector("#toast")
};

nodes.summaryDate.value = getLocalDateKey(new Date());

nodes.generateBtn.addEventListener("click", async () => {
  await generateSelectedDate();
});

loadSummaries();

async function loadSummaries() {
  try {
    const data = await fetchJson("/api/daily-summaries");
    summaries = data.summaries || [];
    renderList();
    if (summaries.length) {
      await selectSummary(selectedDateKey || summaries[0].dateKey);
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function generateSelectedDate() {
  const date = nodes.summaryDate.value;
  if (!date) {
    showToast("请先选择要生成汇总的日期");
    return;
  }

  setGenerating(true);
  try {
    const data = await postJson("/api/daily-summaries/generate", { date });
    showToast(`已生成 ${data.summary.dateLabel} 的汇总`);
    selectedDateKey = data.summary.dateKey;
    await loadSummaries();
  } catch (error) {
    showToast(error.message);
  } finally {
    setGenerating(false);
  }
}

function renderList() {
  nodes.summaryCount.textContent = `${summaries.length} 天`;
  if (!summaries.length) {
    nodes.summaryList.innerHTML = `
      <div class="summaryListEmpty">
        还没有生成过每日汇总。选择日期后点击右上角“生成所选日期”，系统会读取该日期飞书知识库里的采集内容并生成记录。
      </div>
    `;
    nodes.detailEmpty.classList.remove("hidden");
    nodes.summaryDetail.classList.add("hidden");
    return;
  }

  nodes.summaryList.innerHTML = summaries.map((item) => `
    <button class="summaryCard ${item.dateKey === selectedDateKey ? "active" : ""}" type="button" data-date="${escapeHtml(item.dateKey)}">
      <div class="summaryCardHeader">
        <div>
          <strong>${escapeHtml(item.dateLabel)}</strong>
          <span class="eyebrow">${escapeHtml(formatGeneratedAt(item.generatedAt))}</span>
        </div>
      </div>
      <div class="cardStats">
        <span>${item.pageCount || 0} 条内容</span>
        <span>${item.taskCount || 0} 个任务</span>
      </div>
      <p>${escapeHtml(item.summaryPreview || "暂无摘要")}</p>
    </button>
  `).join("");

  for (const card of nodes.summaryList.querySelectorAll(".summaryCard")) {
    card.addEventListener("click", async () => {
      await selectSummary(card.dataset.date);
    });
  }
}

async function selectSummary(dateKey) {
  selectedDateKey = dateKey;
  renderList();
  try {
    const data = await fetchJson(`/api/daily-summaries/${dateKey}`);
    renderDetail(data.summary);
  } catch (error) {
    showToast(error.message);
  }
}

function renderDetail(summary) {
  nodes.detailEmpty.classList.add("hidden");
  nodes.summaryDetail.classList.remove("hidden");
  nodes.detailTitle.textContent = summary.dateLabel;
  nodes.detailMeta.textContent = `生成时间：${formatGeneratedAt(summary.generatedAt)} · 时区：${summary.timezone || "Asia/Shanghai"}`;
  nodes.metricPages.textContent = summary.pageCount || 0;
  nodes.metricTasks.textContent = countTasks(summary.tasks);
  nodes.metricAssets.textContent = (summary.assets || []).length;
  renderTaskList(nodes.personalTasks, summary.tasks?.personal || []);
  renderTaskList(nodes.workTasks, summary.tasks?.work || []);
  renderTaskList(nodes.managementTasks, summary.tasks?.management || []);
  nodes.sourceCards.innerHTML = (summary.pages || []).map((page) => `
    <article class="sourceCard">
      <h4>${escapeHtml(page.title)}</h4>
      <p>${escapeHtml(page.localSummary || "暂无摘要")}</p>
      <div class="cardStats">
        <span>${escapeHtml(page.createdAt || "")}</span>
        <span>${escapeHtml(page.documentId || "")}</span>
      </div>
    </article>
  `).join("");
  nodes.markdownDetail.textContent = summary.summaryMarkdown || "";
}

function renderTaskList(container, items) {
  container.innerHTML = items.length
    ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>暂无建议</li>";
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

function setGenerating(isGenerating) {
  nodes.generateBtn.disabled = isGenerating;
  nodes.summaryDate.disabled = isGenerating;
  nodes.generateBtn.textContent = isGenerating ? "生成中..." : "生成所选日期";
}

function showToast(message) {
  nodes.toast.textContent = message;
  nodes.toast.classList.add("show");
  setTimeout(() => nodes.toast.classList.remove("show"), 3200);
}

function countTasks(tasks = {}) {
  return ["personal", "work", "management"].reduce((total, key) => {
    return total + (Array.isArray(tasks[key]) ? tasks[key].length : 0);
  }, 0);
}

function formatGeneratedAt(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getLocalDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year").value;
  const month = parts.find((part) => part.type === "month").value;
  const day = parts.find((part) => part.type === "day").value;
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
