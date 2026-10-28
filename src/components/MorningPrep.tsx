"use client";

import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { useSources } from "@/components/useSources";
import { MATCH_LIMITS, READY_FROM, READY_LIMITS, type MorningPrepSettings } from "@/lib/morning-prep";
import {
  currentSubscription,
  fetchPushStatus,
  needsHomeScreen,
  pushSupported,
  sendTestPush,
  turnOffPush,
  turnOnPush,
  type PushStatus,
} from "@/lib/push-client";
import { useCv, useHydrated, useSettings } from "@/lib/store";

/**
 * In Add a job > From JobSpy: what the morning run does with its jobs before you're up (see
 * lib/morning-prep.ts). Saved with the settings, which the run reads from server storage.
 */
export function MorningPrep() {
  const hydrated = useHydrated();
  const [settings, setSettings] = useSettings();
  const [cv] = useCv();
  const sources = useSources();
  const prep = settings.morningPrep;
  const set = (patch: Partial<MorningPrepSettings>) =>
    setSettings((previous) => ({ ...previous, morningPrep: { ...previous.morningPrep, ...patch } }));

  if (!hydrated) return null;
  const requests =
    (prep.match ? prep.matchLimit : 0) + (prep.ready ? prep.readyLimit * (1 + Number(prep.coverLetters) + Number(prep.answers)) : 0);
  const noCv = (cv?.text.trim().length ?? 0) < 50;
  const noAi = sources !== null && !sources.aiConfigured;

  return (
    <details className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800" open={prep.match || prep.ready || undefined}>
      <summary className="cursor-pointer text-sm font-semibold">
        Before you’re up{(prep.match || prep.ready) && <span className="muted font-normal"> (on)</span>}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="muted">
          After the morning run finds its jobs, JobScratch can score them against your CV and get the best ones ready to
          apply, so they’re waiting on the Apply page. It uses your Anthropic key, as Match all does.
        </p>

        <label className="flex flex-wrap items-center gap-2">
          <input type="checkbox" checked={prep.match} onChange={(e) => set({ match: e.target.checked })} />
          Match the jobs it finds, up to
          <select
            className="input w-auto py-1 text-xs"
            value={prep.matchLimit}
            onChange={(e) => set({ matchLimit: Number(e.target.value) })}
            aria-label="Most jobs to match a morning"
          >
            {MATCH_LIMITS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          a morning
        </label>
        <label className="flex items-center gap-1.5 pl-6 text-xs">
          <input type="checkbox" checked={prep.batch} disabled={!prep.match} onChange={(e) => set({ batch: e.target.checked })} />
          as one batch: half price, back within the hour (usually minutes)
        </label>

        <div className="space-y-1.5">
          <label className="flex flex-wrap items-center gap-2">
            <input type="checkbox" checked={prep.ready} onChange={(e) => set({ ready: e.target.checked })} />
            Get the best
            <select
              className="input w-auto py-1 text-xs"
              value={prep.readyLimit}
              onChange={(e) => set({ readyLimit: Number(e.target.value) })}
              aria-label="Most jobs to get ready a morning"
            >
              {READY_LIMITS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            matching
            <select
              className="input w-auto py-1 text-xs"
              value={prep.readyFrom}
              onChange={(e) => set({ readyFrom: Number(e.target.value) })}
              aria-label="Lowest match to get ready"
            >
              {READY_FROM.map((value) => (
                <option key={value} value={value}>
                  {value}%+
                </option>
              ))}
            </select>
            ready to apply: saved to My jobs with a tailored CV
          </label>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6 text-xs">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={prep.coverLetters} disabled={!prep.ready} onChange={(e) => set({ coverLetters: e.target.checked })} />
              and a cover letter
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={prep.answers} disabled={!prep.ready} onChange={(e) => set({ answers: e.target.checked })} />
              and application answers
            </label>
          </div>
        </div>

        {(prep.match || prep.ready) && (
          <p className="muted text-xs">
            Up to {requests} Claude requests a morning{prep.match && prep.batch && ", the matches at half price"}. Jobs with only a snippet of a description aren’t matched, and ones you’ve
            marked Not interested are skipped.
            {noCv && <span className="text-red-700 dark:text-red-300"> Add your CV under Profile first.</span>}
            {noAi && <span className="text-red-700 dark:text-red-300"> AI isn’t set up (ANTHROPIC_API_KEY).</span>}
          </p>
        )}

        <Notifications notify={prep.notify} onNotify={(notify) => set({ notify })} />
      </div>
    </details>
  );
}

/** The summary on your phone: turned on for each device that should get it. */
function Notifications({ notify, onNotify }: { notify: boolean; onNotify: (on: boolean) => void }) {
  const [status, setStatus] = useState<PushStatus | null | undefined>(undefined);
  const [here, setHere] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function refresh() {
    const [next, subscription] = await Promise.all([fetchPushStatus(), currentSubscription().catch(() => null)]);
    setStatus(next);
    setHere(Boolean(subscription));
  }

  useEffect(() => {
    let active = true;
    void Promise.all([fetchPushStatus(), currentSubscription().catch(() => null)]).then(([next, subscription]) => {
      if (!active) return;
      setStatus(next);
      setHere(Boolean(subscription));
    });
    return () => {
      active = false;
    };
  }, []);

  async function act(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: "ok", text: await action() });
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (status === undefined) return null;
  const devices = status?.devices ?? [];

  return (
    <div className="space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" checked={notify} onChange={(e) => onNotify(e.target.checked)} />
        <BellRing size={14} aria-hidden /> Send me a summary when it’s done
      </label>
      {!status?.storage ? (
        <p className="muted text-xs">Notifications need server storage (see the README).</p>
      ) : !status.publicKey ? (
        <p className="muted text-xs">
          Notifications aren’t set up on the server yet: add JOBSCRATCH_VAPID_PUBLIC_KEY and JOBSCRATCH_VAPID_PRIVATE_KEY in Vercel
          (the README says how to make them), then redeploy.
        </p>
      ) : needsHomeScreen() ? (
        <p className="muted text-xs">
          On an iPhone, add JobScratch to your Home Screen first (Share → Add to Home Screen), open it from there, and turn
          notifications on in it.
        </p>
      ) : !pushSupported() ? (
        <p className="muted text-xs">This browser can’t get notifications. Try Chrome, Edge, Firefox or Safari.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {here ? (
            <>
              <span className="chip bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">On for this device</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const { sent } = await sendTestPush();
                    return sent ? `Sent to ${sent} ${sent === 1 ? "device" : "devices"}.` : "No device took it. Turn them off and on again.";
                  })
                }
              >
                Send a test
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await turnOffPush();
                    return "Turned off for this device.";
                  })
                }
              >
                Turn off here
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await turnOnPush(status.publicKey!);
                  return "Turned on. Send a test to check it arrives.";
                })
              }
            >
              Turn on for this device
            </button>
          )}
          {devices.length > 0 && (
            <span className="muted text-xs">
              On for: {devices.join(", ")}
            </span>
          )}
        </div>
      )}
      {message && (
        <p className={`text-xs ${message.tone === "error" ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
