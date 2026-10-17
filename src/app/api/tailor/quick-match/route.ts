import { z } from "zod";
import { quickMatch, toAiError } from "@/lib/ai/claude";
import { CandidateProfileSchema, TailorJobSchema } from "@/lib/ai/prompts";
import { hasFullDescription } from "@/lib/candidate";

export const maxDuration = 60;

const Body = z.object({
  cv: z.string().min(50, "Add your CV first").max(60_000),
  job: TailorJobSchema,
  profile: CandidateProfileSchema.optional(),
});

/** A quick match score for one job. "Match all" calls this once per job. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (!hasFullDescription(parsed.data.job.description)) {
    return Response.json({ error: "This is only a snippet of the job description. Add the full description first." }, { status: 422 });
  }
  try {
    const match = await quickMatch(parsed.data, process.env, request.signal);
    return Response.json(match);
  } catch (error) {
    const aiError = toAiError(error);
    return Response.json({ error: aiError.message }, { status: aiError.status });
  }
}
