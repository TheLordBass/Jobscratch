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

Six job boards work with no keys at all. To unlock the rest, add free API keys to `.env.local`. For AI CV tailoring, add `ANTHROPIC_API_KEY` ([get one here](https://console.anthropic.com/)). **Settings** in the app shows which sources are ready.

## Where the jobs come from

JobScratch uses official APIs and public job feeds only.

| Source | Coverage | Key |
| --- | --- | --- |
| Remotive, Remote OK, Himalayas, Jobicy | Remote jobs worldwide | None |
| Arbeitnow | Europe (mostly Germany) | None |
| [NHS Jobs](https://www.jobs.nhs.uk) | NHS jobs in England and Wales, from its public search (the descriptions are short: paste a job's link into **Add a job**, or use the bookmark on its page, for the full advert) | None |
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

[JobSpy](https://github.com/speedyapply/JobSpy) searches LinkedIn, Indeed, Glassdoor, Google Jobs and ZipRecruiter by scraping them. Those sites' terms forbid that, so JobScratch's server never runs it. If you choose to, you can run it on your own computer, either from the app through a small helper or in a terminal.

Set it up once:

```bash
python -m venv scripts/jobspy/.venv
scripts/jobspy/.venv/Scripts/pip install -r scripts/jobspy/requirements.txt
```

(On a Mac or Linux, the second line is `scripts/jobspy/.venv/bin/pip install …`.)

**From the app (the helper).** Turn the helper on by double-clicking `scripts/jobspy/start-helper.bat` (on Windows; make a desktop shortcut to it), or run `python scripts/jobspy/helper.py`. A small window opens; keep it open while you search. Then go to **Find jobs → Add a job → From JobSpy**: it shows the helper as running, with a search form. Type up to 50 job titles (one per line or separated by commas) and the places, pick the sites, and click **Search with JobSpy**; it says roughly how long that will take. Progress and the time left show as it goes, **Show the N so far** loads the jobs found up to then, and the full results appear in the list when it finishes, ready to save, match or hide. You can leave the page during a long search: it carries on in the helper, and its results are offered when you come back. **Turn off** in the app (or closing the window) stops the helper, and it stops by itself after 30 minutes without a search (`--idle-minutes`).

The helper only listens on your own computer (127.0.0.1:8765), only answers the JobScratch site (`https://jobscratch.vercel.app` and `http://localhost:3000`; add others with `--origin`), and accepts only JSON requests, so other websites can't use it. The first time, your browser may ask whether the site can connect to devices on your network: allow it, as that's how the page reaches the helper. It only works on the computer the helper runs on, not from your phone.

**From a terminal.** Run the search script, then load the file it writes in **From JobSpy → Load a results file**:

```bash
scripts/jobspy/.venv/Scripts/python scripts/jobspy/search.py "data analyst" --location London
```

Either way, save the jobs you want, or tailor your CV to one straight away. **Match all to my CV** scores them all against your CV; then **Save jobs matching 70% or more** (pick 50–90% or more, or exactly 100%) adds just the good matches to My jobs instead of all of them. Tick **plus the N without a description** to save the jobs JobSpy couldn't get a description for too (usually LinkedIn and Glassdoor), so you can fill them in one by one with your **Send to JobScratch** bookmark. The same works on your search results.

To narrow a list, use **From** (LinkedIn, Indeed, Glassdoor or any other site in the list) and **Show** (matched, not matched yet, or no full description) above it, on search results, JobSpy results and My jobs. Save all, Match all and the rest then act on just the jobs shown, so you can, say, pick out the LinkedIn jobs with no description and fill them in one by one.

LinkedIn jobs from JobSpy usually come without a description. Save them, then open each one on LinkedIn and click your **Send to JobScratch** bookmark: JobScratch recognises it as the same job (by its LinkedIn job number) and offers to **merge** the full description into the saved job, keeping its status and notes. The same works for Indeed and Glassdoor jobs.

To search several job titles and places at once, list them. Every combination is searched, and the results are merged into one file without duplicates:

```bash
python scripts/jobspy/search.py "junior data analyst" "data analyst" "senior data analyst" --location Manchester London "United Kingdom"
```

Put each one in quotes if it has a space. That example is 9 searches, so it takes a few minutes; the script waits 3 seconds between searches (`--pause`) to make blocking less likely, and skips any search that fails rather than stopping. The helper does the same, with up to 50 job titles and 100 searches (titles × places) at once. LinkedIn is the strict one: it can start turning searches away after only a few in a row from one connection. So the helper spaces **LinkedIn searches** at least 10 minutes apart (or 15, 20 or 30): closer together, LinkedIn turns many more away. The other sites are searched first, at full speed, and then LinkedIn one search at a time in the background. If LinkedIn turns one away anyway, the helper waits 10 minutes (then 20, then 30) and tries it again, and gives up on LinkedIn for that run after 4 blocks in a row. The other sites' jobs are always kept. Spacing makes a big search slow (each LinkedIn search adds 10 minutes, so 26 titles take about 4½ hours), so leave the helper running; it keeps Windows from going to sleep until the search is done.

Options for the script (the helper's form has the same ones): `--distance 10` to stay within 10 miles of each location (default 50), `--sites indeed linkedin glassdoor google zip_recruiter` (default: Indeed and LinkedIn; Google often returns nothing, and the app already has Google Jobs through SerpApi), `--results 25` per site for each search, `--hours 72` for recent jobs only, `--remote`, `--country usa` for Indeed and Glassdoor outside the UK, `--linkedin-descriptions` for full LinkedIn descriptions (slower), and `--linkedin-pace 10` to space LinkedIn searches 10 minutes apart, as above (the script doesn't space them unless you ask). Run `python scripts/jobspy/search.py --help` for the full list.

Expect sites to block it from time to time, LinkedIn especially, after a page or two. Running it from a home connection works best. You'll need Python 3.10 or newer.

#### Every morning, by itself

Your computer can run your JobSpy search every morning without you, and the jobs are waiting in JobScratch on any device, including your phone. It runs on your computer rather than on Vercel because LinkedIn and Glassdoor turn away searches from cloud servers. It needs [server storage](#your-data) to be on.

1. Tell it what to search, in **Find jobs → Add a job → From JobSpy**. Either make **title lists** there (see below), or just search once: without lists, the morning run repeats your last search, with the same job titles and places. Either way, it uses the sites and other options from the search form, for jobs posted in the last two days (or less, if you picked less).
2. In PowerShell, in the JobScratch folder, run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\jobspy\schedule-morning-run.ps1 -At 07:00
   ```

   The first time, it makes a **helper token** (a long random password for your computer), saves it in `scripts\jobspy\.env` and copies it to your clipboard.
3. In Vercel, add it as an environment variable named `JOBSCRATCH_HELPER_TOKEN` (your project → Settings → Environment Variables), then redeploy. Keep it private: it lets your computer add jobs to your JobScratch.
4. To try it straight away, run the same command with `-RunNow` instead of `-At 07:00`.

Each morning, Find jobs shows **The morning JobSpy run today at 07:02 found 48 jobs**, and **Show them** lists them in Add a job, ready to match, filter and save as usual (jobs you've already saved, or marked Not interested, are left out as usual). Only the latest run is kept. What the run did is written to `scripts\jobspy\scheduled.log`.

**Title lists** (in **From JobSpy → Title lists for the morning run**) are for searching a wide range of jobs: group the job titles you're after, such as "Data roles" in Manchester and "Operations" in Leeds and Remote, each with its own places (up to 20 lists, 100 titles and 10 places each). Switch a list off to leave it out of the morning run without deleting it. They're saved with your settings, so you can change them on your phone. With lists, the morning's jobs can be filtered by **Title list**, and a job found by two lists' searches is in both. A morning run makes at most 100 searches, about what LinkedIn puts up with from one connection when they're spaced out. When your lists add up to more, it takes turns: say 250 searches are split over 3 mornings, so every title is searched every third morning, and each run then looks back far enough (4 days) that nothing is missed in between. The lists say how many searches they add up to, how many mornings that takes, and how long a morning takes with LinkedIn 10 minutes apart: a full 100 searches is about 17 hours, so for a run that's done by the time you're up, keep a morning to 30 or 40.

Windows runs it while you're signed in. A computer that's asleep wakes up for it, if wake timers are allowed (Control Panel → Power Options → Change plan settings → Change advanced power settings → Sleep → Allow wake timers); one that's off runs it the next time it's on. To change the time, run the command again with another `-At`. To stop the morning runs, run it with `-Remove`.

#### Ready before you're up

The morning run can also do the next steps for you, so you wake up to jobs that are scored and ready to apply. Switch them on in **From JobSpy → Before you're up**:

- **Match the jobs it finds** against your CV, up to a limit each morning (each is one Claude request, as with Match all). It starts while the run is still searching, with the jobs sent so far. Jobs with only a snippet of a description, and ones marked Not interested, are skipped. With **as one batch** (on by default), the jobs are sent to Claude together through Anthropic's Message Batches API, which costs half as much. The answers come back later, usually within minutes, and the run waits for them. If a batch takes over an hour, JobScratch cancels what's left of it and matches those jobs one at a time, so the morning isn't held up. The batch API has no refusal fallback, so a job Claude declines in a batch just isn't scored.
- **Get the best ones ready to apply.** Once the searches are done, the best few matches above a score you pick are saved to My jobs with a tailored CV, and a cover letter and application answers if you tick them. They're waiting on **My jobs → Apply**. Jobs you've already applied to are left alone.
- **Send me a summary when it's done**, such as "3 jobs ready to apply", to your phone or computer, with a link to Apply.

The matching and writing run on the JobScratch site, with your CV, settings and API key, a few jobs at a time while the run on your computer keeps asking. So the computer only needs to stay on until it's finished. Find jobs and From JobSpy show how far it got.

**Notifications** need two keys, made once. In PowerShell, in the JobScratch folder, run:

```powershell
npx web-push generate-vapid-keys
```

In Vercel, add the **Public Key** as `JOBSCRATCH_VAPID_PUBLIC_KEY` and the **Private Key** as `JOBSCRATCH_VAPID_PRIVATE_KEY`, then redeploy. Keep the private one private: it lets whoever has it send notifications as your JobScratch. Then, on each device that should get them, open **From JobSpy → Before you're up** and tap **Turn on for this device**, then **Send a test**. Android phones and computers can turn them on in the browser. On an iPhone, first add JobScratch to your Home Screen (Share → Add to Home Screen), then open it from there and turn them on.

## AI CV tailoring

Upload your CV once (**My CV**: PDF, Word .docx, Markdown or text). Then choose a job and click **Tailor my CV**. Claude:

- **Analyses the match**: a 0–100 score, strengths with evidence from your CV, gaps, and keywords the job uses that your CV is missing (useful for applicant tracking systems).
- **Rewrites your CV** for the job: a new profile, skills ordered by relevance, and bullets that bring forward what this employer cares about. You choose UK CV or US resume conventions, length and tone.
- **Writes a cover letter** that connects your real achievements to the job's requirements.

**More than one CV:** going for different kinds of job? On **My CV**, click **Add another CV** (up to six). When a job is matched (on its page, with Match all, or by the morning run), Claude is given all your CVs, picks the one that presents you best for that job, and does the analysis with it. That CV is then used for the job's tailored CV, cover letter and answers. Your CVs are the same for every job, so after the first job in a list they're read from Claude's cache and cost much less. To skip the comparison for some jobs, give a CV job-title words it's always used for, such as "data analyst, BI" or "operations" (the longest fit wins). On a job's page, **Your CV** shows which one it's using and why, and you can pick another for that job. Changing any CV's text means a new comparison, so Match all scores the jobs again.

**Your website and GitHub (optional):** on **My CV**, add your portfolio site and GitHub, then click **Fetch details**. JobScratch reads your site's main pages (plus About and Projects pages) and your public repositories: descriptions, languages, topics and short README excerpts. It shows you exactly what Claude will see, and you can edit or remove anything. When tailoring, Claude can add your links to the CV, include a "Projects" section for relevant work, and count your projects in the match analysis. A project is described as a project, never as paid experience. Reading GitHub without a token allows 60 requests an hour; add a `GITHUB_TOKEN` (no permissions needed) if you hit the limit.

**It's told never to invent anything.** Employers, titles, dates, qualifications and numbers must come from your CV. Anything the job wants that your CV doesn't show goes in the gap analysis, not in the CV. Still, read every line before you send it.

**Match all:** on a JobSpy results list, your search results or My jobs, click **Match all to my CV** to run a full match analysis of every job at once: a 0–100 match, a verdict, your strengths, the gaps, the keywords your CV is missing and suggestions, the same as **Analyse match** on a job's page (which then shows it straight away). Jobs are sorted best match first, and a score is redone only when your CV or the job's description changes. It's one Claude request per job (it asks first above 10), and only jobs with a full description are matched: a job with just a snippet (under 600 characters, as Adzuna, Reed, Jooble and LinkedIn through JobSpy often give) or nothing is skipped, here and on its own page, until you add the full description with the bookmark or by pasting it.

**Skill trends:** on **Profile**, **What your jobs ask for** lists the skills your saved jobs ask for most, from their match analyses, with how many jobs (and how many you applied to) want each and whether your CV shows it. For one you have that your CV doesn't show, click **I have this** and say where and how you used it. It goes into **Skills and experience not in your CV**, which Claude uses with every match analysis, tailored CV and cover letter.

**Tailor CVs for top matches:** once jobs are scored, choose a minimum match (e.g. 80%+) and click **Write for N jobs** to write a tailored CV for each one, plus a cover letter and application answers if you tick those boxes. They're written two at a time (about a minute each), the jobs are saved to My jobs, and what's already written is skipped. It stops if requests keep failing (for example, a rate limit).

**Application answers:** a job's **Answers** tab drafts answers to the questions most application forms ask (why this company, why this role, why you're a good fit, and tell us about yourself), from your CV and the job, ready to copy into the form. Paste any other question from the form to have it answered too, and edit any answer. Under **Profile → Application details**, add your standard answers (right to work, notice period, salary expectations, where you can work, anything else): drafted answers use them where a question asks, and leave **[add your answer]** where they'd need one you haven't given. Like everything else, they're drafted from what's in your CV, notes and profile, never invented.

**Apply:** **My jobs → Apply** lists the saved jobs you haven't applied to that have a tailored CV, best match first. For each, **Apply on …** opens the job's application page, **CV (.docx)** downloads the tailored CV to upload, **Copy cover letter** copies it as plain text for a text box, and **Answers and details** has each drafted answer and your standard details with a copy button. You apply on the job's own site, then click **Mark as applied**, and it's counted on the Progress page. Below the list, **Get top matches ready** writes the CV, cover letter and answers for the matched jobs that don't have them yet. JobScratch never submits an application for you: you check each one and press Submit yourself.

Results stream in as they're written. You can edit them and download as **Word (.docx)**, **PDF** (via Print), or **Markdown**. They're saved with the job, so you can come back to them.

**Privacy:** your CV, the job description and (if you've added them) the details from your website and GitHub are sent to the Anthropic API only when you click one of the tailoring buttons. Nothing is stored on the JobScratch server.

**Model:** the default is `claude-opus-5-5`; set `ANTHROPIC_MODEL` to use another. If Claude's safety checks ever decline a request, the API automatically retries it on Anthropic's recommended fallback model. Set `ANTHROPIC_FALLBACKS=off` to disable that.

**Cost of matching:** your CV is cached between jobs, so matching a list pays full price for it only once every few minutes. To spend less on matches, set `ANTHROPIC_MATCH_MODEL` (for example `claude-haiku-5-5`, much cheaper) or `ANTHROPIC_MATCH_EFFORT` (`low`). Both apply to match analyses only, not to tailored CVs and cover letters. Compare a few scores before and after: a cheaper setting can score less carefully. Each request's token use (input, cache reads and writes, output) is written to the server log (Vercel → Logs).

## Your data

By default, everything personal lives in your browser's local storage, not on the server. Use **Settings → Download backup** to move it to another browser or computer, and **Restore backup** to load it.

### Keep it on the server (optional)

To have your CV, saved jobs, tailored documents and settings on every device, and safe if you clear your browser, add a free Redis database:

1. In Vercel, open your project, then **Storage → Create Database**, choose **Upstash for Redis** or **Redis** (either works; the free plans are plenty), and connect it to the project (with **Production** ticked). Vercel adds its connection settings for you: `UPSTASH_REDIS_REST_URL`/`_TOKEN` or `KV_REST_API_URL`/`_TOKEN` for Upstash, `REDIS_URL` for Redis, possibly with a prefix you chose. You don't need to install anything or write code: ignore the quickstart steps Vercel shows. Then redeploy, so the app sees the new settings.
2. Make sure `APP_PASSWORD` is set (see Deploying). Server storage stays off without it, so your CV is never open to anyone with the link.
3. Redeploy.

The browser keeps its own copy, so the app stays fast and works offline. Changes are saved to the server about a second after you make them, and changes from your other devices are merged in when you open the app or switch back to it. For each job, the most recent change wins, and removed jobs stay removed. The cloud icon in the navigation shows whether everything is saved. The first time you open the app with server storage on, whatever is in that browser is uploaded.

To try it locally without Upstash, set `JOBSCRATCH_DATA_FILE=./.data/jobscratch.json` in `.env.local` (development only).

## Deploying

It's a standard Next.js app, so it runs anywhere Node.js does (Vercel, Railway, Render, a VPS…). Add the same environment variables to your host.

**Set `APP_PASSWORD` on any copy that's reachable from the internet.** Otherwise anyone who finds the URL can see your data and use your Anthropic and job-API credits. With it set, JobScratch shows a sign-in page: the username is `APP_USERNAME` (default `jobscratch`; your email address works well) and the password is `APP_PASSWORD`. Tick **Remember this device** to stay signed in for 30 days; otherwise you're signed out when the browser closes. **Sign out** is the arrow icon at the top right; with server storage on, it also clears that browser's copy of your data. Changing `APP_PASSWORD` signs out every device, and after 10 wrong passwords an address has to wait 15 minutes. Scripts can still send the username and password with HTTP Basic Auth.

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
