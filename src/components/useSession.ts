"use client";

import { useEffect, useState } from "react";
import { replaceLocalData } from "@/lib/store";
import { flush, getSyncState, syncEnabled } from "@/lib/sync";

export interface SessionInfo {
  /** Whether the site has a password (APP_PASSWORD). */
  enabled: boolean;
  signedIn?: boolean;
  username?: string;
}

let request: Promise<SessionInfo> | null = null;

/** Whether sign-in is on and this browser is signed in. Asked once per page load. */
export function useSession(): SessionInfo | null {
  const [session, setSession] = useState<SessionInfo | null>(null);
  useEffect(() => {
    let active = true;
    request ??= fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.json() as Promise<SessionInfo>);
    request
      .then((result) => {
        if (active) setSession(result);
      })
      .catch(() => {
        request = null;
      });
    return () => {
      active = false;
    };
  }, []);
  return session;
}

/**
 * Signs out. When your data is also on the server, this browser's copy is
 * removed too, so someone using the computer after you can't see it; it comes
 * back when you sign in again. Without server storage it stays, as it's the
 * only copy.
 */
export async function signOut(): Promise<void> {
  if (syncEnabled()) {
    await flush();
    if (getSyncState().status !== "error") await replaceLocalData();
  }
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.replace("/login");
}
