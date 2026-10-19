import { z } from "zod";
import { streamDocument } from "@/lib/ai/claude";
import {
  CandidateProfileSchema,
  ExtraSkillsSchema,
  JobNotesSchema,
  TailorJobSchema,
  TailorOptionsSchema,
} from "@/lib/ai/prompts";

export const maxDuration = 300;

const Body = z.object({
  kind: z.enum(["cv", "cover-letter"]),
  cv: z.string().min(50, "Add your CV first").max(60_000),
  job: TailorJobSchema,
  profile: CandidateProfileSchema.optional(),
  notes: JobNotesSchema,
  skills: ExtraSkillsSchema,
  options: TailorOptionsSchema.default({
    style: "uk-cv",
    tone: "professional",
    length: "two-pages",
    extraInstructions: "",
  }),
});

/** Streams newline-delimited JSON events: thinking / text / notice / done / error. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { kind, cv, job, profile, notes, skills, options } = parsed.data;
  const encoder = new TextEncoder();
  const events = streamDocument(kind, { cv, job, profile, notes, skills }, options, process.env, request.signal);

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await events.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
    },
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
