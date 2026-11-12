import { describe, expect, it } from "vitest";
import { parseBoardToken } from "@/lib/sources/boards";
import { feedCompany, parseJobFeed } from "@/lib/sources/feeds";

const RSS = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Jobs at University of Greater Manchester</title>
    <link>https://jobs.greatermanchester.ac.uk/Vacancies.aspx</link>
    <item>
      <title><![CDATA[Data Analyst (0370-26)]]></title>
      <link>https://jobs.greatermanchester.ac.uk/rss/click.aspx?ref=0370-26</link>
      <guid>https://jobs.greatermanchester.ac.uk/rss/click.aspx?ref=0370-26</guid>
      <description><![CDATA[<p>We need SQL and <strong>Power BI</strong>.</p><ul><li>Reporting</li></ul>]]></description>
      <pubDate>Mon, 09 Nov 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Student Counsellor &amp; Adviser</title>
      <link>https://jobs.greatermanchester.ac.uk/rss/click.aspx?ref=0371-26</link>
      <description>&lt;p&gt;Support students.&lt;/p&gt;</description>
    </item>
    <item>
      <title>No link here</title>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Acme Housing - Vacancies</title>
  <entry>
    <title>Reporting Officer</title>
    <link rel="alternate" href="https://acme.example/jobs/42"/>
    <id>urn:acme:42</id>
    <updated>2026-11-10T08:00:00Z</updated>
    <summary type="html">&lt;p&gt;Monthly KPI reports in Excel.&lt;/p&gt;</summary>
  </entry>
</feed>`;

describe("employer job feeds", () => {
  it("reads an RSS feed's jobs, with the employer from the feed's title", () => {
    const jobs = parseJobFeed(RSS, "https://jobs.greatermanchester.ac.uk/rss/rss.aspx");
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      source: "feeds",
      title: "Data Analyst (0370-26)",
      company: "University of Greater Manchester",
      url: "https://jobs.greatermanchester.ac.uk/rss/click.aspx?ref=0370-26",
      postedAt: "2026-11-09T09:00:00.000Z",
    });
    expect(jobs[0].description).toContain("We need SQL and Power BI.");
    expect(jobs[0].description).toContain("Reporting");
    expect(jobs[1].title).toBe("Student Counsellor & Adviser");
    expect(jobs[1].description).toBe("Support students.");
    expect(jobs[0].id).not.toBe(jobs[1].id);
  });

  it("reads an Atom feed", () => {
    const [job] = parseJobFeed(ATOM, "https://acme.example/jobs.atom");
    expect(job).toMatchObject({ title: "Reporting Officer", company: "Acme Housing", url: "https://acme.example/jobs/42" });
    expect(job.description).toBe("Monthly KPI reports in Excel.");
  });

  it("names the employer from the feed, else its site", () => {
    expect(feedCompany("Current vacancies: Stockport Homes", "https://x.example/rss")).toBe("Stockport Homes");
    expect(feedCompany("", "https://jobs.example.ac.uk/rss")).toBe("example.ac.uk");
  });

  it("takes only full feed addresses in Settings", () => {
    expect(parseBoardToken("feeds", "https://jobs.example.ac.uk/rss/rss.aspx")).toBe("https://jobs.example.ac.uk/rss/rss.aspx");
    expect(parseBoardToken("feeds", "example")).toBeUndefined();
  });
});
