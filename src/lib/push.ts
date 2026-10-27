import { createHash } from "node:crypto";
import webpush from "web-push";
import { z } from "zod";
import { PUSH_KEY, readHash, type DataBackend } from "@/lib/server-data";

/*
 * Notifications on your phone or computer (Web Push), e.g. the morning run's summary. Each device that
 * turns them on (lib/push-client.ts) gives the browser's push address, kept in server storage. The
 * keys that sign the messages are JOBSCRATCH_VAPID_PUBLIC_KEY and JOBSCRATCH_VAPID_PRIVATE_KEY,
 * made once with `npx web-push generate-vapid-keys` (see the README). No other service is involved:
 * each message goes through the browser maker's own push service (Google, Apple, Mozilla).
 */

type Env = Record<string, string | undefined>;

export const SubscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  expirationTime: z.number().nullish(),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export type PushSubscriptionJson = z.infer<typeof SubscriptionSchema>;

export interface PushDevice {
  subscription: PushSubscriptionJson;
  /** "Android phone", "Windows computer": what turned them on, for Settings. */
  label: string;
  addedAt: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it opens, e.g. "/apply". */
  url: string;
  /** A newer message with the same tag replaces the older one. */
  tag?: string;
}

export function pushPublicKey(env: Env): string | undefined {
  const publicKey = env.JOBSCRATCH_VAPID_PUBLIC_KEY?.trim();
  return publicKey && env.JOBSCRATCH_VAPID_PRIVATE_KEY?.trim() ? publicKey : undefined;
}

const deviceId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);

export async function saveDevice(backend: DataBackend, subscription: PushSubscriptionJson, label: string, now = new Date().toISOString()) {
  const device: PushDevice = { subscription, label: label.slice(0, 80), addedAt: now };
  await backend.run([["HSET", PUSH_KEY, deviceId(subscription.endpoint), JSON.stringify(device)]]);
}

export async function removeDevice(backend: DataBackend, endpoint: string) {
  await backend.run([["HDEL", PUSH_KEY, deviceId(endpoint)]]);
}

export async function listDevices(backend: DataBackend): Promise<PushDevice[]> {
  return Object.values(await readHash<PushDevice>(backend, PUSH_KEY));
}

type Send = (subscription: PushSubscriptionJson, payload: string, options: webpush.RequestOptions) => Promise<unknown>;

/**
 * Sends a message to every device that asked for them. A device whose browser has since dropped
 * the subscription (it was turned off, or the app removed) is forgotten.
 */
export async function notifyDevices(
  backend: DataBackend,
  env: Env,
  message: PushMessage,
  /** Who's sending, for the push services: the site's address unless JOBSCRATCH_VAPID_SUBJECT says otherwise. */
  origin: string,
  send: Send = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options),
): Promise<{ sent: number; failed: number }> {
  const publicKey = pushPublicKey(env);
  if (!publicKey) return { sent: 0, failed: 0 };
  const options: webpush.RequestOptions = {
    vapidDetails: {
      subject: env.JOBSCRATCH_VAPID_SUBJECT?.trim() || origin,
      publicKey,
      privateKey: env.JOBSCRATCH_VAPID_PRIVATE_KEY!.trim(),
    },
    // Kept for half a day if the phone is off, then dropped: by then it's old news.
    TTL: 12 * 3600,
  };
  let sent = 0;
  let failed = 0;
  for (const device of await listDevices(backend)) {
    try {
      await send(device.subscription, JSON.stringify(message), options);
      sent++;
    } catch (error) {
      failed++;
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await removeDevice(backend, device.subscription.endpoint);
      else console.error("Couldn't send a notification", status ?? error);
    }
  }
  return { sent, failed };
}
