const MAX_RICH_TEXT_LENGTH = 1800;
const MAX_BLOCKS = 90;

export function markdownToNotionBlocks(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let inCode = false;
  let codeLanguage = "plain text";
  let codeLines = [];

  const flushParagraph = () => {
    const text = paragraph.join("\n").trim();
    paragraph = [];
    if (!text) return;
    pushTextBlocks(blocks, "paragraph", text);
  };

  const flushCode = () => {
    const text = codeLines.join("\n").trimEnd() || " ";
    codeLines = [];
    blocks.push({
      object: "block",
      type: "code",
      code: {
        rich_text: richTextChunks(text),
        language: normalizeCodeLanguage(codeLanguage)
      }
    });
  };

  for (const line of lines) {
    const codeFence = line.match(/^```(\w+)?\s*$/);
    if (codeFence) {
      if (inCode) {
        flushCode();
        inCode = false;
        codeLanguage = "plain text";
      } else {
        flushParagraph();
        inCode = true;
        codeLanguage = codeFence[1] || "plain text";
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
      const level = heading[1].length;
      const type = level === 1 ? "heading_1" : level === 2 ? "heading_2" : "heading_3";
      pushTextBlocks(blocks, type, heading[2].trim());
      continue;
    }

    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushParagraph();
      pushTextBlocks(blocks, "quote", quote[1].trim());
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      pushTextBlocks(blocks, "bulleted_list_item", bullet[1].trim());
      continue;
    }

    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      pushTextBlocks(blocks, "numbered_list_item", numbered[1].trim());
      continue;
    }

    paragraph.push(line);
  }

  if (inCode) flushCode();
  flushParagraph();

  if (blocks.length > MAX_BLOCKS) {
    return [
      ...blocks.slice(0, MAX_BLOCKS),
      paragraphBlock("内容较长，已截断部分块。建议在原始内容中查看完整记录。")
    ];
  }

  return blocks.length ? blocks : [paragraphBlock("无正文内容。")];
}

function pushTextBlocks(blocks, type, text) {
  for (const chunk of chunkText(text, MAX_RICH_TEXT_LENGTH)) {
    blocks.push({
      object: "block",
      type,
      [type]: {
        rich_text: richTextChunks(chunk)
      }
    });
  }
}

function paragraphBlock(text) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: richTextChunks(text)
    }
  };
}

function richTextChunks(text) {
  return chunkText(String(text || ""), MAX_RICH_TEXT_LENGTH).map((chunk) => ({
    type: "text",
    text: { content: chunk }
  }));
}

function chunkText(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length ? chunks : [""];
}

function normalizeCodeLanguage(language) {
  const allowed = new Set([
    "abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++",
    "c#", "css", "dart", "diff", "docker", "elixir", "elm", "erlang", "flow",
    "fortran", "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell",
    "html", "java", "javascript", "json", "julia", "kotlin", "latex", "less",
    "lisp", "livescript", "lua", "makefile", "markdown", "markup", "matlab",
    "mermaid", "nix", "objective-c", "ocaml", "pascal", "perl", "php",
    "plain text", "powershell", "prolog", "protobuf", "python", "r", "reason",
    "ruby", "rust", "sass", "scala", "scheme", "scss", "shell", "sql",
    "swift", "typescript", "vb.net", "verilog", "vhdl", "visual basic", "webassembly",
    "xml", "yaml", "java/c/c++/c#"
  ]);

  const normalized = String(language || "plain text").toLowerCase();
  if (normalized === "js") return "javascript";
  if (normalized === "ts") return "typescript";
  if (normalized === "sh" || normalized === "zsh") return "shell";
  if (allowed.has(normalized)) return normalized;
  return "plain text";
}
