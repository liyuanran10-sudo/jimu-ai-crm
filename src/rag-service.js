import zlib from "node:zlib";

const VECTOR_DIMENSIONS = 256;
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 140;
const MAX_UPLOAD_TEXT = 2_000_000;
const MAX_MATCHES = 6;

const RAG_KEYWORDS = [
  "知识库", "rag", "RAG", "资料库", "历史方案", "历史案例", "案例库", "参考案例", "参考资料",
  "公司能力", "产品能力", "售前话术", "话术库", "合同资料", "商务资料", "行业资料", "文档",
  "上传资料", "内部资料", "方案库", "案例匹配", "根据资料", "引用资料", "查知识库"
];

export function normalizeKnowledgeBaseDocuments(existingDocuments = [], uploadedDocuments = []) {
  const normalized = ensureArray(existingDocuments).map(normalizeStoredDocument).filter(Boolean);
  const additions = ensureArray(uploadedDocuments).map(buildKnowledgeDocumentFromUpload).filter(Boolean);
  return [...additions, ...normalized].slice(0, 80);
}

export function buildRagContext({ db, customer, skill, generationType, message, extraContext }) {
  const plan = buildRagPlan({ db, customer, skill, generationType, message, extraContext });
  const searchedAt = nowIso();
  if (!plan.shouldRun) {
    return {
      enabled: true,
      used: false,
      reason: plan.reason,
      searchedAt,
      query: plan.query,
      knowledgeBaseIds: plan.knowledgeBaseIds,
      matches: [],
      citations: [],
      quality: buildRagQuality({ plan, matches: [], totalChunks: 0 }),
      diagnostics: buildRagDiagnostics({ plan, matches: [], totalChunks: 0 })
    };
  }

  const queryEmbedding = embedText(plan.query);
  const queryLexicalTokens = extractMeaningfulTokens(plan.query);
  const chunks = collectKnowledgeChunks(db, plan.knowledgeBaseIds);
  const matches = chunks
    .map((chunk) => {
      const chunkTokens = extractMeaningfulTokens(chunk.text);
      return {
        ...chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
        lexicalOverlap: countTokenOverlap(queryLexicalTokens, chunkTokens),
        anchorOverlap: countTokenOverlap(plan.anchorTokens || [], chunkTokens),
        requiredAnchorOverlap: countTokenOverlap(plan.requiredAnchorTokens || [], chunkTokens),
        nameOverlap: countTokenOverlap(plan.customerNameTokens || [], chunkTokens)
      };
    })
    .filter((item) => {
      return item.score >= 0.05
        && item.lexicalOverlap >= getMinLexicalOverlap(plan)
        && item.anchorOverlap >= getMinAnchorOverlap(plan)
        && item.requiredAnchorOverlap >= getMinRequiredAnchorOverlap(plan)
        && item.nameOverlap >= getMinNameOverlap(plan);
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHES)
    .map((item) => ({
      knowledgeBaseId: item.knowledgeBaseId,
      knowledgeBaseName: item.knowledgeBaseName,
      documentId: item.documentId,
      documentName: item.documentName,
      chunkId: item.chunkId,
      score: Number(item.score.toFixed(4)),
      lexicalOverlap: item.lexicalOverlap,
      anchorOverlap: item.anchorOverlap,
      requiredAnchorOverlap: item.requiredAnchorOverlap,
      nameOverlap: item.nameOverlap,
      text: item.text
    }));

  const quality = buildRagQuality({ plan, matches, totalChunks: chunks.length });
  return {
    enabled: true,
    used: Boolean(matches.length),
    reason: matches.length ? plan.reason : "检测到知识库意图，但没有检索到足够相关的片段。",
    searchedAt,
    query: plan.query,
    knowledgeBaseIds: plan.knowledgeBaseIds,
    matches,
    citations: buildRagCitations(matches),
    quality,
    diagnostics: buildRagDiagnostics({ plan, matches, totalChunks: chunks.length, quality })
  };
}

function buildRagCitations(matches = []) {
  return ensureArray(matches).map((item, index) => ({
    id: `rag:${item.knowledgeBaseId}:${item.documentId}:${item.chunkId}`,
    index: index + 1,
    label: `${item.knowledgeBaseName || "知识库"} / ${item.documentName || "未命名文档"}`,
    knowledgeBaseId: item.knowledgeBaseId,
    knowledgeBaseName: item.knowledgeBaseName,
    documentId: item.documentId,
    documentName: item.documentName,
    chunkId: item.chunkId,
    score: item.score,
    relevance: Math.round(computeMatchStrength(item) * 100),
    excerpt: String(item.text || "").replace(/\s+/g, " ").slice(0, 220)
  }));
}

function buildRagQuality({ plan = {}, matches = [], totalChunks = 0 } = {}) {
  if (!plan.shouldRun) {
    return {
      level: "skipped",
      score: 0,
      summary: plan.reason || "本轮未执行知识库检索。"
    };
  }
  if (!matches.length) {
    return {
      level: "miss",
      score: 0,
      summary: "已执行知识库检索，但没有达到相关性门槛的片段。"
    };
  }
  const top = matches[0] || {};
  const strength = computeMatchStrength(top);
  const diversity = new Set(matches.map((item) => `${item.knowledgeBaseId}:${item.documentId}`)).size;
  const coverage = Math.min(1, matches.length / 4) * 0.22 + Math.min(1, diversity / 3) * 0.18;
  const score = Math.min(1, strength * 0.6 + coverage);
  const level = score >= 0.72 ? "strong" : score >= 0.46 ? "medium" : "weak";
  return {
    level,
    score: Number(score.toFixed(2)),
    summary: {
      strong: "知识库命中质量较高，可作为回答的重要依据。",
      medium: "知识库有可参考资料，回答中需要保留来源和待确认边界。",
      weak: "知识库命中较弱，只能作为辅助参考，不能当作强事实。"
    }[level],
    topScore: top.score || 0,
    matchCount: matches.length,
    sourceDiversity: diversity,
    totalChunks
  };
}

function buildRagDiagnostics({ plan = {}, matches = [], totalChunks = 0, quality = null } = {}) {
  return {
    queryLength: String(plan.query || "").length,
    searchedKnowledgeBaseCount: ensureArray(plan.knowledgeBaseIds).length,
    totalChunks,
    matchedChunks: matches.length,
    requiredAnchorTokens: ensureArray(plan.requiredAnchorTokens).length,
    anchorTokens: ensureArray(plan.anchorTokens).length,
    qualityLevel: quality?.level || "skipped",
    policy: plan.allowGeneralKnowledge
      ? "允许使用全局知识库作为通用参考。"
      : "要求知识库片段与客户/任务锚点相关，避免无关资料乱入。"
  };
}

function computeMatchStrength(item = {}) {
  const semantic = Math.min(1, Number(item.score || 0) * 1.4);
  const lexical = Math.min(1, Number(item.lexicalOverlap || 0) / 8);
  const anchor = Math.min(1, (Number(item.anchorOverlap || 0) + Number(item.requiredAnchorOverlap || 0) + Number(item.nameOverlap || 0)) / 6);
  return Math.min(1, semantic * 0.44 + lexical * 0.34 + anchor * 0.22);
}

function buildRagPlan({ db, customer, skill, generationType, message, extraContext }) {
  const enabledKbIds = db.knowledgeBases
    .filter((kb) => kb.status !== "disabled")
    .map((kb) => kb.id);
  const skillKbIds = ensureArray(skill?.knowledgeBaseIds).filter((id) => enabledKbIds.includes(id));
  const knowledgeBaseIds = skillKbIds.length ? skillKbIds : enabledKbIds;
  const query = collectQueryText({ customer, skill, generationType, message, extraContext });
  if (extraContext?.disableRag) {
    return {
      shouldRun: false,
      reason: "当前任务已使用客户上传资料和客户内历史作为上下文，已关闭全局知识库检索以避免引入无关资料。",
      query,
      anchorTokens: [],
      requiredAnchorTokens: [],
      customerNameTokens: [],
      knowledgeBaseIds
    };
  }
  const anchorTokens = extractMeaningfulTokens([
    customer?.name,
    customer?.customerType,
    customer?.demandDescription,
    customer?.background,
    customer?.problemToSolve,
    customer?.existingSystem
  ].filter(Boolean).join("\n"));
  const requiredAnchorTokens = extractRequiredAnchorTokens([
    customer?.name,
    customer?.customerType,
    customer?.demandDescription,
    customer?.background,
    customer?.problemToSolve,
    customer?.existingSystem
  ].filter(Boolean).join("\n"));
  const customerNameTokens = extractCustomerNameTokens(customer?.name || "");
  const toolType = String(skill?.toolType || "").toLowerCase();
  const explicitIntent = RAG_KEYWORDS.some((keyword) => query.includes(keyword));
  const explicitUserIntent = RAG_KEYWORDS.some((keyword) => [
    message,
    extraContext?.userIntent,
    extraContext?.ragQuery
  ].filter(Boolean).join("\n").includes(keyword));
  const skillIntent = toolType === "rag" || toolType === "knowledge_base" || skillKbIds.length > 0;
  const generationIntent = ["proposal_outline", "demand_analysis", "follow_strategy", "chat", "solution_deepening"].includes(generationType)
    && /案例|方案|资料|话术|能力|合同|行业|产品|知识库|参考/.test(query);
  const customerFileCount = customer
    ? db.customerFiles.filter((file) => file.customerId === customer.id && file.parsedText).length
    : 0;
  const shouldKeepGlobalRagWithCustomerFiles = generationType === "solution_deepening" || /方案强化|积木科技|公司介绍|核心能力|知识库|案例|历史方案/.test([
    message,
    extraContext?.userIntent,
    extraContext?.ragQuery,
    skill?.name,
    skill?.description
  ].filter(Boolean).join("\n"));
  const allowGeneralKnowledge = shouldKeepGlobalRagWithCustomerFiles || toolType === "knowledge_base" || skillKbIds.length > 0;

  if (!knowledgeBaseIds.length) {
    return {
      shouldRun: false,
      reason: "当前没有启用的知识库。",
      query,
      anchorTokens,
      requiredAnchorTokens,
      customerNameTokens,
      allowGeneralKnowledge,
      knowledgeBaseIds: []
    };
  }
  if (customerFileCount && !explicitUserIntent && !shouldKeepGlobalRagWithCustomerFiles && !/案例匹配/.test(skill?.name || "")) {
    return {
      shouldRun: false,
      reason: "当前客户已有上传资料，优先使用客户资料上下文；未检测到明确案例库/知识库检索要求，避免引入无关历史资料。",
      query,
      anchorTokens,
      requiredAnchorTokens,
      customerNameTokens,
      allowGeneralKnowledge,
      knowledgeBaseIds
    };
  }
  if (!explicitIntent && !skillIntent && !generationIntent) {
    return {
      shouldRun: false,
      reason: "未检测到知识库检索意图，避免引入无关资料。",
      query,
      anchorTokens,
      requiredAnchorTokens,
      customerNameTokens,
      allowGeneralKnowledge,
      knowledgeBaseIds
    };
  }

  return {
    shouldRun: true,
    reason: skillIntent
      ? "当前 Skill 绑定了知识库，自动执行 RAG 检索。"
      : "检测到资料、案例、方案、话术或知识库引用意图，自动执行 RAG 检索。",
    query,
    anchorTokens,
    requiredAnchorTokens,
    customerNameTokens,
    allowGeneralKnowledge,
    knowledgeBaseIds
  };
}

function getMinLexicalOverlap(plan) {
  if ((plan.query || "").length < 18) return 0;
  return 2;
}

function getMinAnchorOverlap(plan) {
  if (plan.allowGeneralKnowledge) return 0;
  return ensureArray(plan.anchorTokens).length >= 4 ? 2 : 0;
}

function getMinRequiredAnchorOverlap(plan) {
  if (plan.allowGeneralKnowledge) return 0;
  return ensureArray(plan.requiredAnchorTokens).length >= 2 ? 2 : 0;
}

function getMinNameOverlap(plan) {
  if (plan.allowGeneralKnowledge) return 0;
  return ensureArray(plan.customerNameTokens).length ? 1 : 0;
}

function collectQueryText({ customer, skill, generationType, message, extraContext }) {
  return [
    message,
    generationType,
    skill?.name,
    skill?.description,
    customer?.name,
    customer?.customerType,
    customer?.demandDescription,
    customer?.background,
    customer?.problemToSolve,
    customer?.existingSystem,
    customer?.knownRisks,
    extraContext ? JSON.stringify(extraContext).slice(0, 2000) : ""
  ].filter(Boolean).join("\n");
}

function collectKnowledgeChunks(db, knowledgeBaseIds) {
  const allowed = new Set(knowledgeBaseIds);
  const chunks = [];
  for (const kb of db.knowledgeBases || []) {
    if (kb.status === "disabled" || !allowed.has(kb.id)) continue;
    for (const doc of kb.documents || []) {
      if (doc.status === "disabled") continue;
      for (const chunk of doc.chunks || []) {
        if (!chunk.text || !Array.isArray(chunk.embedding)) continue;
        chunks.push({
          knowledgeBaseId: kb.id,
          knowledgeBaseName: kb.name,
          documentId: doc.id,
          documentName: doc.fileName || doc.name || "未命名文档",
          chunkId: chunk.id,
          text: chunk.text,
          embedding: chunk.embedding
        });
      }
    }
  }
  return chunks;
}

function buildKnowledgeDocumentFromUpload(upload = {}) {
  try {
    const fileName = clean(upload.fileName || upload.name || "未命名文件");
    const fileType = clean(upload.fileType || upload.type || extensionOf(fileName) || "file");
    const mimeType = clean(upload.mimeType || "");
    const buffer = upload.base64 ? Buffer.from(String(upload.base64), "base64") : null;
    const rawText = upload.text || upload.rawText || (buffer ? extractTextFromBuffer(buffer, fileName, mimeType) : "");
    const parsedText = cleanText(rawText).slice(0, MAX_UPLOAD_TEXT);
    if (!parsedText) return null;

    const chunks = chunkText(parsedText).map((text, index) => ({
      id: `chunk_${hashText(`${fileName}:${index}:${text.slice(0, 40)}`).slice(0, 12)}`,
      index,
      text,
      textLength: text.length,
      embedding: embedText(text)
    }));

    return {
      id: `doc_${hashText(`${fileName}:${parsedText.slice(0, 200)}:${nowIso()}`).slice(0, 16)}`,
      fileName,
      fileType,
      mimeType,
      size: Number(upload.size || buffer?.length || parsedText.length || 0),
      parser: pickParserName(fileName, mimeType),
      embeddingModel: `local-hash-v1-${VECTOR_DIMENSIONS}`,
      parsedTextPreview: parsedText.slice(0, 1200),
      chunkCount: chunks.length,
      chunks,
      status: "enabled",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  } catch {
    return null;
  }
}

function normalizeStoredDocument(doc = {}) {
  if (!doc) return null;
  const text = cleanText(doc.parsedText || doc.sourceText || doc.text || doc.parsedTextPreview || "");
  const chunks = ensureArray(doc.chunks).length
    ? ensureArray(doc.chunks).map((chunk, index) => ({
      id: chunk.id || `chunk_${index}`,
      index: Number(chunk.index ?? index),
      text: cleanText(chunk.text),
      textLength: cleanText(chunk.text).length,
      embedding: Array.isArray(chunk.embedding) ? chunk.embedding : embedText(chunk.text || "")
    })).filter((chunk) => chunk.text)
    : chunkText(text).map((chunkTextValue, index) => ({
      id: `chunk_${hashText(`${doc.fileName || doc.name}:${index}:${chunkTextValue.slice(0, 40)}`).slice(0, 12)}`,
      index,
      text: chunkTextValue,
      textLength: chunkTextValue.length,
      embedding: embedText(chunkTextValue)
    }));
  if (!chunks.length) return null;
  return {
    ...doc,
    id: doc.id || `doc_${hashText(`${doc.fileName || doc.name || "document"}:${chunks[0].text}`).slice(0, 16)}`,
    fileName: doc.fileName || doc.name || "未命名文档",
    fileType: doc.fileType || extensionOf(doc.fileName || doc.name || "") || "file",
    parser: doc.parser || "existing",
    embeddingModel: doc.embeddingModel || `local-hash-v1-${VECTOR_DIMENSIONS}`,
    parsedTextPreview: doc.parsedTextPreview || chunks.map((chunk) => chunk.text).join("\n").slice(0, 1200),
    chunkCount: chunks.length,
    chunks,
    status: doc.status || "enabled",
    createdAt: doc.createdAt || nowIso(),
    updatedAt: doc.updatedAt || nowIso()
  };
}

function extractTextFromBuffer(buffer, fileName, mimeType) {
  const ext = extensionOf(fileName);
  if (["xlsx"].includes(ext)) return extractXlsxText(buffer);
  if (["pptx"].includes(ext)) return extractPptxText(buffer);
  if (["docx"].includes(ext)) return extractDocxText(buffer);
  if (["pdf"].includes(ext)) return extractPdfTextBasic(buffer);

  const text = buffer.toString("utf8");
  if (["csv"].includes(ext) || /csv/.test(mimeType)) return csvToText(text, ",");
  if (["tsv"].includes(ext)) return csvToText(text, "\t");
  if (["json"].includes(ext) || /json/.test(mimeType)) return jsonToText(text);
  if (["html", "htm", "xml"].includes(ext) || /html|xml/.test(mimeType)) return htmlToText(text);
  return text;
}

function extractXlsxText(buffer) {
  const files = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8") || "");
  const sheetEntries = [...files.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));

  const sheets = [];
  for (const [name, content] of sheetEntries) {
    const rows = parseSheetRows(content.toString("utf8"), sharedStrings);
    if (!rows.length) continue;
    sheets.push([`# ${name}`, rows.map((row) => row.join(" | ")).join("\n")].join("\n"));
  }
  return sheets.join("\n\n");
}

function extractPptxText(buffer) {
  const files = readZipEntries(buffer);
  const slideEntries = [...files.entries()]
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
  const noteEntries = [...files.entries()]
    .filter(([name]) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));

  const slides = [];
  for (const [name, content] of slideEntries) {
    const text = extractOfficeDrawingText(content.toString("utf8"));
    if (!text) continue;
    const slideNo = /slide(\d+)\.xml$/.exec(name)?.[1] || String(slides.length + 1);
    slides.push([`# Slide ${slideNo}`, text].join("\n"));
  }

  const notes = [];
  for (const [name, content] of noteEntries) {
    const text = extractOfficeDrawingText(content.toString("utf8"));
    if (!text || /^\d+$/.test(text.trim())) continue;
    const noteNo = /notesSlide(\d+)\.xml$/.exec(name)?.[1] || String(notes.length + 1);
    notes.push([`# Notes ${noteNo}`, text].join("\n"));
  }

  return [...slides, ...notes].join("\n\n");
}

function extractOfficeDrawingText(xml) {
  const textRuns = [...String(xml || "").matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXml(stripTags(match[1])))
    .map((text) => text.trim())
    .filter(Boolean);
  const paragraphs = [];
  let current = [];
  for (const text of textRuns) {
    current.push(text);
    if (/[。！？!?：:]$/.test(text) || current.join("").length > 80) {
      paragraphs.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) paragraphs.push(current.join(" "));
  return paragraphs.join("\n");
}

function extractDocxText(buffer) {
  const files = readZipEntries(buffer);
  const xml = files.get("word/document.xml")?.toString("utf8") || "";
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractPdfTextBasic(buffer) {
  const latin = buffer.toString("latin1");
  const matches = [];
  for (const match of latin.matchAll(/\(([^()]|\\.){2,}\)\s*Tj/g)) {
    matches.push(match[0].replace(/\)\s*Tj$/, "").replace(/^\(/, ""));
  }
  for (const match of latin.matchAll(/\[((?:\s*\((?:[^()]|\\.)*\)\s*)+)\]\s*TJ/g)) {
    matches.push(match[1].replace(/[()]/g, " "));
  }
  return matches.map((text) => text.replace(/\\([()\\])/g, "$1")).join("\n");
}

function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) return new Map();
  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  const end = centralDirOffset + centralDirSize;
  const entries = new Map();
  let offset = centralDirOffset;

  while (offset < end && buffer.readUInt32LE(offset) === 0x02014b50) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    if (method === 0) entries.set(fileName, compressed);
    if (method === 8) entries.set(fileName, zlib.inflateRawSync(compressed));

    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 66000); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) => {
    return [...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((item) => decodeXml(stripTags(item[1])))
      .join("");
  });
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const type = /t="([^"]+)"/.exec(attrs)?.[1] || "";
      let value = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] || "";
      if (type === "s") value = sharedStrings[Number(value)] || "";
      if (type === "inlineStr") {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => item[1]).join("");
      }
      cells.push(decodeXml(stripTags(value)));
    }
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}

function csvToText(text, delimiter = ",") {
  const rows = parseDelimitedRows(text, delimiter);
  if (!rows.length) return text;
  const headers = rows[0];
  return rows.slice(1).map((row, index) => {
    const fields = row.map((value, columnIndex) => `${headers[columnIndex] || `列${columnIndex + 1}`}：${value}`).join("；");
    return `第 ${index + 1} 行：${fields}`;
  }).join("\n");
}

function parseDelimitedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function jsonToText(text) {
  try {
    return flattenJson(JSON.parse(text)).join("\n");
  } catch {
    return text;
  }
}

function flattenJson(value, prefix = "") {
  if (Array.isArray(value)) return value.flatMap((item, index) => flattenJson(item, `${prefix}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => flattenJson(child, prefix ? `${prefix}.${key}` : key));
  }
  return [`${prefix || "value"}：${String(value ?? "")}`];
}

function htmlToText(text) {
  return decodeXml(text)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function chunkText(text) {
  const normalized = cleanText(text);
  if (!normalized) return [];
  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const targetEnd = Math.min(normalized.length, start + CHUNK_SIZE);
    const boundary = findChunkBoundary(normalized, targetEnd, start + Math.floor(CHUNK_SIZE * 0.6));
    const end = boundary || targetEnd;
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function findChunkBoundary(text, targetEnd, minEnd) {
  const candidates = ["\n\n", "\n", "。", "；", ".", ";"];
  for (const marker of candidates) {
    const index = text.lastIndexOf(marker, targetEnd);
    if (index >= minEnd) return index + marker.length;
  }
  return 0;
}

function embedText(text) {
  const vector = Array(VECTOR_DIMENSIONS).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const hash = hashNumber(token);
    const index = Math.abs(hash) % VECTOR_DIMENSIONS;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.min(token.length, 8) / 8);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

function tokenize(text) {
  const normalized = String(text || "").toLowerCase();
  const words = normalized.match(/[a-z0-9][a-z0-9_-]{1,}|[\u4e00-\u9fa5]/g) || [];
  const chinese = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const bigrams = chinese.flatMap((word) => {
    const list = [];
    for (let index = 0; index < word.length - 1; index++) list.push(word.slice(index, index + 2));
    return list;
  });
  return [...words, ...bigrams].filter((token) => token.length > 1 || /[\u4e00-\u9fa5]/.test(token));
}

function extractMeaningfulTokens(text) {
  const stopwords = new Set(["我们", "你们", "客户", "项目", "系统", "方案", "进行", "需要", "希望", "当前", "这个", "那个", "以及", "可以", "用于", "自动", "生成", "阶段"]);
  return [...new Set(tokenize(text).filter((token) => !stopwords.has(token) && token.length >= 2))];
}

function extractRequiredAnchorTokens(text) {
  const normalized = String(text || "").toLowerCase();
  const matches = normalized.match(/agent|skill|rag|mvp|iot|mes|to\s*[bc]|小程序|无人|自助|门店|营销|增长|投放|复盘|洞察|策略|会员|报价|合同|视觉|质检|知识库|自动化|中台|渠道/g) || [];
  const customerNameTokens = (String(text || "").match(/[\u4e00-\u9fa5]{2,}/g) || [])
    .filter((item) => item.length <= 8)
    .filter((item) => !["客户资料", "业务系统", "解决方案", "自动化营销系统"].includes(item));
  return [...new Set([...matches.map((item) => item.replace(/\s+/g, "")), ...customerNameTokens])];
}

function extractCustomerNameTokens(name) {
  const stopwords = new Set(["测试", "解析", "客户", "项目", "系统", "自动", "动化", "自动化", "营销", "方案", "业务", "ppt", "pptx"]);
  const baseName = String(name || "").split(/[（(_\-]/)[0] || "";
  const chinese = (baseName.match(/[\u4e00-\u9fa5]{2,}/g) || [])
    .flatMap((word) => (word.length <= 3 ? [word] : [word.slice(0, 2), word.slice(-2)]));
  const latin = baseName.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
  return [...new Set([...chinese, ...latin].filter((token) => !stopwords.has(token)))].slice(0, 4);
}

function countTokenOverlap(left, right) {
  const set = new Set(right);
  let total = 0;
  for (const token of left) {
    if (set.has(token)) total += 1;
  }
  return total;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let score = 0;
  for (let index = 0; index < a.length; index++) score += Number(a[index] || 0) * Number(b[index] || 0);
  return score;
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < String(text).length; index++) {
    hash ^= String(text).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function hashNumber(text) {
  let hash = 0;
  for (let index = 0; index < String(text).length; index++) {
    hash = Math.imul(31, hash) + String(text).charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

function pickParserName(fileName, mimeType) {
  const ext = extensionOf(fileName);
  if (ext) return `${ext}-parser`;
  if (mimeType) return `${mimeType}-parser`;
  return "text-parser";
}

function extensionOf(fileName = "") {
  const match = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function cleanText(text) {
  return String(text || "")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(text) {
  return String(text || "").replace(/<[^>]+>/g, "");
}

function decodeXml(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function clean(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}
