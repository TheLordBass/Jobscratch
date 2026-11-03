import { z } from "zod";
import { cancelMatchBatch, readMatchBatch, submitMatchBatch, toAiError } from "@/lib/ai/claude";
import { CandidateCvSchema, CandidateProfileSchema, ExtraSkillsSchema, JobNotesSchema, TailorJobSchema } from "@/lib/ai/prompts";
import { MAX_CVS } from "@/lib/cvs";
import { MATCH_BATCH_SIZE, hasFullDescription } from "@/lib/candidate";

export const maxDuration = 60;

const Body = z.object({
  cv: z.string().min(50, "Add your CV first").max(60_000),
  cvs: z.array(CandidateCvSchema).min(2).max(MAX_CVS).optional(),
  profile: CandidateProfileSchema.optional(),
  skills: ExtraSkillsSchema,
  jobs: z
    .array(z.object({ customId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), job: TailorJobSchema, notes: JobNotesSchema }))
    .min(1)
    .max(MATCH_BATCH_SIZE),
});

const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);

function failed(error: unknown) {
  const aiError = toAiError(error);
  return Response.json({ error: aiError.message }, { status: aiError.status });
}

/*
 * Match all from a phone (lib/match-batches.ts): the analyses go to Claude as one batch, so they carry
 * on while the phone has the app in the background, and the phone reads them back when it's open.
 */

/** POST: sends the jobs; answers with the batch's id. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { jobs, ...candidate } = parsed.data;
  if (jobs.some(({ job }) => !hasFullDescription(job.description))) {
    return Response.json({ error: "Only jobs with a full description can be matched." }, { status: 422 });
  }
  try {
    const id = await submitMatchBatch(
      jobs.map(({ customId, job, notes }) => ({ customId, materials: { ...candidate, job, notes } })),
      process.env,
    );
    return Response.json({ id });
  } catch (error) {
    return failed(error);
  }
}

/** GET ?id=: { done: false } while Claude's working on it, then each job's analysis or error. */
export async function GET(request: Request) {
  const id = Id.safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "Which batch?" }, { status: 400 });
  try {
    const outcomes = await readMatchBatch(id.data, process.env);
    if (!outcomes) return Response.json({ done: false });
    return Response.json({
      done: true,
      outcomes: Object.fromEntries(
        Object.entries(outcomes).map(([customId, outcome]) => [customId, "error" in outcome ? { error: outcome.error.message } : outcome]),
      ),
    });
  } catch (error) {
    return failed(error);
  }
}

/** DELETE ?id=: stops it; what it finished first still comes back. */
export async function DELETE(request: Request) {
  const id = Id.safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "Which batch?" }, { status: 400 });
  try {
    await cancelMatchBatch(id.data, process.env);
    return Response.json({ ok: true });
  } catch (error) {
    return failed(error);
  }
}
