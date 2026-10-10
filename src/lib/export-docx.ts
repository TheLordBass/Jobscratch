import { inlinesToText, parseMarkdown, type Inline } from "@/lib/markdown";

/** Build a Word document from Claude's Markdown, entirely in the browser. */
export async function markdownToDocx(markdown: string, title: string): Promise<Blob> {
  const { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } =
    await import("docx");

  const runs = (inlines: Inline[]) =>
    inlines.map((inline) => {
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
            spacing: { before: block.level === 1 ? 0 : 200, after: 80 },
            border:
              block.level === 2
                ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: "AAAAAA", space: 2 } }
                : undefined,
            children: runs(block.inlines),
          }),
        ];
      }
      case "paragraph":
        return [new Paragraph({ spacing: { after: 120 }, children: runs(block.inlines) })];
      case "rule":
        return [
          new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "AAAAAA", space: 1 } } }),
        ];
      case "list":
        return block.items.map(
          (item, i) =>
            new Paragraph({
              spacing: { after: 60 },
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
        properties: { page: { margin: { top: 850, bottom: 850, left: 900, right: 900 } } },
        children,
      },
    ],
  });
  return Packer.toBlob(document);
}
