import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { buildBookmarklet, payloadToJob, readImportHash, type ImportPayload } from "@/lib/import";

const extractorSource = readFileSync(new URL("../public/extractor.js", import.meta.url), "utf8");

function extract(html: string, url: string, prepare?: (dom: JSDOM) => void): ImportPayload {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  prepare?.(dom);
  dom.window.eval(extractorSource);
  const window = dom.window as unknown as { jobscratchExtract: (d: Document, h: string) => ImportPayload };
  return window.jobscratchExtract(dom.window.document, url);
}

const LINKEDIN_LOGGED_IN = `<!doctype html><html><head><title>(3) Jobs | LinkedIn</title></head><body>
<div class="jobs-search__job-details--wrapper">
  <div class="job-details-jobs-unified-top-card__company-name"><a href="/company/globex/">Globex</a></div>
  <div class="t-24 job-details-jobs-unified-top-card__job-title">
    <h1 class="t-24 t-bold inline"><a href="/jobs/view/4012345678/">Senior Data Analyst</a></h1>
  </div>
  <div class="job-details-jobs-unified-top-card__tertiary-description-container">
    <span class="tvm__text tvm__text--low-emphasis">London, England, United Kingdom</span>
    <span class="tvm__text"> · </span><span class="tvm__text">2 days ago</span>
  </div>
  <div class="jobs-description__content">
    <div class="jobs-box__html-content" id="job-details">
      <h2 class="text-heading-large">About the job</h2>
      <div class="mt4"><p><span>We are hiring a data analyst to own our reporting.</span></p>
        <ul><li>SQL</li><li>Python</li></ul>
        <span class="visually-hidden">Hidden duplicate text</span>
      </div>
    </div>
  </div>
</div></body></html>`;

const JSON_LD_PAGE = `<!doctype html><html><head><title>Python Developer - Initech</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
{"@type":"JobPosting","title":"Python Developer","hiringOrganization":{"@type":"Organization","name":"Initech"},
"jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Leeds","addressRegion":"England","addressCountry":"GB"}},
"description":"&lt;p&gt;Build things&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Django&lt;/li&gt;&lt;/ul&gt;&lt;img src=x onerror=\\"window.__pwned=1\\"&gt;",
"datePosted":"2026-10-01T09:00:00.000Z","employmentType":"FULL_TIME",
"baseSalary":{"@type":"MonetaryAmount","currency":"GBP","value":{"@type":"QuantitativeValue","minValue":40000,"maxValue":50000,"unitText":"YEAR"}}}]}
</script></head><body><h1>Python Developer</h1></body></html>`;

describe("page extractor", () => {
  it("reads a logged-in LinkedIn job pane and canonicalises the URL", () => {
    const job = extract(
      LINKEDIN_LOGGED_IN,
      "https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=data",
    );
    expect(job).toMatchObject({
      title: "Senior Data Analyst",
      company: "Globex",
      location: "London, England, United Kingdom",
      url: "https://www.linkedin.com/jobs/view/4012345678/",
      sourceName: "LinkedIn",
      extractedFrom: "page",
    });
    expect(job.description).toBe("We are hiring a data analyst to own our reporting.\n\n• SQL\n• Python");
  });

  it("falls back to the LinkedIn page title when the layout changes", () => {
    const job = extract(
      `<html><head><title>Product Manager | Hooli | LinkedIn</title></head><body>
       <section><h2>About the job</h2><p>${"Lead the roadmap. ".repeat(30)}</p></section></body></html>`,
      "https://www.linkedin.com/jobs/view/product-manager-at-hooli-3999999999/",
    );
    expect(job.title).toBe("Product Manager");
    expect(job.company).toBe("Hooli");
    expect(job.url).toBe("https://www.linkedin.com/jobs/view/3999999999/");
    expect(job.description.startsWith("Lead the roadmap.")).toBe(true);
  });

  it("prefers schema.org JobPosting data and never runs embedded HTML", () => {
    let pwned: unknown;
    const job = extract(JSON_LD_PAGE, "https://careers.initech.example/jobs/42", (dom) => {
      Object.defineProperty(dom.window, "__pwned", {
        set: (value) => (pwned = value),
        get: () => pwned,
      });
    });
    expect(job).toMatchObject({
      title: "Python Developer",
      company: "Initech",
      location: "Leeds, England, GB",
      postedAt: "2026-10-01T09:00:00.000Z",
      employmentType: "full time",
      salaryText: "GBP 40000–50000 per year",
      extractedFrom: "structured-data",
      url: "https://careers.initech.example/jobs/42",
    });
    expect(job.description).toBe("Build things\n\n• Django");
    expect(pwned).toBeUndefined();
  });

  it("reads Indeed job pages", () => {
    const job = extract(
      `<html><body><h2 data-testid="jobsearch-JobInfoHeader-title">Warehouse Supervisor - job post</h2>
       <div data-testid="inlineHeader-companyName">Acme Logistics</div>
       <div data-testid="inlineHeader-companyLocation">Bristol BS1</div>
       <div id="jobDescriptionText"><p>Lead a team of 12.</p></div></body></html>`,
      "https://uk.indeed.com/jobs?q=warehouse&vjk=abc123",
    );
    expect(job).toMatchObject({
      title: "Warehouse Supervisor",
      company: "Acme Logistics",
      location: "Bristol BS1",
      description: "Lead a team of 12.",
      url: "https://uk.indeed.com/viewjob?jk=abc123",
      sourceName: "Indeed",
    });
  });

  it("uses the user's text selection as the description when there is one", () => {
    const long = "Responsibilities include planning, budgeting and reporting. ".repeat(6).trim();
    const job = extract(
      `<html><body><h1>Finance Manager</h1><div id="noise">Cookie banner</div><p id="desc">${long}</p></body></html>`,
      "https://jobs.example.org/finance-manager",
      (dom) => {
        const selection = dom.window.getSelection()!;
        selection.selectAllChildren(dom.window.document.getElementById("desc")!);
      },
    );
    expect(job.title).toBe("Finance Manager");
    expect(job.description).toBe(long);
    expect(job.extractedFrom).toBe("selection");
  });

  it("finds a description under a generic heading on any careers page", () => {
    const job = extract(
      `<html><head><meta property="og:site_name" content="Umbrella"></head><body><nav>Home Jobs</nav>
       <h1>Lab Technician</h1><div><h2>Job description</h2><p>${"Run assays daily. ".repeat(25)}</p></div></body></html>`,
      "https://umbrella.example/careers/lab-tech",
    );
    expect(job).toMatchObject({ title: "Lab Technician", company: "Umbrella", sourceName: "umbrella.example" });
    expect(job.description.startsWith("Run assays daily.")).toBe(true);
  });

  it("keeps the extension's copy in sync", () => {
    const extensionCopy = readFileSync(new URL("../extension/extractor.js", import.meta.url), "utf8");
    expect(extensionCopy, "run `npm run sync:extension`").toBe(extractorSource);
  });
});

describe("bookmarklet", () => {
  it("extracts the page and opens the import screen with the job in the URL hash", () => {
    const href = buildBookmarklet(extractorSource, "https://jobscratch.example");
    expect(href.startsWith("javascript:")).toBe(true);

    const dom = new JSDOM(LINKEDIN_LOGGED_IN, {
      url: "https://www.linkedin.com/jobs/view/4012345678/",
      runScripts: "outside-only",
    });
    const opened: string[] = [];
    dom.window.open = ((url: string) => {
      opened.push(url);
      return null;
    }) as typeof dom.window.open;
    dom.window.eval(decodeURIComponent(href.slice("javascript:".length)));

    expect(opened).toHaveLength(1);
    const [base, hash] = opened[0].split("#");
    expect(base).toBe("https://jobscratch.example/import");
    const payload = readImportHash(`#${hash}`)!;
    expect(payload.title).toBe("Senior Data Analyst");

    const job = payloadToJob(payload);
    expect(job).toMatchObject({
      source: "import",
      sourceName: "LinkedIn",
      company: "Globex",
      url: "https://www.linkedin.com/jobs/view/4012345678/",
      applyOptions: [{ label: "LinkedIn", url: "https://www.linkedin.com/jobs/view/4012345678/" }],
    });
    expect(job.id).toMatch(/^import:/);
  });

  it("rejects malformed hashes and unsafe links", () => {
    expect(readImportHash("#job=not-json")).toBeNull();
    expect(readImportHash("#other=1")).toBeNull();
    const job = payloadToJob({
      title: "X",
      company: "",
      location: "",
      description: "",
      url: "javascript:alert(1)",
      sourceName: "",
    });
    expect(job.url).toBe("");
    expect(job.applyOptions).toEqual([]);
  });
});
