"use client";

import { useSessionState } from "@/lib/session-state";
import type { SearchResponse } from "@/lib/types";

/** The search on Find jobs: kept for the session (lib/session-state.ts), so one still running when you leave lands here. */
export type SearchState =
  | { status: "idle" }
  | { status: "loading"; label: string }
  | { status: "done"; label: string; response: SearchResponse }
  | { status: "error"; message: string };

const IDLE: SearchState = { status: "idle" };
const INTERRUPTED: SearchState = { status: "error", message: "The search was stopped when the page reloaded. Search again." };

let latest = 0;

export function useSearchState(): [SearchState, (value: SearchState | ((previous: SearchState) => SearchState)) => void] {
  const [search, setSearch] = useSessionState<SearchState>("search:state", IDLE);
  // Kept from before a reload, which stopped it: nothing will finish it now.
  return [search.status === "loading" && latest === 0 ? INTERRUPTED : search, setSearch];
}

/** Numbers each search, so one that finishes after a newer one was started doesn't replace its results. */
export function nextSearch(): () => boolean {
  const id = ++latest;
  return () => id === latest;
}
