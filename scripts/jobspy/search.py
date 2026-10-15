"""
Search LinkedIn, Indeed, Glassdoor, Google Jobs and ZipRecruiter with JobSpy
(https://github.com/speedyapply/JobSpy) and save the results as a file that
JobScratch can load (Find jobs > Add a job > From JobSpy).

Unofficial: these sites' terms forbid automated scraping, which is why the app
itself never does this. Run it yourself, on your own computer, for your own job
search. Sites may block it, especially LinkedIn after a few pages.

Give several job titles and several locations to search every combination; the
results are merged into one file without duplicates.

    pip install -r scripts/jobspy/requirements.txt
    python scripts/jobspy/search.py "data analyst" --location London
    python scripts/jobspy/search.py "junior data analyst" "data analyst" "senior data analyst" --location Manchester London "United Kingdom"
    python scripts/jobspy/search.py "product manager" --location Remote --sites linkedin indeed --hours 72
"""

import argparse
import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone

SITES = ["indeed", "linkedin", "glassdoor", "google", "zip_recruiter"]

# The columns JobScratch reads; the rest of JobSpy's output is left out.
FIELDS = [
    "site",
    "job_url",
    "job_url_direct",
    "title",
    "company",
    "location",
    "date_posted",
    "job_type",
    "is_remote",
    "min_amount",
    "max_amount",
    "currency",
    "interval",
    "description",
    "company_logo",
]

# Above this many searches, say how many requests that means before starting.
MANY_SEARCHES = 6


def parse_args():
    parser = argparse.ArgumentParser(
        description="Search job sites with JobSpy and save the results for JobScratch.",
    )
    parser.add_argument(
        "search",
        nargs="+",
        help='one or more job titles or keywords, each in quotes, e.g. "data analyst" "BI analyst"',
    )
    parser.add_argument(
        "--location",
        nargs="+",
        default=[""],
        help='one or more locations, each in quotes if it has a space, e.g. Manchester London "United Kingdom"',
    )
    parser.add_argument(
        "--distance",
        type=int,
        default=50,
        help="how far from each location to look, in miles (default: 50; try 10 for the city itself)",
    )
    parser.add_argument(
        "--country",
        default="uk",
        help="country for Indeed and Glassdoor, e.g. uk, usa, canada, germany (default: uk)",
    )
    parser.add_argument(
        "--sites",
        nargs="+",
        choices=SITES,
        default=["indeed", "linkedin"],
        help="sites to search (default: indeed linkedin)",
    )
    parser.add_argument("--results", type=int, default=25, help="results wanted per site, per search (default: 25)")
    parser.add_argument("--hours", type=int, help="only jobs posted in the last N hours")
    parser.add_argument("--remote", action="store_true", help="remote jobs only")
    parser.add_argument(
        "--linkedin-descriptions",
        action="store_true",
        help="also fetch full LinkedIn descriptions (much slower, and more likely to be blocked)",
    )
    parser.add_argument(
        "--pause",
        type=float,
        default=3,
        help="seconds to wait between searches, to make blocking less likely (default: 3)",
    )
    parser.add_argument("--out", default="jobspy-results.json", help="file to write (default: jobspy-results.json)")
    return parser.parse_args()


def unique(values):
    """Trimmed, without blanks or repeats (case-insensitive), in the order given."""
    seen, result = set(), []
    for value in (v.strip() for v in values):
        if value.lower() not in seen:
            seen.add(value.lower())
            result.append(value)
    return result


def search_once(scrape_jobs, args, term, location):
    """One JobSpy search, as JobScratch records."""
    where = f" near {location}" if location else ""
    jobs = scrape_jobs(
        site_name=args.sites,
        search_term=term,
        google_search_term=f"{term} jobs{where}",
        location=location or None,
        distance=args.distance,
        results_wanted=args.results,
        hours_old=args.hours,
        country_indeed=args.country,
        is_remote=args.remote,
        linkedin_fetch_description=args.linkedin_descriptions,
        description_format="html",
        verbose=1,
    )
    # pandas turns missing values into null and dates into ISO strings here.
    rows = json.loads(jobs.to_json(orient="records", date_format="iso")) if len(jobs) else []
    return [{field: row.get(field) for field in FIELDS} for row in rows]


def plan(search, location):
    """The keywords, locations and every (keyword, location) search to run."""
    terms = [term for term in unique(search) if term]
    # An empty location means "anywhere"; keep it only if it's the only one.
    locations = [place for place in unique(location) if place] or [""]
    return terms, locations, [(term, place) for term in terms for place in locations]


def log(message):
    print(message, file=sys.stderr, flush=True)


def run_searches(scrape_jobs, args, on_progress=None, should_stop=None):
    """
    Run every search in `args` and merge the results into one JobScratch file.

    on_progress(done, total, label, found) is called before each search and at the end;
    should_stop() is checked between searches. Returns (file contents, failed searches).
    Used by this script and by helper.py.
    """
    terms, locations, searches = plan(args.search, args.location)
    by_url, failed = {}, []
    for index, (term, location) in enumerate(searches):
        if index and args.pause > 0:
            # Wait in short steps, so a stop request isn't held up by the pause.
            deadline = time.monotonic() + args.pause
            while time.monotonic() < deadline and not (should_stop and should_stop()):
                time.sleep(0.2)
        if should_stop and should_stop():
            break
        label = f"“{term}”" + (f" in {location}" if location else "")
        if on_progress:
            on_progress(index, len(searches), label, len(by_url))
        log(f"[{index + 1}/{len(searches)}] Searching {', '.join(args.sites)} for {label}…")
        try:
            records = search_once(scrape_jobs, args, term, location)
        except Exception as error:  # One failed search shouldn't lose the others.
            log(f"    Failed: {error}")
            failed.append(label)
            continue
        new = 0
        for record in records:
            key = record.get("job_url") or f"{record.get('site')}|{record.get('title')}|{record.get('company')}"
            if key not in by_url:
                by_url[key] = record
                new += 1
        log(f"    {len(records)} found, {new} new")

    if on_progress:
        on_progress(len(searches), len(searches), None, len(by_url))
    document = {
        "format": "jobscratch-jobspy",
        "version": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "query": {"search": terms, "location": [location for location in locations if location]},
        "jobs": list(by_url.values()),
    }
    return document, failed


def main():
    args = parse_args()
    try:
        from jobspy import scrape_jobs
    except ImportError:
        sys.exit("JobSpy isn't installed. Run: pip install -r scripts/jobspy/requirements.txt")

    terms, locations, searches = plan(args.search, args.location)
    if not terms:
        sys.exit("Give at least one job title or keyword to search for.")
    if len(searches) > MANY_SEARCHES:
        log(
            f"{len(searches)} searches ({len(terms)} keywords × {len(locations)} locations) on "
            f"{len(args.sites)} sites. This may take a while, and sites are more likely to block it."
        )

    document, failed = run_searches(scrape_jobs, args)
    records = document["jobs"]
    with open(args.out, "w", encoding="utf-8") as file:
        json.dump(document, file, ensure_ascii=False)

    counts = Counter(record["site"] for record in records)
    summary = ", ".join(f"{site} {count}" for site, count in counts.most_common()) or "none"
    print(f"Saved {len(records)} jobs ({summary}) to {args.out}", file=sys.stderr)
    if failed:
        print(f"These searches failed and were skipped: {'; '.join(failed)}", file=sys.stderr)
    print("Load it in JobScratch: Find jobs > Add a job > From JobSpy.", file=sys.stderr)


if __name__ == "__main__":
    main()
