import crypto from "node:crypto";

const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";
const MAX_BLOCKS_PER_REQUEST = 45;
const MAX_TEXT_LENGTH = 1800;

let cachedTenantToken = null;
let cachedTokenExpiresAt = 0;

export async function createFeishuPage(capture, config) {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required.");
  }

  const token = await getTenantAccessToken(config);
  const document = config.feishuWikiSpaceId
    ? await createWikiDocNode(capture, token, config)
    : await createCloudDoc(capture, token, config);

  await appendBlocks(document.documentId, capture.markdown, token);

  return {
    id: document.documentId,
    nodeToken: document.nodeToken || "",
    url: document.url || buildFeishuOpenUrl(document, config),
    title: capture.title
  };
}

export function isFeishuConfigured(config) {
  return Boolean(
    config.feishuAppId &&
    config.feishuAppSecret &&
    (config.feishuWikiSpaceId || config.feishuFolderToken)
  );
}

export async function listFeishuSpaces(config) {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required.");
  }

  const token = await getTenantAccessToken(config);
  const spaces = [];
  let pageToken = "";

  do {
    const query = new URLSearchParams({ page_size: "50" });
    if (pageToken) query.set("page_token", pageToken);

    const payload = await feishuFetch(`/wiki/v2/spaces?${query.toString()}`, {
      method: "GET",
      token
    });

    spaces.push(...(payload.data?.items || payload.data?.spaces || []));
    pageToken = payload.data?.page_token || payload.data?.next_page_token || "";
    if (!payload.data?.has_more) break;
  } while (pageToken);

  return spaces;
}

export async function listFeishuWikiNodes(config, options = {}) {
  if (!config.feishuAppId || !config.feishuAppSecret || !config.feishuWikiSpaceId) {
    throw new Error("FEISHU_APP_ID, FEISHU_APP_SECRET, and FEISHU_WIKI_SPACE_ID are required.");
  }

  const token = await getTenantAccessToken(config);
  const nodes = [];
  await collectWikiNodes(config.feishuWikiSpaceId, token, options.parentNodeToken || "", nodes);
  return nodes;
}

export async function getFeishuDocRawContent(documentId, config) {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required.");
  }

  const token = await getTenantAccessToken(config);
  const payload = await feishuFetch(`/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`, {
    method: "GET",
    token
  });

  return payload.data?.content || "";
}

export async function sendFeishuTextMessage(text, config) {
  if (config.feishuWebhookUrl) {
    const body = {
      msg_type: "text",
      content: { text }
    };

    if (config.feishuWebhookSecret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      body.timestamp = timestamp;
      body.sign = createWebhookSign(timestamp, config.feishuWebhookSecret);
    }

    const response = await fetch(config.feishuWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      throw new Error(`Feishu webhook failed: ${JSON.stringify(payload).slice(0, 600)}`);
    }
    return payload;
  }

  if (!config.feishuChatId) {
    throw new Error("Set FEISHU_WEBHOOK_URL or FEISHU_CHAT_ID before sending to a Feishu group.");
  }

  const token = await getTenantAccessToken(config);
  return feishuFetch("/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    token,
    body: JSON.stringify({
      receive_id: config.feishuChatId,
      msg_type: "text",
      content: JSON.stringify({ text })
    })
  });
}

function createWebhookSign(timestamp, secret) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto
    .createHmac("sha256", Buffer.from(stringToSign, "utf8"))
    .update(Buffer.alloc(0))
    .digest("base64");
}

async function collectWikiNodes(spaceId, token, parentNodeToken, nodes) {
  let pageToken = "";

  do {
    const query = new URLSearchParams({ page_size: "50" });
    if (pageToken) query.set("page_token", pageToken);
    if (parentNodeToken) query.set("parent_node_token", parentNodeToken);

    const payload = await feishuFetch(`/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes?${query.toString()}`, {
      method: "GET",
      token
    });

    const items = payload.data?.items || [];
    nodes.push(...items);

    for (const item of items) {
      if (item.has_child && item.node_token) {
        await collectWikiNodes(spaceId, token, item.node_token, nodes);
      }
    }

    pageToken = payload.data?.page_token || payload.data?.next_page_token || "";
    if (!payload.data?.has_more) break;
  } while (pageToken);
}

async function getTenantAccessToken(config) {
  const now = Date.now();
  if (cachedTenantToken && now < cachedTokenExpiresAt) {
    return cachedTenantToken;
  }

  const payload = await feishuFetch("/auth/v3/tenant_access_token/internal", {
    method: "POST",
    body: JSON.stringify({
      app_id: config.feishuAppId,
      app_secret: config.feishuAppSecret
    })
  });

  const token = payload.tenant_access_token;
  if (!token) {
    throw new Error("Feishu did not return tenant_access_token.");
  }

  cachedTenantToken = token;
  cachedTokenExpiresAt = now + Math.max(Number(payload.expire || 3600) - 120, 60) * 1000;
  return token;
}

async function createWikiDocNode(capture, token, config) {
  const body = {
    obj_type: "docx",
    node_type: "origin",
    title: trimTitle(capture.title)
  };

  if (config.feishuWikiParentNodeToken) {
    body.parent_node_token = config.feishuWikiParentNodeToken;
  }

  const payload = await feishuFetch(`/wiki/v2/spaces/${encodeURIComponent(config.feishuWikiSpaceId)}/nodes`, {
    method: "POST",
    token,
    body: JSON.stringify(body)
  });

  const node = payload.data?.node || payload.data || {};
  const documentId = node.obj_token || node.origin_node_token || node.node_token;
  if (!documentId) {
    throw new Error("Feishu wiki node was created, but no document token was returned.");
  }

  return {
    documentId,
    nodeToken: node.node_token || "",
    url: node.url || ""
  };
}

async function createCloudDoc(capture, token, config) {
  const body = {
    title: trimTitle(capture.title)
  };

  if (config.feishuFolderToken) {
    body.folder_token = config.feishuFolderToken;
  }

  const payload = await feishuFetch("/docx/v1/documents", {
    method: "POST",
    token,
    body: JSON.stringify(body)
  });

  const document = payload.data?.document || {};
  if (!document.document_id) {
    throw new Error("Feishu document was created, but no document_id was returned.");
  }

  return {
    documentId: document.document_id,
    url: document.url || ""
  };
}

async function appendBlocks(documentId, markdown, token) {
  const blocks = markdownToFeishuBlocks(markdown);

  for (let index = 0; index < blocks.length; index += MAX_BLOCKS_PER_REQUEST) {
    const chunk = blocks.slice(index, index + MAX_BLOCKS_PER_REQUEST);
    await feishuFetch(
      `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children?document_revision_id=-1`,
      {
        method: "POST",
        token,
        body: JSON.stringify({
          index: -1,
          children: chunk
        })
      }
    );
  }
}

function markdownToFeishuBlocks(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let inCode = false;
  let codeLines = [];

  const flushParagraph = () => {
    const text = paragraph.join("\n").trim();
    paragraph = [];
    if (!text) return;
    addTextBlock(blocks, 2, "text", text);
  };

  const flushCode = () => {
    const text = codeLines.join("\n").trimEnd() || " ";
    codeLines = [];
    addTextBlock(blocks, 14, "code", text);
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const blockType = heading[1].length + 2;
      const key = `heading${heading[1].length}`;
      addTextBlock(blocks, blockType, key, heading[2].trim());
      continue;
    }

    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushParagraph();
      addTextBlock(blocks, 15, "quote", quote[1].trim());
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      addTextBlock(blocks, 12, "bullet", bullet[1].trim());
      continue;
    }

    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      addTextBlock(blocks, 13, "ordered", numbered[1].trim());
      continue;
    }

    paragraph.push(line);
  }

  if (inCode) flushCode();
  flushParagraph();

  return blocks.length ? blocks : [textBlock(2, "text", "无正文内容。")];
}

function addTextBlock(blocks, blockType, key, text) {
  for (const chunk of chunkText(text, MAX_TEXT_LENGTH)) {
    blocks.push(textBlock(blockType, key, chunk));
  }
}

function textBlock(blockType, key, content) {
  return {
    block_type: blockType,
    [key]: {
      elements: [
        {
          text_run: {
            content: String(content || " ")
          }
        }
      ]
    }
  };
}

async function feishuFetch(path, options = {}) {
  const response = await fetch(`${FEISHU_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    },
    body: options.body
  });

  const raw = await response.text();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { raw };
    }
  }

  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    if (payload.code === 131006) {
      throw new Error("飞书知识库权限不足：当前应用/租户对该知识库没有编辑权限。请在飞书知识库成员或权限设置中给应用所在群、应用机器人或租户授予可编辑权限，并确认应用已发布且云文档/知识库写入权限已开通。");
    }
    throw new Error(`Feishu API ${response.status}: ${JSON.stringify(payload).slice(0, 800)}`);
  }

  return payload;
}

function chunkText(text, size) {
  const value = String(text || "");
  const chunks = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks.length ? chunks : [" "];
}

function trimTitle(title) {
  return String(title || "GPT 内容采集").trim().slice(0, 100) || "GPT 内容采集";
}

function buildFeishuOpenUrl(document = {}, config = {}) {
  const siteUrl = normalizeFeishuSiteUrl(config.feishuSiteUrl);
  if (!siteUrl) return "";
  if (document.nodeToken) return `${siteUrl}/wiki/${encodeURIComponent(document.nodeToken)}`;
  if (document.documentId) return `${siteUrl}/docx/${encodeURIComponent(document.documentId)}`;
  return "";
}

function normalizeFeishuSiteUrl(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replace(/\/+$/, "");
}
