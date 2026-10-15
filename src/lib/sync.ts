"use client";

import { useSyncExternalStore } from "react";
import {
  COLLECTION_KEYS,
  SINGLETON_KEYS,
  isCollectionKey,
  isTombstone,
  type CollectionKey,
  type SyncAvailability,
  type SyncKey,
  type SyncOp,
} from "@/lib/sync-types";

/*
 * Keeps this browser's data in step with server storage (/api/data), when
 * that's set up. The browser copy stays the one the app reads, so it's fast
 * and works offline; changes are sent shortly after they're made, and changes
 * from other devices are merged in when the app opens or comes back into view.
 */

export type SyncState =
  | { status: "checking" }
  | { status: "off"; reason: "not-configured" | "needs-password" | "unreachable" }
  | { status: "saved" | "saving" }
  | { status: "error"; message: string };

type Items = Record<string, unknown>;

interface StoreAccess {
  read: (key: SyncKey) => unknown;
  /** Write a value that came from the server, without sending it back. */
  apply: (key: SyncKey, value: unknown) => void;
}

const DEBOUNCE_MS = 1000;
const RETRY_MS = 15_000;
/** Stay well under the 4.5 MB request limit of a Vercel function. */
const MAX_REQUEST_CHARS = 3_000_000;

let store: StoreAccess | null = null;
let state: SyncState = { status: "checking" };
let enabled = false;
let started = false;
let lastSeen: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let flushing: Promise<void> | null = null;
const pendingValues = new Map<SyncKey, unknown>();
const pendingItems = new Map<CollectionKey, Items>();
const listeners = new Set<() => void>();

function setState(next: SyncState) {
  state = next;
  for (const listener of listeners) listener();
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function connectStore(access: StoreAccess) {
  store = access;
}

/** When an item last changed: jobs and documents have updatedAt, match scores have at. */
function changedAt(item: unknown): string {
  if (isTombstone(item)) return item.$deleted;
  const record = item as { updatedAt?: string; at?: string } | null;
  return record?.updatedAt ?? record?.at ?? "";
}

/**
 * Combine the server's and this browser's copy of a collection. For each item
 * the newer change wins, removals included (either side may hold a
 * tombstone). Returns the merged items and the changes the server lacks.
 */
export function mergeCollection(local: Items, remote: Items): { merged: Items; upload: Items } {
  const merged: Items = {};
  const upload: Items = {};
  for (const id of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const mine = local[id];
    const theirs = remote[id];
    const mineWins = theirs === undefined || (mine !== undefined && changedAt(mine) > changedAt(theirs));
    const winner = mineWins ? mine : theirs;
    if (!isTombstone(winner)) merged[id] = winner;
    if (mineWins) upload[id] = mine;
  }
  return { merged, upload };
}

/** Called by the store after every local change. */
export function queueChange(key: SyncKey, previous: unknown, next: unknown) {
  if (state.status === "off") return;
  if (isCollectionKey(key)) {
    const before = (previous ?? {}) as Items;
    const after = (next ?? {}) as Items;
    const items = pendingItems.get(key) ?? {};
    const now = new Date().toISOString();
    // The store replaces only the entries it changes, so unchanged ones are the same objects.
    for (const [id, item] of Object.entries(after)) if (before[id] !== item) items[id] = item;
    for (const id of Object.keys(before)) if (!(id in after)) items[id] = { $deleted: now };
    if (Object.keys(items).length) pendingItems.set(key, items);
  } else {
    pendingValues.set(key, next ?? null);
  }
  scheduleFlush(DEBOUNCE_MS);
}

function scheduleFlush(delay: number) {
  if (!enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), delay);
}

/** Pending changes as requests small enough to send. */
function takeBatches(): SyncOp[][] {
  const ops: SyncOp[] = [];
  for (const [key, value] of pendingValues) ops.push({ key, value } as SyncOp);
  for (const [key, items] of pendingItems) {
    let chunk: Items = {};
    let size = 0;
    for (const [id, item] of Object.entries(items)) {
      const length = JSON.stringify(item).length + id.length;
      if (size + length > MAX_REQUEST_CHARS && size > 0) {
        ops.push({ key, items: chunk });
        chunk = {};
        size = 0;
      }
      chunk[id] = item;
      size += length;
    }
    if (size > 0) ops.push({ key, items: chunk });
  }
  pendingValues.clear();
  pendingItems.clear();

  const batches: SyncOp[][] = [];
  let batch: SyncOp[] = [];
  let size = 0;
  for (const op of ops) {
    const length = JSON.stringify(op).length;
    if (batch.length && (size + length > MAX_REQUEST_CHARS || batch.length >= 50)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(op);
    size += length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** Put changes back in the queue after a failed request, without overwriting newer ones. */
function requeue(ops: SyncOp[]) {
  for (const op of ops) {
    if ("items" in op) {
      pendingItems.set(op.key, { ...op.items, ...pendingItems.get(op.key) });
    } else if (!pendingValues.has(op.key)) {
      pendingValues.set(op.key, op.value);
    }
  }
}

export function flush(): Promise<void> {
  if (!enabled) return Promise.resolve();
  if (flushing) return flushing.then(() => flush());
  if (pendingValues.size === 0 && pendingItems.size === 0) return Promise.resolve();
  clearTimeout(timer);
  flushing = (async () => {
    setState({ status: "saving" });
    const batches = takeBatches();
    for (let i = 0; i < batches.length; i++) {
      try {
        const response = await fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ops: batches[i] }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        lastSeen = data.updatedAt ?? lastSeen;
      } catch (error) {
        for (const unsent of batches.slice(i)) requeue(unsent);
        setState({ status: "error", message: (error as Error).message });
        scheduleFlush(RETRY_MS);
        return;
      }
    }
    setState({ status: "saved" });
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}

async function readCollection(key: CollectionKey): Promise<Items> {
  const items: Items = {};
  let cursor = "0";
  do {
    const page = await getJson<{ items: Items; cursor: string }>(`/api/data?key=${key}&cursor=${encodeURIComponent(cursor)}`);
    Object.assign(items, page.items);
    cursor = page.cursor;
  } while (cursor !== "0");
  return items;
}

/** Fetch everything from the server and merge it with this browser's copy. */
async function pull(updatedAt: string | null) {
  if (!store) return;
  const [values, collections] = await Promise.all([
    Promise.all(SINGLETON_KEYS.map((key) => getJson<{ value: unknown }>(`/api/data?key=${key}`).then((r) => r.value))),
    Promise.all(COLLECTION_KEYS.map((key) => readCollection(key))),
  ]);

  SINGLETON_KEYS.forEach((key, i) => {
    if (pendingValues.has(key)) return; // Changed here a moment ago: that wins.
    const remote = values[i];
    const local = store!.read(key);
    const newerHere =
      key === "cv" && local !== null && remote !== null &&
      ((local as { updatedAt?: string }).updatedAt ?? "") > ((remote as { updatedAt?: string }).updatedAt ?? "");
    if (remote === null || remote === undefined || newerHere) {
      if (local !== null && local !== undefined) pendingValues.set(key, local);
    } else if (JSON.stringify(remote) !== JSON.stringify(local)) {
      store!.apply(key, remote);
    }
  });

  COLLECTION_KEYS.forEach((key, i) => {
    // Changes waiting to be sent are the latest here, removals included.
    const local = { ...((store!.read(key) as Items | null) ?? {}), ...pendingItems.get(key) };
    const { merged, upload } = mergeCollection(local, collections[i]);
    if (JSON.stringify(merged) !== JSON.stringify(store!.read(key) ?? {})) store!.apply(key, merged);
    if (Object.keys(upload).length) pendingItems.set(key, { ...upload, ...pendingItems.get(key) });
  });

  lastSeen = updatedAt;
  await flush();
  if (state.status !== "error") setState({ status: "saved" });
}

async function checkForChanges() {
  try {
    await flush();
    const status = await getJson<SyncAvailability>("/api/data");
    if (status.enabled && status.updatedAt !== lastSeen) await pull(status.updatedAt);
  } catch {
    // Offline or the server is busy: try again next time.
  }
}

/** Starts syncing, once per page load. */
export function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  void (async () => {
    let status: SyncAvailability;
    try {
      status = await getJson<SyncAvailability>("/api/data");
    } catch {
      pendingValues.clear();
      pendingItems.clear();
      setState({ status: "off", reason: "unreachable" });
      return;
    }
    if (!status.enabled) {
      pendingValues.clear();
      pendingItems.clear();
      setState({ status: "off", reason: status.reason });
      return;
    }
    enabled = true;
    try {
      await pull(status.updatedAt);
    } catch (error) {
      setState({ status: "error", message: (error as Error).message });
      scheduleFlush(RETRY_MS);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void checkForChanges();
      else void flush();
    });
    window.addEventListener("online", () => void checkForChanges());
    window.addEventListener("pagehide", () => void flush());
  })();
}

/** Settings → Delete all data. */
export async function clearServerData(): Promise<void> {
  if (!enabled) return;
  pendingValues.clear();
  pendingItems.clear();
  const response = await fetch("/api/data", { method: "DELETE" });
  if (!response.ok) throw new Error(`Couldn't delete the data on the server (HTTP ${response.status}).`);
}

/** Settings → Restore backup: make the server hold exactly what this browser now has. */
export async function replaceServerData(): Promise<void> {
  if (!enabled || !store) return;
  await clearServerData();
  for (const key of SINGLETON_KEYS) {
    const value = store.read(key);
    if (value !== null && value !== undefined) pendingValues.set(key, value);
  }
  for (const key of COLLECTION_KEYS) {
    const items = (store.read(key) as Items | null) ?? {};
    if (Object.keys(items).length) pendingItems.set(key, items);
  }
  await flush();
  if (state.status === "error") throw new Error(`Couldn't save the backup to the server: ${state.message}`);
}

export function syncEnabled(): boolean {
  return enabled;
}

const CHECKING: SyncState = { status: "checking" };

/** The sync status, for the indicator in the navigation and Settings. */
export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, () => CHECKING);
}
