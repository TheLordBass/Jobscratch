import { z } from "zod";
import { analyzeMatch, toAiError } from "@/lib/ai/claude";
import { CandidateProfileSchema, ExtraSkillsSchema, JobNotesSchema, TailorJobSchema } from "@/lib/ai/prompts";
import { hasFullDescription } from "@/lib/candidate";

export const maxDuration = 300;

const Body = z.object({
  cv: z.string().min(50, "Add your CV first").max(60_000),
  job: TailorJobSchema,
  profile: CandidateProfileSchema.optional(),
  notes: JobNotesSchema,
  skills: ExtraSkillsSchema,
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (!hasFullDescription(parsed.data.job.description)) {
    return Response.json({ error: "This is only a snippet of the job description. Add the full description first." }, { status: 422 });
  }
  try {
    const analysis = await analyzeMatch(parsed.data, process.env, request.signal);
    return Response.json(analysis);
  } catch (error) {
    const aiError = toAiError(error);
    return Response.json({ error: aiError.message }, { status: aiError.status });
  }
}
