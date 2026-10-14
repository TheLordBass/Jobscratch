import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeMatch, isAiConfigured, quickMatch, streamDocument, type StreamEvent } from "@/lib/ai/claude";
import type { TailorJob, TailorOptions } from "@/lib/ai/prompts";

const ENV = { ANTHROPIC_API_KEY: "sk-ant-test" };
const CV = "Jane Doe\njane@example.com\nData analyst at Globex 2020-2025. Built Power BI dashboards and SQL pipelines.";
const JOB: TailorJob = {
  title: "Senior Data Analyst",
  company: "Initech",
  location: "London",
  url: "https://example.com/job",
  description: "We need SQL, Power BI and stakeholder management.",
};
const OPTIONS: TailorOptions = { style: "uk-cv", tone: "professional", length: "two-pages", extraInstructions: "" };

const fetchMock = vi.fn<typeof fetch>();
let originalKey: string | undefined;

beforeAll(() => {
  originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = ENV.ANTHROPIC_API_KEY;
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

beforeEach(() => {
  fetchMock.mockReset();
});

function sse(events: object[]): Response {
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
}

function messageStart(model = "claude-opus-5-5") {
  return {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  };
}

function streamOf(text: string[], stopReason = "end_turn") {
  return sse([
    messageStart(),
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Matching skills…" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    ...text.map((t) => ({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: t } })),
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 42 } },
    { type: "message_stop" },
  ]);
}

async function collect(gen: AsyncGenerator<StreamEvent>) {
  const events: StreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  const headers = new Headers(init?.headers);
  return { url: String(url), headers, body: JSON.parse(String(init?.body)) };
}

describe("streamDocument", () => {
  it("streams a tailored CV with the right request shape", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["# Jane Doe\n", "Tailored CV"]));
    const events = await collect(streamDocument("cv", { cv: CV, job: JOB }, OPTIONS, ENV));

    expect(events).toEqual([
      { type: "thinking", text: "Matching skills…" },
      { type: "text", text: "# Jane Doe\n" },
      { type: "text", text: "Tailored CV" },
      { type: "done", model: "claude-opus-5-5" },
    ]);

    const { url, headers, body } = lastRequest();
    expect(url).toContain("/v1/messages");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      stream: true,
      max_tokens: 64000,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
    });
    expect(body.system).toContain("Be truthful");
    const [materials, instruction] = body.messages[0].content;
    expect(materials.cache_control).toEqual({ type: "ephemeral" });
    expect(materials.text).toContain("<candidate_cv>");
    expect(materials.text).toContain("Title: Senior Data Analyst");
    expect(instruction.text).toContain("Keep every employer, job title and date exactly as written");
    expect(instruction.text).toContain("UK/European CV conventions");
  });

  it("uses the cover-letter prompt and a lower effort", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["Dear hiring team"]));
    await collect(streamDocument("cover-letter", { cv: CV, job: JOB }, { ...OPTIONS, extraInstructions: "Mention I can start in May" }, ENV));
    const { body } = lastRequest();
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.messages[0].content[1].text).toContain("cover letter");
    expect(body.messages[0].content[1].text).toContain("Mention I can start in May");
  });

  it("reports refusals and truncation as errors", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["partial"], "refusal"));
    const refused = await collect(streamDocument("cv", { cv: CV, job: JOB }, OPTIONS, ENV));
    expect(refused.at(-1)).toMatchObject({ type: "error", status: 422 });

    fetchMock.mockResolvedValueOnce(streamOf(["partial"], "max_tokens"));
    const truncated = await collect(streamDocument("cv", { cv: CV, job: JOB }, OPTIONS, ENV));
    expect(truncated.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("cut off") });
  });

  it("turns API errors into readable messages", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
        { status: 401 },
      ),
    );
    const events = await collect(streamDocument("cv", { cv: CV, job: JOB }, OPTIONS, ENV));
    expect(events).toEqual([
      { type: "error", status: 401, message: "Anthropic rejected the API key. Check ANTHROPIC_API_KEY." },
    ]);
  });

  it("explains a missing API key without calling the API", async () => {
    const events = await collect(streamDocument("cv", { cv: CV, job: JOB }, OPTIONS, {}));
    expect(events[0]).toMatchObject({ type: "error", status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isAiConfigured({})).toBe(false);
  });

  it("passes the candidate's website and GitHub to Claude when given", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["ok"]));
    const profile = {
      website: "https://jane.dev",
      github: "https://github.com/janedoe",
      evidence: "## GitHub (https://github.com/janedoe)\n- sales-dashboard: Power BI and Python sales dashboard",
    };
    await collect(streamDocument("cv", { cv: CV, job: JOB, profile }, OPTIONS, ENV));
    const { body } = lastRequest();
    const [materials, instruction] = body.messages[0].content;
    expect(materials.text).toContain("<candidate_links>\nWebsite: https://jane.dev\nGitHub: https://github.com/janedoe\n</candidate_links>");
    expect(materials.text).toContain("<online_profile>");
    expect(materials.text).toContain("sales-dashboard: Power BI and Python sales dashboard");
    // The profile sits inside the cached prefix, before the job.
    expect(materials.text.indexOf("<online_profile>")).toBeLessThan(materials.text.indexOf("<job_posting>"));
    expect(instruction.text).toContain('"Projects" section');
    expect(instruction.text).toContain("website and GitHub links from candidate_links");
    expect(instruction.text).toContain("Embed every web address as a Markdown link");
    expect(instruction.text).toContain("never guess or construct one");
    expect(body.system).toContain("never as paid work experience");
  });

  it("gives Claude full addresses to link to", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["ok"]));
    const profile = { website: "jane.dev", github: "@janedoe", evidence: "" };
    await collect(streamDocument("cv", { cv: CV, job: JOB, profile }, OPTIONS, ENV));
    const [materials] = lastRequest().body.messages[0].content;
    expect(materials.text).toContain("Website: https://jane.dev\nGitHub: https://github.com/janedoe\n");
  });

  it("leaves profile sections out when there is no profile", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["ok"]));
    await collect(
      streamDocument("cv", { cv: CV, job: JOB, profile: { website: "", github: "", evidence: " " } }, OPTIONS, ENV),
    );
    const [materials, instruction] = lastRequest().body.messages[0].content;
    expect(materials.text).not.toContain("<candidate_links>");
    expect(materials.text).not.toContain("<online_profile>");
    expect(instruction.text).not.toContain("Projects");
  });

  it("doesn't ask for a fallback on Haiku, which has none", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["ok"]));
    await collect(streamDocument("cv", { cv: CV, job: JOB }, OPTIONS, { ...ENV, ANTHROPIC_MODEL: "claude-haiku-5-5" }));
    const { headers, body } = lastRequest();
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.fallbacks).toBeUndefined();
    expect(headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
  });

  it("can turn off fallbacks and switch model", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["ok"]));
    await collect(
      streamDocument("cv", { cv: CV, job: JOB }, OPTIONS, { ...ENV, ANTHROPIC_MODEL: "claude-sonnet-5-5", ANTHROPIC_FALLBACKS: "off" }),
    );
    const { headers, body } = lastRequest();
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.fallbacks).toBeUndefined();
    expect(headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
  });
});

describe("quickMatch", () => {
  const reply = (match: object, model = "claude-opus-5-5") =>
    Response.json({
      id: "msg_q",
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: JSON.stringify(match) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });

  it("scores quickly, with the CV as a cached prefix and the job after it", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ matchScore: 77.6, verdict: " Good fit. ", missing: ["dbt", "A/B testing", "Looker", "Airflow"] }),
    );
    const match = await quickMatch({ cv: CV, job: JOB }, ENV);
    expect(match).toEqual({ matchScore: 78, verdict: "Good fit.", missing: ["dbt", "A/B testing", "Looker"] });

    const { body } = lastRequest();
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config.effort).toBe("low");
    expect(Object.keys(body.output_config.format.schema.properties)).toEqual(["matchScore", "verdict", "missing"]);
    const [candidate, job] = body.messages[0].content;
    expect(candidate.cache_control).toEqual({ type: "ephemeral" });
    expect(candidate.text).toContain("<candidate_cv>");
    expect(candidate.text).not.toContain("<job_posting>");
    expect(job.text).toContain("<job_posting>\nTitle: Senior Data Analyst");
    expect(job.text).toContain("quick screening score");
  });

  it("can use a separate, cheaper model for quick matches", async () => {
    fetchMock.mockResolvedValueOnce(reply({ matchScore: 40, verdict: "Weak fit.", missing: [] }, "claude-haiku-5-5"));
    await quickMatch({ cv: CV, job: JOB }, { ...ENV, ANTHROPIC_QUICK_MODEL: "claude-haiku-5-5" });
    const { body } = lastRequest();
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.fallbacks).toBeUndefined();
  });
});

describe("analyzeMatch", () => {
  const analysis = {
    matchScore: 104.4,
    verdict: "Strong fit.",
    strengths: ["Power BI dashboards at Globex"],
    gaps: ["Stakeholder management not evidenced"],
    keywordsPresent: ["SQL", "Power BI"],
    keywordsMissing: ["stakeholder management"],
    suggestions: ["Mention who used the dashboards"],
  };

  it("requests structured output and clamps the score", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(analysis) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
    const result = await analyzeMatch({ cv: CV, job: JOB }, ENV);
    expect(result.matchScore).toBe(100);
    expect(result.keywordsMissing).toEqual(["stakeholder management"]);

    const { body } = lastRequest();
    expect(body.output_config.effort).toBe("medium");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(Object.keys(body.output_config.format.schema.properties)).toEqual(Object.keys(analysis));
  });

  it("uses the online profile in the match analysis", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: "msg_4",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(analysis) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
    await analyzeMatch(
      { cv: CV, job: JOB, profile: { website: "", github: "janedoe", evidence: "## GitHub\n- etl-pipeline" } },
      ENV,
    );
    const [materials, instruction] = lastRequest().body.messages[0].content;
    expect(materials.text).toContain("etl-pipeline");
    expect(instruction.text).toContain("where it comes from (CV, website or GitHub)");
  });

  it("throws a friendly error on refusal", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: "msg_3",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: "refusal",
        stop_sequence: null,
        stop_details: { type: "refusal", category: null, explanation: null },
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
    );
    await expect(analyzeMatch({ cv: CV, job: JOB }, ENV)).rejects.toMatchObject({ status: 422 });
  });
});
