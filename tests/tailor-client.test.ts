import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamTailored, type TailorRequest } from "@/lib/tailor-client";

const REQUEST: TailorRequest = {
  kind: "cv",
  cv: "Alex Test\nData analyst with four years of SQL and Power BI.",
  job: { title: "Data Analyst", company: "CBRE", location: "", url: "", description: "SQL and Power BI." },
  options: { style: "uk-cv", tone: "professional", length: "two-pages", extraInstructions: "" },
};

const fetchMock = vi.fn<typeof fetch>();

/** An NDJSON response, split mid-line to check the reader joins chunks. */
function ndjson(events: object[]): Response {
  const body = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  const middle = Math.floor(body.length / 2);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body.slice(0, middle)));
      controller.enqueue(new TextEncoder().encode(body.slice(middle)));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("streamTailored", () => {
  it("collects the streamed document and reports progress", async () => {
    fetchMock.mockResolvedValueOnce(
      ndjson([
        { type: "thinking", text: "Reading the job…" },
        { type: "text", text: "# Alex Test\n" },
        { type: "notice", text: "Continuing with another model." },
        { type: "text", text: "Data analyst. " },
        { type: "done", model: "claude-opus-5-5" },
      ]),
    );
    const texts: string[] = [];
    const notices: string[] = [];
    const result = await streamTailored(REQUEST, { onText: (t) => texts.push(t), onNotice: (n) => notices.push(n) });

    expect(result).toBe("# Alex Test\nData analyst.");
    expect(texts).toEqual(["# Alex Test\n", "# Alex Test\nData analyst. "]);
    expect(notices).toEqual(["Continuing with another model."]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tailor/generate");
    expect(JSON.parse(String(init?.body))).toMatchObject({ kind: "cv", job: { title: "Data Analyst" } });
  });

  it("turns error events, failed requests and cut-off streams into errors", async () => {
    fetchMock.mockResolvedValueOnce(ndjson([{ type: "text", text: "# Al" }, { type: "error", message: "Rate limited." }]));
    await expect(streamTailored(REQUEST)).rejects.toThrow("Rate limited.");

    fetchMock.mockResolvedValueOnce(Response.json({ error: "Add your CV first" }, { status: 400 }));
    await expect(streamTailored(REQUEST)).rejects.toThrow("Add your CV first");

    fetchMock.mockResolvedValueOnce(ndjson([{ type: "text", text: "# Alex" }]));
    await expect(streamTailored(REQUEST)).rejects.toThrow("closed before Claude finished");
  });
});
