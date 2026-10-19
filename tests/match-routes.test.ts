import { describe, expect, it } from "vitest";
import { POST as analyze } from "@/app/api/tailor/analyze/route";

const cv = "Alex Test. Data analyst with four years of SQL, Power BI and Python in retail. ".repeat(2);

const post = (handler: (request: Request) => Promise<Response>, description: string) =>
  handler(
    new Request("http://localhost/api/tailor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cv, job: { title: "Data Analyst", company: "CBRE", description } }),
    }),
  );

describe("matching a job", () => {
  it("is refused for a snippet of the description, before Claude is asked", async () => {
    for (const handler of [analyze]) {
      const response = await post(handler, "Build Power BI dashboards and write SQL. Hybrid, Manchester.");
      expect(response.status).toBe(422);
      expect((await response.json()).error).toMatch(/snippet/);
    }
  });
});
