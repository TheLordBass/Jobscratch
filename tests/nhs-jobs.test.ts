import { describe, expect, it } from "vitest";
import { nhsSalary, parseNhsJobs } from "@/lib/sources/nhs-jobs";

const XML = `<?xml version='1.0' encoding='UTF-8'?><nhsJobs>
<vacancyDetails><id>111</id><reference>C1-26-1</reference><title>Senior Data Analyst</title>
<description>We are seeking an analyst to join our &amp; team...</description><employer>Example NHS Foundation Trust</employer>
<type>Permanent</type><salary>£39959.00 to £48117.00</salary><closeDate>2026-11-06</closeDate>
<postDate>2026-10-26T16:49:24.287519954</postDate><url>https://beta.jobs.nhs.uk/candidate/jobadvert/C1-26-1</url>
<locations><location>Manchester, M20 4BX</location></locations></vacancyDetails>
<vacancyDetails><id>222</id><title>Data Migration Lead</title><description>Package description</description>
<employer>Example Care Group</employer><type>Fixed-Term</type><salary>Negotiable</salary><closeDate>2026-11-22</closeDate>
<postDate>2026-10-26T05:30:45.5</postDate><url>https://beta.jobs.nhs.uk/candidate/jobadvert/E2-26-2</url>
<locations><location>Manchester (remote with occasional travel), M2 1BB</location><location>Leeds</location><location>York</location><location>Hull</location></locations></vacancyDetails>
<vacancyDetails><id>333</id><title>No link</title></vacancyDetails>
<totalPages>5</totalPages><totalResults>50</totalResults></nhsJobs>`;

describe("NHS Jobs", () => {
  it("reads its XML search results as jobs", () => {
    const { jobs, totalPages } = parseNhsJobs(XML);
    expect(totalPages).toBe(5);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: "nhs-jobs:111",
      source: "nhs-jobs",
      title: "Senior Data Analyst",
      company: "Example NHS Foundation Trust",
      location: "Manchester, M20 4BX",
      remote: false,
      url: "https://beta.jobs.nhs.uk/candidate/jobadvert/C1-26-1",
      applyOptions: [{ label: "NHS Jobs", url: "https://beta.jobs.nhs.uk/candidate/jobadvert/C1-26-1" }],
      employmentType: "Permanent",
      salary: { min: 39959, max: 48117, currency: "GBP", period: "year" },
    });
    expect(jobs[0].description).toBe("We are seeking an analyst to join our & team...\n\nClosing date: 2026-11-06.");
    expect(jobs[0].postedAt?.slice(0, 10)).toBe("2026-10-26");
    // Many places are shortened; remote is spotted in the location.
    expect(jobs[1]).toMatchObject({ location: "Manchester (remote with occasional travel), M2 1BB / Leeds / York (+1 more)", remote: true });
    expect(jobs[1].salary).toEqual({ text: "Negotiable" });
  });

  it("reads its salaries", () => {
    expect(nhsSalary("£31,049 a year")).toEqual({ min: 31049, max: undefined, currency: "GBP", period: "year" });
    expect(nhsSalary("£14.50 an hour")).toMatchObject({ min: 14.5, period: "hour" });
    expect(nhsSalary("")).toBeUndefined();
  });
});
