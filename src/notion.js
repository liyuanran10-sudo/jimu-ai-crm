import { markdownToNotionBlocks } from "./markdown-to-notion.js";

export async function createNotionPage(capture, config) {
  if (!config.notionApiKey) {
    throw new Error("NOTION_API_KEY is not configured.");
  }

  if (config.notionDatabaseId) {
    return createDatabasePage(capture, config);
  }

  if (config.notionParentPageId) {
    return createChildPage(capture, config);
  }

  throw new Error("Configure NOTION_DATABASE_ID or NOTION_PARENT_PAGE_ID.");
}

async function createDatabasePage(capture, config) {
  const database = await notionFetch(`/v1/databases/${config.notionDatabaseId}`, {
    method: "GET"
  }, config);
  const properties = buildDatabaseProperties(database.properties || {}, capture);

  return notionFetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: config.notionDatabaseId },
      properties,
      children: markdownToNotionBlocks(capture.markdown)
    })
  }, config);
}

async function createChildPage(capture, config) {
  return notionFetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { page_id: config.notionParentPageId },
      properties: {
        title: {
          title: [{ type: "text", text: { content: trimTitle(capture.title) } }]
        }
      },
      children: markdownToNotionBlocks(capture.markdown)
    })
  }, config);
}

function buildDatabaseProperties(schema, capture) {
  const properties = {};
  const titleProp = findByType(schema, "title");
  if (!titleProp) {
    throw new Error("The target Notion database must include a title property.");
  }

  properties[titleProp.name] = {
    title: [{ type: "text", text: { content: trimTitle(capture.title) } }]
  };

  const summaryProp = findByNamesAndType(schema, ["Summary", "摘要", "简介"], "rich_text");
  if (summaryProp) {
    properties[summaryProp.name] = {
      rich_text: [{ type: "text", text: { content: String(capture.summary || "").slice(0, 1800) } }]
    };
  }

  const typeProp = findByNamesAndType(schema, ["Type", "类型", "内容类型", "Content Type"], "select");
  if (typeProp && capture.contentType) {
    properties[typeProp.name] = {
      select: { name: capture.contentType }
    };
  }

  const tagProp = findByNamesAndType(schema, ["Tags", "标签", "Tag"], "multi_select");
  if (tagProp && Array.isArray(capture.tags)) {
    properties[tagProp.name] = {
      multi_select: capture.tags.slice(0, 8).map((name) => ({ name }))
    };
  }

  const urlProp = findByNamesAndType(schema, ["Source URL", "来源链接", "URL", "Link", "链接"], "url");
  if (urlProp && capture.source?.url) {
    properties[urlProp.name] = { url: capture.source.url };
  }

  const sourceProp = findByNamesAndType(schema, ["Source", "来源", "来源标题"], "rich_text");
  if (sourceProp && capture.source?.title) {
    properties[sourceProp.name] = {
      rich_text: [{ type: "text", text: { content: capture.source.title.slice(0, 1800) } }]
    };
  }

  const dateProp = findByNamesAndType(schema, ["Captured At", "采集时间", "Date", "日期"], "date");
  if (dateProp) {
    properties[dateProp.name] = {
      date: { start: capture.source?.capturedAt || new Date().toISOString() }
    };
  }

  return properties;
}

async function notionFetch(path, options, config) {
  const response = await fetch(`https://api.notion.com${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${config.notionApiKey}`,
      "Notion-Version": config.notionVersion,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Notion API ${response.status}: ${errorText.slice(0, 600)}`);
  }

  return response.json();
}

function findByType(schema, type) {
  return Object.entries(schema)
    .map(([name, value]) => ({ name, ...value }))
    .find((property) => property.type === type);
}

function findByNamesAndType(schema, names, type) {
  const normalizedNames = names.map(normalizeName);
  return Object.entries(schema)
    .map(([name, value]) => ({ name, ...value }))
    .find((property) => {
      return property.type === type && normalizedNames.includes(normalizeName(property.name));
    });
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function trimTitle(title) {
  return String(title || "GPT 内容采集").trim().slice(0, 100) || "GPT 内容采集";
}
