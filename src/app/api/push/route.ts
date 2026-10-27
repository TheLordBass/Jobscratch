import { connection } from "next/server";
import { z } from "zod";
import { listDevices, pushPublicKey, removeDevice, saveDevice, SubscriptionSchema } from "@/lib/push";
import { dataBackend, storageAvailability, type DataBackend } from "@/lib/server-data";

export const maxDuration = 30;

function open(): DataBackend | Response {
  const backend = dataBackend(process.env);
  if (!backend || storageAvailability(process.env, backend)) {
    return Response.json({ error: "Notifications need server storage (see the README)." }, { status: 409 });
  }
  return backend;
}

/** GET /api/push → whether notifications are set up, the key a browser subscribes with, and how many devices have them on. */
export async function GET() {
  await connection();
  const publicKey = pushPublicKey(process.env);
  const backend = dataBackend(process.env);
  const storage = Boolean(backend && !storageAvailability(process.env, backend));
  const devices = storage && backend && publicKey ? (await listDevices(backend).catch(() => [])).map((device) => device.label) : [];
  return Response.json({ publicKey: publicKey ?? null, storage, devices });
}

const Add = z.object({ subscription: SubscriptionSchema, label: z.string().max(80).default("A device") });

/** POST /api/push { subscription, label } → this device gets notifications. */
export async function POST(request: Request) {
  const backend = open();
  if (backend instanceof Response) return backend;
  if (!pushPublicKey(process.env)) return Response.json({ error: "Notifications aren't set up on the server yet." }, { status: 409 });
  const parsed = Add.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That isn't a push subscription." }, { status: 400 });
  await saveDevice(backend, parsed.data.subscription, parsed.data.label);
  return Response.json({ ok: true });
}

const Remove = z.object({ endpoint: z.url().max(2000) });

/** DELETE /api/push { endpoint } → this device stops getting them. */
export async function DELETE(request: Request) {
  const backend = open();
  if (backend instanceof Response) return backend;
  const parsed = Remove.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Which device?" }, { status: 400 });
  await removeDevice(backend, parsed.data.endpoint);
  return Response.json({ ok: true });
}
