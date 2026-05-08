import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const WIDTH = 1792;
const HEIGHT = 1024;
const PPTX_WIDTH = 13.333;
const PPTX_HEIGHT = 7.5;

const OUTPUT_DIR = process.argv[2];
const PLAN_FILE = process.argv[3] || path.join(OUTPUT_DIR || "", "slides_plan.json");

if (!OUTPUT_DIR) {
  console.error("Usage: node scripts/generate-svg-pptx.mjs <output-dir> [slides_plan.json]");
  process.exit(1);
}

const SVG_DIR = path.join(OUTPUT_DIR, "svgs");
const SVG_PNG_DIR = path.join(OUTPUT_DIR, "svg_png_fallback");

await fs.mkdir(SVG_DIR, { recursive: true });
await fs.mkdir(SVG_PNG_DIR, { recursive: true });

const plan = JSON.parse(await fs.readFile(PLAN_FILE, "utf8"));
const slides = plan.slides || [];
const title = plan.title || "SVG PPT";
const safeTitle = sanitizeFileName(`${title}_SVG嵌入版`);

const slideFiles = [];

for (const slide of slides) {
  const slideNumber = Number(slide.slide_number || slideFiles.length + 1);
  const svg = renderSlideSvg(slide, slides.length);
  const svgFile = path.join(SVG_DIR, `slide-${String(slideNumber).padStart(2, "0")}.svg`);
  const pngFile = path.join(SVG_PNG_DIR, `slide-${String(slideNumber).padStart(2, "0")}.png`);
  await fs.writeFile(svgFile, svg, "utf8");
  await sharp(Buffer.from(svg)).png().toFile(pngFile);
  slideFiles.push({ slideNumber, svgFile, pngFile });
}

const viewerFile = path.join(OUTPUT_DIR, "svg-viewer.html");
await fs.writeFile(viewerFile, renderSvgViewer(title, slideFiles), "utf8");

const pptxFile = path.join(OUTPUT_DIR, `${safeTitle}.pptx`);
await buildSvgPptx({ title, slideFiles, pptxFile });

const report = {
  title,
  mode: "svg-embed-with-png-fallback",
  generatedAt: new Date().toISOString(),
  files: {
    viewer: path.basename(viewerFile),
    pptx: path.basename(pptxFile),
    svgs: slideFiles.map((file) => path.relative(OUTPUT_DIR, file.svgFile)),
    pngFallbacks: slideFiles.map((file) => path.relative(OUTPUT_DIR, file.pngFile))
  },
  note: "PowerPoint compatibility varies: the visible fallback is PNG, while the package also carries SVG media for vector-preserving experiments."
};
await fs.writeFile(path.join(OUTPUT_DIR, "svg-manifest.json"), JSON.stringify(report, null, 2), "utf8");

console.log(JSON.stringify(report, null, 2));

function renderSlideSvg(slide, totalSlides) {
  const content = String(slide.content || "");
  const lines = content.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const heading = lines[0] || `第 ${slide.slide_number} 页`;
  const body = lines.slice(1).join(" ");
  const pageType = slide.page_type || "content";
  const number = Number(slide.slide_number || 1);
  const palette = pickPalette(number);
  const phoneCount = pageType === "cover" ? 3 : number === totalSlides ? 4 : 5;
  const screenSet = buildScreenSet(number, phoneCount, palette);
  const dashboard = buildDashboard(number, palette);
  const metrics = buildMetrics(number, palette);
  const chips = extractChips(body);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(heading)}">
  <defs>
    <linearGradient id="bg-${number}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fbff"/>
      <stop offset="45%" stop-color="#eef8ff"/>
      <stop offset="100%" stop-color="#ecfff8"/>
    </linearGradient>
    <linearGradient id="accent-${number}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.primary}"/>
      <stop offset="100%" stop-color="${palette.secondary}"/>
    </linearGradient>
    <filter id="shadow-${number}" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#0f172a" flood-opacity="0.14"/>
    </filter>
    <pattern id="grid-${number}" width="42" height="42" patternUnits="userSpaceOnUse">
      <path d="M 42 0 L 0 0 0 42" fill="none" stroke="#b7c7dd" stroke-opacity="0.24" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg-${number})"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid-${number})" opacity="0.42"/>
  <circle cx="${1500 - number * 18}" cy="${160 + number * 10}" r="230" fill="${palette.secondary}" opacity="0.13"/>
  <circle cx="${144 + number * 22}" cy="${850 - number * 12}" r="180" fill="${palette.primary}" opacity="0.09"/>
  <path d="M132 114 C430 40, 670 70, 900 124" fill="none" stroke="url(#accent-${number})" stroke-width="8" stroke-linecap="round" opacity="0.55"/>

  ${pageType === "cover" ? renderCoverText(heading, body, palette) : renderPageText(heading, body, chips, palette)}
  ${pageType === "cover" ? screenSet : `${dashboard}${screenSet}${metrics}`}
  ${renderFooter(number, totalSlides, palette)}
</svg>`;
}

function renderCoverText(heading, body, palette) {
  const wrappedTitle = wrapText(heading, 10).slice(0, 4);
  const bodyText = wrapText(body, 28).slice(0, 3);
  return `
  <g transform="translate(120 138)">
    <rect x="0" y="-52" width="312" height="48" rx="24" fill="#ffffff" stroke="#dbeafe"/>
    <circle cx="28" cy="-28" r="8" fill="${palette.primary}"/>
    <text x="48" y="-18" font-size="24" font-weight="700" fill="${palette.primary}" font-family="PingFang SC, Source Han Sans, sans-serif">AI 穿戴产品方案</text>
    ${wrappedTitle.map((line, index) => `<text x="0" y="${90 + index * 92}" font-size="76" font-weight="900" fill="#0f172a" font-family="PingFang SC, Source Han Sans, sans-serif">${escapeXml(line)}</text>`).join("")}
    ${bodyText.map((line, index) => `<text x="4" y="${470 + index * 42}" font-size="30" font-weight="500" fill="#475569" font-family="PingFang SC, Source Han Sans, sans-serif">${escapeXml(line)}</text>`).join("")}
    <rect x="0" y="642" width="480" height="18" rx="9" fill="url(#accent-1)"/>
  </g>`;
}

function renderPageText(heading, body, chips, palette) {
  const wrappedTitle = wrapText(heading, 18).slice(0, 2);
  const bodyText = wrapText(body, 34).slice(0, 4);
  return `
  <g transform="translate(96 82)">
    <text x="0" y="0" font-size="26" font-weight="800" fill="${palette.primary}" font-family="PingFang SC, Source Han Sans, sans-serif">护卫官智能手环 App</text>
    <rect x="0" y="32" width="480" height="6" rx="3" fill="url(#accent-${chips.length + 1})" opacity="0.9"/>
    ${wrappedTitle.map((line, index) => `<text x="0" y="${126 + index * 68}" font-size="58" font-weight="900" fill="#0f172a" font-family="PingFang SC, Source Han Sans, sans-serif">${escapeXml(line)}</text>`).join("")}
    ${bodyText.map((line, index) => `<text x="0" y="${292 + index * 38}" font-size="25" font-weight="500" fill="#475569" font-family="PingFang SC, Source Han Sans, sans-serif">${escapeXml(line)}</text>`).join("")}
    ${chips.slice(0, 4).map((chip, index) => `<g transform="translate(${index * 176} 486)"><rect x="0" y="0" width="154" height="48" rx="24" fill="#ffffff" stroke="#dbeafe"/><circle cx="26" cy="24" r="7" fill="${index % 2 ? palette.secondary : palette.primary}"/><text x="44" y="32" font-size="19" font-weight="800" fill="#1e293b" font-family="PingFang SC, Source Han Sans, sans-serif">${escapeXml(chip)}</text></g>`).join("")}
  </g>`;
}

function buildScreenSet(number, count, palette) {
  const positions = [
    { x: 1040, y: 136, s: 1.05, r: -5 },
    { x: 1288, y: 168, s: 0.92, r: 6 },
    { x: 1480, y: 252, s: 0.78, r: -3 },
    { x: 958, y: 478, s: 0.78, r: 5 },
    { x: 1232, y: 552, s: 0.7, r: -6 }
  ];
  return positions.slice(0, count).map((pos, index) => renderPhone(pos, index, number, palette)).join("");
}

function renderPhone(pos, index, number, palette) {
  const screenTitles = ["健康首页", "AI 洞察", "安全告警", "设备配置", "家人守护", "运营看板"];
  const title = screenTitles[(number + index) % screenTitles.length];
  const bars = [72, 124, 94, 152, 118].map((v, i) => Math.max(42, v - index * 8 + i * 5));
  return `
  <g transform="translate(${pos.x} ${pos.y}) rotate(${pos.r}) scale(${pos.s})" filter="url(#shadow-${number})">
    <rect x="0" y="0" width="220" height="430" rx="48" fill="#0f172a"/>
    <rect x="13" y="16" width="194" height="398" rx="38" fill="#ffffff"/>
    <rect x="78" y="28" width="64" height="8" rx="4" fill="#cbd5e1"/>
    <rect x="30" y="62" width="160" height="62" rx="22" fill="url(#accent-${number})" opacity="0.95"/>
    <text x="46" y="100" font-size="20" font-weight="900" fill="#ffffff" font-family="PingFang SC, Source Han Sans, sans-serif">${escapeXml(title)}</text>
    <rect x="30" y="142" width="160" height="74" rx="20" fill="#f1f7ff" stroke="#dbeafe"/>
    <path d="M48 190 C76 152, 104 206, 132 170 S172 168, 184 150" fill="none" stroke="${palette.primary}" stroke-width="7" stroke-linecap="round"/>
    <circle cx="56" cy="174" r="12" fill="${palette.secondary}" opacity="0.9"/>
    <rect x="30" y="232" width="74" height="64" rx="18" fill="#ecfeff" stroke="#bae6fd"/>
    <rect x="116" y="232" width="74" height="64" rx="18" fill="#f0fdf4" stroke="#bbf7d0"/>
    <text x="48" y="272" font-size="24" font-weight="900" fill="#0f172a" font-family="PingFang SC, Source Han Sans, sans-serif">${88 + index}</text>
    <text x="136" y="272" font-size="24" font-weight="900" fill="#0f172a" font-family="PingFang SC, Source Han Sans, sans-serif">${96 - index}</text>
    ${bars.map((height, i) => `<rect x="${38 + i * 30}" y="${356 - height}" width="18" height="${height}" rx="9" fill="${i % 2 ? palette.secondary : palette.primary}" opacity="${0.45 + i * 0.08}"/>`).join("")}
    <rect x="50" y="376" width="120" height="16" rx="8" fill="#dbeafe"/>
  </g>`;
}

function buildDashboard(number, palette) {
  if (number < 3) return "";
  return `
  <g transform="translate(106 662)" filter="url(#shadow-${number})">
    <rect x="0" y="0" width="728" height="244" rx="32" fill="#ffffff" stroke="#dbeafe"/>
    <text x="36" y="54" font-size="27" font-weight="900" fill="#0f172a" font-family="PingFang SC, Source Han Sans, sans-serif">产品 UI 数据驾驶舱</text>
    <rect x="36" y="84" width="196" height="112" rx="24" fill="#eff6ff"/>
    <rect x="264" y="84" width="196" height="112" rx="24" fill="#ecfeff"/>
    <rect x="492" y="84" width="196" height="112" rx="24" fill="#f0fdf4"/>
    <text x="68" y="134" font-size="44" font-weight="900" fill="${palette.primary}" font-family="PingFang SC, Source Han Sans, sans-serif">${86 + number}%</text>
    <text x="296" y="134" font-size="44" font-weight="900" fill="${palette.secondary}" font-family="PingFang SC, Source Han Sans, sans-serif">${24 + number}</text>
    <text x="524" y="134" font-size="44" font-weight="900" fill="#16a34a" font-family="PingFang SC, Source Han Sans, sans-serif">${91 - number}%</text>
    <text x="68" y="174" font-size="21" fill="#64748b" font-family="PingFang SC, Source Han Sans, sans-serif">日活留存</text>
    <text x="296" y="174" font-size="21" fill="#64748b" font-family="PingFang SC, Source Han Sans, sans-serif">AI 场景</text>
    <text x="524" y="174" font-size="21" fill="#64748b" font-family="PingFang SC, Source Han Sans, sans-serif">告警闭环</text>
  </g>`;
}

function buildMetrics(number, palette) {
  const x = number % 2 ? 918 : 878;
  const y = number % 2 ? 800 : 740;
  return `
  <g transform="translate(${x} ${y})">
    <rect x="0" y="0" width="360" height="118" rx="28" fill="#ffffff" stroke="#dbeafe" filter="url(#shadow-${number})"/>
    <circle cx="66" cy="59" r="36" fill="${palette.primary}" opacity="0.14"/>
    <path d="M50 62 L62 74 L86 44" fill="none" stroke="${palette.primary}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="122" y="50" font-size="25" font-weight="900" fill="#0f172a" font-family="PingFang SC, Source Han Sans, sans-serif">UI 原型可交付</text>
    <text x="122" y="84" font-size="20" fill="#64748b" font-family="PingFang SC, Source Han Sans, sans-serif">手机端 + 后台 + AI 流程</text>
  </g>`;
}

function renderFooter(number, totalSlides, palette) {
  return `
  <g transform="translate(96 960)">
    <text x="0" y="0" font-size="20" font-weight="700" fill="#64748b" font-family="PingFang SC, Source Han Sans, sans-serif">SVG vector prototype · 护卫官</text>
    <rect x="1292" y="-18" width="300" height="10" rx="5" fill="#dbeafe"/>
    <rect x="1292" y="-18" width="${Math.round(300 * number / totalSlides)}" height="10" rx="5" fill="${palette.primary}"/>
    <text x="1618" y="0" font-size="22" font-weight="900" fill="${palette.primary}" font-family="PingFang SC, Source Han Sans, sans-serif">${number}/${totalSlides}</text>
  </g>`;
}

function renderSvgViewer(title, slideFiles) {
  const slides = slideFiles.map((file) => `svgs/${path.basename(file.svgFile)}`);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} SVG Viewer</title>
  <style>
    body { margin: 0; background: #eaf2f7; color: #0f172a; font-family: "PingFang SC", "Source Han Sans", sans-serif; }
    .stage { min-height: 100vh; display: grid; place-items: center; padding: 28px; box-sizing: border-box; }
    img { width: min(94vw, 1500px); aspect-ratio: 16 / 9; border-radius: 28px; box-shadow: 0 28px 90px rgba(15, 23, 42, .18); background: white; }
    .bar { position: fixed; left: 24px; right: 24px; bottom: 18px; display: flex; justify-content: space-between; align-items: center; color: #475569; font-weight: 800; }
    button { border: 0; border-radius: 999px; padding: 12px 18px; background: #0f172a; color: white; font-weight: 900; cursor: pointer; }
  </style>
</head>
<body>
  <div class="stage"><img id="slide" alt="SVG slide" /></div>
  <div class="bar"><button onclick="prev()">上一页</button><span id="count"></span><button onclick="next()">下一页</button></div>
  <script>
    const slides = ${JSON.stringify(slides)};
    let index = 0;
    function render() {
      document.getElementById("slide").src = slides[index];
      document.getElementById("count").textContent = (index + 1) + " / " + slides.length;
    }
    function next() { index = (index + 1) % slides.length; render(); }
    function prev() { index = (index - 1 + slides.length) % slides.length; render(); }
    window.addEventListener("keydown", (event) => {
      if (["ArrowRight", " "].includes(event.key)) next();
      if (event.key === "ArrowLeft") prev();
    });
    render();
  </script>
</body>
</html>`;
}

async function buildSvgPptx({ title, slideFiles, pptxFile }) {
  const payloadFile = path.join(OUTPUT_DIR, "svg-pptx-payload.json");
  await fs.writeFile(payloadFile, JSON.stringify({
    title,
    pptxFile,
    slideFiles,
    pptxWidth: PPTX_WIDTH,
    pptxHeight: PPTX_HEIGHT
  }, null, 2), "utf8");

  const python = [
    "import json, os, tempfile, zipfile",
    "from pathlib import Path",
    "from lxml import etree",
    "from pptx import Presentation",
    "from pptx.util import Inches",
    `payload = json.loads(Path(${JSON.stringify(payloadFile)}).read_text())`,
    "DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'",
    "REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'",
    "PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'",
    "SVG_NS = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main'",
    "CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'",
    "SVG_EXT_URI = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}'",
    "IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'",
    "etree.register_namespace('a', DRAWING_NS)",
    "etree.register_namespace('r', REL_NS)",
    "etree.register_namespace('asvg', SVG_NS)",
    "prs = Presentation()",
    "prs.slide_width = Inches(payload['pptxWidth'])",
    "prs.slide_height = Inches(payload['pptxHeight'])",
    "blank = prs.slide_layouts[6]",
    "for item in payload['slideFiles']:",
    "    slide = prs.slides.add_slide(blank)",
    "    slide.shapes.add_picture(item['pngFile'], 0, 0, width=prs.slide_width, height=prs.slide_height)",
    "prs.core_properties.title = payload['title']",
    "prs.save(payload['pptxFile'])",
    "pptx_path = Path(payload['pptxFile'])",
    "tmp_path = pptx_path.with_suffix('.tmp.pptx')",
    "def add_svg_content_type(raw):",
    "    root = etree.fromstring(raw)",
    "    has_svg = any(el.get('Extension') == 'svg' for el in root.findall('{%s}Default' % CONTENT_TYPES_NS))",
    "    if not has_svg:",
    "        el = etree.SubElement(root, '{%s}Default' % CONTENT_TYPES_NS)",
    "        el.set('Extension', 'svg')",
    "        el.set('ContentType', 'image/svg+xml')",
    "    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)",
    "def add_slide_svg(raw_slide_xml, svg_rid):",
    "    root = etree.fromstring(raw_slide_xml)",
    "    blip = root.find('.//{%s}blip' % DRAWING_NS)",
    "    if blip is None:",
    "        return raw_slide_xml",
    "    ext_lst = blip.find('{%s}extLst' % DRAWING_NS)",
    "    if ext_lst is None:",
    "        ext_lst = etree.SubElement(blip, '{%s}extLst' % DRAWING_NS)",
    "    ext = etree.SubElement(ext_lst, '{%s}ext' % DRAWING_NS)",
    "    ext.set('uri', SVG_EXT_URI)",
    "    svg_blip = etree.SubElement(ext, '{%s}svgBlip' % SVG_NS)",
    "    svg_blip.set('{%s}embed' % REL_NS, svg_rid)",
    "    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)",
    "def add_slide_rel(raw_rels_xml, svg_rid, target):",
    "    root = etree.fromstring(raw_rels_xml)",
    "    rel = etree.SubElement(root, '{%s}Relationship' % PKG_REL_NS)",
    "    rel.set('Id', svg_rid)",
    "    rel.set('Type', IMAGE_REL_TYPE)",
    "    rel.set('Target', target)",
    "    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)",
    "with zipfile.ZipFile(pptx_path, 'r') as src, zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as dst:",
    "    names = set(src.namelist())",
    "    patched = {}",
    "    patched['[Content_Types].xml'] = add_svg_content_type(src.read('[Content_Types].xml'))",
    "    for idx, item in enumerate(payload['slideFiles'], start=1):",
    "        svg_name = 'ppt/media/svg-slide-%02d.svg' % idx",
    "        svg_rid = 'rIdSvg%d' % idx",
    "        slide_xml = 'ppt/slides/slide%d.xml' % idx",
    "        rels_xml = 'ppt/slides/_rels/slide%d.xml.rels' % idx",
    "        patched[slide_xml] = add_slide_svg(src.read(slide_xml), svg_rid)",
    "        patched[rels_xml] = add_slide_rel(src.read(rels_xml), svg_rid, '../media/svg-slide-%02d.svg' % idx)",
    "        patched[svg_name] = Path(item['svgFile']).read_bytes()",
    "    for name in src.namelist():",
    "        dst.writestr(name, patched.pop(name, src.read(name)))",
    "    for name, data in patched.items():",
    "        dst.writestr(name, data)",
    "os.replace(tmp_path, pptx_path)",
    "with zipfile.ZipFile(pptx_path) as z:",
    "    svg_media = [n for n in z.namelist() if n.startswith('ppt/media/') and n.lower().endswith('.svg')]",
    "    svg_blip_slides = []",
    "    for idx in range(1, len(payload['slideFiles']) + 1):",
    "        xml = z.read('ppt/slides/slide%d.xml' % idx).decode('utf-8', errors='ignore')",
    "        if 'svgBlip' in xml:",
    "            svg_blip_slides.append(idx)",
    "print('svg_media_count=' + str(len(svg_media)))",
    "print('svg_blip_slides=' + ','.join(map(str, svg_blip_slides)))",
    "print('\\n'.join(svg_media[:20]))"
  ].join("\n");

  const result = spawnSync("python3", ["-c", python], {
    cwd: OUTPUT_DIR,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(`Failed to build SVG PPTX:\n${result.stdout}\n${result.stderr}`);
  }

  await fs.writeFile(path.join(OUTPUT_DIR, "svg-pptx-build.log"), `${result.stdout}\n${result.stderr}`, "utf8");
}

function pickPalette(number) {
  const palettes = [
    { primary: "#2563eb", secondary: "#06b6d4" },
    { primary: "#0ea5e9", secondary: "#14b8a6" },
    { primary: "#1d4ed8", secondary: "#22c55e" },
    { primary: "#0891b2", secondary: "#60a5fa" }
  ];
  return palettes[number % palettes.length];
}

function extractChips(body) {
  const source = body || "AI 健康 安全告警 设备连接 数据看板";
  const words = source.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,8}/g) || [];
  const preferred = words.filter((word) => /AI|UI|App|健康|告警|设备|数据|安全|后台|流程|用户|价值|绑定|洞察/.test(word));
  return [...new Set([...preferred, "AI 助手", "产品 UI", "数据闭环", "安全守护"])].slice(0, 6);
}

function wrapText(text, maxChars) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const lines = [];
  let current = "";
  for (const char of normalized) {
    current += char;
    if (current.length >= maxChars) {
      lines.push(current);
      current = "";
    }
  }
  if (current) lines.push(current);
  return lines;
}

function sanitizeFileName(value) {
  return String(value || "deck").replace(/[^\w\u4e00-\u9fff.-]+/g, "_").slice(0, 80);
}

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHtml(value) {
  return escapeXml(value).replaceAll("'", "&#39;");
}
