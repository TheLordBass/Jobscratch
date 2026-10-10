import { describe, expect, it } from "vitest";
import { parseJobspyFile } from "@/lib/jobspy";

const row = (extra: Record<string, unknown>) => ({
  site: "indeed",
  job_url: "https://uk.indeed.com/viewjob?jk=abc123",
  job_url_direct: null,
  title: "Data Analyst",
  company: "Globex",
  location: "London, ENG, GB",
  date_posted: "2026-10-08T00:00:00.000",
  job_type: "fulltime",
  is_remote: false,
  min_amount: null,
  max_amount: null,
  currency: null,
  interval: null,
  description: "<p>Build <b>dashboards</b>.</p><ul><li>SQL</li><li>Power BI</li></ul>",
  company_logo: null,
  ...extra,
});

const file = (jobs: unknown[]) =>
  JSON.stringify({
    format: "jobscratch-jobspy",
    version: 1,
    createdAt: "2026-10-10T12:00:00+00:00",
    query: { search: "data analyst", location: "London" },
    jobs,
  });

describe("parseJobspyFile", () => {
  it("turns JobSpy rows into jobs that link back to the site", () => {
    const result = parseJobspyFile(
      file([
        row({}),
        row({
          site: "linkedin",
          job_url: "https://www.linkedin.com/jobs/view/4012345678",
          job_url_direct: "https://careers.initech.com/jobs/77",
          title: "BI Analyst",
          company: "Initech",
          is_remote: true,
          job_type: "contract, parttime",
          min_amount: 45000,
          max_amount: 55000,
          currency: "GBP",
          interval: "yearly",
          company_logo: "https://media.licdn.com/logo.png",
        }),
      ]),
    );

    expect(result.query).toBe("data analyst in London");
    expect(result.skipped).toBe(0);
    const [indeed, linkedin] = result.jobs;
    expect(indeed).toMatchObject({
      source: "import",
      sourceName: "Indeed (JobSpy)",
      title: "Data Analyst",
      company: "Globex",
      url: "https://uk.indeed.com/viewjob?jk=abc123",
      employmentType: "full-time",
      postedAt: "2026-10-08T00:00:00.000Z",
      remote: false,
    });
    expect(indeed.description).toBe("Build dashboards.\n\n• SQL\n• Power BI");
    expect(indeed.salary).toBeUndefined();

    expect(linkedin).toMatchObject({
      sourceName: "LinkedIn (JobSpy)",
      remote: true,
      employmentType: "contract, part-time",
      salary: { min: 45000, max: 55000, currency: "GBP", period: "year" },
      companyLogo: "https://media.licdn.com/logo.png",
    });
    expect(linkedin.applyOptions).toEqual([
      { label: "LinkedIn", url: "https://www.linkedin.com/jobs/view/4012345678" },
      { label: "Company site", url: "https://careers.initech.com/jobs/77" },
    ]);
  });

  it("leaves out rows without a title or link, and duplicates", () => {
    const result = parseJobspyFile(
      file([row({}), row({}), row({ title: null }), row({ job_url: "not a link" }), "nonsense"]),
    );
    expect(result.jobs).toHaveLength(1);
    expect(result.skipped).toBe(3);
  });

  it("explains files it can't read", () => {
    expect(() => parseJobspyFile("{nope")).toThrow("isn't valid JSON");
    expect(() => parseJobspyFile(JSON.stringify({ jobs: [] }))).toThrow("isn't a JobSpy results file");
  });
});
