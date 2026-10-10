import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  MatchAnalysisSchema,
  SYSTEM_PROMPT,
  analysisInstruction,
  coverLetterInstruction,
  cvInstruction,
  materialsBlock,
  type MatchAnalysis,
  type TailorJob,
  type TailorOptions,
} from "./prompts";

export const DEFAULT_MODEL = "claude-opus-5-5";

type Env = Record<string, string | undefined>;

export function isAiConfigured(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim());
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

let cachedClient: Anthropic | undefined;

function getClient(env: Env): Anthropic {
  if (!isAiConfigured(env)) {
    throw new AiError("AI features need an Anthropic API key. Add ANTHROPIC_API_KEY to .env.local and restart.", 503);
  }
  cachedClient ??= new Anthropic({ maxRetries: 2 });
  return cachedClient;
}

/**
 * Model plus server-side refusal fallback: if Claude's safety classifiers
 * decline a request, the API retries it on Anthropic's recommended model for
 * that case instead of failing. Set ANTHROPIC_FALLBACKS=off to disable.
 */
function modelParams(env: Env) {
  const model = env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  if (env.ANTHROPIC_FALLBACKS === "off") return { model };
  return { model, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
}

function buildMessages(cv: string, job: TailorJob, instruction: string): Anthropic.Beta.BetaMessageParam[] {
  return [
    {
      role: "user",
      content: [
        // The CV + job prefix is identical for analysis, CV and cover letter, so cache it.
        { type: "text", text: materialsBlock(cv, job), cache_control: { type: "ephemeral" } },
        { type: "text", text: instruction },
      ],
    },
  ];
}

/** Turn SDK errors into messages a user can act on. */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiError("Anthropic rejected the API key. Check ANTHROPIC_API_KEY.", 401);
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AiError("This API key doesn't have access to the configured model.", 403);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiError("The configured model wasn't found. Check ANTHROPIC_MODEL.", 404);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError("Rate limited by the Anthropic API. Wait a minute and try again.", 429);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiError(`The request was rejected: ${error.message}`, 400);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError("Couldn't reach the Anthropic API. Check your connection.", 502);
  }
  if (error instanceof Anthropic.APIError) {
    return new AiError(`Anthropic API error (${error.status ?? "unknown"}). Try again shortly.`, 502);
  }
  console.error("Unexpected AI error", error);
  return new AiError("Something went wrong while talking to Claude.", 500);
}

const REFUSAL_MESSAGE =
  "Claude declined this request. Check the CV and job text for anything unusual, then try again.";

export async function analyzeMatch(cv: string, job: TailorJob, env: Env, signal?: AbortSignal): Promise<MatchAnalysis> {
  const client = getClient(env);
  const response = await client.beta.messages.parse(
    {
      ...modelParams(env),
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: buildMessages(cv, job, analysisInstruction()),
      output_config: { effort: "medium", format: betaZodOutputFormat(MatchAnalysisSchema) },
    },
    { signal },
  );
  if (response.stop_reason === "refusal") throw new AiError(REFUSAL_MESSAGE, 422);
  if (response.stop_reason === "max_tokens") throw new AiError("The analysis was cut off. Try again.", 502);
  const analysis = response.parsed_output;
  if (!analysis) throw new AiError("Claude's analysis couldn't be read. Try again.", 502);
  return { ...analysis, matchScore: Math.min(100, Math.max(0, Math.round(analysis.matchScore))) };
}

export type DocumentKind = "cv" | "cover-letter";

export type StreamEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "notice"; text: string }
  | { type: "done"; model: string }
  | { type: "error"; message: string; status: number };

/** Streams a tailored CV or cover letter as text deltas (plus reasoning summaries for progress). */
export async function* streamDocument(
  kind: DocumentKind,
  cv: string,
  job: TailorJob,
  options: TailorOptions,
  env: Env,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  try {
    const client = getClient(env);
    const instruction = kind === "cv" ? cvInstruction(options) : coverLetterInstruction(options);
    const stream = client.beta.messages.stream(
      {
        ...modelParams(env),
        max_tokens: 64000,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: kind === "cv" ? "high" : "medium" },
        system: SYSTEM_PROMPT,
        messages: buildMessages(cv, job, instruction),
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "fallback") {
        yield { type: "notice", text: `Continuing with ${event.content_block.to.model}.` };
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") yield { type: "text", text: event.delta.text };
        else if (event.delta.type === "thinking_delta") yield { type: "thinking", text: event.delta.thinking };
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      yield { type: "error", message: REFUSAL_MESSAGE, status: 422 };
    } else if (final.stop_reason === "max_tokens") {
      yield { type: "error", message: "The response was cut off before it finished. Try again.", status: 502 };
    } else {
      yield { type: "done", model: final.model };
    }
  } catch (error) {
    if (signal?.aborted) return;
    const aiError = toAiError(error);
    yield { type: "error", message: aiError.message, status: aiError.status };
  }
}
