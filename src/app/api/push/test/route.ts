import { notifyDevices, pushPublicKey } from "@/lib/push";
import { dataBackend, storageAvailability } from "@/lib/server-data";

export const maxDuration = 30;

/** POST /api/push/test → a test notification to every device that has them on. */
export async function POST(request: Request) {
  const backend = dataBackend(process.env);
  if (!backend || storageAvailability(process.env, backend) || !pushPublicKey(process.env)) {
    return Response.json({ error: "Notifications aren't set up on the server yet." }, { status: 409 });
  }
  const result = await notifyDevices(
    backend,
    process.env,
    { title: "JobScratch", body: "Notifications are on. The morning run's summary will arrive like this.", url: "/apply", tag: "test" },
    new URL(request.url).origin,
  );
  return Response.json(result);
}
