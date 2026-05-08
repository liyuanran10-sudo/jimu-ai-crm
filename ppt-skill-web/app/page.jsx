"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const initialForm = {
  topic: "",
  customerName: "",
  projectBackground: "",
  coreContent: "",
  pageCount: 8,
  style: "现代商务 / 清晰汇报",
  hasTemplate: false
};

const statusText = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败"
};

export default function HomePage() {
  const [form, setForm] = useState(initialForm);
  const [templateFile, setTemplateFile] = useState(null);
  const [task, setTask] = useState(null);
  const [logs, setLogs] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const isActive = task && ["queued", "running"].includes(task.status);
  const statusLabel = task ? statusText[task.status] || task.status : "等待任务";

  const previewSrc = useMemo(() => {
    if (task?.status === "succeeded" && task.viewerUrl) return task.viewerUrl;
    return "";
  }, [task]);

  useEffect(() => {
    if (!isActive) return undefined;

    const timer = setInterval(async () => {
      await refreshTask(task.id);
    }, 2200);

    return () => clearInterval(timer);
  }, [isActive, task?.id]);

  async function refreshTask(taskId) {
    const response = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || "读取任务状态失败。");
      return;
    }

    setTask(payload.task);
    setLogs(payload.logs || "");
  }

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    setLogs("");

    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, String(value)));

      if (form.hasTemplate && templateFile) {
        body.append("template", templateFile);
      }

      const response = await fetch("/api/tasks", {
        method: "POST",
        body
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "创建任务失败。");
      }

      setTask(payload.task);
      await refreshTask(payload.task.id);
    } catch (submitError) {
      setError(submitError?.message || "创建任务失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function retryTask() {
    if (!task?.id) return;
    setError("");
    setLogs("");

    try {
      const response = await fetch(`/api/tasks/${task.id}/retry`, {
        method: "POST"
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "重试任务失败。");
      }

      setTask(payload.task);
      await refreshTask(payload.task.id);
    } catch (retryError) {
      setError(retryError?.message || "重试任务失败。");
    }
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <p className="kicker">Codex Skill Runner</p>
          <h1>本机 PPT Skill 可视化生成台</h1>
          <p className="subtitle">
            独立于 AICRM 的本地验证页面，提交主题和客户上下文后由后端创建任务，并调用 Codex 使用
            gpt-image2-ppt-skills 生成 PPT。
          </p>
        </div>
        <div className="status-pill">
          <span className="status-dot" />
          {statusLabel}
        </div>
      </header>

      <section className="workspace">
        <form className="panel" onSubmit={handleSubmit}>
          <div className="panel-header">
            <h2 className="panel-title">生成参数</h2>
            <p className="panel-note">先跑通本地流程，字段保持轻量，后续可以直接接入 AICRM 客户档案。</p>
          </div>

          <div className="form-grid">
            <div className="field full">
              <label htmlFor="topic">PPT 主题</label>
              <input
                id="topic"
                className="input"
                value={form.topic}
                onChange={(event) => updateField("topic", event.target.value)}
                placeholder="例如：华东制造 AI 质检项目售前方案"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="customerName">客户名称</label>
              <input
                id="customerName"
                className="input"
                value={form.customerName}
                onChange={(event) => updateField("customerName", event.target.value)}
                placeholder="例如：华东制造"
              />
            </div>

            <div className="field">
              <label htmlFor="pageCount">页数</label>
              <input
                id="pageCount"
                className="input"
                type="number"
                min="1"
                max="80"
                value={form.pageCount}
                onChange={(event) => updateField("pageCount", event.target.value)}
              />
            </div>

            <div className="field full">
              <label htmlFor="projectBackground">项目背景</label>
              <textarea
                id="projectBackground"
                className="textarea"
                value={form.projectBackground}
                onChange={(event) => updateField("projectBackground", event.target.value)}
                placeholder="客户行业、现状、业务痛点、已有系统、预算或推进阶段。"
              />
            </div>

            <div className="field full">
              <label htmlFor="coreContent">核心内容</label>
              <textarea
                id="coreContent"
                className="textarea"
                value={form.coreContent}
                onChange={(event) => updateField("coreContent", event.target.value)}
                placeholder="希望 PPT 覆盖的核心模块、AI 能力、实施路径、价值表达、案例方向等。"
              />
            </div>

            <div className="field">
              <label htmlFor="style">风格</label>
              <select
                id="style"
                className="select"
                value={form.style}
                onChange={(event) => updateField("style", event.target.value)}
              >
                <option>现代商务 / 清晰汇报</option>
                <option>科技蓝绿 / AI 产品感</option>
                <option>咨询公司 / 高密度图表</option>
                <option>投标方案 / 稳重正式</option>
                <option>极简白底 / 强结构</option>
              </select>
            </div>

            <div className="field">
              <label>模板</label>
              <div className="template-row">
                <input
                  id="hasTemplate"
                  type="checkbox"
                  checked={form.hasTemplate}
                  onChange={(event) => {
                    updateField("hasTemplate", event.target.checked);
                    if (!event.target.checked) {
                      setTemplateFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }
                  }}
                />
                <label htmlFor="hasTemplate">使用上传 PPT 模板</label>
              </div>
            </div>

            {form.hasTemplate ? (
              <div className="field full">
                <label htmlFor="template">上传 PPT 模板</label>
                <input
                  id="template"
                  ref={fileInputRef}
                  className="file-input"
                  type="file"
                  accept=".ppt,.pptx,.potx"
                  onChange={(event) => setTemplateFile(event.target.files?.[0] || null)}
                />
                <small>模板会保存到当前任务目录，只作为生成参考，不会被覆盖。</small>
              </div>
            ) : null}

            <div className="actions">
              <span className="hint">输出目录：outputs/{"{task_id}"}/</span>
              <button className="primary-button" type="submit" disabled={submitting || isActive}>
                {submitting ? "创建中..." : isActive ? "任务执行中" : "创建生成任务"}
              </button>
            </div>
          </div>
        </form>

        <aside className="panel task-panel">
          <div className="panel-header">
            <h2 className="panel-title">任务状态</h2>
            <p className="panel-note">前端每 2.2 秒轮询一次状态，成功后会显示 HTML viewer 和 PPT 下载入口。</p>
          </div>

          <div className="task-body">
            {!task ? (
              <div className="empty-state">
                <div>
                  <strong>还没有任务</strong>
                  <p>填写左侧参数后创建第一个 PPT 生成任务。</p>
                </div>
              </div>
            ) : (
              <>
                <div className="task-meta">
                  <div className="meta-row">
                    <span>任务 ID</span>
                    <strong>{task.id}</strong>
                  </div>
                  <div className="meta-row">
                    <span>状态</span>
                    <strong className={`badge ${task.status === "failed" ? "failed" : ""} ${isActive ? "running" : ""}`}>
                      <span className="status-dot" />
                      {statusText[task.status] || task.status}
                    </strong>
                  </div>
                  <div className="meta-row">
                    <span>输出目录</span>
                    <strong>{task.outputDir}</strong>
                  </div>
                </div>

                {task.status === "succeeded" ? (
                  <>
                    <div className="result-actions">
                      <a className="secondary-button" href={task.viewerUrl} target="_blank" rel="noreferrer">
                        打开 HTML viewer
                      </a>
                      <a className="primary-button" href={task.downloadUrl}>
                        下载 PPT
                      </a>
                    </div>
                    <iframe className="viewer-frame" src={previewSrc} title="PPT HTML viewer" />
                  </>
                ) : null}

                {task.status === "failed" ? (
                  <>
                    <div className="error-box">{task.error || "任务失败，请查看日志。"}</div>
                    <div className="result-actions">
                      <button className="secondary-button" type="button" onClick={retryTask}>
                        重试这个任务
                      </button>
                    </div>
                  </>
                ) : null}

                {logs ? <pre className="logs">{logs}</pre> : null}
              </>
            )}

            {error ? <div className="error-box">{error}</div> : null}
          </div>
        </aside>
      </section>
    </main>
  );
}
