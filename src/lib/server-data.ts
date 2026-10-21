import { promises as fs } from "node:fs";
import { createClient } from "redis";
import {
  SYNC_KEYS,
  type CollectionKey,
  type SingletonKey,
  type SyncAvailability,
  type SyncOp,
} from "@/lib/sync-types";

/*
 * Server storage for one person's JobScratch data, in Redis added from the Vercel
 * Marketplace: "Upstash for Redis" (over its REST API) or "Redis" (over a redis:// connection).
 * Singletons are Redis strings; collections are hashes with one field per job, so a change
 * writes only the jobs it touched.
 */

const PREFIX = "jobscratch:";
const META_KEY = `${PREFIX}meta`;
const PAGE_SIZE = 200;

type Env = Record<string, string | undefined>;
type Command = string[];

export interface DataBackend {
  kind: "upstash" | "redis" | "file";
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

/**
 * The Upstash REST address and token. Vercel names them KV_REST_API_URL / _TOKEN, or with a prefix
 * chosen when the database was connected (e.g. STORAGE_KV_REST_API_URL); Upstash's own are
 * UPSTASH_REDIS_REST_URL / _TOKEN. (The read-only token can't save, so it's never used.)
 */
export function upstashCredentials(env: Env): { url: string; token: string } | undefined {
  const pairs: Array<[string, string]> = [
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ];
  for (const name of Object.keys(env).sort()) {
    for (const suffix of ["_KV_REST_API_URL", "_UPSTASH_REDIS_REST_URL"]) {
      if (name.endsWith(suffix) && name !== suffix.slice(1)) pairs.push([name, name.replace(/_URL$/, "_TOKEN")]);
    }
  }
  for (const [urlName, tokenName] of pairs) {
    const url = env[urlName]?.trim();
    const token = env[tokenName]?.trim();
    if (url && token) return { url, token };
  }
  return undefined;
}

/**
 * A redis:// address: what Vercel's "Redis" database (as opposed to "Upstash for Redis") gives,
 * as REDIS_URL or with a prefix (e.g. STORAGE_REDIS_URL); Upstash's KV_URL is one too.
 */
export function redisUrl(env: Env): string | undefined {
  const names = ["REDIS_URL", "KV_URL", ...Object.keys(env).sort().filter((name) => /_(REDIS|KV)_URL$/.test(name))];
  for (const name of names) {
    const value = env[name]?.trim();
    if (value && /^rediss?:\/\//i.test(value)) return value;
  }
  return undefined;
}

/** All the app needs from a Redis connection. */
interface RedisConnection {
  sendCommand(command: string[]): Promise<unknown>;
}
const redisClients = new Map<string, Promise<RedisConnection>>();

/**
 * A Redis server over its own protocol. The connection is kept between requests while the
 * function stays warm, and the commands of one call are pipelined in order.
 */
export function redisBackend(url: string, connect: (url: string) => Promise<RedisConnection> = connectRedis): DataBackend {
  return {
    kind: "redis",
    async run(commands) {
      let client = redisClients.get(url);
      if (!client) {
        client = connect(url);
        redisClients.set(url, client);
        // A failed connection is retried on the next request.
        client.catch(() => redisClients.delete(url));
      }
      const ready = await client;
      return Promise.all(commands.map((command) => ready.sendCommand(command)));
    },
  };
}

async function connectRedis(url: string): Promise<RedisConnection> {
  const client = createClient({ url, socket: { connectTimeout: 10_000 } });
  // Errors after connecting (e.g. an idle connection being closed) show up on the next command instead.
  client.on("error", () => {});
  await client.connect();
  return { sendCommand: (command) => client.sendCommand(command) };
}

export function dataBackend(env: Env): DataBackend | undefined {
  const upstash = upstashCredentials(env);
  if (upstash) return upstashBackend(upstash.url, upstash.token);
  const redis = redisUrl(env);
  if (redis) return redisBackend(redis);
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
  if (backend.kind !== "file" && !env.APP_PASSWORD) return { enabled: false, reason: "needs-password" };
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
