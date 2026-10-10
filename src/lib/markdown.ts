/**
 * Minimal Markdown support for the documents Claude writes (headings, bullet
 * and numbered lists, bold/italic, links, rules). One parser drives the
 * on-screen preview, the .docx export and the print view so they always agree.
 */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  href?: string;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "rule" };

const INLINE =
  /(\*\*|__)(.+?)\1|\*(?![\s*])(.+?)\*|(?<![\w])_(?![\s_])(.+?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    // Bold, italic and link text can contain each other: **[Project](https://…)**.
    if (match[2] !== undefined) out.push(...parseInline(match[2]).map((inline) => ({ ...inline, bold: true })));
    else if (match[3] !== undefined) out.push(...parseInline(match[3]).map((inline) => ({ ...inline, italic: true })));
    else if (match[4] !== undefined) out.push(...parseInline(match[4]).map((inline) => ({ ...inline, italic: true })));
    else if (match[5] !== undefined) {
      const href = /^(https?:|mailto:)/i.test(match[6]) ? match[6] : undefined;
      out.push(...parseInline(match[5]).map((inline) => ({ ...inline, href })));
    } else if (match[7] !== undefined) out.push({ text: match[7] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.filter((inline) => inline.text.length > 0);
}

/** Remove a ```markdown fence if the whole document is wrapped in one. */
export function unwrapFence(markdown: string): string {
  const match = /^\s*```[a-z]*\n([\s\S]*?)\n```\s*$/i.exec(markdown);
  return match ? match[1] : markdown;
}

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    list = null;
  };

  for (const rawLine of unwrapFence(markdown).replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, inlines: parseInline(heading[2]) });
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "rule" });
      continue;
    }
    const bullet = /^([-*+•])\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ? bullet[2] : numbered![1]).trim());
      continue;
    }
    if (list && /^\s{2,}/.test(rawLine)) {
      list.items[list.items.length - 1] += ` ${trimmed}`;
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function inlinesToText(inlines: Inline[]): string {
  return inlines.map((inline) => inline.text).join("");
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function inlinesToHtml(inlines: Inline[]): string {
  return inlines
    .map((inline) => {
      let html = escapeHtml(inline.text);
      if (inline.bold) html = `<strong>${html}</strong>`;
      if (inline.italic) html = `<em>${html}</em>`;
      if (inline.href) html = `<a href="${escapeHtml(inline.href)}">${html}</a>`;
      return html;
    })
    .join("");
}

export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `<h${block.level}>${inlinesToHtml(block.inlines)}</h${block.level}>`;
        case "paragraph":
          return `<p>${inlinesToHtml(block.inlines)}</p>`;
        case "rule":
          return "<hr>";
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          return `<${tag}>${block.items.map((item) => `<li>${inlinesToHtml(item)}</li>`).join("")}</${tag}>`;
        }
      }
    })
    .join("\n");
}

/** A standalone, print-ready HTML document (used for "Save as PDF"). */
export function printableHtml(title: string, markdown: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { margin: 16mm 16mm; }
  body { font: 10.5pt/1.45 Calibri, "Segoe UI", Arial, sans-serif; color: #111; max-width: 180mm; margin: 0 auto; }
  h1 { font-size: 20pt; margin: 0 0 2pt; }
  h1 + p { margin-top: 0; color: #444; }
  h2 { font-size: 12pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #bbb; padding-bottom: 2pt; margin: 14pt 0 6pt; }
  h3 { font-size: 11pt; margin: 10pt 0 2pt; }
  p { margin: 0 0 6pt; }
  ul, ol { margin: 0 0 6pt; padding-left: 16pt; }
  li { margin: 0 0 2pt; }
  a { color: inherit; }
  hr { border: 0; border-top: 1px solid #bbb; margin: 10pt 0; }
</style></head><body>${blocksToHtml(parseMarkdown(markdown))}</body></html>`;
}
