import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/profile/route";
import { buildProfile } from "@/lib/profile";
import { fetchGithubProfile, parseGithubUsername, readmeExcerpt } from "@/lib/profile/github";
import { evidenceSections, linksChanged, mergeEvidence } from "@/lib/profile/links";
import { fetchWebsiteProfile, pageText, usefulLinks } from "@/lib/profile/website";
import { ImportError, type FetchedPage } from "@/lib/safe-fetch";

const USER = {
  login: "janedoe",
  name: "Jane Doe",
  bio: "Data analyst who codes",
  location: "London",
  blog: "https://jane.dev",
  public_repos: 4,
  html_url: "https://github.com/janedoe",
};

const repo = (name: string, extra: Record<string, unknown>) => ({
  name,
  full_name: `janedoe/${name}`,
  html_url: `https://github.com/janedoe/${name}`,
  fork: false,
  ...extra,
});

const REPOS = [
  repo("dotfiles", { language: "Shell", stargazers_count: 0, pushed_at: "2026-10-01T00:00:00Z" }),
  repo("forked-lib", { fork: true, language: "Go", stargazers_count: 500 }),
  repo("sales-dashboard", {
    description: "Power BI and Python sales dashboard",
    language: "Python",
    topics: ["powerbi", "pandas"],
    stargazers_count: 12,
    pushed_at: "2026-09-01T00:00:00Z",
    homepage: "https://dash.jane.dev",
  }),
  repo("sql-tips", { description: "SQL snippets", language: "Python", stargazers_count: 3, pushed_at: "2026-08-01T00:00:00Z" }),
];

const README = `# Sales dashboard
![build](https://img.shields.io/badge/build-passing-green)
Built with **pandas** and [Power BI](https://powerbi.com).

\`\`\`python
print("secret code")
\`\`\`

- Cleans raw sales data
- Publishes weekly reports`;

const fetchMock = vi.fn<typeof fetch>();

function githubRoutes(url: string): Response {
  if (url.endsWith("/users/janedoe")) return Response.json(USER);
  if (url.includes("/users/janedoe/repos")) return Response.json(REPOS);
  if (url.endsWith("/repos/janedoe/sales-dashboard/readme")) return new Response(README);
  if (url.includes("/readme")) return new Response("Not Found", { status: 404 });
  if (url.includes("/users/")) return new Response("Not Found", { status: 404 });
  return new Response("unexpected", { status: 500 });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("parseGithubUsername", () => {
  it.each([
    ["janedoe", "janedoe"],
    ["@janedoe", "janedoe"],
    ["github.com/janedoe", "janedoe"],
    ["https://github.com/janedoe/sales-dashboard", "janedoe"],
    ["https://www.github.com/jane-doe/", "jane-doe"],
    ["https://gitlab.com/janedoe", undefined],
    ["not a user!", undefined],
    ["-bad", undefined],
    ["", undefined],
  ])("%s -> %s", (input, expected) => {
    expect(parseGithubUsername(input)).toBe(expected);
  });
});

describe("fetchGithubProfile", () => {
  it("summarises the user's own repositories, best first", async () => {
    fetchMock.mockImplementation(async (input) => githubRoutes(String(input)));
    const profile = await fetchGithubProfile("https://github.com/janedoe");

    expect(profile).toMatchObject({ username: "janedoe", url: "https://github.com/janedoe", repoCount: 3 });
    const text = profile.text;
    expect(text).toContain("Name: Jane Doe");
    expect(text).toContain("Bio: Data analyst who codes");
    expect(text).toContain("Main languages: Python (2 repos), Shell (1 repo)");
    expect(text).not.toContain("forked-lib");
    expect(text.indexOf("sales-dashboard")).toBeLessThan(text.indexOf("sql-tips"));
    expect(text.indexOf("sql-tips")).toBeLessThan(text.indexOf("dotfiles"));
    expect(text).toContain("Topics: powerbi, pandas");
    expect(text).toContain("Live: https://dash.jane.dev");
    expect(text).toContain("README: Sales dashboard Built with pandas and Power BI.");
    expect(text).not.toContain("secret code");
    expect(text).not.toContain("shields.io");
  });

  it("sends GitHub's required headers, and the token when there is one", async () => {
    fetchMock.mockImplementation(async (input) => githubRoutes(String(input)));
    await fetchGithubProfile("janedoe", { token: "ghp_test" });
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer ghp_test");
    expect(headers.get("user-agent")).toBe("JobScratch");
    const readmeCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/readme"));
    expect(new Headers(readmeCall?.[1]?.headers).get("accept")).toBe("application/vnd.github.raw+json");
  });

  it("explains unknown users, bad input and rate limits", async () => {
    fetchMock.mockImplementation(async (input) => githubRoutes(String(input)));
    await expect(fetchGithubProfile("nobody-here")).rejects.toThrow("no GitHub user called “nobody-here”");
    await expect(fetchGithubProfile("https://gitlab.com/x")).rejects.toThrow("doesn't look like a GitHub");

    fetchMock.mockResolvedValue(
      new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    );
    await expect(fetchGithubProfile("janedoe")).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it("keeps going when a README can't be read", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/readme")) throw new Error("socket hang up");
      return githubRoutes(url);
    });
    const profile = await fetchGithubProfile("janedoe");
    expect(profile.text).toContain("sales-dashboard: Power BI and Python sales dashboard");
    expect(profile.text).not.toContain("README:");
  });

  it("strips markdown noise from README excerpts", () => {
    expect(readmeExcerpt("## Hi\n<img src=x>\nSee [docs](https://x.y) _now_")).toBe("Hi\nSee docs now");
  });

  it("keeps comparisons, underscores and inline code intact", () => {
    expect(
      readmeExcerpt("Latency < 50ms on Python >= 3.10, built on great_expectations. Start in `__init__.py`.\n> **Note:** beta"),
    ).toBe("Latency < 50ms on Python >= 3.10, built on great_expectations. Start in __init__.py.\nNote: beta");
  });

  it("reads past the first 100 repositories", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/users/janedoe")) return Response.json({ ...USER, public_repos: 150 });
      if (url.includes("/users/janedoe/repos")) {
        const page = Number(new URL(url).searchParams.get("page"));
        return Response.json(Array.from({ length: page === 1 ? 100 : 50 }, (_, i) => repo(`p${page}-r${i}`, {})));
      }
      return githubRoutes(url);
    });
    const profile = await fetchGithubProfile("janedoe");
    expect(profile.repoCount).toBe(150);
    expect(profile.text).toContain("Own public repositories: 150\n");
  });
});

const SITE: Record<string, string> = {
  "https://jane.dev/": `<html><head><title>Jane Doe</title><meta name="description" content="Data analyst in London"></head><body>
    <nav><a href="/about">About</a> <a href="/projects">Projects</a> <a href="https://twitter.com/jane">Twitter</a>
      <a href="/blog/hello">Blog</a> <a href="/cv.pdf">My CV (PDF)</a> <a href="mailto:jane@example.com">Email</a></nav>
    <main><h1>Jane Doe</h1><p>I build data tools for retail teams.</p></main>
    <footer>© 2026 Jane</footer><script>evil()</script></body></html>`,
  "https://www.jane.dev/about": `<title>About Jane</title><body><p>Analyst at Globex since 2020.</p></body>`,
};

const fakeFetchPage = vi.fn(async (url: string): Promise<FetchedPage> => {
  const normalised = url.replace(/\/$/, "") === "https://jane.dev" ? "https://jane.dev/" : url;
  if (normalised.endsWith("/projects")) throw new Error("timed out");
  const html = SITE[normalised] ?? SITE[normalised.replace("://jane.dev", "://www.jane.dev")];
  if (!html) throw new Error(`no page ${url}`);
  return { html, url: normalised };
});

describe("fetchWebsiteProfile", () => {
  beforeEach(() => {
    fakeFetchPage.mockClear();
  });

  it("reads the home page and About/Projects pages on the same site", async () => {
    const profile = await fetchWebsiteProfile("jane.dev", fakeFetchPage);
    expect(fakeFetchPage.mock.calls.map(([url]) => url)).toEqual([
      "https://jane.dev",
      "https://jane.dev/about",
      "https://jane.dev/projects",
    ]);
    expect(profile.pages).toEqual(["https://jane.dev/", "https://jane.dev/about"]);
    expect(profile.text).toContain("Page: https://jane.dev/ — Jane Doe — Data analyst in London");
    expect(profile.text).toContain("I build data tools for retail teams.");
    expect(profile.text).toContain("Page: /about — About Jane");
    expect(profile.text).toContain("Page: /about — About Jane\nAnalyst at Globex since 2020.");
    for (const unwanted of ["© 2026", "evil()", "Twitter", "Blog"]) expect(profile.text).not.toContain(unwanted);
  });

  it("only follows same-site links that describe the person's work", () => {
    const links = usefulLinks(SITE["https://jane.dev/"], new URL("https://www.jane.dev/"));
    expect(links).toEqual(["https://www.jane.dev/about", "https://www.jane.dev/projects"]);
  });

  it("reads unquoted links and links with #, once each", () => {
    const html = `<a href=/about>About</a> <a href=/about/>About me</a> <a href="/projects#top">Projects</a> <a href="#about">Skip</a>`;
    expect(usefulLinks(html, new URL("https://jane.dev/"))).toEqual(["https://jane.dev/about", "https://jane.dev/projects"]);
  });

  it("stays inside the person's own pages on shared sites", () => {
    const html = `<a href="/@jane/about-me">About</a> <a href="/@someone-else/projects">Projects</a> <a href="/about">About Medium</a>`;
    expect(usefulLinks(html, new URL("https://medium.com/@jane"))).toEqual(["https://medium.com/@jane/about-me"]);
  });

  it("reads descriptions with apostrophes", async () => {
    const profile = await fetchWebsiteProfile("https://jane.dev", async (url) => ({
      url,
      html: `<title>Jane</title><meta content="I'm a data analyst" name=description><main><p>Hi</p></main>`,
    }));
    expect(profile.text).toContain("Jane — I'm a data analyst");
  });

  it("explains when a site turns the request away, without suggesting the bookmarklet", async () => {
    const refusing = async (): Promise<FetchedPage> => {
      throw new ImportError("Use the bookmarklet", 502, undefined, 403);
    };
    await expect(fetchWebsiteProfile("https://jane.dev", refusing)).rejects.toThrow(
      "turned JobScratch away (HTTP 403)",
    );
  });

  it("stays quick on pages and READMEs full of unclosed tags", () => {
    const html = "<nav <main <title <head <a href=/about <li <p ".repeat(30_000);
    const readme = "<a [x]( ![y]( **_ `` ".repeat(30_000);
    const started = performance.now();
    pageText(html);
    usefulLinks(html, new URL("https://jane.dev/"));
    readmeExcerpt(readme);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("prefers <main> and drops navigation and footers", () => {
    expect(pageText(SITE["https://jane.dev/"])).toBe("Jane Doe\n\nI build data tools for retail teams.");
  });

  it("refuses LinkedIn and explains what to do instead", async () => {
    await expect(fetchWebsiteProfile("https://www.linkedin.com/in/jane")).rejects.toThrow(
      "LinkedIn pages can't be read automatically",
    );
  });

  it("reports pages with no readable text", async () => {
    await expect(
      fetchWebsiteProfile("https://empty.example", async (url) => ({ url, html: "<html><body></body></html>" })),
    ).rejects.toThrow("didn't have any readable text");
  });
});

describe("buildProfile and /api/profile", () => {
  it("combines both sources and reports each one's outcome", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://1.1.1.1")) {
        return new Response("<main><p>Portfolio of Jane Doe</p></main>", { headers: { "content-type": "text/html" } });
      }
      return githubRoutes(url);
    });
    const result = await buildProfile({ website: "https://1.1.1.1/", github: "janedoe" }, {});
    expect(result.website).toEqual({ ok: true, summary: "1 page read" });
    expect(result.github).toEqual({ ok: true, summary: "3 public repositories found" });
    expect(result.evidence).toMatch(/^## Website \(https:\/\/1\.1\.1\.1\/\)\nPage: /);
    expect(result.evidence).toContain("Portfolio of Jane Doe");
    expect(result.evidence).toContain("## GitHub (https://github.com/janedoe)");
    expect(result.evidence).toBe(`${result.sections.website}\n\n${result.sections.github}`);
  });

  it("keeps one source when the other fails", async () => {
    fetchMock.mockImplementation(async (input) => githubRoutes(String(input)));
    const result = await buildProfile({ website: "http://localhost/", github: "janedoe" }, {});
    expect(result.website).toEqual({ ok: false, error: "Local addresses can't be imported." });
    expect(result.github?.ok).toBe(true);
    expect(result.evidence).not.toContain("## Website");
  });

  it("requires at least one link", async () => {
    const response = await POST(
      new Request("http://localhost/api/profile", { method: "POST", body: JSON.stringify({ website: " " }) }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Add a website or a GitHub profile" });
  });
});

describe("fetched details and the links they came from", () => {
  const fetchedFor = { website: "jane.dev", github: "https://github.com/janedoe" };
  const evidence = "## Website (https://jane.dev/)\nOld site\n\n## GitHub (https://github.com/janedoe)\nOld repos";

  it("notices when the links have changed, ignoring how they're written", () => {
    expect(linksChanged({ website: "https://www.jane.dev/", github: "@JaneDoe" }, fetchedFor)).toBe(false);
    expect(linksChanged({ website: "jane.dev", github: "someone-else" }, fetchedFor)).toBe(true);
    expect(linksChanged({ website: "", github: "janedoe" }, fetchedFor)).toBe(true);
    expect(linksChanged({ website: "jane.dev", github: "" }, undefined)).toBe(false);
  });

  it("splits evidence into its sources", () => {
    expect(evidenceSections(evidence)).toEqual({
      website: "## Website (https://jane.dev/)\nOld site",
      github: "## GitHub (https://github.com/janedoe)\nOld repos",
    });
  });

  it("keeps a failed source's earlier text only while its link is the same", () => {
    const newSite = "## Website (https://jane.dev/)\nNew site";
    expect(mergeEvidence({ evidence, fetchedFor }, { website: "jane.dev", github: "janedoe" }, { website: newSite })).toBe(
      `${newSite}\n\n## GitHub (https://github.com/janedoe)\nOld repos`,
    );
    expect(mergeEvidence({ evidence, fetchedFor }, { website: "jane.dev", github: "someone-else" }, { website: newSite })).toBe(
      newSite,
    );
    expect(mergeEvidence({ evidence }, { website: "jane.dev", github: "janedoe" }, {})).toBe("");
  });
});
