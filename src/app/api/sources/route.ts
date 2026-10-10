import { connection } from "next/server";
import { isAiConfigured } from "@/lib/ai/claude";
import { describeSources } from "@/lib/sources";
import type { SourcesResponse } from "@/lib/types";

export async function GET() {
  // API keys are read at request time, so this must not be prerendered at build.
  await connection();
  const body: SourcesResponse = {
    sources: describeSources(process.env),
    aiConfigured: isAiConfigured(process.env),
  };
  return Response.json(body);
}
