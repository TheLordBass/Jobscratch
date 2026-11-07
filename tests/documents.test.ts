import { describe, expect, it } from "vitest";
import { extractCvText, CvParseError } from "@/lib/cv-parse";
import { markdownToDocx } from "@/lib/export-docx";
import {
  blocksToHtml,
  estimatePages,
  hasProjectSections,
  markdownToPlainText,
  parseInline,
  parseMarkdown,
  printableHtml,
  removeProjectSections,
} from "@/lib/markdown";

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
    expect(parseInline("**[Sales dashboard](https://x.dev)** and [*Blog*](https://b.dev)")).toEqual([
      { text: "Sales dashboard", bold: true, href: "https://x.dev" },
      { text: " and " },
      { text: "Blog", italic: true, href: "https://b.dev" },
    ]);
    const html = blocksToHtml(parseMarkdown(CV));
    expect(html).toContain('<a href="https://jane.example">my site</a>');
    expect(html).not.toContain("javascript:");
  });

  it("keeps lines that are written one under the other on their own lines", () => {
    const letter = "**Analyst** | Globex | London\n*March 2021 – Present*\n\nKind regards,\nJane Doe";
    const blocks = parseMarkdown(letter);
    expect(blocks).toHaveLength(2);
    expect(blocksToHtml(blocks)).toBe("<p><strong>Analyst</strong> | Globex | London<br><em>March 2021 – Present</em></p>\n<p>Kind regards,<br>Jane Doe</p>");
    expect(markdownToPlainText(letter)).toBe("Analyst | Globex | London\nMarch 2021 – Present\n\nKind regards,\nJane Doe");
  });

  it("works out how many printed pages a CV fills", () => {
    // Checked against a browser's print layout: within a few per cent, erring long.
    const role = (n: number) =>
      `### Analyst ${n}, Company ${n}\n*2019 – 2021*\n` +
      Array.from({ length: 4 }, () => "- Built automated SQL and Power BI reporting that cut weekly manual work by 30% and improved accuracy").join("\n");
    const cv = (roles: number) => `# Jane Doe\nManchester\n\n## Experience\n${Array.from({ length: roles }, (_, i) => role(i)).join("\n\n")}`;
    expect(estimatePages(cv(1))).toBeLessThan(0.5);
    expect(estimatePages(cv(3))).toBeGreaterThan(0.8);
    expect(estimatePages(cv(3))).toBeLessThan(1);
    expect(estimatePages(cv(8))).toBeGreaterThan(2);
    // A line break starts a new printed line.
    expect(estimatePages("a\nb\nc")).toBeGreaterThan(estimatePages("a b c"));
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

describe("removeProjectSections", () => {
  const TAILORED = `# Jane Doe
jane@example.com

## Profile
Data analyst who builds dashboards.

## Experience
### Analyst, Projects Ltd (2020–2025)
- Built dashboards

## Key projects
### [Sales dashboard](https://github.com/jane/sales)
- Power BI and Python

### Churn model
- scikit-learn

## Education
BSc Maths`;

  it("takes out the Projects section and everything under it", () => {
    expect(hasProjectSections(TAILORED)).toBe(true);
    const removed = removeProjectSections(TAILORED);
    expect(removed).not.toContain("Key projects");
    expect(removed).not.toContain("Sales dashboard");
    expect(removed).not.toContain("Churn model");
    // A job at a company called "Projects Ltd" stays, and so does what follows the section.
    expect(removed).toContain("### Analyst, Projects Ltd (2020–2025)\n- Built dashboards\n\n## Education\nBSc Maths");
    expect(hasProjectSections(removed)).toBe(false);
  });

  it("recognises other ways of naming the section", () => {
    for (const heading of ["## Projects", "## **Personal Projects:**", "### Projects & open source", "## Project experience"]) {
      expect(hasProjectSections(`# Jane\n\n${heading}\n- thing`)).toBe(true);
    }
    expect(hasProjectSections("# Projects\n\n## Experience")).toBe(false);
    expect(removeProjectSections("# Jane\n\n## Experience\n- led projects")).toBe("# Jane\n\n## Experience\n- led projects");
  });

  it("keeps work projects listed under a job", () => {
    const cv = "# Jane\n\n## Experience\n### Analyst, Globex\n#### Key projects\n- Data warehouse\n### Intern, Acme\n- Reports\n\n## Projects\n- Side app";
    expect(removeProjectSections(cv)).toBe("# Jane\n\n## Experience\n### Analyst, Globex\n#### Key projects\n- Data warehouse\n### Intern, Acme\n- Reports");
    expect(hasProjectSections(cv.replace("\n\n## Projects\n- Side app", ""))).toBe(false);
  });
});
