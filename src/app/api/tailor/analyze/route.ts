import { z } from "zod";
import { analyzeMatch, toAiError } from "@/lib/ai/claude";
import { TailorJobSchema } from "@/lib/ai/prompts";

export const maxDuration = 300;

const Body = z.object({
  cv: z.string().min(50, "Add your CV first").max(60_000),
  job: TailorJobSchema,
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  try {
    const analysis = await analyzeMatch(parsed.data.cv, parsed.data.job, process.env, request.signal);
    return Response.json(analysis);
  } catch (error) {
    const aiError = toAiError(error);
    return Response.json({ error: aiError.message }, { status: aiError.status });
  }
}
