import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeMatch, draftAnswers, isAiConfigured, readMatchBatch, streamDocument, submitMatchBatch, type StreamEvent } from "@/lib/ai/claude";
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
const OPTIONS: TailorOptions = { style: "uk-cv", tone: "professional", length: "two-pages", extraInstructions: "", projects: true };

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

/** The last request's user content: the cached materials (candidate, then job), then the instruction. */
function requestParts() {
  const content = lastRequest().body.messages[0].content as Array<{ text: string }>;
  return { materials: content.slice(0, -1).map((block) => block.text).join("\n\n"), instruction: content.at(-1)! };
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
    // The candidate and the job are cached separately, so matching a list reuses the candidate part.
    const [candidate, job, instruction] = body.messages[0].content;
    expect(candidate.cache_control).toEqual({ type: "ephemeral" });
    expect(candidate.text).toContain("<candidate_cv>");
    expect(candidate.text).not.toContain("<job_posting>");
    expect(job.cache_control).toEqual({ type: "ephemeral" });
    expect(job.text).toContain("Title: Senior Data Analyst");
    expect(instruction.text).toContain("Keep every employer, job title and date exactly as written");
    expect(instruction.text).toContain("UK/European CV conventions");
  });

  /** A CV of `count` one-line bullets: 20 fill about half a page, 33 four-fifths, 40 nearly all of one, 45 a little over, 60 about one and a half. */
  const cvOf = (count: number) => ["# Jane Doe\n", ...Array.from({ length: count }, (_, i) => `- Built reporting for team ${i} that cut weekly manual work by a third\n`)];
  const texts = (events: StreamEvent[]) => events.filter((event) => event.type === "text").map((event) => (event as { text: string }).text);

  it("shortens a CV that would print longer than the pages chosen", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(cvOf(60))).mockResolvedValueOnce(streamOf(cvOf(40)));
    const events = await collect(streamDocument("cv", { cv: CV, job: JOB }, { ...OPTIONS, length: "one-page" }, ENV));
    const restart = events.findIndex((event) => event.type === "restart");
    expect(restart).toBeGreaterThan(0);
    expect(events[restart - 1]).toMatchObject({ type: "notice", text: expect.stringContaining("cut to one page") });
    expect(texts(events.slice(restart + 1))).toEqual(cvOf(40));
    expect(events.at(-1)).toEqual({ type: "done", model: "claude-opus-5-5" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The same conversation, with the long CV as Claude's reply and a request to cut it.
    const { body } = lastRequest();
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1]).toMatchObject({ role: "assistant", content: expect.stringContaining("team 59") });
    expect(body.messages[2].content).toMatch(/fit on one page: it's about (2[0-9]) printed lines too long\. Cut about \1 lines, to about \d+ words/);
    expect(body.output_config).toEqual({ effort: "medium" });
  });

  it("fills out a one-page CV that leaves room on its page", async () => {
    // Four-fifths of a page looks short once printed.
    fetchMock.mockResolvedValueOnce(streamOf(cvOf(33))).mockResolvedValueOnce(streamOf(cvOf(40)));
    const events = await collect(streamDocument("cv", { cv: CV, job: JOB }, { ...OPTIONS, length: "one-page" }, ENV));
    expect(events).toContainEqual({ type: "notice", text: expect.stringContaining("so more of your experience is being added") });
    expect(texts(events.slice(events.findIndex((event) => event.type === "restart") + 1))).toEqual(cvOf(40));
    expect(lastRequest().body.messages[2].content).toMatch(/only fill about 8\d% of its page[\s\S]*no filler/);
  });

  it("can cut a CV twice and then fill it out", async () => {
    fetchMock
      .mockResolvedValueOnce(streamOf(cvOf(60)))
      .mockResolvedValueOnce(streamOf(cvOf(45)))
      .mockResolvedValueOnce(streamOf(cvOf(33)))
      .mockResolvedValueOnce(streamOf(cvOf(40)));
    const events = await collect(streamDocument("cv", { cv: CV, job: JOB }, { ...OPTIONS, length: "one-page" }, ENV));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const lastRestart = events.map((event) => event.type).lastIndexOf("restart");
    expect(texts(events.slice(lastRestart + 1))).toEqual(cvOf(40));
    expect(lastRequest().body.messages[2].content).toMatch(/leaving about \d+ printed lines empty/);
  });

  it("keeps the shorter CV if filling it out spills onto a second page", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(cvOf(20))).mockResolvedValueOnce(streamOf(cvOf(60)));
    const events = await collect(streamDocument("cv", { cv: CV, job: JOB }, { ...OPTIONS, length: "one-page" }, ENV));
    const lastRestart = events.map((event) => event.type).lastIndexOf("restart");
    expect(texts(events.slice(lastRestart + 1))).toEqual([cvOf(20).join("")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("leaves a CV that fits, and a short two-page one, as they are", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(cvOf(40)));
    const events = await collect(streamDocument("cv", { cv: CV, job: JOB }, { ...OPTIONS, length: "one-page" }, ENV));
    expect(events.some((event) => event.type === "restart")).toBe(false);
    expect(lastRequest().body.messages[0].content[2].text).toMatch(/^Rewrite the candidate's CV[\s\S]*must fill ONE printed A4 page/);
    fetchMock.mockResolvedValueOnce(streamOf(cvOf(20)));
    await collect(streamDocument("cv", { cv: CV, job: JOB }, OPTIONS, ENV));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the cover-letter prompt and a lower effort", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["Dear hiring team"]));
    await collect(streamDocument("cover-letter", { cv: CV, job: JOB }, { ...OPTIONS, extraInstructions: "Mention I can start in May" }, ENV));
    const { body } = lastRequest();
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.messages[0].content[2].text).toContain("cover letter");
    expect(body.messages[0].content[2].text).toContain("Mention I can start in May");
  });

  it("writes interview prep from the CV the candidate sent, with the job and materials still cached", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["# Interview prep"]));
    const sent = cvOf(60).join("");
    const events = await collect(streamDocument("interview", { cv: CV, job: JOB }, { ...OPTIONS, length: "one-page" }, ENV, undefined, sent));
    // Never shortened, however long it is.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const { body } = lastRequest();
    expect(body.output_config).toEqual({ effort: "medium" });
    const [candidate, job, instruction] = body.messages[0].content;
    expect(candidate.cache_control).toEqual({ type: "ephemeral" });
    expect(job.cache_control).toEqual({ type: "ephemeral" });
    expect(instruction.text).toMatch(/^Prepare the candidate for an interview/);
    for (const section of ["Tell me about yourself", "Likely questions", "Your stories", "Tough questions", "Questions to ask them"]) {
      expect(instruction.text).toContain(`## ${section}`);
    }
    expect(instruction.text).toContain("<cv_sent>");
    expect(instruction.text).toContain("team 59");
    expect(instruction.text).toContain("rather than inventing one");

    fetchMock.mockResolvedValueOnce(streamOf(["# Interview prep"]));
    await collect(streamDocument("interview", { cv: CV, job: JOB }, OPTIONS, ENV));
    expect(lastRequest().body.messages[0].content[2].text).not.toContain("<cv_sent>");
  });

  it("writes test prep, a message to the hiring manager and a follow-up, each once and at the right effort", async () => {
    const cases = [
      { kind: "test-prep" as const, effort: "medium", starts: /^Prepare the candidate for the test or assessment/, sections: ["What the test is likely to cover", "Practice questions", "Your weak spots"] },
      { kind: "outreach" as const, effort: "low", starts: /^Write short messages the candidate can send/, sections: ["LinkedIn connection note", "Email or LinkedIn message", "Who to send it to"] },
      { kind: "follow-up" as const, effort: "low", starts: /^Write a polite follow-up/, sections: ["Email", "LinkedIn message", "If there's no reply"] },
    ];
    for (const { kind, effort, starts, sections } of cases) {
      fetchMock.mockResolvedValueOnce(streamOf(["# Done"]));
      const events = await collect(streamDocument(kind, { cv: CV, job: JOB }, { ...OPTIONS, length: "one-page" }, ENV, undefined, undefined, "3 November"));
      expect(events.at(-1)).toMatchObject({ type: "done" });
      const { body } = lastRequest();
      expect(body.output_config).toEqual({ effort });
      const instruction = body.messages[0].content[2].text as string;
      expect(instruction).toMatch(starts);
      for (const section of sections) expect(instruction).toContain(`## ${section}`);
      if (kind === "follow-up") expect(instruction).toContain("made on 3 November");
      else expect(instruction).not.toContain("3 November");
    }
    // Never shortened like a CV: one request each.
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    const { materials, instruction } = requestParts();
    expect(materials).toContain("<candidate_links>\nWebsite: https://jane.dev\nGitHub: https://github.com/janedoe\n</candidate_links>");
    expect(materials).toContain("<online_profile>");
    expect(materials).toContain("sales-dashboard: Power BI and Python sales dashboard");
    // The profile sits inside the cached prefix, before the job.
    expect(materials.indexOf("<online_profile>")).toBeLessThan(materials.indexOf("<job_posting>"));
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
    const { materials } = requestParts();
    expect(materials).toContain("Website: https://jane.dev\nGitHub: https://github.com/janedoe\n");
  });

  it("leaves profile sections out when there is no profile", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["ok"]));
    await collect(
      streamDocument("cv", { cv: CV, job: JOB, profile: { website: "", github: "", evidence: " " } }, OPTIONS, ENV),
    );
    const { materials, instruction } = requestParts();
    expect(materials).not.toContain("<candidate_links>");
    expect(materials).not.toContain("<online_profile>");
    expect(instruction.text).not.toContain("Projects");
  });

  it("leaves projects out when asked, even with an online profile", async () => {
    fetchMock.mockResolvedValueOnce(streamOf(["ok"]));
    const profile = { website: "https://jane.dev", github: "", evidence: "## Site\n- sales-dashboard" };
    await collect(streamDocument("cv", { cv: CV, job: JOB, profile }, { ...OPTIONS, projects: false }, ENV));
    const { instruction } = requestParts();
    expect(instruction.text).toContain("Leave out projects entirely");
    expect(instruction.text).not.toContain('"Projects" section');

    fetchMock.mockResolvedValueOnce(streamOf(["ok"]));
    await collect(streamDocument("cover-letter", { cv: CV, job: JOB, profile }, { ...OPTIONS, projects: false }, ENV));
    const { instruction: letter } = requestParts();
    expect(letter.text).toContain("Don't mention personal or side projects.");
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
    const { materials, instruction } = requestParts();
    expect(materials).toContain("etl-pipeline");
    expect(instruction.text).toContain("where it comes from (CV, website or GitHub)");
  });

  it("can match with its own model and effort, leaving documents on the main model", async () => {
    const reply = () =>
      Response.json({
        id: "msg_5",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text: JSON.stringify(analysis) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    const env = { ...ENV, ANTHROPIC_MATCH_MODEL: "claude-haiku-5-5", ANTHROPIC_MATCH_EFFORT: "low" };
    fetchMock.mockResolvedValueOnce(reply());
    await analyzeMatch({ cv: CV, job: JOB }, env);
    let { body } = lastRequest();
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.output_config.effort).toBe("low");
    expect(body.fallbacks).toBeUndefined();
    expect(requestParts().instruction.text).toContain("up to 10 each");

    // An effort the API doesn't know falls back to the default.
    fetchMock.mockResolvedValueOnce(reply());
    await analyzeMatch({ cv: CV, job: JOB }, { ...env, ANTHROPIC_MATCH_EFFORT: "lowest" });
    expect(lastRequest().body.output_config.effort).toBe("medium");

    fetchMock.mockResolvedValueOnce(streamOf(["# Jane"]));
    await collect(streamDocument("cv", { cv: CV, job: JOB }, OPTIONS, env));
    ({ body } = lastRequest());
    expect(body.model).toBe("claude-opus-5-5");
  });

  it("given several CVs, has Claude use them all as one record, for the match and the writing", async () => {
    const reply = () =>
      Response.json({
        id: "msg_6",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(analysis) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    const ops = `Jane Doe. Operations manager: warehouse teams, rotas, budgets and suppliers for five years.`;
    const cvs = [
      { name: "Main CV", text: CV },
      { name: 'Ops "CV"', text: ops, updated: "2026-11-04" },
    ];
    fetchMock.mockResolvedValueOnce(reply());
    const result = await analyzeMatch({ cv: CV, cvs, job: JOB }, ENV);
    expect(result.matchScore).toBe(100);
    expect(Object.keys(lastRequest().body.output_config.format.schema.properties)).toEqual(Object.keys(analysis));
    let { materials, instruction } = requestParts();
    expect(materials).toContain("<candidate_cvs>");
    expect(materials).toContain('<cv name="Ops  CV" updated="2026-11-04">');
    expect(materials).toContain("warehouse teams");
    expect(materials).not.toContain("<candidate_cv>");
    expect(instruction.text).toMatch(/^The candidate has several versions of their CV/);
    expect(instruction.text).toContain("Assess how well");

    // The CV is written from them all too.
    fetchMock.mockResolvedValueOnce(streamOf(["# Jane"]));
    await collect(streamDocument("cv", { cv: CV, cvs, job: JOB }, OPTIONS, ENV));
    ({ materials, instruction } = requestParts());
    expect(materials).toContain("warehouse teams");
    expect(instruction.text).toMatch(/^The candidate has several versions of their CV/);
    expect(instruction.text).toContain("Rewrite the candidate's CV");

    // One CV is sent as before.
    fetchMock.mockResolvedValueOnce(reply());
    await analyzeMatch({ cv: CV, job: JOB }, ENV);
    expect(requestParts().materials).toContain("<candidate_cv>");
    expect(requestParts().instruction.text).toMatch(/^Assess how well/);
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

describe("match batches", () => {
  const analysis = {
    matchScore: 81,
    verdict: "Good fit.",
    strengths: ["SQL"],
    gaps: [],
    keywordsPresent: ["SQL"],
    keywordsMissing: [],
    suggestions: [],
  };
  const batch = (status: "in_progress" | "ended") =>
    Response.json({
      id: "msgbatch_1",
      type: "message_batch",
      processing_status: status,
      request_counts: { processing: 0, succeeded: 2, errored: 1, canceled: 0, expired: 0 },
      results_url: status === "ended" ? "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results" : null,
      created_at: "2026-10-28T06:00:00Z",
      ended_at: null,
      expires_at: "2026-10-29T06:00:00Z",
      archived_at: null,
      cancel_initiated_at: null,
    });
  const message = (content: object) => ({
    id: "msg_b",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify(content) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  });

  it("sends every analysis in one request, without the refusal fallback the batch API won't take", async () => {
    fetchMock.mockResolvedValueOnce(batch("in_progress"));
    const cvs = [
      { name: "Main CV", text: CV },
      { name: "Ops CV", text: `Jane Doe. Operations manager: warehouse teams, rotas, budgets and suppliers.` },
    ];
    const id = await submitMatchBatch(
      [
        { customId: "job-0", materials: { cv: CV, job: JOB } },
        { customId: "job-1", materials: { cv: CV, cvs, job: { ...JOB, title: "Site Lead" } } },
      ],
      ENV,
    );
    expect(id).toBe("msgbatch_1");
    const { url, headers, body } = lastRequest();
    expect(url).toMatch(/\/v1\/messages\/batches(\?|$)/);
    expect(headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
    expect(body.requests.map((r: { custom_id: string }) => r.custom_id)).toEqual(["job-0", "job-1"]);
    const [one, two] = body.requests.map((r: { params: Record<string, unknown> }) => r.params);
    expect(one).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, output_config: { effort: "medium", format: { type: "json_schema" } } });
    expect(one.fallbacks).toBeUndefined();
    expect(JSON.stringify(two.messages)).toContain("<candidate_cvs>");
  });

  it("reads the analyses back once the batch has ended", async () => {
    fetchMock.mockResolvedValueOnce(batch("in_progress"));
    expect(await readMatchBatch("msgbatch_1", ENV)).toBeNull();

    const lines = [
      { custom_id: "job-0", result: { type: "succeeded", message: message({ ...analysis, matchScore: 120 }) } },
      { custom_id: "job-1", result: { type: "succeeded", message: message(analysis) } },
      { custom_id: "job-2", result: { type: "errored", error: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } } },
      { custom_id: "job-3", result: { type: "canceled" } },
      { custom_id: "job-4", result: { type: "succeeded", message: { ...message({}), content: [], stop_reason: "refusal" } } },
    ];
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("/results")
        ? new Response(lines.map((line) => JSON.stringify(line)).join("\n"), { headers: { "content-type": "application/binary" } })
        : batch("ended"),
    );
    const outcomes = await readMatchBatch("msgbatch_1", ENV);
    expect(outcomes?.["job-0"]).toMatchObject({ analysis: { matchScore: 100 } });
    expect(outcomes?.["job-1"]).toMatchObject({ analysis: { matchScore: 81 } });
    expect(outcomes?.["job-2"]).toMatchObject({ error: { status: 502 } });
    expect(outcomes?.["job-3"]).toEqual({ canceled: true });
    expect(outcomes?.["job-4"]).toMatchObject({ error: { status: 422 } });
  });
});

describe("draftAnswers", () => {
  it("asks for answers to the questions, with the candidate's details, and keeps them with the questions asked", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: "msg_6",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              answers: [
                { question: "why us", answer: " I've followed Initech's analytics work. " },
                { question: "Notice?", answer: "One month." },
                { question: "Empty", answer: "  " },
              ],
            }),
          },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
    const questions = ["Why do you want to work for us?", "What is your notice period?", "Anything else?"];
    const details = { rightToWork: "British citizen", noticePeriod: "One month", salary: "", location: "", other: "" };
    const answers = await draftAnswers({ cv: CV, job: JOB }, questions, details, ENV);
    expect(answers).toEqual([
      { question: "Why do you want to work for us?", answer: "I've followed Initech's analytics work." },
      { question: "What is your notice period?", answer: "One month." },
    ]);
    const { body } = lastRequest();
    expect(body.output_config).toMatchObject({ effort: "medium", format: { type: "json_schema" } });
    const { materials, instruction } = requestParts();
    expect(materials).toContain("<candidate_cv>");
    expect(instruction.text).toContain("1. Why do you want to work for us?\n2. What is your notice period?");
    expect(instruction.text).toContain("Right to work: British citizen\nNotice period or start date: One month");
    expect(instruction.text).not.toContain("Salary expectations:");
  });

  it("keeps each answer with its own question when one is skipped", async () => {
    const reply = [
      { question: "Why do you want to work for us?", answer: "Because of the work." },
      { question: "Tell us about yourself.", answer: "I'm an analyst." },
    ];
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: "msg_8",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify({ answers: reply }) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
    const answers = await draftAnswers(
      { cv: CV, job: JOB },
      ["Why do you want to work for us?", "Why are you interested in this role?", "Tell us about yourself"],
      undefined,
      ENV,
    );
    expect(answers).toEqual([
      { question: "Why do you want to work for us?", answer: "Because of the work." },
      { question: "Tell us about yourself", answer: "I'm an analyst." },
    ]);
  });

  it("says to leave a gap for practical answers it hasn't been given", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: "msg_7",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify({ answers: [{ question: "q", answer: "a" }] }) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
    await draftAnswers({ cv: CV, job: JOB }, ["Tell us about yourself."], undefined, ENV);
    expect(requestParts().instruction.text).toContain("write [add your answer] where the candidate's own answer belongs");
  });
});
