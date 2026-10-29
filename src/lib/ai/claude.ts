import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  AnswersSchema,
  MatchAnalysisSchema,
  SEVERAL_CVS,
  SYSTEM_PROMPT,
  analysisInstruction,
  answersInstruction,
  candidateBlock,
  coverLetterInstruction,
  cvInstruction,
  hasProfile,
  jobBlock,
  notesBlock,
  severalCvs,
  type ApplicationAnswer,
  type ApplicationDetails,
  type MatchAnalysis,
  type TailorMaterials,
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
 * Haiku models have no fallback model, so the parameter is left off for them.
 * Match analyses can use their own model (ANTHROPIC_MATCH_MODEL), e.g. a cheaper one for long lists.
 */
function modelParams(env: Env, task: "match" | "document") {
  const model = (task === "match" && env.ANTHROPIC_MATCH_MODEL?.trim()) || env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  if (env.ANTHROPIC_FALLBACKS === "off" || model.startsWith("claude-haiku")) return { model };
  return { model, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

/** How hard Claude thinks about a match: ANTHROPIC_MATCH_EFFORT, or medium. Lower is cheaper and faster. */
function matchEffort(env: Env): Effort {
  const effort = env.ANTHROPIC_MATCH_EFFORT?.trim() as Effort | undefined;
  return effort && EFFORTS.includes(effort) ? effort : "medium";
}

function buildMessages(materials: TailorMaterials, instruction: string): Anthropic.Beta.BetaMessageParam[] {
  return [
    {
      role: "user",
      content: [
        // Two cache breakpoints. The system prompt and candidate (CV, skills, profile) are the same for
        // every job, so matching a list reads them from the cache after the first job. The job is the same
        // for its analysis, CV and cover letter.
        { type: "text", text: candidateBlock(materials).trimEnd(), cache_control: { type: "ephemeral" } },
        {
          type: "text",
          text: `${jobBlock(materials.job)}${notesBlock(materials.notes)}`,
          cache_control: { type: "ephemeral" },
        },
        // With several CVs, every task is told to treat them as one record.
        { type: "text", text: `${severalCvs(materials) ? SEVERAL_CVS : ""}${instruction}` },
      ],
    },
  ];
}

/** One line per request in the server log (Vercel: Logs), to see where the tokens go and that the cache is read. */
function logUsage(task: string, message: { model: string; usage: Anthropic.Beta.BetaUsage }) {
  if (process.env.NODE_ENV === "test") return;
  const { usage } = message;
  console.info(
    `claude ${task} ${message.model}: input ${usage.input_tokens}, cache write ${usage.cache_creation_input_tokens ?? 0}, ` +
      `cache read ${usage.cache_read_input_tokens ?? 0}, output ${usage.output_tokens}`,
  );
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

/** A match analysis's request, but for the model. */
function matchRequest(materials: TailorMaterials, env: Env) {
  return {
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: buildMessages(materials, analysisInstruction(hasProfile(materials.profile))),
    output_config: { effort: matchEffort(env), format: betaZodOutputFormat(MatchAnalysisSchema) },
  };
}

/** Claude's answer as an analysis. */
function toAnalysis(stopReason: string | null, parsed: MatchAnalysis | null): MatchAnalysis {
  if (stopReason === "refusal") throw new AiError(REFUSAL_MESSAGE, 422);
  if (stopReason === "max_tokens") throw new AiError("The analysis was cut off. Try again.", 502);
  if (!parsed) throw new AiError("Claude's analysis couldn't be read. Try again.", 502);
  return { ...parsed, matchScore: Math.min(100, Math.max(0, Math.round(parsed.matchScore))) };
}

/** A match analysis: how well everything about the candidate (every CV, the website and GitHub) fits the job. */
export async function analyzeMatch(materials: TailorMaterials, env: Env, signal?: AbortSignal): Promise<MatchAnalysis> {
  const client = getClient(env);
  const response = await client.beta.messages.parse({ ...modelParams(env, "match"), ...matchRequest(materials, env) }, { signal });
  logUsage("match", response);
  return toAnalysis(response.stop_reason, response.parsed_output);
}

/*
 * Match analyses as one batch (the Message Batches API): half the price of asking one at a time,
 * but the answers come back later, usually within the hour. For the morning run, which isn't in a
 * hurry. The batch API takes no refusal fallback, so a refused job simply fails.
 */

export interface BatchedMatch {
  /** Letters, digits, - and _, up to 64 characters: what the result comes back under. */
  customId: string;
  materials: TailorMaterials;
}

/** Sends the analyses; the batch's id, to ask after it with. */
export async function submitMatchBatch(matches: BatchedMatch[], env: Env): Promise<string> {
  const client = getClient(env);
  const { model } = modelParams(env, "match");
  const batch = await client.beta.messages.batches.create({
    requests: matches.map(({ customId, materials }) => ({ custom_id: customId, params: { model, ...matchRequest(materials, env) } })),
  });
  return batch.id;
}

export type BatchOutcome = { analysis: MatchAnalysis } | { error: AiError } | { canceled: true };

/** A batch's analyses, by custom id, once it's finished: null while Claude's still working on it. */
export async function readMatchBatch(id: string, env: Env): Promise<Record<string, BatchOutcome> | null> {
  const client = getClient(env);
  const batch = await client.beta.messages.batches.retrieve(id);
  if (batch.processing_status !== "ended") return null;
  const outcomes: Record<string, BatchOutcome> = {};
  const format = betaZodOutputFormat(MatchAnalysisSchema);
  for await (const { custom_id, result } of await client.beta.messages.batches.results(id)) {
    if (result.type === "succeeded") {
      logUsage("match (batch)", result.message);
      try {
        const text = result.message.content.find((block) => block.type === "text")?.text;
        const parsed = result.message.stop_reason === "end_turn" && text ? format.parse(text) : null;
        outcomes[custom_id] = { analysis: toAnalysis(result.message.stop_reason, parsed) };
      } catch (error) {
        outcomes[custom_id] = { error: error instanceof AiError ? error : new AiError("Claude's analysis couldn't be read.", 502) };
      }
    } else if (result.type === "errored") {
      outcomes[custom_id] = { error: new AiError(`Anthropic API error (${result.error.error.type}).`, 502) };
    } else {
      // Canceled, or not got to within the batch's day.
      outcomes[custom_id] = { canceled: true };
    }
  }
  return outcomes;
}

/** Stops a batch that's taking too long; what it finished first still comes back. */
export async function cancelMatchBatch(id: string, env: Env): Promise<void> {
  await getClient(env).beta.messages.batches.cancel(id);
}

/** Answers to questions from a job's application form (DEFAULT_QUESTIONS, or the candidate's own). */
export async function draftAnswers(
  materials: TailorMaterials,
  questions: string[],
  details: ApplicationDetails | undefined,
  env: Env,
  signal?: AbortSignal,
): Promise<ApplicationAnswer[]> {
  const client = getClient(env);
  const response = await client.beta.messages.parse(
    {
      ...modelParams(env, "document"),
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: buildMessages(materials, answersInstruction(questions, details)),
      output_config: { effort: "medium", format: betaZodOutputFormat(AnswersSchema) },
    },
    { signal },
  );
  logUsage("answers", response);
  if (response.stop_reason === "refusal") throw new AiError(REFUSAL_MESSAGE, 422);
  if (response.stop_reason === "max_tokens") throw new AiError("The answers were cut off. Try again.", 502);
  const drafted = response.parsed_output?.answers;
  if (!drafted) throw new AiError("Claude's answers couldn't be read. Try again.", 502);
  // Matched to the questions by the question Claude repeated back, so a skipped or reordered one
  // can't put an answer under the wrong question. By position only when it repeated them differently
  // but answered them all.
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byQuestion = new Map(drafted.map((entry) => [plain(entry.question), entry.answer]));
  const inOrder = drafted.length === questions.length;
  return questions
    .map((question, i) => ({ question, answer: (byQuestion.get(plain(question)) ?? (inOrder ? drafted[i].answer : "")).trim() }))
    .filter((entry) => entry.answer);
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
  materials: TailorMaterials,
  options: TailorOptions,
  env: Env,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  try {
    const client = getClient(env);
    const withProfile = hasProfile(materials.profile);
    const instruction =
      kind === "cv" ? cvInstruction(options, withProfile) : coverLetterInstruction(options, withProfile);
    const stream = client.beta.messages.stream(
      {
        ...modelParams(env, "document"),
        max_tokens: 64000,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: kind === "cv" ? "high" : "medium" },
        system: SYSTEM_PROMPT,
        messages: buildMessages(materials, instruction),
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
    logUsage(kind, final);
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
