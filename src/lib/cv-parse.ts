import { tidyText } from "@/lib/text";

export const MAX_CV_BYTES = 5 * 1024 * 1024;

export class CvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CvParseError";
  }
}

type Kind = "pdf" | "docx" | "text";

function detectKind(fileName: string, mimeType: string, bytes: Uint8Array): Kind | undefined {
  const name = fileName.toLowerCase();
  if (name.endsWith(".pdf") || mimeType === "application/pdf" || String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-") {
    return "pdf";
  }
  if (name.endsWith(".docx") || mimeType.includes("wordprocessingml")) return "docx";
  if (/\.(txt|md|markdown|text)$/.test(name) || mimeType.startsWith("text/")) return "text";
  return undefined;
}

/** Extract plain text from a PDF, Word (.docx), Markdown or text CV. */
export async function extractCvText(fileName: string, mimeType: string, bytes: Uint8Array): Promise<string> {
  const kind = detectKind(fileName, mimeType, bytes);
  let text: string;
  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (kind === "docx") {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  } else if (kind === "text") {
    text = new TextDecoder().decode(bytes);
  } else if (fileName.toLowerCase().endsWith(".doc")) {
    throw new CvParseError("Old .doc files aren't supported. Save it as .docx or PDF, or paste the text.");
  } else {
    throw new CvParseError("Upload a PDF, Word (.docx), Markdown or text file.");
  }
  const cleaned = tidyText(text);
  if (cleaned.length < 50) {
    throw new CvParseError(
      kind === "pdf"
        ? "No text found in that PDF. It may be a scanned image. Paste your CV text instead."
        : "That file doesn't seem to contain any text.",
    );
  }
  return cleaned;
}
