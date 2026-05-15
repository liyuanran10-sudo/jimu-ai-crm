const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_MAX_RESULTS = 4;
const DEFAULT_MAX_CRAWL_URLS = 3;

const RESEARCH_KEYWORDS = [
  "联网", "搜索", "搜一下", "查一下", "查找", "查询", "爬取", "抓取", "网页", "链接", "url",
  "官网", "新闻", "最新", "近期", "今天", "现在", "实时", "政策", "法规", "招投标", "招标",
  "竞品", "竞争对手", "替代方案", "行业趋势", "市场规模", "融资", "价格", "报价", "案例",
  "公开资料", "背景调查", "公司信息", "有哪些公司", "公司有哪些", "服务商", "供应商", "公司名单", "排名"
];

const WEB_TOOL_TYPES = new Set([
  "web_search",
  "web_crawl",
  "company_research",
  "industry_research",
  "competitive_research",
  "policy_research"
]);

export async function buildWebResearchContext({ db, customer, skill, generationType, message, extraContext, config }) {
  const plan = buildResearchPlan({ db, customer, skill, generationType, message, extraContext, config });
  if (!plan.shouldRun) {
    return {
      enabled: Boolean(config.webResearchEnabled),
      used: false,
      reason: plan.reason,
      toolType: plan.toolType,
      searchedAt: nowIso(),
      queries: [],
      urls: [],
      results: [],
      pages: [],
      errors: []
    };
  }

  const timeoutMs = Number(config.webResearchTimeoutMs || DEFAULT_TIMEOUT_MS);
  const errors = [];
  const results = [];
  const pages = [];

  for (const query of plan.queries) {
    try {
      const found = await searchWeb(query, {
        config,
        timeoutMs,
        maxResults: Number(config.webResearchMaxResults || DEFAULT_MAX_RESULTS)
      });
      results.push(...found);
    } catch (error) {
      errors.push(`搜索「${query}」失败：${cleanError(error.message)}`);
    }
  }

  const crawlUrls = unique([
    ...plan.urls,
    ...results.slice(0, Number(config.webResearchMaxCrawlUrls || DEFAULT_MAX_CRAWL_URLS)).map((item) => item.url)
  ]).filter(isSafePublicUrl).slice(0, Number(config.webResearchMaxCrawlUrls || DEFAULT_MAX_CRAWL_URLS));

  for (const url of crawlUrls) {
    try {
      const page = await crawlPage(url, { config, timeoutMs });
      if (page?.text) pages.push(page);
    } catch (error) {
      errors.push(`抓取「${url}」失败：${cleanError(error.message)}`);
    }
  }

  return {
    enabled: true,
    used: true,
    reason: plan.reason,
    toolType: plan.toolType,
    searchedAt: nowIso(),
    queries: plan.queries,
    urls: crawlUrls,
    results: dedupeResults(results).slice(0, Number(config.webResearchMaxResults || DEFAULT_MAX_RESULTS) * 2),
    pages,
    errors
  };
}

export function buildResearchPlan({ db, customer, skill, generationType, message, extraContext, config = {} }) {
  if (config.webResearchEnabled === false) {
    return {
      shouldRun: false,
      reason: "WEB_RESEARCH_ENABLED=false，已关闭联网工具。",
      toolType: "",
      queries: [],
      urls: []
    };
  }
  if (extraContext?.disableWebResearch) {
    return {
      shouldRun: false,
      reason: "当前任务已声明不需要联网，避免客户报告生成被外部请求阻塞。",
      toolType: String(skill?.toolType || "").trim(),
      queries: [],
      urls: []
    };
  }

  const toolType = String(skill?.toolType || "").trim();
  const text = collectDecisionText({ customer, skill, generationType, message, extraContext });
  const explicitText = [
    message,
    extraContext?.toolMode,
    extraContext?.webResearch,
    extraContext?.needsWebResearch,
    extraContext?.userIntent
  ].filter(Boolean).join("\n");
  const urls = extractUrls(text);
  const explicitNeed = RESEARCH_KEYWORDS.some((keyword) => explicitText.toLowerCase().includes(keyword.toLowerCase()));
  const toolSkillNeed = WEB_TOOL_TYPES.has(toolType);

  if (!explicitNeed && !toolSkillNeed && !urls.length) {
    return {
      shouldRun: false,
      reason: "未检测到联网意图，避免不必要的外部请求。",
      toolType,
      queries: [],
      urls: []
    };
  }

  const queries = buildQueries({ db, customer, skill, generationType, message, extraContext, toolType, text });

  return {
    shouldRun: Boolean(queries.length || urls.length),
    reason: toolSkillNeed
      ? `当前 Skill 标记为 ${toolType}，自动执行联网资料检索。`
      : "检测到最新信息、公开资料、链接、竞品、政策或行业调研意图，自动执行联网资料检索。",
    toolType,
    queries,
    urls
  };
}

async function searchWeb(query, { config, timeoutMs, maxResults }) {
  const provider = String(config.webSearchProvider || "jina").toLowerCase();
  if (provider === "tavily" && config.webSearchApiKey) {
    return searchWithTavily(query, { apiKey: config.webSearchApiKey, timeoutMs, maxResults });
  }

  const jinaResults = await searchWithJina(query, { timeoutMs, maxResults });
  if (jinaResults.length) return jinaResults;
  return searchWithDuckDuckGo(query, { timeoutMs, maxResults });
}

async function searchWithTavily(query, { apiKey, timeoutMs, maxResults }) {
  const response = await fetchWithTimeout("https://api.tavily.com/search", {
    timeoutMs,
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: "basic",
      include_answer: false
    })
  });
  const payload = await response.json();
  return (payload.results || []).map((item) => ({
    title: cleanText(item.title),
    url: item.url,
    snippet: cleanText(item.content),
    source: "tavily"
  })).filter((item) => item.url);
}

async function searchWithJina(query, { timeoutMs, maxResults }) {
  const url = `https://s.jina.ai/${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url, {
    timeoutMs,
    headers: {
      "Accept": "text/plain"
    }
  });
  const text = await response.text();
  return parseSearchMarkdown(text, "jina").slice(0, maxResults);
}

async function searchWithDuckDuckGo(query, { timeoutMs, maxResults }) {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url, {
    timeoutMs,
    headers: {
      "User-Agent": "JimuAI-CRM/1.0 (+internal research assistant)"
    }
  });
  const html = await response.text();
  return parseDuckDuckGoLite(html).slice(0, maxResults);
}

async function crawlPage(url, { config, timeoutMs }) {
  if (!isSafePublicUrl(url)) {
    throw new Error("URL 不允许抓取，仅支持公开 http/https 地址。");
  }

  const provider = String(config.webCrawlerProvider || "direct").toLowerCase();
  const readers = provider === "jina"
    ? [() => crawlWithJina(url, timeoutMs), () => crawlDirect(url, timeoutMs)]
    : [() => crawlDirect(url, timeoutMs), () => crawlWithJina(url, timeoutMs)];

  let lastError = null;
  for (const read of readers) {
    try {
      const page = await read();
      if (page?.text) return page;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("网页没有可读取文本。");
}

async function crawlWithJina(url, timeoutMs) {
  const readerUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
  const response = await fetchWithTimeout(readerUrl, {
    timeoutMs,
    headers: {
      "Accept": "text/plain"
    }
  });
  const text = cleanText(await response.text()).slice(0, 5000);
  return {
    url,
    title: extractMarkdownTitle(text) || url,
    text,
    source: "jina-reader"
  };
}

async function crawlDirect(url, timeoutMs) {
  const response = await fetchWithTimeout(url, {
    timeoutMs,
    headers: {
      "User-Agent": "JimuAI-CRM/1.0 (+internal research assistant)",
      "Accept": "text/html,text/plain,application/xhtml+xml"
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  const title = extractHtmlTitle(raw) || url;
  const text = contentType.includes("html") ? htmlToText(raw) : cleanText(raw);
  return {
    url,
    title,
    text: text.slice(0, 5000),
    source: "direct-fetch"
  };
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`联网请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildQueries({ db, customer, skill, generationType, message, extraContext, toolType, text }) {
  const queries = [];
  const userMessage = cleanText(message || extraContext?.message || "");
  if (userMessage) queries.push(stripUrls(userMessage));

  if (customer?.name) {
    if (["company_research", "web_crawl"].includes(toolType) || /官网|公开资料|公司|背景|客户/.test(text)) {
      queries.push(`${customer.name} 官网 公司介绍 产品`);
    }
    if (["industry_research", "competitive_research", "web_search"].includes(toolType) || /行业|趋势|竞品|案例|市场/.test(text)) {
      queries.push(`${customer.customerType || customer.name} 行业趋势 竞品 案例`);
    }
    if (["policy_research"].includes(toolType) || /政策|法规|招投标|招标|价格|报价/.test(text)) {
      queries.push(`${customer.name} ${customer.customerType || ""} 政策 招投标 价格`);
    }
  }

  if (!queries.length && skill?.name) {
    queries.push(`${skill.name} ${GENERATION_LABELS[generationType] || generationType || ""}`.trim());
  }

  return unique(queries.map((item) => cleanText(item)).filter(Boolean)).slice(0, 3);
}

const GENERATION_LABELS = {
  follow_strategy: "客户跟进策略",
  demand_analysis: "客户需求分析",
  proposal_outline: "解决方案大纲",
  failure_report: "失败分析报告",
  chat: "AI 售前助手",
  follow_summary: "跟进记录总结",
  consultation_advice: "客户前期咨询回应策略报告",
  next_communication_question_list: "下一步沟通问题清单"
};

function collectDecisionText({ customer, skill, generationType, message, extraContext }) {
  return [
    generationType,
    message,
    skill?.name,
    skill?.description,
    skill?.systemPrompt,
    customer?.name,
    customer?.customerType,
    customer?.demandDescription,
    customer?.background,
    customer?.problemToSolve,
    customer?.internalNotes,
    JSON.stringify(extraContext || {})
  ].filter(Boolean).join("\n");
}

function parseSearchMarkdown(markdown, source) {
  const text = String(markdown || "");
  const results = [];
  const blockPattern = /(?:^|\n)Title:\s*(.+?)\nURL Source:\s*(https?:\/\/\S+)(?:\n(?:Description|Snippet|Content):\s*([\s\S]*?))?(?=\nTitle:|\n\nTitle:|$)/g;
  for (const match of text.matchAll(blockPattern)) {
    results.push({
      title: cleanText(match[1]),
      url: match[2],
      snippet: cleanText(match[3] || ""),
      source
    });
  }

  if (results.length) return results;

  const linkPattern = /\[([^\]]+)]\((https?:\/\/[^)]+)\)(?:\s*[-–]\s*([^\n]+))?/g;
  for (const match of text.matchAll(linkPattern)) {
    results.push({
      title: cleanText(match[1]),
      url: match[2],
      snippet: cleanText(match[3] || ""),
      source
    });
  }
  return results;
}

function parseDuckDuckGoLite(html) {
  const results = [];
  const pattern = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const title = htmlToText(match[2]);
    const url = decodeDuckUrl(htmlDecode(match[1]));
    if (!title || !isSafePublicUrl(url)) continue;
    results.push({
      title,
      url,
      snippet: "",
      source: "duckduckgo-lite"
    });
  }
  return dedupeResults(results);
}

function decodeDuckUrl(url) {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.href;
  } catch {
    return url;
  }
}

function extractUrls(text) {
  return unique(String(text || "").match(/https?:\/\/[^\s"'<>，。；、）)]+/g) || []).filter(isSafePublicUrl).slice(0, 5);
}

function stripUrls(text) {
  return String(text || "").replace(/https?:\/\/\S+/g, " ").trim();
}

function isSafePublicUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.startsWith("169.254.") ||
      host.startsWith("fc00:") ||
      host.startsWith("fe80:")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function htmlToText(html) {
  return cleanText(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function extractHtmlTitle(html) {
  return cleanText(String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function extractMarkdownTitle(text) {
  return cleanText(String(text || "").match(/^#\s+(.+)$/m)?.[1] || "");
}

function cleanText(text = "") {
  return htmlDecode(String(text || ""))
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlDecode(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function cleanError(message) {
  return String(message || "未知错误").replace(/sk-[^\s"'，。；、）)]+/g, "sk-***").slice(0, 180);
}

function nowIso() {
  return new Date().toISOString();
}
