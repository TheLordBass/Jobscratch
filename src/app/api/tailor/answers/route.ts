import { z } from "zod";
import { draftAnswers, toAiError } from "@/lib/ai/claude";
import {
  ApplicationDetailsSchema,
  CandidateProfileSchema,
  ExtraSkillsSchema,
  JobNotesSchema,
  MAX_QUESTIONS,
  TailorJobSchema,
} from "@/lib/ai/prompts";

export const maxDuration = 300;

const Body = z.object({
  cv: z.string().min(50, "Add your CV first").max(60_000),
  job: TailorJobSchema,
  profile: CandidateProfileSchema.optional(),
  notes: JobNotesSchema,
  skills: ExtraSkillsSchema,
  questions: z.array(z.string().trim().min(3, "Write the question out").max(500)).min(1).max(MAX_QUESTIONS),
  details: ApplicationDetailsSchema.optional(),
});

/** Drafts answers to questions from a job's application form. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { questions, details, ...materials } = parsed.data;
  try {
    return Response.json({ answers: await draftAnswers(materials, questions, details, process.env, request.signal) });
  } catch (error) {
    const aiError = toAiError(error);
    return Response.json({ error: aiError.message }, { status: aiError.status });
  }
}
