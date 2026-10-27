import { connection } from "next/server";
import { readRun, readRunJobs } from "@/lib/jobspy-runs";
import { readPrep } from "@/lib/morning-prep-server";
import { dataBackend, storageAvailability } from "@/lib/server-data";

export const maxDuration = 30;

/**
 * GET /api/jobspy-run              → the latest scheduled JobSpy run, or { run: null }, and how far its
 *                                    matching and getting jobs ready has got (prep), if it has started
 * GET /api/jobspy-run?cursor=0     → one page of its jobs; repeat with the returned cursor until "0"
 */
export async function GET(request: Request) {
  // The run changes every morning, so this must not be prerendered at build.
  await connection();
  const backend = dataBackend(process.env);
  if (!backend || storageAvailability(process.env, backend)) return Response.json({ run: null });
  const cursor = new URL(request.url).searchParams.get("cursor");
  try {
    if (cursor === null) {
      const [run, prep] = await Promise.all([readRun(backend), readPrep(backend)]);
      return Response.json({ run, prep: run && prep?.runId === run.id ? prep : null });
    }
    if (!/^\d+$/.test(cursor)) return Response.json({ error: "Bad cursor" }, { status: 400 });
    return Response.json(await readRunJobs(backend, cursor));
  } catch (error) {
    console.error("Couldn't read the JobSpy run", error);
    return Response.json({ error: "Couldn't read this morning's run from the server." }, { status: 502 });
  }
}
