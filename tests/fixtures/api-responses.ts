// Sample responses in each API's documented format, trimmed to one or two jobs.

export const remotive = {
  "job-count": 1,
  jobs: [
    {
      id: 101,
      url: "https://remotive.com/remote-jobs/software-dev/senior-python-engineer-101",
      title: "Senior Python Engineer",
      company_name: "Acme &amp; Co",
      company_logo: "https://remotive.com/logo/acme.png",
      category: "Software Development",
      tags: ["python", "django"],
      job_type: "full_time",
      publication_date: "2026-10-08T10:00:00",
      candidate_required_location: "Europe",
      salary: "€70k – €90k",
      description: "<p>We build <strong>things</strong>.</p><ul><li>Python</li><li>Postgres</li></ul>",
    },
  ],
};

export const remoteok = [
  { legal: "API Terms of Service: link back to Remote OK" },
  {
    id: "202",
    slug: "remote-data-analyst-globex-202",
    epoch: 1791460800,
    date: "2026-10-07T12:00:00+00:00",
    company: "Globex",
    position: "Data Analyst",
    tags: ["sql", "analytics"],
    description: "Analyse data with SQL and Python.",
    location: "Worldwide",
    salary_min: 60000,
    salary_max: 80000,
    apply_url: "https://globex.example/apply",
    url: "https://remoteok.com/remote-jobs/remote-data-analyst-globex-202",
  },
  {
    id: "203",
    company: "Initech",
    position: "Office Manager",
    tags: ["admin"],
    description: "Keep the office running.",
    location: "Austin, TX",
    url: "https://remoteok.com/remote-jobs/203",
  },
];

export const arbeitnow = {
  data: [
    {
      slug: "frontend-developer-berlin-123",
      company_name: "Hooli GmbH",
      title: "Frontend Developer (m/f/d)",
      description: "<p>React and TypeScript.</p>",
      remote: false,
      url: "https://www.arbeitnow.com/jobs/companies/hooli/frontend-developer-berlin-123",
      tags: ["javascript", "react"],
      job_types: ["full time"],
      location: "Berlin",
      created_at: 1791374400,
    },
  ],
  links: { next: null },
};

export const jobicy = {
  apiVersion: "2",
  jobCount: 1,
  jobs: [
    {
      id: 303,
      url: "https://jobicy.com/jobs/303-python-developer",
      jobSlug: "303-python-developer",
      jobTitle: "Python Developer",
      companyName: "Umbrella",
      companyLogo: "https://jobicy.com/logo.png",
      jobIndustry: ["Programming"],
      jobType: ["full-time"],
      jobGeo: "USA",
      jobLevel: "Midweight",
      jobExcerpt: "Build APIs.",
      jobDescription: "<p>Build APIs in Python &amp; FastAPI.</p>",
      pubDate: "2026-10-06 09:30:00",
      annualSalaryMin: "90000",
      annualSalaryMax: "120000",
      salaryCurrency: "USD",
    },
  ],
};

export const himalayas = {
  totalCount: 1,
  jobs: [
    {
      guid: "https://himalayas.app/companies/stark/jobs/python-engineer",
      title: "Python Engineer",
      excerpt: "Python services",
      companyName: "Stark Industries",
      employmentType: "Full Time",
      minSalary: 100000,
      maxSalary: 140000,
      currency: "USD",
      seniority: ["Mid-level"],
      locationRestrictions: ["United Kingdom", "Germany"],
      categories: ["Software Engineering"],
      description: "<p>Python, AWS.</p>",
      pubDate: 1790000000,
      applicationLink: "https://himalayas.app/companies/stark/jobs/python-engineer/apply",
    },
  ],
};

export const greenhouseJobs = {
  jobs: [
    {
      id: 4001,
      title: "Python Backend Engineer",
      absolute_url: "https://boards.greenhouse.io/acme/jobs/4001",
      location: { name: "London, UK" },
      updated_at: "2026-10-05T10:00:00-04:00",
      first_published: "2026-10-01T10:00:00-04:00",
      content: "&lt;p&gt;Join our &lt;strong&gt;platform&lt;/strong&gt; team.&lt;/p&gt;",
      departments: [{ name: "Engineering" }],
    },
    {
      id: 4002,
      title: "Account Executive",
      absolute_url: "https://boards.greenhouse.io/acme/jobs/4002",
      location: { name: "New York" },
      content: "&lt;p&gt;Sell things.&lt;/p&gt;",
      departments: [{ name: "Sales" }],
    },
  ],
};

export const greenhouseBoard = { name: "Acme Corp" };

export const lever = [
  {
    id: "abc-123",
    text: "Python Engineer",
    hostedUrl: "https://jobs.lever.co/plaid/abc-123",
    applyUrl: "https://jobs.lever.co/plaid/abc-123/apply",
    createdAt: 1791000000000,
    categories: { location: "Remote - UK", team: "Engineering", commitment: "Full-time" },
    descriptionPlain: "Build payment rails.",
    lists: [{ text: "Requirements", content: "<li>Python</li><li>Go</li>" }],
    workplaceType: "remote",
    salaryRange: { min: 80000, max: 100000, currency: "GBP", interval: "per-year-salary" },
  },
];

export const ashby = {
  jobs: [
    {
      id: "ash-1",
      title: "Senior Python Engineer",
      department: "Engineering",
      team: "Platform",
      employmentType: "FullTime",
      location: "London",
      secondaryLocations: [{ location: "Remote (UK)" }],
      isRemote: true,
      isListed: true,
      descriptionPlain: "Scale our platform.",
      publishedAt: "2026-10-02T00:00:00.000Z",
      jobUrl: "https://jobs.ashbyhq.com/ramp/ash-1",
      applyUrl: "https://jobs.ashbyhq.com/ramp/ash-1/application",
      compensation: { scrapeableCompensationSalarySummary: "£90K – £110K" },
    },
  ],
};

export const adzuna = {
  count: 1,
  results: [
    {
      id: "5001",
      title: "<strong>Python</strong> Developer",
      description: "We are looking for a <strong>Python</strong> developer…",
      redirect_url: "https://www.adzuna.co.uk/jobs/land/ad/5001",
      created: "2026-10-09T08:00:00Z",
      company: { display_name: "Wayne Enterprises" },
      location: { display_name: "London, UK" },
      salary_min: 50000,
      salary_max: 65000,
      salary_is_predicted: "0",
      contract_time: "full_time",
      contract_type: "permanent",
      category: { label: "IT Jobs" },
    },
  ],
};

export const reed = {
  results: [
    {
      jobId: 6001,
      employerName: "Cyberdyne",
      jobTitle: "Python Developer",
      locationName: "Manchester",
      minimumSalary: 45000,
      maximumSalary: 55000,
      currency: "GBP",
      date: "09/10/2026",
      jobDescription: "Python developer needed &hellip;",
      jobUrl: "https://www.reed.co.uk/jobs/python-developer/6001",
    },
  ],
};

export const jooble = {
  totalCount: 1,
  jobs: [
    {
      id: 7001,
      title: "<b>Python</b> Developer",
      location: "Leeds",
      snippet: "&nbsp;...develop <b>Python</b> services...",
      salary: "£50k",
      source: "www.indeed.co.uk",
      type: "Full-time",
      link: "https://jooble.org/desc/7001",
      company: "Soylent",
      updated: "2026-10-08T00:00:00.0000000",
    },
  ],
};

export const usajobs = {
  SearchResult: {
    SearchResultItems: [
      {
        MatchedObjectId: "8001",
        MatchedObjectDescriptor: {
          PositionTitle: "IT Specialist (Python)",
          PositionURI: "https://www.usajobs.gov/job/8001",
          ApplyURI: ["https://www.usajobs.gov/job/8001/apply"],
          PositionLocationDisplay: "Washington, DC",
          OrganizationName: "Department of Examples",
          PublicationStartDate: "2026-10-03",
          PositionRemuneration: [{ MinimumRange: "90000", MaximumRange: "120000", RateIntervalCode: "PA" }],
          PositionSchedule: [{ Name: "Full-time" }],
          UserArea: { Details: { JobSummary: "Support systems.", MajorDuties: ["Write Python"], RemoteIndicator: false } },
        },
      },
    ],
  },
};

export const serpapi = {
  jobs_results: [
    {
      job_id: "g-1",
      title: "Python Developer",
      company_name: "Wayne Enterprises",
      location: "London, UK",
      via: "LinkedIn",
      description: "Full description from Google Jobs.",
      job_highlights: [{ title: "Qualifications", items: ["3+ years Python"] }],
      detected_extensions: { posted_at: "2 days ago", schedule_type: "Full-time", salary: "£50K–£65K a year" },
      apply_options: [
        { title: "LinkedIn", link: "https://www.linkedin.com/jobs/view/123" },
        { title: "Indeed", link: "https://uk.indeed.com/viewjob?jk=abc" },
      ],
      share_link: "https://www.google.com/search?ibp=htl;jobs#g-1",
    },
  ],
};

export const jsearch = {
  status: "OK",
  data: [
    {
      job_id: "js-1",
      employer_name: "Globex",
      job_publisher: "LinkedIn",
      job_employment_type: "FULLTIME",
      job_title: "Data Analyst",
      job_apply_link: "https://www.linkedin.com/jobs/view/999",
      job_description: "Analyse data with SQL.",
      job_is_remote: true,
      job_posted_at_datetime_utc: "2026-10-09T00:00:00.000Z",
      job_city: null,
      job_state: null,
      job_country: "GB",
      job_min_salary: 40000,
      job_max_salary: 50000,
      job_salary_period: "YEAR",
      apply_options: [
        { publisher: "LinkedIn", apply_link: "https://www.linkedin.com/jobs/view/999", is_direct: false },
        { publisher: "Glassdoor", apply_link: "https://www.glassdoor.co.uk/job-listing/999", is_direct: false },
      ],
    },
  ],
};
