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
   - **Bookmarklet** (any browser): drag the button on the **Add a job** page to your bookmarks bar.
   - **Extension** (Chrome, Edge, Brave): see [`extension/README.md`](extension/README.md).

   If LinkedIn changes its layout and the description doesn't come through, select the description text on the page before clicking. Selected text always wins.

You can also paste a link to a job on a company careers page (Greenhouse, Lever, Workday, Ashby…) on the **Add a job** page, or type a job in by hand.

### JobSpy (unofficial, on your own computer)

[JobSpy](https://github.com/speedyapply/JobSpy) searches LinkedIn, Indeed, Glassdoor, Google Jobs and ZipRecruiter by scraping them. Those sites' terms forbid that, so the app never runs it. If you choose to, you can run it yourself and load the results:

```bash
pip install -r scripts/jobspy/requirements.txt
python scripts/jobspy/search.py "data analyst" --location London
```

Then, in JobScratch, go to **Find jobs → Add a job → From JobSpy** and choose the `jobspy-results.json` file it wrote. Save the jobs you want, or tailor your CV to one straight away. **Match all to my CV** scores them all against your CV.

LinkedIn jobs from JobSpy usually come without a description. Save them, then open each one on LinkedIn and click your **Send to JobScratch** bookmark: JobScratch recognises it as the same job (by its LinkedIn job number) and offers to **merge** the full description into the saved job, keeping its status and notes. The same works for Indeed and Glassdoor jobs.

To search several job titles and places at once, list them. Every combination is searched, and the results are merged into one file without duplicates:

```bash
python scripts/jobspy/search.py "junior data analyst" "data analyst" "senior data analyst" --location Manchester London "United Kingdom"
```

Put each one in quotes if it has a space. That example is 9 searches, so it takes a few minutes; the script waits 3 seconds between searches (`--pause`) to make blocking less likely, and skips any search that fails rather than stopping.

Options: `--distance 10` to stay within 10 miles of each location (default 50), `--sites indeed linkedin glassdoor google zip_recruiter` (default: Indeed and LinkedIn; Google often returns nothing, and the app already has Google Jobs through SerpApi), `--results 25` per site for each search, `--hours 72` for recent jobs only, `--remote`, `--country usa` for Indeed and Glassdoor outside the UK, and `--linkedin-descriptions` for full LinkedIn descriptions (slower). Run `python scripts/jobspy/search.py --help` for the full list.

Expect sites to block it from time to time, LinkedIn especially, after a page or two. Running it from a home connection works best. You'll need Python 3.10 or newer.

## AI CV tailoring

Upload your CV once (**My CV**: PDF, Word .docx, Markdown or text). Then choose a job and click **Tailor my CV**. Claude:

- **Analyses the match**: a 0–100 score, strengths with evidence from your CV, gaps, and keywords the job uses that your CV is missing (useful for applicant tracking systems).
- **Rewrites your CV** for the job: a new profile, skills ordered by relevance, and bullets that bring forward what this employer cares about. You choose UK CV or US resume conventions, length and tone.
- **Writes a cover letter** that connects your real achievements to the job's requirements.

**Your website and GitHub (optional):** on **My CV**, add your portfolio site and GitHub, then click **Fetch details**. JobScratch reads your site's main pages (plus About and Projects pages) and your public repositories: descriptions, languages, topics and short README excerpts. It shows you exactly what Claude will see, and you can edit or remove anything. When tailoring, Claude can add your links to the CV, include a "Projects" section for relevant work, and count your projects in the match analysis. A project is described as a project, never as paid experience. Reading GitHub without a token allows 60 requests an hour; add a `GITHUB_TOKEN` (no permissions needed) if you hit the limit.

**It's told never to invent anything.** Employers, titles, dates, qualifications and numbers must come from your CV. Anything the job wants that your CV doesn't show goes in the gap analysis, not in the CV. Still, read every line before you send it.

**Match all:** on a JobSpy results list, your search results or My jobs, click **Match all to my CV** to score every job at once: a 0–100 match, a one-line verdict and up to three things the job wants that your CV doesn't show. Jobs are sorted best match first, and a score is redone only when your CV or the job's description changes. It's one Claude request per job (it asks first above 20), and jobs without a description are skipped. To make these quick scores cheaper, set `ANTHROPIC_QUICK_MODEL` (e.g. `claude-haiku-5-5`); tailoring keeps using the main model.

**Tailor CVs for top matches:** once jobs are scored, choose a minimum match (e.g. 80%+) and click **Write for N jobs** to write a tailored CV for each one, and a cover letter too if you tick the box. They're written two at a time (about a minute each), the jobs are saved to My jobs, and jobs that already have a tailored CV are skipped. It stops if requests keep failing (for example, a rate limit).

Results stream in as they're written. You can edit them and download as **Word (.docx)**, **PDF** (via Print), or **Markdown**. They're saved with the job, so you can come back to them.

**Privacy:** your CV, the job description and (if you've added them) the details from your website and GitHub are sent to the Anthropic API only when you click one of the tailoring buttons. Nothing is stored on the JobScratch server.

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
    api/profile         reads your own website and public GitHub for tailoring
  lib/sources/          one adapter per job source, all producing the same Job shape
  lib/search.ts         keyword/location/date filtering, de-duplication and ranking
  lib/ai/               Claude prompts and API calls
  lib/profile/          website and GitHub readers
  lib/store.ts          browser storage for CV, saved jobs, groups and settings
public/extractor.js     reads a job from a web page; used by the bookmarklet, extension and URL import
extension/              Chrome/Edge extension (extractor.js is a copy: run `npm run sync:extension`)
```

**Adding a job source:** create `src/lib/sources/<name>.ts` that implements `JobSource`, add it to `src/lib/sources/index.ts`, and add sample data to `tests/fixtures/api-responses.ts`.

If a source starts returning errors, its API may have changed. The search results show each source's status, and the adapter for each one is a short file in `src/lib/sources/`.
