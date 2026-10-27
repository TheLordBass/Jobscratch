"use client";

/*
 * Turning notifications on or off for this device (lib/push.ts sends them). The browser asks first,
 * then gives a push address that only works for this site, which is kept in server storage.
 */

export interface PushStatus {
  /** The key browsers subscribe with; null until JOBSCRATCH_VAPID_* are set on the server. */
  publicKey: string | null;
  storage: boolean;
  /** The devices that have them on, e.g. "Android phone". */
  devices: string[];
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** An iPhone or iPad only gets them once JobScratch is added to the home screen and opened from there. */
export function needsHomeScreen(): boolean {
  if (typeof window === "undefined") return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

function deviceLabel(): string {
  const agent = navigator.userAgent;
  const kind = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? /Mobile/.test(agent)
          ? "Android phone"
          : "Android tablet"
        : /Windows/.test(agent)
          ? "Windows computer"
          : /Mac/.test(agent)
            ? "Mac"
            : "Computer";
  return kind;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function send(method: "POST" | "DELETE", url: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export async function fetchPushStatus(): Promise<PushStatus | null> {
  try {
    const response = await fetch("/api/push", { cache: "no-store" });
    return response.ok ? ((await response.json()) as PushStatus) : null;
  } catch {
    return null;
  }
}

/** This device's subscription, if it has notifications on. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function turnOnPush(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications are blocked for this site. Allow them in the browser's site settings, then try again.");
  }
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await send("POST", "/api/push", { subscription: subscription.toJSON(), label: deviceLabel() });
}

export async function turnOffPush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await send("DELETE", "/api/push", { endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe();
}

export async function sendTestPush(): Promise<{ sent: number; failed: number }> {
  return send("POST", "/api/push/test", {});
}
