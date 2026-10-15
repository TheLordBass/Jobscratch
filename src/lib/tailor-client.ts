import type { CandidateProfile, TailorJob, TailorOptions } from "@/lib/ai/prompts";

/** What /api/tailor/generate needs to write a tailored CV or cover letter. */
export interface TailorRequest {
  kind: "cv" | "cover-letter";
  cv: string;
  job: TailorJob;
  profile?: CandidateProfile;
  options: TailorOptions;
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
