import { describe, expect, it } from "vitest";
import { extractCvText, CvParseError } from "@/lib/cv-parse";
import { markdownToDocx } from "@/lib/export-docx";
import { blocksToHtml, parseInline, parseMarkdown, printableHtml } from "@/lib/markdown";

const CV = `# Jane Doe
jane@example.com | London | linkedin.com/in/janedoe

## Profile
Data analyst with **5 years** of experience in *retail* analytics.

## Experience
### Analyst, Globex (2020–2025)
- Built dashboards in Power BI
- Cut reporting time by 40%
  across four teams

1. First
2. Second

---
Visit [my site](https://jane.example) or [bad](javascript:alert(1)).`;

describe("parseMarkdown", () => {
  it("parses the structures Claude produces", () => {
    const blocks = parseMarkdown(CV);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "heading",
      "heading",
      "list",
      "list",
      "rule",
      "paragraph",
    ]);
    const bullets = blocks[6];
    expect(bullets).toMatchObject({ type: "list", ordered: false });
    if (bullets.type === "list") expect(bullets.items[1][0].text).toBe("Cut reporting time by 40% across four teams");
    expect(blocks[7]).toMatchObject({ type: "list", ordered: true });
  });

  it("parses inline formatting and only keeps safe links", () => {
    expect(parseInline("A **bold** and *italic* and snake_case_name")).toEqual([
      { text: "A " },
      { text: "bold", bold: true },
      { text: " and " },
      { text: "italic", italic: true },
      { text: " and snake_case_name" },
    ]);
    const html = blocksToHtml(parseMarkdown(CV));
    expect(html).toContain('<a href="https://jane.example">my site</a>');
    expect(html).not.toContain("javascript:");
  });

  it("unwraps a fenced document and escapes HTML", () => {
    const html = printableHtml("CV <x>", "```markdown\n# Name <script>\n```");
    expect(html).toContain("<h1>Name &lt;script&gt;</h1>");
    expect(html).toContain("<title>CV &lt;x&gt;</title>");
  });
});

describe("CV files", () => {
  it("round-trips a tailored CV through .docx export and upload parsing", async () => {
    const blob = await markdownToDocx(CV, "Data Analyst at Globex");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = await extractCvText("cv.docx", blob.type, bytes);
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Built dashboards in Power BI");
    expect(text).toContain("5 years");
  });

  it("reads text from a PDF", async () => {
    const text = await extractCvText("cv.pdf", "application/pdf", minimalPdf("Jane Doe - Senior Data Analyst with SQL and Python"));
    expect(text).toContain("Jane Doe - Senior Data Analyst with SQL and Python");
  });

  it("explains unsupported or empty files", async () => {
    await expect(extractCvText("cv.doc", "application/msword", new Uint8Array([1, 2]))).rejects.toThrow(/\.docx/);
    await expect(extractCvText("photo.png", "image/png", new Uint8Array([1]))).rejects.toBeInstanceOf(CvParseError);
    await expect(extractCvText("cv.txt", "text/plain", new TextEncoder().encode("hi"))).rejects.toThrow(/text/);
  });
});

/** Build a one-page PDF with a single line of text (offsets computed so the xref is valid). */
function minimalPdf(line: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
