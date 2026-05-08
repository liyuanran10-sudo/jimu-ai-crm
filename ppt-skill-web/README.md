# Codex PPT Skill Runner

一个独立于 AICRM 的本地 Next.js 小应用，用来可视化调用本机 Codex Skill：`gpt-image2-ppt-skills`。

它提供一个表单收集 PPT 主题、客户名称、项目背景、核心内容、页数、风格和 PPT 模板文件。提交后后端会创建任务目录 `outputs/{task_id}/`，通过 `codex exec` 调用 Skill 生成 PPT，并提供任务轮询、HTML viewer 预览和 PPT 下载。

## 目录结构

```text
ppt-skill-web/
  app/
    api/tasks/              # 创建任务、查询状态、下载 PPT
    viewer/                 # 安全读取 outputs/{task_id}/ 下的 HTML/图片/PPT
    page.jsx                # 本地可视化表单
  lib/
    codex-runner.js         # Codex CLI 调用与任务执行
    task-store.js           # 任务 JSON 持久化与结果扫描
    paths.js                # 输出目录与路径校验
  outputs/                  # 生成结果目录
```

## 环境要求

- Node.js >= 20
- npm / pnpm / yarn 任一包管理器
- 已登录并可运行的 Codex CLI
- 由 AICRM 父项目 `.env` 提供的 `OPENAI_API_KEY` / `IMAGE2_API_KEY`
- 本机已安装 `gpt-image2-ppt-skills`

如果你的终端里找不到 `codex`，可以先确认 Codex App 自带 CLI 路径：

```bash
/Applications/Codex.app/Contents/Resources/codex --version
```

## 安装依赖

```bash
cd "ppt-skill-web"
npm install
```

如果系统没有 `npm`，可以先安装 Node.js LTS，或用已有的 pnpm/yarn：

```bash
pnpm install
yarn install
```

当前这台机器上可用的 Node/npm 不在默认 `PATH` 里。如果直接提示 `npm: command not found`，先执行：

```bash
export PATH="/Users/mangolee/.local/node-v24.14.1-darwin-arm64/bin:$PATH"
npm install
```

## 配置 Key

复制示例环境文件：

```bash
cp .env.example .env.local
```

编辑 `.env.local` 时只保留运行参数；`OPENAI_*` 与 `IMAGE2_*` 统一从 AICRM 父项目 `.env` 读取：

```bash
CODEX_BIN=codex
CODEX_SKILL_NAME=gpt-image2-ppt
CODEX_SANDBOX=danger-full-access
GPT_IMAGE_BACKEND=openai
GPT_IMAGE_CONCURRENCY=1
GPT_IMAGE_ENDPOINT=images
GPT_IMAGE_MODEL_NAME=gpt-image-2
GPT_IMAGE_SIZE=1792x1024
CODEX_TIMEOUT_SECS=300
# CODEX_TASK_TIMEOUT_SECS=900
CODEX_CMD="codex exec --full-auto --skip-git-repo-check"
```

当前本地验证推荐使用 `GPT_IMAGE_BACKEND=openai`，这样 `gpt-image2-ppt-skills` 会直接调用图片接口，速度和稳定性都比嵌套 `codex` 后端更好。任务执行器会优先读取 AICRM 父项目 `.env` 里的 `IMAGE2_API_KEY`、`IMAGE2_BASE_URL`、`IMAGE2_MODEL` 和 `IMAGE2_SIZE`，并把它们映射给 skill 需要的环境变量，避免手动复制一份 key。

如果你确实想复用 Codex 登录态而不配置图片接口 Key，也可以切回 `GPT_IMAGE_BACKEND=codex`。注意：`codex` 后端会在生成图片时再启动一个内层 `codex exec`，它需要读取本机 `~/.codex/sessions`。因此本地验证默认使用 `CODEX_SANDBOX=danger-full-access`；如果改回 `workspace-write`，可能会看到 `Codex cannot access session files` 的错误。

为了避免任务长时间卡在“生成中”，本地默认把 `GPT_IMAGE_CONCURRENCY` 设为 `1`，并给单页内层 Codex 出图设置 `CODEX_TIMEOUT_SECS=300`。如果你确认环境稳定，可以适当调大。

如果 `codex` 不在 PATH 里，改成绝对路径：

```bash
CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex
```

如果希望固定模型，也可以设置：

```bash
CODEX_MODEL=gpt-5.5
```

## 安装 Skill

如果还没有安装 `gpt-image2-ppt-skills`，可以把 Skill 仓库放到本机 Codex skills 目录。这个仓库目录名通常是 `gpt-image2-ppt-skills`，但 `SKILL.md` 里的技能名是 `gpt-image2-ppt`，所以 `.env.local` 里建议使用 `CODEX_SKILL_NAME=gpt-image2-ppt`：

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/JuneYaooo/gpt-image2-ppt-skills.git ~/.codex/skills/gpt-image2-ppt-skills
test -f ~/.codex/skills/gpt-image2-ppt-skills/SKILL.md
```

确认安装后，可用一次非交互命令做冒烟测试：

```bash
codex exec --sandbox workspace-write --skip-git-repo-check "请使用 gpt-image2-ppt，说明你能否读取该 Skill。"
```

## 启动项目

```bash
npm run dev
```

默认地址：

```text
http://localhost:3100
```

如果浏览器打不开，优先确认你访问的是 `http://localhost:3100`，不是 Next.js 默认的 `3000` 端口。也可以用下面命令检查服务是否已监听：

```bash
lsof -iTCP:3100 -sTCP:LISTEN -n -P
curl -I http://localhost:3100
```

如果从 Codex Desktop 的内置 shell 启动时遇到 Next.js SWC 加载失败，使用同一个本机 Node 路径启动：

```bash
export PATH="/Users/mangolee/.local/node-v24.14.1-darwin-arm64/bin:$PATH"
npm run dev
```

## 测试生成

1. 打开 `http://localhost:3100`
2. 输入 PPT 主题，例如：`华东制造 AI 质检项目售前方案`
3. 输入客户名称、项目背景、核心内容
4. 设置页数和风格
5. 如需模板，勾选“使用上传 PPT 模板”并上传 `.pptx`
6. 点击“创建生成任务”
7. 右侧状态会显示 `排队中`、`生成中`、`已完成` 或 `失败`
8. 成功后点击 HTML viewer 预览，或点击下载 PPT

生成文件会保存到：

```text
ppt-skill-web/outputs/{task_id}/
```

每个任务目录通常包含：

```text
task.json
codex.log
codex-prompt.md
codex-final-message.md
manifest.json
*.pptx
index.html
```

## 后续接入 AICRM

当前实现刻意保持边界简单：`app/api/tasks` 只接收表单字段并创建任务，`lib/codex-runner.js` 负责把任务转换成 Codex Prompt。后续接入 AICRM 时，可以把客户档案、跟进记录、Skill 配置或知识库命中内容先组装成同样的 input，再复用任务执行层。

建议接入点：

- 把 AICRM 客户 ID、客户阶段、历史跟进记录追加到任务 input
- 把生成结果路径写回 AICRM 的客户资料或历史生成记录
- 把任务状态持久化到数据库，替代当前 `outputs/{task_id}/task.json`
- 加入队列系统，避免多个 PPT 任务同时占满本机资源
