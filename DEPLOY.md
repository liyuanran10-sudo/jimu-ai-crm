# 部署说明

这个项目包含 H5 页面和 API。部署到 Netlify 时，H5 会发布 `public/`，API 会通过 Netlify Functions 承接。

## Netlify 部署

仓库里已经包含 `netlify.toml` 和 `netlify/functions/api.mjs`。

### 1. 登录 Netlify CLI

如果本机有 npm/npx，可以运行：

```bash
npx netlify login
```

也可以使用 Token：

```bash
export NETLIFY_AUTH_TOKEN=你的 Netlify Personal Access Token
```

Token 创建地址：

```text
https://app.netlify.com/user/applications#personal-access-tokens
```

### 2. 部署

预览部署：

```bash
npx netlify deploy
```

生产部署：

```bash
npx netlify deploy --prod
```

Netlify 会读取：

```text
publish = public
functions = netlify/functions
```

### 3. 配置环境变量

在 Netlify Dashboard 的 Site settings -> Environment variables 中配置：

```text
SYNC_TARGET=feishu
OPENAI_MODEL=gpt-4.1-mini
FEISHU_APP_ID=你的飞书应用 App ID
FEISHU_APP_SECRET=你的飞书应用 App Secret
FEISHU_WIKI_SPACE_ID=你的飞书知识库 Space ID
FEISHU_WEBHOOK_URL=飞书群机器人 Webhook，可选
FEISHU_WEBHOOK_SECRET=飞书群机器人签名密钥，可选
OPENAI_API_KEY=OpenAI Key，可选
```

`.env` 不会被上传。

为了让本地测试环境和 Netlify 正式环境共用同一套业务配置，推荐以项目根目录 `.env` 为唯一配置源，然后生成 Netlify 可导入文件：

```bash
node scripts/prepare-netlify-env.mjs
npx netlify env:import /tmp/jimu-crm-netlify.env
```

脚本会自动跳过本地专属配置：

```text
PORT
OPENAI_PROXY_URL
PPT_SKILL_BASE_URL=http://localhost:3100
```

说明：

```text
OpenAI、image2、飞书、CRM 登录密钥等业务配置会同步到正式环境。
本地代理和 localhost 服务不会同步到正式环境，避免线上错误连接本机地址。
PPT Skill 需要单独部署后，再把 `PPT_SKILL_BASE_URL` 配成正式 URL。
```

### 4. 验证

部署完成后访问：

```text
https://你的 Netlify 域名/api/health
https://你的 Netlify 域名/summaries.html
```

### 5. 数据持久化

线上每日汇总历史会优先写入 Netlify Blobs。本地开发仍然写入 `data/daily-summaries.json`。

---

## Render 部署

仓库里已经包含 `render.yaml`，可以用 Render Blueprint 一次部署 CRM + PPT 服务。

### 1. 推送到 Git 仓库

Render 需要从 GitHub、GitLab 或 Bitbucket 拉取代码。把当前项目推送到一个远程仓库后，再继续部署。

### 2. 创建 Blueprint

打开 Render Blueprint 创建页，并选择你的仓库：

```text
https://dashboard.render.com/blueprint/new
```

Render 会读取仓库根目录的 `render.yaml`。其中第二个服务是独立的 `ppt-skill-web`，用于生成轻量级方案 PPT。

### 3. 配置环境变量

部署时需要在 Render Dashboard 里填写这些变量：

```text
SYNC_TARGET=feishu
OPENAI_MODEL=gpt-4.1-mini
FEISHU_APP_ID=你的飞书应用 App ID
FEISHU_APP_SECRET=你的飞书应用 App Secret
FEISHU_WIKI_SPACE_ID=你的飞书知识库 Space ID
FEISHU_WEBHOOK_URL=飞书群机器人 Webhook，可选
FEISHU_WEBHOOK_SECRET=飞书群机器人签名密钥，可选
OPENAI_API_KEY=OpenAI Key，可选
```

`PORT` 不需要手动配置，Render 会自动注入。

PPT 服务还需要单独填写：

```text
IMAGE2_API_KEY=你的 image2 key
IMAGE2_BASE_URL=https://www.tokenrouter.tech/v1
PPT_PUBLIC_BASE_URL=你的 PPT 服务正式地址
```

### 4. 验证

部署完成后访问：

```text
https://你的服务域名/api/health
https://你的服务域名/summaries.html
```

## Render 数据持久化说明

当前每日汇总历史默认保存到本地文件 `data/daily-summaries.json`。云端免费 Web Service 的本地文件系统通常不适合作为长期数据库；如果你希望云端长期保存多天历史，建议下一步接入数据库或对象存储。

---

## PPT Skill 单独部署说明

`ppt-skill-web` 已经内置了 `gpt-image2-ppt-skills`，正式环境不再依赖你本机的 `.codex/skills` 目录。

### 1. 这个服务做什么

- 接收轻量级方案 PPT 结构稿
- 调用 image2 逐页生成图片式 PPT
- 返回 HTML 预览和 PPTX 下载链接

### 2. 为什么要单独部署

- 生成 PPT 属于长任务
- 需要 Python + image2 + 持久化输出目录
- 不适合放在 Netlify Function 里硬跑

### 3. 部署后的对接方式

把 CRM 的 `PPT_SKILL_BASE_URL` 指向 PPT 服务正式地址即可，CRM 里的“生成PPT”按钮会直接走这个服务。
