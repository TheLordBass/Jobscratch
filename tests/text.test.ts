import { describe, expect, it } from "vitest";
import {
  htmlToText,
  isExcluded,
  matchesKeyword,
  parseRelativeDate,
  relevanceScore,
  toIsoDate,
} from "@/lib/text";

describe("htmlToText", () => {
  it("keeps paragraphs and bullets", () => {
    expect(htmlToText("<p>Hello&nbsp;<b>world</b></p><ul><li>One</li><li>Two</li></ul><p>Bye</p>")).toBe(
      "Hello world\n\n• One\n• Two\n\nBye",
    );
  });

  it("decodes entity-escaped HTML", () => {
    expect(htmlToText("&lt;p&gt;Fish &amp;amp; chips&lt;/p&gt;")).toBe("Fish & chips");
  });

  it("drops scripts and styles", () => {
    expect(htmlToText("<style>.a{}</style><p>Text</p><script>alert(1)</script>")).toBe("Text");
  });

  it("passes plain text through", () => {
    expect(htmlToText("Line one\n\n\n\nLine two")).toBe("Line one\n\nLine two");
  });
});

describe("keyword matching", () => {
  const job = { title: "Senior Data Analyst", description: "You will build dashboards in Power BI.", tags: ["sql"] };

  it("matches when every word is in the title or tags", () => {
    expect(matchesKeyword(job, "data analyst")).toBe(true);
    expect(matchesKeyword(job, "analyst sql")).toBe(true);
  });

  it("matches a phrase in the description", () => {
    expect(matchesKeyword(job, "power bi")).toBe(true);
  });

  it("doesn't match partial words", () => {
    expect(matchesKeyword(job, "data analytics")).toBe(false);
    expect(matchesKeyword({ ...job, title: "Javascript Dev" }, "java")).toBe(false);
  });

  it("handles C++ and C#", () => {
    expect(matchesKeyword({ title: "C++ Engineer", description: "", tags: [] }, "c++")).toBe(true);
    expect(matchesKeyword({ title: "C# Engineer", description: "", tags: [] }, "c++")).toBe(false);
  });

  it("scores title phrase matches highest", () => {
    const inTitle = relevanceScore({ title: "Data Analyst", description: "", tags: [] }, ["data analyst"]);
    const inDescription = relevanceScore({ title: "Engineer", description: "data analyst work", tags: [] }, [
      "data analyst",
    ]);
    expect(inTitle).toBeGreaterThan(inDescription);
  });

  it("excludes by whole word in the title", () => {
    expect(isExcluded("Senior Data Analyst", ["senior"])).toBe(true);
    expect(isExcluded("Seniority Analyst", ["senior"])).toBe(false);
  });
});

describe("dates", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("parses relative dates", () => {
    expect(parseRelativeDate("3 days ago", now)).toBe("2026-10-07T12:00:00.000Z");
    expect(parseRelativeDate("30+ days ago", now)).toBe("2026-09-10T12:00:00.000Z");
    expect(parseRelativeDate("Just posted", now)).toBe(now.toISOString());
    expect(parseRelativeDate("whenever", now)).toBeUndefined();
  });

  it("parses the formats job APIs use", () => {
    expect(toIsoDate("09/10/2026")).toBe("2026-10-09T00:00:00.000Z");
    expect(toIsoDate("2026-10-06 09:30:00")).toBe("2026-10-06T09:30:00.000Z");
    expect(toIsoDate(1791460800)).toBe("2026-10-08T12:00:00.000Z");
    expect(toIsoDate(1791460800000)).toBe("2026-10-08T12:00:00.000Z");
    expect(toIsoDate("garbage")).toBeUndefined();
  });
});
