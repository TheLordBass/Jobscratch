import { after } from "next/server";
import { matchStep, startStep } from "@/lib/match-queue-server";
import { dataBackend, storageAvailability } from "@/lib/server-data";

// A step stops starting analyses after three minutes, so the last ones finish well inside this.
export const maxDuration = 300;

/**
 * POST: one step of the server's Match all (lib/match-queue-server.ts), done after answering so the
 * request that started it isn't kept waiting. When jobs are still waiting, it starts the next.
 */
export async function POST(request: Request) {
  const backend = dataBackend(process.env);
  if (!backend || storageAvailability(process.env, backend)) {
    return Response.json({ error: "Server storage is off." }, { status: 409 });
  }
  after(async () => {
    try {
      const { more } = await matchStep(backend, process.env);
      if (more) await startStep(request);
    } catch (error) {
      console.error("A matching step failed", error);
    }
  });
  return Response.json({ started: true }, { status: 202 });
}
