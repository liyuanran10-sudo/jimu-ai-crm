const DEFAULT_BACKEND_URL = "http://localhost:8787";

const state = {
  backendUrl: DEFAULT_BACKEND_URL,
  latestCapture: null,
  sourceTitle: "",
  sourceUrl: ""
};

const elements = {
  content: document.querySelector("#content"),
  userNote: document.querySelector("#userNote"),
  organizeBtn: document.querySelector("#organizeBtn"),
  saveBtn: document.querySelector("#saveBtn"),
  reloadSelection: document.querySelector("#reloadSelection"),
  preview: document.querySelector("#preview"),
  message: document.querySelector("#message")
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await loadSelectedText();
});

elements.reloadSelection.addEventListener("click", loadSelectedText);
elements.organizeBtn.addEventListener("click", organize);
elements.saveBtn.addEventListener("click", save);

async function loadSettings() {
  const saved = await chrome.storage.sync.get(["backendUrl"]);
  state.backendUrl = saved.backendUrl || DEFAULT_BACKEND_URL;
}

async function loadSelectedText() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        text: window.getSelection()?.toString() || "",
        title: document.title,
        url: window.location.href
      })
    });

    const value = result?.result || {};
    state.sourceTitle = value.title || "";
    state.sourceUrl = value.url || "";
    if (value.text) {
      elements.content.value = value.text;
      showMessage("已读取当前页面选中文本。");
    } else {
      showMessage("没有检测到选中文本，可以手动粘贴。");
    }
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function organize() {
  const payload = readPayload();
  if (!payload) return;

  setBusy(true, "正在整理...");
  try {
    const data = await postJson("/api/organize", payload);
    state.latestCapture = data.capture;
    renderPreview(data.capture);
    elements.saveBtn.disabled = false;
    showMessage("整理完成，确认后可保存。");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function save() {
  if (!state.latestCapture) return;

  setBusy(true, "正在保存...");
  try {
    const data = await postJson("/api/save", { capture: state.latestCapture });
    if (data.result.mode === "notion") {
      showMessage(`已保存：${data.result.url}`);
    } else if (data.result.mode === "feishu") {
      showMessage(data.result.url ? `已保存到飞书：${data.result.url}` : "已保存到飞书。");
    } else {
      showMessage("远程同步未配置，已保存到本地 captures.jsonl。");
    }
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

function readPayload() {
  const content = elements.content.value.trim();
  if (!content) {
    showMessage("请先选择或粘贴内容。", true);
    return null;
  }

  return {
    content,
    sourceTitle: state.sourceTitle,
    sourceUrl: state.sourceUrl,
    userNote: elements.userNote.value.trim()
  };
}

async function postJson(path, body) {
  const response = await fetch(`${state.backendUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `请求失败：${response.status}`);
  }
  return data;
}

function renderPreview(capture) {
  elements.preview.innerHTML = `
    <h2>${escapeHtml(capture.title)}</h2>
    <p>${escapeHtml(capture.summary)}</p>
    <div class="tags">${(capture.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
  `;
}

function setBusy(isBusy, message) {
  elements.organizeBtn.disabled = isBusy;
  elements.saveBtn.disabled = isBusy || !state.latestCapture;
  if (message) showMessage(message);
}

function showMessage(message, isError = false) {
  elements.message.textContent = message || "";
  elements.message.classList.toggle("error", Boolean(isError));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
