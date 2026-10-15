import { z } from "zod";
import {
  applyOps,
  clearAll,
  dataBackend,
  readItems,
  readUpdatedAt,
  readValue,
  storageAvailability,
  type DataBackend,
} from "@/lib/server-data";
import { COLLECTION_KEYS, SINGLETON_KEYS, SyncOpSchema, isCollectionKey, type SyncAvailability } from "@/lib/sync-types";

export const maxDuration = 30;

const Body = z.object({ ops: z.array(SyncOpSchema).min(1).max(50) });

/** The backend, or a response saying why server storage is off. */
function open(): DataBackend | Response {
  const backend = dataBackend(process.env);
  const unavailable = storageAvailability(process.env, backend);
  if (unavailable || !backend) return Response.json(unavailable ?? { enabled: false, reason: "not-configured" });
  return backend;
}

/**
 * GET /api/data                      → whether server storage is on, and when the data last changed
 * GET /api/data?key=cv                → one value
 * GET /api/data?key=saved&cursor=0    → one page of a collection; repeat with the returned cursor until "0"
 */
export async function GET(request: Request) {
  const backend = open();
  if (backend instanceof Response) return backend;
  const params = new URL(request.url).searchParams;
  const key = params.get("key");
  try {
    if (!key) {
      const status: SyncAvailability = { enabled: true, updatedAt: await readUpdatedAt(backend) };
      return Response.json(status);
    }
    if (isCollectionKey(key)) return Response.json(await readItems(backend, key, params.get("cursor") ?? "0"));
    if ((SINGLETON_KEYS as readonly string[]).includes(key)) {
      return Response.json({ value: await readValue(backend, key as (typeof SINGLETON_KEYS)[number]) });
    }
    return Response.json({ error: `Unknown key. Use one of: ${[...SINGLETON_KEYS, ...COLLECTION_KEYS].join(", ")}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}

/** POST /api/data  { ops: [...] } → saves changes from a browser. */
export async function POST(request: Request) {
  const backend = open();
  if (backend instanceof Response) return Response.json({ error: "Server storage is off." }, { status: 409 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid changes" }, { status: 400 });
  try {
    return Response.json({ updatedAt: await applyOps(backend, parsed.data.ops) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}

/** DELETE /api/data → removes everything stored on the server. */
export async function DELETE() {
  const backend = open();
  if (backend instanceof Response) return Response.json({ error: "Server storage is off." }, { status: 409 });
  try {
    return Response.json({ updatedAt: await clearAll(backend) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
