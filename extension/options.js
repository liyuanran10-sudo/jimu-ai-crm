const input = document.querySelector("#backendUrl");
const button = document.querySelector("#save");
const message = document.querySelector("#message");

document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.sync.get(["backendUrl"]);
  input.value = saved.backendUrl || "http://localhost:8787";
});

button.addEventListener("click", async () => {
  const backendUrl = input.value.trim().replace(/\/$/, "");
  await chrome.storage.sync.set({ backendUrl });
  message.textContent = "已保存。";
});
