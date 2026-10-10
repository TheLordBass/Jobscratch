import { z } from "zod";
import { buildProfile } from "@/lib/profile";

export const maxDuration = 60;

const Body = z
  .object({
    website: z.string().max(500).optional(),
    github: z.string().max(200).optional(),
  })
  .refine((body) => Boolean(body.website?.trim() || body.github?.trim()), "Add a website or a GitHub profile");

/** Reads the candidate's own website and public GitHub and returns them as text for tailoring. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  return Response.json(await buildProfile(parsed.data, process.env));
}
