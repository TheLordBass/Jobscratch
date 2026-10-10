import { z } from "zod";
import { buildProfile } from "@/lib/profile";
import { MAX_GITHUB_LENGTH, MAX_WEBSITE_LENGTH } from "@/lib/profile/links";

export const maxDuration = 60;

const Body = z
  .object({
    website: z.string().max(MAX_WEBSITE_LENGTH, "That website link is too long").optional(),
    github: z.string().max(MAX_GITHUB_LENGTH, "That GitHub link is too long").optional(),
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
