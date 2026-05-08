# 积木科技内部 AI CRM

一个面向积木科技市场、销售、产品、售前团队的内部 AI CRM V1.0。系统重点是沉淀客户信息、跟进记录、售前方案生成、失败复盘、Skill 配置和历史生成记录。

## 当前功能

- 员工管理：员工通过账号密码登录，管理员可维护员工编号、部门、岗位、角色和状态。
- 客户管理：客户列表、销售人员、筛选、搜索、新增、编辑、阶段流转；客户信息默认对所有内部成员可见。
- 客户详情：基础信息、需求信息、跟进记录、AI 分析、客户资料。
- AI 生成：跟进策略、需求分析、方案大纲、失败分析、跟进总结、AI 对话、模型连通性测试。
- 联网 Skill：内置联网搜索、网页抓取、客户公开资料调研、行业趋势调研、竞品分析、政策招投标与价格核验；AI 会按问题和 Skill 自动判断是否执行。
- 失败复盘：标记客户失败并生成失败分析报告。
- 系统设置：客户阶段、Skill、阶段提示词、模型、知识库、员工配置。
- 历史沉淀：所有 AI 输出自动写入生成历史。
- 本地降级：没有 `OPENAI_API_KEY` 时使用本地规则生成，方便先跑通流程。

## 角色权限

- 内部用户：使用客户管理、跟进记录、AI 生成、AI 对话、失败分析等核心功能。
- 管理员：在内部用户基础上，额外管理员工、阶段、Skill、提示词、模型和知识库配置。

前端会隐藏内部用户无权访问的系统设置入口；后端也会通过登录 token 限制配置类接口，避免只靠页面隐藏权限。管理员不能删除当前登录账号，也不能删除或禁用最后一个可用管理员。

## 技术架构

- 前端：`public/index.html` + `public/app.js` + `public/styles.css`，无构建步骤。
- 后端：Node.js 原生 HTTP 服务，入口是 `src/server.js`。
- API：`src/api-routes.js` 统一处理 `/api/*`。
- 数据：`src/crm-store.js` 读写 `data/crm-db.json`。
- AI：`src/ai-service.js` 提供本地规则生成和 OpenAI-compatible 预留接入。
- 联网工具：`src/web-research.js` 提供搜索、公开网页抓取、URL 安全过滤和联网上下文注入。

## 快速启动

```bash
node src/server.js
```

打开：

```text
http://localhost:8787
```

演示账号：

```text
管理员：mango@gymoo.cn / admin123
内部用户：user@jimu.local / user123
```

## 环境变量

复制 `.env.example` 为 `.env` 后按需配置。AI CRM 不配置 Key 也能运行。

```bash
cp .env.example .env
```

如果要接 OpenAI 官方或 OpenAI-compatible 中转平台：

```text
OPENAI_API_KEY=你的 API Key
OPENAI_MODEL=gpt-5.5
# 如当前网络需要代理访问远程模型，可配置本地 HTTP 代理。
OPENAI_PROXY_URL=http://127.0.0.1:7897
```

系统设置的「模型」里可以配置 OpenAI-compatible Base URL、Provider、API Key 和 Model ID。当前默认中转配置为 `cliproxyapi`，Base URL 为 `https://www.tokenrouter.tech/v1`，wire API 使用 Responses。

联网搜索/爬虫 Skill 默认启用，AI 会在问题出现“最新、官网、竞品、行业趋势、政策、招投标、价格、公开资料、URL”等意图，或选择对应联网 Skill 时自动执行。默认不需要额外 Key；如需更稳定的商业搜索源，可配置：

```text
WEB_RESEARCH_ENABLED=true
WEB_SEARCH_PROVIDER=jina
WEB_SEARCH_API_KEY=
WEB_CRAWLER_PROVIDER=direct
WEB_RESEARCH_TIMEOUT_MS=9000
WEB_RESEARCH_MAX_RESULTS=4
WEB_RESEARCH_MAX_CRAWL_URLS=3
```

## 测试

当前环境如果没有 `npm`，可以直接运行：

```bash
node scripts/smoke-test.mjs
```

这个测试会检查旧的知识整理能力，以及 CRM 登录、初始化数据和 AI 跟进策略生成。

上线前建议再跑一遍更完整的真实场景检查：

```bash
node scripts/crm-production-check.mjs
```

它会覆盖管理员、员工、权限拦截、客户可见性、销售人员归属、跟进记录、客户资料、全部 AI 生成功能、失败复盘、模型测试和删除级联。脚本会自动恢复测试前数据。

## 数据说明

CRM 数据默认写入：

```text
data/crm-db.json
```

第一期用 JSON 文件作为轻量本地存储，便于内部验证。后续可以把这些 collections 迁移到 MySQL/PostgreSQL，字段已经按需求文档中的表结构映射。

部署说明见 [DEPLOY.md](./DEPLOY.md)。
