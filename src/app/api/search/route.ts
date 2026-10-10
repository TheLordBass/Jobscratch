import { z } from "zod";
import { runSearch } from "@/lib/search";
import { SOURCE_IDS } from "@/lib/types";

export const maxDuration = 60;

const boardList = z.array(z.string().max(300)).max(50).default([]);

const SearchRequestSchema = z.object({
  keywords: z.array(z.string().max(120)).min(1).max(15),
  exclude: z.array(z.string().max(120)).max(30).optional(),
  location: z.string().max(120).optional(),
  country: z
    .string()
    .regex(/^[a-z]{2}$/i)
    .optional(),
  remoteOnly: z.boolean().optional(),
  includeRemoteAnywhere: z.boolean().optional(),
  postedWithinDays: z.number().int().min(0).max(365).optional(),
  sources: z.array(z.enum(SOURCE_IDS)).optional(),
  companyBoards: z
    .object({ greenhouse: boardList, lever: boardList, ashby: boardList })
    .optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = SearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid search", issues: z.treeifyError(parsed.error) }, { status: 400 });
  }
  const result = await runSearch(parsed.data, { env: process.env });
  return Response.json(result);
}
