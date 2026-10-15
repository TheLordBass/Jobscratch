import { z } from "zod";

/*
 * What's kept on the server when server storage is set up. Shared by the
 * browser (lib/sync.ts) and the server (lib/server-data.ts).
 */

/** Stored as one value each. */
export const SINGLETON_KEYS = ["cv", "profile", "settings", "groups"] as const;
/** Stored item by item (keyed by job id), so a change sends only what changed. */
export const COLLECTION_KEYS = ["saved", "tailored", "matches"] as const;
export const SYNC_KEYS = [...SINGLETON_KEYS, ...COLLECTION_KEYS] as const;

export type SingletonKey = (typeof SINGLETON_KEYS)[number];
export type CollectionKey = (typeof COLLECTION_KEYS)[number];
export type SyncKey = SingletonKey | CollectionKey;

export function isCollectionKey(key: string): key is CollectionKey {
  return (COLLECTION_KEYS as readonly string[]).includes(key);
}

/** Left in place of a removed item, so another device doesn't bring it back. */
export interface Tombstone {
  $deleted: string;
}

export function isTombstone(value: unknown): value is Tombstone {
  return typeof value === "object" && value !== null && typeof (value as Tombstone).$deleted === "string";
}

export const SyncOpSchema = z.union([
  z.object({ key: z.enum(SINGLETON_KEYS), value: z.unknown() }),
  z.object({ key: z.enum(COLLECTION_KEYS), items: z.record(z.string().min(1).max(500), z.unknown()) }),
]);

export type SyncOp = z.infer<typeof SyncOpSchema>;

/** Whether server storage is on, and why not when it's off. */
export type SyncAvailability =
  | { enabled: true; updatedAt: string | null }
  | { enabled: false; reason: "not-configured" | "needs-password" };
