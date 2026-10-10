import { extractCvText, CvParseError, MAX_CV_BYTES } from "@/lib/cv-parse";

export const maxDuration = 30;

/** Accepts a multipart upload (field "file") and returns the CV as plain text. */
export async function POST(request: Request) {
  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return Response.json({ error: "Upload a file in the \"file\" field" }, { status: 400 });
  }
  if (!file) return Response.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_CV_BYTES) return Response.json({ error: "That file is larger than 5 MB" }, { status: 413 });

  try {
    const text = await extractCvText(file.name, file.type, new Uint8Array(await file.arrayBuffer()));
    return Response.json({ text, fileName: file.name });
  } catch (error) {
    if (error instanceof CvParseError) return Response.json({ error: error.message }, { status: 422 });
    console.error("CV parse failed", error);
    return Response.json({ error: "Couldn't read that file. Try a different format or paste the text." }, { status: 422 });
  }
}
