import { promises as fs } from "node:fs";
import {
  SYNC_KEYS,
  type CollectionKey,
  type SingletonKey,
  type SyncAvailability,
  type SyncOp,
} from "@/lib/sync-types";

/*
 * Server storage for one person's JobScratch data, in Upstash Redis (added
 * from the Vercel Marketplace). Singletons are Redis strings; collections are
 * hashes with one field per job, so a change writes only the jobs it touched.
 */

const PREFIX = "jobscratch:";
const META_KEY = `${PREFIX}meta`;
const PAGE_SIZE = 200;

type Env = Record<string, string | undefined>;
type Command = string[];

export interface DataBackend {
  kind: "upstash" | "file";
  /** Runs Redis commands in order and returns each one's result. */
  run(commands: Command[]): Promise<unknown[]>;
}

/** Upstash's REST API: one pipeline request for any number of commands. */
function upstashBackend(url: string, token: string): DataBackend {
  return {
    kind: "upstash",
    async run(commands) {
      const response = await fetch(`${url.replace(/\/+$/, "")}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(commands),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Upstash returned HTTP ${response.status}`);
      const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
      return results.map((entry) => {
        if (entry.error) throw new Error(`Upstash: ${entry.error}`);
        return entry.result ?? null;
      });
    },
  };
}

interface FileData {
  strings: Record<string, string>;
  hashes: Record<string, Record<string, string>>;
}

/**
 * The same commands kept in a local JSON file, for trying server storage in
 * development without an Upstash account (JOBSCRATCH_DATA_FILE). Never used in
 * production, where the file system doesn't persist.
 */
export function fileBackend(path: string): DataBackend {
  let queue: Promise<unknown> = Promise.resolve();
  const load = async (): Promise<FileData> => {
    try {
      return JSON.parse(await fs.readFile(path, "utf8")) as FileData;
    } catch {
      return { strings: {}, hashes: {} };
    }
  };
  const runAll = async (commands: Command[]) => {
    const data = await load();
    let changed = false;
    const results = commands.map(([name, key, ...args]) => {
      switch (name) {
        case "GET":
          return data.strings[key] ?? null;
        case "SET":
          data.strings[key] = args[0];
          changed = true;
          return "OK";
        case "HSET": {
          const hash = (data.hashes[key] ??= {});
          for (let i = 0; i + 1 < args.length; i += 2) hash[args[i]] = args[i + 1];
          changed = true;
          return args.length / 2;
        }
        case "HSCAN": {
          const fields = Object.keys(data.hashes[key] ?? {}).sort();
          const start = Number(args[0]) || 0;
          const page = fields.slice(start, start + PAGE_SIZE);
          const next = start + PAGE_SIZE < fields.length ? String(start + PAGE_SIZE) : "0";
          return [next, page.flatMap((field) => [field, data.hashes[key][field]])];
        }
        case "DEL": {
          for (const name of [key, ...args]) {
            delete data.strings[name];
            delete data.hashes[name];
          }
          changed = true;
          return 1;
        }
        default:
          throw new Error(`Unsupported command ${name}`);
      }
    });
    if (changed) await fs.writeFile(path, JSON.stringify(data));
    return results;
  };
  return {
    kind: "file",
    // One command list at a time, so overlapping requests don't overwrite each other.
    run(commands) {
      const next = queue.then(() => runAll(commands));
      queue = next.catch(() => {});
      return next;
    },
  };
}

export function dataBackend(env: Env): DataBackend | undefined {
  const url = env.UPSTASH_REDIS_REST_URL?.trim() || env.KV_REST_API_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim() || env.KV_REST_API_TOKEN?.trim();
  if (url && token) return upstashBackend(url, token);
  const file = env.JOBSCRATCH_DATA_FILE?.trim();
  if (file && env.NODE_ENV !== "production") return fileBackend(file);
  return undefined;
}

/**
 * Server storage holds someone's CV, so it's only switched on behind the
 * site password (APP_PASSWORD, enforced by proxy.ts). The local file is the
 * exception: only whoever runs the dev server can reach it.
 */
export function storageAvailability(env: Env, backend = dataBackend(env)): Exclude<SyncAvailability, { enabled: true }> | null {
  if (!backend) return { enabled: false, reason: "not-configured" };
  if (backend.kind === "upstash" && !env.APP_PASSWORD) return { enabled: false, reason: "needs-password" };
  return null;
}

export async function readUpdatedAt(backend: DataBackend): Promise<string | null> {
  const [value] = await backend.run([["GET", META_KEY]]);
  return typeof value === "string" ? value : null;
}

export async function readValue(backend: DataBackend, key: SingletonKey): Promise<unknown> {
  const [raw] = await backend.run([["GET", PREFIX + key]]);
  return typeof raw === "string" ? JSON.parse(raw) : null;
}

/** One page of a collection; keep asking with the returned cursor until it's "0". */
export async function readItems(
  backend: DataBackend,
  key: CollectionKey,
  cursor = "0",
): Promise<{ items: Record<string, unknown>; cursor: string }> {
  const [result] = await backend.run([["HSCAN", PREFIX + key, cursor, "COUNT", String(PAGE_SIZE)]]);
  const [next, flat] = result as [string, string[]];
  const items: Record<string, unknown> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) items[flat[i]] = JSON.parse(flat[i + 1]);
  return { items, cursor: String(next) };
}

/** Applies changes from a browser and returns the new "last changed" time. */
export async function applyOps(backend: DataBackend, ops: SyncOp[], now = new Date().toISOString()): Promise<string> {
  const commands: Command[] = [];
  for (const op of ops) {
    if ("items" in op) {
      const fields = Object.entries(op.items).flatMap(([id, item]) => [id, JSON.stringify(item)]);
      if (fields.length) commands.push(["HSET", PREFIX + op.key, ...fields]);
    } else {
      commands.push(["SET", PREFIX + op.key, JSON.stringify(op.value ?? null)]);
    }
  }
  commands.push(["SET", META_KEY, now]);
  await backend.run(commands);
  return now;
}

/** Deletes everything (Settings → Delete all data, or before restoring a backup). */
export async function clearAll(backend: DataBackend, now = new Date().toISOString()): Promise<string> {
  await backend.run([
    ["DEL", ...SYNC_KEYS.map((key) => PREFIX + key)],
    ["SET", META_KEY, now],
  ]);
  return now;
}
