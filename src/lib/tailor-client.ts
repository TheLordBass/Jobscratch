import type { ApplicationAnswer, ApplicationDetails, CandidateCv, CandidateProfile, ExtraSkill, TailorJob, TailorOptions } from "@/lib/ai/prompts";

/** What /api/tailor/generate needs to write a tailored CV or cover letter. */
export interface TailorRequest {
  kind: "cv" | "cover-letter";
  cv: string;
  /** Every CV, when there's more than one: Claude writes from them all. */
  cvs?: CandidateCv[];
  job: TailorJob;
  profile?: CandidateProfile;
  /** The candidate's notes on this job, used as extra experience and guidance. */
  notes?: string;
  /** Skills from the candidate's profile that their CV doesn't show. */
  skills?: ExtraSkill[];
  options: TailorOptions;
}

/** What /api/tailor/answers needs to draft answers to application questions. */
export type AnswersRequest = Omit<TailorRequest, "kind" | "options"> & { questions: string[]; details?: ApplicationDetails };

/** Drafted answers from /api/tailor/answers. */
export async function requestAnswers(request: AnswersRequest, signal?: AbortSignal): Promise<ApplicationAnswer[]> {
  const response = await fetch("/api/tailor/answers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  // A timeout or server error can come back as a page rather than JSON.
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Drafting the answers failed (HTTP ${response.status}). Try again.`);
  return (data as { answers: ApplicationAnswer[] }).answers;
}

export interface StreamHandlers {
  signal?: AbortSignal;
  /** The document so far, each time more arrives. */
  onText?: (text: string) => void;
  /** Claude's reasoning summary so far. */
  onThinking?: (thinking: string) => void;
  onNotice?: (notice: string) => void;
}

/** Streams a tailored CV or cover letter from /api/tailor/generate and resolves with the finished text. */
export async function streamTailored(request: TailorRequest, handlers: StreamHandlers = {}): Promise<string> {
  const response = await fetch("/api/tailor/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: handlers.signal,
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (HTTP ${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let thinking = "";
  let finished = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "text") {
        text += event.text;
        handlers.onText?.(text);
      } else if (event.type === "thinking") {
        thinking += event.text;
        handlers.onThinking?.(thinking);
      } else if (event.type === "notice") {
        handlers.onNotice?.(event.text);
      } else if (event.type === "error") {
        throw new Error(event.message);
      } else if (event.type === "done") {
        finished = true;
      }
    }
  }
  if (!finished) throw new Error("The connection closed before Claude finished. Try again.");
  return text.trim();
}
