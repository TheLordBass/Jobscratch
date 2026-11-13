import { cleanUp, dataBackend, storageAvailability } from "@/lib/server-data";

export const maxDuration = 60;

/**
 * POST /api/data/cleanup → clears old match scores and tailored documents for jobs that aren't
 * saved (lib/cleanup.ts). A browser asks once a day, after it has synced.
 */
export async function POST() {
  const backend = dataBackend(process.env);
  if (storageAvailability(process.env, backend) || !backend) {
    return Response.json({ error: "Server storage is off." }, { status: 409 });
  }
  try {
    return Response.json({ cleared: await cleanUp(backend) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
