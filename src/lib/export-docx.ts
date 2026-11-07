import { inlinesToText, parseMarkdown, type Inline } from "@/lib/markdown";

/**
 * Spacing in twentieths of a point, matching the printed (PDF) layout so a CV is the same length in
 * both, and the page estimate (estimatePages) holds for the Word file too. Word adds the space after
 * one paragraph to the space before the next, where the print stylesheet overlaps them, so headings
 * take only the difference.
 */
const LINE = 285; // 1.45 lines in CSS terms: Word's single line for Calibri is already about 1.22
const SPACING = {
  name: { before: 0, after: 40, line: LINE },
  section: { before: 160, after: 120, line: LINE },
  role: { before: 80, after: 40, line: LINE },
  paragraph: { after: 120, line: LINE },
  item: { after: 40, line: LINE },
  lastItem: { after: 160, line: LINE },
};
const MARGIN = 907; // 16mm, as on the printed page

/** Build a Word document from Claude's Markdown, entirely in the browser. */
export async function markdownToDocx(markdown: string, title: string): Promise<Blob> {
  const { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } =
    await import("docx");

  const runs = (inlines: Inline[]) =>
    inlines.map((inline) => {
      if (inline.br) return new TextRun({ break: 1 });
      const run = new TextRun({ text: inline.text, bold: inline.bold, italics: inline.italic });
      return inline.href
        ? new ExternalHyperlink({
            link: inline.href,
            children: [new TextRun({ text: inline.text, style: "Hyperlink", bold: inline.bold, italics: inline.italic })],
          })
        : run;
    });

  const blocks = parseMarkdown(markdown);
  const children = blocks.flatMap((block, index) => {
    switch (block.type) {
      case "heading": {
        const isName = block.level === 1 && index === 0;
        return [
          new Paragraph({
            heading: block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
            alignment: isName ? AlignmentType.LEFT : undefined,
            spacing: block.level === 1 ? SPACING.name : block.level === 2 ? SPACING.section : SPACING.role,
            border:
              block.level === 2
                ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: "AAAAAA", space: 2 } }
                : undefined,
            children: runs(block.inlines),
          }),
        ];
      }
      case "paragraph":
        return [new Paragraph({ spacing: SPACING.paragraph, children: runs(block.inlines) })];
      case "rule":
        return [
          new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "AAAAAA", space: 1 } } }),
        ];
      case "list":
        return block.items.map(
          (item, i) =>
            new Paragraph({
              spacing: i === block.items.length - 1 ? SPACING.lastItem : SPACING.item,
              ...(block.ordered
                ? { children: [new TextRun(`${i + 1}. `), ...runs(item)] }
                : { bullet: { level: 0 }, children: runs(item) }),
            }),
        );
    }
  });

  const firstHeading = blocks.find((b) => b.type === "heading");
  const document = new Document({
    creator: "JobScratch",
    title: firstHeading?.type === "heading" ? `${inlinesToText(firstHeading.inlines)} – ${title}` : title,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 21 } },
        heading1: { run: { font: "Calibri", size: 36, bold: true, color: "111111" } },
        heading2: { run: { font: "Calibri", size: 24, bold: true, color: "222222", allCaps: true } },
        heading3: { run: { font: "Calibri", size: 22, bold: true, color: "222222" } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        children,
      },
    ],
  });
  return Packer.toBlob(document);
}
