# JobScratch

A personal job-search website that:

- **Searches many job portals at once** by keyword or by saved **keyword groups** (e.g. *Data roles* = data analyst, BI analyst, analytics engineer), with filters for location, remote, date posted and excluded words.
- **Links every result back to the portal it came from**, so you apply in the right place. When the same job is listed on several sites (LinkedIn, Indeed, the company site…), the duplicates are merged and you get every apply link.
- **Imports jobs from LinkedIn, Indeed and Glassdoor** (which can't be scraped) with a one-click bookmarklet or browser extension, or from any careers-page link or pasted description.
- **Tailors your CV to a job with AI (Claude).** It gives a match analysis (score, strengths, gaps, missing keywords), a rewritten CV and a cover letter. You can edit them, then download as Word, PDF or Markdown.
- **Tracks your applications** (saved → applied → interviewing → offer) with notes and CSV export.

Your CV, saved jobs and settings are stored only in your browser.

## Quick start

You need [Node.js](https://nodejs.org/) 20.9 or newer.

```bash
npm install
cp .env.example .env.local   # then add your keys (see below)
npm run dev
```

Open http://localhost:3000.

Five job boards work with no keys at all. To unlock the rest, add free API keys to `.env.local`. For AI CV tailoring, add `ANTHROPIC_API_KEY` ([get one here](https://console.anthropic.com/)). **Settings** in the app shows which sources are ready.

## Where the jobs come from

JobScratch uses official APIs and public job feeds only.

| Source | Coverage | Key |
| --- | --- | --- |
| Remotive, Remote OK, Himalayas, Jobicy | Remote jobs worldwide | None |
| Arbeitnow | Europe (mostly Germany) | None |
| Greenhouse / Lever / Ashby boards | Careers pages of companies you choose (add them in **Settings**) | None |
| [Adzuna](https://developer.adzuna.com/signup) | UK, US, EU, Australia, India and 13 more countries | Free |
| [Reed](https://www.reed.co.uk/developers/jobseeker) | UK | Free |
| [Jooble](https://jooble.org/api/about) | 60+ countries, thousands of sites | Free |
| [USAJOBS](https://developer.usajobs.gov/apirequest/) | US federal government | Free |
| [Google Jobs via SerpApi](https://serpapi.com/google-jobs-api) | Google for Jobs: **LinkedIn, Indeed, Glassdoor, ZipRecruiter** and company sites, with their apply links | Free monthly allowance, then paid |
| [JSearch on RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) | Google for Jobs data: **LinkedIn, Indeed, Glassdoor** and more | Free tier, then paid |

Responses are cached in memory for 15 minutes to a few hours depending on the source, which keeps repeat searches fast and within free limits. Free remote boards ask you to link back to their listing, and JobScratch does.

### LinkedIn, Indeed and Glassdoor

These sites don't offer a public jobs API, and their terms forbid automated scraping, so JobScratch doesn't scrape them. You still get their jobs in two ways:

1. **In search results**: the two Google for Jobs sources above return listings that are on LinkedIn, Indeed and Glassdoor, with links to apply there.
2. **One job at a time, from your browser**: open a job on LinkedIn (or anywhere) and click **Send to JobScratch**. The job's title, company, location, description and link are read from the page you're looking at and opened in JobScratch, ready to save and tailor your CV to. Nothing runs in the background, and nothing is fetched by the server.
   - **Bookmarklet** (any browser): drag the button on the **Import** page to your bookmarks bar.
   - **Extension** (Chrome, Edge, Brave): see [`extension/README.md`](extension/README.md).

   If LinkedIn changes its layout and the description doesn't come through, select the description text on the page before clicking. Selected text always wins.

You can also paste a link to a job on a company careers page (Greenhouse, Lever, Workday, Ashby…) on the **Import** page, or type a job in by hand.

## AI CV tailoring

Upload your CV once (**My CV**: PDF, Word .docx, Markdown or text). Then choose a job and click **Tailor my CV**. Claude:

- **Analyses the match**: a 0–100 score, strengths with evidence from your CV, gaps, and keywords the job uses that your CV is missing (useful for applicant tracking systems).
- **Rewrites your CV** for the job: a new profile, skills ordered by relevance, and bullets that bring forward what this employer cares about. You choose UK CV or US resume conventions, length and tone.
- **Writes a cover letter** that connects your real achievements to the job's requirements.

**It's told never to invent anything.** Employers, titles, dates, qualifications and numbers must come from your CV. Anything the job wants that your CV doesn't show goes in the gap analysis, not in the CV. Still, read every line before you send it.

Results stream in as they're written. You can edit them and download as **Word (.docx)**, **PDF** (via Print), or **Markdown**. They're saved with the job, so you can come back to them.

**Privacy:** your CV and the job description are sent to the Anthropic API only when you click one of the tailoring buttons. Nothing is stored on the JobScratch server.

**Model:** the default is `claude-opus-5-5`; set `ANTHROPIC_MODEL` to use another. If Claude's safety checks ever decline a request, the API automatically retries it on Anthropic's recommended fallback model. Set `ANTHROPIC_FALLBACKS=off` to disable that.

## Your data

Everything personal lives in your browser's local storage, not on the server. Use **Settings → Download backup** to move it to another browser or computer, and **Restore backup** to load it.

## Deploying

It's a standard Next.js app, so it runs anywhere Node.js does (Vercel, Railway, Render, a VPS…). Add the same environment variables to your host.

**Set `APP_PASSWORD` on any copy that's reachable from the internet.** Otherwise anyone who finds the URL can use your Anthropic and job-API credits. The browser will ask for the password once (username `jobscratch`, or set `APP_USERNAME`).

After deploying, open the **Import** page on your deployed site and drag the bookmarklet from there, so it sends jobs to that address. In the extension popup, set the JobScratch address to your deployed URL.

## Development

```bash
npm run dev          # local dev server
npm test             # unit tests (vitest)
npm run lint         # eslint
npm run typecheck    # TypeScript
npm run build        # production build
```

How the code is organised:

```
src/
  app/                  pages (search, saved, cv, tailor, import, settings) and API routes
    api/search          fans a search out to every source, merges and ranks results
    api/tailor/*        match analysis (structured output) and streamed CV / cover letter
    api/cv/parse        PDF / Word / text → plain text
    api/import/url      fetches a public job page safely (blocks private networks and LinkedIn/Indeed/Glassdoor)
  lib/sources/          one adapter per job source, all producing the same Job shape
  lib/search.ts         keyword/location/date filtering, de-duplication and ranking
  lib/ai/               Claude prompts and API calls
  lib/store.ts          browser storage for CV, saved jobs, groups and settings
public/extractor.js     reads a job from a web page; used by the bookmarklet, extension and URL import
extension/              Chrome/Edge extension (extractor.js is a copy: run `npm run sync:extension`)
```

**Adding a job source:** create `src/lib/sources/<name>.ts` that implements `JobSource`, add it to `src/lib/sources/index.ts`, and add sample data to `tests/fixtures/api-responses.ts`.

If a source starts returning errors, its API may have changed. The search results show each source's status, and the adapter for each one is a short file in `src/lib/sources/`.
